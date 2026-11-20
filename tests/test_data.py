import io
import json
from decimal import Decimal
from pathlib import Path
import pytest
from openpyxl import Workbook
from fastapi.testclient import TestClient
from app import ingest, store, live, catalog
from app.main import app

HEADER='upc,category,description,brand,unit,quantity,packages,paid_amount,period\n'


def parse(body):
    return ingest.parse((HEADER+body).encode(),'file.csv','CSV','IN','2025-Q3')


def test_zero_missing_and_cents():
    data=parse('00123456789012,Yogurt,Example,,OZ,0,0,0,2025-Q3\n00123456789013,Yogurt,Other,Brand,OZ,,,0.105,2025-Q3\n')
    assert data['records'][0]['paid_cents']==0
    assert data['records'][0]['quantity']==0
    assert data['records'][0]['upc']=='00123456789012'
    assert data['records'][1]['quantity'] is None
    assert data['total_cents']==11
    assert data['quality']['missing_brand']==1


@pytest.mark.parametrize('amount',['NaN','Infinity','oops',''])
def test_invalid_numbers_fail_atomically(amount):
    with pytest.raises(ingest.DataError):parse(f'00123456789012,Yogurt,Example,Brand,OZ,1,1,{amount},2025-Q3\n')


def test_duplicates_fail_and_periods_remain_distinct():
    row='00123456789012,Yogurt,Example,Brand,OZ,1,1,2.50,2025-Q3\n'
    with pytest.raises(ingest.DataError,match='duplicate'):parse(row+row)
    assert len(parse(row+row.replace('Q3','Q4'))['records'])==2


def test_negative_adjustments_retained():
    data=parse('00123456789012,Yogurt,Example,Brand,OZ,-1,-1,-2.50,2025-Q3\n')
    assert data['total_cents']==-250
    assert data['quality']['negative_payments']==1


def test_bad_sheet_and_unknown_format():
    with pytest.raises(ingest.DataError):ingest.inspect(b'a,b\n1,2','file.csv')
    with pytest.raises(ingest.DataError):ingest.read_sheets(b'not a zip','file.xlsx')
    with pytest.raises(ingest.DataError):ingest.parse(HEADER.encode(),'file.csv','No sheet','IN','2025-Q3')


def texas_file(total=3):
    w=Workbook();s=w.active;s.title='Peanut Butter'
    s.append(['July 2026 Texas Peanut Butter'])
    s.append(['UPC','Description','Brand Description','Jul 2026 Redeemed','Jul 2026 Paid Amt','Jul 2026 Avg Price'])
    s.append(['00000012345678901','PB','National Brand',1,2,2])
    s.append([None,'Private Store Brand',None,1,1,1])
    s.append(['Grand Total',None,None,2,total])
    buf=io.BytesIO();w.save(buf);return buf.getvalue()


def test_texas_aggregates_and_reconciliation():
    d=ingest.parse(texas_file(),'pb.xlsx','Peanut Butter','TX','')
    assert d['total_cents']==300
    assert len(d['records'])==2
    assert d['records'][1]['upc']==''
    with pytest.raises(ingest.DataError,match='grand total'):
        ingest.parse(texas_file(99),'pb.xlsx','Peanut Butter','TX','')


def test_apl_preserves_codes_and_requires_date():
    body=b'UPC,CATEGORY,CATEGORY_DESCRIPTION,PRODUCT_DESCRIPTION_AND_SIZE\n 00123456789012,06,Legumes,Example\n'
    d=catalog.parse_reference(body,'ca.csv','CSV','apl','CA','2026-09-30')
    assert d['records'][0]['upc']=='00123456789012'
    assert d['records'][0]['category']=='Legumes'
    with pytest.raises(ingest.DataError):catalog.parse_reference(body,'ca.csv','CSV','apl','CA','')


@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setattr(store,'DB',tmp_path/'data.sqlite3')
    with TestClient(app,headers={'X-WIC-Client':'local'}) as c:yield c


def test_import_is_idempotent_and_original_is_retained(client):
    content=(HEADER+'00123456789012,Yogurt,Example,Brand,OZ,10,1,2.50,2025-Q3\n').encode()
    r=client.post('/api/import/inspect?name=report.csv',content=content)
    assert r.status_code==200
    opts={'token':r.json()['token'],'sheet':'CSV','state':'IN','period':'2025-Q3'}
    assert client.post('/api/import/preview',json=opts).json()['total_cents']==250
    first=client.post('/api/import/commit',json=opts).json()
    second=client.post('/api/import/commit',json=opts).json()
    assert first['id']==second['id'] and second['already_exists']
    assert len(client.get('/api/sources').json())==1
    assert client.get('/api/sources/'+first['id']+'/original').content==content
    assert client.get('/api/backup').content.startswith(b'SQLite format 3')


def test_failed_import_keeps_library_empty(client):
    content=(HEADER+'00123456789012,Yogurt,Example,Brand,OZ,1,1,NaN,2025-Q3\n').encode()
    token=client.post('/api/import/inspect?name=file.csv',content=content).json()['token']
    assert client.post('/api/import/commit',json={'token':token,'sheet':'CSV','state':'IN','period':'2025-Q3'}).status_code==422
    assert client.get('/api/sources').json()==[]


def test_origin_and_host_protection(client):
    assert client.post('/api/settings/views',json=[],headers={'Origin':'https://evil.example'}).status_code==403
    assert client.get('/api/sources',headers={'Host':'evil.example'}).status_code==400
    assert client.get('/api/sources').headers['content-security-policy'].startswith("default-src 'self'")


def test_public_fetch_rejects_private_and_untrusted_urls():
    for url in ['http://localhost/admin','https://127.0.0.1','https://example.org','https://www.hhs.texas.gov:8080/x']:
        with pytest.raises(ingest.DataError):live.fetch(url)


def test_live_failure_retains_data(client,monkeypatch):
    def failed(key):raise ingest.DataError('Source unavailable')
    monkeypatch.setattr(live,'download',failed)
    assert client.post('/api/live/tx').status_code==422
    assert client.get('/api/sources').json()==[]


def test_supplied_workbook_reconciliation():
    p=Path('/home/user/Downloads/2025 1009 IN WIC Redemption 3Q 2025.xlsx')
    if not p.exists():pytest.skip('User workbook is not available on this machine')
    content=p.read_bytes();info=ingest.inspect(content,p.name)
    assert info['sheet']=='Export Worksheet'
    d=ingest.parse(content,p.name,info['sheet'],'IN','2025-Q3')
    assert len(d['records'])==5293
    assert len(d['categories'])==12
    assert d['total_cents']==2035287181
    assert d['quality']['missing_brand']==751


def test_monitor_unchanged_and_failed_fetch_preserve_snapshots(tmp_path,monkeypatch):
    from app import monitor
    monkeypatch.setattr(store,'DB',tmp_path/'monitor.sqlite3');store.init()
    store.setting('monitor',{'hours':6,'sources':['ca']})
    body=b'upc,description\n00123456789012,Example\n'
    monkeypatch.setattr(live,'download',lambda key:(body,'apl.csv','https://data.ca.gov/example.csv'))
    assert monitor.run_once(force=True)['ca']['result']=='New snapshot saved'
    assert len(store.sources())==1
    assert monitor.run_once(force=True)['ca']['result']=='Unchanged'
    assert len(store.sources())==1
    def failure(key):raise ingest.DataError('Network unavailable')
    monkeypatch.setattr(live,'download',failure)
    assert monitor.run_once(force=True)['ca']['result']=='Check failed'
    assert len(store.sources())==1


def test_missing_product_code_is_an_error():
    with pytest.raises(ingest.DataError,match='product code is missing'):
        parse(',Yogurt,Example,Brand,OZ,1,1,2.50,2025-Q3\n')


def test_apl_numeric_codes_are_rejected():
    w=Workbook();s=w.active;s.append(['upc','description']);s.append([123456789012,'Example'])
    b=io.BytesIO();w.save(b)
    with pytest.raises(ingest.DataError,match='UPC is numeric'):
        catalog.parse_reference(b.getvalue(),'apl.xlsx','Sheet','apl','IN','2025-09-01')

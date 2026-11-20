"""Browser workflows use an isolated database and do not edit the user's workspace."""
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
import httpx
import pytest
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]


@pytest.fixture(scope='module')
def server(tmp_path_factory):
    root=tmp_path_factory.mktemp('browser')
    with socket.socket() as s:
        s.bind(('127.0.0.1',0));port=s.getsockname()[1]
    env={**os.environ,'WIC_DB':str(root/'test.sqlite3')}
    proc=subprocess.Popen([sys.executable,'-m','app.main','--port',str(port)],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    base=f'http://127.0.0.1:{port}'
    client=httpx.Client(base_url=base,headers={'X-WIC-Client':'local'})
    for _ in range(100):
        try:
            if client.get('/api/sources').status_code==200:break
        except httpx.ConnectError:pass
        time.sleep(.05)
    else:
        proc.terminate();raise RuntimeError('Test server did not start')
    def upload(name,content,kind='redemption',state='IN',as_of=''):
        info=client.post('/api/import/inspect',params={'name':name,'kind':kind},content=content.encode()).json()
        result=client.post('/api/import/commit',json={'token':info['token'],'sheet':'CSV','state':state,'period':'2025-Q3','kind':kind,'as_of':as_of})
        assert result.status_code==200,result.text
        return result.json()
    header='upc,category,description,brand,unit,quantity,packages,package_size,paid_amount,period\n'
    upload('Indiana.csv',header+'00123456789012,Yogurt,Plain yogurt,Alpha,OZ,320,10,32,40,2025-Q3\n00123456789013,Yogurt,Vanilla yogurt,Beta,OZ,160,5,32,25,2025-Q3\n')
    upload('Ohio.csv',header+'00123456789012,Yogurt,Plain yogurt,Alpha,OZ,320,10,32,50,2025-Q3\n',state='OH')
    upload('Indiana revision.csv',header+'00123456789012,Yogurt,Plain yogurt,Alpha,OZ,320,10,32,41,2025-Q3\n')
    upload('Attributes.csv','upc,manufacturer,brand,flavor,size,category,attribute\n00123456789012,Maker A,Alpha,Plain,32 oz,Yogurt,Low fat\n00123456789013,Maker B,Beta,Vanilla,32 oz,Yogurt,Low fat\n',kind='catalog',state='')
    apl='upc,description,category,brand\n'
    upload('CA first.csv',apl+'00123456789012,Plain yogurt,Yogurt,Alpha\n',kind='apl',state='CA',as_of='2025-09-01')
    upload('CA second.csv',apl+'00123456789013,Vanilla yogurt,Yogurt,Beta\n',kind='apl',state='CA',as_of='2025-10-01')
    upload('OH APL.csv',apl+'00123456789012,Plain yogurt,Yogurt,Alpha\n',kind='apl',state='OH',as_of='2025-10-01')
    yield base,client,root
    client.close();proc.terminate();proc.wait(timeout=10)


@pytest.fixture
def page(server):
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        page=browser.new_page(viewport={'width':1440,'height':1000})
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(server[0]);page.wait_for_selector('.metrics')
        yield page
        assert not errors,errors
        browser.close()


def test_filters_provenance_prices_and_exports(page):
    page.get_by_role('button',name='Products',exact=True).click()
    page.get_by_placeholder('Product, brand, or UPC').fill('Plain')
    expect(page.locator('.panel-head').first).to_contain_text('1 records')
    page.locator('.product-name').click()
    expect(page.get_by_role('dialog')).to_contain_text('Maker A')
    expect(page.get_by_role('dialog')).to_contain_text('row 2')
    page.get_by_role('button',name='Close',exact=True).click()
    with page.expect_download() as dl:page.get_by_role('button',name='Export data',exact=True).click()
    path=dl.value.path();assert '00123456789012' in Path(path).read_text()
    assert 'Source row' not in Path(path).read_text()  # Export uses machine-readable fields.
    expect(page.get_by_text('Price per package, by brand',exact=True)).to_be_visible()


def test_scope_blocks_overlap_and_combines_states(page):
    page.locator('[data-action="choose-sources"]').click()
    checks=page.locator('[name="report-check"]')
    for i in range(checks.count()):checks.nth(i).uncheck()
    page.get_by_label('IN · Q3 2025 Indiana.csv',exact=False).check()
    page.get_by_label('IN · Q3 2025 Indiana revision.csv',exact=False).check()
    page.get_by_role('button',name='Apply scope').click()
    expect(page.locator('#dialog-error')).to_contain_text('overlapping reports')
    page.get_by_label('IN · Q3 2025 Indiana revision.csv',exact=False).uncheck()
    page.get_by_label('OH · Q3 2025 Ohio.csv',exact=False).check()
    page.get_by_role('button',name='Apply scope').click()
    expect(page.locator('.metric .value').first).to_have_text('$115')
    page.get_by_role('button',name='Save view',exact=True).click()
    page.get_by_label('View name').fill('Two-state review')
    page.get_by_role('button',name='Save view',exact=True).last.click()
    page.get_by_role('button',name='Data sources',exact=True).click()
    expect(page.get_by_text('Two-state review',exact=True)).to_be_visible()
    page.get_by_role('button',name='Open view').click()
    expect(page.locator('.metric .value').first).to_have_text('$115')


def test_approval_matrix_changes_watchlist_and_weights(page):
    page.get_by_role('button',name='Approval monitor',exact=True).click()
    expect(page.locator('thead').first).to_contain_text('CA')
    expect(page.locator('thead').first).to_contain_text('OH')
    expect(page.get_by_text('Not listed',exact=True).first).to_be_visible()
    page.get_by_role('button',name='Watch a UPC').click()
    page.get_by_label('Product code').fill('00123456789012')
    page.get_by_role('button',name='Watch product',exact=True).click()
    page.get_by_role('button',name='Snapshot changes').click()
    expect(page.get_by_text('Removed',exact=True)).to_be_visible()
    expect(page.get_by_text('Added',exact=True)).to_be_visible()
    page.locator('#only-watch').check()
    expect(page.get_by_text('Removed',exact=True)).to_be_visible()
    expect(page.get_by_text('Added',exact=True)).not_to_be_visible()
    page.get_by_role('button',name='Set participation weights').click()
    page.locator('#weights').fill('CA,100,2025-09\nOH,50,2025-09')
    page.locator('#weights-source').fill('Test participation counts')
    page.get_by_role('button',name='Save weights').click()
    expect(page.locator('#coverage-result')).to_contain_text('33.3%')


def test_file_import_preview_and_duplicates(page,server):
    file=server[2]/'new.csv';file.write_text('upc,category,description,brand,paid_amount,period\n00123456789016,Cheese,Cheese,Test,12.34,2025-Q4\n')
    page.get_by_role('button',name='Add data',exact=True).click()
    page.locator('#import-file').set_input_files(file)
    page.get_by_role('button',name='Continue').click()
    page.locator('#import-state').fill('ME')
    page.get_by_role('button',name='Check data').click()
    expect(page.locator('#import-preview')).to_contain_text('1 records ready')
    page.get_by_role('button',name='Save to workspace').click()
    expect(page.locator('.metric .value').first).to_have_text('$12')
    page.get_by_role('button',name='Products',exact=True).click()
    page.locator('.product-name').click()
    expect(page.get_by_role('dialog')).to_contain_text('$12.34')
    expect(page.get_by_role('dialog')).to_contain_text('Not supplied')


def test_analytics_module_contract(page):
    result=page.evaluate('''async()=>{const a=await import('/static/analytics.js');return {
     overlap:!!a.overlap([{state:'IN',periods:['2025-Q3']},{state:'IN',periods:['2025-08']}]),
     safe:!a.overlap([{state:'IN',periods:['2025-Q3']},{state:'OH',periods:['2025-Q3']}]),
     selected:a.filterRows([{period:'2025-07'},{period:'2025-08'},{period:'2025-09'}],{period:['2025-07','2025-09']}).length,
     csv:a.csv([{upc:'001234',description:'=HYPERLINK("bad")'}],['upc','description'])
    }}''')
    assert result['overlap'] and result['safe'] and result['selected']==2
    assert "'=HYPERLINK" in result['csv']
    assert '001234' in result['csv']


def test_mobile_layout_keyboard_dialog_and_no_external_requests(page,server):
    page.set_viewport_size({'width':390,'height':844})
    page.goto(server[0]);page.wait_for_selector('.metrics')
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    page.get_by_role('button',name='Add data',exact=True).click()
    expect(page.get_by_role('dialog')).to_be_visible()
    page.keyboard.press('Escape');expect(page.get_by_role('dialog')).not_to_be_visible()
    page.screenshot(path=str(server[2]/'mobile.png'),full_page=True)
    external=page.evaluate("performance.getEntriesByType('resource').map(r=>r.name).filter(u=>!u.startsWith(location.origin))")
    assert not external

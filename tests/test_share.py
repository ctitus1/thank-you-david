"""Standalone exports run from file:// with networking disabled."""
import copy
import json
import re
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright, expect

from app import share, store


@pytest.fixture
def portable_file(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DB', tmp_path / 'snapshot.sqlite3')
    store.init()
    records = []
    for index, (description, brand, paid) in enumerate([
        ('Plain yogurt', 'Alpha', 1234), ('Vanilla yogurt', 'Beta', 2000)
    ], 2):
        records.append({'upc':f'0012345678901{index}', 'category':'Yogurt',
                        'subcategory':'Low fat', 'brand':brand, 'brand_key':brand.lower(),
                        'description':description, 'unit':'OZ', 'package_size':'32',
                        'period':'2025-Q3', 'paid_cents':paid, 'packages':2,
                        'quantity':64, 'source_row':index})
    parsed = {'records':records, 'notes':['Coverage is limited to the supplied test records.'],
              'periods':['2025-Q3'], 'categories':['Yogurt'], 'total_cents':3234}
    store.save(b'PRIVATE_WORKBOOK_CONTENT', 'Example.xlsx', 'Export Worksheet', 'IN',
               '2025-Q3', 'redemption', parsed)
    store.setting('monitor', {'hours':6,'sources':['ca']})
    payload=share.snapshot()
    file=tmp_path/'moved'/'shared.html'
    file.parent.mkdir()
    file.write_text(share.build_html(payload))
    return file,payload


@pytest.fixture
def offline_page():
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        context=browser.new_context(offline=True,viewport={'width':1440,'height':1000})
        page=context.new_page()
        errors=[];network=[]
        page.on('pageerror',lambda error: errors.append(str(error)))
        page.on('request',lambda request: network.append(request.url) if request.url.startswith(('http:','https:')) else None)
        yield page
        assert not errors,errors
        assert not network,network
        browser.close()


def test_embeds_data_and_excludes_originals(portable_file):
    file,payload=portable_file
    text=file.read_text()
    assert 'PRIVATE_WORKBOOK_CONTENT' not in text
    assert 'monitor' not in payload['settings']
    assert len(payload['sources'])==1
    assert len(next(iter(payload['records'].values())))==2
    assert "connect-src 'none'" in text
    assert 'script-src \'sha256-' in text
    assert not re.search(r'<script[^>]+src=',text)
    assert '<link rel="stylesheet"' not in text


def test_offline_analysis_exports_and_source_details(portable_file,offline_page):
    page=offline_page;page.goto(portable_file[0].as_uri())
    expect(page.locator('.metric .value').first).to_have_text('$32')
    expect(page.get_by_text('Standalone HTML',exact=True)).to_be_visible()
    expect(page.get_by_role('button',name='Add data',exact=True)).to_have_count(0)
    page.get_by_role('button',name='Products',exact=True).click()
    page.get_by_placeholder('Product, brand, or UPC').fill('Alpha')
    expect(page.locator('.panel-head').first).to_contain_text('1 records')
    page.locator('.product-name').click()
    expect(page.get_by_role('dialog')).to_contain_text('$12.34')
    expect(page.get_by_role('dialog')).to_contain_text('row 2')
    page.get_by_role('button',name='Close',exact=True).click()
    with page.expect_download() as exported:
        page.get_by_role('button',name='Export data',exact=True).click()
    csv=Path(exported.value.path()).read_text()
    assert '00123456789012' in csv and 'Alpha' in csv and 'Beta' not in csv
    page.get_by_role('button',name='Data sources',exact=True).click()
    expect(page.get_by_role('button',name='Automatic checks',exact=True)).to_have_count(0)
    page.get_by_role('button',name='Source details').click()
    expect(page.get_by_role('link',name='Download original file')).to_have_count(0)
    with page.expect_download() as original:
        page.get_by_role('button',name='Export embedded records').click()
    assert 'Beta' in Path(original.value.path()).read_text()


def test_saved_copy_retains_view_watchlist_and_saved_views(portable_file,offline_page,tmp_path):
    page=offline_page;page.goto(portable_file[0].as_uri());page.wait_for_selector('.metrics')
    page.get_by_role('button',name='Products',exact=True).click()
    page.get_by_placeholder('Product, brand, or UPC').fill('Alpha')
    expect(page.locator('.panel-head').first).to_contain_text('1 records')
    page.get_by_role('button',name='Watch Plain yogurt',exact=True).click()
    page.get_by_role('button',name='Save view',exact=True).click()
    page.get_by_label('View name').fill('My yogurt review')
    page.get_by_role('button',name='Save view',exact=True).last.click()
    with page.expect_download() as result:
        page.get_by_role('button',name='Save a copy',exact=True).first.click()
    saved=tmp_path/'renamed-with-changes.html';result.value.save_as(saved)
    # A new browser context cannot inherit in-memory state from the original file.
    fresh=page.context.browser.new_context(offline=True)
    reopened=fresh.new_page();reopened.goto(saved.as_uri())
    expect(reopened.locator('h1')).to_have_text('Product explorer')
    expect(reopened.get_by_placeholder('Product, brand, or UPC')).to_have_value('Alpha')
    expect(reopened.get_by_role('button',name='Unwatch Plain yogurt',exact=True)).to_be_visible()
    reopened.get_by_role('button',name='Data sources',exact=True).click()
    expect(reopened.get_by_text('My yogurt review',exact=True)).to_be_visible()
    fresh.close()


def test_source_text_cannot_escape_embedded_json(portable_file,offline_page,tmp_path):
    payload=copy.deepcopy(portable_file[1])
    attack='</script><script>window.INJECTED=true</script><img src="https://example.test/tracker" onerror="window.INJECTED=true">'
    next(iter(payload['records'].values()))[0]['description']=attack
    file=tmp_path/'escaped.html';file.write_text(share.build_html(payload))
    page=offline_page;page.goto(file.as_uri());page.wait_for_selector('.metrics')
    assert page.evaluate('window.INJECTED === undefined')
    page.get_by_role('button',name='Products',exact=True).click()
    expect(page.locator('.product-name').filter(has_text='window.INJECTED')).to_be_visible()
    assert page.locator('img[src^="https://"]').count()==0


def test_mobile_snapshot_and_chart_export(portable_file,offline_page):
    page=offline_page;page.set_viewport_size({'width':390,'height':844})
    page.goto(portable_file[0].as_uri());page.wait_for_selector('.metrics')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    with page.expect_download() as exported:
        page.get_by_role('button',name='Export category chart as SVG').click()
    svg=Path(exported.value.path()).read_text()
    assert '<svg' in svg and 'Yogurt' in svg and '2025-Q3' in svg


def test_empty_snapshot_is_rejected():
    with pytest.raises(ValueError,match='Import at least one source'):
        share.build_html({'sources':[]})

import argparse
import asyncio
from contextlib import suppress
import io
import json
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, Field

from . import store, ingest, live, catalog, monitor


@asynccontextmanager
async def lifespan(app):
    store.init()
    task = asyncio.create_task(monitor.loop())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(title='Thank you, David — WIC data', lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=['localhost','127.0.0.1','[::1]','testserver'])
STATIC = Path(__file__).parent / 'static'


@app.middleware('http')
async def protect(request, call_next):
    if request.method not in ('GET','HEAD','OPTIONS'):
        origin = request.headers.get('origin')
        if (origin and urlparse(origin).netloc != request.headers.get('host')) or request.headers.get('x-wic-client') != 'local':
            return JSONResponse({'detail':'Use the local app to make changes.'}, status_code=403)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    response.headers['Cache-Control'] = 'no-store' if request.url.path.startswith('/api') else 'no-cache'
    return response


@app.exception_handler(ingest.DataError)
async def data_error(request, exc):
    return JSONResponse({'detail':str(exc)}, status_code=422)


class ImportOptions(BaseModel):
    token: str
    sheet: str
    state: str = Field(default='', max_length=60)
    period: str = ''
    kind: str = 'redemption'
    as_of: str = ''


def prepared(options):
    item = store.staged(options.token)
    if not item:
        raise ingest.DataError('The import expired. Select the file again.')
    if options.kind == 'redemption':
        parsed = ingest.parse(item['content'],item['name'],options.sheet,options.state.strip().upper(),options.period)
    elif options.kind in ('apl','catalog'):
        parsed = catalog.parse_reference(item['content'],item['name'],options.sheet,options.kind,options.state.strip().upper(),options.as_of)
    else:
        raise ingest.DataError('Choose a supported data type.')
    return item, parsed


@app.get('/api/sources')
def sources():
    return store.sources()


@app.get('/api/sources/{ident}')
def source(ident: str):
    result = store.source(ident)
    if not result:
        return JSONResponse({'detail':'The source was not found.'},status_code=404)
    return {'metadata':result[0], 'records':result[1]}


@app.get('/api/sources/{ident}/original')
def original(ident: str):
    with store.connect() as db:
        row = db.execute('SELECT original,metadata FROM sources WHERE id=?',(ident,)).fetchone()
    if not row:
        return JSONResponse({'detail':'The source was not found.'}, status_code=404)
    ext = '.xlsx' if json.loads(row['metadata'])['name'].endswith('.xlsx') else '.csv'
    return Response(row['original'],media_type='application/octet-stream',headers={'Content-Disposition':f'attachment; filename="source-{ident}{ext}"'})


@app.post('/api/import/inspect')
async def inspect_file(request: Request, name: str, kind: str = 'redemption'):
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > ingest.MAX_BYTES:
            raise ingest.DataError('The file exceeds the 20 MB limit.')
    name = Path(name).name[:240]
    content = bytes(content)
    if kind == 'redemption':
        info = ingest.inspect(content, name)
    else:
        sheets = ingest.read_sheets(content, name)
        info = {'sheets':[{'name':s, 'rows':len(r)-1, 'header_row':1} for s,r in sheets.items()], 'sheet':next(iter(sheets)), 'state':'', 'period':''}
    return {**info, 'token':store.stage(content,name), 'name':name}


@app.post('/api/import/preview')
def preview(options: ImportOptions):
    item, parsed = prepared(options)
    return {**{k:v for k,v in parsed.items() if k != 'records'}, 'count':len(parsed['records']), 'sample':parsed['records'][:5]}


@app.post('/api/import/commit')
def commit(options: ImportOptions):
    item, parsed = prepared(options)
    return store.save(item['content'],item['name'],options.sheet,options.state.strip().upper(),options.period,
                      options.kind,parsed,item['origin'],options.as_of)


@app.post('/api/live/{key}')
def live_source(key: str):
    if key not in ('tx','ca'):
        raise ingest.DataError('This live source is not supported.')
    content,name,url = live.download(key)
    info = ingest.inspect(content,name) if key == 'tx' else {'sheet':'CSV','sheets':[{'name':'CSV'}], 'period':''}
    return {**info,'state':'TX' if key == 'tx' else 'CA', 'kind':'redemption' if key == 'tx' else 'apl',
            'token':store.stage(content,name,url), 'name':name, 'origin':url}


@app.get('/api/settings/{key}')
def get_setting(key: str):
    return store.setting(key)


@app.post('/api/settings/{key}')
async def set_setting(key: str, request: Request):
    if key not in ('watchlist','views','weights'):
        raise ingest.DataError('This setting is not supported.')
    raw = await request.body()
    if len(raw) > 100000:
        raise ingest.DataError('The saved setting is too large.')
    try:
        value = json.loads(raw)
    except ValueError:
        raise ingest.DataError('The saved setting is invalid.')
    store.setting(key,value)
    return {'ok':True}



class MonitorOptions(BaseModel):
    hours: int = 0
    sources: list[str] = ['ca']


@app.get('/api/monitor')
def monitor_status():
    return {'config':monitor.config(), 'status':monitor.status()}


@app.post('/api/monitor')
def monitor_config(options: MonitorOptions):
    if options.hours not in (0,6,24) or not options.sources or any(s not in ('ca','tx') for s in options.sources):
        raise ingest.DataError('Choose a supported interval and public source.')
    store.setting('monitor',options.model_dump())
    return {'ok':True}


@app.post('/api/monitor/check')
def monitor_check():
    return monitor.run_once(force=True)

@app.get('/api/share')
def share_html():
    from .share import build_html
    try:
        content = build_html()
    except ValueError as error:
        raise ingest.DataError(str(error))
    return Response(content, media_type='text/html', headers={
        'Content-Disposition':'attachment; filename="thank-you-david.html"'})


@app.get('/api/backup')
def backup():
    # SQLite's backup API includes a consistent view of pending WAL data.
    import sqlite3, tempfile
    with tempfile.TemporaryDirectory() as temp:
        dest = Path(temp)/'backup.sqlite3'
        with store.connect() as db, sqlite3.connect(dest) as output:
            db.backup(output)
        return Response(dest.read_bytes(),media_type='application/octet-stream',headers={'Content-Disposition':'attachment; filename="thank-you-david.sqlite3"'})


@app.get('/')
def index():
    return FileResponse(STATIC/'index.html')


app.mount('/static',StaticFiles(directory=STATIC),name='static')


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument('--import-file',type=Path)
    parser.add_argument('--state',default='IN')
    parser.add_argument('--period',default='')
    parser.add_argument('--port',type=int,default=8765)
    args = parser.parse_args()
    store.init()
    if args.import_file:
        content = args.import_file.read_bytes()
        info = ingest.inspect(content,args.import_file.name)
        period = args.period or info['period']
        parsed = ingest.parse(content,args.import_file.name,info['sheet'],args.state,period)
        meta = store.save(content,args.import_file.name,info['sheet'],args.state,period,'redemption',parsed)
        print(f"Imported {meta['count']:,} rows: {meta['name']}")
        return
    import uvicorn
    uvicorn.run('app.main:app',host='127.0.0.1',port=args.port)


if __name__ == '__main__':
    cli()

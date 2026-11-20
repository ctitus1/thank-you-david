"""Optional polling runs only inside the local server process."""
import asyncio
import hashlib
from datetime import datetime, timezone
from . import store, live, ingest, catalog


def config():
    value = store.setting('monitor')
    return value if isinstance(value, dict) else {'hours':0, 'sources':['ca']}


def status():
    value = store.setting('monitor_status')
    return value if isinstance(value, dict) else {}


def run_once(force=False):
    settings = config()
    if not settings.get('hours') and not force:
        return status()
    previous = status()
    now = datetime.now(timezone.utc)
    for key in settings.get('sources', ['ca']):
        last = previous.get(key, {}).get('checked_at')
        if not force and last and (now-datetime.fromisoformat(last)).total_seconds() < settings['hours']*3600:
            continue
        try:
            content,name,url = live.download(key)
            digest = hashlib.sha256(content).hexdigest()
            existing = next((s for s in store.sources() if s['origin'] == url),None)
            if existing and existing['sha256'] == digest:
                result = 'Unchanged'
            else:
                if key == 'ca':
                    as_of = now.date().isoformat()
                    data = catalog.parse_reference(content,name,'CSV','apl','CA',as_of)
                    store.save(content,name,'CSV','CA','','apl',data,url,as_of)
                else:
                    data = ingest.parse(content,name,'Peanut Butter','TX','')
                    store.save(content,name,'Peanut Butter','TX','','redemption',data,url)
                result = 'New snapshot saved'
            previous[key] = {'checked_at':now.isoformat(), 'result':result, 'error':''}
        except (ingest.DataError, ValueError) as error:
            previous[key] = {'checked_at':now.isoformat(), 'result':'Check failed', 'error':str(error)}
    store.setting('monitor_status',previous)
    return previous


async def loop():
    while True:
        try:
            await asyncio.to_thread(run_once)
        except Exception:
            # A failed check must not stop the next scheduled check or the local server.
            import logging
            logging.getLogger(__name__).exception('Public source check failed')
        await asyncio.sleep(60)

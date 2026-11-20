import hashlib
import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = Path(os.environ.get('WIC_DB', ROOT / 'data' / 'wic.sqlite3'))


def now():
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connect():
    DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB, timeout=30)
    db.row_factory = sqlite3.Row
    try:
        with db:
            yield db
    finally:
        db.close()


def init():
    with connect() as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript('''
        CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, fingerprint TEXT UNIQUE NOT NULL,
          metadata TEXT NOT NULL, payload TEXT NOT NULL, original BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS staging(id TEXT PRIMARY KEY, name TEXT, origin TEXT, created TEXT, content BLOB);
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        ''')
        db.execute("DELETE FROM staging WHERE julianday(created) < julianday('now', '-1 day')")
        db.execute('PRAGMA user_version=1')


def stage(content, name, origin=''):
    token = uuid.uuid4().hex
    with connect() as db:
        db.execute("DELETE FROM staging WHERE id NOT IN (SELECT id FROM staging ORDER BY created DESC LIMIT 19)")
        db.execute('INSERT INTO staging VALUES (?,?,?,?,?)', (token, name, origin, now(), content))
    return token


def staged(token):
    with connect() as db:
        row = db.execute('SELECT * FROM staging WHERE id=?', (token,)).fetchone()
    return dict(row) if row else None


def save(content, name, sheet, state, period, kind, parsed, origin='', as_of=''):
    digest = hashlib.sha256(content).hexdigest()
    fingerprint = hashlib.sha256(json.dumps([digest, sheet, state, parsed.get('periods', []), kind, as_of]).encode()).hexdigest()
    with connect() as db:
        old = db.execute('SELECT metadata FROM sources WHERE fingerprint=?', (fingerprint,)).fetchone()
        if old:
            return {**json.loads(old[0]), 'already_exists': True}
        for row in db.execute('SELECT metadata FROM sources'):
            existing = json.loads(row[0])
            if (existing['sha256'], existing['sheet'], existing['state'], existing['kind'], existing['as_of'], existing['periods']) == (digest, sheet, state, kind, as_of, parsed.get('periods', [])):
                return {**existing, 'already_exists': True}
        ident = uuid.uuid4().hex
        metadata = {'id': ident, 'name': name, 'sheet': sheet, 'state': state, 'kind': kind, 'origin': origin,
                    'as_of': as_of, 'imported_at': now(), 'sha256': digest,
                    'count': len(parsed['records']), **{k:v for k,v in parsed.items() if k != 'records'}}
        db.execute('INSERT INTO sources VALUES (?,?,?,?,?)',
                   (ident, fingerprint, json.dumps(metadata), json.dumps(parsed['records']), content))
    return metadata


def sources():
    with connect() as db:
        return [json.loads(r[0]) for r in db.execute('SELECT metadata FROM sources ORDER BY rowid DESC')]


def source(ident):
    with connect() as db:
        row = db.execute('SELECT metadata,payload FROM sources WHERE id=?', (ident,)).fetchone()
    return (json.loads(row[0]), json.loads(row[1])) if row else None


def setting(key, value=None):
    with connect() as db:
        if value is not None:
            db.execute('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, json.dumps(value)))
        row = db.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
    return json.loads(row[0]) if row else []

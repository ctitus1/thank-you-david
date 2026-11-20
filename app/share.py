"""Build a single offline HTML file from a consistent database snapshot."""
import argparse
import base64
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from . import store

STATIC = Path(__file__).parent / 'static'


def safe_json(value):
    encoded = json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    for literal in ('<', '>', '&', '\u2028', '\u2029'):
        encoded = encoded.replace(literal, f'\\u{ord(literal):04x}')
    return encoded


def snapshot():
    if not store.DB.exists():
        raise ValueError('No saved workspace exists. Import data before creating a shared HTML file.')
    with store.connect() as db:
        db.execute('BEGIN')
        rows = db.execute('SELECT metadata,payload FROM sources ORDER BY rowid DESC').fetchall()
        settings = {r['key']: json.loads(r['value']) for r in db.execute(
            "SELECT key,value FROM settings WHERE key IN ('watchlist','views','weights')")}
    sources = [json.loads(r['metadata']) for r in rows]
    return {
        'format_version': 1,
        'exported_at': datetime.now(timezone.utc).isoformat(),
        'sources': sources,
        'records': {s['id']: json.loads(r['payload']) for s, r in zip(sources, rows)},
        'settings': {key: settings.get(key, []) for key in ('watchlist', 'views', 'weights')},
    }


def build_html(payload=None):
    payload = snapshot() if payload is None else payload
    if not payload['sources']:
        raise ValueError('Import at least one source before creating a shared HTML file.')
    logo = 'data:image/svg+xml;base64,' + base64.b64encode((STATIC / 'mark.svg').read_bytes()).decode()
    analytics = re.sub(r'^export ', '', (STATIC / 'analytics.js').read_text(), flags=re.MULTILINE)
    application, count = re.subn(r'\Aimport\s*\{[^}]*\}\s*from "\./analytics\.js";\s*', '',
                                (STATIC / 'app.js').read_text(), count=1)
    if count != 1:
        raise ValueError('The app module imports changed. Update the HTML packager before exporting.')
    application = application.replace('/static/mark.svg', logo)
    script = (STATIC / 'portable.js').read_text() + '\n(() => {\n' + analytics + '\n' + application + '\n})();\n'
    if re.search(r'</script', script, flags=re.IGNORECASE):
        raise ValueError('The app contains an HTML script terminator. Escape it before exporting.')
    script_hash = base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()
    # Hash the executable code. JSON remains inert even when a source contains HTML.
    policy = (f"default-src 'none'; script-src 'sha256-{script_hash}'; "
              "style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; "
              "base-uri 'none'; form-action 'none'; object-src 'none'")
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#174f46">
<meta http-equiv="Content-Security-Policy" content="{policy}">
<meta name="referrer" content="no-referrer">
<title>Thank you, David · Shared WIC snapshot</title>
<link rel="icon" type="image/svg+xml" href="{logo}">
<style>{(STATIC / 'style.css').read_text()}</style>
</head>
<body>
<a class="skip" href="#main">Skip to data</a>
<div id="app"><div class="loading">Opening the shared snapshot…</div></div>
<noscript>Enable JavaScript in your browser to explore this shared WIC snapshot.</noscript>
<dialog id="dialog" aria-labelledby="dialog-title"></dialog>
<div id="toast" role="status" aria-live="polite"></div>
<script id="wic-data" type="application/json">{safe_json(payload)}</script>
<script>{script}</script>
</body>
</html>
'''


def main():
    parser = argparse.ArgumentParser(description='Export a standalone HTML snapshot. No server is started.')
    parser.add_argument('--output', type=Path, default=store.ROOT / 'dist' / 'thank-you-david.html')
    args = parser.parse_args()
    try:
        payload = snapshot()
        content = build_html(payload)
    except ValueError as error:
        parser.error(str(error))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix('.html.tmp')
    temporary.write_text(content, encoding='utf-8')
    temporary.replace(args.output)
    print(f"Saved {args.output} ({args.output.stat().st_size / 1024 / 1024:.2f} MiB)")
    print(f"Embedded {len(payload['sources'])} sources and {sum(len(r) for r in payload['records'].values()):,} records.")


if __name__ == '__main__':
    main()

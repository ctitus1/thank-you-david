#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
wic_requirements_hash="$(.venv/bin/python -c 'import hashlib; print(hashlib.sha256(open("requirements.txt", "rb").read()).hexdigest())')"
if [ ! -f .venv/.requirements.sha256 ] || [ "$(cat .venv/.requirements.sha256)" != "$wic_requirements_hash" ]; then
  .venv/bin/pip install -r requirements.txt
  printf '%s\n' "$wic_requirements_hash" > .venv/.requirements.sha256
fi
exec .venv/bin/python -m app.main "$@"

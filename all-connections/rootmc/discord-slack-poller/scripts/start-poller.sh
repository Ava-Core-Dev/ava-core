#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p /home/ava-core/ava/logs
# shellcheck disable=SC1091
eval "$(python3 - << 'PY'
from pathlib import Path
import shlex
print("set -a")
for line in Path("/home/ava-core/ava/credentials.env").read_text().splitlines():
    if not line or line.lstrip().startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    v = v.split("#", 1)[0].strip().strip('"').strip("'")
    if k == "AVA_PORT":
        continue
    print(f"{k}={shlex.quote(v)}")
print("set +a")
print("export AVA_PORT=8788")
PY
)"
exec node src/poller.mjs

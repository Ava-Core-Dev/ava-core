# System Processes — Live Monitor

Dark, real-time browser dashboard for OS processes + disk usage.

**Install location:** `/home/ava-core/operations/system-processes-page`

## Files

| File | Purpose |
|------|---------|
| `index.html` | Self-contained live dashboard (Chart.js + pure JS) |
| `api_processes_stub.py` | FastAPI + psutil backend (processes + disk scan) |

## Quick start

```bash
cd /home/ava-core/operations/system-processes-page

python3 -m venv .venv
source .venv/bin/activate
pip install fastapi uvicorn psutil

# start API
uvicorn api_processes_stub:app --host 0.0.0.0 --port 8793
```

In another terminal (or open the file directly):

```bash
python3 -m http.server 8080
# → http://localhost:8080
```

If you used a different port, edit `PROCESS_ENDPOINT` and `DISK_ENDPOINT` near the top of the `<script>` in `index.html`.

## Features

- Live process table (PID, name, user, CPU%, MEM%, status)
- Filter / sort / limit
- CPU average across cores + RAM
- History chart + top CPU consumers
- **Disk space**: overall used/free/% + major directory groups
- Auto-refresh (processes every 3s; disk less often)

## API endpoints

- `GET /api/processes` — process list + host info
- `GET /api/disk` — mounts + major directory sizes
- `GET /api/host` — richer host summary
- `GET /api/services` — running systemd units (Linux)

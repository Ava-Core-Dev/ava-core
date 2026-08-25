# /system/api/health was 404

## Symptom

`/system/api/health` returned 404 while `/api/status` and `/system/api/now` worked.

## Cause

`broadcast.py` never registered a health route. Homepage core badge uses
`/api/status`; some probes expect `/system/api/health`.

## Fix

Added aliases: `/api/health`, `/system/api/health`, `/health` returning a
compact snapshot from `build_status()`.

## Validate

```bash
curl -s https://www.avaivy.cloud/system/api/health
curl -s https://www.avaivy.cloud/api/status | head
```

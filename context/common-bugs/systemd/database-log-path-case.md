# systemd ava-core.service — Database vs database log path

## Symptom

`ava-core.service` fails immediately with:

```
status=209/STDOUT
```

Operations Console shows **SYSTEMD SERVICE: STOPPED**, broadcast/cloudflared/port 8080 all at 0.

## Cause

`/etc/systemd/system/ava-core.service` may still point StandardOutput/StandardError at:

```
/home/ava-core/Database/logs/ava-core-systemd.log
```

The canonical live tree uses lowercase:

```
/home/ava-core/database/logs/
```

On Linux these are different paths. systemd cannot create the log file → exit 209/STDOUT.

## Fix (preferred)

Edit the unit file (requires sudo):

```
StandardOutput=append:/home/ava-core/database/logs/ava-core-systemd.log
StandardError=append:/home/ava-core/database/logs/ava-core-systemd.log
```

Then:

```
sudo systemctl daemon-reload
sudo systemctl restart ava-core.service
```

## Do not use an uppercase compatibility path

Do not create `/home/ava-core/Database` as a directory or symlink. Correct the
systemd unit to use the lowercase canonical path instead.

## Verify localhost

```bash
bash /home/ava-core/verify-local-truth.sh
curl -s http://127.0.0.1:8080/api/status | python3 -m json.tool
```

## Incident

2026-08-24 — AVA Core Operations Console offline; fixed by correcting the
systemd log path to lowercase `database`.

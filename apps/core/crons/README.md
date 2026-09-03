# Cronologicals

Same method as the `E:\\090220261127` backup: four buckets, not a flat pile.

| Folder | When |
|---|---|
| `always_on/` | Keeps running (20s–5m) |
| `since_last_fire/` | Interval / hourly |
| `on_time/` | Clock time (HST) |
| `in_order_on_boot/` | Once at origin start |

Operator shortcuts (backup names): `operations/cronologicals/always-on`, `on-time`, `since-last-fire`, `in-order-on-boot`.

Scheduler still uses Honolulu time. Watchdog stays `pythonw.exe`.

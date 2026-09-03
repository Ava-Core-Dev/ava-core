# Cronologicals

Backup method from `E:\090220261127`: folders by *when*, not a flat list.

| Folder | When |
|---|---|
| `always-on/` | Keeps running |
| `since-last-fire/` | Interval / hourly |
| `on-time/` | Clock (HST) |
| `in-order-on-boot/` | Once when origin starts |

These names are junctions into `apps/core/crons/`. Edit the Python there.

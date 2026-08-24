# EcoFlow Hierarchical Aggregation Pipeline

Complete rewrite of the EcoFlow data chain: raw 10-second polls → multi-year rollups, with full metrics at every level and a live JSON status file.

## Architecture

```
ecoflow-10s.py          every-10-seconds     → ecoflow-10s.db   (raw snapshots)
        │  CLEAR after aggregate
        ▼
ecoflow-1min.py         every-minute         → ecoflow-1min.db
        │  keep history
        ▼
ecoflow-15min.py        every-15-min         → ecoflow-15min.db
        ▼
ecoflow-1h.py           every-hour           → ecoflow-1h.db
        ▼
ecoflow-4h.py           every-4-hours        → ecoflow-4h.db
        ▼
ecoflow-8h.py           every-8-hours        → ecoflow-8h.db
        ▼
ecoflow-12h.py          every-12-hours       → ecoflow-12h.db
        ▼
ecoflow-24h.py          every-24-hours       → ecoflow-24h.db
        ▼
ecoflow-3d.py           every-3-days         → ecoflow-3d.db
        ▼
ecoflow-7d.py           every-week           → ecoflow-7d.db
        ▼
ecoflow-month.py        monthly              → ecoflow-month.db
        ▼
ecoflow-quarter.py      quarterly            → ecoflow-quarter.db
        ▼
ecoflow-year.py         yearly               → ecoflow-year.db

ecoflow-live.json       rebuilt after every aggregator run
ecoflow-state.db        watermarks (optional bookkeeping)
```

**Only the 10s → 1min stage clears its source.** All higher stages keep full history and upsert by `(level, bucket_key, sn)`.

## Metrics stored at every level

| Group | Fields |
|-------|--------|
| SOC | `soc_avg`, `soc_min`, `soc_max`, `soc_delta`, `soc_stdev`, `trend` |
| Input W | `in_w_avg`, `in_w_min`, `in_w_max`, `in_w_delta` |
| Output W | `out_w_avg`, `out_w_min`, `out_w_max`, `out_w_delta` |
| Solar W | `solar_w_avg`, `solar_w_min`, `solar_w_max` |
| Derived | `net_w_avg` (in−out), `load_ratio` (out/(in+ε)) |
| Energy | `energy_in_wh`, `energy_out_wh`, `energy_solar_wh` (summed up the chain) |
| Coverage | `samples` (raw 10s count), `source_rows`, `online_pct` |

## Device names

| Serial | Friendly name |
|--------|---------------|
| `R331ZAB5SG755642` | security |
| `R621ZA16XH6K1155` | Primary |
| `R331ZAB5SG6S2858` | Backup |

## Missed cron / late boot

Each aggregator re-reads **all** rows from its source DB and assigns them to the correct bucket keys for their timestamps. Running `ecoflow-catchup.py` after a long outage walks the entire chain once and fills every missing bucket.

```bash
python3 ecoflow-catchup.py              # full chain from 1min
python3 ecoflow-catchup.py --from 1h    # start mid-chain
python3 ecoflow-catchup.py --only 24h   # single stage
```

## Paths (override with env)

| Variable | Default |
|----------|---------|
| `ECOFLOW_ROOT` | `/home/ava-core/Database/ecoflow` |
| `ECOFLOW_LOG_DIR` | `/home/ava-core/Database/logs` |
| `ECOFLOW_CRED` | `/home/ava-core/Credentials/credentials.env` |

## Cron placement (cronologicals)

| Script | Folder |
|--------|--------|
| `ecoflow-10s.py` | `since-last-fire/every-10-seconds/` |
| `ecoflow-1min.py` | `since-last-fire/every-minute/` |
| `ecoflow-15min.py` | `since-last-fire/every-15-minutes/` *or* `on-time/HH:00,15,30,45` |
| `ecoflow-1h.py` | `since-last-fire/every-hour/` |
| `ecoflow-4h.py` | `on-time/00:00, 04:00, 08:00, 12:00, 16:00, 20:00` |
| `ecoflow-8h.py` | `since-last-fire/every-8-hours/` |
| `ecoflow-12h.py` | `since-last-fire/every-12-hours/` |
| `ecoflow-24h.py` | `since-last-fire/every-24-hours/` |
| `ecoflow-3d.py` | daily (idempotent) |
| `ecoflow-7d.py` | `since-last-fire/every-week/` |
| `ecoflow-month.py` | `since-last-fire/every-month/` |
| `ecoflow-quarter.py` | quarterly / monthly |
| `ecoflow-year.py` | yearly / monthly |
| `ecoflow-catchup.py` | `in-order-on-boot/` (after network is up) |

Copy **`ecoflow_lib.py`** into the same directory as the scripts (or onto `PYTHONPATH`).

## Credentials

`credentials.env` must contain (any of these names work):

```
AVA_ECOFLOW_ACCESS_KEY=...
AVA_ECOFLOW_SECRET_KEY=...
# optional explicit SNs
AVA_ECOFLOW_SN=R331ZAB5SG755642,R621ZA16XH6K1155,R331ZAB5SG6S2858
```

## Live status

`ecoflow-live.json` is rewritten after every aggregator. Structure:

```json
{
  "updated_at": "...",
  "devices": {
    "Primary": { "soc": 100, "in_w": 0, "out_w": 0, "net_w": 0, "trend": "stable", ... },
    ...
  },
  "totals": { "in_w": ..., "out_w": ..., "net_w": ... },
  "levels": {
    "1min": { "Primary": { "bucket_key": "...", "soc_avg": ..., ... }, ... },
    "15min": { ... },
    "1h": { ... },
    ...
  }
}
```

## Migration from old DBs

Old files (`ecoflow-data.db`, `ecoflow-data-enhanced.db`) are **not** read by the new pipeline. To seed history:

1. Optionally rename old enhanced DB and write a one-off importer that maps `minute_summary` → `summary` with `level='1min'`.
2. Or simply start fresh; 10s + 1min will rebuild going forward, then run `ecoflow-catchup.py` periodically.

## Files in this package

```
ecoflow_lib.py          shared library (schema, stats, rollup, live JSON)
ecoflow-10s.py          API collector
ecoflow-1min.py         … year aggregators
ecoflow-catchup.py      full-chain / recovery runner
README.md               this file
```


## ava-core.py

Updated runner that:

- Adds intervals: `every-15-minutes`, `every-4-hours`, `every-3-days`
- Status every 30s prefers `ecoflow-live.json` → `ecoflow-1min.db` → `ecoflow-10s.db`
- Still falls back to legacy `ecoflow-data*.db` if the new chain has not produced data yet

**Install:** replace `/home/ava-core/operations/...` host copy of `ava-core.py` with this one (or wherever you launch the supervisor from). Create the new interval folders if missing:

```bash
mkdir -p /home/ava-core/operations/cronologicals/since-last-fire/{every-15-minutes,every-4-hours,every-3-days}
```

Suggested placement for EcoFlow scripts:

| Script | Folder |
|--------|--------|
| `ecoflow-10s.py` + `ecoflow_lib.py` | `since-last-fire/every-10-seconds/` |
| `ecoflow-1min.py` + lib | `since-last-fire/every-minute/` |
| `ecoflow-15min.py` + lib | `since-last-fire/every-15-minutes/` |
| `ecoflow-1h.py` + lib | `since-last-fire/every-hour/` |
| `ecoflow-4h.py` + lib | `since-last-fire/every-4-hours/` |
| `ecoflow-8h.py` + lib | `since-last-fire/every-8-hours/` |
| `ecoflow-12h.py` + lib | `since-last-fire/every-12-hours/` |
| `ecoflow-24h.py` + lib | `since-last-fire/every-24-hours/` |
| `ecoflow-3d.py` + lib | `since-last-fire/every-3-days/` |
| `ecoflow-7d.py` + lib | `since-last-fire/every-week/` |
| `ecoflow-month.py` + lib | `since-last-fire/every-month/` |
| `ecoflow-quarter.py` / `ecoflow-year.py` | monthly folder or on-time |
| `ecoflow-catchup.py` + lib | `in-order-on-boot/00:01/` (after network) |

Each interval folder needs its own copy of `ecoflow_lib.py` (or put lib on `PYTHONPATH` / symlink).

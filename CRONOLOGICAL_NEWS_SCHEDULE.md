# State News → Cronologicals

## Rule

State collectors run through `operations/cronologicals/on-time/` only. No standalone cron jobs are required.

Each state has one canonical collector:

```text
operations/news/<state>/news.py
```

Cronologicals receives a small launcher in a five-minute slot:

```text
operations/cronologicals/on-time/HH:MM/<state>-news.py
```

The launcher invokes that state's canonical `news.py`.

## Current schedule

All 50 state collectors run through `operations/cronologicals/on-time/` once per hour. The state list is deterministically distributed across the 12 five-minute slots:

```text
00:00  4
00:05  4
00:10  4
00:15  4
00:20  4
00:25  4
00:30  4
00:35  4
00:40  4
00:45  4
00:50  5
00:55  5
```

Total: 50 state collectors per hour. Hawaiʻi is no longer a special scheduling case; it uses the same state collector contract as every other state.

## Why this model

- One scheduler owns the ecosystem workload.
- State collectors remain isolated and independently testable.
- Work is spread across the hour instead of starting everything together.
- A failed state collector does not block other states.
- The same pattern can later schedule weather, earthquakes, events, imagery, and other state services.

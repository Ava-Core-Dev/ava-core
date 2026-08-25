# Ava Ivy state news collectors

Each state keeps its existing `operations/news/<state>/news.py` collector.
The shared collector lives in `operations/news/_collector.py`; Cronologicals
owns scheduling.

## Current architecture

- 50 existing state collectors under `operations/news/<state>/news.py`.
- `_collector.py` performs discovery, collection, normalization, deduplication,
  source-health tracking, and SQLite storage.
- `build_state_news.py` can run all existing state collectors without creating
  replacements or duplicate databases.
- `build_global_news.py` consumes the state databases.
- State launchers belong in the existing `operations/cronologicals/on-time/HH:MM/`
  schedule slots. Do not add independent system cron entries.

## Important source-discovery behavior

State portals frequently put their News/Press/Media links on a different
official state-government hostname. For example, a portal may link from
`portal.<state>.gov` to a governor or agency hostname under the same state
`.gov` namespace.

The shared collector therefore accepts: 

1. the original portal hostname and its subdomains; and
2. other official `.gov` hosts belonging to the same state government namespace.

It does **not** open arbitrary external domains. Federal or unrelated `.gov`
sites remain outside the state namespace and are rejected.

The homepage fetch also records the final URL after HTTP redirects so relative
News/Press/feed links are resolved against the actual destination.

## Do not duplicate the state layer

Do not create a second `news.py` architecture, duplicate state databases, or
replace the existing state wrappers merely because a state has no data. Fix
the shared collector or the specific state's source configuration when the
actual source requires it.

## Validation

Before handoff, validate `_collector.py` with:

    python3 -m py_compile operations/news/_collector.py

Then run the existing state collector(s) or Cronological launcher and inspect
the resulting `source_health`/collector output.

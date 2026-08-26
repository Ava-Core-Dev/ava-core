# every-10-minutes

## News cadence

- `global-news.py` — runs `operations/news/build_global_news.py`
- `all-states-news.py` — runs `operations/news/build_state_news.py --max-age-minutes 9`

Freshness checks inside the builders skip states that were collected recently, so this is safe alongside legacy `on-time/*/…-news.py` launchers.

Optional cleanup:
- Remove or rename `since-last-fire/every-5-minutes/global-news.py` to `global-news.py.disabled` to avoid double global scans.

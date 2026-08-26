# US weather collection

## Collector

`operations/weather/fetch_us_weather.py`

- Reads US rows from `config/locations/global-locations.json`
- Merges dense Hawaiʻi places from `web/sites/avaivy.cloud/data/hawaii-locations.json`
- Providers: **Open-Meteo** + **NOAA/NWS**
- Database: `database/weather.db` (same as existing boards)

## Schedule

`operations/cronologicals/since-last-fire/every-hour/fetch-us-weather.py`

Minimum spacing defaults to 55 minutes (`WEATHER_MIN_SECONDS`).

## Manual run

```bash
# full US (first run can take several minutes — paced requests)
python3 /home/ava-core/operations/weather/fetch_us_weather.py --force --verbose

# one state
python3 /home/ava-core/operations/weather/fetch_us_weather.py --force --state CA --verbose
```

## NWS policy

Set a real contact in the environment if needed:

```bash
export NWS_USER_AGENT='ava-core-weather/1.1 (https://avaivy.cloud; you@example.com)'
```

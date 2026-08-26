#!/usr/bin/env python3
"""
US weather collector for Ava.

Collects Open-Meteo + NOAA/NWS observations for every United States location
in config/locations/global-locations.json, plus the dense Hawaiʻi registry.

Writes into the same database/weather.db used by the public weather boards.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import requests  # type: ignore

    def http_get(url: str, headers: dict | None = None, params: dict | None = None, timeout: int = 25):
        r = requests.get(url, headers=headers or {}, params=params or {}, timeout=timeout)
        r.raise_for_status()
        return r.status_code, r.text, r.headers.get("Content-Type", "")
except Exception:
    import urllib.request
    import urllib.parse
    import ssl

    ssl_ctx = ssl.create_default_context()

    def http_get(url: str, headers: dict | None = None, params: dict | None = None, timeout: int = 25):
        if params:
            url = url + ("?" + urllib.parse.urlencode(params))
        req = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(req, timeout=timeout, context=ssl_ctx) as resp:
            data = resp.read()
            ct = resp.headers.get("Content-Type", "")
            return resp.status, data.decode("utf-8", errors="replace"), ct or ""


ROOT = Path("/home/ava-core")
DB_DIR = ROOT / "database"
DB_PATH = DB_DIR / "weather.db"
LOCK_PATH = Path("/tmp/fetch_us_weather.lock")
GLOBAL_LOCATIONS = ROOT / "config" / "locations" / "global-locations.json"
HAWAII_LOCATIONS = ROOT / "web" / "sites" / "avaivy.cloud" / "data" / "hawaii-locations.json"

NWS_USER_AGENT = os.environ.get(
    "NWS_USER_AGENT",
    "ava-core-weather/1.1 (https://avaivy.cloud; ops@avaivy.cloud)",
)
MIN_SECONDS_BETWEEN_RUNS = int(os.environ.get("WEATHER_MIN_SECONDS", str(55 * 60)))
PER_REQUEST_DELAY = float(os.environ.get("WEATHER_REQUEST_DELAY", "0.2"))
MAX_RETRIES = 3
RETRY_BASE = 1.0

STATE_CODES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA",
    "hawaii": "HI", "hawaiʻi": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN",
    "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME",
    "maryland": "MD", "massachusetts": "MA", "michigan": "MI", "minnesota": "MN",
    "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT",
    "virginia": "VA", "washington": "WA", "west virginia": "WV", "wisconsin": "WI",
    "wyoming": "WY", "district of columbia": "DC", "washington dc": "DC", "dc": "DC",
}


def state_code(*parts: Any) -> str:
    for p in parts:
        if p is None:
            continue
        s = str(p).strip()
        if len(s) == 2 and s.isalpha():
            return s.upper()
        key = re.sub(r"[^a-zʻ']+", " ", s.lower()).strip()
        key = key.replace("ʻ", "").replace("'", "")
        if key in STATE_CODES:
            return STATE_CODES[key]
        # try slug form
        slug = key.replace(" ", "-")
        for name, code in STATE_CODES.items():
            if name.replace(" ", "-") == slug:
                return code
    return ""


def slugify(value: str) -> str:
    value = value.lower().replace("ʻ", "").replace("'", "")
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "place"


def load_locations() -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    seen: set[Tuple[str, str]] = set()

    def add(row: Dict[str, Any]):
        key = (row["admin1_code"], slugify(row["name"]))
        if key in seen:
            return
        seen.add(key)
        rows.append(row)

    if GLOBAL_LOCATIONS.is_file():
        data = json.loads(GLOBAL_LOCATIONS.read_text(encoding="utf-8"))
        for loc in data.get("locations") or []:
            cc = str(loc.get("country_code") or "").upper()
            cname = str(loc.get("country_name") or "").lower()
            if cc not in ("US", "USA") and "united states" not in cname:
                continue
            code = state_code(
                loc.get("admin1_code"),
                loc.get("admin1_name"),
                loc.get("admin1_slug"),
            )
            if not code:
                continue
            name = str(loc.get("name") or "").strip()
            if not name:
                continue
            try:
                lat = float(loc["lat"])
                lon = float(loc["lon"])
            except Exception:
                continue
            region = str(loc.get("region") or loc.get("admin1_name") or code)
            add({
                "external_id": loc.get("id") or f"us-{code.lower()}-{slugify(name)}",
                "name": name,
                "slug": loc.get("slug") or slugify(name),
                "lat": lat,
                "lon": lon,
                "country_code": "US",
                "admin1_code": code,
                "admin1_name": loc.get("admin1_name") or code,
                "region": region,
                "island": region if code == "HI" else "",
            })

    # Dense Hawaiʻi registry fills islands beyond capitals
    if HAWAII_LOCATIONS.is_file():
        data = json.loads(HAWAII_LOCATIONS.read_text(encoding="utf-8"))
        for island in data.get("islands") or []:
            island_name = island.get("name") or "Hawaiʻi"
            for loc in island.get("locations") or []:
                try:
                    lat = float(loc["lat"])
                    lon = float(loc["lon"])
                except Exception:
                    continue
                name = str(loc.get("name") or "").strip()
                if not name:
                    continue
                add({
                    "external_id": f"us-hi-{slugify(island_name)}-{loc.get('slug') or slugify(name)}",
                    "name": name,
                    "slug": loc.get("slug") or slugify(name),
                    "lat": lat,
                    "lon": lon,
                    "country_code": "US",
                    "admin1_code": "HI",
                    "admin1_name": "Hawaii",
                    "region": island_name,
                    "island": island_name,
                })

    rows.sort(key=lambda r: (r["admin1_code"], r["name"]))
    return rows


def ensure_db(conn: sqlite3.Connection) -> None:
    c = conn.cursor()
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS meta (
            k TEXT PRIMARY KEY,
            v TEXT
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS locations (
            id INTEGER PRIMARY KEY,
            island TEXT,
            name TEXT,
            lat REAL,
            lon REAL,
            country_code TEXT DEFAULT 'US',
            admin1_code TEXT,
            region TEXT,
            external_id TEXT,
            UNIQUE(island, name)
        )
        """
    )
    for col, definition in (
        ("country_code", "TEXT"),
        ("admin1_code", "TEXT"),
        ("region", "TEXT"),
        ("external_id", "TEXT"),
    ):
        try:
            c.execute(f"ALTER TABLE locations ADD COLUMN {col} {definition}")
        except sqlite3.OperationalError:
            pass
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS weather (
            id INTEGER PRIMARY KEY,
            location_id INTEGER,
            provider TEXT,
            obs_ts TEXT,
            forecast_from TEXT,
            forecast_to TEXT,
            ts_utc TEXT,
            raw TEXT,
            temp_c REAL,
            wind_kph REAL,
            wind_deg REAL,
            precipitation_mm REAL,
            humidity_pct REAL,
            cloud_pct REAL,
            created_at TEXT,
            updated_at TEXT,
            UNIQUE(location_id, provider, obs_ts)
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS daily_sun (
            id INTEGER PRIMARY KEY,
            location_id INTEGER,
            date TEXT,
            sunrise TEXT,
            sunset TEXT,
            UNIQUE(location_id, date)
        )
        """
    )
    c.execute("CREATE INDEX IF NOT EXISTS idx_weather_location ON weather(location_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_locations_admin1 ON locations(admin1_code)")
    conn.commit()


def meta_get(conn: sqlite3.Connection, key: str) -> Optional[str]:
    row = conn.execute("SELECT v FROM meta WHERE k=?", (key,)).fetchone()
    return row[0] if row else None


def meta_set(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
        (key, value),
    )
    conn.commit()


def save_location(conn: sqlite3.Connection, loc: Dict[str, Any]) -> int:
    island = loc.get("island") or loc.get("region") or loc["admin1_code"]
    name = loc["name"]
    cur = conn.execute(
        "SELECT id FROM locations WHERE island=? AND name=?",
        (island, name),
    )
    row = cur.fetchone()
    if row:
        conn.execute(
            """
            UPDATE locations
            SET lat=?, lon=?, country_code=?, admin1_code=?, region=?, external_id=COALESCE(?, external_id)
            WHERE id=?
            """,
            (
                loc["lat"], loc["lon"], loc["country_code"], loc["admin1_code"],
                loc.get("region") or island, loc.get("external_id"), row[0],
            ),
        )
        conn.commit()
        return int(row[0])
    cur = conn.execute(
        """
        INSERT INTO locations (island, name, lat, lon, country_code, admin1_code, region, external_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            island, name, loc["lat"], loc["lon"], loc["country_code"],
            loc["admin1_code"], loc.get("region") or island, loc.get("external_id"),
        ),
    )
    conn.commit()
    return int(cur.lastrowid)


def acquire_lock() -> bool:
    try:
        fd = os.open(str(LOCK_PATH), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        return True
    except FileExistsError:
        try:
            age = time.time() - LOCK_PATH.stat().st_mtime
            if age > 2 * 3600:
                LOCK_PATH.unlink(missing_ok=True)
                return acquire_lock()
        except Exception:
            pass
        return False


def release_lock() -> None:
    try:
        LOCK_PATH.unlink(missing_ok=True)
    except Exception:
        pass


def fetch_with_retry(url: str, headers=None, params=None, verbose=False):
    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            status, text, _ = http_get(url, headers=headers, params=params)
            return json.loads(text), None
        except Exception as e:
            last_err = e
            time.sleep(RETRY_BASE * (2 ** attempt))
            if verbose:
                print(f"  retry {attempt+1}/{MAX_RETRIES}: {e}")
    return None, str(last_err)


def fetch_open_meteo(lat: float, lon: float, verbose=False):
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,relative_humidity_2m,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m",
        "daily": "sunrise,sunset",
        "timezone": "auto",
        "forecast_days": 1,
    }
    return fetch_with_retry(url, params=params, verbose=verbose)


def parse_open_meteo(obj: dict):
    cur = obj.get("current") or {}
    daily = obj.get("daily") or {}
    obs_ts = cur.get("time")
    temp_c = cur.get("temperature_2m")
    humidity = cur.get("relative_humidity_2m")
    precip = cur.get("precipitation")
    cloud = cur.get("cloud_cover")
    wind_kph = cur.get("wind_speed_10m")
    wind_deg = cur.get("wind_direction_10m")
    sunrise = (daily.get("sunrise") or [None])[0]
    sunset = (daily.get("sunset") or [None])[0]
    sun_date = None
    if sunrise:
        sun_date = str(sunrise)[:10]
    return obs_ts, temp_c, wind_kph, wind_deg, precip, humidity, cloud, sunrise, sunset, sun_date


def fetch_noaa_nws(lat: float, lon: float, verbose=False):
    headers = {"User-Agent": NWS_USER_AGENT, "Accept": "application/geo+json"}
    points_url = f"https://api.weather.gov/points/{lat:.4f},{lon:.4f}"
    points, err = fetch_with_retry(points_url, headers=headers, verbose=verbose)
    if not points:
        return None, err or "points failed"
    props = points.get("properties") or {}
    stations_url = props.get("observationStations")
    if not stations_url:
        return None, "no observationStations"
    stations, err = fetch_with_retry(stations_url, headers=headers, verbose=verbose)
    if not stations:
        return None, err or "stations failed"
    features = stations.get("features") or []
    if not features:
        return None, "no stations"
    station_id = (features[0].get("properties") or {}).get("stationIdentifier")
    if not station_id:
        # try id from feature id URL
        sid = features[0].get("id") or ""
        station_id = sid.rstrip("/").split("/")[-1]
    obs_url = f"https://api.weather.gov/stations/{station_id}/observations/latest"
    obs, err = fetch_with_retry(obs_url, headers=headers, verbose=verbose)
    return obs, err


def parse_nws(obj: dict):
    props = obj.get("properties") or {}
    obs_ts = props.get("timestamp")
    def c_from(val):
        if not isinstance(val, dict):
            return None
        v = val.get("value")
        unit = str(val.get("unitCode") or "")
        if v is None:
            return None
        if "degC" in unit or unit.endswith(":degC"):
            return float(v)
        if "degF" in unit or unit.endswith(":degF"):
            return (float(v) - 32) * 5 / 9
        return float(v)
    temp_c = c_from(props.get("temperature") or {})
    humidity = None
    rh = props.get("relativeHumidity") or {}
    if isinstance(rh, dict) and rh.get("value") is not None:
        humidity = float(rh["value"])
    wind_kph = None
    wind = props.get("windSpeed") or {}
    if isinstance(wind, dict) and wind.get("value") is not None:
        unit = str(wind.get("unitCode") or "")
        v = float(wind["value"])
        if "km_h" in unit or "km/h" in unit:
            wind_kph = v
        elif "m_s" in unit:
            wind_kph = v * 3.6
        elif "mi_h" in unit or "mph" in unit:
            wind_kph = v * 1.60934
        else:
            wind_kph = v
    wind_deg = None
    wd = props.get("windDirection") or {}
    if isinstance(wd, dict) and wd.get("value") is not None:
        wind_deg = float(wd["value"])
    return obs_ts, temp_c, wind_kph, wind_deg, humidity


def upsert_weather(
    conn, location_id, provider, obs_ts, forecast_from, forecast_to, raw_obj,
    temp_c, wind_kph, wind_deg, precipitation_mm, humidity_pct, cloud_pct, dry_run=False,
):
    key_obs = obs_ts or datetime.now(timezone.utc).isoformat()
    now = datetime.now(timezone.utc).isoformat()
    raw = json.dumps(raw_obj)[:200000]
    cur = conn.execute(
        "SELECT id FROM weather WHERE location_id=? AND provider=? AND obs_ts=?",
        (location_id, provider, key_obs),
    )
    row = cur.fetchone()
    if dry_run:
        return (row is None, row is not None)
    if row:
        conn.execute(
            """
            UPDATE weather SET ts_utc=?, raw=?, temp_c=?, wind_kph=?, wind_deg=?,
              precipitation_mm=?, humidity_pct=?, cloud_pct=?, updated_at=?
            WHERE id=?
            """,
            (now, raw, temp_c, wind_kph, wind_deg, precipitation_mm, humidity_pct, cloud_pct, now, row[0]),
        )
        conn.commit()
        return False, True
    conn.execute(
        """
        INSERT INTO weather (
          location_id, provider, obs_ts, forecast_from, forecast_to, ts_utc, raw,
          temp_c, wind_kph, wind_deg, precipitation_mm, humidity_pct, cloud_pct,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            location_id, provider, key_obs, forecast_from, forecast_to, now, raw,
            temp_c, wind_kph, wind_deg, precipitation_mm, humidity_pct, cloud_pct, now, now,
        ),
    )
    conn.commit()
    return True, False


def upsert_daily_sun(conn, location_id, sunrise, sunset, sun_date, dry_run=False):
    if not sun_date:
        return False, False
    cur = conn.execute(
        "SELECT id FROM daily_sun WHERE location_id=? AND date=?",
        (location_id, sun_date),
    )
    row = cur.fetchone()
    if dry_run:
        return (row is None, row is not None)
    if row:
        conn.execute(
            "UPDATE daily_sun SET sunrise=?, sunset=? WHERE id=?",
            (sunrise, sunset, row[0]),
        )
        conn.commit()
        return False, True
    conn.execute(
        "INSERT INTO daily_sun (location_id, date, sunrise, sunset) VALUES (?, ?, ?, ?)",
        (location_id, sun_date, sunrise, sunset),
    )
    conn.commit()
    return True, False


def run_once(force=False, dry_run=False, verbose=False, only_state: Optional[str] = None):
    locations = load_locations()
    if only_state:
        code = state_code(only_state) or only_state.upper()
        locations = [x for x in locations if x["admin1_code"] == code]

    if verbose:
        print(f"Locations to collect: {len(locations)}")
        by = {}
        for x in locations:
            by[x["admin1_code"]] = by.get(x["admin1_code"], 0) + 1
        print("By state:", dict(sorted(by.items())))

    if not locations:
        print("No US locations found in global-locations.json / hawaii-locations.json")
        return 1

    DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=60)
    try:
        ensure_db(conn)
        last = meta_get(conn, "us_last_run")
        last_ts = float(last) if last else 0.0
        now_ts = time.time()
        if not force and (now_ts - last_ts) < MIN_SECONDS_BETWEEN_RUNS:
            if verbose:
                print(f"Skipping: last run {int(now_ts - last_ts)}s ago")
            return 0

        if not dry_run and not acquire_lock():
            if verbose:
                print("Another collector holds the lock")
            return 0

        total_new = total_updated = total_errors = 0
        try:
            for loc in locations:
                if verbose:
                    print(f"{loc['admin1_code']} · {loc['name']}")
                loc_id = save_location(conn, loc)

                om, om_err = fetch_open_meteo(loc["lat"], loc["lon"], verbose=verbose)
                time.sleep(PER_REQUEST_DELAY)
                if om:
                    obs_ts, temp_c, wind_kph, wind_deg, precip, humidity, cloud, sunrise, sunset, sun_date = parse_open_meteo(om)
                    ins, upd = upsert_weather(
                        conn, loc_id, "open-meteo", obs_ts, None, None, om,
                        temp_c, wind_kph, wind_deg, precip, humidity, cloud, dry_run=dry_run,
                    )
                    total_new += int(ins)
                    total_updated += int(upd)
                    upsert_daily_sun(conn, loc_id, sunrise, sunset, sun_date, dry_run=dry_run)
                else:
                    total_errors += 1
                    if verbose:
                        print(f"  open-meteo error: {om_err}")

                nws, nws_err = fetch_noaa_nws(loc["lat"], loc["lon"], verbose=verbose)
                time.sleep(PER_REQUEST_DELAY)
                if nws:
                    n_obs, n_temp, n_wind, n_deg, n_hum = parse_nws(nws)
                    ins, upd = upsert_weather(
                        conn, loc_id, "nws", n_obs, None, None, nws,
                        n_temp, n_wind, n_deg, None, n_hum, None, dry_run=dry_run,
                    )
                    total_new += int(ins)
                    total_updated += int(upd)
                else:
                    total_errors += 1
                    if verbose:
                        print(f"  nws error: {nws_err}")

            if not dry_run:
                meta_set(conn, "us_last_run", str(now_ts))
                meta_set(conn, "us_last_successful_run", datetime.now(timezone.utc).isoformat())
            print(f"US weather run: locations={len(locations)} new={total_new} updated={total_updated} errors={total_errors}")
        finally:
            if not dry_run:
                release_lock()
    finally:
        conn.close()
    return 0


def main():
    import argparse
    p = argparse.ArgumentParser(description="Collect US weather into weather.db")
    p.add_argument("--force", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--verbose", action="store_true")
    p.add_argument("--state", help="Only one state code or name (e.g. CA or California)")
    args = p.parse_args()
    raise SystemExit(run_once(force=args.force, dry_run=args.dry_run, verbose=args.verbose, only_state=args.state))


if __name__ == "__main__":
    main()

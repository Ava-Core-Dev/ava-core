#!/usr/bin/env python3
"""Ava location weather poller."""
from pathlib import Path
import json, sqlite3, urllib.parse, urllib.request, datetime as dt

HERE=Path(__file__).resolve().parent
META=json.loads((HERE/'location.json').read_text(encoding='utf-8'))
ROOT=HERE.parents[4]
if META['country_code']=='US':
    LOCAL_DB=ROOT/'database/locations'/'us'/META['admin1_slug']/META['slug']/'weather.db'
else:
    LOCAL_DB=ROOT/'database/locations'/META['country_code'].lower()/META['country_slug']/META['slug']/'weather.db'
GLOBAL_DB=ROOT/'database/weather.db'
CHECKPOINT=dt.date(2026,3,31)
PROVIDER='open-meteo'
SCHEMA=(
"CREATE TABLE IF NOT EXISTS weather (id INTEGER PRIMARY KEY AUTOINCREMENT, obs_ts TEXT NOT NULL, location_id TEXT NOT NULL, provider TEXT NOT NULL, temp_c REAL, humidity_pct REAL, wind_kph REAL, precipitation_mm REAL, UNIQUE(obs_ts, location_id, provider));"
"CREATE INDEX IF NOT EXISTS idx_weather_ts ON weather(obs_ts);"
"CREATE INDEX IF NOT EXISTS idx_weather_location ON weather(location_id);"
"CREATE TABLE IF NOT EXISTS poller_state (key TEXT PRIMARY KEY, value TEXT);"
)
def db(path):
    path.parent.mkdir(parents=True,exist_ok=True); c=sqlite3.connect(path); c.executescript(SCHEMA); return c
def get_json(url):
    req=urllib.request.Request(url,headers={'User-Agent':'Ava-Ivy/1.0 weather-poller'})
    with urllib.request.urlopen(req,timeout=20) as r: return json.load(r)
def insert(c,row):
    c.execute('INSERT OR IGNORE INTO weather(obs_ts,location_id,provider,temp_c,humidity_pct,wind_kph,precipitation_mm) VALUES(?,?,?,?,?,?,?)',row)
def current():
    q=urllib.parse.urlencode({'latitude':META['lat'],'longitude':META['lon'],'current':'temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation','timezone':'UTC'})
    d=get_json('https://api.open-meteo.com/v1/forecast?'+q); x=d.get('current',{}); ts=x.get('time')
    return [(ts,META['id'],PROVIDER,x.get('temperature_2m'),x.get('relative_humidity_2m'),x.get('wind_speed_10m'),x.get('precipitation'))] if ts else []
def backfill(c):
    now=dt.datetime.now(dt.timezone.utc)
    row=c.execute("SELECT value FROM poller_state WHERE key='backfill_date'").fetchone()
    cursor=dt.date.fromisoformat(row[0]) if row else CHECKPOINT
    yesterday=now.date()-dt.timedelta(days=1)
    if cursor>yesterday: return 0
    start=cursor; end=min(yesterday,start+dt.timedelta(days=1))
    q=urllib.parse.urlencode({'latitude':META['lat'],'longitude':META['lon'],'start_date':start.isoformat(),'end_date':end.isoformat(),'hourly':'temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation','timezone':'UTC'})
    d=get_json('https://archive-api.open-meteo.com/v1/archive?'+q); h=d.get('hourly',{}); times=h.get('time',[]); n=0
    for i,ts in enumerate(times):
        row=(ts,META['id'],PROVIDER,*(h.get(k,[None]*len(times))[i] for k in ('temperature_2m','relative_humidity_2m','wind_speed_10m','precipitation'))); insert(c,row); n+=1
    c.execute("INSERT INTO poller_state(key,value) VALUES('backfill_date',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",((end+dt.timedelta(days=1)).isoformat(),))
    return n

def main():
    local=db(LOCAL_DB); glob=db(GLOBAL_DB); added=0
    try:
        glob.execute("INSERT INTO locations(id,country_code,admin1_code,region,name,lat,lon) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET country_code=excluded.country_code, admin1_code=excluded.admin1_code, region=excluded.region, name=excluded.name, lat=excluded.lat, lon=excluded.lon", (META['id'], META['country_code'], META.get('admin1_code') or None, META.get('region') or None, META['name'], META['lat'], META['lon']))
        added=backfill(local); rows=current()
        for row in rows: insert(local,row); insert(glob,row)
        local.commit(); glob.commit(); print(json.dumps({'ok':True,'location':META['id'],'backfilled':added,'current':len(rows)}))
    finally: local.close(); glob.close()
if __name__=='__main__': main()

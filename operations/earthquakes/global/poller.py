#!/usr/bin/env python3
"""Ava global earthquake collector. Source: USGS GeoJSON."""
from pathlib import Path
import json, sqlite3, urllib.request, math
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
CONFIG=ROOT/"config/locations/global-locations.json"
DB=ROOT/"database/earthquakes.db"
URL="https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson"
def fetch():
    req=urllib.request.Request(URL,headers={"User-Agent":"Ava-Ivy/1.0 earthquake-poller"})
    with urllib.request.urlopen(req,timeout=20) as r: return json.load(r)
def nearest(event, locations):
    best=None; bestd=10**9
    lat,lon=event
    for x in locations:
        p,q=x.get("lat"),x.get("lon")
        if p is None or q is None: continue
        a=math.radians(lat); b=math.radians(p); da=math.radians(p-lat); db=math.radians(q-lon)
        h=math.sin(da/2)**2+math.cos(a)*math.cos(b)*math.sin(db/2)**2
        d=6371*2*math.asin(min(1,math.sqrt(h)))
        if d<bestd: bestd=d; best=x
    return best if bestd<=250 else None
def main():
    locations=json.loads(CONFIG.read_text())["locations"]
    c=sqlite3.connect(DB); c.executescript("CREATE TABLE IF NOT EXISTS earthquakes (event_id TEXT PRIMARY KEY, observed_at TEXT, magnitude REAL, depth_km REAL, place TEXT, lat REAL, lon REAL, source_url TEXT, country_code TEXT, admin1_code TEXT, location_id TEXT); CREATE INDEX IF NOT EXISTS idx_eq_observed ON earthquakes(observed_at); CREATE INDEX IF NOT EXISTS idx_eq_mag ON earthquakes(magnitude);")
    data=fetch(); n=0
    for f in data.get("features",[]):
        p=f.get("properties") or {}; g=f.get("geometry") or {}; co=g.get("coordinates") or []
        if len(co)<2: continue
        lon,lat=co[0],co[1]; depth=(co[2]/1 if len(co)>2 and co[2] is not None else None); loc=nearest((lat,lon),locations)
        admin=loc.get("admin1_code") if loc else None; cc=loc.get("country_code") if loc else None; lid=loc.get("id") if loc else None
        c.execute("INSERT OR REPLACE INTO earthquakes(event_id,observed_at,magnitude,depth_km,place,lat,lon,source_url,country_code,admin1_code,location_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)",(f.get("id"),p.get("time"),p.get("mag"),depth,p.get("place"),lat,lon,p.get("url"),cc,admin,lid)); n+=1
    c.commit(); c.close(); print(json.dumps({"ok":True,"events_seen":n}))
if __name__=="__main__": main()

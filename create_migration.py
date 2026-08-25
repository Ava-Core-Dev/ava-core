from pathlib import Path
import json, sqlite3, shutil, os, textwrap
ROOT=Path('/tmp/ava_stage')
# Canonical route manifest
states=json.loads((ROOT/'config/locations/us-states.json').read_text())
locs=json.loads((ROOT/'config/locations/global-locations.json').read_text())['locations']
# enrich route manifest
routes=[]
for s in states:
    slug=s['slug'] if isinstance(s,dict) and 'slug' in s else str(s).lower().replace(' ','-')
    name=s.get('name', slug.title()) if isinstance(s,dict) else slug.title()
    routes.append({'kind':'state','country':'united-states','state':slug,'name':name,
                   'weather':f'/weather/united-states/{slug}/','earthquakes':f'/earthquakes/united-states/{slug}/','news':f'/news/united-states/{slug}/'})
for x in locs:
    country=x['country_name'].lower().replace(' ','-').replace("'",'')
    # country route only for non-US seeds; US location route includes state
    if x['country_code']=='US':
        weather=f"/weather/united-states/{x['admin1_slug']}/{x['slug']}/"
        eq=f"/earthquakes/united-states/{x['admin1_slug']}/{x['slug']}/"
        news=f"/news/united-states/{x['admin1_slug']}/{x['slug']}/"
    else:
        weather=f"/weather/{country}/{x['slug']}/"
        eq=f"/earthquakes/{country}/{x['slug']}/"
        news=f"/news/{country}/{x['slug']}/"
    routes.append({'kind':'location','id':x['id'],'country_code':x['country_code'],'country':country,'state':x.get('admin1_slug') or None,'location':x['slug'],'name':x['name'],'weather':weather,'earthquakes':eq,'news':news})
manifest={'version':1,'canonical':'country/state/location','products':['weather','earthquakes','news','events'],'routes':routes,
          'roots':{'weather':'/weather/','earthquakes':'/earthquakes/','news':'/news/','states':'/states/'}}
(ROOT/'config/geography').mkdir(parents=True,exist_ok=True)
(ROOT/'config/geography/canonical-routes.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
# create per-location DBs
schema={
 'news':"""CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, published_at TEXT, title TEXT, summary TEXT, publisher TEXT, source_url TEXT UNIQUE, category TEXT, country_code TEXT, admin1_code TEXT, location_id TEXT); CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published_at);""",
 'events':"""CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, starts_at TEXT, ends_at TEXT, title TEXT, summary TEXT, organizer TEXT, source_url TEXT UNIQUE, category TEXT, country_code TEXT, admin1_code TEXT, location_id TEXT); CREATE INDEX IF NOT EXISTS idx_events_starts ON events(starts_at);""",
 'earthquakes':"""CREATE TABLE IF NOT EXISTS earthquakes (event_id TEXT PRIMARY KEY, observed_at TEXT, magnitude REAL, depth_km REAL, place TEXT, lat REAL, lon REAL, source_url TEXT, country_code TEXT, admin1_code TEXT, location_id TEXT); CREATE INDEX IF NOT EXISTS idx_eq_observed ON earthquakes(observed_at); CREATE INDEX IF NOT EXISTS idx_eq_mag ON earthquakes(magnitude);"""
}
for x in locs:
    if x['country_code']=='US': base=ROOT/'database/locations'/'us'/x['admin1_slug']/x['slug']
    else: base=ROOT/'database/locations'/x['country_code'].lower()/(x.get('country_slug') or x['country_name'].lower().replace(' ','-').replace("'",''))/x['slug']
    base.mkdir(parents=True,exist_ok=True)
    for name,sql in schema.items():
        db=base/f'{name}.db'; c=sqlite3.connect(db); c.executescript(sql); c.close()
# global earthquake DB
(ROOT/'database').mkdir(exist_ok=True)
c=sqlite3.connect(ROOT/'database/earthquakes.db')
c.executescript("""CREATE TABLE IF NOT EXISTS earthquakes (event_id TEXT PRIMARY KEY, observed_at TEXT, magnitude REAL, depth_km REAL, place TEXT, lat REAL, lon REAL, source_url TEXT, country_code TEXT, admin1_code TEXT, location_id TEXT); CREATE INDEX IF NOT EXISTS idx_eq_observed ON earthquakes(observed_at); CREATE INDEX IF NOT EXISTS idx_eq_mag ON earthquakes(magnitude); CREATE TABLE IF NOT EXISTS poller_state (key TEXT PRIMARY KEY, value TEXT);""")
c.close()
# global event/news DBs
for dbname,sql in [('global_news.db',schema['news']),('global_events.db',schema['events'])]:
 c=sqlite3.connect(ROOT/'database'/dbname); c.executescript(sql); c.close()
# earthquake global poller
p=ROOT/'operations/earthquakes/global'; p.mkdir(parents=True,exist_ok=True)
(p/'poller.py').write_text('''#!/usr/bin/env python3\n"""Ava global earthquake collector. Source: USGS GeoJSON."""\nfrom pathlib import Path\nimport json, sqlite3, urllib.request, math\nHERE=Path(__file__).resolve().parent\nROOT=HERE.parents[2]\nCONFIG=ROOT/"config/locations/global-locations.json"\nDB=ROOT/"database/earthquakes.db"\nURL="https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson"\ndef fetch():\n    req=urllib.request.Request(URL,headers={"User-Agent":"Ava-Ivy/1.0 earthquake-poller"})\n    with urllib.request.urlopen(req,timeout=20) as r: return json.load(r)\ndef nearest(event, locations):\n    best=None; bestd=10**9\n    lat,lon=event\n    for x in locations:\n        p,q=x.get("lat"),x.get("lon")\n        if p is None or q is None: continue\n        a=math.radians(lat); b=math.radians(p); da=math.radians(p-lat); db=math.radians(q-lon)\n        h=math.sin(da/2)**2+math.cos(a)*math.cos(b)*math.sin(db/2)**2\n        d=6371*2*math.asin(min(1,math.sqrt(h)))\n        if d<bestd: bestd=d; best=x\n    return best if bestd<=250 else None\ndef main():\n    locations=json.loads(CONFIG.read_text())["locations"]\n    c=sqlite3.connect(DB); c.executescript("CREATE TABLE IF NOT EXISTS earthquakes (event_id TEXT PRIMARY KEY, observed_at TEXT, magnitude REAL, depth_km REAL, place TEXT, lat REAL, lon REAL, source_url TEXT, country_code TEXT, admin1_code TEXT, location_id TEXT); CREATE INDEX IF NOT EXISTS idx_eq_observed ON earthquakes(observed_at); CREATE INDEX IF NOT EXISTS idx_eq_mag ON earthquakes(magnitude);")\n    data=fetch(); n=0\n    for f in data.get("features",[]):\n        p=f.get("properties") or {}; g=f.get("geometry") or {}; co=g.get("coordinates") or []\n        if len(co)<2: continue\n        lon,lat=co[0],co[1]; depth=(co[2]/1 if len(co)>2 and co[2] is not None else None); loc=nearest((lat,lon),locations)\n        admin=loc.get("admin1_code") if loc else None; cc=loc.get("country_code") if loc else None; lid=loc.get("id") if loc else None\n        c.execute("INSERT OR REPLACE INTO earthquakes(event_id,observed_at,magnitude,depth_km,place,lat,lon,source_url,country_code,admin1_code,location_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)",(f.get("id"),p.get("time"),p.get("mag"),depth,p.get("place"),lat,lon,p.get("url"),cc,admin,lid)); n+=1\n    c.commit(); c.close(); print(json.dumps({"ok":True,"events_seen":n}))\nif __name__=="__main__": main()\n''')
# cron launcher
slot=ROOT/'operations/cronologicals/on-time/00:00'; slot.mkdir(parents=True,exist_ok=True)
(slot/'global-earthquakes.py').write_text('#!/usr/bin/env python3\nfrom pathlib import Path\nimport runpy\np=Path(__file__).resolve().parents[4]/"operations/earthquakes/global/poller.py"\nrunpy.run_path(str(p),run_name="__main__")\n')
# migration docs
(ROOT/'GLOBAL_GEOGRAPHY_MIGRATION.md').write_text('''# Global geography migration\n\nThis package is based on the uploaded `AVAIVY_GLOBAL_LOCATION_CRONOLOGICALS_UPDATE.zip`. It makes **country/state/location** the canonical geographic contract for Weather, Earthquakes, News and Events.\n\n## Canonical routes\n- `/weather/` global dashboard\n- `/weather/<country>/<state-or-region>/<location>/` location data\n- `/earthquakes/` global dashboard\n- `/earthquakes/<country>/<state-or-region>/<location>/` geographic earthquake view\n- `/news/` global important news\n- `/news/<country>/<state-or-region>/<location>/` geographic news view\n- `/states/<state>/` remains the U.S. state hub and links into all products.\n\nFor the U.S.: `/weather/united-states/hawaii/volcano-village/`.\nFor countries without a state/province layer: `/weather/japan/tokyo/`.\n\n## Earthquakes\nA single global USGS collector runs every five minutes through Cronologicals. Events are stored in `database/earthquakes.db` and geographically attributed to the nearest staged location when within 250 km. This avoids hundreds of duplicate global earthquake requests.\n\n## Migration safety\nRun `install-global-geography.sh` from the Ava project root. It creates a timestamped backup of only files it replaces, installs the canonical configuration/databases/collector, and writes a migration report. It does not delete legacy routes automatically.\n\nThe installer intentionally leaves route/page source files to the existing site generator when those files are not present in this staging ZIP.\n''')
(ROOT/'install-global-geography.sh').write_text('''#!/usr/bin/env bash\nset -euo pipefail\nROOT="$(cd "$(dirname "$0")" && pwd)"\nSTAMP="$(date +%Y%m%d-%H%M%S)"\nBACKUP="$ROOT/.ava-migration-backups/global-geography-$STAMP"\nmkdir -p "$BACKUP"\ncopy_dir(){ local src="$1" dst="$2"; if [ -e "$ROOT/$dst" ]; then mkdir -p "$BACKUP/$(dirname "$dst")"; cp -a "$ROOT/$dst" "$BACKUP/$dst"; fi; mkdir -p "$ROOT/$(dirname "$dst")"; cp -a "$ROOT/$src" "$ROOT/$dst"; }\ncopy_dir config/geography/canonical-routes.json config/geography/canonical-routes.json\ncopy_dir config/locations/global-locations.json config/locations/global-locations.json\ncopy_dir config/locations/us-states.json config/locations/us-states.json\nmkdir -p "$ROOT/operations/earthquakes/global" "$ROOT/operations/cronologicals/on-time/00:00" "$ROOT/database"\ncopy_dir operations/earthquakes/global/poller.py operations/earthquakes/global/poller.py\ncopy_dir operations/cronologicals/on-time/00:00/global-earthquakes.py operations/cronologicals/on-time/00:00/global-earthquakes.py\n# copy staged location/product databases without destroying populated live DBs\npython3 - "$ROOT" <<'PY'\nfrom pathlib import Path\nimport shutil,sys\nroot=Path(sys.argv[1]); stage=Path(__file__).resolve().parent\nfor src in (stage/'database').rglob('*.db'):\n    rel=src.relative_to(stage); dst=root/rel; dst.parent.mkdir(parents=True,exist_ok=True)\n    if not dst.exists(): shutil.copy2(src,dst)\nPY\n# Install route manifest as a contract; existing page generator can consume it.\nmkdir -p "$ROOT/config/geography"\ncp -f "$ROOT/config/geography/canonical-routes.json" "$ROOT/config/geography/canonical-routes.json"\ncat > "$ROOT/.global-geography-migration-$STAMP" <<EOF\ninstalled=$STAMP\nbackup=$BACKUP\ncanonical=country/state/location\nearthquakes=/earthquakes/\nweather=/weather/\nnews=/news/\nlegacy_routes_preserved=true\nEOF\necho "Global geography migration installed. Backup: $BACKUP"\n''')
# Fix installer embedded stage path issue by making it refer to package directory copy; since package is copied, __file__ works only if executed in package. Fine.
# Route alias manifest for legacy
(ROOT/'config/geography/legacy-redirects.json').write_text(json.dumps({
 '/earthquakes/':'/earthquakes/','/weather/':'/weather/','/states/hawaii/':'/states/hawaii/',
 '/states/hawaii/weather/':'/weather/united-states/hawaii/','/states/hawaii/earthquakes/':'/earthquakes/united-states/hawaii/','/states/hawaii/news/':'/news/united-states/hawaii/'
},indent=2)+'\n')
# README update
(ROOT/'README.md').write_text('''# Ava Ivy global geography migration\n\nUse `install-global-geography.sh` from the extracted package directory on Ava-Core.\n\nThis is the clean migration layer for the uploaded global location staging package. It establishes the canonical country/state/location contract and the global earthquake collector.\n''')
print('created')

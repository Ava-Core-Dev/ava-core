#!/usr/bin/env python3
"""Build Ava Ivy's public news index from collected source databases.

State databases remain source-isolated.  This builder only aggregates already
collected records; it does not synthesize or invent stories.  Collection health
is exported alongside the index so an empty state is diagnosable instead of
looking like a filtering problem.
"""
from pathlib import Path
import json
import sqlite3
import time

ROOT = Path(__file__).resolve().parents[2]
DBROOT = ROOT / 'database'
OUT = ROOT / 'web/sites/avaivy.cloud/data/global-news.json'
LOCATIONS = ROOT / 'config/locations/global-locations.json'

DISPLAY = {
    'new-york': 'New York', 'new-jersey': 'New Jersey',
    'north-carolina': 'North Carolina', 'south-carolina': 'South Carolina',
    'north-dakota': 'North Dakota', 'south-dakota': 'South Dakota',
    'west-virginia': 'West Virginia', 'new-mexico': 'New Mexico',
    'rhode-island': 'Rhode Island', 'new-hampshire': 'New Hampshire',
}
for p in (DBROOT / 'states').glob('*'):
    if p.is_dir():
        DISPLAY.setdefault(p.name, p.name.replace('-', ' ').title())

STATE_CODES = {
    'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA','Colorado':'CO',
    'Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA','Hawaii':'HI','Idaho':'ID',
    'Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS','Kentucky':'KY','Louisiana':'LA',
    'Maine':'ME','Maryland':'MD','Massachusetts':'MA','Michigan':'MI','Minnesota':'MN',
    'Mississippi':'MS','Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV',
    'New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC',
    'North Dakota':'ND','Ohio':'OH','Oklahoma':'OK','Oregon':'OR','Pennsylvania':'PA',
    'Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD','Tennessee':'TN','Texas':'TX',
    'Utah':'UT','Vermont':'VT','Virginia':'VA','Washington':'WA','West Virginia':'WV',
    'Wisconsin':'WI','Wyoming':'WY'
}
REGION = {
    'AL':'south','AK':'north-america','AZ':'southwest','AR':'south','CA':'west','CO':'west',
    'CT':'northeast','DE':'northeast','FL':'south','GA':'south','HI':'pacific','ID':'west',
    'IL':'midwest','IN':'midwest','IA':'midwest','KS':'midwest','KY':'south','LA':'south',
    'ME':'northeast','MD':'northeast','MA':'northeast','MI':'midwest','MN':'midwest','MS':'south',
    'MO':'midwest','MT':'west','NE':'midwest','NV':'west','NH':'northeast','NJ':'northeast',
    'NM':'southwest','NY':'northeast','NC':'south','ND':'midwest','OH':'midwest','OK':'south',
    'OR':'west','PA':'northeast','RI':'northeast','SC':'south','SD':'midwest','TN':'south',
    'TX':'south','UT':'west','VT':'northeast','VA':'south','WA':'west','WV':'south','WI':'midwest','WY':'west'
}
WEIGHTS = {
    'emergency':100,'hazards':100,'health':85,'government':80,'science':70,
    'environment':70,'infrastructure':65,'utilities':65,'education':55,
    'business':50,'community':45,'culture':45,'events':35
}


def score(category):
    c = (category or 'general').lower()
    for key, weight in WEIGHTS.items():
        if key in c:
            return weight
    return 40


def parse_ts(v):
    if not v:
        return 0
    try:
        return int(time.mktime(time.strptime(v[:19], '%Y-%m-%dT%H:%M:%S')))
    except Exception:
        try:
            return int(time.mktime(time.strptime(v[:10], '%Y-%m-%d')))
        except Exception:
            return 0


def read_db(path, state_slug=None):
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    posts, events = [], []
    try:
        rows = con.execute('select p.*, s.publisher from posts p left join sources s on p.source_id=s.source_id')
        for r in rows:
            st = DISPLAY.get(state_slug, '') if state_slug else (r['state'] or '')
            code = STATE_CODES.get(st)
            posts.append({
                'title': r['title'], 'summary': r['summary'], 'link': r['url'],
                'published_label': r['published_at'], 'published_ts': parse_ts(r['published_at']),
                'category': r['category'] or 'general',
                'category_label': (r['category'] or 'General').replace('-', ' ').title(),
                'source_id': r['source_id'], 'source': r['publisher'] or r['source_id'] or 'Source',
                'country_code': 'US', 'region': REGION.get(code, 'north-america'),
                'state_code': code, 'state_name': st or None, 'location': None,
                'importance': score(r['category'])
            })
        rows = con.execute('select e.*, s.publisher from events e left join sources s on e.source_id=s.source_id')
        for r in rows:
            st = DISPLAY.get(state_slug, '') if state_slug else ''
            code = STATE_CODES.get(st)
            events.append({
                'title': r['title'], 'description': r['description'], 'link': r['url'],
                'start_label': r['start_at'], 'start_ts': parse_ts(r['start_at']),
                'location': r['location'], 'type': r['category'] or 'Event',
                'source': r['publisher'] or r['source_id'] or 'Source',
                'state_code': code, 'state_name': st or None, 'country_code': 'US',
                'region': REGION.get(code, 'north-america')
            })
    finally:
        con.close()
    return posts, events


def db_health(path):
    result = {'database': str(path), 'posts': 0, 'events': 0, 'sources': 0, 'source_health': {}}
    try:
        con = sqlite3.connect(path)
        result['posts'] = con.execute('select count(*) from posts').fetchone()[0]
        result['events'] = con.execute('select count(*) from events').fetchone()[0]
        result['sources'] = con.execute('select count(*) from sources').fetchone()[0]
        try:
            for status, count in con.execute('select status,count(*) from source_health group by status'):
                result['source_health'][status] = count
        except sqlite3.Error:
            pass
        con.close()
    except sqlite3.Error as exc:
        result['error'] = str(exc)
    return result


items, ev, health = [], [], []
state_dir = DBROOT / 'states'
if state_dir.exists():
    for d in sorted(state_dir.iterdir()):
        if not d.is_dir():
            continue
        dbs = list(d.glob('*_news.db'))
        if not dbs:
            health.append({'state': d.name, 'database': None, 'posts': 0, 'events': 0, 'sources': 0, 'status': 'missing_database'})
            continue
        db = dbs[0]
        h = db_health(db)
        h.update({'state': d.name, 'status': 'ok' if h['posts'] or h['events'] else 'empty'})
        health.append(h)
        p, e = read_db(db, d.name)
        items.extend(p); ev.extend(e)

# Optional global database, preserving the existing architecture.
gdb = DBROOT / 'global/global_news.db'
if gdb.exists():
    h = db_health(gdb); h.update({'state': 'global', 'status': 'ok' if h['posts'] or h['events'] else 'empty'})
    health.append(h)
    p, e = read_db(gdb); items.extend(p); ev.extend(e)

uniq = {x['link']: x for x in items if x.get('link')}
items = sorted(uniq.values(), key=lambda x: (x['importance'], x['published_ts']), reverse=True)
ev = sorted({(x['title'], x.get('start_label'), x.get('link')): x for x in ev}.values(), key=lambda x: x.get('start_ts', 0))

locations = []
if LOCATIONS.exists():
    try:
        raw = json.loads(LOCATIONS.read_text(encoding='utf-8'))
        locations = raw.get('locations', []) if isinstance(raw, dict) else raw
    except Exception:
        locations = []

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({
    'generated_at': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
    'items': items[:5000],
    'events': ev[:1000],
    'collection_health': health,
    'locations': locations,
}, ensure_ascii=False, indent=2))

print(f'global news index: {len(items)} posts, {len(ev)} events -> {OUT}')
print('collection health:')
for h in health:
    print(f"  {h.get('state')}: {h.get('status')} posts={h.get('posts',0)} events={h.get('events',0)} sources={h.get('sources',0)}")

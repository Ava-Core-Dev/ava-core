#!/usr/bin/env python3
from pathlib import Path
import json, re
ROOT=Path(__file__).resolve().parents[1]
WEB=ROOT/'web/sites/avaivy.cloud'
CFG=json.loads((ROOT/'config/locations/global-locations.json').read_text())['locations']

def slug(s): return re.sub(r'[^a-z0-9]+','-',s.lower()).strip('-')
def title(s): return str(s).replace('-', ' ').title()

def shell(product, path, heading, sub, location=None):
    data=' '.join(f'data-{k}="{v}"' for k,v in (location or {}).items())
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0a0e15"><title>{heading} — Ava Ivy</title><link rel="stylesheet" href="/css/home.css"><link rel="stylesheet" href="/css/geography.css"></head><body {data}><div class="ambient"></div><header class="nav"><a class="brand" href="/"><span class="mark">✦</span><span><b>AVA</b><small>IVY</small></span></a><nav><a href="/">Home</a><a class="{'active' if product=='weather' else ''}" href="/weather/">Weather</a><a class="{'active' if product=='earthquakes' else ''}" href="/earthquakes/">Earthquakes</a><a class="{'active' if product=='news' else ''}" href="/news/">News</a><a href="/states/">States</a><a href="/directory/">Directory</a></nav><div class="status"><i></i><span>CORE ONLINE</span></div></header><main><section class="geo-hero"><div><div class="eyebrow">GLOBAL · {product.upper()}</div><h1>{heading}</h1><p class="lead">{sub}</p></div><div class="geo-actions"><a class="secondary" href="/{product}/">Global {product.title()} ↗</a></div></section><section id="geoContent" class="geo-grid"><div class="empty">Loading {product} data…</div></section></main><footer><span>✦ Ava Ivy</span><span>Global {product.title()}</span><span>© 2026</span></footer><script src="/js/geography-page.js"></script></body></html>'''

def write(product, parts, heading, sub, loc=None):
    p=WEB/product
    for x in parts: p=p/x
    p.mkdir(parents=True,exist_ok=True); (p/'index.html').write_text(shell(product,'/'.join(parts),heading,sub,loc),encoding='utf-8')

# Country/state/location route pages.
countries={}
for x in CFG:
    x['country'] = x.get('country') or slug(x.get('country_name',''))
    countries.setdefault(x['country'], []).append(x)
    if x.get('country_code')=='US' and x.get('admin1_slug'):
        parts=['united-states',x['admin1_slug']]
        write('weather',parts,x['admin1_name'],f"Collected weather for {x['admin1_name']}, with the same location hierarchy used across Ava.",{'country':'united-states','state':x['admin1_slug'],'location':''})
        write('earthquakes',parts,f"{x['admin1_name']} earthquakes",f"Earthquake activity geographically associated with {x['admin1_name']}.",{'country':'united-states','state':x['admin1_slug'],'location':''})
        write('news',parts,f"{x['admin1_name']} news",f"Important source-first news and public information for {x['admin1_name']}.",{'country':'united-states','state':x['admin1_slug'],'location':''})
        lp=parts+[x['slug']]
        write('weather',lp,x['name'],f"Weather observations and current conditions for {x['name']}, {x['admin1_name']}.",{'country':'united-states','state':x['admin1_slug'],'location':x['slug']})
        write('earthquakes',lp,f"{x['name']} earthquakes",f"Nearby earthquake activity for {x['name']}, {x['admin1_name']}.",{'country':'united-states','state':x['admin1_slug'],'location':x['slug']})
        write('news',lp,f"{x['name']} news",f"Important news and public information for {x['name']}, {x['admin1_name']}.",{'country':'united-states','state':x['admin1_slug'],'location':x['slug']})
    else:
        parts=[x['country'],x['slug']]
        for product in ('weather','earthquakes','news'):
            write(product,parts,x['name'],f"{product.title()} data and source-first information for {x['name']}, {x['country_name']}.",{'country':x['country'],'state':'','location':x['slug']})
# Country hubs for non-US countries.
for country, xs in countries.items():
    if country=='united-states': continue
    for product in ('weather','earthquakes','news'):
        write(product,[country],title(country),f"Global {product} coverage for {title(country)}.",{'country':country,'state':'','location':''})
print('generated global route pages from',len(CFG),'location records')

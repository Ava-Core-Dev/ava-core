#!/usr/bin/env python3
"""Collect Hawaiʻi source updates into the Ava static news dataset.

The registry stores publisher pages rather than assuming a permanent endpoint.
The collector discovers a machine-readable syndication URL from each source page,
then falls back to common endpoint names. This keeps source links stable while
allowing publishers to change their feed path.
"""
from __future__ import annotations
import json,re,sys,time
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request,urlopen
from xml.etree import ElementTree as ET

ROOT=Path(__file__).resolve().parents[2]
WEB=ROOT/'web/sites/avaivy.cloud'
REG=WEB/'data/hawaii-news-sources.json'
OUT=WEB/'data/hawaii-news.json'
UA='AvaIvy-HawaiiNews/1.0 (+https://avaivy.cloud/news/)'
TIMEOUT=15

def get(url):
    req=Request(url,headers={'User-Agent':UA,'Accept':'application/rss+xml,application/atom+xml,text/xml,text/html;q=0.8,*/*;q=0.5'})
    with urlopen(req,timeout=TIMEOUT) as r:return r.geturl(),r.read()

def discover(page):
    final,body=get(page); text=body.decode('utf-8','ignore')
    links=re.findall(r'<link[^>]+(?:rel=["\']([^"\']+)["\'][^>]+href=["\']([^"\']+)["\']|href=["\']([^"\']+)["\'][^>]+rel=["\']([^"\']+)["\'])[^>]*>',text,re.I)
    for a,b,c,d in links:
        rel=(a or d or '').lower(); href=b or c
        if 'alternate' in rel and ('rss' in rel or 'atom' in rel or 'xml' in rel): return urljoin(final,href)
    for suffix in ('feed/','rss.xml','feed.xml','rss','atom.xml'):
        candidate=urljoin(final.rstrip('/')+'/',suffix)
        try:
            f,data=get(candidate)
            if b'<rss' in data[:2000].lower() or b'<feed' in data[:2000].lower(): return f
        except Exception: pass
    return None

def text(node):return unescape(''.join(node.itertext()).strip()) if node is not None else ''
def first(parent,names):
    for child in list(parent):
        if child.tag.split('}')[-1].lower() in names:return text(child)
    return ''
def parse(feed,source):
    root=ET.fromstring(feed); tag=root.tag.split('}')[-1].lower(); out=[]
    if tag=='rss':
        channel=next((x for x in root if x.tag.split('}')[-1].lower()=='channel'),root)
        nodes=[x for x in channel if x.tag.split('}')[-1].lower()=='item']
    else:nodes=[x for x in root.iter() if x.tag.split('}')[-1].lower()=='entry']
    for n in nodes[:30]:
        title=first(n,{'title'}); link='';
        for c in list(n):
            if c.tag.split('}')[-1].lower()=='link':
                link=c.attrib.get('href') or text(c); 
                if link:break
        link=link or first(n,{'guid','id'})
        desc=first(n,{'description','summary','content'}); pub=first(n,{'pubdate','published','updated','date'})
        if not title or not link:continue
        cat=source[3]
        out.append({'title':title,'link':urljoin(source[4],link),'summary':re.sub(r'\\s+',' ',re.sub('<[^>]+>',' ',desc))[:420],'published':pub,'source_id':source[0],'source':source[1],'category':cat,'category_label':cat.replace('-',' ').title(),'published_label':pub[:30]})
    return out

def main():
    reg=json.loads(REG.read_text()); items=[]; status=[]
    for source in reg['sources']:
        try:
            feed=discover(source[4])
            if not feed:status.append({'id':source[0],'ok':False,'reason':'no machine-readable endpoint discovered'});continue
            final,body=get(feed); got=parse(body,source); items.extend(got); status.append({'id':source[0],'ok':True,'items':len(got),'endpoint':final})
        except Exception as e:status.append({'id':source[0],'ok':False,'reason':str(e)[:180]})
    seen=set(); dedup=[]
    for x in sorted(items,key=lambda z:z.get('published',''),reverse=True):
        key=(x['title'].strip().lower(),x['source_id'])
        if key in seen:continue
        seen.add(key);dedup.append(x)
    OUT.write_text(json.dumps({'generated_at':datetime.now(timezone.utc).isoformat(),'items':dedup[:500],'status':status},ensure_ascii=False,indent=2))
    print(f'Collected {len(dedup)} items from {sum(1 for s in status if s.get("ok"))}/{len(status)} sources')
if __name__=='__main__':main()

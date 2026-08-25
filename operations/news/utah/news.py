#!/usr/bin/env python3
"""Utah state news/events collector. Cronologicals owns scheduling."""
import argparse, sys
from pathlib import Path
HERE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(HERE))
from _collector import run
STATE_SLUG='utah'
ROOT=Path(__file__).resolve().parents[3]
DB=ROOT/'database'/'states'/STATE_SLUG/(STATE_SLUG+'_news.db')
PORTAL_URL='https://utah.gov/'
CHECKPOINT='2026-03-31T00:00:00Z'
if __name__=='__main__':
 ap=argparse.ArgumentParser(); ap.add_argument('--backfill',action='store_true'); ap.add_argument('--checkpoint',default=CHECKPOINT); a=ap.parse_args(); run(STATE_SLUG,PORTAL_URL,DB,a.backfill,a.checkpoint)

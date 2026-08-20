"""Data feeds for OBS desk overlays — economy, dev updates, quakes, goals."""

from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from apps.core import config

AVA = Path("/home/ava-core/ava")
POSTS = AVA / "media" / "documents" / "reports" / "posts"
USGS_DAY = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson"
USGS_ALL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"
USGS_HAWAII = (
    "https://earthquake.usgs.gov/fdsnws/event/1/query?"
    "format=geojson&starttime={start}&latitude=19.5&longitude=-155.5&"
    "maxradiuskm=250&minmagnitude=1.5&orderby=time&limit=20"
)
QUAKE_CACHE = config.DATA_DIR / "state" / "obs-quake-feed.json"
SITE_LABELS = {
    "ava": "avaivy.cloud",
    "rootrecord": "rootrecord.online",
    "rootmc": "rootmc.net",
}


def _get_json(url: str, timeout: float = 12) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "AvaIvy/2.0 (obs-desk)"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def _parse_frontmatter(text: str) -> dict[str, str]:
    if not text.startswith("---"):
        return {}
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.S)
    if not m:
        return {}
    meta: dict[str, str] = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip().strip('"')
    return meta


def _post_date(meta: dict[str, str], path: Path) -> str:
    for key in ("published", "date"):
        if meta.get(key):
            return meta[key][:10]
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).strftime("%Y-%m-%d")
    except OSError:
        return "1970-01-01"


def latest_blog_across_sites() -> dict[str, Any]:
    best: dict[str, Any] | None = None
    for brand in ("ava", "rootrecord", "rootmc"):
        root = POSTS / brand
        if not root.is_dir():
            continue
        for path in root.glob("*.md"):
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            meta = _parse_frontmatter(text)
            title = meta.get("title") or path.stem.replace("-", " ").title()
            teaser = meta.get("teaser") or meta.get("description") or ""
            dt = _post_date(meta, path)
            row = {
                "site": brand,
                "site_label": SITE_LABELS.get(brand, brand),
                "slug": path.stem,
                "title": title,
                "teaser": teaser[:280],
                "date": dt,
                "path": str(path),
            }
            if best is None or row["date"] > best["date"]:
                best = row
    return best or {"title": "No posts yet", "site_label": "—", "date": "—", "teaser": ""}


def economy_desk() -> dict[str, Any]:
    stats_path = AVA / "workstations" / "minecraft-test" / "plugins" / "RootMC" / "webstat" / "stats.json"
    out: dict[str, Any] = {"ok": True, "players_online": 0, "wallet_g": 0, "server": "RootMC"}
    if stats_path.is_file():
        try:
            data = json.loads(stats_path.read_text())
            series = data.get("series") or {}
            out["players_online"] = int((series.get("online_players") or {}).get("highest") or 0)
            out["wallet_g"] = float((series.get("player_wallet_g") or {}).get("total") or 0)
            out["server"] = data.get("server_name") or out["server"]
            out["computed_at"] = data.get("computed_at")
        except Exception:
            pass
    alert = "normal"
    alert_path = config.DATA_DIR / "state" / "kilauea-alert.json"
    if alert_path.is_file():
        try:
            alert = json.loads(alert_path.read_text()).get("alert_level") or alert
        except Exception:
            pass
    mult = 1.0
    if alert in {"watch", "advisory", "warning"}:
        mult = 1.25
    if alert in {"orange", "red"}:
        mult = 1.5
    out["kilauea_alert"] = alert
    out["economy_multiplier"] = mult
    out["play_rootmc"] = "play.rootmc.net"
    return out


async def _fetch_quakes() -> dict[str, Any]:
    # Island query: rolling 24h window (not just "today UTC midnight")
    start = (datetime.now(timezone.utc).timestamp() - 86400)
    start_iso = datetime.fromtimestamp(start, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    payload: dict[str, Any] = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "global": [],
        "island": [],
    }
    try:
        # Match USGS map "M2.5+ Past Day" — not all_day microquakes
        g = _get_json(USGS_DAY)
        feats = list(g.get("features") or [])
        feats.sort(key=lambda f: int((f.get("properties") or {}).get("time") or 0), reverse=True)
        for f in feats[:12]:
            props = f.get("properties") or {}
            payload["global"].append(
                {
                    "mag": props.get("mag"),
                    "place": props.get("place"),
                    "time": props.get("time"),
                    "id": f.get("id"),
                    "sig": props.get("sig") or 0,
                }
            )
    except Exception as e:
        payload["global_error"] = str(e)[:120]
    try:
        h = _get_json(USGS_HAWAII.format(start=start_iso))
        feats = list(h.get("features") or [])
        feats.sort(key=lambda f: int((f.get("properties") or {}).get("time") or 0), reverse=True)
        for f in feats[:12]:
            props = f.get("properties") or {}
            payload["island"].append(
                {
                    "mag": props.get("mag"),
                    "place": props.get("place"),
                    "time": props.get("time"),
                    "id": f.get("id"),
                    "sig": props.get("sig") or 0,
                }
            )
    except Exception as e:
        payload["island_error"] = str(e)[:120]
    QUAKE_CACHE.parent.mkdir(parents=True, exist_ok=True)
    QUAKE_CACHE.write_text(json.dumps(payload, indent=2))
    return payload


async def quake_feed(*, force: bool = False, max_age_s: float = 45.0) -> dict[str, Any]:
    """Live USGS feed with short TTL — never serve a forever-stale cache."""
    if not force and QUAKE_CACHE.is_file():
        try:
            cached = json.loads(QUAKE_CACHE.read_text())
            age_ok = False
            stamp = cached.get("fetched_at") or cached.get("ts")
            if stamp:
                try:
                    when = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
                    age_ok = (datetime.now(timezone.utc) - when).total_seconds() <= max_age_s
                except Exception:
                    age_ok = False
            if age_ok and (cached.get("global") or cached.get("island")):
                return cached
        except Exception:
            pass
    return await _fetch_quakes()


async def quake_has_global_event(min_sig: int = 40) -> bool:
    data = await quake_feed()
    for q in data.get("global") or []:
        if float(q.get("mag") or 0) >= 5.0 or int(q.get("sig") or 0) >= min_sig:
            return True
    return bool(data.get("global"))


async def quake_has_island_event(min_mag: float = 2.5) -> bool:
    data = await quake_feed()
    for q in data.get("island") or []:
        if float(q.get("mag") or 0) >= min_mag:
            return True
    return False

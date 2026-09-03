"""Data feeds for OBS desk overlays — economy, dev updates, quakes, goals."""

from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from apps.core import config

AVA = config.AVA_HOME
POSTS = AVA / "Media" / "documents" / "reports" / "posts"
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


def _iter_blog_posts() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for brand in ("ava", "rootrecord", "rootmc"):
        root = POSTS / brand
        if not root.is_dir():
            continue
        for path in root.glob("*.md"):
            # READMEs are indexes, not desk notifications
            if path.name.upper() == "README.MD":
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            meta = _parse_frontmatter(text)
            title = meta.get("title") or path.stem.replace("-", " ").title()
            teaser = meta.get("teaser") or meta.get("description") or ""
            dt = _post_date(meta, path)
            rows.append(
                {
                    "site": brand,
                    "site_label": SITE_LABELS.get(brand, brand),
                    "slug": path.stem,
                    "title": title,
                    "teaser": teaser[:280],
                    "date": dt,
                    "path": str(path),
                }
            )
    rows.sort(key=lambda r: (r.get("date") or "", r.get("slug") or ""), reverse=True)
    return rows


def latest_blog_across_sites() -> dict[str, Any]:
    rows = _iter_blog_posts()
    if not rows:
        return {"title": "No posts yet", "site_label": "—", "date": "—", "teaser": ""}
    return rows[0]


def recent_blogs_across_sites(limit: int = 6) -> list[dict[str, Any]]:
    """Newest posts across ava / rootrecord / rootmc for the Dev Updates desk."""
    n = max(1, min(int(limit or 6), 12))
    return _iter_blog_posts()[:n]


def _economy_stats_candidates() -> list[Path]:
    """Live Shockbyte first — local minecraft-test often has empty wallets."""
    roots = [
        AVA / "workstations" / "shockbyte" / "plugins" / "RootMC" / "webstat" / "stats.json",
        AVA / "workstations" / "minecraft-test" / "plugins" / "RootMC" / "webstat" / "stats.json",
    ]
    seen: set[Path] = set()
    out: list[Path] = []
    for p in roots:
        rp = p.resolve()
        if rp in seen or not p.is_file():
            continue
        seen.add(rp)
        out.append(p)
    # Any other workstation webstat dumps
    for p in sorted((AVA / "workstations").glob("*/plugins/RootMC/webstat/stats.json")):
        rp = p.resolve()
        if rp in seen:
            continue
        seen.add(rp)
        out.append(p)
    return out


def _read_economy_stats(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    series = data.get("series") or {}
    online = series.get("online_players") or {}
    wallet = series.get("player_wallet_g") or {}
    return {
        "path": str(path),
        "server": data.get("server_name") or "RootMC",
        "computed_at": data.get("computed_at"),
        "players_online": int(
            online.get("highest")
            or online.get("mean")
            or online.get("average")
            or online.get("total")
            or 0
        ),
        "wallet_g": float(wallet.get("total") or 0),
        "wallet_count": int(wallet.get("count") or 0),
    }


def economy_desk() -> dict[str, Any]:
    """Board numbers for Scene 6 — prefer live wallet totals over empty test dumps."""
    out: dict[str, Any] = {"ok": True, "players_online": 0, "wallet_g": 0.0, "server": "RootMC"}
    rows = [r for p in _economy_stats_candidates() if (r := _read_economy_stats(p))]
    if rows:
        # Wallet: richest non-empty snapshot (test server often writes 0 G with newer timestamp)
        by_wallet = sorted(
            rows,
            key=lambda r: (float(r.get("wallet_g") or 0), int(r.get("wallet_count") or 0)),
            reverse=True,
        )
        wallet_row = by_wallet[0]
        # Online: highest current reading across dumps
        online_row = max(rows, key=lambda r: int(r.get("players_online") or 0))
        out["players_online"] = int(online_row.get("players_online") or 0)
        out["wallet_g"] = float(wallet_row.get("wallet_g") or 0)
        out["wallet_count"] = int(wallet_row.get("wallet_count") or 0)
        out["server"] = wallet_row.get("server") or out["server"]
        out["computed_at"] = wallet_row.get("computed_at")
        out["stats_source"] = wallet_row.get("path")
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

"""Root Record Radio — track titles from sidecars + public like/dislike steering.

Sidecar: ``Media/public/audio/music/.../Track.wav.txt`` (Suno export).
Votes live in ``data/state/radio-votes.json`` and change shuffle weight.
Liked prompts/tags roll into ``data/state/radio-steering.json`` for new music.
"""
from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from typing import Any

from apps.core import config

log = logging.getLogger("ava.radio.catalog")

VOTES_NAME = "radio-votes.json"
STEERING_NAME = "radio-steering.json"
MAX_EVENT_LOG = 400

_TITLE_RE = re.compile(r"^Title:\s*(.+)$", re.I | re.M)
_PROMPT_RE = re.compile(r"^Prompt:\s*(.+)$", re.I | re.M)
_TAGS_RE = re.compile(r'"display_tags"\s*:\s*"([^"]+)"')
_GPT_DESC_RE = re.compile(r'"gpt_description_prompt"\s*:\s*"([^"]+)"')


def _votes_path() -> Path:
    return config.DATA_DIR / "state" / VOTES_NAME


def _steering_path() -> Path:
    return config.DATA_DIR / "state" / STEERING_NAME


def track_key(path: Path | str) -> str:
    """Stable key relative to public media when possible."""
    p = Path(path)
    try:
        rel = p.resolve().relative_to(Path(config.PUBLIC_MEDIA).resolve())
        return str(rel).replace("\\", "/")
    except Exception:
        return p.name


def sidecar_path(audio: Path) -> Path:
    return audio.with_suffix(audio.suffix + ".txt")


def parse_sidecar(audio: Path) -> dict[str, str]:
    """Title + short description for visitors. Never show raw .wav names when meta exists."""
    title = ""
    description = ""
    tags = ""
    side = sidecar_path(audio)
    if side.is_file():
        try:
            text = side.read_text(encoding="utf-8", errors="replace")
        except Exception:
            text = ""
        m = _TITLE_RE.search(text)
        if m:
            title = m.group(1).strip()
        m = _PROMPT_RE.search(text)
        if m:
            description = m.group(1).strip()
        m = _GPT_DESC_RE.search(text)
        if m and not description:
            description = m.group(1).strip()
        m = _TAGS_RE.search(text)
        if m:
            tags = m.group(1).strip()
        if not description and tags:
            description = tags
    if not title:
        # Humanize filename without extension
        stem = audio.stem
        stem = re.sub(r"^My_Workspace[-_]", "", stem, flags=re.I)
        stem = stem.replace("_", " ").replace("-", " ").strip()
        title = stem or "Untitled"
    if len(description) > 280:
        description = description[:277].rstrip() + "..."
    folder = audio.parent.name if audio.parent.name else ""
    return {
        "title": title[:120],
        "description": description,
        "tags": tags[:160],
        "folder": folder[:80],
    }


def load_votes() -> dict[str, Any]:
    path = _votes_path()
    if not path.is_file():
        return {"tracks": {}, "voters": {}, "updated_at": 0}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"tracks": {}, "voters": {}, "updated_at": 0}
        data.setdefault("tracks", {})
        data.setdefault("voters", {})
        return data
    except Exception:
        return {"tracks": {}, "voters": {}, "updated_at": 0}


def save_votes(data: dict[str, Any]) -> dict[str, Any]:
    path = _votes_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    data = dict(data)
    data["updated_at"] = int(time.time())
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return data


def track_stats(key: str) -> dict[str, Any]:
    st = load_votes().get("tracks") or {}
    row = st.get(key) if isinstance(st, dict) else None
    if not isinstance(row, dict):
        return {"likes": 0, "dislikes": 0, "score": 0}
    likes = int(row.get("likes") or 0)
    dislikes = int(row.get("dislikes") or 0)
    return {"likes": likes, "dislikes": dislikes, "score": likes - dislikes}


def shuffle_weight(path: Path | str) -> float:
    """Higher weight → more likely in weighted reshuffle. Floor 0.15 so nothing vanishes."""
    key = track_key(path)
    s = track_stats(key)
    # Like lifts play chance; dislike cuts it hard but never to zero.
    w = 1.0 + (0.55 * s["likes"]) - (0.7 * s["dislikes"])
    return max(0.15, float(w))


def weighted_order(paths: list[Path]) -> list[Path]:
    """Fisher–Yates with weight bias (Efraimidis–Spirakis keys)."""
    import math
    import random

    if not paths:
        return []
    keyed: list[tuple[float, Path]] = []
    for p in paths:
        w = shuffle_weight(p)
        # key = random^(1/w); sort descending
        u = random.random()
        keyed.append((math.pow(u, 1.0 / w), p))
    keyed.sort(key=lambda t: t[0], reverse=True)
    return [p for _, p in keyed]


def public_meta(path: Path | str) -> dict[str, Any]:
    p = Path(path)
    meta = parse_sidecar(p) if p.is_file() else {
        "title": Path(path).stem,
        "description": "",
        "tags": "",
        "folder": "",
    }
    key = track_key(p)
    stats = track_stats(key)
    return {
        "id": key,
        "title": meta["title"],
        "description": meta["description"],
        "tags": meta.get("tags") or "",
        "folder": meta.get("folder") or "",
        "likes": stats["likes"],
        "dislikes": stats["dislikes"],
        "score": stats["score"],
    }


def cast_vote(
    *,
    track_id: str,
    vote: str,
    voter: str,
    site: str = "",
) -> dict[str, Any]:
    """Record like or dislike. Same voter can flip once per track."""
    vote = (vote or "").strip().lower()
    if vote not in ("like", "dislike"):
        return {"ok": False, "detail": "vote must be like or dislike"}
    track_id = (track_id or "").strip().replace("\\", "/")[:500]
    if not track_id or ".." in track_id:
        return {"ok": False, "detail": "bad track"}
    voter = (voter or "").strip()[:80]
    if not voter:
        return {"ok": False, "detail": "missing voter"}

    data = load_votes()
    tracks = data.setdefault("tracks", {})
    voters = data.setdefault("voters", {})
    row = tracks.setdefault(
        track_id,
        {"likes": 0, "dislikes": 0, "title": "", "updated_at": 0},
    )
    vmap = voters.setdefault(voter, {})
    prev = vmap.get(track_id)

    if prev == vote:
        stats = track_stats(track_id)
        return {"ok": True, "unchanged": True, "id": track_id, **stats}

    # Undo previous
    if prev == "like":
        row["likes"] = max(0, int(row.get("likes") or 0) - 1)
    elif prev == "dislike":
        row["dislikes"] = max(0, int(row.get("dislikes") or 0) - 1)

    if vote == "like":
        row["likes"] = int(row.get("likes") or 0) + 1
    else:
        row["dislikes"] = int(row.get("dislikes") or 0) + 1

    vmap[track_id] = vote
    row["updated_at"] = int(time.time())
    row["last_site"] = (site or "")[:80]

    # Resolve title for steering
    try:
        audio = Path(config.PUBLIC_MEDIA) / track_id
        if audio.is_file():
            meta = parse_sidecar(audio)
            row["title"] = meta["title"]
            row["tags"] = meta.get("tags") or ""
            row["description"] = meta.get("description") or ""
    except Exception:
        pass

    events = data.setdefault("events", [])
    events.append(
        {
            "t": int(time.time()),
            "id": track_id,
            "vote": vote,
            "site": (site or "")[:40],
            "voter": voter[:12],
        }
    )
    if len(events) > MAX_EVENT_LOG:
        data["events"] = events[-MAX_EVENT_LOG:]

    save_votes(data)
    _rebuild_steering(data)
    stats = track_stats(track_id)
    log.info(
        "radio vote  %s  %s  likes=%s dislikes=%s site=%s",
        vote,
        track_id,
        stats["likes"],
        stats["dislikes"],
        site or "-",
    )
    return {"ok": True, "id": track_id, "vote": vote, **stats}


def _rebuild_steering(data: dict[str, Any]) -> None:
    """Liked tracks push tags/prompts; disliked pull them. Used when making new beds."""
    tracks = data.get("tracks") or {}
    liked: list[dict[str, Any]] = []
    disliked: list[dict[str, Any]] = []
    for key, row in tracks.items():
        if not isinstance(row, dict):
            continue
        likes = int(row.get("likes") or 0)
        dislikes = int(row.get("dislikes") or 0)
        score = likes - dislikes
        entry = {
            "id": key,
            "title": row.get("title") or Path(key).stem,
            "tags": row.get("tags") or "",
            "description": (row.get("description") or "")[:200],
            "likes": likes,
            "dislikes": dislikes,
            "score": score,
        }
        if score > 0:
            liked.append(entry)
        elif score < 0:
            disliked.append(entry)
    liked.sort(key=lambda e: e["score"], reverse=True)
    disliked.sort(key=lambda e: e["score"])

    tag_weight: dict[str, int] = {}
    for e in liked[:40]:
        for part in re.split(r"[,;]", e.get("tags") or ""):
            t = part.strip().lower()
            if len(t) >= 2:
                tag_weight[t] = tag_weight.get(t, 0) + max(1, int(e["score"]))
        # Also mine short words from description for steering
        desc = e.get("description") or ""
        if desc and not e.get("tags"):
            tag_weight["_prompt_like"] = tag_weight.get("_prompt_like", 0) + 1

    avoid_weight: dict[str, int] = {}
    for e in disliked[:40]:
        for part in re.split(r"[,;]", e.get("tags") or ""):
            t = part.strip().lower()
            if len(t) >= 2:
                avoid_weight[t] = avoid_weight.get(t, 0) + max(1, -int(e["score"]))

    prefer = sorted(tag_weight.items(), key=lambda x: -x[1])[:24]
    avoid = sorted(avoid_weight.items(), key=lambda x: -x[1])[:24]
    out = {
        "updated_at": int(time.time()),
        "note": (
            "Listener likes raise how often a track plays and what tags we lean on "
            "when making or picking new bed music. Dislikes cut play weight and mark "
            "tags to ease off."
        ),
        "prefer_tags": [{"tag": t, "weight": w} for t, w in prefer if not t.startswith("_")],
        "avoid_tags": [{"tag": t, "weight": w} for t, w in avoid],
        "top_liked": liked[:12],
        "top_disliked": disliked[:12],
        "prompt_hint": _prompt_hint(liked, prefer),
    }
    path = _steering_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")


def _prompt_hint(liked: list[dict], prefer: list[tuple[str, int]]) -> str:
    tags = [t for t, _ in prefer[:8] if not t.startswith("_")]
    if not tags and liked:
        # Fall back to first liked description snippet
        d = (liked[0].get("description") or "")[:120]
        return d
    if not tags:
        return ""
    return "Lean into: " + ", ".join(tags)


def steering_public() -> dict[str, Any]:
    path = _steering_path()
    if not path.is_file():
        return {
            "ok": True,
            "note": (
                "Likes and dislikes steer what plays next and what new music we lean toward."
            ),
            "prefer_tags": [],
            "avoid_tags": [],
        }
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return {
            "ok": True,
            "note": data.get("note") or "",
            "prefer_tags": (data.get("prefer_tags") or [])[:8],
            "avoid_tags": (data.get("avoid_tags") or [])[:6],
            "prompt_hint": data.get("prompt_hint") or "",
            "updated_at": data.get("updated_at") or 0,
        }
    except Exception:
        return {"ok": True, "note": "", "prefer_tags": [], "avoid_tags": []}

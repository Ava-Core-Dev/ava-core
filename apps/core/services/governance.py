"""RootRecord governance program — customer-first, self-upgrading when switched on.

Desk toggles:
  community_governance — collect wishes, daily consensus, proposal/conclusion pages
  self_update — queue a Cursor hook after a majority pass

Cursor does not fire unless self_update is on AND remaining context is known
and greater than cursor_min_free_pct (default 25). Unknown context = queued,
never auto-run. That shutoff is the foundation until the API can report headroom.
"""
from __future__ import annotations

import json
import logging
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from apps.core import config

log = logging.getLogger("ava.governance")
HST = ZoneInfo("Pacific/Honolulu")

FLAGS_PATH = config.DATA_DIR / "state" / "governance.json"
PAGES_DIR = config.DATA_DIR / "governance" / "pages"
QUEUE_PATH = config.DATA_DIR / "governance" / "cursor-queue.json"
LAST_PATH = config.DATA_DIR / "governance" / "last-daily.json"

_DEFAULT = {
    "community_governance": False,
    "self_update": False,
    "cursor_min_free_pct": 25,
    "cursor_context_free_pct": None,
    "program_name": "RootRecord governance",
}

_STOP = frozenset(
    "a an the to of and or for we you i it this that should add can please want wish make her ava feature new".split()
)


def flags() -> dict:
    FLAGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not FLAGS_PATH.is_file():
        FLAGS_PATH.write_text(json.dumps(_DEFAULT, indent=2) + "\n", encoding="utf-8")
        return dict(_DEFAULT)
    try:
        data = json.loads(FLAGS_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return dict(_DEFAULT)
    except Exception:
        return dict(_DEFAULT)
    out = dict(_DEFAULT)
    out["community_governance"] = bool(data.get("community_governance"))
    out["self_update"] = bool(data.get("self_update"))
    try:
        out["cursor_min_free_pct"] = max(1, min(90, int(data.get("cursor_min_free_pct") or 25)))
    except (TypeError, ValueError):
        out["cursor_min_free_pct"] = 25
    raw_free = data.get("cursor_context_free_pct")
    try:
        out["cursor_context_free_pct"] = None if raw_free is None else max(0, min(100, int(raw_free)))
    except (TypeError, ValueError):
        out["cursor_context_free_pct"] = None
    out["program_name"] = str(data.get("program_name") or _DEFAULT["program_name"])[:80]
    return out


def write_flags(patch: dict) -> dict:
    cur = flags()
    if "community_governance" in patch:
        cur["community_governance"] = bool(patch["community_governance"])
    if "self_update" in patch:
        cur["self_update"] = bool(patch["self_update"])
    if "cursor_min_free_pct" in patch and patch["cursor_min_free_pct"] is not None:
        try:
            cur["cursor_min_free_pct"] = max(1, min(90, int(patch["cursor_min_free_pct"])))
        except (TypeError, ValueError):
            pass
    if "cursor_context_free_pct" in patch:
        raw = patch["cursor_context_free_pct"]
        if raw is None or raw == "":
            cur["cursor_context_free_pct"] = None
        else:
            try:
                cur["cursor_context_free_pct"] = max(0, min(100, int(raw)))
            except (TypeError, ValueError):
                pass
    FLAGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    FLAGS_PATH.write_text(json.dumps(cur, indent=2) + "\n", encoding="utf-8")
    return cur


def cursor_may_run(st: dict | None = None) -> tuple[bool, str]:
    st = st or flags()
    if not st.get("community_governance"):
        return False, "governance_off"
    if not st.get("self_update"):
        return False, "self_update_off"
    free = st.get("cursor_context_free_pct")
    need = int(st.get("cursor_min_free_pct") or 25)
    if free is None:
        return False, "context_unknown"
    if int(free) <= need:
        return False, "low_context"
    return True, "ok"


def _db() -> Path:
    return config.DB_DIR / "governance.sqlite"


def connect() -> sqlite3.Connection:
    config.DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_db()))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS wishes (
          id INTEGER PRIMARY KEY,
          person_id INTEGER NOT NULL,
          surface TEXT,
          sid TEXT,
          slug TEXT NOT NULL,
          text TEXT NOT NULL,
          at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_wishes_day ON wishes(at);
        CREATE TABLE IF NOT EXISTS dailies (
          day TEXT PRIMARY KEY,
          payload TEXT NOT NULL
        );
        """
    )
    return conn


def _slug(text: str) -> str:
    words = re.findall(r"[a-z0-9]+", (text or "").lower())
    keep = [w for w in words if w not in _STOP and len(w) > 2][:8]
    if not keep:
        keep = [w for w in words if len(w) > 2][:6]
    return "-".join(keep)[:72] or "feature"


def record_wish(person_id: int, surface: str, sid: str, text: str) -> None:
    raw = str(text or "").strip()[:800]
    if not raw or not person_id:
        return
    slug = _slug(raw)
    conn = connect()
    try:
        dup = conn.execute(
            """SELECT id FROM wishes WHERE person_id=? AND slug=? AND at >= ?
               ORDER BY id DESC LIMIT 1""",
            (int(person_id), slug, (datetime.now(timezone.utc) - timedelta(hours=18)).isoformat()),
        ).fetchone()
        if dup:
            return
        conn.execute(
            "INSERT INTO wishes (person_id, surface, sid, slug, text, at) VALUES (?, ?, ?, ?, ?, ?)",
            (int(person_id), surface, str(sid), slug, raw, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
    finally:
        conn.close()


def _since_iso(hours: int = 26) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


def tally(*, hours: int = 26) -> dict:
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT person_id, slug, text, surface, at FROM wishes WHERE at >= ? ORDER BY id DESC",
            (_since_iso(hours),),
        ).fetchall()
    finally:
        conn.close()
    by_slug: dict[str, dict] = {}
    people: set[int] = set()
    for row in rows:
        pid = int(row["person_id"])
        people.add(pid)
        slug = str(row["slug"])
        bucket = by_slug.setdefault(slug, {"slug": slug, "people": set(), "sample": row["text"], "n": 0})
        bucket["people"].add(pid)
        bucket["n"] += 1
    voters = max(1, len(people))
    ranked = []
    for bucket in by_slug.values():
        support = len(bucket["people"])
        ranked.append(
            {
                "slug": bucket["slug"],
                "sample": str(bucket["sample"] or "")[:400],
                "wish_count": bucket["n"],
                "people": support,
                "share": round(support / voters, 3),
                "majority": support * 2 > len(people) and support >= 2,
            }
        )
    ranked.sort(key=lambda r: (r["majority"], r["people"], r["wish_count"]), reverse=True)
    passed = [r for r in ranked if r["majority"]]
    return {
        "at": datetime.now(HST).isoformat(),
        "window_hours": hours,
        "people": len(people),
        "wishes": len(rows),
        "ranked": ranked[:20],
        "passed": passed,
    }


def _fill_page(kind: str, item: dict, day: str, program: str) -> str:
    sample = str(item.get("sample") or "").strip()
    slug = str(item.get("slug") or "feature")
    share = item.get("share")
    people_n = item.get("people")
    if kind == "proposal":
        title = "Proposal"
        body = (
            f"<p>People asked for this. Share among those who spoke up: "
            f"<strong>{share:.0%}</strong> ({people_n} people).</p>"
            f"<p>{_esc(sample)}</p>"
            f"<p>This is a draft. It does not change the live host until a conclusion is filed "
            f"and self-update is on.</p>"
        )
    else:
        title = "Conclusion"
        body = (
            f"<p>Daily tally found a majority for this ask.</p>"
            f"<p>{_esc(sample)}</p>"
            f"<p>Next: queued for the builder only if self-update is on and there is enough "
            f"unused context. Otherwise it stays here for a human to pick up.</p>"
        )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>{title} — {program}</title>
  <style>
    body {{ font-family: Georgia, serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.45; }}
    h1 {{ font-size: 1.4rem; }}
    .meta {{ color: #444; font-size: 0.95rem; }}
  </style>
</head>
<body>
  <p class="meta">{_esc(program)} · {day} · {_esc(slug)}</p>
  <h1>{title}</h1>
  {body}
</body>
</html>
"""


def _esc(s: str) -> str:
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def write_pages(result: dict, st: dict) -> list[str]:
    day = datetime.now(HST).strftime("%Y-%m-%d")
    program = str(st.get("program_name") or "RootRecord governance")
    PAGES_DIR.mkdir(parents=True, exist_ok=True)
    written = []
    for item in result.get("passed") or []:
        slug = re.sub(r"[^a-z0-9-]+", "-", str(item.get("slug") or "feature"))[:60]
        for kind in ("proposal", "conclusion"):
            path = PAGES_DIR / f"{day}-{slug}-{kind}.html"
            path.write_text(_fill_page(kind, item, day, program), encoding="utf-8")
            written.append(str(path.name))
    return written


def _enqueue_cursor(item: dict, reason_ok: bool, gate: str) -> dict:
    QUEUE_PATH.parent.mkdir(parents=True, exist_ok=True)
    q = {"jobs": []}
    if QUEUE_PATH.is_file():
        try:
            q = json.loads(QUEUE_PATH.read_text(encoding="utf-8"))
            if not isinstance(q, dict):
                q = {"jobs": []}
        except Exception:
            q = {"jobs": []}
    jobs = list(q.get("jobs") or [])
    job = {
        "at": datetime.now(timezone.utc).isoformat(),
        "slug": item.get("slug"),
        "sample": str(item.get("sample") or "")[:600],
        "status": "ready" if reason_ok else "queued",
        "gate": gate,
        "prompt": (
            "RootRecord governance majority passed. Build from the proposal/conclusion pages. "
            "Customer first. Do not invent live numbers. Stay on C:\\Users\\rootr\\ava.\n\n"
            + str(item.get("sample") or "")[:1500]
        ),
    }
    jobs = [j for j in jobs if j.get("slug") != item.get("slug")]
    jobs.append(job)
    q["jobs"] = jobs[-20:]
    QUEUE_PATH.write_text(json.dumps(q, indent=2) + "\n", encoding="utf-8")
    return job


def try_cursor_hook(item: dict, st: dict) -> dict:
    ok, gate = cursor_may_run(st)
    job = _enqueue_cursor(item, ok, gate)
    if not ok:
        log.info("governance cursor held slug=%s gate=%s", item.get("slug"), gate)
        return job
    # Foundation only: do not spawn Cursor from origin. Operator / later SDK hook.
    job["status"] = "held_for_sdk"
    log.info("governance cursor would run slug=%s (SDK hook not wired)", item.get("slug"))
    return job


def run_daily(*, hours: int = 26, source: str = "daily") -> dict:
    st = flags()
    result = tally(hours=hours)
    result["source"] = source
    result["flags"] = {
        "community_governance": st["community_governance"],
        "self_update": st["self_update"],
        "cursor_gate": cursor_may_run(st)[1],
    }
    result["pages"] = []
    result["cursor"] = []
    LAST_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not st.get("community_governance"):
        result["detail"] = "community_governance_off"
        LAST_PATH.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        return result
    conn = connect()
    try:
        day = datetime.now(HST).strftime("%Y-%m-%d")
        conn.execute(
            "INSERT INTO dailies (day, payload) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET payload=excluded.payload",
            (day, json.dumps(result)),
        )
        conn.commit()
    finally:
        conn.close()
    result["pages"] = write_pages(result, st)
    if st.get("self_update"):
        for item in result.get("passed") or []:
            result["cursor"].append(try_cursor_hook(item, st))
    LAST_PATH.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    log.info(
        "governance %s people=%s passed=%s pages=%s",
        source,
        result.get("people"),
        len(result.get("passed") or []),
        len(result["pages"]),
    )
    return result


def snapshot() -> dict:
    st = flags()
    last = {}
    if LAST_PATH.is_file():
        try:
            last = json.loads(LAST_PATH.read_text(encoding="utf-8"))
        except Exception:
            last = {}
    q = {"jobs": []}
    if QUEUE_PATH.is_file():
        try:
            q = json.loads(QUEUE_PATH.read_text(encoding="utf-8"))
        except Exception:
            q = {"jobs": []}
    ok, gate = cursor_may_run(st)
    return {
        "ok": True,
        "program": st.get("program_name"),
        "community_governance": st["community_governance"],
        "self_update": st["self_update"],
        "cursor_min_free_pct": st["cursor_min_free_pct"],
        "cursor_context_free_pct": st["cursor_context_free_pct"],
        "cursor_may_run": ok,
        "cursor_gate": gate,
        "last": last,
        "cursor_queue": (q.get("jobs") or [])[-8:],
    }

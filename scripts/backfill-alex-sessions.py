#!/usr/bin/env python3
"""Backfill alexrs94.site blog posts from agent session transcripts + AIConversations reports.

Writes markdown under media/documents/reports/posts/alex/
Does NOT publish secrets; truncates long dumps; strips common vendor tokens from public copy.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

HST = ZoneInfo("Pacific/Honolulu")
AVA = Path("/home/ava-core/ava")
OUT = AVA / "media" / "documents" / "reports" / "posts" / "alex"
TRANSCRIPTS = Path("/home/ava-core/.cursor/projects/home-ava-core-ava/agent-transcripts")
REPORTS = AVA / "media" / "private" / "accounts" / "AIConversations" / "reports"

VENDOR = [
    (re.compile(r"\bCursor\b", re.I), "coding agent"),
    (re.compile(r"\bChatGPT\b", re.I), "cloud assistant"),
    (re.compile(r"\bOpenAI\b", re.I), "cloud provider"),
    (re.compile(r"\bAnthropic\b", re.I), "cloud provider"),
    (re.compile(r"\bClaude\b", re.I), "cloud model"),
    (re.compile(r"\bGrok\b", re.I), "cloud model"),
    (re.compile(r"\bxAI\b", re.I), "cloud provider"),
    (re.compile(r"\bOllama\b", re.I), "local model"),
    (re.compile(r"\bSlack\b", re.I), "staff chat"),
]

SECRETISH = re.compile(
    r"(?i)(api[_-]?key|secret|password|token|bearer\s+[a-z0-9._-]{12,}|sk_live_|sk_test_|ghp_[a-z0-9]+)"
)


def scrub(text: str) -> str:
    t = text or ""
    for pat, rep in VENDOR:
        t = pat.sub(rep, t)
    # redact obvious secrets
    t = SECRETISH.sub("[redacted]", t)
    return t


def slugify(text: str, fallback: str) -> str:
    s = re.sub(r"[^\w]+", "-", (text or "").lower()).strip("-")[:56]
    return s or fallback


def extract_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for c in content:
            if isinstance(c, dict) and c.get("type") == "text":
                parts.append(str(c.get("text") or ""))
            elif isinstance(c, str):
                parts.append(c)
        return "\n".join(parts)
    if isinstance(content, dict):
        return extract_text(content.get("content") or content.get("text") or "")
    return ""


def first_user_query(text: str) -> str:
    m = re.search(r"<user_query>\s*(.*?)\s*</user_query>", text, re.S | re.I)
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip()
    # strip timestamp wrapper
    t = re.sub(r"<timestamp>.*?</timestamp>", "", text, flags=re.S | re.I).strip()
    return re.sub(r"\s+", " ", t)[:240]


def parse_ts_from_text(text: str) -> datetime | None:
    m = re.search(
        r"<timestamp>\s*([^<]+?)\s*</timestamp>",
        text,
        re.I,
    )
    if not m:
        return None
    raw = m.group(1).strip()
    # e.g. Wednesday, Aug 19, 2026, 6:45 PM (UTC-10)
    raw = re.sub(r"^[A-Za-z]+,\s*", "", raw)
    raw = re.sub(r"\s*\(UTC[^)]*\)\s*$", "", raw)
    for fmt in ("%b %d, %Y, %I:%M %p", "%B %d, %Y, %I:%M %p"):
        try:
            dt = datetime.strptime(raw, fmt)
            return dt.replace(tzinfo=HST)
        except ValueError:
            continue
    return None


def write_post(
    *,
    slug: str,
    date: str,
    published: str,
    title: str,
    teaser: str,
    categories: str,
    body: str,
    bullets: list[str],
    after: str = "",
) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{slug}.md"
    # keep site-foundation; overwrite generated session posts
    if path.name == "site-foundation.md" and path.exists() and slug == "site-foundation":
        return path
    parts = [
        "---",
        f"slug: {slug}",
        f"date: {date}",
        f"published: {published}",
        f'title: "{title.replace(chr(34), chr(39))}"',
        f'teaser: "{teaser.replace(chr(34), chr(39))}"',
        "brand: Alex",
        f"categories: {categories}",
        "---",
        "",
        scrub(body).strip(),
        "",
    ]
    if bullets:
        parts += ["## Bullets", ""]
        parts += [f"- {scrub(b)}" for b in bullets]
        parts.append("")
    if after:
        parts += ["## After", "", scrub(after).strip(), ""]
    path.write_text("\n".join(parts), encoding="utf-8")
    return path


def from_transcripts() -> int:
    n = 0
    if not TRANSCRIPTS.is_dir():
        return 0
    for folder in sorted(TRANSCRIPTS.iterdir()):
        if not folder.is_dir():
            continue
        # parent session only (skip nested subagents folder as top-level)
        jsonl = folder / f"{folder.name}.jsonl"
        if not jsonl.is_file():
            # some layouts: only one jsonl inside
            cands = [p for p in folder.glob("*.jsonl") if "subagent" not in str(p)]
            jsonl = cands[0] if cands else None
        if not jsonl or not jsonl.is_file():
            continue

        user_msgs: list[str] = []
        asst_msgs: list[str] = []
        first_ts: datetime | None = None
        with jsonl.open(encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                role = obj.get("role") or ""
                msg = obj.get("message") or obj
                text = extract_text(msg.get("content") if isinstance(msg, dict) else msg)
                if not text:
                    continue
                if not first_ts:
                    first_ts = parse_ts_from_text(text)
                if role == "user":
                    user_msgs.append(first_user_query(text) or text[:400])
                elif role == "assistant":
                    # skip pure tool dumps
                    if '"type": "tool_use"' in text or text.startswith('{"'):
                        continue
                    clean = re.sub(r"<[^>]+>", " ", text)
                    clean = re.sub(r"\s+", " ", clean).strip()
                    if len(clean) > 40:
                        asst_msgs.append(clean[:500])

        if not user_msgs:
            continue

        title_src = user_msgs[0][:90]
        title = scrub(title_src)
        if len(title) > 88:
            title = title[:85] + "…"
        short = folder.name[:8]
        slug = slugify(f"session-{short}-{title_src[:40]}", f"session-{short}")
        # stable unique slug
        digest = hashlib.sha1(folder.name.encode()).hexdigest()[:8]
        slug = f"session-{digest}"

        dt = first_ts or datetime.fromtimestamp(jsonl.stat().st_mtime, tz=HST)
        date = dt.astimezone(HST).strftime("%Y-%m-%d")
        published = dt.astimezone(HST).strftime("%Y-%m-%dT%H:%M:%S-10:00")

        body_bits = [
            f"Dev session report ({short}…) — personal archive of an AI-assisted build session.",
            "",
            "**Opening ask**",
            "",
            scrub(user_msgs[0])[:1200],
        ]
        if len(user_msgs) > 1:
            body_bits += ["", "**Later asks (trimmed)**", ""]
            for u in user_msgs[1:6]:
                body_bits.append(f"- {scrub(u)[:280]}")
        if asst_msgs:
            body_bits += ["", "**What landed (trimmed)**", "", scrub(asst_msgs[-1])[:900]]

        bullets = [
            f"Session id: {folder.name}",
            f"User turns captured: {len(user_msgs)}",
            "Full private transcript stays on the desk; this post is the public digest.",
        ]
        write_post(
            slug=slug,
            date=date,
            published=published,
            title=title or f"Dev session {short}",
            teaser=scrub(user_msgs[0])[:180],
            categories="ops, site",
            body="\n".join(body_bits),
            bullets=bullets,
            after="Saved so every coding-agent session has a public breadcrumb on alexrs94.site.",
        )
        n += 1
    return n


def from_reports() -> int:
    n = 0
    if not REPORTS.is_dir():
        return 0
    for path in sorted(REPORTS.glob("*.md")):
        raw = path.read_text(encoding="utf-8", errors="replace")
        # title from first heading or filename
        m = re.search(r"^#\s+(.+)$", raw, re.M)
        title = scrub((m.group(1) if m else path.stem).strip())[:100]
        # date from Generated line or mtime
        gm = re.search(r"Generated\s+(\d{4}-\d{2}-\d{2})", raw)
        if gm:
            date = gm.group(1)
            published = f"{date}T12:00:00-10:00"
        else:
            dt = datetime.fromtimestamp(path.stat().st_mtime, tz=HST)
            date = dt.strftime("%Y-%m-%d")
            published = dt.strftime("%Y-%m-%dT%H:%M:%S-10:00")

        digest = hashlib.sha1(path.name.encode()).hexdigest()[:10]
        slug = f"archive-{digest}"

        # Prefer Preview section
        prev = re.search(r"##\s+Preview\s*\n+(.*?)(?:\n---|\n## |\Z)", raw, re.S | re.I)
        body_src = prev.group(1).strip() if prev else raw
        body_src = re.sub(r"^>\s?", "", body_src, flags=re.M)
        body_src = scrub(body_src)
        if len(body_src) > 3500:
            body_src = body_src[:3400] + "\n\n…(trimmed for public blog)"

        teaser = re.sub(r"\s+", " ", body_src)[:180]
        write_post(
            slug=slug,
            date=date,
            published=published,
            title=title,
            teaser=teaser,
            categories="ops",
            body=f"Conversation archive digest.\n\n{body_src}",
            bullets=[
                f"Source file: `{path.name}`",
                "Private full export stays under media/private; this is the public digest.",
            ],
            after="Part of the habit: save every AI interaction, publish a scrubbed digest.",
        )
        n += 1
    return n


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    a = from_transcripts()
    b = from_reports()
    print(f"wrote transcripts={a} reports={b} → {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

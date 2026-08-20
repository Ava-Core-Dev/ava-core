#!/usr/bin/env python3
"""Rename alex blog posts + conversation source files to contextual names.

- Blog: media/documents/reports/posts/alex/*.md  (title + slug + filename)
- Digests: media/private/accounts/AIConversations/reports/*.md
- Sources: AIConversations root + grok tree (local SSD) and Archives HDD twin
           (rename in place only — no copy/move off the drive)

Does not bulk-copy Archives content. Writes a rename map + HDD index under data/.
"""
from __future__ import annotations

import hashlib
import json
import re
import urllib.request
from datetime import datetime
from pathlib import Path

AVA = Path("/home/ava-core/ava")
POSTS = AVA / "media" / "documents" / "reports" / "posts" / "alex"
REPORTS = AVA / "media" / "private" / "accounts" / "AIConversations" / "reports"
AICONV = AVA / "media" / "private" / "accounts" / "AIConversations"
HDD_AICONV = Path(
    "/mnt/wwn-0x50014ee26bf2dcc5-part1/08182026/ava/AIConversations"
)
DATA = AVA / "ava-core-v2" / "data"
OLLAMA = "http://127.0.0.1:11434/api/chat"
MODEL = "qwen3:8b"

SKIP_NAMES = {"README.md", "index.md", "files.log", "explore.py", "build_reports.py"}

VENDOR = [
    (re.compile(r"\bCursor\b", re.I), "coding agent"),
    (re.compile(r"\bChatGPT\b", re.I), "cloud assistant"),
    (re.compile(r"\bGrok\b", re.I), "cloud model"),
    (re.compile(r"\bOllama\b", re.I), "local model"),
]


def scrub(t: str) -> str:
    for pat, rep in VENDOR:
        t = pat.sub(rep, t or "")
    return t


def slugify(text: str, max_len: int = 56) -> str:
    s = (text or "").lower()
    s = s.replace("ʻ", "").replace("'", "")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return (s[:max_len].rstrip("-") or "note")


def looks_raw_title(title: str) -> bool:
    t = (title or "").strip()
    if not t:
        return True
    low = t.lower()
    if low.endswith((".txt", ".md", ".json", ".log", ".py")):
        return True
    if re.search(r"\.(txt|md|json)\b", low):
        return True
    if "convo" in low or "pasted-text" in low:
        return True
    if re.match(r"^(hi |ell me |read the |look at |we are |i was |i'm |im |how to )", low):
        return True
    if re.match(r"^_?[a-z]+_{2,}", low):  # _constitution___…
        return True
    if re.match(r"^\d{4}[ _-]\d{2}", low) and "info" in low:
        return True
    if len(t) > 90 and " " in t[:20]:
        return True
    if t[:1].islower() and " " in t and not t.startswith("http"):
        return True
    return False


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---"):
        return {}, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text
    meta: dict[str, str] = {}
    for line in parts[1].splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        meta[k.strip()] = v.strip().strip('"').strip("'")
    return meta, parts[2].lstrip("\n")


def body_snippet(body: str, limit: int = 900) -> str:
    b = body or ""
    # Prefer Opening ask / first heading
    m = re.search(r"\*\*Opening ask\*\*\s*\n+(.+?)(?:\n\n|\n\*\*|\Z)", b, re.S)
    if m:
        return re.sub(r"\s+", " ", m.group(1))[:limit]
    m = re.search(r"^#\s+(.+)$", b, re.M)
    if m:
        rest = b[m.end() : m.end() + 400]
        return (m.group(1) + " — " + re.sub(r"\s+", " ", rest))[:limit]
    lines = []
    for line in b.splitlines():
        s = line.strip()
        if not s or s.startswith("---") or s.startswith("## ") or s.startswith(">"):
            continue
        if s.lower().startswith("conversation archive"):
            continue
        if s.lower().startswith("dev session report"):
            continue
        lines.append(s)
        if sum(len(x) for x in lines) > limit:
            break
    return re.sub(r"\s+", " ", " ".join(lines))[:limit]


def heuristic_title(meta: dict, body: str, filename: str) -> str:
    snip = body_snippet(body, 500)
    # heading
    m = re.search(r"^#\s+(.+)$", body, re.M)
    if m:
        t = scrub(m.group(1)).strip()
        t = re.sub(r"\.(txt|md)$", "", t, flags=re.I)
        if 8 <= len(t) <= 80 and not looks_raw_title(t):
            return t[:80]
    # opening ask first clause
    ask = snip
    ask = re.split(r"[.!?]\s+", ask)[0]
    ask = re.sub(r"^(hi|hey|hello|please|can you|could you)\b[:,]?\s*", "", ask, flags=re.I)
    ask = scrub(ask).strip(" -:")
    # topic keywords
    low = (snip + " " + filename).lower()
    topic = None
    rules = [
        (r"smartshunt|battery|solar|ecoflow|delta|river", "Solar bank and EcoFlow packs"),
        (r"lala|hurricane|tropical storm", "Hurricane Lala solar desk notes"),
        (r"constitution", "RootMC constitution channel digest"),
        (r"vote.?shard", "Vote Shards membership notes"),
        (r"github account", "GitHub accounts inventory"),
        (r"upwork|coding agent", "Upwork vs coding-agent notes"),
        (r"gta|sa-mp|samp", "GTA SA-MP on Linux notes"),
        (r"elevenlabs|ellevenlabs|voice", "Voice / ElevenLabs wiring notes"),
        (r"websocket", "Websockets install notes"),
        (r"root.?goals|goals board", "Root Goals board notes"),
        (r"finance|wallet|stripe|mrr", "Finance and wallets notes"),
        (r"minecraft|rootmc|paper", "RootMC server work notes"),
        (r"cloudflare|pages|worker", "Cloudflare Pages / workers notes"),
        (r"discord", "Discord ops digest"),
        (r"big island|hawai", "Big Island land notes"),
        (r"youtube", "YouTube daily idea notes"),
        (r"lead.?dev", "Lead-dev role notes"),
        (r"ava.?ivy.?full.?context|full context", "Ava Ivy full context handoff"),
        (r"uptime|v1\.42|bot v1", "RootRecord bot uptime digest"),
        (r"llama|ssh|local.?model", "Local model over SSH notes"),
    ]
    for pat, label in rules:
        if re.search(pat, low):
            topic = label
            break
    if topic:
        return topic
    if ask and len(ask) >= 12:
        # shorten to ~8 words
        words = re.findall(r"[A-Za-z0-9ʻ']+", ask)
        words = [w for w in words if w.lower() not in {"the", "a", "an", "to", "of", "and", "or", "for", "in", "on", "my", "i", "you", "we"}]
        short = " ".join(words[:8])
        if short:
            return short[0].upper() + short[1:]
    stem = re.sub(r"\.(txt|md)$", "", filename, flags=re.I)
    stem = stem.replace("_", " ").replace("-", " ")
    stem = re.sub(r"\s+", " ", stem).strip()
    return (stem[:70] or "Dev session notes")


def ollama_title(snippet: str, hint: str) -> str | None:
    prompt = (
        "Write one public blog post title, max 70 characters. "
        "No quotes. No file extensions. No vendor brand names. "
        "Describe the topic, not the first chat message.\n"
        f"Hint filename: {hint}\n"
        f"Excerpt:\n{snippet[:700]}\n"
        "Title:"
    )
    payload = {
        "model": MODEL,
        "stream": False,
        "think": False,
        "messages": [{"role": "user", "content": prompt}],
        "options": {"temperature": 0.2, "num_predict": 40},
    }
    try:
        req = urllib.request.Request(
            OLLAMA,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read().decode())
        text = (data.get("message") or {}).get("content") or ""
        text = text.strip().strip('"').strip("'")
        text = re.sub(r"^(title:\s*)", "", text, flags=re.I)
        text = re.split(r"[\n\r]", text)[0].strip()
        text = scrub(text)
        if 8 <= len(text) <= 90 and not looks_raw_title(text):
            return text[:80]
    except Exception:
        return None
    return None


def unique_path(dir_: Path, stem: str, suffix: str, reserved: set[str]) -> Path:
    base = stem
    i = 0
    while True:
        name = f"{base}{suffix}" if i == 0 else f"{base}-{i}{suffix}"
        if name.lower() not in reserved and not (dir_ / name).exists():
            reserved.add(name.lower())
            return dir_ / name
        i += 1


def rewrite_post(path: Path, reserved: set[str], use_llm: bool) -> dict | None:
    raw = path.read_text(encoding="utf-8", errors="replace")
    meta, body = parse_frontmatter(raw)
    if not meta:
        return None
    old_slug = meta.get("slug") or path.stem
    old_title = meta.get("title") or ""
    date = meta.get("date") or datetime.now().strftime("%Y-%m-%d")
    snip = body_snippet(body)
    title = old_title
    if looks_raw_title(title) or path.stem.startswith(("archive-", "session-")):
        title = heuristic_title(meta, body, path.name)
        if use_llm and (looks_raw_title(old_title) or len(title) < 12):
            llm = ollama_title(snip or old_title, path.name)
            if llm:
                title = llm
    title = scrub(title).strip()
    if len(title) > 80:
        title = title[:77] + "…"
    # keep stable short digest from old slug so re-runs don't churn forever
    digest = hashlib.sha1(old_slug.encode()).hexdigest()[:6]
    new_slug = f"{date}-{slugify(title, 48)}-{digest}"
    new_path = unique_path(path.parent, new_slug, ".md", reserved)
    # if only title change and slug already good-ish
    if path.stem == new_path.stem and not looks_raw_title(old_title) and old_title == title:
        return None

    meta["slug"] = new_path.stem
    meta["title"] = title
    # refresh teaser if it looks like raw dump start
    teaser = meta.get("teaser") or ""
    if looks_raw_title(teaser) or teaser.lower().endswith((".txt", ".md")) or len(teaser) < 20:
        teaser = scrub(snip)[:180]
        meta["teaser"] = teaser
    meta["legacy_slug"] = old_slug

    lines = ["---"]
    order = ["slug", "date", "published", "title", "teaser", "brand", "categories", "legacy_slug"]
    seen = set()
    for k in order:
        if k in meta:
            v = meta[k]
            if k in ("title", "teaser"):
                v = v.replace('"', "'")
                lines.append(f'{k}: "{v}"')
            else:
                lines.append(f"{k}: {v}")
            seen.add(k)
    for k, v in meta.items():
        if k in seen:
            continue
        lines.append(f"{k}: {v}")
    lines.append("---")
    lines.append("")
    lines.append(body.lstrip("\n") if body.startswith("\n") else body)
    text = "\n".join(lines)
    if not text.endswith("\n"):
        text += "\n"

    tmp = path.with_suffix(".md.renaming")
    tmp.write_text(text, encoding="utf-8")
    if new_path.resolve() != path.resolve():
        tmp.replace(new_path)
        path.unlink(missing_ok=True)
    else:
        tmp.replace(path)
        new_path = path
    return {"old": path.name, "new": new_path.name, "title": title, "legacy_slug": old_slug}


def contextual_source_name(path: Path, use_llm: bool) -> str:
    raw = path.read_text(encoding="utf-8", errors="replace")[:2500]
    stem = path.stem
    title = heuristic_title({}, raw, path.name)
    if use_llm and looks_raw_title(stem.replace("-", " ") + ".txt"):
        llm = ollama_title(raw[:700], path.name)
        if llm:
            title = llm
    date_hint = ""
    # try parent folder date like "Aug 16th"
    parent = path.parent.name
    m = re.search(r"(Jan|Feb|Mar|Apr|May|Jun|Jul|July|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})", parent, re.I)
    if m:
        date_hint = slugify(f"{m.group(1)}-{m.group(2)}") + "-"
    digest = hashlib.sha1(str(path).encode()).hexdigest()[:5]
    return f"{date_hint}{slugify(title, 50)}-{digest}{path.suffix.lower()}"


def rename_sources(root: Path, use_llm: bool, label: str) -> list[dict]:
    if not root.is_dir():
        return []
    out: list[dict] = []
    files = [
        p
        for p in root.rglob("*")
        if p.is_file()
        and p.suffix.lower() in {".txt", ".md"}
        and p.name not in SKIP_NAMES
        and "node_modules" not in str(p)
        and p.parent.name != "reports"  # reports handled separately / already digests
    ]
    # Also include root-level reports? skip — those digests get renamed via reports/
    reserved_by_dir: dict[Path, set[str]] = {}
    for path in sorted(files):
        # skip already-clean names: lowercase slug-date style without spaces
        if " " not in path.name and not looks_raw_title(path.name) and not re.search(r"[A-Z]", path.stem[1:] if path.stem else ""):
            # still rename if stem looks like pasted first words
            if not looks_raw_title(path.stem + ".txt") and "_" not in path.stem[:3]:
                # keep clean kebab names that aren't first-message dumps
                if re.match(r"^[a-z0-9]+(-[a-z0-9]+)+$", path.stem) and not re.match(
                    r"^(hi|i-was|i-need|im-|how-to|read-the|look-at|we-are|ell-me)", path.stem
                ):
                    continue
        reserved = reserved_by_dir.setdefault(path.parent, {c.name.lower() for c in path.parent.iterdir()})
        new_name = contextual_source_name(path, use_llm=use_llm)
        if new_name.lower() == path.name.lower():
            continue
        dest = unique_path(path.parent, Path(new_name).stem, Path(new_name).suffix, reserved)
        if dest.resolve() == path.resolve():
            continue
        try:
            path.rename(dest)
        except OSError as e:
            out.append({"error": str(e), "old": str(path), "label": label})
            continue
        out.append({"old": str(path), "new": str(dest), "label": label})
    return out


def rename_report_digests(use_llm: bool) -> list[dict]:
    if not REPORTS.is_dir():
        return []
    reserved = {p.name.lower() for p in REPORTS.iterdir()}
    out = []
    for path in sorted(REPORTS.glob("*.md")):
        raw = path.read_text(encoding="utf-8", errors="replace")
        title = heuristic_title({}, raw, path.name)
        if use_llm and looks_raw_title(path.stem.replace("-", " ") + ".txt"):
            llm = ollama_title(raw[:700], path.name)
            if llm:
                title = llm
        # keep grok_ prefix lightly as source brand-neutral tag → "archive"
        digest = hashlib.sha1(path.name.encode()).hexdigest()[:6]
        stem = f"digest-{slugify(title, 48)}-{digest}"
        dest = unique_path(REPORTS, stem, ".md", reserved)
        if dest.name == path.name:
            continue
        path.rename(dest)
        out.append({"old": path.name, "new": dest.name})
    return out


def write_hdd_index() -> Path:
    DATA.mkdir(parents=True, exist_ok=True)
    rows = []
    if HDD_AICONV.is_dir():
        for p in sorted(HDD_AICONV.rglob("*")):
            if not p.is_file():
                continue
            if p.suffix.lower() not in {".txt", ".md", ".json", ".log", ".py"}:
                continue
            st = p.stat()
            rows.append(
                {
                    "rel": str(p.relative_to(HDD_AICONV)),
                    "bytes": st.st_size,
                    "mtime": int(st.st_mtime),
                }
            )
    out = DATA / "archives-aiconv-index.json"
    out.write_text(
        json.dumps(
            {
                "scanned_at": datetime.utcnow().isoformat() + "Z",
                "root": str(HDD_AICONV),
                "count": len(rows),
                "note": "Index only — files stay on Archives; no bulk copy.",
                "files": rows,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return out


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--no-llm", action="store_true", help="Heuristics only (faster)")
    ap.add_argument("--posts-only", action="store_true")
    ap.add_argument("--sources-only", action="store_true")
    args = ap.parse_args()
    use_llm = not args.no_llm

    DATA.mkdir(parents=True, exist_ok=True)
    idx = write_hdd_index()
    print(f"hdd index → {idx} ({json.loads(idx.read_text()).get('count')} files)")

    map_rows: list[dict] = []

    if not args.sources_only:
        reserved = {p.name.lower() for p in POSTS.iterdir()} if POSTS.is_dir() else set()
        # free names we're about to vacate
        posts = sorted(POSTS.glob("*.md")) if POSTS.is_dir() else []
        for path in posts:
            if path.name in SKIP_NAMES or path.name == "site-foundation.md":
                continue
            # drop from reserved so we can reclaim after unlink — unique_path checks exists
            reserved.discard(path.name.lower())
            row = rewrite_post(path, reserved, use_llm=use_llm)
            if row:
                map_rows.append({"kind": "post", **row})
                print(f"post  {row['old']} → {row['new']}")
                reserved.add(row["new"].lower())

    if not args.posts_only:
        for row in rename_report_digests(use_llm=use_llm):
            map_rows.append({"kind": "report", **row})
            print(f"report {row['old']} → {row['new']}")
        for row in rename_sources(AICONV, use_llm=use_llm, label="local"):
            map_rows.append({"kind": "source", **row})
            print(f"src   {Path(row['old']).name} → {Path(row['new']).name}")
        if HDD_AICONV.is_dir():
            for row in rename_sources(HDD_AICONV, use_llm=False, label="hdd"):
                # HDD: heuristics only (NTFS + many files); same naming logic
                map_rows.append({"kind": "source-hdd", **row})
                print(f"hdd   {Path(row['old']).name} → {Path(row['new']).name}")

    out_map = DATA / "blog-rename-map.json"
    out_map.write_text(json.dumps({"at": datetime.utcnow().isoformat() + "Z", "renames": map_rows}, indent=2), encoding="utf-8")
    print(f"renamed {len(map_rows)} → {out_map}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

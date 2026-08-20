#!/usr/bin/env python3
"""Blog source of truth = markdown in media/documents/reports/posts/.

You edit those files (or use http://127.0.0.1:8787/ops). This script rebuilds
the websites. No Cursor required.

  python3 /home/ava-core/ava/ava-core-v2/scripts/sync-blogs.py
  python3 .../sync-blogs.py --seed   # first time: copy existing posts into markdown
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

HST = ZoneInfo("Pacific/Honolulu")
AVA = Path("/home/ava-core/ava")
MEDIA_POSTS = AVA / "media" / "documents" / "reports" / "posts"
CORE = AVA / "ava-core-v2"
RMC_GEN = AVA / "workstations" / "rootmc-web" / "rootmc-web" / "scripts" / "write-blog-timeline.py"
RMC_JSON = RMC_GEN.with_name("_posts.json")
AVA_TS = CORE / "packages" / "web" / "avaivy.cloud" / "src" / "lib" / "blogPosts.ts"
RR_TS = CORE / "packages" / "web" / "rootrecord.online" / "src" / "lib" / "blogPosts.ts"
ALEX_TS = CORE / "packages" / "web" / "alexrs94.site" / "src" / "lib" / "blogPosts.ts"

BRANDS = ("ava", "rootrecord", "rootmc", "alex")
BRAND_LABEL = {"ava": "Ava", "rootrecord": "Root Record", "rootmc": "RootMC", "alex": "Alex"}

AVA_CATS = [
    ("runtime", "Runtime"),
    ("discord", "Discord"),
    ("identity", "Identity"),
    ("helm", "Helm"),
    ("ops", "Migrations"),
    ("minecraft", "Minecraft (link)"),
]
RR_CATS = [
    ("solar", "Solar"),
    ("kilauea", "Kīlauea"),
    ("goals", "Goals"),
    ("product", "Product"),
    ("ops", "Migrations"),
    ("minecraft", "Minecraft (link)"),
]
ALEX_CATS = [
    ("site", "Site"),
    ("solar", "Solar"),
    ("media", "Media"),
    ("ops", "Notes"),
]


def now_stamp() -> str:
    return datetime.now(HST).strftime("%Y-%m-%d %H:%M:%S HST")


def parse_fm(text: str) -> tuple[dict, str]:
    if not text.startswith("---"):
        return {}, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text
    meta: dict = {}
    pending = None
    acc: list[str] = []
    for line in parts[1].splitlines():
        if pending:
            if line.startswith("  - "):
                acc.append(line[4:].strip())
                continue
            meta[pending] = acc
            pending = None
            acc = []
        if not line.strip() or line.strip().startswith("#"):
            continue
        if line.endswith(":") and ":" not in line[:-1]:
            pending = line[:-1].strip()
            acc = []
            continue
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        k, v = k.strip(), v.strip().strip("\"'")
        if v == "":
            pending = k
            acc = []
        else:
            meta[k] = v
    if pending:
        meta[pending] = acc
    return meta, parts[2].lstrip("\n")


def split_sections(body: str) -> dict[str, str]:
    chunks = re.split(r"^##\s+(Bullets|After|Sources|BodyHtml)\s*$", body, flags=re.M)
    out = {"body": (chunks[0] if chunks else body).strip()}
    i = 1
    while i + 1 < len(chunks):
        out[chunks[i].lower()] = chunks[i + 1].strip()
        i += 2
    return out


def paras(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", text or "") if p.strip()]


def bullets(text: str) -> list[str]:
    out = []
    for line in (text or "").splitlines():
        s = line.strip()
        if s.startswith("- "):
            out.append(s[2:].strip())
    return out


def md_to_html(text: str) -> str:
    chunks = []
    for p in paras(text):
        if all(ln.strip().startswith("- ") for ln in p.splitlines() if ln.strip()):
            items = "".join(f"<li>{ln.strip()[2:]}</li>" for ln in p.splitlines() if ln.strip())
            chunks.append(f"<ul>{items}</ul>")
        else:
            chunks.append(f"<p>{p.replace(chr(10), ' ')}</p>")
    return "\n".join(chunks)


def load_brand(brand: str) -> list[dict]:
    folder = MEDIA_POSTS / brand
    folder.mkdir(parents=True, exist_ok=True)
    posts = []
    for path in folder.glob("*.md"):
        if path.name.lower() == "readme.md":
            continue
        meta, rest = parse_fm(path.read_text(encoding="utf-8"))
        sec = split_sections(rest)
        cats = meta.get("categories") or meta.get("category") or "ops"
        if isinstance(cats, str):
            cats = [c.strip() for c in cats.split(",") if c.strip()]
        brand_label = meta.get("brand") or BRAND_LABEL[brand]
        post = {
            "slug": meta.get("slug") or path.stem,
            "date": str(meta.get("date") or ""),
            "published": meta.get("published") or "",
            "title": meta.get("title") or path.stem,
            "teaser": meta.get("teaser") or "",
            "brand": brand_label,
            "categories": cats,
            "audio": meta.get("audio") if isinstance(meta.get("audio"), list) else [],
            "paragraphs": paras(sec.get("body") or ""),
            "bullets": bullets(sec.get("bullets") or ""),
            "after": paras(sec.get("after") or ""),
            "sources": bullets(sec.get("sources") or ""),
            "body": sec.get("bodyhtml") or md_to_html(sec.get("body") or ""),
        }
        if meta.get("html") in {"true", "yes", "1"} and not sec.get("bodyhtml"):
            post["body"] = rest.strip()
            post["paragraphs"] = []
        posts.append(post)
    posts.sort(key=lambda p: (p.get("published") or p.get("date") or "", p["slug"]), reverse=True)
    return posts


def js_str(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def emit_ts(path: Path, home: str, cats: list[tuple[str, str]], posts: list[dict], revised: str) -> None:
    brand_union = '"Ava" | "RootMC" | "Root Record" | "Alex"'
    cat_block = ",\n".join(f'  {{ id: "{i}", label: {js_str(l)} }}' for i, l in cats)
    items = []
    for p in posts:
        fields = [
            f'    slug: {js_str(p["slug"])}',
            f'    date: {js_str(p["date"])}',
            f'    title: {js_str(p["title"])}',
            f'    teaser: {js_str(p["teaser"])}',
            f'    brand: {js_str(p["brand"])}',
            f'    categories: {json.dumps(p["categories"])}',
            f'    paragraphs: {json.dumps(p["paragraphs"], ensure_ascii=False)}',
        ]
        if p.get("published"):
            fields.append(f'    published: {js_str(p["published"])}')
        if p.get("bullets"):
            fields.append(f'    bullets: {json.dumps(p["bullets"], ensure_ascii=False)}')
        if p.get("after"):
            fields.append(f'    after: {json.dumps(p["after"], ensure_ascii=False)}')
        if p.get("audio"):
            fields.append(f'    audio: {json.dumps(p["audio"], ensure_ascii=False)}')
        if p.get("sources"):
            fields.append(f'    sources: {json.dumps(p["sources"], ensure_ascii=False)}')
        items.append("  {\n" + ",\n".join(fields) + ",\n  }")
    joined = ",\n".join(items)
    body = (
        "/* GENERATED by scripts/sync-blogs.py — edit markdown in media/documents/reports/posts/, not this file. */\n"
        "export type BlogPost = {\n"
        "  slug: string;\n  date: string;\n  title: string;\n  teaser: string;\n"
        f"  brand: {brand_union};\n"
        "  paragraphs: string[];\n  bullets?: string[];\n  after?: string[];\n"
        "  audio?: string[];\n  sources?: string[];\n  published?: string;\n  categories: string[];\n};\n\n"
        f"export const HOME_BRAND: BlogPost[\"brand\"] = {js_str(home)};\n"
        "export const PAGE_SIZE = 8;\n"
        f"export const ARCHIVE_REVISED = {js_str(revised)};\n\n"
        "export const CATEGORIES: { id: string; label: string }[] = [\n"
        f"{cat_block},\n];\n\n"
        'const MEDIA_FILE = "https://avaivy.cloud/api/media/public/file?path=";\n\n'
        "export function mediaUrl(rel: string): string {\n"
        "  return MEDIA_FILE + encodeURIComponent(rel.replace(/^\\/+/, \"\"));\n}\n\n"
        "export function formatStamp(p: Pick<BlogPost, \"date\" | \"published\">): string {\n"
        "  if (p.published) {\n"
        "    const m = p.published.match(/^(\\d{4}-\\d{2}-\\d{2})T(\\d{2}:\\d{2}:\\d{2})(Z|[+-]\\d{2}:\\d{2})/);\n"
        "    if (m) {\n"
        "      const tz = m[3] === \"-10:00\" ? \"HST\" : m[3] === \"Z\" || m[3] === \"+00:00\" ? \"UTC\" : m[3];\n"
        "      return `${m[1]} ${m[2]} ${tz}`;\n"
        "    }\n"
        "    return p.published;\n"
        "  }\n"
        "  if (p.date.length === 7) return `${p.date} · month precision`;\n"
        "  return `${p.date} · day precision`;\n}\n\n"
        "export function datetimeAttr(p: Pick<BlogPost, \"date\" | \"published\">): string {\n"
        "  return p.published || (p.date.length === 7 ? `${p.date}-01` : p.date);\n}\n\n"
        f"export const POSTS: BlogPost[] = [\n{joined}\n];\n\n"
        "export function getPost(slug: string): BlogPost | undefined {\n"
        "  return POSTS.find((p) => p.slug === slug);\n}\n\n"
        "export function neighbors(slug: string): { older?: BlogPost; newer?: BlogPost } {\n"
        "  const i = POSTS.findIndex((p) => p.slug === slug);\n"
        "  if (i < 0) return {};\n"
        "  return {\n"
        "    newer: i > 0 ? POSTS[i - 1] : undefined,\n"
        "    older: i + 1 < POSTS.length ? POSTS[i + 1] : undefined,\n"
        "  };\n}\n"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


def write_md(brand: str, post: dict, html: bool = False) -> Path:
    folder = MEDIA_POSTS / brand
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{post['slug']}.md"
    cats = post.get("categories") or []
    if isinstance(cats, str):
        cats = [cats]
    lines = ["---", f"slug: {post['slug']}", f"date: {post.get('date','')}"]
    if post.get("published"):
        lines.append(f"published: {post['published']}")
    lines.append(f"title: {json.dumps(post.get('title') or '', ensure_ascii=False)}")
    lines.append(f"teaser: {json.dumps(post.get('teaser') or '', ensure_ascii=False)}")
    lines.append(f"brand: {post.get('brand') or BRAND_LABEL[brand]}")
    lines.append(f"categories: {', '.join(cats)}")
    if html:
        lines.append("html: true")
    audio = post.get("audio") or []
    if audio:
        lines.append("audio:")
        for a in audio:
            lines.append(f"  - {a}")
    lines.append("---")
    lines.append("")
    if html:
        lines.append(post.get("body") or "")
    else:
        for para in post.get("paragraphs") or []:
            lines.append(para)
            lines.append("")
        if post.get("bullets"):
            lines.append("## Bullets")
            lines.append("")
            for b in post["bullets"]:
                lines.append(f"- {b}")
            lines.append("")
        if post.get("after"):
            lines.append("## After")
            lines.append("")
            for a in post["after"]:
                lines.append(a)
                lines.append("")
        if post.get("sources"):
            lines.append("## Sources")
            lines.append("")
            for s in post["sources"]:
                lines.append(f"- {s}")
            lines.append("")
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return path


def seed_from_existing() -> None:
    import importlib.util

    spec = importlib.util.spec_from_file_location("rmcblog", RMC_GEN)
    assert spec and spec.loader
    # Temporarily hide _posts.json so hardcoded list is used
    hidden = None
    if RMC_JSON.is_file():
        hidden = RMC_JSON.with_suffix(".json.bak-seed")
        RMC_JSON.rename(hidden)
    try:
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        rmc_cats = getattr(mod, "CATS", {})
        stamps = getattr(mod, "STAMPS", {})
        for p in getattr(mod, "POSTS", []):
            p = dict(p)
            p["categories"] = rmc_cats.get(p["slug"], ["ops"])
            p["published"] = stamps.get(p["slug"], "")
            p["brand"] = "RootMC"
            dest = MEDIA_POSTS / "rootmc" / f"{p['slug']}.md"
            if not dest.exists():
                write_md("rootmc", p, html=True)
                print("seeded", dest)
    finally:
        if hidden and hidden.is_file() and not RMC_JSON.is_file():
            hidden.rename(RMC_JSON)

    for ts_path, brand in ((AVA_TS, "ava"), (RR_TS, "rootrecord")):
        data = dump_ts_posts(ts_path)
        for p in data:
            dest = MEDIA_POSTS / brand / f"{p['slug']}.md"
            if not dest.exists():
                write_md(brand, p, html=False)
                print("seeded", dest)


def dump_ts_posts(ts_path: Path) -> list[dict]:
    tsc = ts_path.parents[2] / "node_modules" / "typescript" / "bin" / "tsc"
    out = Path("/tmp/ava-blog-dump")
    out.mkdir(exist_ok=True)
    cmd = [
        "node",
        str(tsc),
        str(ts_path),
        "--outDir",
        str(out),
        "--module",
        "commonjs",
        "--esModuleInterop",
        "--skipLibCheck",
        "--target",
        "ES2020",
    ]
    subprocess.run(cmd, check=True, cwd=str(ts_path.parents[2]))
    js = out / "blogPosts.js"
    raw = subprocess.check_output(
        ["node", "-e", "const m=require('./blogPosts.js'); process.stdout.write(JSON.stringify(m.POSTS||m.POSTS_RAW||[]))"],
        cwd=str(out),
    )
    return json.loads(raw.decode())


def rmc_json_from_md(posts: list[dict], revised: str) -> list[dict]:
    out = []
    for p in posts:
        out.append(
            {
                "slug": p["slug"],
                "date": p["date"],
                "title": p["title"],
                "teaser": p["teaser"],
                "body": p.get("body") or "",
                "categories": p.get("categories") or ["ops"],
                "published": p.get("published") or "",
                "archive_revised": revised,
            }
        )
    return out


def main() -> int:
    seed = "--seed" in sys.argv
    MEDIA_POSTS.mkdir(parents=True, exist_ok=True)
    for b in BRANDS:
        (MEDIA_POSTS / b).mkdir(exist_ok=True)
        readme = MEDIA_POSTS / b / "README.md"
        if not readme.exists():
            readme.write_text(
                f"# {BRAND_LABEL[b]} blog posts\n\n"
                "Each `.md` file is one public post. Edit in a text editor or use "
                "http://127.0.0.1:8787/ops then run sync-blogs.py (the desk can do that too).\n",
                encoding="utf-8",
            )
    if seed:
        seed_from_existing()

    revised = now_stamp()
    ava = load_brand("ava")
    rr = load_brand("rootrecord")
    rmc = load_brand("rootmc")
    alex = load_brand("alex")
    if not ava and not rr and not rmc and not alex:
        print("No markdown posts yet. Run: python3 sync-blogs.py --seed", file=sys.stderr)
        return 1

    # Ava Ivy + Root Record share one merged public feed; alex / RootMC stay isolated.
    merged_ava_rr = sorted(
        list(ava) + list(rr),
        key=lambda p: (p.get("published") or p.get("date") or "", p.get("slug") or ""),
        reverse=True,
    )
    # preserve order: ava cats then rr-only
    seen = set()
    ordered_cats: list[tuple[str, str]] = []
    for pair in list(AVA_CATS) + list(RR_CATS):
        if pair[0] in seen:
            continue
        seen.add(pair[0])
        ordered_cats.append(pair)

    emit_ts(AVA_TS, "Ava", ordered_cats, merged_ava_rr, revised)
    emit_ts(RR_TS, "Root Record", ordered_cats, merged_ava_rr, revised)
    emit_ts(ALEX_TS, "Alex", ALEX_CATS, alex, revised)
    RMC_JSON.write_text(json.dumps(rmc_json_from_md(rmc, revised), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    subprocess.run([sys.executable, str(RMC_GEN)], check=True)

    # mirrors
    for src, dst in (
        (AVA_TS, AVA / "all-connections" / "vercel" / "avaivy.cloud" / "src" / "lib" / "blogPosts.ts"),
        (RR_TS, AVA / "all-connections" / "vercel" / "rootrecord.online" / "src" / "lib" / "blogPosts.ts"),
    ):
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")

    print(f"synced ava={len(ava)} rootrecord={len(rr)} rootmc={len(rmc)} alex={len(alex)} revised={revised}")
    print("Ava/Root Record/alexrs94 go live when GitHub auto-push runs (every 2 min) if Vercel is connected.")
    print("RootMC HTML is local; run publish-rootmc.sh to put it on the internet.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Public live data pages — /data and /data/{resource}.

Human + machine readable mirrors of the facts JSON APIs already expose.
"""
from __future__ import annotations

import html
import json

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse

from apps.core.services import live_data_pages, report_generation

router = APIRouter()


def _want_format(request: Request, format: str | None) -> str:
    want = (format or "").lower().strip()
    if want in {"md", "markdown", "json", "html"}:
        return "md" if want == "markdown" else want
    accept = (request.headers.get("accept") or "").lower()
    if "application/json" in accept:
        return "json"
    if "text/markdown" in accept:
        return "md"
    return "html"


def _page_html(title: str, body_md: str, *, json_href: str, md_href: str) -> str:
    safe = html.escape(body_md)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{html.escape(title)} — Ava live data</title>
  <style>
    :root {{ --bg:#0b1220; --text:#edf4ff; --muted:#91a0b5; --edge:#263449; --blue:#58c7ff; }}
    body {{ margin:0; font:16px/1.55 system-ui,sans-serif; background:var(--bg); color:var(--text); }}
    main {{ max-width:52rem; margin:0 auto; padding:1.5rem 1.25rem 3rem; }}
    h1 {{ font-size:1.6rem; margin:0 0 .5rem; }}
    p.lead {{ color:var(--muted); margin:0 0 1rem; }}
    nav a {{ color:var(--blue); margin-right:1rem; }}
    pre {{ overflow:auto; padding:1rem; border:1px solid var(--edge); border-radius:10px;
           background:#0a101a; font-size:13px; line-height:1.45; white-space:pre-wrap; }}
  </style>
</head>
<body>
<main>
  <nav><a href="/data">Live data</a><a href="{html.escape(md_href)}">Markdown</a><a href="{html.escape(json_href)}">JSON</a><a href="/context">Context</a></nav>
  <h1>{html.escape(title)}</h1>
  <p class="lead">Measured facts for reports. Do not invent watts or eruption state.</p>
  <pre>{safe}</pre>
</main>
</body>
</html>
"""


@router.get("/data")
@router.get("/data/")
async def data_hub(request: Request, format: str | None = None):
    want = _want_format(request, format)
    payload = live_data_pages.build_all()
    if want == "json":
        return JSONResponse(payload, headers={"Cache-Control": "public, max-age=30"})
    md = live_data_pages.to_markdown(payload)
    if want == "md":
        return PlainTextResponse(md, media_type="text/markdown; charset=utf-8")
    return HTMLResponse(
        _page_html("Live data hub", md, json_href="/data?format=json", md_href="/data?format=md")
    )


@router.get("/data/report-links")
@router.get("/data/report-links/")
async def report_links(request: Request, type: str = "morning", format: str | None = None):
    """Link bundle only — what to feed Grok for a report type."""
    want = _want_format(request, format)
    bundle = live_data_pages.link_bundle(report_type=type)
    if want == "json":
        return JSONResponse(bundle)
    lines = [
        f"# Report link bundle — {type}",
        "",
        f"Built: {bundle.get('built_hst')}",
        "",
        "## Context",
        "",
    ]
    for k, v in (bundle.get("context") or {}).items():
        lines.append(f"- {k}: {v}")
    lines += ["", "## Live data", ""]
    for row in bundle.get("resources") or []:
        lines.append(f"- **{row['title']}**: {row['md']}")
    md = "\n".join(lines) + "\n"
    if want == "md":
        return PlainTextResponse(md, media_type="text/markdown; charset=utf-8")
    if want == "json":
        return JSONResponse(bundle)
    return HTMLResponse(
        _page_html(
            f"Report links ({type})",
            md,
            json_href=f"/data/report-links?type={type}&format=json",
            md_href=f"/data/report-links?type={type}&format=md",
        )
    )


@router.get("/data/report-generation")
@router.get("/data/report-generation/")
async def report_gen_config(request: Request, format: str | None = None):
    """Public-safe view of per-type engine toggles (no secrets)."""
    want = _want_format(request, format)
    st = report_generation.status()
    safe = {
        "week_of_grok": st.get("week_of_grok"),
        "week_note": st.get("week_note"),
        "updated_at": st.get("updated_at"),
        "grok_halted": st.get("grok_halted"),
        "live_data_hub": st.get("live_data_hub"),
        "reports": {
            k: {
                "engine": v.get("engine"),
                "blog": v.get("blog"),
                "tts": v.get("tts"),
                "blog_brands": v.get("blog_brands"),
            }
            for k, v in (st.get("reports") or {}).items()
        },
        "context_url_count": len(st.get("context_urls") or []),
    }
    if want == "json":
        return JSONResponse(safe)
    md = "# Report generation toggles\n\n```json\n" + json.dumps(safe, indent=2) + "\n```\n"
    if want == "md":
        return PlainTextResponse(md, media_type="text/markdown; charset=utf-8")
    return HTMLResponse(
        _page_html(
            "Report generation",
            md,
            json_href="/data/report-generation?format=json",
            md_href="/data/report-generation?format=md",
        )
    )


@router.get("/data/{resource}")
@router.get("/data/{resource}/")
async def data_resource(resource: str, request: Request, format: str | None = None):
    if resource in {"report-links", "report-generation"}:
        return PlainTextResponse("Not found\n", status_code=404)
    payload = live_data_pages.build_resource(resource)
    if payload is None:
        return PlainTextResponse(f"Unknown resource: {resource}\n", status_code=404)
    want = _want_format(request, format)
    if want == "json":
        return JSONResponse(payload, headers={"Cache-Control": "public, max-age=30"})
    md = live_data_pages.to_markdown(payload)
    if want == "md":
        return PlainTextResponse(md, media_type="text/markdown; charset=utf-8")
    title = str(payload.get("title") or resource)
    return HTMLResponse(
        _page_html(
            title,
            md,
            json_href=f"/data/{resource}?format=json",
            md_href=f"/data/{resource}?format=md",
        )
    )

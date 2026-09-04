"""Visitor pages: product home, Kīlauea, weather, RootMC, geography, Ava chat."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse

from apps.core.services import geography as geo

router = APIRouter()
_ROOT = Path(__file__).resolve().parent.parent
_HTML = _ROOT / "templates" / "public-site.html"
_CHAT = _ROOT / "templates" / "ava-chat.html"
_STATIC_RR = _ROOT / "static" / "rootrecord"
_STATIC_GEO = _ROOT / "static" / "geography"


def _page() -> HTMLResponse:
    text = _HTML.read_text(encoding="utf-8") if _HTML.is_file() else "<p>page missing</p>"
    return HTMLResponse(text, headers={"Cache-Control": "no-store"})


def _file_or_none(path: Path):
    if path.is_file():
        return FileResponse(path, headers={"Cache-Control": "no-store"})
    return None


@router.get("/")
async def public_home():
    landing = _file_or_none(_STATIC_RR / "index.html")
    if landing is not None:
        return landing
    return _page()


@router.get("/products")
@router.get("/products.html")
@router.get("/pricing")
@router.get("/pricing.html")
@router.get("/about")
@router.get("/about.html")
@router.get("/faq")
@router.get("/faq.html")
@router.get("/contact")
@router.get("/contact.html")
@router.get("/account")
@router.get("/account.html")
@router.get("/account-signup")
@router.get("/account-signup.html")
@router.get("/billing")
@router.get("/billing.html")
@router.get("/discord-verify")
@router.get("/discord-verify.html")
async def product_page(request: Request):
    name = request.url.path.rstrip("/").split("/")[-1]
    if not name.endswith(".html"):
        name = name + ".html"
    found = _file_or_none(_STATIC_RR / name)
    if found is not None:
        return found
    return _page()


@router.get("/discord-verify.js")
@router.get("/account.js")
@router.get("/site-nav.js")
async def product_js(request: Request):
    name = request.url.path.rstrip("/").split("/")[-1]
    found = _file_or_none(_STATIC_RR / name)
    return found or HTMLResponse("", status_code=404)


@router.get("/kilauea")
@router.get("/kilauea/")
async def kilauea_page():
    for cand in (_STATIC_RR / "kilauea-alerts.html",):
        found = _file_or_none(cand)
        if found is not None:
            return found
    return RedirectResponse("https://kilauea.cloud/", status_code=302)


@router.get("/weather")
@router.get("/weather/")
async def weather_page():
    found = _file_or_none(_STATIC_RR / "rootrecord-weather-manager.html")
    if found is not None:
        return found
    return _page()


@router.get("/rootmc")
@router.get("/rootmc/")
async def rootmc_page():
    return RedirectResponse("https://rootmc.net/", status_code=302)


@router.get("/chat")
@router.get("/chat/")
async def ava_chat_page():
    text = _CHAT.read_text(encoding="utf-8") if _CHAT.is_file() else "<p>chat missing</p>"
    return HTMLResponse(text, headers={"Cache-Control": "no-store"})


@router.get("/api/site-config")
@router.get("/api/site-config.json")
async def site_config():
    return JSONResponse(
        {
            "apiBase": "https://rootrecord-api-account.rootrecord.workers.dev",
        },
        headers={"Cache-Control": "no-store"},
    )


@router.get("/api/geography/{product}")
async def api_geography(product: str, country: str = "", state: str = "", location: str = ""):
    fn = {"earthquakes": geo.earthquakes, "weather": geo.weather, "news": geo.news}.get(product)
    if not fn:
        return {"ok": False, "error": "Unknown geography product"}
    return fn(country, state, location)


@router.get("/api/earthquakes/global")
async def api_quakes_global():
    return geo.earthquakes()


@router.get("/api/news/global")
async def api_news_global():
    return geo.news()


def _geo_file(kind: str, rest: str):
    base = _STATIC_GEO / kind
    p = (base / rest).resolve()
    if base not in p.parents and p != base:
        return None
    if p.is_dir():
        p = p / "index.html"
    return _file_or_none(p)


@router.get("/earthquakes/{rest:path}")
async def earthquakes_pages(rest: str):
    found = _geo_file("earthquakes", rest)
    return found or HTMLResponse("<p>Not on this server.</p>", status_code=404)


@router.get("/news/{rest:path}")
async def news_pages(rest: str):
    found = _geo_file("news", rest)
    return found or HTMLResponse("<p>Not on this server.</p>", status_code=404)


@router.get("/states/{rest:path}")
async def states_pages(rest: str):
    found = _geo_file("states", rest)
    return found or HTMLResponse("<p>Not on this server.</p>", status_code=404)


@router.get("/css/{rest:path}")
async def geo_css(rest: str):
    found = _geo_file("css", rest)
    return found or HTMLResponse("", status_code=404)


@router.get("/js/{rest:path}")
async def geo_js(rest: str):
    found = _geo_file("js", rest)
    return found or HTMLResponse("", status_code=404)


@router.get("/charts/{rest:path}")
async def charts_pages(rest: str):
    p = (_STATIC_RR / "charts" / rest).resolve()
    if _STATIC_RR not in p.parents and not str(p).startswith(str(_STATIC_RR)):
        return HTMLResponse("<p>Not on this server.</p>", status_code=404)
    if p.is_dir():
        p = p / "index.html"
    return _file_or_none(p) or HTMLResponse("<p>Not on this server.</p>", status_code=404)


@router.get("/weather/{rest:path}")
async def weather_geo_pages(rest: str):
    found = _geo_file("weather", rest)
    return found or HTMLResponse("<p>Not on this server.</p>", status_code=404)

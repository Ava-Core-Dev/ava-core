# Solar / status board background images

How Ava Ivy’s rotating desk backgrounds work — for operators and for Emergent / coding agents.

## Where images live

Canonical media library (SSD):

```text
$AVA_HOME/media/images/character/
```

On this desk that is usually:

```text
/home/ava-core/ava/media/images/character/
```

Public files are served by Core:

```text
GET /api/media/public/file?path=images/character/<filename>
```

Only paths allowed by the media library’s public rules are exposed. Prefer PNG/JPEG/WebP in that folder. Do not put secrets or private dumps there.

## Rotation config (source of truth)

File (created/updated by API or hand-edit):

```text
media/images/character/site-backgrounds.json
```

Shape:

```json
{
  "version": 1,
  "updated_at": "2026-08-20T22:00:00Z",
  "pages": {
    "solar": {
      "label": "Solar / status board",
      "sites": [
        "avaivy.cloud/solar",
        "avaivy.cloud/status",
        "rootrecord.online/ava",
        "rootrecord.online/status"
      ],
      "cycle_seconds": 18,
      "paths": [
        "images/character/ava-solar-ground-pv-night.png",
        "images/character/ava-05-desk-root-server.png"
      ]
    }
  }
}
```

- `paths`: relative to the media library public root (`images/character/...`).
- `cycle_seconds`: `0` = single still; `>0` = crossfade interval.
- Missing file → Core falls back to built-in defaults in code.

Code:

- Service: `ava-core-v2/apps/core/services/site_backgrounds.py`
- Routes: `ava-core-v2/apps/core/routes/site_backgrounds.py`
- Ops UI: Core `/ops` (backgrounds section) and desk ops HTML

## How the solar board loads them

Template: `ava-core-v2/apps/core/templates/solar.html`

1. Two full-bleed layers `#bgA` / `#bgB` crossfade.
2. Fallback list is hardcoded if the API is down.
3. On load, JS calls `GET /api/site-backgrounds/solar` and replaces `BGS` with `page.urls`.
4. `setInterval(cycleBg, cycle_seconds * 1000)` swaps opacity between layers.

The home board on `avaivy.cloud/` iframes `/solar` from origin, so backgrounds follow the same API.

## How to change backgrounds (ops)

### A. Drop files + edit JSON

1. Copy images into `media/images/character/`.
2. Edit `site-backgrounds.json` → `pages.solar.paths`.
3. Hard-refresh `/solar` (or wait for next cycle reload).

### B. API

```http
GET  /api/site-backgrounds
GET  /api/site-backgrounds/solar
PUT  /api/site-backgrounds/solar
Content-Type: application/json

{
  "paths": [
    "images/character/ava-solar-ground-pv-night.png",
    "images/character/my-new-art.png"
  ],
  "cycle_seconds": 18,
  "label": "Solar / status board"
}
```

(Auth requirements follow Core ops rules — use desk/local origin when locked down.)

### C. Desktop client

Ava Desktop starts Core (`uvicorn` on `:8787`) with `AVA_HOME` pointing at the monorepo tree. Background APIs and the solar template are served from that Core process. Restart Core after Python service changes; HTML templates are re-read from disk each request.

## Rules of thumb

- Keep art edge-to-edge friendly (character + atmosphere). Side rails sit on top with translucent cards.
- Prefer dark / mid tones so white UI text stays readable; the `.veil` gradient also darkens slightly.
- Do not rename vendor folders into `character/` dumps; keep the folder for intentional public art.
- After changing files on the desk, GitHub auto-push (every ~2 min) syncs `ava-core` when the path is tracked. Large binaries may be gitignored — check `.gitignore` before assuming art is on GitHub.

## Related surfaces

| Surface | Background source |
|--------|-------------------|
| `avaivy.cloud/` home | iframe → Core `/solar` |
| `avaivy.cloud/solar` | rewrite/proxy → Core |
| `rootrecord.online/status` | same Core board when wired |
| OBS overlays | separate templates under `apps/core/templates/obs-*.html` / `overlays/` — not `site-backgrounds.json` |

## Quick verify

```bash
curl -sS http://127.0.0.1:8787/api/site-backgrounds/solar | jq .
curl -sS 'http://127.0.0.1:8787/api/media/public/file?path=images/character/ava-solar-ground-pv-night.png' -o /tmp/bg-test.png
```

# Public APIs

Base (edge): `https://ava.rootmc.net`  
Origin (tunnel): `https://ava-origin.rootmc.net`  
Alias boards: `https://rootrecord.info/ava/...`

CORS is open on the public JSON endpoints below (`Access-Control-Allow-Origin: *`).

## Context (GEO / agents)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/context` | JSON schema `ava-core-context/v1` |
| GET | `/context` | HTML |
| GET | `/context?format=md` | Markdown |
| GET | `/context?format=json` | JSON |

Canonical human page: https://rootrecord.info/ava/context

## Presence / chat

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/ava-hours` | Awake/asleep, typical HST hours, bank % |
| POST | `/api/public-chat` | Body `{ "question" \| "message": "..." }` → `{ ok, answer, solarPowered }` |
| OPTIONS | `/api/public-chat` | CORS preflight (edge allows POST) |

## Ops display

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | Process health |
| GET | `/api/status` | Ops status JSON |
| GET | `/api/solar` | Solar / bank series |
| GET | `/api/powered-by` | Last-hour CPU, RAM, SOC for footer widget |
| GET | `/api/connections?hours=24&bucket=hour` | Gaming / web / apps + packets/bytes |

## HTML boards

| Path | Board |
|------|-------|
| `/solar` · `/status` | Solar / status |
| `/connections` | Connections |
| `/logs` | Process logs |
| `/plugins` · `/apps` | Build / release boards |
| `/services` | Services |

## Chat body example

```http
POST /api/public-chat HTTP/1.1
Host: ava.rootmc.net
Content-Type: application/json

{"question":"What is Ava?","authorName":"visitor","context":"rootmc.net home chat"}
```

```json
{"ok":true,"answer":"…","solarPowered":true}
```

## Rules for integrators

- Prefer live `/api/context` over cached repo snapshots for “what is Ava right now?”
- Do not send secrets in chat payloads
- Treat answers as public-facing; do not expect private operator digs through this API
- Professional Root Record product reports must not include Ava ops internals — that is a content policy on those Workers, separate from this chat API

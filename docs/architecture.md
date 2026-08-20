# Ava Architecture — Clean Build v2.0

## Principle: Cloudflare is proxy + fallback only

All scheduling, intelligence, and data processing runs on the local OptiPlex.
Cloudflare Workers only:
1. Proxy requests to the local origin via cloudflared tunnel
2. Serve static pages when origin is unreachable (offline page, cached content)
3. Stand by with fallback cron logic that no-ops while Ava is awake

## Heartbeat gate

Ava writes a row to D1 every 60 seconds. Each CF Worker's `scheduled()` handler
checks this before running. Fresh heartbeat (< 2 min) = Ava is awake = stand down.
Stale or missing = Ava is offline = CF runs fallback logic.

## Domain map

| Domain | Worker | Purpose |
|---|---|---|
| `avaivy.cloud` | `ava-api` | Ava API + public identity site |
| `rootrecord.online` | `rootrecord-api` | Kilauea, NWS, USGS, hourly ops |
| `rootmc.info` | `rootmc-api` | Minecraft API (economy, RCON, players) |
| `alexrs94.site` | (foundation) | Personal site (solar + media + YouTube) |

## Report publishing policy

Automations generate report drafts and save them locally first.
Operator review is required before public posting.
Draft queue endpoint: `/api/reports/queue`.

## Service architecture

```
systemd
├── ava-core.service      FastAPI :8787 (main server + scheduler + heartbeat)
├── ava-tunnel.service    cloudflared (independent, always restarts)
└── ava-voice.service     Stream Director + voice plugin loop

Cloudflare Tunnel
└── ava-origin.rootmc.net → :8787
└── site-origin.rootmc.net → :8787
└── ava.rootmc.net → :8787
```

## Audio priority

P3 Critical   — earthquake / eruption alerts (interrupt + pause current)
P2 Scheduled  — hourly chime, time announcements
P1 Report     — weather, solar, economy, volcano reports (queued FIFO)
P0 Ambient    — rotating MP4 playlist (paused by everything)

## #updates channel rule

Only `merged-morning-summary` (10:05 HST) posts to #updates.
All other automated reports go to #automations only.

## Key paths (after migration)

| Path | Contents |
|---|---|
| `apps/core/` | FastAPI server, config, scheduler, heartbeat, routes, services, crons |
| `apps/voice/` | Stream Director, TTS, clips, plugin ports |
| `packages/workers/` | CF Workers (TypeScript) |
| `packages/web/` | Vercel frontends (Next.js, not yet scaffolded) |
| `data/` | Runtime data — gitignored |
| `systemd/` | Service units |
| `config/` | cloudflared tunnel config |

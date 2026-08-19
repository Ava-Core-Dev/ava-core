# Ava — Clean Build

Ava Ivy runtime for the HI Pacific Solar Root Server.

## Structure

```
ava/
├── apps/core/          Python-primary FastAPI server (:8787)
├── apps/voice/         Voice pipeline + Stream Director
├── apps/desktop/       Electron desktop client (symlink to current)
├── packages/workers/   Cloudflare Workers (TypeScript)
├── packages/web/       Vercel frontends (Next.js)
├── data/               Runtime data — gitignored
├── scripts/            start.sh, install.sh, migrate.sh
├── systemd/            Service units
├── config/             cloudflared tunnel config
└── docs/               Architecture notes
```

## Quick start

```bash
# One-time setup
./scripts/install.sh

# Start everything
./scripts/start.sh

# Start core only
cd apps/core && uvicorn main:app --host 0.0.0.0 --port 8787 --reload
```

## Domains (new CF account)

| Domain | Purpose |
|---|---|
| `rootmc.info` | Minecraft API |
| `avaivy.cloud` | Ava API + public identity site |
| `rootrecord.online` | Real-world ops API (Kīlauea, NWS, reports) |

Cloudflare is proxy + fallback only. All scheduling and intelligence runs on this device.

# Canonical public domains

Operations use **three** hostnames only:

| Domain | Role |
|--------|------|
| **avaivy.cloud** | Ava Ivy — solar desk, wiki, goals, finance, blog |
| **rootrecord.online** | Root Record — products, account, billing, services |
| **rootmc.net** | RootMC — Minecraft server site |

## Forwards (legacy / personal)

| From | To |
|------|-----|
| rootrecord.info | rootrecord.online (301, same path) |
| www.rootrecord.info | rootrecord.online |
| alexrs94.site | Personal site (Alex only); links out to the three ops domains |

App subdomains (business.rootrecord.info, weather.rootrecord.info, api.*) stay on Workers until migrated — public marketing links should prefer **rootrecord.online** paths.

## Desk / API origin

- **ava-origin.rootmc.net** — tunnel to desk `:8787` (OAuth callbacks, `/api/*`, solar HTML)
- **api.rootrecord.online** — Worker proxy to origin when awake
- **api.avaivy.cloud** — same pattern via ava-api Worker

## Deploy

Frontends (Next static export or Vercel):

```bash
bash scripts/deploy-public-sites.sh
```

Workers + account API (Cloudflare):

```bash
cd packages/workers && npx wrangler deploy -c wrangler.ava-api.toml
cd packages/workers && npx wrangler deploy -c wrangler.rootrecord-api.toml
```

GitHub auto-push (`scripts/github-auto-push-toggle.sh on`) syncs git; run deploy script after push or on a timer locally.

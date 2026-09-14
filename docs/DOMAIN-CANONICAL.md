# Canonical public domains

Public door is **rootrecord.cloud**. Legacy `.info` / `.online` hold or redirect — they are not the home.

| Domain | Role |
|--------|------|
| **rootrecord.cloud** | Vercel public home, status desk, product pages, app API |
| **avaivy.cloud** | Vercel Ava wiki / blog / context — no iframe mask of the status desk |
| **rootmc.net** | RootMC site |
| **api.rootmc.net** | Minecraft API only (not Ava origin) |
| **play.rootmc.net** | Java Edition join |
| **kilauea.cloud** | Kīlauea app site |
| **origin.avaivy.cloud** | Tunnel to this PC `:8787` |

## Holding / legacy

| Domain | Role |
|--------|------|
| **rootrecord.info** | Holding or 301 — not the public door |
| **rootrecord.online** | Holding or 301 — not the public door |
| **www.rootrecord.cloud** | Same site as apex when DNS is live |

## Desk / API origin

- **origin.avaivy.cloud** — Cloudflare tunnel → `127.0.0.1:8787`
- The Cloudflare Worker on **rootrecord.cloud** remains the rollback path while Vercel cutover is verified; Vercel owns the production website after DNS promotion
- Do not put Ava origin on `*.rootmc.net`

## Live check (3 Sep 2026 cutover)

| Host | Result |
|------|--------|
| rootrecord.cloud `/` `/status` `/kilauea` `/weather` `/rootmc` | 200 |
| avaivy.cloud `/` | 200 |
| rootmc.net `/` | 200 |
| kilauea.cloud `/` | 200 |
| api.rootmc.net `/` | 200 |
| origin.avaivy.cloud `/health` | 200 |
| rootrecord.info `/` | 200 (holding) |
| rootrecord.online `/` | 301 |
| www.rootrecord.cloud `/` | 503 this check |
| play.rootmc.net HTTP | timed out this check (Java join is TCP 25565, not required on HTTP) |
| local `127.0.0.1:8787/health` | 200 |

Re-run GETs when verifying. Do not invent uptime.

## Deploy notes

Workers live under `packages/workers`. Frontends under `packages/web`. Ava origin is localhost only.

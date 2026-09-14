# all-connections

**Combined working tree for the entire Ava Ivy · Root Record · RootMC public and operator surface.**

This repository exists so agents (Emergent, Cursor, Copilot, humans) can edit **websites, Workers, the Ava desktop client, and the Python origin** with one map. It is a snapshot of sources from the SSD monorepo (`Ava-Core-Dev/ava-core` + `workstations/`). It is **not** a license to commit secrets.

| Field | Value |
|---|---|
| Org | [Ava-Core-Dev](https://github.com/Ava-Core-Dev) |
| Related live core | [Ava-Core-Dev/ava-core](https://github.com/Ava-Core-Dev/ava-core) |
| Older Emergent dump | `Ava-Core-Dev/rootmc-emergent` (superseded by this map + desktop) |
| Operator | Ava Ivy · `root@rootrecord.info` |
| Game join | `play.rootmc.net` |
| Discord invite | https://discord.gg/rFFQYrNaqS |

**Read `AGENTS.md` first** (stack rules, Discord home, what not to break).

---

## 1. How the ecosystem is shaped

Three brands, one operator:

1. **RootMC** — Minecraft network (survival, Gold, claims, votes, plugins). Public site `rootmc.net`. Join `play.rootmc.net`.
2. **Root Record** — real-life / solar / goals / weather / “The Root.” Sites `rootrecord.online`, `rootrecord.info`, Goals `g.rootrecord.info`.
3. **Ava Ivy** — the Root Server: Python origin on the OptiPlex, Electron **Ava Ivy** desktop, public boards on `ava.rootmc.net` / `avaivy.cloud`.

Traffic pattern:

```
Players / browsers
    ├─ rootmc.net          → Cloudflare Pages (rootmc-web)  [HTML/wiki]
    │                         /api/* → Worker rootmc-api  (must be api.rootmc.net)
    ├─ api.rootmc.net      → Worker rootmc-api (D1 + Hyperdrive MySQL)
    ├─ ava.rootmc.net      → Worker ava-edge and/or tunnel → FastAPI :8787
    ├─ ava-origin.rootmc.net → Cloudflare Tunnel → FastAPI :8787
    ├─ avaivy.cloud        → Vercel Next.js
    ├─ rootrecord.online   → Vercel Next.js
    ├─ g.rootrecord.info   → Worker rootrecord-api-goals (D1 root-record)
    └─ play.rootmc.net     → Minecraft proxy (not HTTP)

Operator box (Ava)
    ├─ Electron  ava-desktop/   (this repo)
    ├─ uvicorn   ava-origin-python/  :8787
    ├─ poller    rootmc/discord-slack-poller/
    └─ Ollama    127.0.0.1:11434  (ava-ivy, qwen3:8b, nomic-embed-text)
```

**Known breakage (2026-08-19):** `api.rootmc.net` was observed answering as Ava FastAPI (`{"ok":true,"uptime_s":…}`) instead of Worker `{"service":"rootmc-api"}`. Plugins and the homepage activity card depend on the Worker. Homepage `home.js` falls back to `https://rootmc-api.root-337.workers.dev`. Do not “fix” that by pointing more hostnames at `:8787`.

---

## 2. Tree in this repo (edit here)

```
all-connections/
  AGENTS.md                      ← operating rules
  README.md                      ← this file (URL atlas)
  ava-desktop/                   ← Electron Ava Ivy client (FULL)
  ava-origin-python/             ← FastAPI origin (apps/core)
  vercel/avaivy.cloud/           ← Next.js
  vercel/rootrecord.online/      ← Next.js (goals pages copy)
  rootmc/site-pages/             ← Cloudflare Pages source (public/)
  rootmc/api-worker/             ← Wrangler entry for rootmc-api
  rootmc/realm-api/              ← Realm router (time, economy, Discord, Stripe)
  rootmc/site-edge/              ← Apex cache worker (optional)
  rootmc/ava-edge/               ← ava.rootmc.net edge
  rootmc/discord-slack-poller/   ← Node poller (Discord + Slack + Telegram)
  rootmc/android-web-app/        ← rootmc-app
  rootmc/webstat-proxy/          ← claims.rootmc.net / towny.rootmc.net
  rootmc/bluemap-worker/         ← map.rootmc.net
  rootrecord-workers/            ← Goals, weather, kilauea, license, primary, …
  ava-packages-workers/          ← extra wrangler tomls / src
```

Desktop **is** in scope: `ava-desktop/main.mjs`, `lib/avaLifecycle.mjs`, `lib/avaBridge.mjs`, `lib/opsCommands.mjs`, `lib/avaLinks.mjs`, `lib/connectionConfig.mjs`, `renderer/`. Python routes used by the GUI live in `ava-origin-python/routes/` (status, crons, chat, media, reports, minecraft, …).

---

## 3. Entire public URL network

Hosts below are the live (or intended) network. Paths are relative to that host unless noted.

### 3.1 Minecraft join (not a website)

| URL / address | What it is |
|---|---|
| `play.rootmc.net` | **Official production join.** Closed-loop Gold, claims, mcMMO, votes, ranks. One primary survival world. |
| `test.rootmc.net` | Paper test / webstat (`:8765` on host). Not the public survival map. |

### 3.2 RootMC — `https://rootmc.net`

Marketing + wiki + data. Source: `rootmc/site-pages/public/`. Deploy: Cloudflare Pages project `rootmc-web`. Custom domains also: `developer.rootmc.net`, `slack.rootmc.net` (redirects to Slack).

#### Core pages

| Path | What the page does |
|---|---|
| `/` | Network home. Hero, Official Activity (timezone / peak / quiet — `home.js`), join CTA, vote list, weekly awards teaser, wiki/data cards. |
| `/data/` | Data hub (redesign). Links to live metrics vs `/old/` archive. |
| `/data/official/` | Official-server scoped data. |
| `/data/claims/` | Claims dataset views. |
| `/data/towny/` | Towny dataset views. |
| `/data/dataset/` | Generic dataset explorer. |
| `/data/servers/` | Server list / presence. |
| `/data/servers/host/` | Per-host server detail. |
| `/mesh/` | Transfer mesh explainer (servers that recognize each other via API, vanilla-style moves). |
| `/wiki/` | Wiki hub (join, linking, towns, commands). |
| `/wiki/player/` | Player-facing handbook (claims, `/link`, awards). |
| `/wiki/economy/` | Gold loop, reserve, tax, inactivity, mint, shops. |
| `/wiki/constitution/` | Constitution: votes, treasury, grants, inactivity tax, governance power. |
| `/wiki/claims/` | Root-Claims circles, tax-free first plot, expansions. |
| `/wiki/territories/` | Territory buffers / ranks. |
| `/wiki/weekly-awards/` | Sunday 08:00 HST Top Participator + Top Active Player. |
| `/wiki/plugins/` | Plugin suite catalog. |
| `/wiki/plugins/api/` | Public API map for the site + `api.rootmc.net`. |
| `/wiki/plugins/network-setup/` | How a Paper host binds to the network (`cloud.yml`, license). |
| `/wiki/versioning/` | Versioning policy. |
| `/wiki/map-26-2/` | Map 26.2 notes / reserve activity. |
| `/updates` (nav) | Community updates (often Discord `#updates` pointer). |
| `/history/` | Network history (identities: play / web / API). |
| `/tokens` (nav) | Token / $ROOTMC paper-unit explainer (price via API, not wallets). |
| `/plugins/` | Download hub for the suite (Core, Times, Perms, …). |
| `/plugins/root-*` | **One page per plugin** (commands, config, catalog). Includes Root-Core, Root-Claims, Root-Economy, Root-Times, Root-Webstat, Root-Memberships, Root-Market, Root-Skills, Root-Territories, Root-Upkeep, Root-Referrals, Root-Appreciation, Root-Bonds, Root-Loans, Root-Gamble, Root-Haste, Root-Heads, Root-Discord, Root-Ops, Root-Play, Root-Spawn, Root-Restart, Root-Rewards, Root-Admin, Root-Announcer, Root-Banner, Root-Activity, Root-Mapper, Root-Chestshops, Root-Iteminfo, Root-Joint, Root-Ping, Root-Potions, Root-Ranks, Root-Torch, Root-Try, Root-Ava-Core, RootMC Official, RootMC Shops, Root-Bluemap-R2-fix, RootHelp, etc. |
| `/developer/` | Developer portal (product keys, My Servers). Also `https://developer.rootmc.net/developer/`. |
| `/developer/register/` | Discord OAuth register for keys. |
| `/developer/login/` | Developer login. |
| `/developer/keys/` | Product keys. |
| `/developer/servers/` | My Servers list. |
| `/developer/servers/manage/` | Per-server manage. |
| `/login/` | Player Login/Register (Discord). Stats after `/link`. |
| `/my-stats/` | Linked player public/private stats. |
| `/pro/` | Pro membership pitch + live funding stats (`memberships/stats`). |
| `/pro/monthly/` `/pro/one-month/` `/pro/lifetime/` | Checkout SKUs. |
| `/pro/vote-shards/` | Vote Shards product page. |
| `/vote-shards/` | Buy Council weight ($1 = 100 shards). Separate from Gold. |
| `/economy/` | Economy landing (often points at live vs archive). |
| `/governance/` | Governance hub (bills, votes, council). |
| `/governance/bills/` `/governance/bill/` | Bill list / one bill. |
| `/governance/proposals/` `/governance/proposal/` | Proposals. |
| `/governance/submit/` | Submit proposal. |
| `/governance/vote/` | Vote UI. |
| `/governance/council/` | Council. |
| `/governance/grant/` | Grants. |
| `/council/` | Council alias. |
| `/referrals/` | Referral qualify + milestones. |
| `/thanks/` | Appreciation / thanks. |
| `/terms/` | Terms. |
| `/verify/` | Verification helper. |
| `/servers/` | Public server directory. |
| `/blog/` | Blog. |
| `/packs/` | Resource packs (if present). |
| `/tools/vote-sites/` | Vote-site opener zip (Windows `.bat` / Linux `.sh`). |
| `/s/` | Compact “server card” pages. |
| `/s/player/` `/s/economy/` `/s/market/` `/s/time/` `/s/leaderboard/` `/s/resources/` `/s/daily-report/` | Slim embeds / per-server widgets. |
| `/old/` | **Archive** of previous Data UI (keep for bookmarks). |
| `/old/time/` `/old/time/old/` | Time systems explainer vs **live activity dashboard** (charts, timezone pie). |
| `/old/market/` `/old/economy/` `/old/mint/` `/old/reserve/` `/old/player/` `/old/leaderboard/` `/old/health/` `/old/resources/` `/old/balances/` `/old/daily-report/` `/old/list/` | Archived live boards. |
| `/old/economy/official/` `/old/economy/claims/` `/old/economy/towny/` `/old/economy/bonds/` `/old/economy/all-servers/` | Scoped archive economy. |
| `/old/g2/` | Gen-2 UI archive (`api2` era). Subpages: market, mint, time, player, reserve, resources, leaderboard, daily-report, economy/bonds. |
| `/404.html` `/502.html` | Error pages with join CTA. |

#### RootMC API (must be Worker)

Base: **`https://api.rootmc.net`** (custom domain on worker `rootmc-api`). Source: `rootmc/api-worker` + `rootmc/realm-api`.

| Path (prefix `/api`) | What it does |
|---|---|
| `/health` or `/` | Worker health (`service: rootmc-api`, D1 ping). |
| `/api/rootmc/time/local` | Viewer-local clock, peak join window, quiet/maintenance window, last-hour players. **Home activity card.** |
| `/api/rootmc/activity/timezones` | Play share by UTC band; peaks remapped to viewer TZ. |
| `/api/rootmc/time/charts` | Time-series for `/time/old` charts. |
| `/api/rootmc/stock-market/items` | Market tape / shops. |
| `/api/rootmc/memberships/stats` | Paid Pro / Lifetime / MRR (dev-funding gate). |
| `/api/rootmc/weekly-activity/highlights` | Weekly awards payload. |
| `/api/rootmc/host-metrics/summary` | Host CPU/disk (health.js). |
| `/api/rootmc/host-presence/summary` | Presence days. |
| `/api/rootmc/connection-preference` | Client connection preference. |
| `/api/rootmc/solar-mining-multiplier` | Gold boost from solar/bank SOC. |
| `/api/rootmc/daily-report` | Daily report JSON. |
| `/api/governance/*` | Voting power, bills. |
| `/api/developer/*` | Product keys, Discord OAuth start. |
| `/api/account/*` | Player account (not RootRecord billing). |
| `/v1/discord/rootmc/callback` | Discord OAuth. |
| `/v1/discord/rootmc/interactions` | Slash commands. |
| `/v1/stripe/webhook` | Stripe. |

Workers.dev probe: `https://rootmc-api.root-337.workers.dev`.

#### Other RootMC hostnames

| Host | What it does |
|---|---|
| `https://www.rootmc.net` | Same site as apex. |
| `https://developer.rootmc.net` | Pages alias → `/developer/*`. |
| `https://slack.rootmc.net` | Redirect into RootMC Slack. |
| `https://claims.rootmc.net` | Webstat proxy (claims). Worker `rootmc-webstat-proxy`. |
| `https://towny.rootmc.net` | Webstat proxy (towny). |
| `https://map.rootmc.net` | BlueMap / R2 map. Worker `rootmc-minecraft-map`. |
| `https://app.rootmc.net` | Pages `rootmc-app` (companion web/app). |
| `https://api-local.rootmc.net` | Tunnel to local edge `:8791` (dev). |
| `https://api-ava.rootmc.net` | Tunnel alias (dev). |
| `https://site-origin.rootmc.net` | Tunnel to `:8787` as HTML origin (often stale if tunnel down). |
| `https://site-local.rootmc.net` | Local site origin. |
| `https://ava-local-api.rootmc.net` | Local API on Ava tunnel (other CF account). |

`api.rootmc.info` / `api2.rootmc.net` — **retired or NXDOMAIN**. Do not teach agents to use `.info` for RootMC API.

---

### 3.3 Ava public boards — `https://ava.rootmc.net` and origin

Python routes: `ava-origin-python/routes/status.py` and friends. Tunnel hostnames: `ava.rootmc.net`, `ava-origin.rootmc.net`. Local: `http://127.0.0.1:8787`.

| URL | What it does |
|---|---|
| `https://ava.rootmc.net/` | Status / solar board (or redirect). Battery, solar, load, CPU, Gold multiplier. |
| `https://ava.rootmc.net/solar` | Solar board via tunnel. |
| `https://ava.rootmc.net/health` | JSON liveness (`ok`, `uptime_s` on FastAPI). |
| `https://ava.rootmc.net/economy` | Live Root-Economy: wallets, ledger, gold, playtime. |
| `https://ava.rootmc.net/finance` | Public ops expenses + optimal monthly budget. |
| `https://ava.rootmc.net/publicfiles/` | Download jars / APKs / AABs (not private media). |
| `https://ava.rootmc.net/phpmyadmin/` | phpMyAdmin (MySQL on host). |
| `https://ava.rootmc.net/minecraft` | Minecraft status page (test Paper). |
| `https://ava-origin.rootmc.net/` | Direct tunnel to FastAPI (same app). |
| `https://ava-origin.rootmc.net/api/webhooks/vercel` | Vercel build-log ingest (HMAC). Errors → `media/documents/docs/vercel-builds/`. |
| `GET /api/status` | CPU/mem/uptime/heartbeat. |
| `GET /api/solar` | Solar JSON. |
| `GET /api/context` | AI pickup blob. |
| `GET /api/powered-by` | Powered-by widget. |
| `GET /api/ava-hours` | Open hours. |
| `POST /api/public-chat` | Guest chat (merged homepage). |
| `GET/POST /api/crons` `/api/crons/{id}/run` | List / fire origin crons (desktop Terminal). |
| `GET /api/crons/runs` | MySQL `ava_cron` history. |
| `GET /api/media/public` | Public media catalog (**blocks private/**). |
| `GET /api/reports/subscribers` | Public report DM subscribers. |
| `POST /api/voice/play` | Queue a voice clip (desktop/OBS). |
| `GET /docs` | FastAPI docs **only if** `AVA_ENV=development`. |

**rootrecord.info Ava atlas** (human + AI wiki, often same boards under `/ava/`):

| URL | What it does |
|---|---|
| `https://rootrecord.info/` | Root Record marketing / data-center story. |
| `https://rootrecord.info/timeline` | Infrastructure evolution timeline (Jan–Aug 2026 backfill). |
| `https://rootrecord.info/account` | Account / sign-in. |
| `https://rootrecord.info/ava/` | Ava wiki hub (human atlas). |
| `https://rootrecord.info/ava/timeline` | Same timeline, wiki chrome. |
| `https://rootrecord.info/ava/status` | Canonical status/solar. |
| `https://rootrecord.info/ava/status/connections` | Players · servers · app sessions. |
| `https://rootrecord.info/ava/status/services` | Services panel. |
| `https://rootrecord.info/ava/status/minecraft` | Paper test status. |
| `https://rootrecord.info/ava/logs` | Process activity (no message bodies). |
| `https://rootrecord.info/ava/context` | HTML context dump for any AI. |
| `https://rootrecord.info/ava/context.md` | Markdown context. |
| `https://rootrecord.info/ava/core.html` | Core architecture page. |
| `https://rootrecord.info/ava/brains.html` | Brain ladder (Grok / Ollama / Cursor). |
| `https://rootrecord.info/ava/crons.html` | Cron catalog. |
| `https://rootrecord.info/ava/data.html` | Data stores. |
| `https://rootrecord.info/ava/surfaces.html` | Surfaces map. |
| `https://rootrecord.info/ava/hosting.html` | Hosting. |
| `https://rootrecord.info/ava/rootmc.html` | RootMC chapter. |
| `https://rootrecord.info/ava/root-record.html` | Root Record chapter. |
| `https://rootrecord.info/ava/glossary.html` | Glossary. |
| `https://merged.rootrecord.info/` | Merged homepage + Ava public chat (“The Root” bridge). |

---

### 3.4 avaivy.cloud (Vercel Next.js)

Source: `vercel/avaivy.cloud/`.

| Path | What it does |
|---|---|
| `/` | Ava Ivy public site home. |
| `/login` | Login. |
| `/status` | Status. |
| `/status/goals` | Goals status. |
| `/media` | Public media. |
| `/context` | Context page. |
| `/wallets` | Wallets UI. |
| `/blog` | Blog. |
| `/api/chat` | Proxies chat toward origin (`AVA_ORIGIN_URL` / `ava-origin.rootmc.net`). |

---

### 3.5 rootrecord.online (Vercel Next.js)

Source: `vercel/rootrecord.online/`.

| Path | What it does |
|---|---|
| `/` | Root Record home. |
| `/login` | Login. |
| `/status` | Status. |
| `/blog` | Blog. |
| `/goals` | Goals list (UI). |
| `/goals/new` | Create goal — membership overlay for non-members. |
| `/goals/[id]` | One goal. |

Live Goals **API + overlay** is the Worker, not only this Next app:

| URL | What it does |
|---|---|
| `https://g.rootrecord.info` | Goals app (worker). Lifetime member: `root@rootrecord.info`. |
| `https://g.rootrecord.info/memberships` | Memberships + Stripe checkout return `?checkout=`. |
| `https://api-goals.rootrecord.info` | Goals API alias. |
| `POST /v1/billing/checkout` | Stripe checkout (on goals worker). |

Source: `rootrecord-workers/rootrecord-api-goals/`. D1 `root-record`. Account `2b317e91…`.

---

### 3.6 Other Root Record Workers

| Host / worker | Source dir | What it does |
|---|---|---|
| Weather APIs | `rootrecord-workers/rootrecord-api-weather` | NOAA/NWS style weather JSON for Root Record. |
| Kīlauea | `rootrecord-workers/rootrecord-api-kilauea` | Volcano status (hash-stable; no spam). |
| Token | `rootrecord-workers/rootrecord-api-token` | Token/price surfaces. |
| Business | `rootrecord-workers/rootrecord-api-business` | Business shard. |
| Account | `rootrecord-workers/rootrecord-api-account` | Auth/billing shard (`api.rootrecord.online` / `.info` variants). |
| License | `rootrecord-workers/rootrecord-license` | License bind. |
| Primary | `rootrecord-workers/rootrecord-primary` | Primary site worker. |
| Map | `rootrecord-workers/rootrecord-minecraft-map` | Map helper. |
| Solana tx | `rootrecord-workers/rootrecord-solana-tx` | Solana tx helper (**do not test Solana in chat**). |
| Weather manager | `rootrecord-workers/rr-weather-manager-api` | Weather manager API. |
| Shared TS | `rootrecord-workers/shared` | `ava-shards.ts` (Ava operator email, lifetime flags). |

---

### 3.7 Local-only (operator box)

| URL | What it does |
|---|---|
| `http://127.0.0.1:8787/` | Origin HTTP home. |
| `http://127.0.0.1:8787/solar` | Solar board, no tunnel. |
| `http://127.0.0.1:8787/finance` | Finance board. |
| `http://127.0.0.1:8787/connections` | Connections. |
| `http://127.0.0.1:8787/services` | Services. |
| `http://127.0.0.1:8787/context` | AI pickup HTML. |
| `http://127.0.0.1:8787/api/plugins/status` | Plugin release status (desktop). |
| `http://127.0.0.1:8787/api/apps/status` | App release status. |
| `http://127.0.0.1:11434` | Ollama. |
| LAN `http://192.168.1.62:8787/` | Same origin on LAN (if that NIC is current). |

---

### 3.8 Community

| URL | What it does |
|---|---|
| https://discord.gg/rFFQYrNaqS | Public Discord. |
| Guild `1516108585740800042` | RootMC Discord. |
| Home `1539779979280257054` | Ava’s only unsolicited home. |
| `#updates` `1545284423740563528` | Forwards/pointers only. |
| `#solar-server` `1533915343766949949` | Solar reports. |
| https://rootmcworkspace.slack.com/ | Slack (`#solar-feed`, `#feedback`, etc.). |
| https://github.com/Ava-Core-Dev | Engineering org. |

---

## 4. Ava desktop client (full context)

Path: **`ava-desktop/`**. Launch: `bin/start-ava-desktop.sh` (sets `AVA_HANDOFF`, `AVA_HOME`, starts Electron).

### Process model

- **Electron main:** `main.mjs` — window, IPC, ops catalog, `startAvaSession()`.
- **Preload:** `preload.cjs` — `window.avaDesktop.*`.
- **Renderer:** `renderer/index.html` + `renderer/app.js` — Terminal, Core chat, Links, Stream, Finance, Minecraft, Settings.
- **Lifecycle:** `lib/avaLifecycle.mjs` — spawn/adopt uvicorn `:8787`, voice director, **watchdog** on `/health`, **detached** children so closing the GUI does not reap origin.
- **Bridge:** `lib/avaBridge.mjs` — rewrite, Discord/Slack helpers, brain URL.
- **Ops:** `lib/opsCommands.mjs` — allowlisted cron + HTTP buttons (Python core `/api/crons/{id}/run`).
- **Links:** `lib/avaLinks.mjs` — canonical URL groups (same list as §3 in condensed form).
- **Connection:** `lib/connectionConfig.mjs` — local vs remote brain (`DEFAULT_BRAIN_PORT = 8787`).
- **Media:** `lib/avaMedia.mjs` — local media dirs.

### What the GUI is for

- Operator console on the OptiPlex (not the public wiki).
- Ollama badges (`ava-ivy`, `qwen3:8b`, embeddings).
- **Crons · run now** hits origin (time chime, NOAA, Kīlauea, solar+weather, system perf, player economy, morning report, merged morning → `#updates`, economy brief, overnight, heartbeat, D1 sync, vercel-builds, schedule, run history).
- Report DMs for public subscribers.
- Core 1:1 chat trains local Ollama (`ava-ivy`) with optional enhance via Grok/Cursor.
- Stream reactions / OBS (when WebSocket is up).
- Projected shutdown timer (nightly HST: Discord+Slack report, `/rootstop`, power off).

Python used by the same session: `ava-origin-python/` (and historically `apps/desktop/core` as a copy). Scheduler: APScheduler, timezone `Pacific/Honolulu`, always-on.

### Media library (origin)

- Public: `$AVA_HOME/media` under allowlisted prefixes.
- Private never listed: `private/`, DMs, persona dumps, **`documents/docs/vercel-builds/`**.
- Vercel errors stay 5 days or until the same project+target is `READY`.

---

## 5. Discord / Slack poller

Path: `rootmc/discord-slack-poller/`. Entry: `src/poller.mjs`. Loads `credentials.env` via `scripts/start-poller.sh`.

- Home channel policy in `src/channelPolicy.mjs` / `src/config.mjs`.
- Chime-in off-home is Discord-only; Slack `C…` IDs must still recap/watch.
- Do not dual-run two `getUpdates` Telegram loops (409 conflict).

---

## 6. Deploy cheat sheet

| Surface | Command / place |
|---|---|
| RootMC HTML | `cd rootmc/site-pages && node scripts/build.mjs && npx wrangler pages deploy build --project-name rootmc-web --branch main` (include `functions/`) |
| RootMC API | `cd rootmc/api-worker && npx wrangler deploy` (account `f3372b…`, **not** the Outlook Root Record key) |
| Goals | `cd rootrecord-workers/rootrecord-api-goals && npx wrangler deploy` |
| Site-edge | Optional; apex may be Pages CNAME → `rootmc-web.pages.dev` |
| Vercel | Project dashboards for `avaivy.cloud` / `rootrecord.online` |
| Origin | uvicorn on box; do not systemd-fight the GUI |

Wrangler logged in as Outlook (`2b317e91…`) **cannot** deploy `rootmc-api`. Use the RootMC token + `CLOUDFLARE_ACCOUNT_ID=f3372b30093435bacc35b69972abeb2e`.

---

## 7. Copy-back to the live monorepo

Canonical SSD paths:

- Desktop: `/home/ava-core/ava/ava-core-v2/apps/desktop/`
- Origin: `/home/ava-core/ava/ava-core-v2/apps/core/`
- Next: `/home/ava-core/ava/ava-core-v2/packages/web/`
- RootMC site: `/home/ava-core/ava/workstations/rootmc-web/rootmc-web/`
- RootMC API: `/home/ava-core/ava/workstations/rootmc-web/rootmc-api/` + `rootmc-realm-api/`
- Goals: `/home/ava-core/ava/workstations/cloudflare/rootrecord-api-goals/`

USB leftover trees are not the source of truth; origin may still have been launched from USB historically — prefer SSD.

---

## 8. Snapshot date

Copied from the operator SSD on **2026-08-19 (HST)** without `node_modules`, `.next`, `.env`, or credentials. Refresh by re-rsyncing from those paths and pushing.

If you are an AI: you now have the URL atlas, the desktop client, the origin, Pages, Workers, and poller. Edit the matching folder, keep secrets out of git, and do not route RootMC API traffic through Ava FastAPI.

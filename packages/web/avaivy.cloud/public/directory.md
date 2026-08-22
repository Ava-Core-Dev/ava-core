# /home/ava-core/ava — directory map

One-to-three sentence overview of what each major path does. Generated from the full tree dump (`files.log`, ~138k entries). Use this instead of reading 20-line previews.

---

## Top-level

| Path | What it does |
|------|----------------|
| **ava/** (root) | Home directory for the entire RootRecord / Ava / RootMC stack on the OptiPlex workstation (`ava-core` user). |
| **.cursor/** | Cursor IDE project metadata and agent state for this machine. |
| **.git/** | Git metadata for the ava root (if tracked as a mono-repo or notes tree). |
| **Web Files/** | Older or alternate static web asset collection (legacy web dumps). |
| **all-connections/** | Connected product code: Workers, RootMC, Ava origin, Vercel links, desktop helpers, and shared agent docs. |
| **ava-core-v2/** | Primary Ava core runtime (Python package, config, apps, packages/workers, scripts, systemd units). |
| **bin/** | Operator helper binaries and shell utilities. |
| **data/** | Runtime / operational data stores used by Ava and related services. |
| **logs/** | Application and system logs. |
| **media/** | Media assets (images, uploads used by sites or Ava). |
| **new python files/** | Scratch / in-progress Python scripts (including `grok-edit.py` runs). |
| **plans/** | Planning docs and roadmaps. |
| **plugins/** | Plugin packages or extension code for Ava / RootMC. |
| **reports/** | Generated reports and status outputs. |
| **rootrecord-info-fix/** | Staging or temporary form related to the rootrecord-info Pages project. |
| **scripts/** | Operational shell scripts (maintenance, spam filters, deploy helpers, etc.). |
| **systemd/** | systemd unit files for Ava / RootRecord services on this host. |
| **uploads/** | Incoming or user upload storage. |
| **var/** | Variable state: mirrors of private repos, workstations projects, caches. **Primary Pages source lives under `var/mirrors/.../rootrecord-info-site`.** |
| **workstations/** | Per-product workstation trees (RootMC, Android, projects mirrors, web files). |
| **credentials.env** / **credentials.env.rootrecord** | Secret env files (Stripe, JWT, Discord, wallet keys). **Never commit.** |
| **README.md**, **START-HERE.md**, **EMERGENT-RENOVATION-PROMPT.md**, **BACKGROUND-IMAGES.md** | Operator onboarding and renovation notes for this tree. |

---

## all-connections/

| Path | What it does |
|------|----------------|
| **all-connections/** | Hub for code that “connects” external products (Workers, RootMC, Ava origin, desktop). |
| **rootrecord-workers/** | Cloudflare Workers for RootRecord account API and related routes (auth, sessions, billing). |
| **ava-packages-workers/** | Shared Worker packages: `rootrecord-api`, `ava-api`, `rootmc-api`, plus shared proxy/heartbeat helpers and wrangler configs. |
| **ava-origin-python/** | Ava origin backend (Python) that some Worker prefixes proxy to when Ava is “awake”. |
| **ava-desktop/** | Desktop/Electron or local UI helpers for Ava. |
| **rootmc/** | RootMC game / server related code (Android web app pages, API workers, edge). |
| **vercel/** | Vercel project links or deploy configs for related frontends. |
| **AGENTS.md**, **DESKTOP.md**, **README.md** | Agent and desktop operating notes for this subtree. |

---

## ava-core-v2/

| Path | What it does |
|------|----------------|
| **ava-core-v2/** | Main Ava core v2 monorepo: runtime, packages, apps, config, docs. |
| **packages/** | Shared packages, including **workers** (`rootrecord-api` edge router lives here in the v2 tree). |
| **apps/** | Application entrypoints. |
| **core/** / **ava_core/** | Core Python library code for Ava. |
| **config/** | Runtime configuration. |
| **scripts/** | Deploy, maintenance, and operator scripts for v2. |
| **systemd/** | Service units specific to ava-core-v2. |
| **docs/**, **EDITING.md**, **README.md** | Documentation for editing and running the core. |
| **.env**, **credentials.env** | Local env and secrets for this tree (do not commit). |

---

## var/ (critical for Pages)

| Path | What it does |
|------|----------------|
| **var/mirrors/** | Mirrored copies of private repos and workstation projects used as deploy sources. |
| **var/mirrors/ava-core-private/workstations/projects/rootrecord-info-site/** | **Canonical CF Pages source for rootrecord.info** (`public/` is what `wrangler pages deploy` uploads). |
| **var/mirrors/web-files/** | Backup / pre-August web HTML for product pages. |
| **var/devnet-sol/** | Solana devnet related state or tooling. |

---

## workstations/

| Path | What it does |
|------|----------------|
| **workstations/** | Per-product “desk” trees: RootMC, Android, project mirrors, and local web files. |
| **workstations/projects/rootrecord-info-site/** | Alternate (non-mirror) copy of the Pages site; prefer the `var/mirrors/...` path for deploys. |
| **workstations/RootMC/**, **android/** | RootMC and Android client/workstation assets. |

---

## Workers & auth (quick pointer)

| Concern | Where |
|---------|--------|
| Edge router + proxy (`rootrecord-api`) | `ava-core-v2/packages/workers/` and/or `all-connections/ava-packages-workers/` (`wrangler.rootrecord-api.toml`, `src/rootrecord-api/worker.ts`) |
| Account API (`rootrecord-api-account`) | `all-connections/rootrecord-workers/rootrecord-api-account/` |
| Pages static site | `var/mirrors/ava-core-private/workstations/projects/rootrecord-info-site/public/` |
| site-config (apiBase) | `.../public/api/site-config.json` (+ extensionless copy) |
| Account client JS | `.../public/account.js`, `account-dashboard.js`, `site-nav.js` |

---

## Agent notes

- Prefer the **mirror** path under `var/mirrors/.../rootrecord-info-site` for Pages edits and deploys.
- Never commit `credentials.env*` or wallet/Stripe/Discord secrets.
- `files.log` is a full inventory dump (previews capped at 20 lines); this `directory.md` replaces those previews with short purpose statements.
- For live auth path and operating rules, use **RootRecord-Ava-handoff-context.md** (master handoff).
< deploy 20260822T021539Z -->

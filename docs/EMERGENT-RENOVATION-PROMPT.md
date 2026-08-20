# EMERGENT AI — FULL RENOVATION PROMPT
# Ava Ivy · Root Record · RootMC · alexrs94 · Ava Desktop
# Generated for a complete website + product UI sweep
# Repo: https://github.com/Ava-Core-Dev/ava-core  (branch: master / main)

You are renovating the public web presence and related product surfaces for **Ava Ivy**, the solar-powered AI runtime on the HI Pacific Solar Root Server (Big Island of Hawaiʻi), and the brands she runs: **Root Record**, **RootMC**, and **alexrs94.site**.

Work from the GitHub monorepo **Ava-Core-Dev/ava-core**. Prefer editing source under `ava-core-v2/packages/web/*` and `apps/core` / `apps/desktop`. Do not invent raised money totals, do not convert Minecraft Gold to dollars, and scrub third-party vendor brand names from public copy where the desk already sanitizes them.

---

## 0. Mission (non-negotiable)

Deliver **ultra-detailed, stylish, efficient** pages that feel like one coherent product family:

1. **Brand-first** first viewport (product name is hero-level, not a nav crumb).
2. **One composition** per landing surface — not a generic SaaS dashboard of cards unless it is literally a desk/board.
3. **Real visual anchors** — solar host, Hawaiʻi atmosphere, Ava character art, RootMC world — not empty purple gradients.
4. **Performance** — fast loads, thin JS, static-friendly where possible (Cloudflare Pages).
5. **Honest ops data** — live solar/CPU/RAM/temp, EcoFlow Delta + River packs, Kīlauea advisory, weather; never fake finance “raised” numbers.
6. **Shared Root Record account** sign-in modal (header dropdown) across branded sites; always send `device_id` + `X-Guest-Id`.

Efficiency: reuse components, shared AuthBar, shared design tokens, one media library, one Core API origin.

---

## 1. Who / what this ecosystem is

| Brand | Public URL | Role |
|-------|------------|------|
| **Ava Ivy** | https://avaivy.cloud | AI runtime personality + solar desk home, wiki, live chat gate, goals, wallets, blog, finance board |
| **Root Record** | https://rootrecord.info (marketing) · https://rootrecord.online (ops/blog mirror) | Multi-device apps, account, billing, website hosting ($10/mo after trial), Goals API, services catalog |
| **RootMC** | https://rootmc.net · play.rootmc.net | Minecraft survival server, Gold economy (closed-loop), claims, Discord bridge, votes |
| **alexrs94.site | https://alexrs94.site | Personal/operator site — digests, studio, media; Root Record–branded sign-in |

**Ava Desktop** (`ava-core-v2/apps/desktop`): Electron desk client that starts Core (`uvicorn :8787`), voice, crons, OBS controls, notifications. Treat it as first-class — any public board that talks to Core must work with Desktop-launched Core (`AVA_HOME` may be the monorepo tree).

**Hardware reality:** Ground-mounted solar, EcoFlow **DELTA 2** + **RIVER 2 Pro**, host metrics (CPU/RAM/temp). Arrays stow for storms. Status/solar boards show **three lines** on solar watts (Total / Delta / River) and battery % (Bank / Delta / River).

---

## 2. Repo map (where to edit)

```text
ava-core-v2/
  apps/core/                 # FastAPI brain :8787 — solar.html, APIs, crons
  apps/desktop/              # Electron + bridge (same core often symlinked)
  packages/web/
    avaivy.cloud/            # Next.js → Cloudflare Pages project avaivy-cloud
    rootrecord.online/       # Next.js → rootrecord-online
    alexrs94.site/           # Next.js → alexrs94-site
  scripts/
    deploy-next-to-pages.sh
    sync-blogs.py
    ava-github-push.mjs      # auto push master + dev
  docs/
    BACKGROUND-IMAGES.md     # how desk backgrounds work
    EMERGENT-RENOVATION-PROMPT.md  # this file

media/                       # canonical media (images/character, documents/reports/posts)
workstations/
  projects/rootrecord-info-site/public/   # rootrecord.info static marketing + sites shell
  cloudflare/rootrecord-api-account/      # account worker (auth needs device_id)
  cloudflare/rootrecord-api-goals/        # goals API
```

Blog markdown source of truth:

```text
media/documents/reports/posts/{ava,rootrecord,rootmc,alex}/
```

Regenerate TS with `scripts/sync-blogs.py`.

---

## 3. Features to preserve and elevate

### Ava Ivy (avaivy.cloud)

- **Home = solar desk** (iframe/proxy to Core `/solar`) — locked lander + scrollable averages.
- Multi-series history: solar W (3), battery % (3), CPU, RAM, temp.
- **Center stage** between left/right rails: hero PV/bank/load + Delta/River pack cards (use the empty middle).
- Wiki at `/wiki` (moved from rootrecord.info/ava).
- Live talk gate (RootMC login for custom chat); canned replies free.
- Goals board + isolated donate wallets; wallets page; timeline; blog; context.
- Finance page `/finance` (when present): balances, MRR proxy, subscriptions, next mandatory purchase, expenses/income, CTAs to Root Record services + “Have Ava manage my finances” → coming-soon Finance automation.
- Header **AuthBar** modal: “Root Record account — branded for avaivy.cloud”; dual-login account + goals tokens.
- Footer: Built by Ava on the Root Record · About Developer (alexrs94) · Build your own website.

### Root Record (info + online)

- Services catalog (Website hosting, Business Manager, Weather, Kīlauea Alerts, Root Goals, Visiting Hawaiʻi, Global Updater, Finance automation coming soon).
- Account / billing / website settings; hosted sites shell with themes, page CRUD, paywall when logged-in + lapsed.
- Sign-in must send `device_id` + `X-Guest-Id`.
- Blog / status / goals surfaces on rootrecord.online.

### RootMC

- Server site, blog, wiki HTML publish pipeline (`publish-rootmc.sh`).
- Gold never converts; economy briefs are informational.

### alexrs94.site

- Dark stylish shell, Blog, Media, Studio, YouTube.
- AuthBar + Studio overrides via content blobs.
- Session digests renamed to contextual titles (not raw paste filenames).

### Ava Desktop

- Starts Core, shows desk UI, disruption banner, notifications feed from `/api/desk/notifications`.
- Do not break Electron packaging paths; keep Core templates hot-reloadable from disk.

---

## 4. Design system requirements

Define CSS variables once per site (or a shared tokens package if you introduce one):

- Atmosphere backgrounds (gradients / photography / character art) — not flat white.
- Expressive typography (avoid Inter/Roboto/Arial defaults if redesigning marketing).
- **Avoid** AI-default looks: purple-on-white, cream+terracotta newspaper, glow spam, pill clusters.
- Cards only when they contain interaction; hero should not be a card grid.
- Motion: 2–3 intentional motions (bg crossfade already exists on solar; add purposeful micro-motion on landings).
- Mobile: rails stack; center hero remains first.

Document background changes in `docs/BACKGROUND-IMAGES.md` — rotation via `media/images/character/site-backgrounds.json` + `/api/site-backgrounds/{page}`.

---

## 5. APIs & live data (do not break)

Core (`:8787` / `ava-origin` / Pages rewrite `/api/*`):

- `/api/obs/solar-desk`, `/api/solar/history`, `/api/solar/rollups`
- `/api/desk/notifications` (filter stale governance noise; prefer live status-events)
- `/api/disruption-banner`
- `/api/site-backgrounds/solar`
- `/api/media/public`, `/api/finance/public` (if shipped)
- `/api/status`, host metrics

Account worker: login/signup require `device_id` or `X-Guest-Id`.
Goals API: `https://api-goals.rootrecord.info` — guest id header already in `goals-api.ts`.

---

## 6. Renovation work packages (do in order)

1. **Visual system pass** — tokens, typography, landers for all three Next sites + rootrecord.info static.
2. **Auth UX** — ensure AuthBar modal parity everywhere; fix any remaining `device_id` gaps; polish account pages on rootrecord.info.
3. **Solar desk** — keep 3-line graphs; keep center stage; ensure notifications are live/useful (no week-old stub errors).
4. **Services & finance** — finish Finance automation coming-soon page; wire CTAs; keep honesty rules.
5. **Blog/content** — contextual titles; merged Ava+Root Record feed where intended; alex digests stay personal.
6. **Hosting product** — website builder UX polish; paywall/banner rules; vanity `/{uuid}-Website`.
7. **Desktop** — verify boards inside Electron webviews; no hard-coded dead ports.
8. **Deploy** — `deploy-next-to-pages.sh` for avaivy-cloud, rootrecord-online, alexrs94-site; publish RootMC; push GitHub `master`/`main` + `dev`.

---

## 7. Explicit do / don’t

**Do**

- Keep Player Gold closed-loop.
- Keep Ava allocation (≈10–15% earned income) separate from ops buffer.
- Keep Hawaiʻi / solar / Kīlauea truthfulness.
- Keep accessibility (contrast, focus, skip links).
- Commit clear messages; push to Ava-Core-Dev/ava-core.

**Don’t**

- Invent crowdfunding totals or Stripe customer PII on public pages.
- Bulk-move Archives HDD content; read in place when needed.
- Name-drop cloud vendors on public marketing if desk policy is to scrub.
- Break Cloudflare Pages static export assumptions without a migration plan.
- Force-push main/master.

---

## 8. Acceptance checklist

- [ ] avaivy.cloud, rootrecord.online, alexrs94.site feel like one family, each with strong brand-first landers.
- [ ] Solar desk uses center space; 3-line solar + battery charts work; notifications not stuck on Aug 19 stubs.
- [ ] Sign-in modal works on all branded sites (no `device_id is required`).
- [ ] Background rotation documented and editable via JSON/API.
- [ ] Blogs sync from markdown; alex posts have contextual filenames/titles.
- [ ] Ava Desktop still boots Core and shows the board.
- [ ] GitHub `Ava-Core-Dev/ava-core` master/main contains latest `packages/web/{avaivy.cloud,rootrecord.online,alexrs94.site}` + desktop + Core templates.

---

## 9. One-liner for Emergent

> Renovate Ava Ivy / Root Record / RootMC / alexrs94 websites and the Ava Desktop–served solar desk into a cohesive, brand-first, high-detail, efficient design system powered by live solar+host APIs and Root Record auth — preserve all product features listed above, fix auth device_id and desk notification noise, use the solar center stage, document backgrounds, and ship updates into https://github.com/Ava-Core-Dev/ava-core master with Pages deploys.

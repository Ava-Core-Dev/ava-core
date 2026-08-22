# Ava Ivy — developer / agent brain

> Public knowledge for humans and AIs working on the RootRecord / Ava / RootMC stack.
> Home on the OptiPlex: `/home/ava-core/ava`
> Live site: https://avaivy.cloud
> Updated: 2026-08-21 (HST)

Related public pages:
- https://avaivy.cloud/context — live ops context (from Ava origin when awake)
- https://avaivy.cloud/directory — shadow tree map of `/home/ava-core/ava`
- https://avaivy.cloud/directory.md — downloadable directory map
- https://avaivy.cloud/context/dev — this page (HTML)
- https://avaivy.cloud/context/dev.md — this file (raw markdown)

---

## 1. What lives where

| Domain | Role |
|--------|------|
| rootrecord.info | Marketing + account portal (CF Pages `rootrecord-info`) |
| avaivy.cloud | Ava status, wiki, directory, goals, finance, **this brain** |
| alexrs94.site | About Developer |
| rootmc.net | RootMC Minecraft |
| api.rootrecord.info | Account API hostname — **keep for Android** |
| ava-origin.rootmc.net | FastAPI / Ava origin on the OptiPlex (via cloudflared) |

Shell user on the workstation: `ava-core@ava-core-desk`.

---

## 2. How public traffic reaches avaivy.cloud

```
Browser https://avaivy.cloud/*
  → Cloudflare Worker "ava-api"
       ├─ /api/* /obs/* /health /status /solar /ava/*
       │     → https://ava-origin.rootmc.net  (local uvicorn :8787 via tunnel)
       └─ everything else
             → https://avaivy-cloud.pages.dev  (CF Pages project, branch main)
```

There is **no** cloudflared hostname for `avaivy.cloud`. Local `npm run start` on :3000 is smoke-test only.

Apache on :80 is unrelated (default site; 404 for Host avaivy.cloud).

---

## 3. Source tree (Next app)

```
/home/ava-core/ava/ava-core-v2/packages/web/avaivy.cloud/
  src/app/           # App Router pages
  src/content.json   # nav, site name, cards, footer
  src/components/    # SiteChrome, AuthBar, …
  public/            # static: directory.md, context-dev.md, wiki/, …
  .pages-out/        # STATIC EXPORT used for CF Pages deploys
  package.json       # next build / next start
```

**Production Pages branch is `main`** (not `master`). `master` is Preview only.

Deploy:

```bash
cd /home/ava-core/ava/ava-core-v2/packages/web/avaivy.cloud
npm run build
# copy new routes into .pages-out (see edit script)
npx wrangler pages deploy .pages-out \
  --project-name=avaivy-cloud \
  --branch=main \
  --commit-dirty=true
```

Always force a content change before deploy (Wrangler 0-file pitfall).

---

## 4. Edit scripts (site-specific templates)

Stop using a single `grok-edit.py`. Use numbered templates and **bump NNN every run**:

| Template | Site |
|----------|------|
| `rootrecord-info-edit000.py` | rootrecord.info (Pages `public/`) |
| `avaivy-cloud-edit000.py` | avaivy.cloud (this site) |
| `alexrs94-site-edit000.py` | alexrs94.site |

Workflow:

1. `cp avaivy-cloud-edit000.py avaivy-cloud-edit00N.py`
2. Fill `patch_files()` only
3. `python3 avaivy-cloud-edit00N.py` on the OptiPlex
4. Verify **live** URLs in a private window

Templates ship in `ava-handoff.zip` / agent handoff packages.

---

## 5. rootrecord.info auth (do not break)

- Web credentialed calls: same-origin `https://rootrecord.info/v1/*`
- Worker `rootrecord-api` proxies `/v1` → `rootrecord-api-account` on workers.dev
- `apiBase` in `public/api/site-config.json` must be `https://rootrecord.info` (never `*.workers.dev` for browsers)
- Keep `api.rootrecord.info` for Android clients
- Never `Access-Control-Allow-Origin: *` with credentials

Pages source (prefer mirror):

```
/home/ava-core/ava/var/mirrors/ava-core-private/workstations/projects/rootrecord-info-site/public/
```

---

## 6. How to send files / work with agents

**Human → agent**

- Paste shell outputs when asked (agents cannot SSH the OptiPlex).
- Drop zips / markdown into the chat when providing handoff context.
- Prefer one diagnostic block at a time.

**Agent → OptiPlex**

- Provide a ready-to-run `*-editNNN.py` or a short bash block.
- Scripts should auto-deploy and print the live URLs to verify.
- Never ask the operator to paste secrets into chat.

**Public brain (this system)**

- AIs can fetch:
  - `https://avaivy.cloud/directory.md` — tree purposes
  - `https://avaivy.cloud/context/dev.md` — this developer guide
  - `https://avaivy.cloud/context` — live ops blob when Ava is awake
- Prefer these over guessing paths or inventing deploy commands.

---

## 7. Directory page

- UI: `/directory` (shadow tree, styled like Context)
- File: `/directory.md` (markdown inventory of `/home/ava-core/ava`)
- Built from operator tree dumps; short 1–3 sentence purpose per major path
- No secrets (no credentials.env contents)

After changing `public/directory.md` or the page:

```bash
# inside avaivy.cloud project after next build
mkdir -p .pages-out/directory
cp -f .next/server/app/directory.html .pages-out/directory/index.html
cp -f public/directory.md .pages-out/directory.md
npx wrangler pages deploy .pages-out --project-name=avaivy-cloud --branch=main --commit-dirty=true
```

---

## 8. Workers quick map

| Worker | Config | Job |
|--------|--------|-----|
| ava-api | `wrangler.ava-api.toml` | avaivy.cloud edge + origin proxy |
| rootrecord-api | `wrangler.rootrecord-api.toml` | rootrecord.info edge + /v1 proxy |
| rootrecord-api-account | under `all-connections/rootrecord-workers/` | auth / sessions |

Ava origin (when awake): tunnel → `127.0.0.1:8787` (uvicorn).

---

## 9. Operating rules (agents)

1. Prefer shell on the OptiPlex; ask human to paste outputs.
2. Do not break Android (`api.rootrecord.info`).
3. Do not point browser `apiBase` at `*.workers.dev`.
4. Force dirty bit + correct Pages **branch** (`main` for avaivy-cloud).
5. Confirm live domain, not only preview.
6. Secrets only in `credentials.env` / wrangler secrets — never commit.
7. Use site-specific `*-editNNN.py`; bump NNN every run.
8. avaivy.cloud does not mask or proxy rootrecord.info.

---

## 10. One-line summary

RootRecord auth is same-origin `rootrecord.info/v1/*`; avaivy.cloud is Worker `ava-api` → CF Pages `avaivy-cloud` branch **main** (static `.pages-out/`); public brain is `/context`, `/context/dev`, `/directory` (+ `.md` downloads); edit via numbered site templates; force dirty before every Pages deploy.

---

End of developer context. Prefer this file + directory.md over inventing architecture.

<!-- avaivy-cloud-edit001 20260822T024829Z -->

# Root Goals — product concept

**Status:** Root Goals **1.0.0 · Release 0** (foundation)  
**Implementation:** `Web/apps/root-goals-web/` · `Web/cloudflare/rootrecord-api-goals/` · `Mobile/root-goals-mobile/`  
**Public share URLs:** `https://rootrecord.info/{custodialSolanaAddress}/goals` and `https://goals.rootrecord.info/{address}/goals/{goal-slug}`  
**Audience:** Engineering, design, operators  
**Last updated:** 2026-06-03  

Root Goals helps people define outcomes, break them into trackable steps, and get an AI-generated plan from their own inputs. Onboarding is **guest-first** (no account until the wizard finishes), then **sign up / sign in**, then **Grok** builds a detailed plan while the UI shows **Generating Goal Plan**.

---

## Release 0 scope

| In scope | Deferred |
|---|---|
| 11-step guest-first onboarding | Push reminders for `target_date_est` |
| Server + device draft persistence | Social comments on public goals |
| Grok plan + **Actions** + **Suggestions** (delete only) | On-chain goal NFTs |
| AI disclaimer (app + public HTML) | Full earn heartbeat on goals shard |
| Goal list + detail with AI plan | Advanced analytics |
| Public share (dual URLs) | Member billing UX in-app |
| Capacitor Android **1.0.0** | |

---

## AI disclaimer (required)

> Root Record does **not** provide financial support or advice. **Actions** and **Suggestions** are AI-generated and may not reflect Root Record's core beliefs. Use your own judgment.

Shown on auth gate, goal detail, Actions/Suggestions sections, and public HTML pages.

---

## 1. Onboarding flow (first open)

| Step | Copy / action |
|------|----------------|
| Welcome | “Hello! Let's get you on your way to knocking out your goals.” **I already did this** → login/signup → **Goals home**; **Next** → wizard |
| Name | “What should we call your first goal?” + text + Next |
| Category | Dropdown + **+ Add Category** (first-time teach: name → Save → back to picker → select → Next) |
| Purpose | “What is the outcome and purpose of this goal?” + Next |
| Money | “Does this goal require money?” + estimated cost + Next |
| Steps | “Describe and list what steps must be achieved” (detailed actions) + Next |
| Timeline | Min / max completion horizon → **dynamic estimated completion date** + Next |
| Auth gate | Draft saved via `X-Guest-Id`; prompt **create account or sign in** |
| Generating | Full-screen **Generating Goal Plan** while Grok runs |
| Workspace | User fields + AI plan + **Actions** + **Suggestions** |

Draft API: `GET/PUT /onboarding/draft`. Finalize: `POST /onboarding/finalize` (after login).

---

## 2. Tier limits

| | Free | Member / Lifetime |
|---|------|-------------------|
| Active goals | 3 | 42 |
| AI plan refresh per goal | 1 / 3 days | 3 / day |
| AI refreshes across goals per day | — | 10 goals |

---

## 3. Goal workspace (post-onboarding)

- Goal list; open a goal to view **user fields + AI plan**.
- **Actions** and **Suggestions:** Grok-generated; user can **delete** only (no edit).
- **Achievements:** add, edit, mark complete.
- **Entries:** notes, costs, income.
- **Regenerate AI summary** (subject to tier caps; Grok receives full prior context + user changes).
- **Public share:** toggle `public_enabled`; copy canonical + mirror URLs from custodial address.

---

## 4. Public sharing

Uses the user’s **custodial Solana deposit address** (`internal_solana_wallets`).

- Profile: `{address}/goals` — all public goals.
- Single goal: `{address}/goals/{slug}`.

**Canonical:** marketing site Pages Functions serve HTML shells + `/api/public/goals/*` proxy.  
**Mirror:** `goals.rootrecord.info` SPA routes (`/:address/goals`, `/:address/goals/:slug`).

---

## 5. API surface

Authenticated (`Authorization` or SSO cookie, optional `X-Guest-Id` for drafts):

- `GET/POST /categories`, `GET/PATCH/DELETE /categories/:id`
- `GET/PUT /onboarding/draft`, `POST /onboarding/finalize`
- `GET/POST /goals`, `GET/PATCH/DELETE /goals/:id`, `POST /goals/:id/ai-refresh`
- `GET/POST/DELETE /goals/:id/actions/:actionId`
- `GET/POST/DELETE /goals/:id/suggestions/:suggestionId`
- `GET/POST/PATCH /goals/:id/achievements`, `GET/POST /goals/:id/entries`

Public:

- `GET /public/:solanaAddress/goals`
- `GET /public/:solanaAddress/goals/:slug`

Mobile config: `GET /api/mobile/config` → `version: "1.0.0"`, `release: 0`, disclaimer, tiers.

---

## 6. Environment variables

| Var | Where | Purpose |
|---|---|---|
| `VITE_GOALS_API_BASE` | `root-goals-web` | Override API base (Android release sets `https://api-goals.rootrecord.info/api`) |
| `VITE_RR_APP_ID` | `root-goals-web` | Override app id (`rootrecord_goals_web` / `rootrecord_goals_android`) |
| `ROOTRECORD_API_GOALS_BASE` | marketing Pages Function env | Upstream Worker for public proxy |
| `GROK_API_BEARER_TOKEN` | goals Worker secret | AI plan generation |
| `JWT_SECRET` | goals Worker secret | Auth tokens |

---

## 7. Deploy (Release 0)

1. `cloudflare-update-workers.bat goals` — D1 migrations + Worker  
2. `cloudflare-update-pages.bat goals` — `rootrecord-goals-web`  
3. Marketing site deploy — public routes + product links  
4. Post Discord from [`RELEASE-0-DISCORD.md`](RELEASE-0-DISCORD.md)

---

## 8. Non-goals (post–Release 0)

- Push notification cron for `target_date_est` reminders
- Social comments on public goals
- On-chain goal NFTs
- Full earn heartbeat on goals shard

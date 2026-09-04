# Root Goals — what it is today & where it's headed
*A new app by Root Record*

---

We're building **Root Goals** — a place to name what you're working toward, break it into something you can actually track, and get a **detailed AI plan** built from *your* words, not a generic template.

This post is a straight snapshot: **what you can use right now** (web + Android) and **what we're aiming for next**.

---

## What Root Goals is

Most goal apps give you a blank list. Root Goals starts with **you describing the outcome** — why it matters, what it might cost, what steps you already know, and how long you think it'll take — then runs **Generating Goal Plan** while **Grok** turns that into a structured plan with concrete next steps.

The idea is simple:

1. **You define the goal** in plain language.
2. **AI proposes a plan** — summary, steps, **Actions**, and **Suggestions**.
3. **You track real progress** — achievements, notes, costs, income — and refresh the plan when life changes.

Root Record does **not** tell you what to want. It helps you organize what *you* already decided to pursue.

---

## What you can do today

### Guest-first onboarding (no account until the end)

You can walk through the full wizard **before signing up**:

- Welcome → goal name → category (including **+ Add Category** the first time)
- Purpose and outcome
- Whether money is involved (+ optional estimated cost)
- A detailed summary of steps you think are required
- Min/max timeline → **estimated completion date**

Your draft is saved on the server with a **guest device id**, so refresh or close the tab without losing work. At the end you **create a Root Record account or sign in**, then the app finalizes the goal and runs **Generating Goal Plan**.

Returning users can tap **I already did this** and go straight to sign-in → **Goals home**.

---

### AI plan: Actions & Suggestions

After sign-in, Grok reads everything you entered (plus your categories, limits, and prior context on refresh) and returns:

**Plan summary & steps** — Overview, milestones, timeline/cost notes, risks

**Actions** — Concrete next steps with priority — AI-generated, **deletable**

**Suggestions** — Optional ideas and alternatives — AI-generated, **deletable**

You **don't edit** Actions or Suggestions in place — you keep what helps and **delete** what doesn't. Deleted items are remembered so a refresh doesn't keep pushing the same noise back at you.

If generation fails, use **Retry AI plan** on the goal page.

---

### Goal workspace (after onboarding)

Each goal is a living workspace:

- **Your fields** — title, category, purpose, cost, steps, timeline
- **AI plan** — summary + structured steps
- **Actions & Suggestions** — as above
- **Achievements** — add, edit, mark complete
- **Entries** — notes, costs, and income tied to the goal
- **Refresh AI plan** — Grok gets full updated context (entries, achievements, deletions, prior output)

The app shell gives you persistent navigation: **Goals · Add goal · Sign out**, with a clear **← Goals** path from any goal detail screen.

---

### Tier limits

**Free**
- Active goals: 3
- AI refresh per goal: 1 every **3 days**

**Member / Lifetime**
- Active goals: 42
- AI refresh per goal: **3 / day**
- AI refreshes across goals / day: up to **10 goals**

Member status comes from your existing **Root Record account** (Pro / Lifetime) — same login family as Weather, Business, Kīlauea, and the rest of the ecosystem.

---

### Public sharing

Turn on **Share publicly** on a goal to publish a read-only view:

- **Profile:** all public goals at `https://rootrecord.info/{your-custodial-address}/goals`
- **Single goal:** `https://goals.rootrecord.info/{address}/goals/{goal-slug}`

Public pages show title and AI plan content with the required disclaimer. They're **not** a social feed — just a share link for accountability or portfolio-style visibility.

---

### Where to use it

- **Web:** https://goals.rootrecord.info/
- **API:** https://api-goals.rootrecord.info/
- **Android:** `com.rootrecord.rootgoals` — Capacitor wrapper around the same web app, pointed at the production API

Current build line: **1.0.8 · Release 8** (we bump `1.0.x` / Release `x` as we ship fixes and polish).

---

### Required disclaimer (everywhere AI touches the product)

> Root Record does **not** provide financial support or advice. **Actions** and **Suggestions** are AI-generated and may not reflect Root Record's core beliefs. Use your own judgment.

You'll see this on auth, goal detail, Actions/Suggestions sections, and public HTML pages.

---

## How we're building it (for the curious)

Root Goals is a **Root Record product**, not a standalone silo:

- **Web app** — React + Vite on Cloudflare Pages
- **API** — dedicated Goals worker + D1 (`api-goals.rootrecord.info`)
- **Android** — Capacitor shell in the MonoRepo release pipeline
- **Accounts** — Root Record SSO; guest drafts merge into your user on sign-up
- **AI** — Grok multi-pass generation with audit logging; ops copies to Discord (session activity + AI report archive) like our other apps

Release 0 was the **foundation**. Releases 1–8 have been wiring, mobile, navigation, CORS/Android fixes, Discord integration, and AI reliability — still the same core product shape, getting harder and smoother to use.

---

## What Root Goals is **not** (yet)

We’re honest about scope. These are **planned or deferred**, not missing because we forgot:

- **Push reminders** when `target_date_est` approaches
- **Comments / social layer** on public goals
- **On-chain goal NFTs** or crypto-native goal artifacts
- **Full Root Record Earn heartbeat** on the Goals shard
- **In-app membership billing UX** (upgrade flows live elsewhere in the ecosystem today)
- **Deep analytics** — streaks, charts, cohort insights
- **Editing AI Actions/Suggestions in place** — delete + refresh is the model for now

We'd rather ship a goal workspace people actually use than pretend a v1 is a finished life-OS.

---

## Where we're headed

The north star hasn't changed since Release 0:

**Define → Plan (AI) → Track → Share → Re-plan when reality shifts.**

Near-term direction:

1. **Reliable AI plans** — Grok configured and stable for every refresh pass
2. **Mobile parity** — Android that feels native (nav, version truth, offline-tolerant drafts)
3. **Public goals that are worth sharing** — clean pages, no accidental private leakage
4. **Reminders & accountability** — nudges tied to *your* estimated dates
5. **Ecosystem hooks** — Earn, membership perks, and cross-app identity without friction

Longer term, we're interested in goals as **portable records** — something you own, can show, and can revisit — but NFTs and social are explicitly **later**, not now.

---

## Try it & tell us

If you've been waiting for a Root Record app that's about **your outcomes** rather than weather, lava, or spreadsheets — this is it.

**Web:** https://goals.rootrecord.info/

Tell us:
- Did onboarding + **Generating Goal Plan** feel clear?
- Are **Actions** actually actionable for your goals?
- What would make you open this weekly?

We're early. Release 8 is real software on real infra — not a mockup — and we're iterating in the open from here.

*Root Goals · Root Record · https://rootrecord.info*

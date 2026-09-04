# Root Goals 1.0.0 — Release 0 (Discord announcement)

Canonical public copy for Release 0. Post from `#announcements` or product channels.

---

## Full post

**Root Goals 1.0.0 — Release 0**  
*A new app by Root Record*

We’re shipping the **foundation** for **Root Goals** — a place to define outcomes, break them into trackable steps, and get an AI-generated plan from *your* inputs.

---

### What Release 0 is

**Release 0** is the first versioned cut (`1.0.0`). It establishes onboarding, guest-first drafts, Grok plan generation, **Actions** and **Suggestions**, public-share scaffolding, and the core data model. It is the base we bump from (`1.0.0` → `1.0.1`, etc.) as we ship more — not the finished product yet.

---

### What it does

You describe a goal in your own words — name, category, purpose, optional cost, detailed steps, and a timeline. **You can do all of that before creating an account.** Your draft is saved on the server via a guest device id so it survives refresh.

When you sign up or sign in, the app runs **Generating Goal Plan** while Grok builds a detailed plan from everything you entered. You see your inputs plus the AI summary, concrete **Actions**, and optional **Suggestions**.

Track progress with achievements and notes/costs/income entries. Refresh the AI plan within tier limits (free: 3 goals, 1 refresh per goal every 3 days; members: 42 goals, more refreshes).

Share goals publicly using your custodial Solana address — visible at both `rootrecord.info/{address}/goals` and `goals.rootrecord.info/{address}/goals`.

---

### Actions & Suggestions

| | |
|---|---|
| **Actions** | Grok-generated next steps tied to your goal. Delete any you don’t want. |
| **Suggestions** | Grok-generated ideas and alternatives. Delete any you don’t want. |

Both are **always labeled AI-generated**. They are not Root Record editorial content.

---

### Disclaimer (required)

> Root Record does **not** provide financial support or advice. **Actions** and **Suggestions** are AI-generated and may not reflect Root Record's core beliefs. Use your own judgment.

---

### Onboarding (11 steps)

1. Hello — Next, or **I already did this** → sign in → home  
2. Goal name  
3. Category (+ add category teach flow)  
4. Purpose  
5. Money (optional cost)  
6. Steps (detailed summary)  
7. Timeline (min/max days → estimated completion)  
8. Draft saved each step (guest id — no account yet)  
9. Auth gate — create account or sign in  
10. **Generating Goal Plan** (Grok)  
11. Goal workspace — plan, Actions, Suggestions, progress  

---

### Tier limits (Release 0)

| | Free | Member / Lifetime |
|---|---|---|
| Active goals | 3 | 42 |
| AI refresh per goal | 1 / 3 days | 3 / day |
| AI refreshes across goals / day | — | 10 goals |

---

### Where to try it

- **Web app:** https://goals.rootrecord.info/  
- **API:** https://api-goals.rootrecord.info/  
- **Android:** Capacitor wrapper `com.rootrecord.rootgoals` — Release 0 build pipeline in repo (`Mobile/root-goals-mobile/`)

---

### Release 0 scope (what’s next)

**In:** guest onboarding, Grok plans, Actions/Suggestions, disclaimer, goal list + detail, public share scaffolding, Android wrapper 1.0.0.

**Later:** push reminders, social comments, on-chain goal NFTs, full earn integration, polish beyond MVP CRUD.

---

### Feedback

Try it and tell us what breaks or what you want next — reply here or open feedback in-app when signed in.

---

## Short post (tight channels)

**Root Goals 1.0.0 — Release 0** is live as a foundation build: guest-first onboarding → sign in → Grok **Generating Goal Plan** → **Actions** & **Suggestions** (AI-generated, deletable). Free: 3 goals; members: 42. Public share at `rootrecord.info/{address}/goals` and `goals.rootrecord.info`. Web: https://goals.rootrecord.info/

*Disclaimer: Root Record does not provide financial support or advice. Actions and Suggestions are AI-generated and may not reflect Root Record's core beliefs. Use your own judgment.*

---

## Smoke test checklist (operators)

- [ ] Guest completes onboarding steps 1–8; refresh browser — draft restored  
- [ ] **I already did this** → auth → home (no broken finalize)  
- [ ] Sign up → **Generating Goal Plan** → goal created with Actions + Suggestions  
- [ ] Delete an Action and a Suggestion; AI refresh does not re-propose deleted ids  
- [ ] Disclaimer visible on auth gate, goal detail, Actions/Suggestions sections  
- [ ] Toggle public share; both canonical and mirror URLs load  
- [ ] `GET /api/mobile/config` returns `version: "1.0.0"`, `release: 0`  
- [ ] Android debug APK loads app and hits `api-goals.rootrecord.info`  
- [ ] Deploy: `cloudflare-update-workers.bat goals`, `cloudflare-update-pages.bat goals`, marketing site deploy

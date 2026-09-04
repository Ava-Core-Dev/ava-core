# Root Farms — product concept

**Status:** Concept + client MVP (web + Android wrapper); server `/v1/farms/*` not shipped yet  
**Implementation:** `Web/apps/root-farms-web/` · `Mobile/root-farms-app/`  
**Audience:** Engineering, design, ops  
**Last updated:** 2026-05-16  

Root Farms is a mobile-first **idle / incremental** experience themed as **farms** that grow **Root Units** (RU). Progression uses plain language: **Plots** (50 unlock tiers) and **Rows** (up to 20 producers per plot). Income is **cycle-based** with optional **offline accrual**, but **spendable Root Units always come from the existing account ledger** (`rr_earn_balance` on `rootrecord-api-account`) so Discord sends, Pro redemption, web transfers, and other apps stay consistent.

---

## 1. Goals and non-goals

### Goals

- Recreate the **feel** of a hub-and-slot idle game (reference: data-centre style UI) using **farm** metaphors people already understand.
- Support **50 Plot tiers** and up to **20 Rows** per Plot.
- Run **production math on the client** for smooth UI and offline preview, with **server-side settlement** so balances cannot drift from the rest of Root Record.
- **Single global RU balance** per user: what `/earn/summary` and Discord `/bal` show is what farms can spend and what farms credit.

### Non-goals (v1)

- Separate “game currency” that converts to RU later (invites double-economy bugs).
- Client POST of arbitrary `balance` or `granted` amounts.
- Tapping the existing `/earn/heartbeat` loop for idle income (wrong abuse surface; different caps).
- Prestige, ads, global leaderboard (stub UI only until product approves).

### Compliance / messaging

- Root Units remain a **beta rewards program** (see marketing `beta-tester-rewards.html`). In-game copy: **“Root Units (beta)”**, no yield/investment language.
- Farms are **one earn channel** among others (app usage heartbeats, check-in, signup bonus). Caps must be documented in-app.

---

## 2. Player-facing vocabulary

| Term | Meaning |
|------|---------|
| **Root Farms** | The product / app (`app_id`: `root_farms`). |
| **Plot** | One of **50 progression tiers** (replaces “data centre” / hub). Plots unlock in order; each has its own Row grid and upgrades. |
| **Row** | One **producer slot** inside a Plot (replaces “server”). Up to **20 Rows** per Plot when fully expanded. |
| **Harvest** | One payout tick: when a Row completes a cycle, it contributes RU toward **accrued** income for that Plot. |
| **Grow time** | Cycle duration for a Plot (all active Rows in a Plot share the Plot’s cycle clock for v1). |
| **Full field bonus** | +10% to Plot harvest when every **purchased** Row slot is filled with an active Row. |
| **Farmhands** | Future tab: passive automation / multipliers (Engineers equivalent). |
| **Fertilizer** | Future session boost (e.g. 2× for 20 minutes). |
| **Replant** | Future prestige reset. |

**UI strings (examples)**

- List header: `PLOTS` · `3.2K RU / harvest total`
- Status: `4 plots growing · 42 rows active`
- Balance: `12.4K Root Units` · `+494 RU/s`
- Plot detail: `ROWS` `8/8` · `RU / harvest` `8.8` · `GROW TIME` `0.59s`
- Locked plot: `Unlocks at 5.00M RU`

---

## 3. Progression structure

### 3.1 Hierarchy

```
Account (signed-in user)
└── Root Farms save
    ├── Plot 1 .. Plot 50   (tier gates; Plot N unlocks when balance ≥ unlock[N])
    │   ├── row_count       (1 .. max_rows[N], purchasable)
    │   └── rows[1..row_count]  (each active Row has tier stats)
    ├── upgrades (per-plot row slots, future farmhands)
    └── sync metadata (anchors — server-owned; see §6)
```

- **50 Plots** are **fixed tiers** in catalog data (not procedural).
- **Rows** are homogeneous within a Plot in v1 (same icon/name per plot; numbers scale by plot tier).
- **Row slot upgrades** increase `row_count` up to that Plot’s **max_rows** (≤ 20).

### 3.2 Plot catalog (conceptual bands)

Plots are grouped for pacing; exact numbers live in `plots-catalog.json` (to be added at implementation).

| Plot # | Band name (display) | Max rows | Grow time (base) | Unlock (lifetime RU earned\*) |
|--------|---------------------|----------|------------------|-------------------------------|
| 1–5 | Daily fields | 8 | 0.4–1.2s | 0 – 50K |
| 6–15 | Homestead | 10 | 1–4s | 50K – 2M |
| 16–30 | County | 12–16 | 4–15s | 2M – 100M |
| 31–45 | Frontier | 18–20 | 15–60s | 100M – 10B |
| 46–50 | Archive | 20 | 60–180s | 10B+ |

\*Unlock condition options (pick one at implementation; document in UI):

- **A. Lifetime earned** (anti-cheat friendly): server tracks `lifetime_farms_earned` separately from balance so spending RU does not lock you out of already-unlocked plots.
- **B. Current balance** (simpler but punishes spending): same as reference idle game screenshots.

**Recommendation:** **A (lifetime earned)** for unlock gates; **current balance** for purchases (rows, slot upgrades).

### 3.3 Row and harvest math (v1)

Constants per Plot `p` from catalog:

- `base_ru_per_row_per_cycle[p]`
- `grow_time_sec[p]`
- `max_rows[p]` ≤ 20
- `full_bonus = 1.10` when `active_rows == row_count` and `row_count == max_rows[p]` (configurable: full bonus when all **owned** slots filled, even if not maxed to 20).

**Per Plot, per harvest event:**

```text
plot_ru_per_cycle = active_rows * base_ru_per_row_per_cycle[p] * bonus_multiplier
bonus_multiplier = (full_field ? 1.10 : 1.00) * fertilizer_multiplier * farmhand_multiplier
```

**Account-level rates (UI only, derived):**

```text
ru_per_sec_display = sum over unlocked plots p of (plot_ru_per_cycle[p] / grow_time_sec[p])
```

**Integer rule:** all grants **floor** to whole RU at settlement time; client may show one decimal for rates.

### 3.4 Costs (sketch)

- **Unlock Plot N:** `unlock_balance[N]` (see band table; exponential curve).
- **+1 Row slot** in Plot `p`: `row_slot_cost[p, current_count]` (geometric per slot).
- **Activate Row** (if split from slot): optional; v1 can auto-activate on purchase.

Tune so mid-game **daily farms cap** (§7) binds before raw math exceeds economy targets.

---

## 4. Screens and navigation

Matches reference UX; rename only.

| Tab | Screen | Notes |
|-----|--------|-------|
| **Plots** (home) | Scrollable list of 50 plot cards, locked/unlocked, aggregate RU/s | Default tab |
| Plot detail | Header stats + Row grid + Upgrades | Back nav to list |
| **Farmhands** | Placeholder | “Coming soon” |
| **Leaderboard** | Placeholder or witness board tied to `lifetime_farms_earned` | Optional v2 |
| **Replant** | Placeholder | Prestige |
| **Settings** | Sign-in, sync status, sound, legal links | Link to beta RU program |

**Boosts block (optional v1.1):** Fertilizer card (rewarded video or promo flag).

---

## 5. Balance model — one ledger, no drift

### 5.1 Source of truth

| Data | Authority | Storage |
|------|-----------|---------|
| **Spendable Root Units** | Server only | `rr_earn_balance.balance` |
| **Farms progression** | Server | New table `rr_farms_progress` (§8) |
| **Farms accrual anchor** | Server | `last_settled_ms` + optional `accrued_floor` in progress row |
| **Daily farms earn** | Server | `rr_earn_app_day` with `app_id = 'root_farms'` |
| **Lifetime farms earn** (unlocks) | Server | `rr_farms_progress.lifetime_earned` or `rr_earn_app_total` |

Existing mutators that **must** invalidate client preview:

- `/earn/heartbeat` (other apps)
- `/earn/checkin`, signup bonus
- `/earn/redeem-pro-month`
- `/v1/me/root-units/transfer`
- Discord `/send`, `/split`, etc. (`discord-root-units.ts`)
- Custodial withdraw / treasury flows (if they touch `rr_earn_balance`)

**Rule:** After any successful debit/credit to `rr_earn_balance`, farms clients **re-fetch** summary + farms state before allowing spends or showing spendable balance.

### 5.2 What the client may calculate offline

The client runs the **same deterministic function** as the server:

```text
accrued_ru = simulate_harvests(progress, last_settled_ms, now_ms, catalog, caps)
```

Used for:

- Progress bars and Row animations
- `+RU/s` display
- **Pending harvest** label (not spendable until settled — see below)

The client **must not** write `balance + accrued` into local “spendable” state.

### 5.3 Spendable vs pending (UX contract)

| Display | Meaning |
|---------|---------|
| **Root Units** (large number) | Last known **server** `balance` |
| **+X pending** (optional sublabel) | `simulate_harvests(...)` since `last_settled_ms`, not yet settled |
| **Buy** buttons | Disabled unless `server_balance >= cost` (refresh if stale) |

On **Settle** (app open, periodic, or explicit pull-to-sync), server applies pending accrual to `rr_earn_balance` and returns new `balance`; UI snaps pending to 0.

### 5.4 Why not “client balance + sync delta”

Failure modes:

1. User earns 10K pending offline; Discord send spends 50K on server; client still shows inflated total.
2. Two devices settle different pending amounts twice.
3. Pro redeem races with farm credit.

**Settlement-only credits** with idempotent `claim_id` prevent double mint.

---

## 6. Sync and settlement protocol

### 6.1 Identifiers

- `app_id`: `root_farms` (normalized like other earn apps).
- `user_id`: `user:<email>` (existing earn convention).
- `progress_version`: monotonic integer on `rr_farms_progress`; bump on every server write to progression or anchor.

### 6.2 Endpoints (proposed)

Implemented on **`rootrecord-api-account`** (same D1 as earn).

#### `GET /v1/farms/state`

Returns:

```json
{
  "ok": true,
  "balance": 61100,
  "balance_updated_at": "2026-05-16T12:00:00.000Z",
  "progress_version": 42,
  "last_settled_ms": 1715860800000,
  "lifetime_farms_earned": 2500000,
  "plots": [ /* compact state */ ],
  "daily": {
    "ymd": "2026-05-16",
    "units_earned": 12000,
    "daily_cap": 50000,
    "daily_remaining": 38000
  },
  "catalog_hash": "sha256:…"
}
```

#### `POST /v1/farms/settle`

**Idempotent** accrual credit (primary anti-cheat gate).

Request:

```json
{
  "client_now_ms": 1715864400000,
  "progress_version": 42,
  "plots": [ /* optional: full state if server does not store blobs */ ]
}
```

Server:

1. Auth session → `user_id`.
2. Load `rr_farms_progress` + `rr_earn_balance`.
3. If `progress_version` mismatch → **409** with fresh state (client merges).
4. `raw = simulate_harvests(stored_progress, last_settled_ms, min(now, last_settled_ms + OFFLINE_CAP_MS), catalog)`.
5. `grant = min(raw, daily_remaining, GLOBAL_RULES…)`.
6. **Single D1 batch:**
   - `UPDATE rr_earn_balance SET balance = balance + ?, updated_at = ? WHERE user_id = ?`
   - `UPDATE rr_farms_progress SET last_settled_ms = ?, lifetime_farms_earned = lifetime_farms_earned + ?, progress_version = progress_version + 1`
   - `UPDATE rr_earn_app_day …` / `rr_earn_app_total` for `root_farms`
7. Return `{ balance, granted, last_settled_ms, progress_version, daily_remaining }`.

**Offline cap:** `OFFLINE_CAP_MS` = 8 hours (configurable). Time beyond cap is ignored for accrual.

**Settle interval:** Client calls on cold start, resume, every 60–120s while foreground, and before any purchase.

#### `POST /v1/farms/purchase`

Atomic **debit + progression** (row slot, unlock plot if costs RU).

- `UPDATE rr_earn_balance SET balance = balance - ? WHERE user_id = ? AND balance >= ?`
- If `changes !== 1` → 409 insufficient funds (balance may have changed from Discord).
- Update `rr_farms_progress` plots JSON + bump `progress_version`.

Never purchase against `balance + pending`.

#### `POST /v1/farms/progress-only` (optional)

Saves layout/analytics without crediting RU (if server stores full state). Settlement still drives income.

### 6.3 Client state machine

```text
IDLE → (open app) → SYNC_START
SYNC_START → GET /farms/state → APPLY_SERVER
APPLY_SERVER → run local simulate from last_settled_ms → RENDER
RENDER → (timer) → animate bars locally
RENDER → (interval / background resume) → POST /farms/settle → APPLY_SERVER
PURCHASE → POST /farms/purchase → APPLY_SERVER
EXTERNAL_RU_EVENT* → force GET /earn/summary + GET /farms/state → APPLY_SERVER

*Detected by: WebSocket/poll not required v1 — use resume + periodic poll + push hook if added later.
```

**`APPLY_SERVER` rules:**

1. `spendable_balance = response.balance` (always).
2. `last_settled_ms = response.last_settled_ms`.
3. Replace `plots` from server if provided.
4. Reset local accrual baseline to match server anchors.
5. If `granted > 0`, play harvest feedback; update lifetime unlock flags.

### 6.4 Multi-device

- All devices share one `rr_farms_progress` row.
- **Last writer wins** on progression purchases with `progress_version` check (optimistic concurrency).
- Settlement is **idempotent per time window**: server stores `last_settled_ms`; second device cannot credit same window if first device advanced anchor (both call settle → second gets `granted ≈ 0` for overlapping period).

Recommend **short settle debounce** (≥ 5s) per user server-side.

### 6.5 Alignment with Discord / web spend

Sequence when user sends RU on Discord while farms app closed:

1. Discord bot debits `rr_earn_balance`.
2. User opens farms → `GET /farms/state` → lower `balance`.
3. `POST /farms/settle` credits only **new** harvest since `last_settled_ms` (does not restore spent RU).
4. Purchase buttons use fresh `balance`.

No special-case Discord code in farms client beyond **trusting server balance**.

### 6.6 Alignment with other earn sources

Heartbeat from Weather/Business **also** credits `rr_earn_balance`. Farms does not need to know; next `GET /farms/state` shows higher balance. **Pending harvest** display is independent of heartbeat (heartbeat already increased spendable balance).

Optional v1 policy: **shared daily cap** across all apps vs **separate 50K/day for root_farms only**.

| Policy | Pros | Cons |
|--------|------|------|
| Separate cap | Isolated tuning | Power users earn more total |
| Shared cap | Harder total inflation | Complex UX |

**Recommendation:** **Separate** `daily_cap` for `root_farms` (e.g. 50K/day initial), documented on Settings.

---

## 7. Economy guardrails

Suggested starting constants (tune in staging):

| Constant | Value | Notes |
|----------|-------|-------|
| `OFFLINE_CAP_MS` | 8 h | Prevents month-long offline mint |
| `FARMS_DAILY_CAP` | 50,000 RU/day | Per `rr_earn_app_day` for `root_farms` |
| `SETTLE_MIN_INTERVAL_MS` | 5,000 | Server-side throttle |
| `MAX_ROWS` | 20 | Per plot hard cap |
| `PLOTS_COUNT` | 50 | Fixed catalog |
| Plot 1 starting rows | 4 free | Tutorial pacing |

**Simulation worked example (Plot 1):**

- 8 rows, `0.5 RU/row/cycle`, grow `0.5s`, full bonus → `8 * 0.5 * 1.1 = 4.4 RU/cycle` → `8.8 RU/s` at full field.

Compare to existing heartbeat: **20 RU/s** while actively using another app (capped). Farms should be **complementary**, not strictly dominant, until late plots.

---

## 8. Database schema (proposed migration)

```sql
-- Per-user farms progression + settlement anchor
CREATE TABLE IF NOT EXISTS rr_farms_progress (
  user_id TEXT NOT NULL PRIMARY KEY,
  progress_version INTEGER NOT NULL DEFAULT 1,
  last_settled_ms INTEGER NOT NULL,
  lifetime_farms_earned INTEGER NOT NULL DEFAULT 0,
  plots_json TEXT NOT NULL,              -- compact state; or normalize later
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rr_farms_progress_updated
  ON rr_farms_progress(updated_at);

-- Optional: audit trail for settlements (debug / dispute)
CREATE TABLE IF NOT EXISTS rr_farms_settlement (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  granted INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  from_ms INTEGER NOT NULL,
  to_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
```

**`plots_json` shape (compact):**

```json
{
  "plots": [
    { "id": 1, "unlocked": true, "row_count": 8, "rows_active": 8 },
    { "id": 2, "unlocked": false, "row_count": 0, "rows_active": 0 }
  ]
}
```

Catalog lives in repo static JSON versioned by `catalog_hash`; server rejects settle if client hash mismatches (force app update).

---

## 9. Shared simulation module

To guarantee client preview == server grant:

- Package: `Web/cloudflare/shared/farms-sim/` (or `Web/main/root-farms/sim/` mirrored in Worker bundle).
- Pure functions: `simulateHarvests`, `plotRuPerCycle`, `applyDailyCap`.
- **Unit tests** with fixed clocks (required before launch).
- Worker and Capacitor WebView import the same logic (build step copies or publishes internal package).

**No `Math.random()`** in accrual.

---

## 10. Client implementation notes

### 10.1 Deployment targets

| Surface | Path (proposed) | Auth |
|---------|-----------------|------|
| Marketing embed | `Web/main/root-farms/` static or SPA | Optional guest demo mode (local-only) |
| Account hub / dedicated app | `Web/apps/root-farms-web/` + `Mobile/root-farms-app/` | JWT session → account API |
| API | `rootrecord-api-account` `/v1/farms/*` | Same as `/earn/*` |

Guest demo: **no** `rr_earn_balance` writes; banner: “Sign in to grow real Root Units.”

### 10.2 Offline behavior

1. User closes app at `T0` with server `last_settled_ms = T0`.
2. At `T1` (2h later), user opens app offline:
   - Client animates from local `simulate(T0, T1)` capped at 8h.
   - Spendable balance shows **cached** `balance` with “offline — sync to claim” if strict; or optimistic pending label.
3. Network returns → `POST /farms/settle` → balance increases by **server** `granted` (may differ slightly if catalog changed — show toast if reconciliation > 1%).

### 10.3 Purchases while offline

**Disallow** or queue until online; server must validate balance. Never apply local debit to spendable balance.

### 10.4 Formatting

- Integers ≥ 1000: `1.2K`, `5.00M` (match reference UI).
- Currency label: **Root Units** or **RU** (never `$`).

---

## 11. Auth and API base URL

- Session: existing `sessionFromRequest` / JWT cookie or mobile bearer.
- Base: `https://rootrecord-api-account.rootrecord.workers.dev` or `api.rootrecord.info` account routes.
- CORS: same allowlist as account hub web.

---

## 12. Testing checklist (balance alignment)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Settle twice same window | Second `granted = 0` |
| 2 | Discord `/send` reduces balance | Next state shows lower spendable; pending unchanged |
| 3 | Redeem Pro month | Balance −100K; farms purchases fail until synced |
| 4 | Two phones settle alternately | Total earned ≤ daily cap; no duplicate window |
| 5 | Clock skew (+2h device) | Server uses server time; grant capped |
| 6 | Offline 24h | Grant ≤ 8h equivalent |
| 7 | Change catalog hash | Old client forced update |
| 8 | Purchase row with exact balance | Success; `changes=1` |
| 9 | Purchase row; parallel Discord spend | 409 insufficient |
| 10 | Heartbeat from Weather + farms same day | Both respect respective caps |

---

## 13. Phased delivery

### Phase 0 — This document + catalog spreadsheet

- Finalize unlock curve for 50 plots.
- Sign off economy caps with ops.

### Phase 1 — Simulation library + tests

- `simulateHarvests` + golden vectors.
- No UI.

### Phase 2 — API + D1

- Migration `rr_farms_progress`, `/v1/farms/state`, `/settle`, `/purchase`.
- Admin script to inspect user row.

### Phase 3 — Web MVP

- Plots list + one plot detail, settle on timer, signed-in only.

### Phase 4 — Mobile shell

- Capacitor app or tab in account hub; push resume settle.

### Phase 5 — Polish

- Farmhands, Fertilizer, leaderboard, sound.

---

## 14. Open decisions

| # | Question | Default recommendation |
|---|----------|------------------------|
| 1 | Plot unlock: balance vs lifetime earned? | Lifetime earned |
| 2 | Shared vs separate daily cap? | Separate 50K for `root_farms` |
| 3 | Auto-settle on timer vs manual “Harvest” button? | Auto on resume + 60s foreground |
| 4 | Store full `plots_json` on server vs client-sent state? | Server-stored blob |
| 5 | Guest playable demo? | Yes, local-only; no RU credit |

---

## 15. Related code (existing)

| Area | Location |
|------|----------|
| Balance + heartbeat | `Web/cloudflare/rootrecord-api-account/src/earn.ts` |
| Discord transfers | `Web/cloudflare/rootrecord-api-account/src/discord-root-units.ts` |
| Web/API transfer | `Web/cloudflare/rootrecord-api-account/src/root-units-transfer.ts` |
| D1 schema | `Web/cloudflare/rootrecord-api-account/migrations/0019_rr_earn.sql` |
| Marketing copy | `Web/main/beta-tester-rewards.html` |

---

## 16. Glossary

| Internal | Player-facing |
|----------|----------------|
| `simulateHarvests` | Growing / pending harvest |
| `settle` | Sync / claim harvest |
| `rr_earn_balance` | Root Units balance |
| `plot` | Plot (tier) |
| `row` | Row |
| `root_farms` | Root Farms app id |

---

## Appendix A — Plot display names (draft)

| # | Name |
|---|------|
| 1 | Window box |
| 2 | Backyard patch |
| 3 | Corner garden |
| 4 | Side yard |
| 5 | Community plot |
| 6–10 | Creek, Hill, Meadow, Orchard, Pond |
| 11–20 | North, South, East, West, Central, River, Ridge, Valley, Grove, Terrace |
| 21–30 | Station, Junction, Crossing, Harbor, Market, Mill, Forge, Works, Yard, Depot |
| 31–40 | Cloud, Sync, Link, Mesh, Hub, Node, Core, Vault, Archive, Ledger |
| 41–50 | Root I … Root X |

Names are flavor only; stats come from catalog.

---

## Appendix B — Reference UI mapping

| Reference | Root Farms |
|-----------|------------|
| Data Centres | Plots |
| Servers | Rows |
| $/cycle | RU / harvest |
| Cycle time | Grow time |
| Engineers | Farmhands |
| Session Boost | Fertilizer |
| Prestige | Replant |

---

*Document owner: product + account API. Implementation tracking: create GitHub issue / project board when Phase 1 starts.*

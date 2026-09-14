import type { D1Database } from "@cloudflare/workers-types";
import { json } from "./cors";
import { resolveUserId } from "./auth";
import { extendProRedeemedUntil } from "./accounts";
import { getSignupBonusRow, SIGNUP_BONUS_UNITS } from "./earn-signup-bonus";
import {
  DAILY_CHECKIN_UNITS,
  DAILY_MAX_UNITS,
  MAX_CHUNK_SEC,
  MAX_GAP_SEC,
  MAX_SECONDS_PER_PAGE,
  PRO_REDEMPTION_DAYS,
  PRO_REDEMPTION_UNIT_COST,
  UNITS_PER_SECOND,
} from "../../shared/earn-program-constants";
import {
  FIRST_APP_OPEN_UNITS,
  getFirstAppOpenRow,
  grantFirstAppOpenBonus,
} from "../../shared/earn-app-first-open";
import {
  ROOTS_ATOMIC_PER_WHOLE,
  formatRootsAtomic,
  formatRootsAtomicLocale,
  rootsAtomicToWhole,
} from "../../shared/roots-units";
import type { CustodialCacheRpcEnv } from "./custodial-onchain-cache";
import { refreshCustodialOnchainCacheFromRpc } from "./custodial-onchain-cache";
import { readCustodialTokenSlots } from "./custodial-wallet-token-slots";
import { sessionFromRequest } from "./primary-auth";

export interface EarnEnv {
  DB: D1Database;
  JWT_SECRET: string;
  SOLANA_RPC_URL?: string;
  RRTT_MINT_BASE58?: string;
  RRTT_DECIMALS?: string;
  CUSTODIAL_RPC_REFRESH_BUDGET_MS?: string;
}

/** Bound Solana wait for `/earn/summary` custodial refresh (same order of magnitude as login cache). */
const EARN_SUMMARY_CUSTODIAL_RPC_MS = 10_000;

export { PRO_REDEMPTION_UNIT_COST, PRO_REDEMPTION_DAYS } from "../../shared/earn-program-constants";

const APP_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const PAGE_RE = /^[a-z0-9/_-]{0,200}$/i;

function utcYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function requireSignedUser(request: Request, env: EarnEnv) {
  return resolveUserId(request, env) as Promise<string | Response>;
}

function normalizeAppId(raw: string | undefined, fallback: string): string {
  const s = String(raw || "")
    .trim()
    .slice(0, 80);
  if (s && APP_RE.test(s)) return s.toLowerCase();
  if (APP_RE.test(fallback)) return fallback.toLowerCase();
  return "app_unknown";
}

function normalizePage(raw: string | undefined): string {
  const s = String(raw || "/")
    .trim()
    .slice(0, 200);
  if (s && PAGE_RE.test(s) && s.startsWith("/")) return s;
  return "/";
}

function decimalRootsToAtomic(raw: string): number {
  const s = String(raw || "").trim();
  if (!s || s.startsWith("-")) return 0;
  const [wholeRaw, fracRaw = ""] = s.split(".");
  const whole = Math.max(0, Math.floor(Number(wholeRaw || "0") || 0));
  const fracDigits = fracRaw.replace(/[^0-9]/g, "").slice(0, 8).padEnd(8, "0");
  const frac = Math.max(0, Math.floor(Number(fracDigits) || 0));
  return Math.min(Number.MAX_SAFE_INTEGER, whole * ROOTS_ATOMIC_PER_WHOLE + frac);
}

function parseIncomingEarnAtomic(raw: unknown): number {
  if (raw == null || raw === "") return 0;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return 0;
    if (s.includes(".")) return decimalRootsToAtomic(s);
    const integerAtomic = Math.floor(Number(s));
    return Number.isFinite(integerAtomic) && integerAtomic > 0 ? integerAtomic : 0;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (Number.isInteger(n)) return Math.floor(n);
  return decimalRootsToAtomic(String(raw));
}

export async function handleEarnRoutes(
  request: Request,
  env: EarnEnv,
  sub: string,
  method: string
): Promise<Response | null> {
  if (!sub.startsWith("/earn/")) return null;
  if (sub === "/earn/summary" && method === "GET") {
    return earnSummary(request, env);
  }
  if (sub === "/earn/heartbeat" && method === "POST") {
    return earnHeartbeat(request, env);
  }
  if (sub === "/earn/checkin" && method === "POST") {
    return earnCheckin(request, env);
  }
  if (sub === "/earn/redeem-pro-month" && method === "POST") {
    return earnRedeemProMonth(request, env);
  }
  return json({ detail: "Not found" }, 404);
}

/**
 * Burns PRO_REDEMPTION_UNIT_COST rewards points and extends the caller's Pro window by
 * PRO_REDEMPTION_DAYS. The balance debit and the `pro_redeemed_until` extension run in
 * a single D1 batch so a partial credit can't happen on transient failure. Returns the
 * new balance + new expiration ISO so the UI can refresh without an extra round-trip.
 */
async function earnRedeemProMonth(request: Request, env: EarnEnv): Promise<Response> {
  if (!env.JWT_SECRET) return json({ detail: "Server is not configured for authenticated requests." }, 503);
  const sess = await sessionFromRequest(env, request);
  if (!sess) return json({ detail: "Sign in required." }, 401);
  const email = (sess.email || "").trim().toLowerCase();
  if (!email) return json({ detail: "Account email is required for redemption." }, 400);

  const userId = "user:" + email;
  const nowIso = new Date().toISOString();
  await ensureBalance(env.DB, userId, nowIso);

  const balance = await getBalance(env.DB, userId);
  if (balance < PRO_REDEMPTION_UNIT_COST) {
    return json(
      {
        detail: `You need ${formatRootsAtomicLocale(PRO_REDEMPTION_UNIT_COST)} Roots to redeem one month of Pro. Current balance: ${formatRootsAtomicLocale(balance)}.`,
        balance,
        cost: PRO_REDEMPTION_UNIT_COST,
        short_by: PRO_REDEMPTION_UNIT_COST - balance,
      },
      400,
    );
  }

  // Conditional UPDATE — if `balance >= cost` still holds at write time, the row is decremented.
  // `changes` lets us detect a TOCTOU race where someone else spent the points first.
  const debit = await env.DB
    .prepare(
      `UPDATE rr_earn_balance
       SET balance = balance - ?, updated_at = ?
       WHERE user_id = ? AND balance >= ?`,
    )
    .bind(PRO_REDEMPTION_UNIT_COST, nowIso, userId, PRO_REDEMPTION_UNIT_COST)
    .run();
  if ((debit.meta?.changes ?? 0) !== 1) {
    return json({ detail: "Balance changed before we could complete the redemption. Please try again." }, 409);
  }

  let nextExpiresAt: string | null = null;
  try {
    nextExpiresAt = await extendProRedeemedUntil(env.DB, email, PRO_REDEMPTION_DAYS);
  } catch (e) {
    // Refund the debit so a write failure on user_accounts doesn't lose points silently.
    await env.DB
      .prepare(
        `UPDATE rr_earn_balance SET balance = balance + ?, updated_at = ? WHERE user_id = ?`,
      )
      .bind(PRO_REDEMPTION_UNIT_COST, new Date().toISOString(), userId)
      .run()
      .catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ msg: "redeem_pro_month_extend_err", err: msg.slice(0, 200), email }));
    return json({ detail: "Could not apply your Pro extension. Your points have been refunded." }, 500);
  }
  if (!nextExpiresAt) {
    // No user_accounts row — shouldn't happen for a session-authenticated user, but refund to be safe.
    await env.DB
      .prepare(
        `UPDATE rr_earn_balance SET balance = balance + ?, updated_at = ? WHERE user_id = ?`,
      )
      .bind(PRO_REDEMPTION_UNIT_COST, new Date().toISOString(), userId)
      .run()
      .catch(() => {});
    return json({ detail: "Account profile is not ready for redemption yet. Sign out and back in, then try again." }, 409);
  }

  const newBalance = await getBalance(env.DB, userId);
  return json(
    {
      ok: true,
      balance: newBalance,
      cost: PRO_REDEMPTION_UNIT_COST,
      pro_redeemed_until: nextExpiresAt,
      pro_unlocked: true,
    },
    200,
  );
}

async function getBalance(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare("SELECT balance FROM rr_earn_balance WHERE user_id = ?").bind(userId).first<{ balance: number }>();
  if (!row) return 0;
  return Math.max(0, Number(row.balance) || 0);
}

async function getAppDay(
  db: D1Database,
  userId: string,
  appId: string,
  ymd: string
): Promise<{ units_earned: number; checkin_claimed: number }> {
  const row = await db
    .prepare(
      "SELECT units_earned, checkin_claimed FROM rr_earn_app_day WHERE user_id = ? AND app_id = ? AND ymd = ?"
    )
    .bind(userId, appId, ymd)
    .first<{ units_earned: number; checkin_claimed: number }>();
  if (!row) return { units_earned: 0, checkin_claimed: 0 };
  return {
    units_earned: Math.max(0, Number(row.units_earned) || 0),
    checkin_claimed: row.checkin_claimed ? 1 : 0,
  };
}

async function ensureBalance(db: D1Database, userId: string, nowIso: string) {
  await db
    .prepare("INSERT OR IGNORE INTO rr_earn_balance (user_id, balance, updated_at) VALUES (?, 0, ?)")
    .bind(userId, nowIso)
    .run();
}

/** Whole SPL units from `custodial_wallet_token_slots.amount_raw` + decimals. */
function custodialSlotWholeUnits(amountRaw: string, decimals: number): number {
  try {
    const r = BigInt(String(amountRaw || "0").split(".")[0] || "0");
    const d = Math.min(20, Math.max(0, Math.floor(decimals)));
    if (d === 0) return Number(r);
    const div = 10n ** BigInt(d);
    const whole = r / div;
    const n = Number(whole);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  } catch {
    return 0;
  }
}

function rrttWholeUnitsFromSlots(
  slots: { mint_base58: string; amount_raw: string; decimals: number }[],
  mintB58: string,
): number | null {
  const m = String(mintB58 || "").trim();
  if (!m || slots.length === 0) return null;
  const row = slots.find((s) => String(s.mint_base58 || "").trim() === m);
  if (!row) return null;
  return custodialSlotWholeUnits(row.amount_raw, row.decimals);
}

function slotsAnyPositiveBalance(
  slots: { mint_base58: string; amount_raw: string }[] | undefined,
): boolean {
  if (!slots || slots.length === 0) return false;
  for (const t of slots) {
    try {
      if (BigInt(String(t.amount_raw || "0")) > 0n) return true;
    } catch {
      /* */
    }
  }
  return false;
}

async function earnSummary(request: Request, env: EarnEnv): Promise<Response> {
  const u = await requireSignedUser(request, env);
  if (u instanceof Response) return u;
  if (!u.startsWith("user:")) {
    return json({ detail: "Sign in required." }, 401);
  }
  const userId = u;
  const ymd = utcYmd();
  const nowIso = new Date().toISOString();
  await ensureBalance(env.DB, userId, nowIso);

  const sp = new URL(request.url).searchParams;
  const appId = normalizeAppId(sp.get("app_id") || undefined, "rootrecord_weather_manager_android");
  const skipCustodialRefresh = sp.get("custodial_refresh") === "0" || sp.get("light") === "1";
  const balance = await getBalance(env.DB, userId);
  const appDay = await getAppDay(env.DB, userId, appId, ymd);

  const st = await env.DB.prepare(
    "SELECT app_id, page_path, t_enter_ms, sec_on_page, last_heartbeat_ms FROM rr_earn_state WHERE user_id = ?"
  )
    .bind(userId)
    .all<{
      app_id: string;
      page_path: string;
      t_enter_ms: number;
      sec_on_page: number;
      last_heartbeat_ms: number;
    }>();
  const thisApp = (st.results || []).find((r) => (r.app_id || "").toLowerCase() === appId);

  const byApp = await env.DB.prepare(
    `SELECT app_id, total_units
     FROM rr_earn_app_total
     WHERE user_id = ? ORDER BY app_id`
  )
    .bind(userId)
    .all<{ app_id: string; total_units: number }>();

  const byAppDay = await env.DB.prepare(
    "SELECT app_id, units_earned FROM rr_earn_app_day WHERE user_id = ? AND ymd = ? ORDER BY app_id"
  )
    .bind(userId, ymd)
    .all<{ app_id: string; units_earned: number }>();

  const checkinLeft = DAILY_MAX_UNITS - appDay.units_earned;
  const claimable = appDay.checkin_claimed === 0 && checkinLeft > 0;
  const wouldGrant = Math.min(DAILY_CHECKIN_UNITS, checkinLeft);
  const signupRow = await getSignupBonusRow(env.DB, userId);
  const firstOpenRow = await getFirstAppOpenRow(env.DB, userId, appId);

  let custodial_tokens:
    | {
        mint_base58: string;
        token_program_id: string;
        ata_pubkey: string;
        decimals: number;
        amount_raw: string;
        updated_at: string;
      }[]
    | undefined;

  let custodial_pending_units = 0;
  let custodial_units_sent = 0;
  let custodial_available_withdraw_units = 0;
  let custodial_onchain_rrtt: number | null = null;
  let custodial_balances_rpc_ok = false;
  let custodial_sum_ledger_and_wallet_units = 0;
  let rrtt_wallet_whole_units: number | null = null;
  try {
    if (env.JWT_SECRET && !skipCustodialRefresh) {
      const sess = await sessionFromRequest(env, request);
      if (sess) {
        // `/auth/me` refreshes this cache in `waitUntil` (after respond), so mobile often loaded
        // `/earn/summary` before D1 updated. Await one bounded refresh here, then read `rr_earn_custodial_state`.
        const cacheRes = await refreshCustodialOnchainCacheFromRpc(
          env as EarnEnv & CustodialCacheRpcEnv,
          sess.accountId,
          {
            rpcBudgetMs: EARN_SUMMARY_CUSTODIAL_RPC_MS,
            bypassWriteThrottle: true,
          },
        ).catch(() => null);
        if (cacheRes?.rpc_ok) custodial_balances_rpc_ok = true;

        const csRow = await env.DB
          .prepare(
            `SELECT IFNULL(cs.units_sent_to_custodial, 0) AS sent,
                    IFNULL(cs.units_withdrawn_from_custodial, 0) AS withdrawn,
                    cs.custodial_rrtt_onchain AS onchain
             FROM rr_earn_custodial_state cs
             WHERE cs.account_id = ?`,
          )
          .bind(sess.accountId)
          .first<{ sent: number; withdrawn: number; onchain: number | null }>();
        const sent = Math.max(0, Math.floor(Number(csRow?.sent) || 0));
        const withdrawn = Math.max(0, Math.floor(Number(csRow?.withdrawn) || 0));
        const onchainDb = csRow?.onchain != null ? Math.max(0, Math.floor(Number(csRow.onchain) || 0)) : null;
        custodial_units_sent = sent;

        custodial_tokens = await readCustodialTokenSlots(env.DB, sess.accountId, 120).catch(() => undefined);

        const rrttMint = String(env.RRTT_MINT_BASE58 || "").trim();
        const rrttFromSlots =
          custodial_tokens && rrttMint ? rrttWholeUnitsFromSlots(custodial_tokens, rrttMint) : null;

        /** Prefer live mint read, then full-wallet slot scan (direct deposits), then D1 cache. */
        const rrttFromLiveRpc =
          cacheRes?.token_rpc_ok === true && typeof cacheRes.custodial_rrtt_onchain === "number"
            ? Math.max(0, Math.floor(cacheRes.custodial_rrtt_onchain))
            : null;

        const rrttCandidates: number[] = [];
        if (rrttFromLiveRpc != null) rrttCandidates.push(rrttFromLiveRpc);
        if (rrttFromSlots != null) rrttCandidates.push(rrttFromSlots);
        if (onchainDb != null) rrttCandidates.push(onchainDb);
        const walletWithdrawUnits =
          rrttCandidates.length > 0 ? Math.max(...rrttCandidates.map((n) => Math.floor(Number(n) || 0))) : 0;

        custodial_available_withdraw_units = walletWithdrawUnits;
        custodial_onchain_rrtt =
          rrttCandidates.length > 0 ? Math.max(...rrttCandidates.map((n) => Math.floor(Number(n) || 0))) : onchainDb;
        rrtt_wallet_whole_units = rrttMint ? walletWithdrawUnits : null;
        /**
         * `balance` is lifetime earn credits; `sent` is how much was mirrored to custodial in DB.
         * Do not add balance + on-chain SPL (double-count). Headline total = not-yet-moved + in-wallet.
         */
        custodial_pending_units = Math.max(0, balance - sent);
        custodial_sum_ledger_and_wallet_units = custodial_pending_units + walletWithdrawUnits;
      }
    }
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("earnSummary custodial slice", msg);
  }

  const hasCustodialSlice =
    custodial_units_sent > 0 ||
    custodial_balances_rpc_ok ||
    (custodial_onchain_rrtt != null && Number.isFinite(Number(custodial_onchain_rrtt))) ||
    custodial_pending_units < balance ||
    slotsAnyPositiveBalance(custodial_tokens);
  /** What users should see as “your RRTT total” after treasury→custodial: pending + SPL in RootRecord Wallet (not lifetime ledger alone). */
  const balance_display = Math.max(
    0,
    Math.floor(hasCustodialSlice ? custodial_sum_ledger_and_wallet_units : balance),
  );

  return json(
    {
      roots_atomic_per_whole: ROOTS_ATOMIC_PER_WHOLE,
      roots_smallest_unit_whole: 0.00000001,
      balance,
      balance_whole: rootsAtomicToWhole(balance),
      balance_display,
      balance_display_whole: rootsAtomicToWhole(balance_display),
      /** Mobile `rewardsFormat.js` only renders pending/wallet when this is true. */
      custodial_summary_attached: true,
      custodial_pending_units,
      custodial_units_sent,
      custodial_available_withdraw_units,
      custodial_onchain_rrtt,
      custodial_balances_rpc_ok,
      custodial_sum_ledger_and_wallet_units,
      ...(custodial_tokens !== undefined ? { custodial_tokens } : {}),
      ...(rrtt_wallet_whole_units != null ? { rrtt_wallet_whole_units } : {}),
      total_rewards_units: balance,
      /** Same balance as `total_rewards_units`; preferred display name “Root Units”. */
      root_units: balance,
      /** Full D1 ledger — same as Discord `/bal`. Not `custodial_pending_units` (balance − sent). */
      root_units_balance: balance,
      /** Spendable ledger in D1 — use this (not `balance_display`) for farms, account portal, purchases. */
      ledger_balance: balance,
      signup_bonus: {
        one_time_across_apps: true,
        program_units: SIGNUP_BONUS_UNITS,
        received: Boolean(signupRow),
        received_units: signupRow ? signupRow.units : 0,
        granted_at: signupRow?.granted_at ?? null,
      },
      first_open_bonus: {
        per_app: true,
        program_units: FIRST_APP_OPEN_UNITS,
        received: Boolean(firstOpenRow),
        received_units: firstOpenRow ? firstOpenRow.units : 0,
        granted_at: firstOpenRow?.granted_at ?? null,
      },
      ymd,
      app_id: appId,
      today_units_earned: appDay.units_earned,
      daily_cap: DAILY_MAX_UNITS,
      daily_cap_scope: "per_app",
      daily_remaining: Math.max(0, DAILY_MAX_UNITS - appDay.units_earned),
      units_per_second: UNITS_PER_SECOND,
      max_seconds_per_page: MAX_SECONDS_PER_PAGE,
      checkin: {
        claimable,
        checkin_amount: DAILY_CHECKIN_UNITS,
        next_checkin_would_be: wouldGrant,
        claimed_today: Boolean(appDay.checkin_claimed),
      },
      per_app_total: (byApp.results || []).map((r) => ({
        app_id: r.app_id,
        total_units: Math.max(0, Math.floor(Number(r.total_units) || 0)),
      })),
      per_app_today: (byAppDay.results || []).map((r) => ({
        app_id: r.app_id,
        units: Math.max(0, Math.floor(Number(r.units_earned) || 0)),
      })),
      focus: thisApp
        ? {
            app_id: thisApp.app_id,
            page: thisApp.page_path,
            seconds_on_page: Math.max(0, Math.floor(Number(thisApp.sec_on_page) || 0)),
            at_page_cap: Math.max(0, Math.floor(Number(thisApp.sec_on_page) || 0)) >= MAX_SECONDS_PER_PAGE,
          }
        : null,
    },
    200,
    { "Cache-Control": "private, no-store" },
  );
}

async function incAppTotals(
  db: D1Database,
  userId: string,
  appId: string,
  ymd: string,
  units: number,
  nowIso: string
) {
  if (units <= 0) return;
  const iu = Math.floor(units);
  const rowT = await db
    .prepare("SELECT total_units FROM rr_earn_app_total WHERE user_id = ? AND app_id = ?")
    .bind(userId, appId)
    .first<{ total_units: number }>();
  const start = rowT ? Math.max(0, Math.floor(Number(rowT.total_units) || 0)) : 0;
  await db
    .prepare(
      `INSERT INTO rr_earn_app_total (user_id, app_id, total_units, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, app_id) DO UPDATE SET total_units = excluded.total_units, updated_at = excluded.updated_at`
    )
    .bind(userId, appId, start + iu, nowIso)
    .run();

  const rowD = await db
    .prepare("SELECT units_earned FROM rr_earn_app_day WHERE user_id = ? AND app_id = ? AND ymd = ?")
    .bind(userId, appId, ymd)
    .first<{ units_earned: number }>();
  const startD = rowD ? Math.max(0, Math.floor(Number(rowD.units_earned) || 0)) : 0;
  await db
    .prepare(
      `INSERT INTO rr_earn_app_day (user_id, app_id, ymd, units_earned, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, app_id, ymd) DO UPDATE SET units_earned = excluded.units_earned, updated_at = excluded.updated_at`
    )
    .bind(userId, appId, ymd, startD + iu, nowIso)
    .run();
}

async function earnHeartbeat(request: Request, env: EarnEnv): Promise<Response> {
  const u = await requireSignedUser(request, env);
  if (u instanceof Response) return u;
  if (!u.startsWith("user:")) {
    return json({ detail: "Sign in required." }, 401);
  }
  const userId = u;
  let body: {
    app_id?: string;
    appId?: string;
    page?: string;
    earning?: unknown;
    earnings?: unknown;
    reward?: unknown;
    reward_units?: unknown;
    root_units?: unknown;
    units?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }
  const appId = normalizeAppId(body.appId || body.app_id, "rootrecord_weather_manager_android");
  const page = normalizePage(body.page);

  const ymd = utcYmd();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  await ensureBalance(env.DB, userId, nowIso);
  await grantFirstAppOpenBonus(env.DB, userId, appId, nowIso);
  const appDay0 = await getAppDay(env.DB, userId, appId, ymd);
  const dailyLeft = DAILY_MAX_UNITS - appDay0.units_earned;
  if (dailyLeft <= 0) {
    const b = await getBalance(env.DB, userId);
    return json(
      {
        ok: true,
        daily_capped: true,
        granted: 0,
        balance: b,
        today: appDay0.units_earned,
        ymd,
        page,
        app_id: appId,
        daily_cap_scope: "per_app",
      },
      200
    );
  }

  const stRow = await env.DB.prepare(
    "SELECT page_path, sec_on_page, last_heartbeat_ms FROM rr_earn_state WHERE user_id = ? AND app_id = ?"
  )
    .bind(userId, appId)
    .first<{ page_path: string; sec_on_page: number; last_heartbeat_ms: number }>();

  let pageChanged = false;
  if (!stRow) {
    pageChanged = true;
  } else if ((stRow.page_path || "/") !== page) {
    pageChanged = true;
  }

  if (pageChanged) {
    await env.DB
      .prepare(
        `INSERT INTO rr_earn_state (user_id, app_id, page_path, t_enter_ms, sec_on_page, last_heartbeat_ms, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(user_id, app_id) DO UPDATE SET
           page_path = excluded.page_path,
           t_enter_ms = excluded.t_enter_ms,
           sec_on_page = 0,
           last_heartbeat_ms = excluded.last_heartbeat_ms,
           updated_at = excluded.updated_at`
      )
      .bind(userId, appId, page, now, now, nowIso)
      .run();
    const b = await getBalance(env.DB, userId);
    return json(
      {
        ok: true,
        granted: 0,
        page_changed: true,
        balance: b,
        today: appDay0.units_earned,
        ymd,
        page,
        sec_on_page: 0,
        app_id: appId,
      },
      200
    );
  }

  const last = Math.max(0, Math.floor(Number(stRow?.last_heartbeat_ms) || now - 2000));
  const dt = (now - last) / 1000;
  if (dt < 0.35) {
    const b = await getBalance(env.DB, userId);
    const s = stRow
      ? Math.max(0, Math.floor(Number(stRow.sec_on_page) || 0))
      : 0;
    return json(
      { ok: true, granted: 0, throttled: true, balance: b, today: appDay0.units_earned, ymd, page, sec_on_page: s, app_id: appId },
      200
    );
  }

  let dtc = Math.floor(Math.min(Math.max(dt, 0), MAX_GAP_SEC, MAX_CHUNK_SEC));
  if (dt > MAX_GAP_SEC) dtc = 0;

  const sec0 = stRow ? Math.max(0, Math.floor(Number(stRow.sec_on_page) || 0)) : 0;
  const pageLeft = Math.max(0, MAX_SECONDS_PER_PAGE - sec0);
  if (pageLeft <= 0 || dtc === 0) {
    await env.DB
      .prepare("UPDATE rr_earn_state SET last_heartbeat_ms = ?, updated_at = ? WHERE user_id = ? AND app_id = ?")
      .bind(now, nowIso, userId, appId)
      .run();
    const b = await getBalance(env.DB, userId);
    return json(
      {
        ok: true,
        granted: 0,
        at_page_or_idle: true,
        balance: b,
        today: appDay0.units_earned,
        ymd,
        page,
        sec_on_page: sec0,
        app_id: appId,
      },
      200
    );
  }

  const incomingEarnAtomic = parseIncomingEarnAtomic(
    body.reward_units ?? body.root_units ?? body.earning ?? body.earnings ?? body.reward ?? body.units,
  );
  const maxSecByDay = Math.floor(dailyLeft / UNITS_PER_SECOND);
  const rawSec = Math.max(0, Math.min(dtc, pageLeft, maxSecByDay));
  const granted = incomingEarnAtomic > 0 ? Math.min(incomingEarnAtomic, dailyLeft) : rawSec * UNITS_PER_SECOND;
  const newSec = sec0 + rawSec;

  const bal0 = await getBalance(env.DB, userId);
  const newBalance = bal0 + granted;
  const newAppDayTotal = appDay0.units_earned + granted;

  await env.DB
    .prepare("UPDATE rr_earn_balance SET balance = ?, updated_at = ? WHERE user_id = ?")
    .bind(newBalance, nowIso, userId)
    .run();
  if (granted > 0) {
    await incAppTotals(env.DB, userId, appId, ymd, granted, nowIso);
    const { maybeTouchRootEconomyAfterEarn } = await import("../../shared/root-economy-snapshot");
    await maybeTouchRootEconomyAfterEarn(env.DB, granted, "heartbeat");
  }
  await env.DB
    .prepare(
      "UPDATE rr_earn_state SET sec_on_page = ?, last_heartbeat_ms = ?, updated_at = ? WHERE user_id = ? AND app_id = ?"
    )
    .bind(newSec, now, nowIso, userId, appId)
    .run();

  return json(
    {
      ok: true,
      granted,
      incoming_earn_atomic: incomingEarnAtomic || undefined,
      balance: newBalance,
      today: newAppDayTotal,
      ymd,
      page,
      app_id: appId,
      daily_cap: DAILY_MAX_UNITS,
      daily_cap_scope: "per_app",
      sec_on_page: newSec,
      at_page_cap: newSec >= MAX_SECONDS_PER_PAGE,
    },
    200
  );
}

async function earnCheckin(request: Request, env: EarnEnv): Promise<Response> {
  const u = await requireSignedUser(request, env);
  if (u instanceof Response) return u;
  if (!u.startsWith("user:")) {
    return json({ detail: "Sign in required." }, 401);
  }
  const userId = u;
  let body: { app_id?: string; appId?: string };
  try {
    body = (await request.json().catch(() => ({}))) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }
  const appId = normalizeAppId(body.appId || body.app_id, "rootrecord_weather_manager_android");
  const ymd = utcYmd();
  const nowIso = new Date().toISOString();
  await ensureBalance(env.DB, userId, nowIso);
  const appDay0 = await getAppDay(env.DB, userId, appId, ymd);
  if (appDay0.checkin_claimed) {
    return json(
      {
        ok: false,
        reason: "already_claimed",
        ymd,
        app_id: appId,
        today: appDay0.units_earned,
        balance: await getBalance(env.DB, userId),
      },
      200
    );
  }
  const dailyLeft = DAILY_MAX_UNITS - appDay0.units_earned;
  const grant = Math.min(DAILY_CHECKIN_UNITS, dailyLeft);
  if (grant <= 0) {
    return json(
      {
        ok: false,
        reason: "daily_cap",
        ymd,
        app_id: appId,
        today: appDay0.units_earned,
        balance: await getBalance(env.DB, userId),
        daily_cap_scope: "per_app",
      },
      200
    );
  }
  const bal0 = await getBalance(env.DB, userId);
  const newAppDay = appDay0.units_earned + grant;
  const newBalance = bal0 + grant;
  await env.DB
    .prepare("UPDATE rr_earn_balance SET balance = ?, updated_at = ? WHERE user_id = ?")
    .bind(newBalance, nowIso, userId)
    .run();
  await incAppTotals(env.DB, userId, appId, ymd, grant, nowIso);
  const { maybeTouchRootEconomyAfterEarn } = await import("../../shared/root-economy-snapshot");
  await maybeTouchRootEconomyAfterEarn(env.DB, grant, "checkin");
  await env.DB
    .prepare(
      "UPDATE rr_earn_app_day SET checkin_claimed = 1, updated_at = ? WHERE user_id = ? AND app_id = ? AND ymd = ?"
    )
    .bind(nowIso, userId, appId, ymd)
    .run();
  return json(
    {
      ok: true,
      granted: grant,
      checkin: DAILY_CHECKIN_UNITS,
      ymd,
      app_id: appId,
      today: newAppDay,
      daily_cap: DAILY_MAX_UNITS,
      daily_cap_scope: "per_app",
      daily_remaining: Math.max(0, DAILY_MAX_UNITS - newAppDay),
      balance: newBalance,
    },
    200
  );
}

import type { D1Database } from "@cloudflare/workers-types";
import { json } from "./cors";
import { resolveUserId } from "./auth";
import { getSignupBonusRow, SIGNUP_BONUS_UNITS } from "./earn-signup-bonus";
import {
  FIRST_APP_OPEN_UNITS,
  getFirstAppOpenRow,
  grantFirstAppOpenBonus,
} from "../../shared/earn-app-first-open";
import type { CustodialCacheRpcEnv } from "./custodial-onchain-cache";
import { refreshCustodialOnchainCacheFromRpc } from "./custodial-onchain-cache";
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

/** Per second of credited time on a route; 15 min = 900s → 900×200 = 180,000 units per page visit max. */
const UNITS_PER_SECOND = 200;
const MAX_SECONDS_PER_PAGE = 15 * 60; // 900
const DAILY_CHECKIN_UNITS = 100_000;
/** Per app, per UTC day (separate app A + B + C can each hit this). */
const DAILY_MAX_UNITS = 1_000_000;
/** Ignore gaps longer than this (app backgrounded / device sleep) — no retroactive credit. */
const MAX_GAP_SEC = 90;
/** Per request, cap wall-clock chunk so a burst of heartbeats cannot mint huge amounts. */
const MAX_CHUNK_SEC = 10;

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
  return json({ detail: "Not found" }, 404);
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

  let custodial_pending_units = 0;
  let custodial_units_sent = 0;
  let custodial_available_withdraw_units = 0;
  let custodial_onchain_rrtt: number | null = null;
  let custodial_balances_rpc_ok = false;
  let custodial_sum_ledger_and_wallet_units = 0;
  try {
    if (env.JWT_SECRET) {
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

        /** SPL whole units when the custodial refresh actually read token balances (includes legitimate 0). */
        const rrttFromLiveRpc =
          cacheRes?.token_rpc_ok === true && typeof cacheRes.custodial_rrtt_onchain === "number"
            ? Math.max(0, Math.floor(cacheRes.custodial_rrtt_onchain))
            : null;

        let walletWithdrawUnits: number;
        if (rrttFromLiveRpc !== null) {
          walletWithdrawUnits = rrttFromLiveRpc;
        } else if (onchainDb != null && onchainDb > 0) {
          walletWithdrawUnits = onchainDb;
        } else {
          walletWithdrawUnits = 0;
        }

        custodial_available_withdraw_units = walletWithdrawUnits;
        custodial_onchain_rrtt = rrttFromLiveRpc !== null ? rrttFromLiveRpc : onchainDb;
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
    custodial_pending_units < balance;
  /** What users should see as “your RRTT total” after treasury→custodial: pending + SPL in RootRecord Wallet (not lifetime ledger alone). */
  const balance_display = Math.max(
    0,
    Math.floor(hasCustodialSlice ? custodial_sum_ledger_and_wallet_units : balance),
  );

  return json(
    {
      balance,
      balance_display,
      /** Mobile `rewardsFormat.js` only renders pending/wallet when this is true. */
      custodial_summary_attached: true,
      custodial_pending_units,
      custodial_units_sent,
      custodial_available_withdraw_units,
      custodial_onchain_rrtt,
      custodial_balances_rpc_ok,
      custodial_sum_ledger_and_wallet_units,
      total_rewards_units: balance,
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
  let body: { app_id?: string; appId?: string; page?: string };
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

  const maxSecByDay = Math.floor(dailyLeft / UNITS_PER_SECOND);
  const rawSec = Math.max(0, Math.min(dtc, pageLeft, maxSecByDay));
  const granted = rawSec * UNITS_PER_SECOND;
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

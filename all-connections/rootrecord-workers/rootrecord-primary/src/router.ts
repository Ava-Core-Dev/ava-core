import type { D1Database, ExecutionContext, SendEmail } from "@cloudflare/workers-types";

import { bindCorsRequest, cors, json } from "./cors";

import { resolveUserId } from "./auth";

import { authLogin, authMe, authSignup, extractAuthToken, sessionFromRequest } from "./primary-auth";
import { scheduleAuthLoginDiscordSessionNotify } from "../../shared/discord-app-session-notify";
import { buildSessionCookieHeader, ssoCookieDomainForApiHost } from "./web-sso";
import { buildSessionInsertMeta, handleAuthLogout, handleAuthLogoutAll, handleMeAccountRoutes } from "./me-account-routes";

import { createStripeSubscriptionCheckout } from "./billing-stripe";

import { handleLocations } from "./locations";

import { handlePushRoutes, verifyWorkerOpsAdmin } from "./push";
import { handlePrefsRoutes } from "./prefs";
import { handleEarnRoutes } from "./earn";
import { handleBusinessRoutes, handleBusinessAuthEntitlement, bmWipeOwnedRows } from "./business-mobile";
import { handleFeedbackRoute } from "./feedback-route";
import { performAccountDeletion } from "./account-deletion";
import { handleRewardsLedgerV1 } from "./earn-rewards-ledger";
import {
  handleCustodialInternalBackfillRoute,
  handleCustodialSolWalletV1,
  handleCustodialWithdrawDestV1,
  handleRunRrttCustodialCronRoute,
  handleSolanaInternalWalletRoutes,
  handleSweepCustodialSolAllRoute,
} from "./solana-internal-wallet";
import { proxyTreasurySolanaTxRoutes } from "./treasury-solana-tx-proxy";
import { handleSolanaSiteLogRoute } from "./solana-site-log";
import { handleSolanaSiteTokenDiscordNotifyRoute } from "./solana-site-token-discord-notify";
import { maybeForwardSolanaToolsApi } from "./solana-tools-forward";
import { maybeForwardWeatherShard } from "./weather-shard-forward";
import { handleSolanaAppActivityRoute } from "./solana-app-activity";
import { handleSolanaLinkedWalletRoute } from "./solana-linked-wallet";
import { handleCustodialRrttWithdrawV1 } from "./custodial-rrtt-withdraw";
import { readRecentHttpErrorEvents } from "./observability";
import { handleMobileVersionPolicy } from "./mobile-client-version";
import { handleDeveloperMessagesGet, handleDeveloperMessagesPost } from "./developer-messages";
import { handlePhotosRoutes } from "./photos";
import { handleDevWalletAdminRoutes } from "./dev-wallet-admin";

// Weather/forecast/natural-disaster modules removed from this shard.
// Live only on rootrecord-api-weather + rootrecord-api-kilauea (see ./weather.ts there).

import { lifeMemberFromLicenseData, upsertUserAccountFromLicense } from "./accounts";

export interface Env {

  DB: D1Database;

  SITE_URL: string;

  JWT_SECRET: string;

  /** Plaintext ops secret for POST /api/internal/push-broadcast (X-RR-Push-Admin-Key). */

  RR_PUSH_ADMIN_SECRET?: string;
  RR_USAGE_ADMIN_SECRET?: string;

  /** Full Firebase service account JSON (FCM server credentials). */

  FCM_SERVICE_ACCOUNT_JSON?: string;

  FCM_PROJECT_ID?: string;

  FCM_CLIENT_EMAIL?: string;

  FCM_PRIVATE_KEY?: string;

  /** Stripe restricted key or secret (`wrangler secret put STRIPE_SECRET_KEY`). */

  STRIPE_SECRET_KEY?: string;

  /** Recurring Price id for Checkout (`wrangler.toml` [vars] or dashboard). */

  STRIPE_PRICE_ID?: string;

  /**
   * Internal custodial wallet encryption key (AES-256-GCM).
   * Base64-encoded 32-byte key. Must be set as a Worker secret/var.
   * Never commit real values.
   */
  INTERNAL_WALLET_ENC_KEY_B64?: string;

  /** Discord incoming webhook URL for Solana tooling events (`wrangler secret put DISCORD_WEBHOOK_SOLANA_TOOLS`). */

  DISCORD_WEBHOOK_SOLANA_TOOLS?: string;

  /** Discord webhook for POST /api/feedback (`wrangler secret put DISCORD_FEEDBACK_WEBHOOK_URL`). */

  DISCORD_FEEDBACK_WEBHOOK_URL?: string;

  /** Bearer secret for POST /api/solana-site/log from the Next Solana Tools site (`wrangler secret put SOLANA_SITE_LOG_SECRET`). */

  SOLANA_SITE_LOG_SECRET?: string;

  /** Discord webhook for new mints (POST /api/solana-site/token-discord-notify); `wrangler secret put DISCORD_TOKEN_CREATE_WEBHOOK_URL`. */

  DISCORD_TOKEN_CREATE_WEBHOOK_URL?: string;

  /**
   * When this Worker fronts the Solana Tools hostname, forward Next-only `/api/ecosystem/*` (and
   * selected `/api/solana-site/*` paths) to the Vercel origin — no trailing slash.
   * Native Worker routes (no forward): POST `/api/solana-site/log`, POST `/api/solana-site/token-discord-notify`.
   * `wrangler secret put SOLANA_TOOLS_API_FORWARD_URL`
   */
  SOLANA_TOOLS_API_FORWARD_URL?: string;

  /** Cloudflare Email Sending (`[[send_email]]` → EMAIL). Onboard domain in dashboard first. */
  EMAIL?: SendEmail;

  EMAIL_FROM?: string;

  /** Optional Resend fallback for POST /api/me/email/request. */
  RESEND_API_KEY?: string;

  RESEND_FROM?: string;

  /** Solana RPC for custodial RRTT cron (default mainnet-beta). */
  SOLANA_RPC_URL?: string;
  /** SPL mint (base58) for RRTT treasury → custodial transfers. */
  RRTT_MINT_BASE58?: string;
  /** Mint decimals for transfer_checked (default 0 = whole units match rr_earn integers). */
  RRTT_DECIMALS?: string;
  /**
   * Wall-clock cap (ms) for custodial Solana RPC refresh on `/auth/me` + `/earn/summary` (string in wrangler [vars]).
   * Default 10000; clamped in code to a safe range.
   */
  CUSTODIAL_RPC_REFRESH_BUDGET_MS?: string;
  /** Treasury keypair secret key base58 (same encoding as Phantom export). */
  RRTT_TREASURY_SECRET_KEY_B58?: string;

  /**
   * Dev-only privileged wallet admin API switch.
   * Must be set to "1" in local wrangler dev vars; should never be enabled in production.
   */
  DEV_WALLET_ADMIN_ENABLED?: string;

  /** Solana site wallet-admin proxy (`X-RR-Wallet-Admin-Key`); optional `wrangler secret put WALLET_ADMIN_PROXY_SECRET`. */
  WALLET_ADMIN_PROXY_SECRET?: string;

  /** Base URL of Worker `rootrecord-solana-tx` (no trailing slash) — treasury cron + internal POSTs proxy there. */
  ROOTRECORD_SOLANA_TX_URL?: string;

  /** Backwards-compat reverse-proxy target for /api/dashboard, /api/weather/*, /api/usgs/*, /api/eonet/*, /api/canada/* — see ./weather-shard-forward.ts. */
  ROOTRECORD_API_WEATHER_BASE?: string;

  /**
   * Days without activity before scheduled purge (cron `45 8 * * * UTC`). Activity = latest session
   * touch, account `updated_at`, or `created_at`. Default 365. Min 30.
   */
  ABANDONED_ACCOUNT_INACTIVITY_DAYS?: string;

  /** Semver floor for Weather Android (`GET /api/mobile/version-policy`). */
  MIN_APP_VERSION_WEATHER?: string;
  /** Semver floor for Business Manager Android. */
  MIN_APP_VERSION_BM?: string;
  PLAY_STORE_URL_WEATHER?: string;
  PLAY_STORE_URL_BM?: string;
  MIN_APP_VERSION_TOKEN_MANAGER?: string;
  MIN_APP_VERSION_ACCOUNT_HUB?: string;
  PLAY_STORE_URL_TOKEN_MANAGER?: string;
  PLAY_STORE_URL_ACCOUNT_HUB?: string;

  /**
   * Per-app API shard: when set (e.g. `weather`), `scheduled()` only runs jobs for that shard.
   * Omit or empty for full cron behavior on the canonical `rootrecord-primary` Worker.
   */
  WORKER_SHARD?: string;

}

/** Collapse repeated slashes (`//v1/...`) and strip trailing slash so route tables match. */
function normalizePathname(pathname: string): string {
  return pathname.replace(/\/+/g, "/").replace(/\/+$/, "") || "/";
}

/**
 * Path after `/api` for Worker routes. Normalizes slashes and strips repeated `/api` prefixes
 * (e.g. `/api/api/v1/me/...` → `/v1/me/...`) so custodial + account paths always resolve.
 */
function apiSubpath(pathname: string): string {
  let p = normalizePathname(pathname);
  if (!p.startsWith("/api")) return p;
  while (p.startsWith("/api/") || p === "/api") {
    if (p === "/api") return "/";
    p = normalizePathname(p.slice(4));
  }
  return p;
}



function num(q: URLSearchParams, k: string): number | null {

  const v = q.get(k);

  if (v === null || v === "") return null;

  const n = Number(v);

  return Number.isFinite(n) ? n : null;

}



/** device_id in body or X-Guest-Id (mobile). */

function licenseDeviceId(creds: { device_id?: string }, request: Request): string | null {

  const fromBody = String(creds.device_id || "").trim();

  if (fromBody) return fromBody.slice(0, 128);

  const guest = (request.headers.get("X-Guest-Id") || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);

  return guest || null;

}

function webSsoSetCookie(request: Request, token: string | undefined | null): string | undefined {
  const t = String(token || "").trim();
  if (!t) return undefined;
  const dom = ssoCookieDomainForApiHost(new URL(request.url).hostname);
  if (!dom) return undefined;
  return buildSessionCookieHeader(t, dom);
}

export async function handleRequest(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
  bindCorsRequest(request);
  try {
  const url = new URL(request.url);

  const pathname = normalizePathname(url.pathname);

  const method = request.method;

  if (method === "OPTIONS") {
    const h = new Headers();
    for (const [k, v] of Object.entries(cors())) {
      h.set(k, v);
    }
    return new Response(null, { status: 204, headers: h });
  }



  if (!pathname.startsWith("/api")) {

    if (method === "GET" && (pathname === "/" || pathname === "/health")) {

      let d1Ok = false;

      try {

        const r = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();

        d1Ok = r?.ok === 1;

      } catch {

        d1Ok = false;

      }

      if (pathname === "/health") {

        return json({ status: d1Ok ? "ok" : "degraded", db: d1Ok ? "ok" : "unavailable" }, 200);

      }

      return json(

        {

          ok: true,

          service: (() => {
            const shard = String(env.WORKER_SHARD || "").trim().toLowerCase();
            return shard ? `rootrecord-api-${shard}` : "rootrecord-primary";
          })(),

          site_url: env.SITE_URL,

          d1: d1Ok ? "ok" : "unavailable",

          api: "/api",

        },

        200

      );

    }

    // /v1/* — same auth as /api/auth/* (website + native clients); no second Worker.

    if (method === "POST" && pathname === "/v1/auth/login") {

      let creds: { email?: string; password?: string; device_id?: string };

      try {

        creds = (await request.json()) as typeof creds;

      } catch {

        return json({ detail: "Invalid JSON" }, 400);

      }

      if (!licenseDeviceId(creds, request)) {

        return json({ detail: "device_id is required (or send X-Guest-Id)." }, 400);

      }

      const meta = buildSessionInsertMeta(request, licenseDeviceId(creds, request));

      const res = await authLogin(env, { email: creds.email || "", password: creds.password || "" }, meta);

      if (!res.ok) return res;

      const data = (await res.json()) as Record<string, unknown>;

      try {

        await upsertUserAccountFromLicense(env.DB, {

          email: String(data.email || creds.email || "").trim(),

          account_id: String(data.account_id || ""),

          pro_unlocked: Boolean(data.proUnlocked || data.pro_unlocked),

          life_member: lifeMemberFromLicenseData(data),

          extra: { source: "login", path: "/v1/auth/login" },

        });

      } catch {

        /* optional */

      }

      scheduleAuthLoginDiscordSessionNotify(
        ctx,
        env,
        request,
        creds as Record<string, unknown>,
        data,
        licenseDeviceId(creds, request),
      );

      const v1LoginTok = (data.access_token || data.token) as string | undefined;
      return json(data, 200, undefined, webSsoSetCookie(request, v1LoginTok));

    }

    if (method === "POST" && pathname === "/v1/auth/signup") {

      let creds: { email?: string; password?: string; device_id?: string };

      try {

        creds = (await request.json()) as typeof creds;

      } catch {

        return json({ detail: "Invalid JSON" }, 400);

      }

      if (!licenseDeviceId(creds, request)) {

        return json({ detail: "device_id is required (or send X-Guest-Id)." }, 400);

      }

      const meta = buildSessionInsertMeta(request, licenseDeviceId(creds, request));

      const res = await authSignup(env, { email: creds.email || "", password: creds.password || "" }, meta);

      if (!res.ok) return res;

      const data = (await res.json()) as Record<string, unknown>;

      try {

        await upsertUserAccountFromLicense(env.DB, {

          email: String(data.email || creds.email || "").trim(),

          account_id: String(data.account_id || ""),

          pro_unlocked: Boolean(data.proUnlocked || data.pro_unlocked),

          life_member: lifeMemberFromLicenseData(data),

          extra: { source: "signup", path: "/v1/auth/signup" },

        });

      } catch {

        /* optional */

      }

      scheduleAuthLoginDiscordSessionNotify(
        ctx,
        env,
        request,
        creds as Record<string, unknown>,
        data,
        licenseDeviceId(creds, request),
      );

      const v1SignupTok = (data.access_token || data.token) as string | undefined;
      return json(data, 200, undefined, webSsoSetCookie(request, v1SignupTok));

    }

    if (method === "GET" && pathname === "/v1/me") {

      const tok = extractAuthToken(request);
      if (!tok) {
        return json({ detail: "Missing token" }, 401);
      }

      return authMe(env, tok, ctx);

    }

    if (pathname === "/v1/me/linked-wallet") {

      return handleSolanaLinkedWalletRoute(request, env, method);

    }

    if (pathname === "/v1/me/custodial-sol-wallet" || pathname.startsWith("/v1/me/custodial-sol-wallet/")) {

      return handleCustodialSolWalletV1(request, env, method, pathname);

    }

    if (pathname === "/v1/me/custodial-withdraw-dest") {

      return handleCustodialWithdrawDestV1(request, env, method);

    }

    if (pathname === "/v1/me/custodial-withdraw-rrtt") {

      return handleCustodialRrttWithdrawV1(request, env, method);

    }

    if (pathname === "/v1/me/rewards-ledger") {

      return handleRewardsLedgerV1(request, env, method);

    }

    if (method === "DELETE" && pathname === "/v1/me") {

      const sess = await sessionFromRequest(env, request);

      if (!sess) {

        return json({ detail: "Unauthorized" }, 401);

      }

      const email = sess.email.toLowerCase();
      const accountId = sess.accountId;

      const del = await performAccountDeletion(env, accountId, email);
      if (!del.ok) {
        return json({ detail: del.detail, ok: false }, del.status);
      }

      return json(
        {
          ok: true,
          custodial_sweep: del.custodial_sweep,
          custodial_wallet_keys_retained: del.custodial_wallet_keys_retained,
        },
        200,
      );

    }

    if (method === "POST" && pathname === "/v1/auth/logout") {

      return handleAuthLogout(request, env);

    }

    if (method === "POST" && pathname === "/v1/auth/logout-all") {
      return handleAuthLogoutAll(request, env);
    }

    if (method === "POST" && pathname === "/v1/billing/checkout") {

      const sess = await sessionFromRequest(env, request);

      if (!sess) {

        return json({ detail: "Unauthorized" }, 401);

      }

      const secret = (env.STRIPE_SECRET_KEY || "").trim();

      const priceId = (env.STRIPE_PRICE_ID || "").trim();

      const siteUrl = (env.SITE_URL || "https://rootrecord.online").trim();

      if (!secret.startsWith("sk_") || !priceId.startsWith("price_")) {

        return json({ detail: "Web checkout is not configured yet." }, 503);

      }

      const checkout = await createStripeSubscriptionCheckout({

        secretKey: secret,

        priceId,

        customerEmail: sess.email,

        accountId: sess.accountId,

        siteUrl,

      });

      if (!checkout.ok) {

        return json({ detail: checkout.message }, 502);

      }

      return json({ url: checkout.url }, 200);

    }

    return json({ ok: false, error: "not_found" }, 404);

  }



  const sub = apiSubpath(pathname);

  const q = url.searchParams;

  /** Same handlers as `/v1/*` when the client uses `NEXT_PUBLIC_ROOTRECORD_API_BASE` with an `/api` prefix. */
  if (sub === "/v1/me/linked-wallet") {
    return handleSolanaLinkedWalletRoute(request, env, method);
  }

  if (method === "GET" && sub === "/v1/me") {
    const auth = request.headers.get("Authorization") || "";
    if (!auth.toLowerCase().startsWith("bearer ")) {
      return json({ detail: "Missing token" }, 401);
    }
    const tok = auth.slice(7).trim();
    return authMe(env, tok, ctx);
  }

  if (sub === "/v1/me/custodial-withdraw-dest") {
    return handleCustodialWithdrawDestV1(request, env, method);
  }

  if (sub === "/v1/me/custodial-withdraw-rrtt") {
    return handleCustodialRrttWithdrawV1(request, env, method);
  }

  if (sub === "/v1/me/custodial-sol-wallet" || sub.startsWith("/v1/me/custodial-sol-wallet/")) {
    return handleCustodialSolWalletV1(request, env, method, sub);
  }

  if (sub === "/v1/me/rewards-ledger") {
    return handleRewardsLedgerV1(request, env, method);
  }

  if (method === "GET" && (pathname === "/api" || pathname === "/api/")) {

    return json({ name: "Root Record Weather Manager API", version: "1.0.0" }, 200);

  }



  if (method === "GET" && sub === "/health") {

    let d1Ok = false;

    try {

      const r = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();

      d1Ok = r?.ok === 1;

    } catch {

      d1Ok = false;

    }

    let bmOwnedOk = false;

    if (d1Ok) {

      try {

        const t = await env.DB
          .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'bm_owned_row' LIMIT 1")
          .first<{ ok: number }>();

        bmOwnedOk = t?.ok === 1;

      } catch {

        bmOwnedOk = false;

      }

    }

    return json(
      {
        status: d1Ok ? "ok" : "degraded",
        db: d1Ok ? "ok" : "unavailable",
        bm_owned_row: bmOwnedOk ? "ok" : "missing",
      },
      200
    );

  }

  if (method === "GET" && sub === "/mobile/version-policy") {
    return handleMobileVersionPolicy(request, env);
  }

  if (method === "GET" && sub === "/mobile/developer-messages") {
    return handleDeveloperMessagesGet(env, url);
  }

  if (method === "POST" && sub === "/internal/developer-messages") {
    return handleDeveloperMessagesPost(request, env);
  }

  if (method === "POST" && sub === "/auth/login") {

    let creds: { email?: string; password?: string; device_id?: string };

    try {

      creds = (await request.json()) as typeof creds;

    } catch {

      return json({ detail: "Invalid JSON" }, 400);

    }

    const deviceId = licenseDeviceId(creds, request);

    if (!deviceId) {

      return json({ detail: "device_id is required (or send X-Guest-Id)." }, 400);

    }

    const meta = buildSessionInsertMeta(request, deviceId);

    const res = await authLogin(env, { email: creds.email || "", password: creds.password || "" }, meta);

    if (!res.ok) return res;

    const data = (await res.json()) as Record<string, unknown>;

    const token = (data.access_token || data.token) as string | undefined;

    const emailOut = String(data.email || creds.email || "").trim();

    const pro = Boolean(data.proUnlocked || data.pro_unlocked);

    try {

      await upsertUserAccountFromLicense(env.DB, {

        email: emailOut,

        account_id: String(data.account_id || ""),

        pro_unlocked: pro,

        life_member: lifeMemberFromLicenseData(data),

        extra: { source: "login" },

      });

    } catch {

      /* D1 optional */

    }

    scheduleAuthLoginDiscordSessionNotify(ctx, env, request, creds as Record<string, unknown>, data, deviceId);

    return json(

      {

        ok: true,

        token,

        access_token: token,

        email: emailOut,

        account_id: String(data.account_id || ""),

        message: (data.message as string) || "Signed in.",

        pro_unlocked: pro,

        life_member: lifeMemberFromLicenseData(data),

      },

      200,

      undefined,

      webSsoSetCookie(request, token)

    );

  }



  if (method === "POST" && (sub === "/auth/signup" || sub === "/auth/register")) {

    let creds: { email?: string; password?: string; device_id?: string; name?: string };

    try {

      creds = (await request.json()) as typeof creds;

    } catch {

      return json({ detail: "Invalid JSON" }, 400);

    }

    const deviceId = licenseDeviceId(creds, request);

    if (!deviceId) {

      return json({ detail: "device_id is required (or send X-Guest-Id)." }, 400);

    }

    const meta = buildSessionInsertMeta(request, deviceId);

    const res = await authSignup(env, { email: creds.email || "", password: creds.password || "" }, meta);

    if (!res.ok) return res;

    const data = (await res.json()) as Record<string, unknown>;

    const token = (data.access_token || data.token) as string | undefined;

    const emailOut = String(data.email || creds.email || "").trim();

    const pro = Boolean(data.proUnlocked || data.pro_unlocked);

    try {

      await upsertUserAccountFromLicense(env.DB, {

        email: emailOut,

        account_id: String(data.account_id || ""),

        pro_unlocked: pro,

        life_member: lifeMemberFromLicenseData(data),

        extra: { source: "signup" },

      });

    } catch {

      /* D1 optional */

    }

    scheduleAuthLoginDiscordSessionNotify(ctx, env, request, creds as Record<string, unknown>, data, deviceId);

    return json(

      {

        ok: true,

        token,

        access_token: token,

        email: emailOut,

        account_id: String(data.account_id || ""),

        message: (data.message as string) || "Account created.",

        pro_unlocked: pro,

        life_member: lifeMemberFromLicenseData(data),

      },

      200,

      undefined,

      webSsoSetCookie(request, token)

    );

  }



  if ((method === "GET" || method === "POST") && sub === "/auth/me") {

    const token = extractAuthToken(request);
    if (!token) {
      return json({ detail: "Missing token" }, 401);
    }

    const res = await authMe(env, token, ctx);

    if (!res.ok) return res;

    const data = (await res.json()) as Record<string, unknown>;

    const emailMe = String(data.email || "").trim();

    const proMe = Boolean(data.proUnlocked || data.pro_unlocked);

    const sessionOk = data.authenticated === true || data.authenticated === undefined;

    if (emailMe && sessionOk) {

      try {

        await upsertUserAccountFromLicense(env.DB, {

          email: emailMe,

          account_id: String(data.account_id || ""),

          pro_unlocked: proMe,

          life_member: lifeMemberFromLicenseData(data),

          extra: {

            source: "me",

            access: data.access,

          },

        });

      } catch {

        /* D1 optional */

      }

    }

    return json(

      {

        authenticated: Boolean(data.authenticated),

        email: emailMe,

        account_id: String(data.account_id || ""),

        pro_unlocked: proMe,

        life_member: Boolean(data.life_member || data.lifeMember),

        subscription_status: String(data.subscription_status || "none"),

        access: data.access,

        access_token: token,
        token,

        raw: data,

      },

      200

    );

  }

  if (method === "POST" && sub === "/auth/logout") {
    return handleAuthLogout(request, env);
  }

  if (method === "POST" && sub === "/auth/logout-all") {
    return handleAuthLogoutAll(request, env);
  }

  const meAccountRes = await handleMeAccountRoutes(request, env, sub, method);

  if (meAccountRes) return meAccountRes;

  if (method === "POST" && sub === "/auth/entitlement") {
    return handleBusinessAuthEntitlement(request, env);
  }

  if (method === "POST" && sub === "/auth/wipe-business-data") {
    return bmWipeOwnedRows(request, env);
  }

  const custodialBackfillRes = await handleCustodialInternalBackfillRoute(request, env, sub, method);

  if (custodialBackfillRes) return custodialBackfillRes;

  const rrttCronRes = await handleRunRrttCustodialCronRoute(request, env, sub, method);

  if (rrttCronRes) return rrttCronRes;

  const treasuryProxyRes = await proxyTreasurySolanaTxRoutes(request, env, sub, method);

  if (treasuryProxyRes) return treasuryProxyRes;

  const sweepCustodialSolRes = await handleSweepCustodialSolAllRoute(request, env, sub, method);

  if (sweepCustodialSolRes) return sweepCustodialSolRes;

  const pushRes = await handlePushRoutes(request, env, sub, method);

  if (pushRes) return pushRes;

  const prefsRes = await handlePrefsRoutes(request, env, sub, method);

  if (prefsRes) return prefsRes;

  const earnRes = await handleEarnRoutes(request, env, sub, method);

  if (earnRes) return earnRes;

  const solSiteLogRes = await handleSolanaSiteLogRoute(request, env, sub, method);

  if (solSiteLogRes) return solSiteLogRes;

  const solTokenDiscordRes = await handleSolanaSiteTokenDiscordNotifyRoute(
    request,
    env,
    sub,
    method
  );

  if (solTokenDiscordRes) return solTokenDiscordRes;

  const solAppActivityRes = await handleSolanaAppActivityRoute(request, env, sub, method);

  if (solAppActivityRes) return solAppActivityRes;

  const solRes = await handleSolanaInternalWalletRoutes(request, env, sub, method);

  if (solRes) return solRes;

  const devWalletAdminRes = await handleDevWalletAdminRoutes(request, env as any, sub, method);

  if (devWalletAdminRes) return devWalletAdminRes;

  const feedbackRes = await handleFeedbackRoute(request, env, sub, method);

  if (feedbackRes) return feedbackRes;

  const businessRes = await handleBusinessRoutes(request, env, sub, method);

  if (businessRes) return businessRes;

  const photosRes = await handlePhotosRoutes(request, env as any, sub, method);

  if (photosRes) return photosRes;



  const locRes = await handleLocations(request, env, sub, method);

  if (locRes) return locRes;



  if (method === "GET" && sub === "/internal/recent-http-errors") {
    const secret = (env.RR_PUSH_ADMIN_SECRET || "").trim();
    if (!secret) {
      return json({ detail: "RR_PUSH_ADMIN_SECRET is not set on this Worker." }, 503);
    }
    const adminOk = await verifyWorkerOpsAdmin(request, env);
    if (!adminOk) {
      const has = Boolean(request.headers.get("X-RR-Push-Admin-Key"));
      return json({ detail: has ? "Invalid admin key." : "Missing X-RR-Push-Admin-Key header." }, 401);
    }
    const lim = Math.min(200, Math.max(1, Math.floor(num(q, "limit") ?? 50)));
    const events = await readRecentHttpErrorEvents(env.DB, lim);
    return json({ ok: true, events, limit: lim }, 200);
  }

  const forwardRes = await maybeForwardSolanaToolsApi(request, env, pathname, method);

  if (forwardRes) return forwardRes;

  // Legacy backward-compat: APKs still pointing at api.rootrecord.info expect
  // /api/dashboard, /api/weather/*, /api/usgs/*, /api/eonet/*, /api/canada/* here.
  // Those routes now live on rootrecord-api-weather; reverse-proxy them so
  // already-installed devices keep working.
  const weatherForward = await maybeForwardWeatherShard(request, env, pathname, method);

  if (weatherForward) return weatherForward;

  return json({ detail: "Not Found" }, 404);

  } finally {
    bindCorsRequest(undefined);
  }
}


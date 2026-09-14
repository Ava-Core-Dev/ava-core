import type { D1Database, ExecutionContext, SendEmail } from "@cloudflare/workers-types";

import { bindCorsRequest, cors, json } from "./cors";

import { resolveUserId } from "./auth";
import { readUserAccountAccessFlags } from "./accounts";

// Volcano Village / HVNP — the only location free Kīlauea Alerts accounts can read. Coords
// mirror BIG_ISLAND_LOCATIONS[id="volcano"] in the web app's locations.ts.
const FREE_TIER_LOC_ID = "volcano";
const FREE_TIER_LAT = 19.4194;
const FREE_TIER_LON = -155.2888;

async function isProEmailUser(db: D1Database, userId: string): Promise<boolean> {
  if (!userId.startsWith("user:")) return false;
  const email = userId.slice("user:".length).trim().toLowerCase();
  if (!email) return false;
  try {
    const flags = await readUserAccountAccessFlags(db, email);
    return Boolean(flags && (flags.pro_unlocked || flags.life_member));
  } catch {
    return false;
  }
}

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
  provisionCustodialWalletIfMissing,
} from "./solana-internal-wallet";
import { proxyTreasurySolanaTxRoutes } from "./treasury-solana-tx-proxy";
import { handleSolanaSiteLogRoute } from "./solana-site-log";
import { handleSolanaSiteTokenDiscordNotifyRoute } from "./solana-site-token-discord-notify";
import { maybeForwardSolanaToolsApi } from "./solana-tools-forward";
import { handleSolanaAppActivityRoute } from "./solana-app-activity";
import { handleSolanaLinkedWalletRoute } from "./solana-linked-wallet";
import { handleCustodialRrttWithdrawV1 } from "./custodial-rrtt-withdraw";
import { readRecentHttpErrorEvents } from "./observability";
import { handleMobileVersionPolicy } from "./mobile-client-version";
import { handleDeveloperMessagesGet, handleDeveloperMessagesPost } from "./developer-messages";
import { handleKilaueaLiveStreamsGet, handleKilaueaLiveStreamsPost } from "./kilauea-live-streams";
import { handleKilaueaSituationGet, handleKilaueaSituationPost } from "./kilauea-situation";
import { handleKilaueaAiAnalysesGet, handleKilaueaAiManualRun } from "./kilauea-ai-analysis";
import { handleBigIslandEarthquakesChartGet, handleKilaueaAiReportsPublicGet } from "./kilauea-charts-public";
import { handleKilaueaDiscordInteractions } from "./discord-kilauea-bot";
import { handlePhotosRoutes } from "./photos";
import { handleDevWalletAdminRoutes } from "./dev-wallet-admin";
import { handleAqsHawaiiCountyDaily } from "./aqs-epa";
import { handleAirNowCurrent } from "./airnow-proxy";
import { handleAirQualityCurrent } from "./open-meteo-air-quality";

import {

  canadaAlerts,

  dashboardBundle,

  eonetCyclones,

  eonetWildfires,

  tsunamiBulletins,

  usgsEarthquakes,

  weatherAlerts,

  weatherCurrent,

  weatherForecast,

} from "./weather";
import { readUsageDaily } from "./usage";

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

  DISCORD_BOT_TOKEN?: string;
  /** Kīlauea Alerts public bot (Application 1510049729776713728). */
  DISCORD_KILAUEA_BOT_TOKEN?: string;
  DISCORD_KILAUEA_CLIENT_ID?: string;
  DISCORD_KILAUEA_PUBLIC_KEY?: string;
  DISCORD_KILAUEA_ALERTS_CHANNEL_ID?: string;
  DISCORD_KILAUEA_DATA_CHANNEL_ID?: string;
  DISCORD_GUILD_ID?: string;
  DISCORD_DEVELOPER_ROLE_ID?: string;
  DISCORD_LIFETIME_MEMBER_ROLE_ID?: string;
  DISCORD_MONTHLY_MEMBER_ROLE_ID?: string;
  GROK_API_BEARER_TOKEN?: string;

  /** Seconds: reuse latest D1 `weather_data` row for same user + grid (default 600). */

  WEATHER_DATA_TTL_SEC?: string;

  /** AccuWeather provider settings (`ACCUWEATHER_API_KEY` as secret; language optional var). */

  ACCUWEATHER_API_KEY?: string;

  ACCUWEATHER_LANGUAGE?: string;

  ACCUWEATHER_REUSE_RADIUS_MILES?: string;

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

  /** Discord channel for POST /api/feedback. Requires DISCORD_BOT_TOKEN; defaults in feedback-route if omitted. */

  DISCORD_FEEDBACK_CHANNEL_ID?: string;

  /** Fallback Discord webhook for POST /api/feedback (`wrangler secret put DISCORD_FEEDBACK_WEBHOOK_URL`). */

  DISCORD_FEEDBACK_WEBHOOK_URL?: string;

  /** Discord webhook for USGS Big Island earthquakes → #kilauea-alerts (set ONLY on api-kilauea). */

  DISCORD_KILAUEA_USGS_WEBHOOK_URL?: string;
  /** Raw Kīlauea AI prompt/response archive channel. Requires DISCORD_BOT_TOKEN. */
  DISCORD_KILAUEA_REPORT_CHANNEL_ID?: string;
  DISCORD_KILAUEA_AI_ARCHIVE_CHANNEL_ID?: string;
  /** X/Grok API credentials for Kīlauea AI analysis. */
  GROK_API_BEARER_TOKEN?: string;
  GROK_X_BEARER_TOKEN?: string;
  GROK_API_URL?: string;
  GROK_MODEL?: string;

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

  /** EPA AQS proxy (`GET /api/aqs/hawaii-county-daily`): `wrangler secret put AQS_API_EMAIL` + `AQS_API_KEY`. */
  AQS_API_EMAIL?: string;
  AQS_API_KEY?: string;
  /** AirNow current observations (`GET /api/airnow/current`): `wrangler secret put AIRNOW_API_KEY`. */
  AIRNOW_API_KEY?: string;

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

async function mergedAccessFromAccountMirror(
  env: Env,
  email: string,
  data: Record<string, unknown>,
): Promise<{ pro: boolean; life: boolean }> {
  const flags = await readUserAccountAccessFlags(env.DB, email).catch(() => null);
  const life = lifeMemberFromLicenseData(data) || Boolean(flags?.life_member);
  const pro = life || Boolean(data.proUnlocked || data.pro_unlocked) || Boolean(flags?.pro_unlocked);
  return { pro, life };
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

  if (method === "POST" && pathname === "/v1/discord/kilauea/interactions") {
    return handleKilaueaDiscordInteractions(request, env, ctx);
  }

  if (method === "POST" && pathname === "/internal/kilauea-ai-run") {
    const adminOk = await verifyWorkerOpsAdmin(request, env);
    if (!adminOk) {
      const has = Boolean(request.headers.get("X-RR-Push-Admin-Key"));
      return json({ detail: has ? "Invalid admin key." : "Missing X-RR-Push-Admin-Key header." }, 401);
    }
    return handleKilaueaAiManualRun(request, env);
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

      const v1LoginEmail = String(data.email || creds.email || "").trim();
      const v1LoginAccess = await mergedAccessFromAccountMirror(env, v1LoginEmail, data);
      data.pro_unlocked = v1LoginAccess.pro;
      data.proUnlocked = v1LoginAccess.pro;
      data.life_member = v1LoginAccess.life;
      data.lifeMember = v1LoginAccess.life;

      try {

        await upsertUserAccountFromLicense(env.DB, {

          email: v1LoginEmail,

          account_id: String(data.account_id || ""),

          pro_unlocked: v1LoginAccess.pro,

          life_member: v1LoginAccess.life,

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

      const v1SignupEmail = String(data.email || creds.email || "").trim();
      const v1SignupAccess = await mergedAccessFromAccountMirror(env, v1SignupEmail, data);
      data.pro_unlocked = v1SignupAccess.pro;
      data.proUnlocked = v1SignupAccess.pro;
      data.life_member = v1SignupAccess.life;
      data.lifeMember = v1SignupAccess.life;

      try {

        await upsertUserAccountFromLicense(env.DB, {

          email: v1SignupEmail,

          account_id: String(data.account_id || ""),

          pro_unlocked: v1SignupAccess.pro,

          life_member: v1SignupAccess.life,

          extra: { source: "signup", path: "/v1/auth/signup" },

        });

      } catch {

        /* optional */

      }

      try {

        const aid = String(data.account_id || "").trim();

        if (aid) await provisionCustodialWalletIfMissing(env, aid);

      } catch {

        /* non-fatal */

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

  if (method === "GET" && sub === "/mobile/kilauea-live-streams") {
    return handleKilaueaLiveStreamsGet(env);
  }

  if (method === "GET" && sub === "/mobile/kilauea-situation") {
    return handleKilaueaSituationGet(env);
  }

  if (method === "GET" && sub === "/mobile/kilauea-ai-analyses") {
    return handleKilaueaAiAnalysesGet(request, env);
  }

  if (method === "GET" && sub === "/public/kilauea/big-island-earthquakes") {
    return handleBigIslandEarthquakesChartGet(request);
  }

  if (method === "GET" && sub === "/public/kilauea/ai-reports") {
    return handleKilaueaAiReportsPublicGet(request, env);
  }

  if (method === "GET" && sub === "/aqs/hawaii-county-daily") {
    return handleAqsHawaiiCountyDaily(request, env);
  }

  if (method === "GET" && sub === "/airnow/current") {
    return handleAirNowCurrent(request, env);
  }

  if (method === "GET" && sub === "/air-quality/current") {
    return handleAirQualityCurrent(request);
  }

  if (method === "POST" && sub === "/internal/developer-messages") {
    return handleDeveloperMessagesPost(request, env);
  }

  if (method === "POST" && sub === "/internal/kilauea-live-streams") {
    return handleKilaueaLiveStreamsPost(request, env);
  }

  if (method === "POST" && sub === "/internal/kilauea-situation") {
    return handleKilaueaSituationPost(request, env);
  }

  if (method === "POST" && sub === "/internal/kilauea-ai-run") {
    const adminOk = await verifyWorkerOpsAdmin(request, env);
    if (!adminOk) {
      const has = Boolean(request.headers.get("X-RR-Push-Admin-Key"));
      return json({ detail: has ? "Invalid admin key." : "Missing X-RR-Push-Admin-Key header." }, 401);
    }
    return handleKilaueaAiManualRun(request, env);
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

    const access = await mergedAccessFromAccountMirror(env, emailOut, data);
    const pro = access.pro;
    const life = access.life;

    try {

      await upsertUserAccountFromLicense(env.DB, {

        email: emailOut,

        account_id: String(data.account_id || ""),

        pro_unlocked: pro,

        life_member: life,

        extra: { source: "login" },

      });

    } catch {

      /* D1 optional */

    }

    return json(

      {

        ok: true,

        token,

        access_token: token,

        email: emailOut,

        account_id: String(data.account_id || ""),

        message: (data.message as string) || "Signed in.",

        pro_unlocked: pro,

        life_member: life,

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

    const access = await mergedAccessFromAccountMirror(env, emailOut, data);
    const pro = access.pro;
    const life = access.life;

    try {

      await upsertUserAccountFromLicense(env.DB, {

        email: emailOut,

        account_id: String(data.account_id || ""),

        pro_unlocked: pro,

        life_member: life,

        extra: { source: "signup" },

      });

    } catch {

      /* D1 optional */

    }

    try {

      const aid = String(data.account_id || "").trim();

      if (aid) await provisionCustodialWalletIfMissing(env, aid);

    } catch {

      /* non-fatal */

    }

    return json(

      {

        ok: true,

        token,

        access_token: token,

        email: emailOut,

        account_id: String(data.account_id || ""),

        message: (data.message as string) || "Account created.",

        pro_unlocked: pro,

        life_member: life,

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



  const lat = num(q, "lat");

  const lon = num(q, "lon");



  if (method === "GET" && sub === "/weather/current" && lat != null && lon != null) {

    return json(await weatherCurrent(lat, lon, env, env.DB), 200);

  }

  if (method === "GET" && sub === "/weather/forecast" && lat != null && lon != null) {

    return json(await weatherForecast(lat, lon, env, env.DB), 200);

  }

  if (method === "GET" && sub === "/weather/alerts" && lat != null && lon != null) {

    return json(await weatherAlerts(lat, lon, env, env.DB), 200);

  }

  if (method === "GET" && sub === "/internal/usage/accuweather") {
    const key = (request.headers.get("X-RR-Usage-Admin-Key") || "").trim();
    const expected = (env.RR_USAGE_ADMIN_SECRET || env.RR_PUSH_ADMIN_SECRET || "").trim();
    let authorized = false;
    if (expected && key && key === expected) {
      authorized = true;
    } else {
      const auth = request.headers.get("Authorization") || "";
      if (auth.toLowerCase().startsWith("bearer ")) {
        const token = auth.slice(7).trim();
        try {
          const meRes = await authMe(env, token, ctx);
          if (meRes.ok) {
            const me = (await meRes.json()) as Record<string, unknown>;
            const email = String(me.email || "").trim().toLowerCase();
            authorized = email === "root@rootrecord.info";
          }
        } catch {
          authorized = false;
        }
      }
    }
    if (!authorized) return json({ detail: "Unauthorized" }, 401);
    const days = Math.min(90, Math.max(1, Math.floor(num(q, "days") ?? 30)));
    const rows = await readUsageDaily(env.DB, days);
    const dailyMap = new Map<string, Record<string, number>>();
    for (const row of rows) {
      const bucket = dailyMap.get(row.day_utc) || {};
      bucket[row.metric] = Number(row.count || 0);
      dailyMap.set(row.day_utc, bucket);
    }
    const daily = [...dailyMap.entries()].map(([day_utc, metrics]) => {
      const accuCalls = Object.entries(metrics)
        .filter(([k]) => k.startsWith("accu.call."))
        .reduce((s, [, v]) => s + Number(v || 0), 0);
      // Backwards-compat: pre-strip metric name was `cache.hit.user_grid` (per-user); post-strip
      // is `cache.hit.grid` (cross-user). Summing both keeps historical day-buckets correct.
      const cacheHits = (metrics["cache.hit.grid"] || 0) + (metrics["cache.hit.user_grid"] || 0) + (metrics["cache.hit.radius"] || 0);
      const cacheMiss = metrics["cache.miss.dashboard"] || 0;
      return { day_utc, accu_calls: accuCalls, cache_hits: cacheHits, cache_misses: cacheMiss, metrics };
    });
    const totalAccuCalls = daily.reduce((s, d) => s + d.accu_calls, 0);
    const avgPerDay = daily.length ? totalAccuCalls / daily.length : 0;
    const projectedMonth = Math.round(avgPerDay * 30);
    const totalsByMetric: Record<string, number> = {};
    for (const row of rows) {
      const keyName = String(row.metric || "");
      totalsByMetric[keyName] = (totalsByMetric[keyName] || 0) + Number(row.count || 0);
    }
    const accuCallBreakdown = Object.fromEntries(
      Object.entries(totalsByMetric)
        .filter(([k]) => k.startsWith("accu.call."))
        .sort((a, b) => b[1] - a[1])
    );
    const cacheStats = {
      grid_hits: (totalsByMetric["cache.hit.grid"] || 0) + (totalsByMetric["cache.hit.user_grid"] || 0),
      radius_hits: totalsByMetric["cache.hit.radius"] || 0,
      accu_endpoint_hits: totalsByMetric["accu.cache.hit"] || 0,
      dashboard_misses: totalsByMetric["cache.miss.dashboard"] || 0,
    };
    const totalCacheChecks = cacheStats.grid_hits + cacheStats.radius_hits + cacheStats.dashboard_misses;
    const cacheHitRate = totalCacheChecks ? (cacheStats.grid_hits + cacheStats.radius_hits) / totalCacheChecks : 0;
    return json(
      {
        days,
        total_accu_calls: totalAccuCalls,
        avg_accu_calls_per_day: Number(avgPerDay.toFixed(2)),
        projected_30_day_calls: projectedMonth,
        allowance_monthly_calls: 500,
        projected_overage_calls: Math.max(0, projectedMonth - 500),
        cache_stats: { ...cacheStats, cache_hit_rate: Number((cacheHitRate * 100).toFixed(2)) },
        accu_call_breakdown: accuCallBreakdown,
        totals_by_metric: totalsByMetric,
        daily,
      },
      200
    );
  }

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

  if (method === "GET" && sub === "/canada/alerts" && lat != null && lon != null) {

    const radius = num(q, "radius_km") ?? 150;

    return json(await canadaAlerts(lat, lon, radius), 200);

  }

  if (method === "GET" && sub === "/usgs/earthquakes") {

    const period = (q.get("period") || "day") as "hour" | "day" | "week" | "month";

    const minMag = num(q, "min_magnitude") ?? 0;

    const radius = num(q, "radius_miles") ?? 2000;

    return json(await usgsEarthquakes(lat, lon, radius, period, minMag), 200);

  }

  if (method === "GET" && sub === "/usgs/tsunamis") {

    return json(await tsunamiBulletins(), 200);

  }

  if (method === "GET" && sub === "/eonet/cyclones") {

    return json(await eonetCyclones(), 200);

  }

  if (method === "GET" && sub === "/eonet/wildfires") {

    return json(await eonetWildfires(), 200);

  }

  if (method === "GET" && sub === "/dashboard" && lat != null && lon != null) {

    try {
    const uidRes = await resolveUserId(request, env);

    if (uidRes instanceof Response) return uidRes;

    const refresh = ["1", "true", "yes"].includes((q.get("refresh") || "").toLowerCase());

    const rawLocId = (q.get("location_id") || "").trim();

    let locationId: string | null = rawLocId ? rawLocId.slice(0, 64) : null;

    // Free-tier restriction: Kīlauea Alerts free accounts are locked to Volcano. Any other
    // requested location is silently rewritten to Volcano so the response is well-formed
    // and the client doesn't show a half-broken dashboard. Pro/Lifetime/guest are bypassed
    // here — guests can't authenticate at all from the released client, so they only reach
    // this branch via the marketing/web preview which has its own paywall.
    let effLat = lat;
    let effLon = lon;
    let locked = false;
    const isPro = await isProEmailUser(env.DB, uidRes);
    if (!isPro && locationId !== FREE_TIER_LOC_ID) {
      locationId = FREE_TIER_LOC_ID;
      effLat = FREE_TIER_LAT;
      effLon = FREE_TIER_LON;
      locked = true;
    }

    const bundle = await dashboardBundle(env.DB, env, uidRes, effLat, effLon, { refresh, locationId });
    if (locked && bundle && typeof bundle === "object") {
      (bundle as Record<string, unknown>).free_location_locked = true;
      (bundle as Record<string, unknown>).free_location_id = FREE_TIER_LOC_ID;
    }
    return json(bundle, 200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("dashboard_bundle", msg);
      return json({ detail: "Dashboard data temporarily unavailable.", error: msg.slice(0, 240) }, 503);
    }

  }

  const forwardRes = await maybeForwardSolanaToolsApi(request, env, pathname, method);

  if (forwardRes) return forwardRes;

  return json({ detail: "Not Found" }, 404);

  } finally {
    bindCorsRequest(undefined);
  }
}


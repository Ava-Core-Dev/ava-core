import type { D1Database, ExecutionContext } from "@cloudflare/workers-types";

import { handleAppSessionStartRoute } from "../../rootrecord-api-account/src/app-session-notify";
import { scheduleAuthLoginDiscordSessionNotify } from "../../shared/discord-app-session-notify";
import { cors, json, runWithCors } from "./cors";
import { resolveUserId } from "./auth";
import { lifeMemberFromLicenseData, readUserAccountAccessFlags, upsertUserAccountFromLicense } from "./accounts";
import { issuePublicFields } from "./solana-cluster";
import {
  authLogin,
  authMe,
  authSignup,
  extractAuthToken,
  sessionFromRequest,
  type AuthEnv,
} from "./primary-auth";
import { buildSessionCookieHeader, ssoCookieDomainForApiHost } from "./web-sso";
import { buildSessionInsertMeta, handleAuthLogout, handleAuthLogoutAll } from "./me-account-routes";
import {
  handleAchievementById,
  handleCategories,
  handleCategoryById,
  handleEntryById,
  handleGoalAchievements,
  handleGoalActionById,
  handleGoalActions,
  handleGoalAiRefresh,
  handleGoalById,
  handleGoalEntries,
  handleGoalImagePost,
  handleGoalProvision,
  handleGoalSuggestionById,
  handleGoalSuggestions,
  handleGoalsList,
  handleOnboardingDraft,
  handleOnboardingFinalize,
} from "./goals";
import { AI_DISCLAIMER } from "./goals-ai";
import { handlePublicGoals } from "./goals-public";
import {
  handleGoalBalanceGet,
  handleGoalImageGet,
  handleGoalMetadataGet,
  handleGoalQrGet,
  handlePublicGoalCatalog,
} from "./goal-funding";
import {
  handleEmbersConfig,
  handleEmbersMe,
  handleEmbersSwap,
  handlePublicEmbers,
} from "./ember-swap";
import { handleCustodialDonate } from "./goal-custodial-donate";
import { handleGoalClaimTokens, handleGoalRefund, handleGoalWithdraw } from "./goal-payout";
import { handleWalletMe } from "./member-custodial";
import {
  handlePublicShardsGovernance,
  handleShardsCheckout,
  handleShardsMe,
  handleShardsSend,
} from "./shards-routes";
import { handleProfileAvatarGet, handleProfileMe } from "./profiles";
import {
  handleGalleryItem,
  handleGalleryMine,
  handleGalleryReports,
  handlePublicGalleryImage,
  handlePublicGalleryList,
  handlePublicPlayer,
} from "./gallery";
import { createStripeSubscriptionCheckout } from "./billing-stripe";

export interface Env extends AuthEnv {
  DB: D1Database;
  SITE_URL: string;
  GOALS_SITE_ORIGIN?: string;
  WORKER_SHARD?: string;
  GROK_API_BEARER_TOKEN?: string;
  GROK_X_BEARER_TOKEN?: string;
  GROK_API_URL?: string;
  GROK_MODEL?: string;
  DISCORD_APP_SESSION_WEBHOOK_URL?: string;
  DISCORD_APP_SESSION_CHANNEL_ID?: string;
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_ROOTGOALS_AI_COPY_CHANNEL_ID?: string;
  DISCORD_ROOTGOALS_AI_RAW_ARCHIVE_CHANNEL_ID?: string;
  GOAL_MEDIA?: import("@cloudflare/workers-types").R2Bucket;
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_ID?: string;
  INTERNAL_WALLET_ENC_KEY_B64?: string;
  SOLANA_RPC_URL?: string;
  SOLANA_CLUSTER?: string;
  RRTT_TREASURY_SECRET_KEY_B58?: string;
  AVA_EMBER_MINT_BASE58?: string;
  GOAL_TOKEN_RPC_URL?: string;
  GOAL_TOKEN_CLUSTER?: string;
}

function normalizePathname(pathname: string): string {
  return pathname.replace(/\/+/g, "/").replace(/\/+$/, "") || "/";
}

function apiSubpath(pathname: string): string {
  let p = normalizePathname(pathname);
  if (!p.startsWith("/api")) return p;
  while (p.startsWith("/api/") || p === "/api") {
    if (p === "/api") return "/";
    p = normalizePathname(p.slice(4));
  }
  return p;
}

function guestIdFromRequest(request: Request): string {
  return (request.headers.get("X-Guest-Id") || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

function licenseDeviceId(creds: { device_id?: string }, request: Request): string | null {
  const fromBody = String(creds.device_id || "").trim();
  if (fromBody) return fromBody.slice(0, 128);
  const guest = guestIdFromRequest(request);
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
  const ava = String(email || "").trim().toLowerCase() === "root@rootrecord.info";
  const life = ava || lifeMemberFromLicenseData(data) || Boolean(flags?.life_member);
  const pro = life || Boolean(data.proUnlocked || data.pro_unlocked) || Boolean(flags?.pro_unlocked);
  return { pro, life };
}

async function healthJson(env: Env): Promise<Response> {
  let d1Ok = false;
  try {
    const r = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    d1Ok = r?.ok === 1;
  } catch {
    d1Ok = false;
  }
  return json(
    {
      status: d1Ok ? "ok" : "degraded",
      db: d1Ok ? "ok" : "unavailable",
      service: "rootrecord-api-goals",
      site_url: env.SITE_URL,
      ...(await issuePublicFields(env)),
    },
    200,
  );
}

async function resolveGoalsUser(request: Request, env: Env): Promise<string | Response> {
  return resolveUserId(request, env);
}

export async function handleRequest(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
  return runWithCors(request, () => handleRequestInner(request, env, ctx));
}

async function handleRequestInner(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
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

    const publicMatch = pathname.match(/^\/public\/([^/]+)\/goals(?:\/([^/]+))?$/);
    if (method === "GET" && pathname === "/public/server/goals") {
      return handlePublicGoalCatalog(env, "server");
    }
    if (method === "GET" && pathname === "/public/catalog") {
      return handlePublicGoalCatalog(env, "all");
    }
    if (method === "GET" && pathname === "/public/shards") {
      return handlePublicShardsGovernance(env);
    }
    if (method === "GET" && pathname === "/public/embers") {
      return handlePublicEmbers(env);
    }
    const publicGoal = pathname.match(/^\/public\/g\/([^/]+)(?:\/(image|metadata\.json|qr\.svg|balance))?$/);
    if (method === "GET" && publicGoal) {
      if (publicGoal[2] === "image") return handleGoalImageGet(env, publicGoal[1]);
      if (publicGoal[2] === "metadata.json") return handleGoalMetadataGet(env, publicGoal[1]);
      if (publicGoal[2] === "qr.svg") return handleGoalQrGet(env, publicGoal[1]);
      if (publicGoal[2] === "balance") return handleGoalBalanceGet(env, publicGoal[1]);
      return handlePublicGoalCatalog(env, "one", publicGoal[1], ctx);
    }
    const publicProfileAvatarTop = pathname.match(/^\/public\/profile\/([^/]+)\/avatar$/);
    if (method === "GET" && publicProfileAvatarTop) {
      return handleProfileAvatarGet(env, publicProfileAvatarTop[1]);
    }
    if (method === "GET" && pathname === "/public/gallery") {
      const slug = url.searchParams.get("slug") || undefined;
      return handlePublicGalleryList(env, slug || undefined);
    }
    const publicGalleryImg = pathname.match(/^\/public\/gallery\/([^/]+)\/image$/);
    if (method === "GET" && publicGalleryImg) {
      return handlePublicGalleryImage(env, publicGalleryImg[1]);
    }
    const publicPlayer = pathname.match(/^\/public\/u\/([^/]+)$/);
    if (method === "GET" && publicPlayer) {
      return handlePublicPlayer(env, publicPlayer[1]);
    }
    const publicGoalAlias = pathname.match(/^\/public\/goals\/([^/]+)\/(image|metadata\.json)$/);
    if (method === "GET" && publicGoalAlias) {
      if (publicGoalAlias[2] === "image") return handleGoalImageGet(env, publicGoalAlias[1]);
      return handleGoalMetadataGet(env, publicGoalAlias[1]);
    }
    if (method === "GET" && publicMatch) {
      return handlePublicGoals(env, publicMatch[1], publicMatch[2]);
    }

    if (!pathname.startsWith("/api")) {
      if (method === "GET" && (pathname === "/" || pathname === "/health")) {
        return healthJson(env);
      }

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
        const meta = buildSessionInsertMeta(request, licenseDeviceId(creds, request)!);
        const res = await authLogin(env, { email: creds.email || "", password: creds.password || "" }, meta);
        if (!res.ok) return res;
        const data = (await res.json()) as Record<string, unknown>;
        const email = String(data.email || creds.email || "").trim();
        let access = { pro: false, life: false };
        try {
          access = await mergedAccessFromAccountMirror(env, email, data);
        } catch {
          /* keep token */
        }
        data.pro_unlocked = access.pro;
        data.proUnlocked = access.pro;
        data.life_member = access.life;
        data.lifeMember = access.life;
        try {
          await upsertUserAccountFromLicense(env.DB, {
            email,
            account_id: String(data.account_id || ""),
            pro_unlocked: access.pro,
            life_member: access.life,
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
        const tok = (data.access_token || data.token) as string | undefined;
        return json(data, 200, undefined, webSsoSetCookie(request, tok));
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
        const meta = buildSessionInsertMeta(request, licenseDeviceId(creds, request)!);
        const res = await authSignup(env, { email: creds.email || "", password: creds.password || "" }, meta);
        if (!res.ok) return res;
        const data = (await res.json()) as Record<string, unknown>;
        const email = String(data.email || creds.email || "").trim();
        const access = await mergedAccessFromAccountMirror(env, email, data);
        data.pro_unlocked = access.pro;
        data.proUnlocked = access.pro;
        data.life_member = access.life;
        data.lifeMember = access.life;
        try {
          await upsertUserAccountFromLicense(env.DB, {
            email,
            account_id: String(data.account_id || ""),
            pro_unlocked: access.pro,
            life_member: access.life,
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
        const tok = (data.access_token || data.token) as string | undefined;
        return json(data, 200, undefined, webSsoSetCookie(request, tok));
      }

      if (method === "GET" && pathname === "/v1/me") {
        const tok = extractAuthToken(request);
        if (!tok) return json({ detail: "Missing token" }, 401);
        return authMe(env, tok, ctx);
      }

      if (method === "POST" && pathname === "/v1/billing/checkout") {
        const sess = await sessionFromRequest(env, request);
        if (!sess) return json({ detail: "Unauthorized" }, 401);
        const secret = (env.STRIPE_SECRET_KEY || "").trim();
        const priceId = (env.STRIPE_PRICE_ID || "").trim();
        const siteUrl = (env.SITE_URL || "https://g.rootrecord.info").trim();
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
        if (!checkout.ok) return json({ detail: checkout.message }, 502);
        return json({ url: checkout.url }, 200);
      }

      if (method === "POST" && pathname === "/v1/auth/logout") {
        return handleAuthLogout(request, env);
      }

      if (method === "POST" && pathname === "/v1/auth/logout-all") {
        return handleAuthLogoutAll(request, env);
      }

      return json({ ok: false, error: "not_found" }, 404);
    }

    const sub = apiSubpath(pathname);
    const guestId = guestIdFromRequest(request);

    if (method === "GET" && sub === "/health") {
      return healthJson(env);
    }

    const appSessionRes = await handleAppSessionStartRoute(request, env, sub, method);
    if (appSessionRes) return appSessionRes;

    if (method === "GET" && sub === "/v1/me") {
      const tok = extractAuthToken(request);
      if (!tok) return json({ detail: "Missing token" }, 401);
      return authMe(env, tok, ctx);
    }

    if (method === "POST" && (sub === "/v1/billing/checkout" || sub === "/billing/checkout")) {
      const sess = await sessionFromRequest(env, request);
      if (!sess) return json({ detail: "Unauthorized" }, 401);
      const secret = (env.STRIPE_SECRET_KEY || "").trim();
      const priceId = (env.STRIPE_PRICE_ID || "").trim();
      const siteUrl = (env.SITE_URL || "https://g.rootrecord.info").trim();
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
      if (!checkout.ok) return json({ detail: checkout.message }, 502);
      return json({ url: checkout.url }, 200);
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
      let access = { pro: false, life: false };
      try {
        access = await mergedAccessFromAccountMirror(env, emailOut, data);
      } catch {
        /* login already succeeded — don't drop the token */
      }
      try {
        await upsertUserAccountFromLicense(env.DB, {
          email: emailOut,
          account_id: String(data.account_id || ""),
          pro_unlocked: access.pro,
          life_member: access.life,
          extra: { source: "login" },
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
        deviceId,
      );
      return json(
        {
          ok: true,
          token,
          access_token: token,
          email: emailOut,
          account_id: String(data.account_id || ""),
          pro_unlocked: access.pro,
          life_member: access.life,
        },
        200,
        undefined,
        webSsoSetCookie(request, token),
      );
    }

    if (method === "POST" && (sub === "/auth/signup" || sub === "/auth/register")) {
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
      const res = await authSignup(env, { email: creds.email || "", password: creds.password || "" }, meta);
      if (!res.ok) return res;
      const data = (await res.json()) as Record<string, unknown>;
      const token = (data.access_token || data.token) as string | undefined;
      const emailOut = String(data.email || creds.email || "").trim();
      const access = await mergedAccessFromAccountMirror(env, emailOut, data);
      try {
        await upsertUserAccountFromLicense(env.DB, {
          email: emailOut,
          account_id: String(data.account_id || ""),
          pro_unlocked: access.pro,
          life_member: access.life,
          extra: { source: "signup" },
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
        deviceId,
      );
      return json(
        {
          ok: true,
          token,
          access_token: token,
          email: emailOut,
          account_id: String(data.account_id || ""),
          pro_unlocked: access.pro,
          life_member: access.life,
        },
        200,
        undefined,
        webSsoSetCookie(request, token),
      );
    }

    if ((method === "GET" || method === "POST") && sub === "/auth/me") {
      const token = extractAuthToken(request);
      if (!token) return json({ detail: "Missing token" }, 401);
      return authMe(env, token, ctx);
    }

    if (method === "POST" && sub === "/auth/logout") {
      return handleAuthLogout(request, env);
    }

    if (method === "POST" && sub === "/auth/logout-all") {
      return handleAuthLogoutAll(request, env);
    }

    if (method === "GET" && (sub === "/public/catalog" || sub === "/public/server")) {
      return handlePublicGoalCatalog(env, sub.endsWith("server") ? "server" : "all");
    }
    if (method === "GET" && sub === "/public/shards") {
      return handlePublicShardsGovernance(env);
    }
    if (method === "GET" && sub === "/public/embers") {
      return handlePublicEmbers(env);
    }
    const publicProfileAvatar = sub.match(/^\/public\/profile\/([^/]+)\/avatar$/);
    if (method === "GET" && publicProfileAvatar) {
      return handleProfileAvatarGet(env, publicProfileAvatar[1]);
    }
    if (method === "GET" && sub === "/public/gallery") {
      return handlePublicGalleryList(env, url.searchParams.get("slug") || undefined);
    }
    const publicGalleryImgApi = sub.match(/^\/public\/gallery\/([^/]+)\/image$/);
    if (method === "GET" && publicGalleryImgApi) {
      return handlePublicGalleryImage(env, publicGalleryImgApi[1]);
    }
    const publicPlayerApi = sub.match(/^\/public\/u\/([^/]+)$/);
    if (method === "GET" && publicPlayerApi) {
      return handlePublicPlayer(env, publicPlayerApi[1]);
    }
    const publicG = sub.match(/^\/public\/g\/([^/]+)(?:\/(image|metadata\.json|qr\.svg|balance))?$/);
    if (method === "GET" && publicG) {
      if (publicG[2] === "image") return handleGoalImageGet(env, publicG[1]);
      if (publicG[2] === "metadata.json") return handleGoalMetadataGet(env, publicG[1]);
      if (publicG[2] === "qr.svg") return handleGoalQrGet(env, publicG[1]);
      if (publicG[2] === "balance") return handleGoalBalanceGet(env, publicG[1]);
      return handlePublicGoalCatalog(env, "one", publicG[1], ctx);
    }
    const publicGoalAliasApi = sub.match(/^\/public\/goals\/([^/]+)\/(image|metadata\.json)$/);
    if (method === "GET" && publicGoalAliasApi) {
      if (publicGoalAliasApi[2] === "image") return handleGoalImageGet(env, publicGoalAliasApi[1]);
      return handleGoalMetadataGet(env, publicGoalAliasApi[1]);
    }
    const publicApiMatch = sub.match(/^\/public\/goals\/([^/]+)(?:\/([^/]+))?$/);
    if (method === "GET" && publicApiMatch) {
      return handlePublicGoals(env, publicApiMatch[1], publicApiMatch[2]);
    }

    if ((method === "GET" || method === "PUT") && sub === "/onboarding/draft") {
      const uid = await resolveGoalsUser(request, env);
      if (uid instanceof Response) return uid;
      return handleOnboardingDraft(request, env, uid, guestId);
    }

    if (method === "POST" && sub === "/onboarding/finalize") {
      const uid = await resolveGoalsUser(request, env);
      if (uid instanceof Response) return uid;
      return handleOnboardingFinalize(request, env, uid, guestId, ctx);
    }

    const uid = await resolveGoalsUser(request, env);
    if (uid instanceof Response) return uid;

    if (sub === "/categories") {
      return handleCategories(request, env, uid);
    }

    const categoryMatch = sub.match(/^\/categories\/([^/]+)$/);
    if (categoryMatch) {
      return handleCategoryById(request, env, uid, categoryMatch[1]);
    }

    if (sub === "/goals") {
      return handleGoalsList(request, env, uid, ctx);
    }

    if (method === "GET" && sub === "/wallet") {
      return handleWalletMe(request, env, uid);
    }
    if (method === "GET" && sub === "/shards") {
      return handleShardsMe(request, env, uid);
    }
    if (method === "POST" && sub === "/shards/checkout") {
      return handleShardsCheckout(request, env, uid);
    }
    if (method === "POST" && sub === "/shards/send") {
      return handleShardsSend(request, env, uid);
    }
    if (method === "GET" && sub === "/embers") {
      return handleEmbersMe(request, env, uid);
    }
    if (method === "POST" && sub === "/embers/swap") {
      return handleEmbersSwap(request, env, uid);
    }
    if (method === "POST" && sub === "/embers/config") {
      return handleEmbersConfig(request, env, uid);
    }

    const donateMatch = sub.match(/^\/goals\/([^/]+)\/donate$/);
    if (donateMatch) {
      return handleCustodialDonate(request, env, uid, donateMatch[1]);
    }
    const withdrawMatch = sub.match(/^\/goals\/([^/]+)\/withdraw$/);
    if (withdrawMatch) {
      return handleGoalWithdraw(request, env, uid, withdrawMatch[1]);
    }
    const refundMatch = sub.match(/^\/goals\/([^/]+)\/refund$/);
    if (refundMatch) {
      return handleGoalRefund(request, env, uid, refundMatch[1]);
    }
    const claimMatch = sub.match(/^\/goals\/([^/]+)\/claim-tokens$/);
    if (claimMatch) {
      return handleGoalClaimTokens(request, env, uid, claimMatch[1]);
    }

    if ((method === "GET" || method === "PATCH") && sub === "/profile") {
      return handleProfileMe(request, env, uid);
    }

    if ((method === "GET" || method === "POST") && sub === "/gallery") {
      return handleGalleryMine(request, env, uid);
    }
    if (method === "GET" && sub === "/gallery/reports") {
      return handleGalleryReports(request, env, uid);
    }
    const galleryItem = sub.match(/^\/gallery\/([^/]+)(?:\/image)?$/);
    if (galleryItem) {
      return handleGalleryItem(request, env, uid, galleryItem[1]);
    }

    const goalActionMatch = sub.match(/^\/goals\/([^/]+)\/actions(?:\/([^/]+))?$/);
    if (goalActionMatch) {
      if (goalActionMatch[2]) {
        return handleGoalActionById(request, env, uid, goalActionMatch[1], goalActionMatch[2]);
      }
      return handleGoalActions(request, env, uid, goalActionMatch[1]);
    }

    const goalSuggestionMatch = sub.match(/^\/goals\/([^/]+)\/suggestions(?:\/([^/]+))?$/);
    if (goalSuggestionMatch) {
      if (goalSuggestionMatch[2]) {
        return handleGoalSuggestionById(request, env, uid, goalSuggestionMatch[1], goalSuggestionMatch[2]);
      }
      return handleGoalSuggestions(request, env, uid, goalSuggestionMatch[1]);
    }

    const achievementMatch = sub.match(/^\/goals\/([^/]+)\/achievements\/([^/]+)$/);
    if (achievementMatch) {
      return handleAchievementById(request, env, uid, achievementMatch[1], achievementMatch[2]);
    }

    const entryMatch = sub.match(/^\/goals\/([^/]+)\/entries\/([^/]+)$/);
    if (entryMatch) {
      return handleEntryById(request, env, uid, entryMatch[1], entryMatch[2]);
    }

    const goalMatch = sub.match(/^\/goals\/([^/]+)(?:\/(achievements|entries|ai-refresh|provision|image))?$/);
    if (goalMatch) {
      const goalId = goalMatch[1];
      const action = goalMatch[2];
      if (action === "ai-refresh") return handleGoalAiRefresh(request, env, uid, goalId, ctx);
      if (action === "achievements") return handleGoalAchievements(request, env, uid, goalId);
      if (action === "entries") return handleGoalEntries(request, env, uid, goalId);
      if (action === "provision") return handleGoalProvision(request, env, uid, goalId, ctx);
      if (action === "image") return handleGoalImagePost(request, env, uid, goalId);
      return handleGoalById(request, env, uid, goalId);
    }

    if (method === "GET" && sub === "/mobile/config") {
      return json(
        {
          app_id: "rootrecord_goals_web",
          product: "root_goals",
          version: "1.0.8",
          release: 8,
          api_base: "https://api-goals.rootrecord.info/api",
          disclaimer: AI_DISCLAIMER,
          tiers: {
            free: { max_goals: FREE_MAX_GOALS, ai_refresh_days: 3 },
            member: { max_goals: MEMBER_MAX_GOALS, ai_refresh_per_goal_per_day: 3, ai_goals_per_day: 10 },
          },
        },
        200,
      );
    }

    return json({ detail: "Not Found" }, 404);
}

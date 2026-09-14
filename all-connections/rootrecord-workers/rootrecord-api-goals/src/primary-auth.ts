import type { D1Database, ExecutionContext } from "@cloudflare/workers-types";

import { json } from "./cors";
import { parseSessionCookie } from "./web-sso";

import {

  b64url,

  b64urlEncodeUtf8,

  b64urlToBytes,

  hashNewAccountCredentials,

  verifyLicenseAccountPassword,

} from "../../shared/password-verify";

import { billingCheckoutAvailable } from "./billing-stripe";

import { fetchBillingSnapshot } from "../../shared/billing-state";
import { readUserAccountAccessFlags } from "./accounts";

import { getAppAssociationsForEmail } from "../../shared/app-associations";
import { grantSignupBonusOnRegistration } from "./earn-signup-bonus";
import { refreshCustodialOnchainCacheFromRpc } from "./custodial-onchain-cache";
import type { CustodialCacheRpcEnv } from "./custodial-onchain-cache";
import {
  isMergedLoginAliasEmail,
  resolveLicenseLoginRow,
  verifyPasswordForLoginRow,
} from "../../shared/license-login";

export interface AuthEnv {

  DB: D1Database;

  JWT_SECRET: string;
  /** Optional second HMAC secret so dashboard cookies (license worker) also verify here. */
  JWT_SECRET_LICENSE?: string;

  /** Public site origin for Stripe redirects (wrangler [vars] SITE_URL). */

  SITE_URL?: string;

  /** Stripe secret key (wrangler secret put STRIPE_SECRET_KEY). */

  STRIPE_SECRET_KEY?: string;

  /** Recurring Price id for web checkout (wrangler [vars] STRIPE_PRICE_ID). */

  STRIPE_PRICE_ID?: string;

  DISCORD_BOT_TOKEN?: string;
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_GUILD_ID?: string;
  DISCORD_DEVELOPER_ROLE_ID?: string;

  /** Mainnet RPC for custodial cache refresh (background `waitUntil` after `/v1/me`, cron, etc.). */

  SOLANA_RPC_URL?: string;

  RRTT_MINT_BASE58?: string;

  RRTT_DECIMALS?: string;

}

async function linkedDiscordUserId(db: D1Database, accountId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT discord_user_id FROM discord_account_links WHERE account_id = ?")
    .bind(accountId)
    .first<{ discord_user_id: string }>();
  return typeof row?.discord_user_id === "string" && row.discord_user_id.trim() ? row.discord_user_id.trim() : null;
}

async function discordUserHasRole(env: AuthEnv, discordUserId: string | null, roleId: string | undefined): Promise<boolean> {
  const token = String(env.DISCORD_ROOTMC_BOT_TOKEN || env.DISCORD_BOT_TOKEN || "")
    .replace(/^bot\s+/i, "")
    .trim();
  const guildId = String(env.DISCORD_GUILD_ID || "").trim();
  const uid = String(discordUserId || "").trim();
  const rid = String(roleId || "").trim();
  if (!token || !guildId || !uid || !rid) return false;
  const res = await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(uid)}`, {
    headers: { Authorization: `Bot ${token}`, "User-Agent": "RootRecordKilaueaAuth (developer role)" },
  });
  if (!res.ok) return false;
  const member = (await res.json().catch(() => ({}))) as { roles?: unknown };
  const roles = Array.isArray(member.roles) ? member.roles.map((r) => String(r)) : [];
  return roles.includes(rid);
}



/**

 * D1 tables (same `root-record` DB):

 * - `license_accounts`: email + password_hash + salt — sole source for web/app login and signup.

 * - `user_accounts`: subscription flags and account_id mirror only; no passwords (see accounts.ts).

 * Password verification is shared with rootrecord-license (`../../shared/password-verify.ts`): multiple

 * legacy PBKDF2 shapes (SHA-256 / SHA-1, iteration counts, hex vs base64url encodings) then upgrade to canonical.

 */

const JWT_TTL_SEC = 30 * 24 * 60 * 60;



async function jwtSign(payload: Record<string, unknown>, secret: string): Promise<string> {

  const header = { alg: "HS256", typ: "JWT" };

  const h = b64urlEncodeUtf8(JSON.stringify(header));

  const p = b64urlEncodeUtf8(JSON.stringify(payload));

  const data = `${h}.${p}`;

  const enc = new TextEncoder();

  const key = await crypto.subtle.importKey(

    "raw",

    enc.encode(secret),

    { name: "HMAC", hash: "SHA-256" },

    false,

    ["sign"]

  );

  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));

  return `${data}.${b64url(sig)}`;

}



export async function jwtVerifyClaims(

  token: string,

  secret: string

): Promise<{ sub: string; aid: string; sid?: string } | null> {

  const parts = token.split(".");

  if (parts.length !== 3) return null;

  const data = `${parts[0]}.${parts[1]}`;

  const enc = new TextEncoder();

  let sig: Uint8Array;

  try {

    sig = b64urlToBytes(parts[2]!);

  } catch {

    return null;

  }

  const key = await crypto.subtle.importKey(

    "raw",

    enc.encode(secret),

    { name: "HMAC", hash: "SHA-256" },

    false,

    ["verify"]

  );

  const ok = await crypto.subtle.verify("HMAC", key, sig, enc.encode(data));

  if (!ok) return null;

  let payload: Record<string, unknown>;

  try {

    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]!)));

  } catch {

    return null;

  }

  const exp = Number(payload.exp);

  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;

  const sub = String(payload.sub || "").trim().toLowerCase();

  const aid = String(payload.aid || "").trim();

  if (!sub || !aid) return null;

  const sidRaw = payload.sid;

  const sid = typeof sidRaw === "string" && sidRaw.length >= 8 ? String(sidRaw).trim() : "";

  return sid ? { sub, aid, sid } : { sub, aid };

}



/** Optional client metadata stored on `license_sessions` (migration 0025). */
export type SessionInsertMeta = {
  device_id?: string | null;
  user_agent?: string | null;
  ip?: string | null;
};

/** New session row + JWT (e.g. after password change). */
export async function issueFreshSessionToken(
  env: AuthEnv,
  email: string,
  accountId: string,
  meta: SessionInsertMeta
): Promise<string | null> {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) return null;
  const sid = await insertLicenseSession(env.DB, accountId, meta);
  return issueToken(env.JWT_SECRET, email, accountId, sid);
}

async function insertLicenseSession(
  db: D1Database,
  accountId: string,
  meta: SessionInsertMeta
): Promise<string | null> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const device_id = String(meta.device_id || "").trim().slice(0, 128) || null;
  const user_agent = String(meta.user_agent || "").trim().slice(0, 512) || null;
  const ip = String(meta.ip || "").trim().slice(0, 64) || null;
  try {
    await db
      .prepare(
        `INSERT INTO license_sessions (id, account_id, device_id, user_agent, ip, created_at, last_seen_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .bind(id, accountId, device_id, user_agent, ip, now, now)
      .run();
    return id;
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("insertLicenseSession", msg);
    return null;
  }
}

async function issueToken(secret: string, email: string, accountId: string, sessionId: string | null): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    sub: email.toLowerCase(),
    aid: accountId,
    iat: now,
    exp: now + JWT_TTL_SEC,
  };
  if (sessionId) payload.sid = sessionId;
  return jwtSign(payload, secret);
}



function authSuccessJson(row: { id: string; email: string }, token: string): Record<string, unknown> {

  return {

    access_token: token,

    token,

    account_id: row.id,

    email: row.email,

    access: "full",

    reason: "none",

    valid_until: null,

    subscription_status: "none",

    proUnlocked: false,

    pro_unlocked: false,

    message: "ok",

  };

}



export function authMisconfigured(): Response {

  return json(

    {

      detail:

        "Set Worker secret JWT_SECRET (deploy.ps1 uses ROOTRECORD_PRIMARY_JWT_SECRET or .deploy-jwt).",

    },

    503

  );

}



export async function sessionFromBearer(

  env: AuthEnv,

  token: string

): Promise<{ email: string; accountId: string; account_created_at: string | null; sessionId?: string } | null> {

  if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) return null;

  const secrets = [env.JWT_SECRET, env.JWT_SECRET_LICENSE].filter(
    (s): s is string => typeof s === "string" && s.length >= 16,
  );
  let claims: { sub: string; aid: string; sid?: string } | null = null;
  for (const secret of secrets) {
    claims = await jwtVerifyClaims(token, secret);
    if (claims) break;
  }

  if (!claims) return null;

  if (claims.sid) {
    const srow = await env.DB
      .prepare(
        "SELECT id, revoked_at, last_seen_at FROM license_sessions WHERE id = ? AND account_id = ?"
      )
      .bind(claims.sid, claims.aid)
      .first<{ id: string; revoked_at: string | null; last_seen_at: string | null }>();
    if (!srow) return null;
    if (srow.revoked_at && String(srow.revoked_at).trim()) return null;
    const last = srow.last_seen_at ? Date.parse(srow.last_seen_at) : NaN;
    if (!Number.isFinite(last) || Date.now() - last > 5 * 60_000) {
      const now = new Date().toISOString();
      try {
        await env.DB.prepare("UPDATE license_sessions SET last_seen_at = ? WHERE id = ?").bind(now, claims.sid).run();
      } catch {
        /* ignore */
      }
    }
  }

  const row = await env.DB.prepare(
    "SELECT id, email, created_at FROM license_accounts WHERE id = ? AND email = ?"
  )

    .bind(claims.aid, claims.sub)

    .first<{ id: string; email: string; created_at: string | null }>();

  if (!row) return null;

  const email = String(row.email || "")
    .trim()
    .toLowerCase();
  if (!email) return null;

  const accountId = String(row.id || "").trim();
  if (!accountId) return null;

  const account_created_at =
    typeof row.created_at === "string" && row.created_at.trim() ? row.created_at.trim() : null;

  return { email, accountId, account_created_at, sessionId: claims.sid };

}

export function extractAuthToken(request: Request): string | null {
  const auth = request.headers.get("Authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  return parseSessionCookie(request);
}

export async function sessionFromRequest(
  env: AuthEnv,
  request: Request
): Promise<{ email: string; accountId: string; account_created_at: string | null; sessionId?: string } | null> {
  const token = extractAuthToken(request);
  if (!token) return null;
  return sessionFromBearer(env, token);
}

export async function authSignup(
  env: AuthEnv,
  body: Record<string, unknown>,
  sessionMeta?: SessionInsertMeta
): Promise<Response> {

  if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) return authMisconfigured();

  const email = String(body.email || "")

    .trim()

    .toLowerCase();

  const password = String(body.password || "");

  if (!email.includes("@") || password.length < 6) {

    return json({ detail: "Valid email and password (6+ characters) required." }, 400);

  }

  if (await isMergedLoginAliasEmail(env.DB, email)) {

    return json(

      { detail: "This email is linked to an existing RootRecord account. Sign in instead." },

      409,

    );

  }

  const id = crypto.randomUUID();

  let salt: string;

  let password_hash: string;

  try {

    const creds = await hashNewAccountCredentials(password);

    salt = creds.salt;

    password_hash = creds.password_hash;

  } catch (e) {

    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);

    console.error("authSignup hash error", msg);

    return json({ detail: "Could not prepare password hash. Please try again." }, 500);

  }

  const now = new Date().toISOString();

  try {

    await env.DB.prepare(

      "INSERT INTO license_accounts (id, email, password_hash, salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"

    )

      .bind(id, email, password_hash, salt, now, now)

      .run();

  } catch (e) {

    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);

    if (/UNIQUE constraint failed|unique constraint/i.test(msg)) {

      return json({ detail: "That email is already registered. Try signing in instead." }, 409);

    }

    console.error("authSignup insert error", msg);

    return json({ detail: "Could not save account. Please try again." }, 500);

  }

  try {
    await grantSignupBonusOnRegistration(env.DB, "user:" + email, now);
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("grantSignupBonusOnRegistration", msg);
  }

  try {

    const sid = sessionMeta ? await insertLicenseSession(env.DB, id, sessionMeta) : null;

    const token = await issueToken(env.JWT_SECRET, email, id, sid);

    return json(authSuccessJson({ id, email }, token), 200);

  } catch (e) {

    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);

    return json({ detail: msg || "Could not issue session." }, 500);

  }

}



export async function authLogin(
  env: AuthEnv,
  body: Record<string, unknown>,
  sessionMeta?: SessionInsertMeta
): Promise<Response> {

  if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) return authMisconfigured();

  const email = String(body.email || "")

    .trim()

    .toLowerCase();

  const password = String(body.password || "");

  if (!email || !password) {

    return json({ detail: "Email and password required." }, 400);

  }

  const row = await resolveLicenseLoginRow(env.DB, email);

  if (!row) {

    return json({ detail: "Incorrect email or password." }, 401);

  }

  try {

    const v = await verifyPasswordForLoginRow(password, row);

    if (!v.ok) {

      return json({ detail: "Incorrect email or password." }, 401);

    }

    const now = new Date().toISOString();

    if (v.needsUpgrade) {

      if (row.via_alias) {

        await env.DB.prepare(

          "UPDATE license_account_login_aliases SET password_hash = ?, salt = ? WHERE email = ?",

        )

          .bind(v.password_hash, v.salt, row.login_email)

          .run();

      } else {

        await env.DB.prepare(

          "UPDATE license_accounts SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?",

        )

          .bind(v.password_hash, v.salt, now, row.id)

          .run();

      }

    } else if (!row.via_alias) {

      await env.DB.prepare("UPDATE license_accounts SET updated_at = ? WHERE id = ?").bind(now, row.id).run();

    }

    const sid = sessionMeta ? await insertLicenseSession(env.DB, row.id, sessionMeta) : null;

    const token = await issueToken(env.JWT_SECRET, row.email, row.id, sid);

    return json(authSuccessJson({ id: row.id, email: row.email }, token), 200);

  } catch {

    return json({ detail: "Sign-in failed. Please try again." }, 500);

  }

}



export async function authMe(
  env: AuthEnv,
  token: string,
  ctx?: ExecutionContext,
): Promise<Response> {

  if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) return authMisconfigured();

  const sess = await sessionFromBearer(env, token);

  if (!sess) {

    return json({ detail: "Unauthorized", authenticated: false }, 401);

  }

  const billing_checkout_available = billingCheckoutAvailable(env);

  const billing = await fetchBillingSnapshot(env.DB, sess.email);
  const acct = await readUserAccountAccessFlags(env.DB, sess.email);
  let pro = Boolean(billing?.pro_unlocked) || Boolean(acct?.pro_unlocked);
  const subStatus = billing ? billing.subscription_status : "none";
  let life = Boolean(billing?.life_member) || Boolean(acct?.life_member);
  if (String(sess.email || "").trim().toLowerCase() === "root@rootrecord.info") {
    life = true;
    pro = true;
  }
  if (life) pro = true;
  const discordUserId = await linkedDiscordUserId(env.DB, sess.accountId).catch(() => null);
  const developerUnlimited = await discordUserHasRole(env, discordUserId, env.DISCORD_DEVELOPER_ROLE_ID).catch(() => false);
  if (developerUnlimited) {
    pro = true;
    life = true;
  }

  let apps: Awaited<ReturnType<typeof getAppAssociationsForEmail>>;
  try {
    apps = await getAppAssociationsForEmail(env.DB, sess.email);
  } catch {
    apps = {
      rootrecord_business_manager_windows: {
        associated: null,
        note: "Association data temporarily unavailable.",
        last_connected_at: null,
      },
      rootrecord_business_manager_android: { associated: false, last_connected_at: null },
      rootrecord_weather_manager_windows: { associated: false, last_connected_at: null },
      rootrecord_weather_manager_android: { associated: false, last_connected_at: null },
      usage: [],
      signals: { mobile_push: false, saved_locations: false, weather_cache: false },
    };
  }

  let linked_wallet_pubkey: string | null = null;

  let linked_wallet_verified_at: string | null = null;

  try {

    const lw = await env.DB.prepare(

      "SELECT pubkey, verified_at FROM solana_linked_wallets WHERE account_id = ?",

    )

      .bind(sess.accountId)

      .first<{ pubkey: string; verified_at: string }>();

    if (lw?.pubkey) {

      linked_wallet_pubkey = lw.pubkey;

      linked_wallet_verified_at = lw.verified_at;

    }

  } catch {

    /* table may not exist until migration 0026 */

  }

  let custodial_wallet_pubkey: string | null = null;

  let withdraw_dest_pubkey: string | null = null;

  let custodial_sol_lamports_cached: number | null = null;

  let custodial_balances_rpc_ok = false;

  const rrttMintB58 = String(env.RRTT_MINT_BASE58 || "").trim() || null;

  const rrttMintDecimals = Math.min(
    9,
    Math.max(0, Math.floor(Number(String(env.RRTT_DECIMALS || "9").trim()) || 9) || 0),
  );

  try {
    const cw = await env.DB
      .prepare(
        `SELECT iw.pubkey AS cpk, cs.withdraw_dest_pubkey AS wdp, cs.sol_balance_lamports_cached AS solc
         FROM internal_solana_wallets iw
         LEFT JOIN rr_earn_custodial_state cs ON cs.account_id = iw.account_id
         WHERE iw.account_id = ?`,
      )
      .bind(sess.accountId)
      .first<{ cpk: string; wdp: string | null; solc: number | null }>();

    if (cw?.cpk) custodial_wallet_pubkey = cw.cpk;

    if (cw?.wdp) withdraw_dest_pubkey = cw.wdp;

    if (cw?.solc != null && Number.isFinite(Number(cw.solc))) {
      custodial_sol_lamports_cached = Math.floor(Number(cw.solc));
    }
  } catch {
    /* tables may be missing */
  }

  /** Refresh D1 custodial cache after respond — same data path as `/earn/summary` reads; avoids blocking logins on Solana RPC. */
  if (ctx?.waitUntil) {
    ctx.waitUntil(
      refreshCustodialOnchainCacheFromRpc(env as CustodialCacheRpcEnv, sess.accountId).catch(() => {}),
    );
  }

  return json(

    {

      authenticated: true,

      email: sess.email,

      account_id: sess.accountId,

      has_password: true,

      proUnlocked: pro,

      pro_unlocked: pro,

      life_member: life,

      lifeMember: life,

      access: {
        tier: developerUnlimited ? "developer" : pro ? "pro" : "none",
        reason: developerUnlimited ? "discord_developer" : pro ? "paid" : "none",
      },
      developer_unlimited: developerUnlimited,

      subscription_status: subStatus,

      billing_checkout_available,

      account_created_at: sess.account_created_at,

      linked_wallet_pubkey,

      linked_wallet_verified_at,

      custodial_wallet_pubkey,

      withdraw_dest_pubkey,

      custodial_sol_lamports_cached,

      custodial_balances_rpc_ok,

      rrtt_mint_base58: rrttMintB58,

      rrtt_mint_decimals: rrttMintDecimals,

      apps,

    },

    200

  );

}



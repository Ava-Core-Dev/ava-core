import type { ExecutionContext } from "@cloudflare/workers-types";

import { json } from "../cors";
import { mintAuthToken } from "../primary-auth";
import { buildSessionCookieHeader, ssoCookieDomainForApiHost } from "../web-sso";
import {
  applyRootMcLinkedDiscordMember,
  notifyRootMcDiscordLinkSuccess,
} from "../discord-rootmc-player-link";
import { syncCouncilVotersRoleForDiscordUser } from "../rootmc-governance-council";
import { msToIso, nowMs, resolveG2FeaturedRealmId, str, type G2Env } from "./g2-db";
import {
  g2ConsumeLinkCode,
  g2LoadLinkCode,
  g2ProvisionMinecraftPlayerAccount,
  g2UpsertMinecraftLink,
  g2ValidateLinkCodeRow,
} from "./g2-link-store";

const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
const OAUTH_SCOPES = ["identify", "guilds.join"];
const SIGNIN_STATE_PREFIX = "signin:";
const MOBILE_LINK_PREFIX = "mobile:";
const MOBILE_SIGNIN_PREFIX = "signin-mobile:";
const DEFAULT_OAUTH_REDIRECT_URI = "https://api2.rootmc.net/v1/discord/rootmc/callback";
const LINK_BONUS_G = 25;

function verifyReturnUrl(site: string, query?: string): string {
  const root = String(site || "https://rootmc.net").trim().replace(/\/+$/, "");
  const base = `${root}/verify`;
  return query ? `${base}?${query}` : base;
}

function siteReturnUrl(site: string, returnPath: string, query?: string): string {
  const root = String(site || "https://rootmc.net").trim().replace(/\/+$/, "");
  const path = returnPath.startsWith("/") ? returnPath : "/verify/";
  const base = `${root}${path}`;
  if (!query) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${query}`;
}

function sessionRedirect(request: Request, targetUrl: string, token: string | null): Response {
  const headers = new Headers({ Location: targetUrl });
  if (token) {
    const dom = ssoCookieDomainForApiHost(new URL(request.url).hostname);
    if (dom) headers.set("Set-Cookie", buildSessionCookieHeader(token, dom));
  }
  return new Response(null, { status: 302, headers });
}

function mobileAuthRedirect(query: Record<string, string>): Response {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const v = str(value);
    if (v) params.set(key, v);
  }
  return Response.redirect(`rootmc://auth?${params.toString()}`, 302);
}

async function mintMobileSessionRedirect(
  env: G2Env,
  email: string,
  accountId: string,
  query: Record<string, string>,
): Promise<Response> {
  const token = await mintAuthToken(env, email, accountId);
  if (!token) return mobileAuthRedirect({ discord: "error" });
  return mobileAuthRedirect({ ...query, token });
}

async function mintSessionRedirect(
  request: Request,
  env: G2Env,
  site: string,
  returnPath: string,
  email: string,
  accountId: string,
  query?: string,
): Promise<Response> {
  const token = await mintAuthToken(env, email, accountId);
  const base = siteReturnUrl(site, returnPath, query);
  const target = token ? `${base}#token=${encodeURIComponent(token)}` : base;
  return sessionRedirect(request, target, token);
}

function oauthCallbackUrl(env: G2Env): string {
  const explicit = str(env.DISCORD_ROOTMC_OAUTH_REDIRECT_URI);
  if (explicit) return explicit;
  return DEFAULT_OAUTH_REDIRECT_URI;
}

function randState(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

async function g2SaveDiscordLink(
  db: D1Database,
  acct: { id: string; email: string },
  discord: {
    discord_user_id: string;
    discord_username: string | null;
    discord_global_name: string | null;
    discord_email: string | null;
  },
): Promise<void> {
  const ts = nowMs();
  await db
    .prepare(
      `INSERT INTO g2_discord_link (
         account_id, discord_user_id, discord_username, discord_global_name, discord_email, linked_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         discord_user_id = excluded.discord_user_id,
         discord_username = excluded.discord_username,
         discord_global_name = excluded.discord_global_name,
         discord_email = excluded.discord_email,
         linked_at_ms = excluded.linked_at_ms`,
    )
    .bind(
      acct.id,
      discord.discord_user_id,
      discord.discord_username,
      discord.discord_global_name,
      discord.discord_email,
      ts,
    )
    .run();
}

async function g2QueueDiscordLinkBonus(
  db: D1Database,
  realmId: string,
  minecraftUuid: string,
  minecraftUsername: string,
  discordUserId: string,
): Promise<{ queued: boolean; transferId?: string; reason?: string }> {
  const uuid = str(minecraftUuid).toLowerCase();
  const compact = uuid.replace(/-/g, "");
  const discordId = str(discordUserId);
  if (!uuid || !realmId || !discordId) return { queued: false, reason: "invalid" };

  // Lifetime once per MC UUID (any status). Discord id stored via username note if schema lacks column.
  const existing = await db
    .prepare(
      `SELECT id FROM g2_gold_transfer
       WHERE source = 'discord_link'
         AND REPLACE(LOWER(to_uuid), '-', '') = ?
       LIMIT 1`,
    )
    .bind(compact)
    .first<{ id: string }>();
  if (existing?.id) return { queued: false, reason: "already_paid" };

  // Also block if this Discord already linked and paid on Gen1 table when present.
  try {
    const gen1 = await db
      .prepare(
        `SELECT id FROM rootmc_gold_transfers
         WHERE source = 'discord_link' AND discord_to_user_id = ?
         LIMIT 1`,
      )
      .bind(discordId)
      .first<{ id: string }>();
    if (gen1?.id) return { queued: false, reason: "already_paid" };
  } catch {
    // Gen1 table may not exist in isolated g2 DBs.
  }

  const id = crypto.randomUUID();
  const ts = nowMs();
  await db
    .prepare(
      `INSERT INTO g2_gold_transfer
         (id, realm_id, to_uuid, to_username, amount_g, source, status, created_at_ms)
       VALUES (?, ?, ?, ?, ?, 'discord_link', 'pending', ?)`,
    )
    .bind(id, realmId, uuid, minecraftUsername, LINK_BONUS_G, ts)
    .run();
  return { queued: true, transferId: id };
}

async function insertG2OAuthState(
  env: G2Env,
  linkCode: string,
): Promise<{ expiresAt: string; authorize_url: string } | Response> {
  const clientId = str(env.DISCORD_ROOTMC_CLIENT_ID);
  if (!clientId) {
    return json({ detail: "Discord linking is not configured on the server." }, 503);
  }

  const codeVerifier = createCodeVerifier();
  const codeChallenge = await createCodeChallenge(codeVerifier);
  const state = randState();
  const now = nowMs();
  const expiresAtMs = now + OAUTH_STATE_TTL_MS;

  await env.DB.prepare(
    `INSERT INTO g2_discord_oauth_state (state, link_code, created_at_ms, expires_at_ms, code_verifier)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(state, linkCode, now, expiresAtMs, codeVerifier)
    .run();

  const redirectUri = oauthCallbackUrl(env);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: OAUTH_SCOPES.join(" "),
    state,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return {
    expiresAt: msToIso(expiresAtMs),
    authorize_url: `https://discord.com/api/oauth2/authorize?${params.toString()}`,
  };
}

async function startG2DiscordLink(
  linkCode: string,
  env: G2Env,
  mobileApp = false,
): Promise<Response> {
  const code = linkCode.toUpperCase();
  if (!code || code.length !== 6) {
    return json({ detail: "Valid 6-character link code required." }, 400);
  }

  const row = g2ValidateLinkCodeRow(await g2LoadLinkCode(env.DB, code));
  if (row instanceof Response) return row;

  const stateKey = mobileApp ? `${MOBILE_LINK_PREFIX}${code}` : code;
  const statePayload = await insertG2OAuthState(env, stateKey);
  if (statePayload instanceof Response) return statePayload;

  return json({
    authorize_url: statePayload.authorize_url,
    expires_at: statePayload.expiresAt,
    minecraft_username: row.minecraft_username,
  });
}

export async function handleG2DiscordLinkRoutes(
  request: Request,
  env: G2Env,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/realm/minecraft")) return null;
  const rest = subpath.slice("/realm/minecraft".length) || "/";

  if (method === "POST" && rest === "/link/discord/start") {
    let body: { code?: string; mobile_app?: boolean } = {};
    try {
      body = JSON.parse(await request.text()) as { code?: string; mobile_app?: boolean };
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }
    return startG2DiscordLink(str(body.code), env, body.mobile_app === true);
  }

  return null;
}

export async function handleG2DiscordOAuthCallback(
  request: Request,
  env: G2Env,
  ctx?: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const oauthCode = str(url.searchParams.get("code"));
  const state = str(url.searchParams.get("state"));
  const err = str(url.searchParams.get("error"));
  const site = str(env.SITE_URL) || "https://rootmc.net";

  if (err) return Response.redirect(verifyReturnUrl(site, "discord=error"), 302);
  if (!oauthCode || !state) return Response.redirect(verifyReturnUrl(site, "discord=error"), 302);

  const stateRow = await env.DB.prepare(
    "SELECT link_code, expires_at_ms, code_verifier FROM g2_discord_oauth_state WHERE state = ? LIMIT 1",
  )
    .bind(state)
    .first<{ link_code: string; expires_at_ms: number; code_verifier?: string }>();

  await env.DB.prepare("DELETE FROM g2_discord_oauth_state WHERE state = ?").bind(state).run();

  if (!stateRow?.link_code) {
    return Response.redirect(verifyReturnUrl(site, "discord=expired"), 302);
  }
  if (Number(stateRow.expires_at_ms) < nowMs()) {
    return Response.redirect(verifyReturnUrl(site, "discord=expired"), 302);
  }

  const clientId = str(env.DISCORD_ROOTMC_CLIENT_ID);
  if (!clientId) return Response.redirect(verifyReturnUrl(site, "discord=error"), 302);

  const redirectUri = oauthCallbackUrl(env);
  const codeVerifier = str(stateRow.code_verifier);
  const tokenBody = new URLSearchParams();
  tokenBody.set("client_id", clientId);
  tokenBody.set("grant_type", "authorization_code");
  tokenBody.set("code", oauthCode);
  tokenBody.set("redirect_uri", redirectUri);
  if (codeVerifier) {
    tokenBody.set("code_verifier", codeVerifier);
  } else {
    const clientSecret = str(env.DISCORD_ROOTMC_CLIENT_SECRET);
    if (!clientSecret) return Response.redirect(verifyReturnUrl(site, "discord=error"), 302);
    tokenBody.set("client_secret", clientSecret);
  }

  const tokRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody,
  });
  const tok = (await tokRes.json().catch(() => ({}))) as Record<string, unknown>;
  const accessToken = typeof tok.access_token === "string" ? tok.access_token : "";
  if (!tokRes.ok || !accessToken) {
    return Response.redirect(verifyReturnUrl(site, "discord=error"), 302);
  }

  const meRes = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const me = (await meRes.json().catch(() => ({}))) as Record<string, unknown>;
  const discordUserId = typeof me.id === "string" ? me.id : "";
  const discordUsername = typeof me.username === "string" ? me.username : null;
  const discordGlobalName = typeof me.global_name === "string" ? me.global_name : null;
  const discordEmail = typeof me.email === "string" ? me.email : null;
  if (!discordUserId) return Response.redirect(verifyReturnUrl(site, "discord=error"), 302);

  const linkCodeRaw = str(stateRow.link_code);
  const mobileLink = linkCodeRaw.startsWith(MOBILE_LINK_PREFIX);
  const linkCode = mobileLink ? linkCodeRaw.slice(MOBILE_LINK_PREFIX.length).toUpperCase() : linkCodeRaw.toUpperCase();

  const linkRow = g2ValidateLinkCodeRow(await g2LoadLinkCode(env.DB, linkCode));
  if (linkRow instanceof Response) {
    if (mobileLink) return mobileAuthRedirect({ discord: "code_invalid" });
    return Response.redirect(verifyReturnUrl(site, "discord=code_invalid"), 302);
  }

  const existingDiscord = await env.DB.prepare(
    "SELECT account_id FROM g2_discord_link WHERE discord_user_id = ? LIMIT 1",
  )
    .bind(discordUserId)
    .first<{ account_id: string }>();

  const provisioned = await g2ProvisionMinecraftPlayerAccount(
    env.DB,
    linkRow.minecraft_uuid,
    linkRow.minecraft_username,
  );

  if (existingDiscord && existingDiscord.account_id !== provisioned.accountId) {
    if (mobileLink) return mobileAuthRedirect({ discord: "already_linked" });
    return Response.redirect(verifyReturnUrl(site, "discord=already_linked"), 302);
  }

  const linkBonusAlready =
    existingDiscord != null && existingDiscord.account_id === provisioned.accountId;

  await g2UpsertMinecraftLink(
    env.DB,
    linkRow.minecraft_uuid,
    linkRow.minecraft_username,
    provisioned.accountId,
    provisioned.email,
  );
  await g2ConsumeLinkCode(env.DB, linkCode, provisioned.accountId);

  await g2SaveDiscordLink(env.DB, { id: provisioned.accountId, email: provisioned.email }, {
    discord_user_id: discordUserId,
    discord_username: discordUsername,
    discord_global_name: discordGlobalName,
    discord_email: discordEmail,
  });

  await applyRootMcLinkedDiscordMember(env, discordUserId, linkRow.minecraft_username, accessToken);

  const councilJob = syncCouncilVotersRoleForDiscordUser(env, discordUserId).catch((e) =>
    console.error("g2_council_role_sync_failed", e),
  );
  if (ctx?.waitUntil) ctx.waitUntil(councilJob);
  else await councilJob;

  if (!linkBonusAlready) {
    const realmId = (await resolveG2FeaturedRealmId(env.DB)) || "";
    const linkBonus = await g2QueueDiscordLinkBonus(
      env.DB,
      realmId,
      linkRow.minecraft_uuid,
      linkRow.minecraft_username,
      discordUserId,
    );
    if (linkBonus.queued) {
      console.info("g2_discord_link_bonus_queued", linkRow.minecraft_username, linkBonus.transferId);
    }
  } else {
    console.info("g2_discord_link_bonus_skipped", linkRow.minecraft_username, "already_linked");
  }

  const notifyJob = notifyRootMcDiscordLinkSuccess(
    env,
    discordUserId,
    linkRow.minecraft_username,
  ).catch((e) => console.error("g2_discord_link_notify_failed", e));
  if (ctx?.waitUntil) ctx.waitUntil(notifyJob);
  else await notifyJob;

  const q = new URLSearchParams({ discord: "linked", player: linkRow.minecraft_username });
  if (mobileLink) {
    return mintMobileSessionRedirect(env, provisioned.email, provisioned.accountId, {
      discord: "linked",
      player: linkRow.minecraft_username,
    });
  }
  return mintSessionRedirect(
    request,
    env,
    site,
    "/verify/",
    provisioned.email,
    provisioned.accountId,
    q.toString(),
  );
}

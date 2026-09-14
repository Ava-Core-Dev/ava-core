import type { D1Database, ExecutionContext } from "@cloudflare/workers-types";

import {
  attachLoginEmailAlias,
  deleteMergedDuplicateAccount,
} from "../../shared/license-login";
import { markRecentAccountVerification } from "./account-security";
import { readUserAccountAccessFlags } from "./accounts";

function nowIso(): string {
  return new Date().toISOString();
}

function randState(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function stripeFormPost(url: string, body: URLSearchParams): Promise<Record<string, unknown> | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return null;
  return j;
}

async function discordGetMe(accessToken: string): Promise<Record<string, unknown> | null> {
  const res = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${accessToken.trim()}` },
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return null;
  return j;
}

const VERIFY_STATE_PREFIX = "v";

function returnPageUrl(site: string, state: string, query?: string): string {
  const root = String(site || "https://rootrecord.cloud").trim().replace(/\/+$/, "");
  const path = state.startsWith(VERIFY_STATE_PREFIX) ? "/discord-verify" : "/account";
  const base = `${root}${path}`;
  return query ? `${base}?${query}` : base;
}

async function discordBotDeleteRole(
  token: string,
  guildId: string,
  userId: string,
  roleId: string,
): Promise<void> {
  const path = `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`;
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bot ${token.trim()}`,
      "User-Agent": "RootRecordAccountWorker (discord unlink)",
    },
  });
  if (res.status === 204 || res.status === 404) return;
  const t = await res.text().catch(() => "");
  console.error(
    JSON.stringify({
      msg: "discord_role_remove_http",
      status: res.status,
      snippet: t.slice(0, 200),
    }),
  );
}

export type DiscordLinkEnv = {
  DB: D1Database;
  SITE_URL?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_GUILD_ID?: string;
  DISCORD_VERIFIED_ROLE_ID?: string;
  DISCORD_LIFETIME_MEMBER_ROLE_ID?: string;
  DISCORD_MONTHLY_MEMBER_ROLE_ID?: string;
  DISCORD_DEVELOPER_ROLE_ID?: string;
  /** If set, bot posts a short notice here after a successful link (only `<@userId>` is mentionable). */
  DISCORD_VERIFIED_CHAT_CHANNEL_ID?: string;
};

function cleanBotToken(env: { DISCORD_BOT_TOKEN?: string }): string {
  return String(env.DISCORD_BOT_TOKEN || "").replace(/^bot\s+/i, "").trim();
}

async function discordBotPutRole(token: string, guildId: string, userId: string, roleId: string): Promise<{
  ok: boolean;
  status: number;
}> {
  const path = `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`;
  const res = await fetch(`https://discord.com/api/v10${path.startsWith("/") ? path : `/${path}`}`, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${token.trim()}`,
      "User-Agent": "RootRecordAccountWorker (discord link)",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
  if (res.status === 204) return { ok: true, status: 204 };
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error(
      JSON.stringify({
        msg: "discord_role_assign_http",
        status: res.status,
        snippet: t.slice(0, 200),
        path,
      }),
    );
  }
  return { ok: false, status: res.status };
}

async function discordMemberRoles(
  token: string,
  guildId: string,
  userId: string,
): Promise<Set<string>> {
  const res = await fetch(
    `https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`,
    {
      headers: {
        Authorization: `Bot ${token.trim()}`,
        "User-Agent": "RootRecordAccountWorker (discord member roles)",
      },
    },
  );
  if (!res.ok) return new Set();
  const member = (await res.json().catch(() => ({}))) as { roles?: unknown };
  return new Set(Array.isArray(member.roles) ? member.roles.map((r) => String(r)) : []);
}

async function discordBotPostVerifyChatNotice(
  token: string,
  channelId: string,
  discordUserId: string,
): Promise<void> {
  const content = `<@${discordUserId}> RootRecord account verified — welcome!`;
  const res = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token.trim()}`,
      "User-Agent": "RootRecordAccountWorker (discord verify chat)",
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [], users: [discordUserId] },
    }),
  });
  if (res.ok) return;
  const t = await res.text().catch(() => "");
  console.error(
    JSON.stringify({
      msg: "discord_verify_chat_post",
      status: res.status,
      snippet: t.slice(0, 240),
      channelId,
    }),
  );
}

export async function discordLinkStart(params: {
  request: Request;
  env: DiscordLinkEnv;
  accountId: string;
}): Promise<Response> {
  const reqUrl = new URL(params.request.url);
  const cid = String(params.env.DISCORD_CLIENT_ID || "").trim();
  const secret = String(params.env.DISCORD_CLIENT_SECRET || "").trim();
  if (!cid || cid.length < 6 || !secret || secret.length < 10) {
    return json({ detail: "Discord linking is not configured yet." }, 503);
  }

  const flow = String(reqUrl.searchParams.get("flow") || "").trim().toLowerCase();
  const state = (flow === "verify" ? VERIFY_STATE_PREFIX : "") + randState();
  const created_at = nowIso();
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await params.env.DB.prepare(
    "INSERT OR REPLACE INTO discord_oauth_states (state, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(state, params.accountId, created_at, expires_at)
    .run();

  const redirectUri = `${reqUrl.origin}/v1/discord/oauth/callback`;
  const authorize = new URL("https://discord.com/api/oauth2/authorize");
  authorize.searchParams.set("client_id", cid);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "identify email");
  authorize.searchParams.set("state", state);

  if (reqUrl.searchParams.get("json") === "1") {
    return json({ ok: true, url: authorize.toString() }, 200);
  }
  return Response.redirect(authorize.toString(), 302);
}

async function findDiscordLinkByUserId(
  db: D1Database,
  discordUserId: string,
): Promise<{ account_id: string; email: string } | null> {
  const row = await db
    .prepare("SELECT account_id, email FROM discord_account_links WHERE discord_user_id = ?")
    .bind(discordUserId)
    .first<{ account_id: string; email: string }>();
  if (!row?.account_id) return null;
  return { account_id: row.account_id, email: row.email };
}

async function assignVerifiedRole(
  env: DiscordLinkEnv,
  discord_user_id: string,
  ctx?: ExecutionContext,
): Promise<string | null> {
  const bot = cleanBotToken(env);
  const guildId = String(env.DISCORD_GUILD_ID || "").trim();
  const roleId = String(env.DISCORD_VERIFIED_ROLE_ID || "").trim();
  if (!guildId || !roleId) return null;
  if (!bot) return "role_config";
  const put = await discordBotPutRole(bot, guildId, discord_user_id, roleId);
  if (!put.ok) {
    return put.status === 404 ? "role_join" : put.status === 403 ? "role_forbidden" : "role_error";
  }
  const chatId = String(env.DISCORD_VERIFIED_CHAT_CHANNEL_ID || "").trim();
  if (chatId) {
    const p = discordBotPostVerifyChatNotice(bot, chatId, discord_user_id);
    if (ctx) ctx.waitUntil(p);
    else await p;
  }
  return null;
}

async function syncMemberRoles(
  env: DiscordLinkEnv,
  discord_user_id: string,
  email: string,
): Promise<string | null> {
  const bot = cleanBotToken(env);
  const guildId = String(env.DISCORD_GUILD_ID || "").trim();
  const lifetimeRoleId = String(env.DISCORD_LIFETIME_MEMBER_ROLE_ID || "").trim();
  const monthlyRoleId = String(env.DISCORD_MONTHLY_MEMBER_ROLE_ID || "").trim();
  if (!bot || !guildId || (!lifetimeRoleId && !monthlyRoleId)) return null;

  const access = await readUserAccountAccessFlags(env.DB, email).catch(() => null);
  const life = Boolean(access?.life_member);
  const monthly = !life && Boolean(access?.pro_unlocked);
  try {
    if (lifetimeRoleId) {
      if (life) await discordBotPutRole(bot, guildId, discord_user_id, lifetimeRoleId);
      else await discordBotDeleteRole(bot, guildId, discord_user_id, lifetimeRoleId);
    }
    if (monthlyRoleId) {
      if (monthly) await discordBotPutRole(bot, guildId, discord_user_id, monthlyRoleId);
      else await discordBotDeleteRole(bot, guildId, discord_user_id, monthlyRoleId);
    }
  } catch {
    return "member_role_error";
  }
  return null;
}

export async function discordUserHasConfiguredRole(
  env: DiscordLinkEnv,
  discordUserId: string | null | undefined,
  roleId: string | null | undefined,
): Promise<boolean> {
  const bot = cleanBotToken(env);
  const guildId = String(env.DISCORD_GUILD_ID || "").trim();
  const userId = String(discordUserId || "").trim();
  const rid = String(roleId || "").trim();
  if (!bot || !guildId || !userId || !rid) return false;
  const roles = await discordMemberRoles(bot, guildId, userId).catch(() => new Set<string>());
  return roles.has(rid);
}

async function saveDiscordLink(
  db: D1Database,
  acct: { id: string; email: string },
  discord: {
    discord_user_id: string;
    discord_username: string | null;
    discord_global_name: string | null;
    discord_email: string | null;
  },
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO discord_account_links (
         account_id, email, discord_user_id, discord_username, discord_global_name, discord_email, linked_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         email = excluded.email,
         discord_user_id = excluded.discord_user_id,
         discord_username = excluded.discord_username,
         discord_global_name = excluded.discord_global_name,
         discord_email = excluded.discord_email,
         updated_at = excluded.updated_at`,
    )
    .bind(
      acct.id,
      acct.email.trim().toLowerCase(),
      discord.discord_user_id,
      discord.discord_username,
      discord.discord_global_name,
      discord.discord_email,
      now,
      now,
    )
    .run();
}

/** One Discord user -> one portal account; extra emails sign in via login aliases. */
async function mergeDuplicateEmailOntoDiscordOwner(params: {
  env: DiscordLinkEnv;
  canonicalAccountId: string;
  duplicateAccount: { id: string; email: string; password_hash: string; salt: string };
}): Promise<void> {
  const dupEmail = params.duplicateAccount.email.trim().toLowerCase();
  const canonId = params.canonicalAccountId.trim();
  if (!dupEmail || !canonId || params.duplicateAccount.id === canonId) return;

  await attachLoginEmailAlias(
    params.env.DB,
    canonId,
    dupEmail,
    params.duplicateAccount.password_hash,
    params.duplicateAccount.salt,
  );

  await deleteMergedDuplicateAccount(params.env.DB, params.duplicateAccount.id, dupEmail);
}

export async function discordLinkCallback(params: {
  request: Request;
  env: DiscordLinkEnv;
  ctx?: ExecutionContext;
}): Promise<Response> {
  const url = new URL(params.request.url);
  const code = String(url.searchParams.get("code") || "").trim();
  const state = String(url.searchParams.get("state") || "").trim();
  const err = String(url.searchParams.get("error") || "").trim();
  const site = String(params.env.SITE_URL || "https://rootrecord.cloud").trim().replace(/\/+$/, "");

  try {
    if (err) return Response.redirect(returnPageUrl(site, state, "discord=error"), 302);
    if (!code || !state) return Response.redirect(returnPageUrl(site, state || "", "discord=error"), 302);

    const row = await params.env.DB.prepare(
      "SELECT account_id, expires_at FROM discord_oauth_states WHERE state = ?",
    )
      .bind(state)
      .first<{ account_id: string; expires_at: string }>();

    await params.env.DB.prepare("DELETE FROM discord_oauth_states WHERE state = ?").bind(state).run();

    if (!row?.account_id) return Response.redirect(returnPageUrl(site, state, "discord=expired"), 302);
    const expMs = Date.parse(row.expires_at || "");
    if (!Number.isFinite(expMs) || expMs < Date.now()) {
      return Response.redirect(returnPageUrl(site, state, "discord=expired"), 302);
    }

    const cid = String(params.env.DISCORD_CLIENT_ID || "").trim();
    const secret = String(params.env.DISCORD_CLIENT_SECRET || "").trim();
    if (!cid || !secret) return Response.redirect(returnPageUrl(site, state, "discord=error"), 302);

    const redirectUri = `${url.origin}/v1/discord/oauth/callback`;
    const tokenBody = new URLSearchParams();
    tokenBody.set("client_id", cid);
    tokenBody.set("client_secret", secret);
    tokenBody.set("grant_type", "authorization_code");
    tokenBody.set("code", code);
    tokenBody.set("redirect_uri", redirectUri);

    const tok = await stripeFormPost("https://discord.com/api/oauth2/token", tokenBody);
    const accessToken = typeof tok?.access_token === "string" ? tok.access_token : "";
    if (!accessToken) return Response.redirect(returnPageUrl(site, state, "discord=error"), 302);

    const me = await discordGetMe(accessToken);
    const discord_user_id = typeof me?.id === "string" ? me.id : "";
    const discord_username = typeof me?.username === "string" ? me.username : null;
    const discord_global_name = typeof me?.global_name === "string" ? me.global_name : null;
    const discord_email = typeof me?.email === "string" ? me.email : null;
    if (!discord_user_id) return Response.redirect(returnPageUrl(site, state, "discord=error"), 302);

    const acct = await params.env.DB.prepare(
      "SELECT id, email, password_hash, salt FROM license_accounts WHERE id = ?",
    )
      .bind(row.account_id)
      .first<{ id: string; email: string; password_hash: string; salt: string }>();
    if (!acct?.email) return Response.redirect(returnPageUrl(site, state, "discord=error"), 302);

    const existing = await findDiscordLinkByUserId(params.env.DB, discord_user_id);
    let merged = false;

    if (existing && existing.account_id !== acct.id) {
      await mergeDuplicateEmailOntoDiscordOwner({
        env: params.env,
        canonicalAccountId: existing.account_id,
        duplicateAccount: acct,
      });
      merged = true;
      const canon = await params.env.DB.prepare("SELECT id, email FROM license_accounts WHERE id = ?")
        .bind(existing.account_id)
        .first<{ id: string; email: string }>();
      if (canon?.email) {
        await saveDiscordLink(params.env.DB, canon, {
          discord_user_id,
          discord_username,
          discord_global_name,
          discord_email,
        });
      }
    } else {
      await saveDiscordLink(params.env.DB, acct, {
        discord_user_id,
        discord_username,
        discord_global_name,
        discord_email,
      });
    }

    const roleCode = await assignVerifiedRole(params.env, discord_user_id, params.ctx);
    const memberRoleCode = await syncMemberRoles(
      params.env,
      discord_user_id,
      merged && existing ? existing.email : acct.email,
    );
    const verifiedAccountId = merged && existing ? existing.account_id : acct.id;
    await markRecentAccountVerification(params.env.DB, verifiedAccountId, "discord").catch(() => {});
    const statusCode = roleCode || memberRoleCode;

    if (merged) {
      const q = statusCode ? `discord=merged&role=${statusCode}` : "discord=merged";
      return Response.redirect(returnPageUrl(site, state, q), 302);
    }
    if (statusCode) {
      return Response.redirect(returnPageUrl(site, state, `discord=linked&role=${statusCode}`), 302);
    }
    return Response.redirect(returnPageUrl(site, state, "discord=linked"), 302);
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error(
      JSON.stringify({
        msg: "discord_oauth_callback_failed",
        error: msg.slice(0, 500),
        state: state.slice(0, 80),
      }),
    );
    return Response.redirect(returnPageUrl(site, state, "discord=error"), 302);
  }
}

export async function discordUnlink(params: {
  env: DiscordLinkEnv;
  accountId: string;
}): Promise<Response> {
  const row = await params.env.DB.prepare(
    "SELECT discord_user_id FROM discord_account_links WHERE account_id = ?",
  )
    .bind(params.accountId)
    .first<{ discord_user_id: string }>();

  if (!row?.discord_user_id) {
    return json({ ok: true, linked: false }, 200);
  }

  const bot = cleanBotToken(params.env);
  const guildId = String(params.env.DISCORD_GUILD_ID || "").trim();
  const roleIds = [
    params.env.DISCORD_VERIFIED_ROLE_ID,
    params.env.DISCORD_LIFETIME_MEMBER_ROLE_ID,
    params.env.DISCORD_MONTHLY_MEMBER_ROLE_ID,
  ].map((x) => String(x || "").trim()).filter(Boolean);
  if (bot && guildId) {
    for (const roleId of roleIds) await discordBotDeleteRole(bot, guildId, row.discord_user_id, roleId);
  }

  await params.env.DB.prepare("DELETE FROM discord_account_links WHERE account_id = ?")
    .bind(params.accountId)
    .run();

  return json({ ok: true, linked: false }, 200);
}

export async function readDiscordLink(db: D1Database, accountId: string): Promise<{
  linked: boolean;
  discord_user_id: string | null;
  discord_username: string | null;
  discord_global_name: string | null;
} | null> {
  const row = await db
    .prepare(
      "SELECT discord_user_id, discord_username, discord_global_name FROM discord_account_links WHERE account_id = ?",
    )
    .bind(accountId)
    .first<{ discord_user_id: string; discord_username: string | null; discord_global_name: string | null }>();
  if (!row?.discord_user_id) return { linked: false, discord_user_id: null, discord_username: null, discord_global_name: null };
  return {
    linked: true,
    discord_user_id: row.discord_user_id,
    discord_username: row.discord_username || null,
    discord_global_name: row.discord_global_name || null,
  };
}


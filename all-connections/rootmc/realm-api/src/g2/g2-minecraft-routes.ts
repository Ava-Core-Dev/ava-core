import { json } from "../cors";
import type { AuthEnv } from "../primary-auth";
import { mintAuthToken, sessionFromRequest } from "../primary-auth";
import { publicStatsPageUrl, record, str } from "../realm-lib";
import { verifyUrl } from "../rootmc-site";
import { validateG2ServerAuth } from "./g2-auth";
import { msToIso, nowMs, type G2Env } from "./g2-db";
import {
  g2CompleteAppLinkLogin,
  g2ConsumeLinkCode,
  g2LoadLinkCode,
  g2ProvisionMinecraftPlayerAccount,
  g2UpsertMinecraftLink,
  g2ValidateLinkCodeRow,
} from "./g2-link-store";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;
const CODE_TTL_MS = 15 * 60 * 1000;

function randomCode(): string {
  const bytes = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return out;
}

export async function handleG2MinecraftRoutes(
  request: Request,
  env: G2Env,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/realm/minecraft")) return null;
  const rest = subpath.slice("/realm/minecraft".length) || "/";
  const verifyBase = verifyUrl(env);

  if (method === "POST" && rest === "/link/start") {
    const server = await validateG2ServerAuth(env, request);
    if (server instanceof Response) return server;

    let body: { uuid?: string; username?: string } = {};
    try {
      body = record(JSON.parse(await request.text()));
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }

    const uuid = str(body.uuid).toLowerCase();
    const username = str(body.username);
    if (!uuid || !/^[0-9a-f-]{36}$/.test(uuid)) {
      return json({ detail: "Valid minecraft uuid required." }, 400);
    }
    if (!username || username.length > 16) {
      return json({ detail: "Valid minecraft username required." }, 400);
    }

    const now = nowMs();
    const expiresAtMs = now + CODE_TTL_MS;

    let code = randomCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await env.DB.prepare("SELECT code FROM g2_link_code WHERE code = ? LIMIT 1")
        .bind(code)
        .first();
      if (!existing) break;
      code = randomCode();
    }

    await env.DB.prepare("DELETE FROM g2_link_code WHERE minecraft_uuid = ? AND consumed_at_ms IS NULL")
      .bind(uuid)
      .run();

    await env.DB.prepare(
      `INSERT INTO g2_link_code
         (code, minecraft_uuid, minecraft_username, realm_id, created_at_ms, expires_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(code, uuid, username, server.realmId, now, expiresAtMs)
      .run();

    const expiresAt = msToIso(expiresAtMs);
    return json({
      code,
      verify_url: `${verifyBase}?code=${encodeURIComponent(code)}`,
      expires_at: expiresAt,
      minecraft_username: username,
    });
  }

  if (method === "GET" && rest === "/link/preview") {
    const url = new URL(request.url);
    const code = str(url.searchParams.get("code")).toUpperCase();
    if (!code) return json({ detail: "code query param required." }, 400);

    const row = await env.DB.prepare(
      `SELECT code, minecraft_username, expires_at_ms, consumed_at_ms
       FROM g2_link_code WHERE code = ? LIMIT 1`,
    )
      .bind(code)
      .first<Record<string, unknown>>();

    if (!row) return json({ valid: false, reason: "not_found" });
    if (row.consumed_at_ms) return json({ valid: false, reason: "consumed" });
    if (Number(row.expires_at_ms) < nowMs()) return json({ valid: false, reason: "expired" });

    return json({
      valid: true,
      code: row.code,
      minecraft_username: row.minecraft_username,
      expires_at: msToIso(Number(row.expires_at_ms)),
    });
  }

  if (method === "POST" && rest === "/link/app/complete") {
    let body: { code?: string } = {};
    try {
      body = record(JSON.parse(await request.text()));
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }
    return g2CompleteAppLinkLogin(env, str(body.code));
  }

  if (method === "POST" && rest === "/link/complete") {
    let body: { code?: string } = {};
    try {
      body = record(JSON.parse(await request.text()));
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }

    const code = str(body.code).toUpperCase();
    if (!code) return json({ detail: "Verification code required." }, 400);

    const linkRow = g2ValidateLinkCodeRow(await g2LoadLinkCode(env.DB, code));
    if (linkRow instanceof Response) return linkRow;

    const session = await sessionFromRequest(env, request);
    let accountId: string;
    let email: string;
    let provisioned = false;

    if (session?.accountId && session.email) {
      accountId = session.accountId;
      email = session.email;
    } else {
      const account = await g2ProvisionMinecraftPlayerAccount(
        env.DB,
        linkRow.minecraft_uuid,
        linkRow.minecraft_username,
      );
      accountId = account.accountId;
      email = account.email;
      provisioned = account.created;
    }

    await g2UpsertMinecraftLink(
      env.DB,
      linkRow.minecraft_uuid,
      linkRow.minecraft_username,
      accountId,
      email,
    );
    await g2ConsumeLinkCode(env.DB, code, accountId);

    const token = provisioned ? await mintAuthToken(env, email, accountId) : null;

    return json({
      ok: true,
      minecraft_uuid: linkRow.minecraft_uuid,
      minecraft_username: linkRow.minecraft_username,
      account_id: accountId,
      provisioned,
      token: token || undefined,
    });
  }

  if (method === "GET" && rest === "/link/status") {
    const server = await validateG2ServerAuth(env, request);
    if (server instanceof Response) return server;

    const url = new URL(request.url);
    const uuid = str(url.searchParams.get("uuid")).toLowerCase();
    if (!uuid) return json({ detail: "uuid query param required." }, 400);

    const row = await env.DB.prepare(
      `SELECT minecraft_uuid, minecraft_username, account_id, email, verified_at_ms, updated_at_ms
       FROM g2_minecraft_link WHERE minecraft_uuid = ? LIMIT 1`,
    )
      .bind(uuid)
      .first<Record<string, unknown>>();

    if (!row) {
      return json({
        linked: false,
        minecraft_uuid: uuid,
        stats_url: publicStatsPageUrl(uuid),
        discord_linked: false,
        verify_url: verifyBase,
      });
    }

    const accountId = str(row.account_id);
    const discordRow = accountId
      ? await env.DB.prepare(
          `SELECT discord_user_id, discord_username, discord_global_name
           FROM g2_discord_link WHERE account_id = ? LIMIT 1`,
        )
          .bind(accountId)
          .first<{
            discord_user_id: string;
            discord_username: string | null;
            discord_global_name: string | null;
          }>()
      : null;
    const discordUserId = str(discordRow?.discord_user_id);
    const discordLinked = !!discordUserId;

    return json({
      linked: true,
      minecraft_uuid: row.minecraft_uuid,
      minecraft_username: row.minecraft_username,
      account_id: row.account_id,
      email: row.email,
      verified_at: msToIso(Number(row.verified_at_ms)),
      updated_at: msToIso(Number(row.updated_at_ms)),
      stats_url: publicStatsPageUrl(str(row.minecraft_uuid) || uuid),
      discord_linked: discordLinked,
      discord_user_id: discordLinked ? discordUserId : undefined,
      discord_username: discordLinked
        ? str(discordRow?.discord_global_name) || str(discordRow?.discord_username) || undefined
        : undefined,
      discord_profile_url: discordLinked ? `https://discord.com/users/${discordUserId}` : undefined,
      verify_url: verifyBase,
      pro_unlocked: false,
      life_member: false,
      blueprint_eligible: false,
    });
  }

  if (method === "GET" && rest === "/governance/voting-power") {
    const server = await validateG2ServerAuth(env, request);
    if (server instanceof Response) return server;
    // Votes + playtime power are shared — Gen1 public governance API (same points both servers).
    const url = new URL(request.url);
    const uuid = str(url.searchParams.get("uuid")).toLowerCase();
    if (!uuid) return json({ detail: "uuid query param required." }, 400);
    try {
      const publicTarget =
        `https://api.rootmc.info/api/governance/voting-power?uuid=${encodeURIComponent(uuid)}`;
      const upstream = await fetch(publicTarget, { cache: "no-store" });
      if (upstream.ok) {
        const body = await upstream.arrayBuffer();
        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }
    } catch {
      /* fall through */
    }
    const guildId = str(env.DISCORD_ROOTMC_GUILD_ID) || "1516108585740800042";
    return json({
      ok: true,
      eligible: false,
      share_percent: 0,
      playtime_seconds: 0,
      net_worth: 0,
      site_multiplier: 1,
      total_votes: 0,
      vote_points: 1,
      sites_voted: [],
      voting_channel_url: `https://discord.com/channels/${guildId}`,
      constitution_url: "https://rootmc.net/wiki/constitution/#governance-voting",
      summary: null,
      shared_via: "gen1_proxy_unavailable",
    });
  }

  if (method === "GET" && rest === "/sync") {
    const server = await validateG2ServerAuth(env, request);
    if (server instanceof Response) return server;

    const url = new URL(request.url);
    const since = str(url.searchParams.get("since"));
    const sinceMs = since ? Date.parse(since) : 0;

    let stmt;
    if (since && Number.isFinite(sinceMs) && sinceMs > 0) {
      stmt = env.DB.prepare(
        `SELECT minecraft_uuid, minecraft_username, account_id, email, verified_at_ms, updated_at_ms
         FROM g2_minecraft_link
         WHERE updated_at_ms >= ?
         ORDER BY updated_at_ms ASC`,
      ).bind(sinceMs);
    } else {
      stmt = env.DB.prepare(
        `SELECT minecraft_uuid, minecraft_username, account_id, email, verified_at_ms, updated_at_ms
         FROM g2_minecraft_link
         ORDER BY updated_at_ms ASC`,
      );
    }

    const { results } = await stmt.all<Record<string, unknown>>();
    const players = (results || []).map((row) => ({
      minecraft_uuid: row.minecraft_uuid,
      minecraft_username: row.minecraft_username,
      account_id: row.account_id,
      email: row.email,
      verified_at: msToIso(Number(row.verified_at_ms)),
      updated_at: msToIso(Number(row.updated_at_ms)),
    }));

    return json({
      players,
      synced_at: msToIso(nowMs()),
      server_id: server.realmId,
    });
  }

  return null;
}

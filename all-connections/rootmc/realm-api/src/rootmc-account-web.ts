/**
 * Player web account — Discord Login/Register + My Stats session.
 * Reuses Discord register OAuth (license_accounts, no Minecraft required).
 */

import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import type { AuthEnv } from "./primary-auth";
import { sessionFromRequest } from "./primary-auth";
import {
  startRootMcDiscordRegister,
  type RootMcDiscordLinkEnv,
} from "./discord-rootmc-player-link";
import { buildClearSessionCookieHeader, ssoCookieDomainForApiHost } from "./web-sso";
import { playerStatsBundleForUuid } from "./rootstat-minecraft";

export type AccountWebEnv = RootMcDiscordLinkEnv &
  AuthEnv & {
    SITE_URL?: string;
    DB: D1Database;
  };

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function siteBase(env: AccountWebEnv): string {
  return str(env.SITE_URL) || "https://rootmc.net";
}

function ssoClearCookieLine(request: Request): string | undefined {
  const dom = ssoCookieDomainForApiHost(new URL(request.url).hostname);
  if (!dom) return undefined;
  return buildClearSessionCookieHeader(dom);
}

export async function handleAccountWebRoutes(
  request: Request,
  env: AccountWebEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (!sub.startsWith("account/") && sub !== "account") return null;
  const rest = sub.replace(/^account\/?/, "").replace(/^\//, "");

  if (method === "POST" && (rest === "auth/discord/start" || rest === "auth/discord/start/")) {
    let body: { return_to?: string; mobile_app?: boolean } = {};
    try {
      body = JSON.parse(await request.text()) as { return_to?: string; mobile_app?: boolean };
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }
    return startRootMcDiscordRegister(
      env,
      str(body.return_to) || "/my-stats/",
      body.mobile_app === true,
    );
  }

  if (method === "POST" && (rest === "auth/logout" || rest === "auth/logout/")) {
    const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
    const clear = ssoClearCookieLine(request);
    if (clear) headers.set("Set-Cookie", clear);
    return new Response(JSON.stringify({ ok: true, signed_in: false }), { status: 200, headers });
  }

  if (method === "GET" && (rest === "me" || rest === "me/")) {
    const auth = await sessionFromRequest(env, request);
    if (!auth?.accountId) {
      return json({
        ok: true,
        signed_in: false,
        minecraft_linked: false,
        login_url: `${siteBase(env)}/login/`,
        verify_url: `${siteBase(env)}/verify/`,
        my_stats_url: `${siteBase(env)}/my-stats/`,
      });
    }

    const discord = await env.DB.prepare(
      `SELECT discord_user_id, discord_username, discord_global_name, discord_email
       FROM discord_account_links WHERE account_id = ? LIMIT 1`,
    )
      .bind(auth.accountId)
      .first<{
        discord_user_id: string;
        discord_username: string | null;
        discord_global_name: string | null;
        discord_email: string | null;
      }>();

    const mc = await env.DB.prepare(
      `SELECT minecraft_uuid, minecraft_username FROM rootstat_minecraft_links
       WHERE account_id = ? LIMIT 1`,
    )
      .bind(auth.accountId)
      .first<{ minecraft_uuid: string | null; minecraft_username: string | null }>();

    const minecraftLinked = Boolean(str(mc?.minecraft_uuid));
    const minecraftUuid = minecraftLinked ? str(mc?.minecraft_uuid) || null : null;
    const minecraftUsername = minecraftLinked ? mc?.minecraft_username || null : null;

    let stats: Record<string, unknown> | null = null;
    if (minecraftUuid) {
      try {
        stats = await playerStatsBundleForUuid(env.DB, minecraftUuid);
      } catch (e) {
        console.error(
          "rootmc_account_me_stats_failed",
          e instanceof Error ? e.message : String(e),
        );
        stats = null;
      }
    }

    return json({
      ok: true,
      signed_in: true,
      account_id: auth.accountId,
      email: auth.email || null,
      discord_user_id: discord?.discord_user_id || null,
      discord_username: discord?.discord_username || null,
      discord_global_name: discord?.discord_global_name || null,
      discord_email: discord?.discord_email || null,
      minecraft_linked: minecraftLinked,
      minecraft_uuid: minecraftUuid,
      minecraft_username: minecraftUsername,
      stats,
      verify_url: `${siteBase(env)}/verify/`,
      my_stats_url: `${siteBase(env)}/my-stats/`,
      login_url: `${siteBase(env)}/login/`,
    });
  }

  return null;
}

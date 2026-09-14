/**
 * Developer portal API — developer.rootmc.net /developer/*
 * Discord register/sign-in + free account keys for Root-Core server linking.
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
import { requireSignedInAccount } from "./realm-lib";
import {
  createAccountKey,
  listAccountKeys,
  listOwnedServers,
  listOwnedServersWithHealth,
  getOwnedServerWithHealth,
  registerDeveloperServer,
  renameAccountKey,
  renameOwnedServer,
  revokeAccountKey,
  unlinkOwnedServer,
  purgeOwnedServersForDeletedKeys,
} from "./rootmc-developer-keys";
import { setOwnedServerMesh } from "./rootmc-transfer-mesh";

export type DeveloperWebEnv = RootMcDiscordLinkEnv &
  AuthEnv & {
    SITE_URL?: string;
    DB: D1Database;
  };

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function ssoClearCookieLine(request: Request): string | undefined {
  const dom = ssoCookieDomainForApiHost(new URL(request.url).hostname);
  if (!dom) return undefined;
  return buildClearSessionCookieHeader(dom);
}

export async function handleDeveloperWebRoutes(
  request: Request,
  env: DeveloperWebEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  const rest = sub.replace(/^developer\/?/, "").replace(/^\//, "");

  if (method === "POST" && (rest === "auth/discord/start" || rest === "auth/discord/start/")) {
    let body: { return_to?: string; mobile_app?: boolean } = {};
    try {
      body = JSON.parse(await request.text()) as { return_to?: string; mobile_app?: boolean };
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }
    return startRootMcDiscordRegister(
      env,
      str(body.return_to) || "/developer/",
      body.mobile_app === true,
    );
  }

  if (method === "POST" && (rest === "auth/logout" || rest === "auth/logout/")) {
    const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
    const clear = ssoClearCookieLine(request);
    if (clear) headers.set("Set-Cookie", clear);
    return new Response(JSON.stringify({ ok: true, signed_in: false }), { status: 200, headers });
  }

  if (method === "POST" && (rest === "keys" || rest === "keys/")) {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    let body: { label?: string } = {};
    try {
      body = JSON.parse(await request.text()) as { label?: string };
    } catch {
      body = {};
    }
    const created = await createAccountKey(env.DB, auth.accountId, body.label);
    if ("error" in created) return json({ detail: created.error }, created.status);
    return json({
      ok: true,
      id: created.id,
      account_key: created.account_key,
      label: created.label,
      created_at: created.created_at,
      note:
        "Copy server-name + product-key into plugins/RootMC/license.yml. The product-key is shown only once.",
    });
  }

  if (method === "POST" && (rest === "keys/rename" || rest === "keys/rename/")) {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    let body: { id?: string; key_id?: string; label?: string; server_name?: string } = {};
    try {
      body = JSON.parse(await request.text()) as {
        id?: string;
        key_id?: string;
        label?: string;
        server_name?: string;
      };
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }
    const renamed = await renameAccountKey(
      env.DB,
      auth.accountId,
      str(body.id || body.key_id),
      str(body.label || body.server_name),
    );
    if ("error" in renamed) return json({ detail: renamed.error }, renamed.status);
    return json({ ok: true, id: renamed.id, label: renamed.label, server_name: renamed.label });
  }

  if (
    method === "POST"
    && (rest === "keys/delete" || rest === "keys/delete/" || rest === "keys/revoke" || rest === "keys/revoke/")
  ) {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    let body: { id?: string; key_id?: string } = {};
    try {
      body = JSON.parse(await request.text()) as { id?: string; key_id?: string };
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }
    const keyId = str(body.id || body.key_id);
    const revoked = await revokeAccountKey(env.DB, auth.accountId, keyId);
    if ("error" in revoked) return json({ detail: revoked.error }, revoked.status);
    return json({
      ok: true,
      id: revoked.id,
      deleted: true,
      servers_deleted: revoked.servers_deleted,
      note:
        revoked.servers_deleted > 0
          ? `Account key deleted. Removed ${revoked.servers_deleted} linked server(s) from My Servers. Remove the key from root-core.yml on any live Paper host.`
          : "Account key deleted. Remove it from root-core.yml on any server that still has it.",
    });
  }

  if (method === "DELETE" && rest.startsWith("keys/")) {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    const keyId = str(rest.slice("keys/".length).replace(/\/+$/, ""));
    const revoked = await revokeAccountKey(env.DB, auth.accountId, keyId);
    if ("error" in revoked) return json({ detail: revoked.error }, revoked.status);
    return json({
      ok: true,
      id: revoked.id,
      deleted: true,
      servers_deleted: revoked.servers_deleted,
      note:
        revoked.servers_deleted > 0
          ? `Account key deleted. Removed ${revoked.servers_deleted} linked server(s) from My Servers. Remove the key from root-core.yml on any live Paper host.`
          : "Account key deleted. Remove it from root-core.yml on any server that still has it.",
    });
  }

  if (method === "POST" && (rest === "servers" || rest === "servers/")) {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    let body: { server_name?: string; product_key_id?: string } = {};
    try {
      body = JSON.parse(await request.text()) as { server_name?: string; product_key_id?: string };
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }
    const created = await registerDeveloperServer(env.DB, auth.accountId, body);
    if ("error" in created) return json({ detail: created.error }, created.status);
    return json({ ok: true, ...created });
  }

  if (method === "GET" && (rest === "servers" || rest === "servers/")) {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    try {
      await purgeOwnedServersForDeletedKeys(env.DB, auth.accountId);
    } catch (e) {
      console.error("rootmc_developer_servers_purge", e);
    }
    let servers: Awaited<ReturnType<typeof listOwnedServersWithHealth>> = [];
    try {
      servers = await listOwnedServersWithHealth(env.DB, auth.accountId);
    } catch (e) {
      console.error("rootmc_developer_servers_health", e);
      servers = [];
    }
    const summary = {
      total: servers.length,
      online: servers.filter((s) => s.connection === "online").length,
      degraded: servers.filter((s) => s.connection === "degraded").length,
      offline: servers.filter((s) => s.connection === "offline" || s.connection === "never").length,
    };
    return json({
      ok: true,
      signed_in: true,
      summary,
      servers,
      thresholds: {
        online_seconds: 600,
        degraded_seconds: 3600,
        note: "Online = Root-Core license presence within 10m. Degraded = within 1h. Else offline.",
      },
    });
  }

  const serverGetMatch = rest.match(/^servers\/([^/]+)\/?$/);
  if (method === "GET" && serverGetMatch) {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    const serverId = decodeURIComponent(serverGetMatch[1] || "").trim();
    if (!serverId || serverId === "rename" || serverId === "unlink") {
      return json({ detail: "server_id required" }, 400);
    }
    const server = await getOwnedServerWithHealth(env.DB, auth.accountId, serverId);
    if (!server) return json({ detail: "Server not found." }, 404);
    return json({
      ok: true,
      signed_in: true,
      server,
      thresholds: {
        online_seconds: 600,
        degraded_seconds: 3600,
        note: "Online = Root-Core license presence within 10m. Degraded = within 1h. Else offline.",
      },
    });
  }

  if (method === "POST" && (rest === "servers/rename" || rest === "servers/rename/")) {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    let body: { server_id?: string; id?: string; server_name?: string; label?: string } = {};
    try {
      body = JSON.parse(await request.text()) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }
    const renamed = await renameOwnedServer(
      env.DB,
      auth.accountId,
      str(body.server_id || body.id),
      str(body.server_name || body.label),
    );
    if ("error" in renamed) return json({ detail: renamed.error }, renamed.status);
    return json({
      ok: true,
      server_id: renamed.server_id,
      server_name: renamed.server_name,
      note: "Portal label updated. Match server-name in root-core.yml on the Paper host for consistency.",
    });
  }

  if (method === "POST" && (rest === "servers/unlink" || rest === "servers/unlink/")) {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    let body: { server_id?: string; id?: string } = {};
    try {
      body = JSON.parse(await request.text()) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }
    const unlinked = await unlinkOwnedServer(env.DB, auth.accountId, str(body.server_id || body.id));
    if ("error" in unlinked) return json({ detail: unlinked.error }, unlinked.status);
    return json({
      ok: true,
      server_id: unlinked.server_id,
      unlinked: true,
      note: "Removed from My Servers. Product key is unchanged. Root-Core bind/presence can re-register this host.",
    });
  }

  if (method === "POST" && (rest === "servers/mesh" || rest === "servers/mesh/")) {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    let body: {
      server_id?: string;
      id?: string;
      enabled?: boolean;
      mesh_enabled?: boolean;
      address?: string;
      server_address?: string;
    } = {};
    try {
      body = JSON.parse(await request.text()) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }
    const meshOn = body.enabled === true || body.mesh_enabled === true;
    const addressRaw = body.address ?? body.server_address;
    const updated = await setOwnedServerMesh(
      env.DB,
      auth.accountId,
      str(body.server_id || body.id),
      meshOn,
      addressRaw === undefined ? undefined : str(addressRaw),
    );
    if ("error" in updated) return json({ detail: updated.error }, updated.status);
    return json({
      ok: true,
      server_id: updated.server_id,
      mesh_enabled: updated.mesh_enabled,
      server_address: updated.server_address,
      transfer_slug: updated.transfer_slug,
      note: updated.mesh_enabled
        ? "Server is on the RootMC /goto transfer mesh. Players use /goto " +
          (updated.transfer_slug || "slug") +
          " from other meshed hosts."
        : "Server removed from the /goto transfer mesh. License bind/presence unchanged.",
    });
  }

  if (method === "GET" && (rest === "me" || rest === "me/")) {
    const auth = await sessionFromRequest(env, request);
    if (!auth?.accountId) {
      return json({
        ok: true,
        signed_in: false,
        developer: true,
        register_url: "/developer/register/",
        login_url: "/developer/login/",
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

    let displayName: string | null = null;
    try {
      const row = await env.DB.prepare(
        "SELECT public_display_name FROM license_accounts WHERE id = ? LIMIT 1",
      )
        .bind(auth.accountId)
        .first<{ public_display_name: string | null }>();
      displayName = row?.public_display_name ? String(row.public_display_name) : null;
    } catch {
      /* optional column */
    }

    let account_keys: Awaited<ReturnType<typeof listAccountKeys>> = [];
    let servers: Awaited<ReturnType<typeof listOwnedServers>> = [];
    try {
      account_keys = await listAccountKeys(env.DB, auth.accountId);
    } catch {
      account_keys = [];
    }
    try {
      servers = await listOwnedServers(env.DB, auth.accountId);
    } catch {
      servers = [];
    }

    return json({
      ok: true,
      signed_in: true,
      developer: true,
      account_id: auth.accountId,
      email: auth.email,
      display_name: displayName,
      discord_linked: Boolean(discord?.discord_user_id),
      discord_user_id: discord?.discord_user_id || null,
      discord_username: discord?.discord_username || null,
      discord_global_name: discord?.discord_global_name || null,
      account_keys,
      product_keys: account_keys,
      servers,
      message:
        account_keys.length === 0
          ? "Generate a free account key, then register a server to fill cloud.yml."
          : "Put your account key in license.yml (product-key). Register each Paper server for cloud.yml credentials.",
    });
  }

  return null;
}

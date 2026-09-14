/**
 * Root-Core license bind + presence — product-key auth (not cloud secret).
 * Portal My Servers reads rootstat_servers updated by presence.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { upsertServerLiveStats } from "./rootmc-live-economy-status";

const LICENSE_API_BASE = "https://api.rootmc.info";
const MAX_SERVERS_PER_KEY = 25;

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

function nowIso(): string {
  return new Date().toISOString();
}

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function randomServerId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomServerSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

type KeyRow = {
  id: string;
  account_id: string;
  revoked_at: string | null;
};

async function lookupActiveKey(
  db: D1Database,
  productKey: string,
): Promise<KeyRow | { error: string; status: number }> {
  const key = str(productKey);
  if (!key || !/^RMCDEV-/i.test(key)) {
    return { error: "Valid product-key required (RMCDEV-…).", status: 400 };
  }
  const keyHash = await sha256Hex(key);
  const row = await db
    .prepare(
      `SELECT id, account_id, revoked_at FROM rootmc_developer_account_keys
       WHERE key_hash = ? LIMIT 1`,
    )
    .bind(keyHash)
    .first<KeyRow>();
  if (!row?.id) {
    return { error: "Unknown product-key.", status: 401 };
  }
  if (row.revoked_at) {
    return { error: "Product-key has been deleted.", status: 401 };
  }
  return row;
}

export async function handleLicenseBind(request: Request, db: D1Database): Promise<Response> {
  let body: {
    product_key?: string;
    server_name?: string;
    server_id?: string;
    issue_secret?: boolean;
  } = {};
  try {
    body = JSON.parse(await request.text()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON body." }, 400);
  }

  const key = await lookupActiveKey(db, body.product_key || "");
  if ("error" in key) return json({ detail: key.error }, key.status);

  const serverName = str(body.server_name).slice(0, 80) || "Minecraft server";
  const requestedId = str(body.server_id);
  const issueSecret = body.issue_secret === true;
  const now = nowIso();

  type ServerRow = {
    server_id: string;
    server_name: string | null;
    owner_account_id: string | null;
    product_key_id: string | null;
  };

  let existing: ServerRow | null = null;

  if (requestedId) {
    existing =
      (await db
        .prepare(
          `SELECT server_id, server_name, owner_account_id, product_key_id
           FROM rootstat_servers WHERE server_id = ? LIMIT 1`,
        )
        .bind(requestedId)
        .first<ServerRow>()) || null;
    if (existing) {
      const owner = str(existing.owner_account_id);
      const boundKey = str(existing.product_key_id);
      if (owner && owner !== key.account_id) {
        return json({ detail: "server-id is owned by another account." }, 403);
      }
      if (boundKey && boundKey !== key.id) {
        return json({ detail: "server-id is bound to a different product-key." }, 403);
      }
    }
  }

  if (!existing) {
    existing =
      (await db
        .prepare(
          `SELECT server_id, server_name, owner_account_id, product_key_id
           FROM rootstat_servers
           WHERE product_key_id = ? AND owner_account_id = ?
           ORDER BY updated_at DESC LIMIT 1`,
        )
        .bind(key.id, key.account_id)
        .first<ServerRow>()) || null;
  }

  if (existing?.server_id) {
    let issuedSecret: string | null = null;
    if (issueSecret) {
      issuedSecret = randomServerSecret();
      const secretHash = await sha256Hex(issuedSecret);
      await db
        .prepare(
          `UPDATE rootstat_servers
           SET server_name = ?, product_key_id = ?, owner_account_id = ?,
               server_secret_hash = ?, updated_at = ?
           WHERE server_id = ?`,
        )
        .bind(serverName, key.id, key.account_id, secretHash, now, existing.server_id)
        .run();
    } else {
      await db
        .prepare(
          `UPDATE rootstat_servers
           SET server_name = ?, product_key_id = ?, owner_account_id = ?, updated_at = ?
           WHERE server_id = ?`,
        )
        .bind(serverName, key.id, key.account_id, now, existing.server_id)
        .run();
    }

    return json({
      ok: true,
      created: false,
      server_id: existing.server_id,
      server_name: serverName,
      api_base: LICENSE_API_BASE,
      server_secret: issuedSecret,
      note: issuedSecret
        ? "Rotated server_secret (shown once). Written by Root-Core into root-core.yml + cloud.yml."
        : "Bound existing server-id. Presence will update My Servers.",
    });
  }

  const countRow = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM rootstat_servers
       WHERE owner_account_id = ?`,
    )
    .bind(key.account_id)
    .first<{ c: number }>();
  if ((Number(countRow?.c) || 0) >= MAX_SERVERS_PER_KEY) {
    return json({ detail: `Limit of ${MAX_SERVERS_PER_KEY} linked servers reached.` }, 400);
  }

  const serverId = requestedId || randomServerId();
  const serverSecret = randomServerSecret();
  const secretHash = await sha256Hex(serverSecret);

  try {
    await db
      .prepare(
        `INSERT INTO rootstat_servers
           (server_id, server_name, server_secret_hash, owner_account_id, product_key_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(serverId, serverName, secretHash, key.account_id, key.id, now, now)
      .run();
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    if (/no such column: product_key_id/i.test(msg)) {
      await db
        .prepare(
          `INSERT INTO rootstat_servers
             (server_id, server_name, server_secret_hash, owner_account_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(serverId, serverName, secretHash, key.account_id, now, now)
        .run();
    } else {
      console.error("rootmc_license_bind_insert", msg);
      return json({ detail: "Could not create server binding." }, 500);
    }
  }

  return json({
    ok: true,
    created: true,
    server_id: serverId,
    server_secret: serverSecret,
    server_name: serverName,
    api_base: LICENSE_API_BASE,
    note: "Copy server_id and server_secret into plugins/RootMC/cloud.yml if blank. Secret shown once.",
  });
}

export async function handleLicensePresence(request: Request, db: D1Database): Promise<Response> {
  let body: {
    product_key?: string;
    server_name?: string;
    server_id?: string;
    server_address?: string;
    plugin_version?: string;
    online_players?: number;
  } = {};
  try {
    body = JSON.parse(await request.text()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON body." }, 400);
  }

  const key = await lookupActiveKey(db, body.product_key || "");
  if ("error" in key) return json({ detail: key.error }, key.status);

  const serverName = str(body.server_name).slice(0, 80) || "Minecraft server";
  const requestedId = str(body.server_id);
  const address = str(body.server_address).slice(0, 128) || null;
  const pluginVersion = str(body.plugin_version).slice(0, 64) || null;
  const now = nowIso();

  type ServerRow = { server_id: string };

  let server: ServerRow | null = null;
  if (requestedId) {
    server =
      (await db
        .prepare(
          `SELECT server_id FROM rootstat_servers
           WHERE server_id = ? AND owner_account_id = ? LIMIT 1`,
        )
        .bind(requestedId, key.account_id)
        .first<ServerRow>()) || null;
  }
  if (!server) {
    server =
      (await db
        .prepare(
          `SELECT server_id FROM rootstat_servers
           WHERE product_key_id = ? AND owner_account_id = ?
           ORDER BY updated_at DESC LIMIT 1`,
        )
        .bind(key.id, key.account_id)
        .first<ServerRow>()) || null;
  }

  if (!server?.server_id) {
    // Auto-bind then presence (first boot without separate bind round-trip).
    const bindReq = new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_key: body.product_key,
        server_name: serverName,
        server_id: requestedId || undefined,
      }),
    });
    const bindRes = await handleLicenseBind(bindReq, db);
    const bindData = (await bindRes.json()) as {
      ok?: boolean;
      server_id?: string;
      detail?: string;
    };
    if (!bindRes.ok || !bindData.server_id) {
      return json({ detail: bindData.detail || "Bind required before presence." }, bindRes.status);
    }
    server = { server_id: bindData.server_id };
  }

  try {
    await db
      .prepare(
        `UPDATE rootstat_servers
         SET server_name = ?,
             server_address = COALESCE(?, server_address),
             rootmc_plugin_version = COALESCE(?, rootmc_plugin_version),
             rootmc_last_seen_at = ?,
             product_key_id = ?,
             owner_account_id = ?,
             updated_at = ?
         WHERE server_id = ?`,
      )
      .bind(
        serverName,
        address,
        pluginVersion,
        now,
        key.id,
        key.account_id,
        now,
        server.server_id,
      )
      .run();
  } catch (e) {
    console.error("rootmc_license_presence_update", e);
    return json({ detail: "Could not update presence." }, 500);
  }

  const hasOnline = body.online_players !== undefined && body.online_players !== null;
  if (hasOnline) {
    const n = Math.max(0, Math.floor(Number(body.online_players) || 0));
    try {
      await upsertServerLiveStats(db, server.server_id, n, now);
    } catch {
      /* optional table */
    }
  }

  return json({
    ok: true,
    server_id: server.server_id,
    server_name: serverName,
    seen_at: now,
  });
}

export async function handleLicenseRoutes(
  request: Request,
  db: D1Database,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (!sub.startsWith("/rootmc/license")) return null;
  const rest = sub.slice("/rootmc/license".length).replace(/\/+$/, "") || "/";

  if (method === "POST" && (rest === "/bind" || rest === "bind")) {
    return handleLicenseBind(request, db);
  }
  if (method === "POST" && (rest === "/presence" || rest === "presence")) {
    return handleLicensePresence(request, db);
  }
  return json({ detail: "Not Found" }, 404);
}

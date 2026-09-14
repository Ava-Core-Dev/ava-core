import type { D1Database } from "@cloudflare/workers-types";

const MAX_ACTIVE_KEYS = 20;
const MAX_SERVERS = 25;

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

function nowIso(): string {
  return new Date().toISOString();
}

function chunkKey(hex: string): string {
  const parts = [];
  for (let i = 0; i < 16; i += 4) parts.push(hex.slice(i, i + 4).toUpperCase());
  return parts.join("-");
}

/** Human-readable account key for plugins/RootMC/license.yml → product-key */
export function mintAccountKeyPlaintext(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `RMCDEV-${chunkKey(hex)}`;
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

export type AccountKeyRow = {
  id: string;
  key_prefix: string;
  key_last4: string;
  label: string | null;
  created_at: string;
  revoked_at: string | null;
  display: string;
};

export type ServerRow = {
  server_id: string;
  server_name: string | null;
  product_key_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function listAccountKeys(db: D1Database, accountId: string): Promise<AccountKeyRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, key_prefix, key_last4, label, created_at, revoked_at
       FROM rootmc_developer_account_keys
       WHERE account_id = ?
       ORDER BY created_at DESC`,
    )
    .bind(accountId)
    .all<{
      id: string;
      key_prefix: string;
      key_last4: string;
      label: string | null;
      created_at: string;
      revoked_at: string | null;
    }>();

  return (results || []).map((row) => ({
    ...row,
    display: `${row.key_prefix}…${row.key_last4}`,
  }));
}

export type ServerHealthRow = ServerRow & {
  server_address: string | null;
  game_version: string | null;
  rootmc_plugin_version: string | null;
  rootmc_last_seen_at: string | null;
  online_players: number | null;
  live_stats_at: string | null;
  product_key_display: string | null;
  product_key_revoked: boolean;
  mesh_enabled: boolean;
  transfer_slug: string | null;
  connection: "online" | "degraded" | "offline" | "never";
  health: "ok" | "warn" | "down" | "unknown";
  seconds_since_seen: number | null;
};

const ONLINE_SEC = 10 * 60;
const DEGRADED_SEC = 60 * 60;

function connectionFromLastSeen(lastSeen: string | null | undefined): {
  connection: ServerHealthRow["connection"];
  health: ServerHealthRow["health"];
  seconds_since_seen: number | null;
} {
  if (!lastSeen) {
    return { connection: "never", health: "unknown", seconds_since_seen: null };
  }
  const ms = Date.parse(lastSeen);
  if (!Number.isFinite(ms)) {
    return { connection: "never", health: "unknown", seconds_since_seen: null };
  }
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec <= ONLINE_SEC) {
    return { connection: "online", health: "ok", seconds_since_seen: sec };
  }
  if (sec <= DEGRADED_SEC) {
    return { connection: "degraded", health: "warn", seconds_since_seen: sec };
  }
  return { connection: "offline", health: "down", seconds_since_seen: sec };
}

export async function listOwnedServers(db: D1Database, accountId: string): Promise<ServerRow[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT server_id, server_name, product_key_id, created_at, updated_at
         FROM rootstat_servers
         WHERE owner_account_id = ?
         ORDER BY created_at DESC`,
      )
      .bind(accountId)
      .all<ServerRow>();
    return results || [];
  } catch {
    const { results } = await db
      .prepare(
        `SELECT server_id, server_name, created_at, updated_at
         FROM rootstat_servers
         WHERE owner_account_id = ?
         ORDER BY created_at DESC`,
      )
      .bind(accountId)
      .all<{
        server_id: string;
        server_name: string | null;
        created_at: string;
        updated_at: string;
      }>();
    return (results || []).map((r) => ({ ...r, product_key_id: null }));
  }
}

/** Owned servers + heartbeat / live player health + bound account-key display. */
export async function listOwnedServersWithHealth(
  db: D1Database,
  accountId: string,
): Promise<ServerHealthRow[]> {
  type Raw = {
    server_id: string;
    server_name: string | null;
    product_key_id: string | null;
    created_at: string;
    updated_at: string;
    server_address: string | null;
    game_version: string | null;
    rootmc_plugin_version: string | null;
    rootmc_last_seen_at: string | null;
    online_players: number | null;
    live_stats_at: string | null;
    key_prefix: string | null;
    key_last4: string | null;
    key_revoked_at: string | null;
    mesh_enabled: number | null;
    transfer_slug: string | null;
  };

  let rows: Raw[] = [];
  try {
    const { results } = await db
      .prepare(
        `SELECT s.server_id, s.server_name, s.product_key_id, s.created_at, s.updated_at,
                s.server_address, s.game_version, s.rootmc_plugin_version, s.rootmc_last_seen_at,
                s.mesh_enabled, s.transfer_slug,
                live.online_players AS online_players, live.updated_at AS live_stats_at,
                k.key_prefix, k.key_last4, k.revoked_at AS key_revoked_at
         FROM rootstat_servers s
         LEFT JOIN rootmc_server_live_stats live ON live.server_id = s.server_id
         LEFT JOIN rootmc_developer_account_keys k ON k.id = s.product_key_id
         WHERE s.owner_account_id = ?
         ORDER BY s.created_at DESC`,
      )
      .bind(accountId)
      .all<Raw>();
    rows = results || [];
  } catch {
    const basic = await listOwnedServers(db, accountId);
    return basic.map((s) => {
      const c = connectionFromLastSeen(null);
      return {
        ...s,
        server_address: null,
        game_version: null,
        rootmc_plugin_version: null,
        rootmc_last_seen_at: null,
        online_players: null,
        live_stats_at: null,
        product_key_display: null,
        product_key_revoked: false,
        mesh_enabled: false,
        transfer_slug: null,
        ...c,
      };
    });
  }

  return rows.map((r) => {
    const c = connectionFromLastSeen(r.rootmc_last_seen_at);
    const keyDisplay =
      r.key_prefix && r.key_last4 ? `${r.key_prefix}…${r.key_last4}` : null;
    return {
      server_id: r.server_id,
      server_name: r.server_name,
      product_key_id: r.product_key_id,
      created_at: r.created_at,
      updated_at: r.updated_at,
      server_address: r.server_address,
      game_version: r.game_version,
      rootmc_plugin_version: r.rootmc_plugin_version,
      rootmc_last_seen_at: r.rootmc_last_seen_at,
      online_players: r.online_players != null ? Number(r.online_players) : null,
      live_stats_at: r.live_stats_at,
      product_key_display: keyDisplay,
      product_key_revoked: Boolean(r.key_revoked_at),
      mesh_enabled: Boolean(r.mesh_enabled),
      transfer_slug: r.transfer_slug,
      ...c,
    };
  });
}

/** Single owned server with health, or null if not found / not owned. */
export async function getOwnedServerWithHealth(
  db: D1Database,
  accountId: string,
  serverId: string,
): Promise<ServerHealthRow | null> {
  const id = String(serverId || "").trim();
  if (!id) return null;
  const all = await listOwnedServersWithHealth(db, accountId);
  return all.find((s) => s.server_id === id) || null;
}

/** Rename portal display name on an owned rootstat_servers row. */
export async function renameOwnedServer(
  db: D1Database,
  accountId: string,
  serverId: string,
  serverName: string,
): Promise<{ ok: true; server_id: string; server_name: string } | { error: string; status: number }> {
  const id = String(serverId || "").trim();
  const name = String(serverName || "").trim().slice(0, 80);
  if (!id) return { error: "server_id required", status: 400 };
  if (!name) return { error: "Server name is required.", status: 400 };

  const owned = await db
    .prepare(
      `SELECT server_id FROM rootstat_servers
       WHERE server_id = ? AND owner_account_id = ? LIMIT 1`,
    )
    .bind(id, accountId)
    .first<{ server_id: string }>();
  if (!owned?.server_id) return { error: "Server not found.", status: 404 };

  const now = nowIso();
  await db
    .prepare(
      `UPDATE rootstat_servers
       SET server_name = ?, updated_at = ?
       WHERE server_id = ? AND owner_account_id = ?`,
    )
    .bind(name, now, id, accountId)
    .run();

  return { ok: true, server_id: id, server_name: name };
}

/**
 * Remove a server from My Servers (portal unlink).
 * Does not revoke the product key. Paper can reappear on next Root-Core bind/presence.
 */
export async function unlinkOwnedServer(
  db: D1Database,
  accountId: string,
  serverId: string,
): Promise<{ ok: true; server_id: string } | { error: string; status: number }> {
  const id = String(serverId || "").trim();
  if (!id) return { error: "server_id required", status: 400 };

  const owned = await db
    .prepare(
      `SELECT server_id FROM rootstat_servers
       WHERE server_id = ? AND owner_account_id = ? LIMIT 1`,
    )
    .bind(id, accountId)
    .first<{ server_id: string }>();
  if (!owned?.server_id) return { error: "Server not found.", status: 404 };

  await db
    .prepare(`DELETE FROM rootstat_servers WHERE server_id = ? AND owner_account_id = ?`)
    .bind(id, accountId)
    .run();

  return { ok: true, server_id: id };
}

export async function createAccountKey(
  db: D1Database,
  accountId: string,
  label?: string,
): Promise<{ id: string; account_key: string; label: string | null; created_at: string } | { error: string; status: number }> {
  const active = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM rootmc_developer_account_keys
       WHERE account_id = ? AND revoked_at IS NULL`,
    )
    .bind(accountId)
    .first<{ c: number }>();
  if ((Number(active?.c) || 0) >= MAX_ACTIVE_KEYS) {
    return { error: `Limit of ${MAX_ACTIVE_KEYS} active account keys reached.`, status: 400 };
  }

  const plaintext = mintAccountKeyPlaintext();
  const id = crypto.randomUUID();
  const created_at = nowIso();
  const key_hash = await sha256Hex(plaintext);
  const key_prefix = plaintext.slice(0, 11); // RMCDEV-XXXX
  const key_last4 = plaintext.slice(-4);
  const cleanLabel = String(label || "").trim().slice(0, 64) || null;

  try {
    await db
      .prepare(
        `INSERT INTO rootmc_developer_account_keys
           (id, account_id, key_prefix, key_last4, key_hash, label, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(id, accountId, key_prefix, key_last4, key_hash, cleanLabel, created_at)
      .run();
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    if (/no such table/i.test(msg)) {
      return { error: "Account keys table missing — run D1 migrations.", status: 503 };
    }
    console.error("rootmc_developer_key_insert", msg);
    return { error: "Could not create account key.", status: 500 };
  }

  return { id, account_key: plaintext, label: cleanLabel, created_at };
}

/** Update server-name label on an existing account key (does not rotate the key). */
export async function renameAccountKey(
  db: D1Database,
  accountId: string,
  keyId: string,
  label: string,
): Promise<{ ok: true; id: string; label: string } | { error: string; status: number }> {
  const id = String(keyId || "").trim();
  const cleanLabel = String(label || "").trim().slice(0, 64);
  if (!id) return { error: "key id required", status: 400 };
  if (!cleanLabel) return { error: "Server name is required.", status: 400 };

  const row = await db
    .prepare(
      `SELECT id, revoked_at FROM rootmc_developer_account_keys
       WHERE id = ? AND account_id = ? LIMIT 1`,
    )
    .bind(id, accountId)
    .first<{ id: string; revoked_at: string | null }>();
  if (!row?.id) return { error: "Account key not found.", status: 404 };
  if (row.revoked_at) return { error: "Account key is deleted.", status: 400 };

  await db
    .prepare(
      `UPDATE rootmc_developer_account_keys SET label = ? WHERE id = ? AND account_id = ?`,
    )
    .bind(cleanLabel, id, accountId)
    .run();

  return { ok: true, id, label: cleanLabel };
}

/** Soft-delete key and remove My Servers rows for that key + orphan rows (null / revoked keys). */
export async function revokeAccountKey(
  db: D1Database,
  accountId: string,
  keyId: string,
): Promise<{ ok: true; id: string; servers_deleted: number } | { error: string; status: number }> {
  const id = String(keyId || "").trim();
  if (!id) {
    return { error: "key id required", status: 400 };
  }

  const row = await db
    .prepare(
      `SELECT id, revoked_at FROM rootmc_developer_account_keys
       WHERE id = ? AND account_id = ? LIMIT 1`,
    )
    .bind(id, accountId)
    .first<{ id: string; revoked_at: string | null }>();

  if (!row?.id) {
    return { error: "Account key not found.", status: 404 };
  }
  if (row.revoked_at) {
    return { error: "Account key is already deleted.", status: 400 };
  }

  const now = nowIso();
  await db
    .prepare(
      `UPDATE rootmc_developer_account_keys SET revoked_at = ? WHERE id = ? AND account_id = ?`,
    )
    .bind(now, id, accountId)
    .run();

  const serversDeleted = await purgeOwnedServersForDeletedKeys(db, accountId, id);
  return { ok: true, id, servers_deleted: serversDeleted };
}

/**
 * Drop My Servers rows for this account that are tied to a deleted key, or have no key
 * (leftovers from the old unlink-on-delete behavior).
 */
export async function purgeOwnedServersForDeletedKeys(
  db: D1Database,
  accountId: string,
  justDeletedKeyId?: string,
): Promise<number> {
  let total = 0;
  try {
    if (justDeletedKeyId) {
      const delBound = await db
        .prepare(
          `DELETE FROM rootstat_servers WHERE owner_account_id = ? AND product_key_id = ?`,
        )
        .bind(accountId, justDeletedKeyId)
        .run();
      total += Number(delBound.meta?.changes ?? 0) || 0;
    }

    const delOrphans = await db
      .prepare(
        `DELETE FROM rootstat_servers
         WHERE owner_account_id = ?
           AND (
             product_key_id IS NULL
             OR product_key_id = ''
             OR product_key_id IN (
               SELECT id FROM rootmc_developer_account_keys
               WHERE account_id = ? AND revoked_at IS NOT NULL
             )
           )`,
      )
      .bind(accountId, accountId)
      .run();
    total += Number(delOrphans.meta?.changes ?? 0) || 0;
  } catch (e) {
    console.error("rootmc_developer_purge_servers", e);
  }
  return total;
}

export async function registerDeveloperServer(
  db: D1Database,
  accountId: string,
  input: { server_name?: string; product_key_id?: string },
): Promise<
  | {
      server_id: string;
      server_secret: string;
      server_name: string;
      product_key_id: string | null;
      note: string;
    }
  | { error: string; status: number }
> {
  const owned = await listOwnedServers(db, accountId);
  if (owned.length >= MAX_SERVERS) {
    return { error: `Limit of ${MAX_SERVERS} linked servers reached.`, status: 400 };
  }

  let productKeyId: string | null = String(input.product_key_id || "").trim() || null;
  if (productKeyId) {
    const key = await db
      .prepare(
        `SELECT id FROM rootmc_developer_account_keys
         WHERE id = ? AND account_id = ? AND revoked_at IS NULL LIMIT 1`,
      )
      .bind(productKeyId, accountId)
      .first<{ id: string }>();
    if (!key?.id) {
      return { error: "Account key not found or revoked.", status: 400 };
    }
  } else {
    // Auto-attach newest active key when present.
    const newest = await db
      .prepare(
        `SELECT id FROM rootmc_developer_account_keys
         WHERE account_id = ? AND revoked_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(accountId)
      .first<{ id: string }>();
    productKeyId = newest?.id || null;
  }

  const serverId = randomServerId();
  const serverSecret = randomServerSecret();
  const serverName = String(input.server_name || "").trim().slice(0, 80) || "Minecraft server";
  const now = nowIso();
  const hash = await sha256Hex(serverSecret);

  try {
    await db
      .prepare(
        `INSERT INTO rootstat_servers
           (server_id, server_name, server_secret_hash, owner_account_id, created_at, updated_at, product_key_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(serverId, serverName, hash, accountId, now, now, productKeyId)
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
        .bind(serverId, serverName, hash, accountId, now, now)
        .run();
    } else {
      console.error("rootmc_developer_server_insert", msg);
      return { error: "Could not register server.", status: 500 };
    }
  }

  return {
    server_id: serverId,
    server_secret: serverSecret,
    server_name: serverName,
    product_key_id: productKeyId,
    note:
      "Copy server_id and server_secret into plugins/RootMC/cloud.yml. Secret is shown only once. Put your account key in plugins/RootMC/license.yml as product-key.",
  };
}

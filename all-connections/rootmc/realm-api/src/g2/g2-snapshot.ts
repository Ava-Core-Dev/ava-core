import { json } from "../cors";
import type { Env } from "../realm-router";
import { validateG2ServerAuth } from "./g2-auth";

const ECONOMY_MIN_INTERVAL_MS = 5 * 60 * 1000;

type TupleBalance = [string, number, string?];
type TupleListing = [string, string, string, number, number, string?, number?, number?, number?, string?];
type TupleMarket = [string, number, number];
type TuplePlaytime = [string, number, string?, number?];
type TupleNetWorth = [string, number, number, number];

export interface G2EconomyPayload {
  updated_at_ms?: number;
  online_count?: number;
  treasury_g?: number;
  supply?: Record<string, number>;
  balances?: TupleBalance[];
  net_worth?: TupleNetWorth[];
  shops?: TupleListing[];
  market?: TupleMarket[];
  playtime?: TuplePlaytime[];
  purge_missing?: boolean;
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nowMs(): number {
  return Date.now();
}

async function economyRateLimited(db: D1Database, realmId: string, force: boolean): Promise<boolean> {
  if (force) return false;
  const row = await db
    .prepare("SELECT last_economy_snapshot_ms FROM g2_realm WHERE realm_id = ? LIMIT 1")
    .bind(realmId)
    .first<{ last_economy_snapshot_ms: number | null }>();
  const last = row?.last_economy_snapshot_ms ?? 0;
  return last > 0 && nowMs() - last < ECONOMY_MIN_INTERVAL_MS;
}

export async function handleG2EconomySnapshot(
  request: Request,
  env: Env,
  force: boolean,
): Promise<Response> {
  const auth = await validateG2ServerAuth(env, request);
  if (auth instanceof Response) return auth;
  const { realmId } = auth;

  if (await economyRateLimited(env.DB, realmId, force)) {
    return json({ ok: false, error: "rate_limited", retry_after_ms: ECONOMY_MIN_INTERVAL_MS }, 429);
  }

  let body: G2EconomyPayload;
  try {
    body = (await request.json()) as G2EconomyPayload;
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }

  const updatedMs = num(body.updated_at_ms, nowMs());
  const statements: ReturnType<Env["DB"]["prepare"]>[] = [];

  for (const row of body.balances || []) {
    const uuid = String(row[0] || "").trim();
    if (!uuid) continue;
    const gold = num(row[1]);
    const username = row[2] != null ? String(row[2]).slice(0, 32) : null;
    statements.push(
      env.DB.prepare(
        `INSERT INTO g2_snap_balance (realm_id, player_uuid, gold_g, username, updated_at_ms)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(realm_id, player_uuid) DO UPDATE SET
           gold_g = excluded.gold_g,
           username = COALESCE(excluded.username, g2_snap_balance.username),
           updated_at_ms = excluded.updated_at_ms`,
      ).bind(realmId, uuid, gold, username, updatedMs),
    );
  }

  for (const row of body.net_worth || []) {
    const uuid = String(row[0] || "").trim();
    if (!uuid) continue;
    statements.push(
      env.DB.prepare(
        `INSERT INTO g2_snap_net_worth (realm_id, player_uuid, net_worth_g, wallet_g, items_g, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(realm_id, player_uuid) DO UPDATE SET
           net_worth_g = excluded.net_worth_g,
           wallet_g = excluded.wallet_g,
           items_g = excluded.items_g,
           updated_at_ms = excluded.updated_at_ms`,
      ).bind(realmId, uuid, num(row[1]), num(row[2]), num(row[3]), updatedMs),
    );
  }

  for (const row of body.shops || []) {
    const listingId = String(row[0] || "").trim();
    if (!listingId) continue;
    statements.push(
      env.DB.prepare(
        `INSERT INTO g2_snap_shop (
           realm_id, listing_id, seller_uuid, item_key, price_g, stock,
           world, x, y, z, listing_type, updated_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(realm_id, listing_id) DO UPDATE SET
           seller_uuid = excluded.seller_uuid,
           item_key = excluded.item_key,
           price_g = excluded.price_g,
           stock = excluded.stock,
           world = excluded.world,
           x = excluded.x,
           y = excluded.y,
           z = excluded.z,
           listing_type = excluded.listing_type,
           updated_at_ms = excluded.updated_at_ms`,
      ).bind(
        realmId,
        listingId,
        String(row[1] || "").trim() || null,
        String(row[2] || "").trim(),
        num(row[3]),
        Math.trunc(num(row[4])),
        row[5] != null ? String(row[5]) : null,
        row[6] != null ? Math.trunc(num(row[6])) : null,
        row[7] != null ? Math.trunc(num(row[7])) : null,
        row[8] != null ? Math.trunc(num(row[8])) : null,
        row[9] != null ? String(row[9]) : null,
        updatedMs,
      ),
    );
  }

  for (const row of body.market || []) {
    const itemKey = String(row[0] || "").trim();
    if (!itemKey) continue;
    statements.push(
      env.DB.prepare(
        `INSERT INTO g2_snap_item_market (realm_id, item_key, median_g, sample_n, updated_at_ms)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(realm_id, item_key) DO UPDATE SET
           median_g = excluded.median_g,
           sample_n = excluded.sample_n,
           updated_at_ms = excluded.updated_at_ms`,
      ).bind(realmId, itemKey, num(row[1]), Math.trunc(num(row[2])), updatedMs),
    );
  }

  for (const row of body.playtime || []) {
    const uuid = String(row[0] || "").trim();
    if (!uuid) continue;
    statements.push(
      env.DB.prepare(
        `INSERT INTO g2_snap_playtime (realm_id, player_uuid, total_sec, month_key, month_sec, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(realm_id, player_uuid) DO UPDATE SET
           total_sec = excluded.total_sec,
           month_key = excluded.month_key,
           month_sec = excluded.month_sec,
           updated_at_ms = excluded.updated_at_ms`,
      ).bind(
        realmId,
        uuid,
        Math.trunc(num(row[1])),
        row[2] != null ? String(row[2]) : null,
        row[3] != null ? Math.trunc(num(row[3])) : 0,
        updatedMs,
      ),
    );
  }

  const treasuryG = num(body.treasury_g);
  const supplyJson = body.supply ? JSON.stringify(body.supply) : null;
  statements.push(
    env.DB.prepare(
      `INSERT INTO g2_snap_treasury (realm_id, reserve_g, supply_json, updated_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(realm_id) DO UPDATE SET
         reserve_g = excluded.reserve_g,
         supply_json = COALESCE(excluded.supply_json, g2_snap_treasury.supply_json),
         updated_at_ms = excluded.updated_at_ms`,
    ).bind(realmId, treasuryG, supplyJson, updatedMs),
  );

  const onlineCount = Math.max(0, Math.trunc(num(body.online_count)));
  statements.push(
    env.DB.prepare(
      `INSERT INTO g2_snap_online (realm_id, player_count, updated_at_ms)
       VALUES (?, ?, ?)
       ON CONFLICT(realm_id) DO UPDATE SET
         player_count = excluded.player_count,
         updated_at_ms = excluded.updated_at_ms`,
    ).bind(realmId, onlineCount, updatedMs),
  );

  statements.push(
    env.DB.prepare(
      `UPDATE g2_realm SET last_economy_snapshot_ms = ?, updated_at_ms = ? WHERE realm_id = ?`,
    ).bind(updatedMs, updatedMs, realmId),
  );

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }

  return json({
    ok: true,
    realm_id: realmId,
    updated_at_ms: updatedMs,
    counts: {
      balances: (body.balances || []).length,
      shops: (body.shops || []).length,
      market: (body.market || []).length,
      playtime: (body.playtime || []).length,
    },
  });
}

export async function handleG2BondsSnapshot(request: Request, env: Env): Promise<Response> {
  const auth = await validateG2ServerAuth(env, request);
  if (auth instanceof Response) return auth;
  const { realmId } = auth;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }

  const updatedMs = nowMs();
  await env.DB.prepare(
    `INSERT INTO g2_snap_bonds (realm_id, payload_json, updated_at_ms)
     VALUES (?, ?, ?)
     ON CONFLICT(realm_id) DO UPDATE SET
       payload_json = excluded.payload_json,
       updated_at_ms = excluded.updated_at_ms`,
  )
    .bind(realmId, JSON.stringify(payload), updatedMs)
    .run();

  return json({ ok: true, realm_id: realmId, updated_at_ms: updatedMs });
}

export async function handleG2StatsSnapshot(request: Request, env: Env): Promise<Response> {
  const auth = await validateG2ServerAuth(env, request);
  if (auth instanceof Response) return auth;
  const { realmId } = auth;

  let body: { online_count?: number; updated_at_ms?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }

  const updatedMs = num(body.updated_at_ms, nowMs());
  const onlineCount = Math.max(0, Math.trunc(num(body.online_count)));

  await env.DB.prepare(
    `INSERT INTO g2_snap_online (realm_id, player_count, updated_at_ms)
     VALUES (?, ?, ?)
     ON CONFLICT(realm_id) DO UPDATE SET
       player_count = excluded.player_count,
       updated_at_ms = excluded.updated_at_ms`,
  )
    .bind(realmId, onlineCount, updatedMs)
    .run();

  return json({ ok: true, realm_id: realmId, player_count: onlineCount, updated_at_ms: updatedMs });
}

export async function handleG2Heartbeat(request: Request, env: Env): Promise<Response> {
  const auth = await validateG2ServerAuth(env, request);
  if (auth instanceof Response) return auth;
  const { realmId } = auth;

  let body: {
    plugin_version?: string;
    server_address?: string;
    online_players?: number;
  } = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }

  const updatedMs = nowMs();
  const address = String(body.server_address || "").trim();
  const hasOnline =
    body.online_players !== undefined && body.online_players !== null;
  const onlineCount = hasOnline
    ? Math.max(0, Math.trunc(num(body.online_players)))
    : null;

  if (address) {
    await env.DB.prepare(
      `UPDATE g2_realm
       SET last_heartbeat_ms = ?, updated_at_ms = ?, server_address = ?
       WHERE realm_id = ?`,
    )
      .bind(updatedMs, updatedMs, address.slice(0, 128), realmId)
      .run();
  } else {
    await env.DB.prepare(
      `UPDATE g2_realm SET last_heartbeat_ms = ?, updated_at_ms = ? WHERE realm_id = ?`,
    )
      .bind(updatedMs, updatedMs, realmId)
      .run();
  }

  if (onlineCount !== null) {
    await env.DB.prepare(
      `INSERT INTO g2_snap_online (realm_id, player_count, updated_at_ms)
       VALUES (?, ?, ?)
       ON CONFLICT(realm_id) DO UPDATE SET
         player_count = excluded.player_count,
         updated_at_ms = excluded.updated_at_ms`,
    )
      .bind(realmId, onlineCount, updatedMs)
      .run();
  }

  return json({
    ok: true,
    realm_id: realmId,
    heartbeat_ms: updatedMs,
    online_players: onlineCount,
  });
}

/**
 * Gen2 jars still POST Gen1-shaped heartbeats to `/api/rootmc/server/heartbeat`.
 * On api2 that path used to hit Gen1 SQL and 500 — map it onto g2_realm + g2_snap_online.
 */
export async function handleG2CompatServerHeartbeat(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await validateG2ServerAuth(env, request);
  if (auth instanceof Response) return auth;
  const { realmId } = auth;

  let body: {
    plugin_version?: string;
    server_address?: string;
    online_players?: number;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }

  const updatedMs = nowMs();
  const address = String(body.server_address || "").trim();
  const hasOnline =
    body.online_players !== undefined && body.online_players !== null;
  const onlineCount = hasOnline
    ? Math.max(0, Math.trunc(num(body.online_players)))
    : null;

  if (address) {
    await env.DB.prepare(
      `UPDATE g2_realm
       SET last_heartbeat_ms = ?, updated_at_ms = ?, server_address = ?
       WHERE realm_id = ?`,
    )
      .bind(updatedMs, updatedMs, address.slice(0, 128), realmId)
      .run();
  } else {
    await env.DB.prepare(
      `UPDATE g2_realm SET last_heartbeat_ms = ?, updated_at_ms = ? WHERE realm_id = ?`,
    )
      .bind(updatedMs, updatedMs, realmId)
      .run();
  }

  if (onlineCount !== null) {
    await env.DB.prepare(
      `INSERT INTO g2_snap_online (realm_id, player_count, updated_at_ms)
       VALUES (?, ?, ?)
       ON CONFLICT(realm_id) DO UPDATE SET
         player_count = excluded.player_count,
         updated_at_ms = excluded.updated_at_ms`,
    )
      .bind(realmId, onlineCount, updatedMs)
      .run();
  }

  return json({
    ok: true,
    realm_id: realmId,
    server_id: realmId,
    heartbeat_ms: updatedMs,
    seen_at: new Date(updatedMs).toISOString(),
    rootmc_plugin_version: String(body.plugin_version || "unknown"),
  });
}

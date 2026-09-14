import { json } from "../cors";
import type { Env } from "../realm-router";
import { validateG2ServerAuth } from "./g2-auth";

export async function handleG2RealmStatus(request: Request, env: Env): Promise<Response> {
  const auth = await validateG2ServerAuth(env, request);
  if (auth instanceof Response) return auth;
  const { realmId } = auth;

  const realm = await env.DB.prepare(
    `SELECT realm_id, realm_name, server_address, last_heartbeat_ms, last_economy_snapshot_ms, updated_at_ms
     FROM g2_realm WHERE realm_id = ? LIMIT 1`,
  )
    .bind(realmId)
    .first<{
      realm_id: string;
      realm_name: string;
      server_address: string | null;
      last_heartbeat_ms: number | null;
      last_economy_snapshot_ms: number | null;
      updated_at_ms: number;
    }>();

  const counts = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM g2_snap_balance WHERE realm_id = ?) AS balances,
       (SELECT COUNT(*) FROM g2_snap_shop WHERE realm_id = ?) AS shops,
       (SELECT player_count FROM g2_snap_online WHERE realm_id = ? LIMIT 1) AS online`,
  )
    .bind(realmId, realmId, realmId)
    .first<{ balances: number; shops: number; online: number | null }>();

  const treasury = await env.DB.prepare(
    `SELECT reserve_g, updated_at_ms FROM g2_snap_treasury WHERE realm_id = ? LIMIT 1`,
  )
    .bind(realmId)
    .first<{ reserve_g: number; updated_at_ms: number }>();

  return json({
    ok: true,
    realm_id: realmId,
    realm: realm || null,
    treasury: treasury || null,
    counts: {
      balances: counts?.balances ?? 0,
      shops: counts?.shops ?? 0,
      online: counts?.online ?? 0,
    },
  });
}

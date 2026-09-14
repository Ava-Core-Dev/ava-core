/**
 * Precomputed /list economy totals — D1 mirror of host MySQL root_list_totals
 * plus official/global rollups. Public GET never re-sums the ledger.
 */

import type { Connection, RowDataPacket } from "mysql2/promise";

import { json } from "./cors";
import { roundGold } from "./discord-rootmc-economy";
import { withShortPublicCache } from "./rootmc-hyperdrive";
import type { RootStatEnv } from "./rootstat-minecraft";
import {
  TREASURY_TYPE_GLOSSARY,
  TOWNY_INTAKE_GLOSSARY,
  ledgerTotalsBetween,
  townyIntakeBetween,
} from "./rootmc-treasury";
import { MAP_262_RESET_DATE_HST } from "./rootmc-economy-baseline";

const TREASURY_SERVER_ID = "rootmc";
const FETCH_CACHE_TTL_MS = 10 * 60 * 1000;

/** Per-scope date when economy list collection started (Map 26.2 reset). */
const DATA_COLLECTION_START: Record<string, string> = {
  claims: MAP_262_RESET_DATE_HST,
  towny: MAP_262_RESET_DATE_HST,
  official: MAP_262_RESET_DATE_HST,
  global: MAP_262_RESET_DATE_HST,
  g2: MAP_262_RESET_DATE_HST,
};

const SUPPLY_LABELS: { category: string; label: string }[] = [
  { category: "reserve_balance", label: "Reserve balance" },
  { category: "player_wallets", label: "Player wallets" },
  { category: "town_banks", label: "Town banks" },
  { category: "nation_banks", label: "Nation banks" },
  { category: "bonds_principal", label: "Bonds principal outstanding" },
  { category: "physical_gold", label: "Physical gold (scanned storage)" },
  { category: "gold_minted_net", label: "Gold minted net (/mint)" },
  { category: "gold_found", label: "Gold found (all-time)" },
];

const POOL_LABELS: { category: string; label: string }[] = [
  { category: "playtime_rewards_paid", label: "Playtime rewards paid" },
  { category: "vote_rewards_paid", label: "Vote rewards paid" },
  { category: "grants_paid", label: "Grants paid" },
  { category: "dividends_paid", label: "Dividends paid" },
];

type ListRow = {
  scope: string;
  group_key: string;
  category: string;
  label: string;
  amount_g: number;
  computed_at: string;
  source_server_id?: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

async function readFetchCache(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT payload_json, fetched_at FROM rootmc_list_fetch_cache WHERE cache_key = ?`)
    .bind(key)
    .first<{ payload_json: string; fetched_at: string }>();
  if (!row) return null;
  const age = Date.now() - Date.parse(row.fetched_at);
  if (!Number.isFinite(age) || age > FETCH_CACHE_TTL_MS) return null;
  return row.payload_json;
}

async function writeFetchCache(db: D1Database, key: string, payload: unknown): Promise<void> {
  await db
    .prepare(
      `INSERT INTO rootmc_list_fetch_cache (cache_key, payload_json, fetched_at)
       VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         payload_json = excluded.payload_json,
         fetched_at = excluded.fetched_at`,
    )
    .bind(key, JSON.stringify(payload), nowIso())
    .run();
}

async function upsertListRow(db: D1Database, row: ListRow): Promise<void> {
  if (String(row.category).toUpperCase() === "OPENING") return;
  await db
    .prepare(
      `INSERT INTO rootmc_list_totals
         (scope, group_key, category, label, amount_g, meta_json, computed_at, source_server_id)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(scope, group_key, category) DO UPDATE SET
         label = excluded.label,
         amount_g = excluded.amount_g,
         computed_at = excluded.computed_at,
         source_server_id = excluded.source_server_id`,
    )
    .bind(
      row.scope,
      row.group_key,
      row.category,
      row.label,
      roundGold(row.amount_g),
      row.computed_at,
      row.source_server_id ?? null,
    )
    .run();
}

async function pullMysqlListTotals(
  conn: Connection,
  prefix: string,
): Promise<ListRow[]> {
  const table = `${prefix}list_totals`;
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT scope, group_key, category, label, amount_g, computed_at FROM ${table}`,
    );
    const out: ListRow[] = [];
    for (const r of rows ?? []) {
      const category = str(r.category);
      if (category.toUpperCase() === "OPENING") continue;
      out.push({
        scope: str(r.scope).toLowerCase(),
        group_key: str(r.group_key),
        category,
        label: str(r.label),
        amount_g: roundGold(Number(r.amount_g) || 0),
        computed_at: r.computed_at
          ? new Date(r.computed_at as string | Date).toISOString()
          : nowIso(),
      });
    }
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/doesn't exist|ER_NO_SUCH_TABLE/i.test(msg)) {
      return [];
    }
    throw e;
  }
}

async function backfillGlobalFromLedger(db: D1Database, computedAt: string): Promise<void> {
  const cacheKey = "list:ledger_backfill:global";
  const cached = await readFetchCache(db, cacheKey);
  if (cached) return;

  const totals = await ledgerTotalsBetween(db, TREASURY_SERVER_ID, null, null);
  for (const g of TREASURY_TYPE_GLOSSARY) {
    if (g.type === "OPENING") continue;
    const amount = roundGold(Number(totals.by_type[g.type]) || 0);
    await upsertListRow(db, {
      scope: "global",
      group_key: "treasury_type",
      category: g.type,
      label: g.label.split(" — ")[0].split(" (")[0].trim() || g.label,
      amount_g: amount,
      computed_at: computedAt,
      source_server_id: TREASURY_SERVER_ID,
    });
  }

  const intake = await townyIntakeBetween(db, TREASURY_SERVER_ID, null, null);
  for (const g of TOWNY_INTAKE_GLOSSARY) {
    const key = g.key as keyof typeof intake;
    const amount = roundGold(Number(intake[key]) || 0);
    await upsertListRow(db, {
      scope: "global",
      group_key: "towny_intake",
      category: g.key,
      label: g.label.split(" - ")[0].trim() || g.label,
      amount_g: amount,
      computed_at: computedAt,
      source_server_id: TREASURY_SERVER_ID,
    });
  }

  await writeFetchCache(db, cacheKey, { ok: true, at: computedAt });
}

async function loadScopeRows(db: D1Database, scope: string): Promise<ListRow[]> {
  const { results } = await db
    .prepare(
      `SELECT scope, group_key, category, label, amount_g, computed_at, source_server_id
       FROM rootmc_list_totals WHERE scope = ?`,
    )
    .bind(scope)
    .all<ListRow>();
  return results ?? [];
}

async function rollupScopes(
  db: D1Database,
  sources: string[],
  target: string,
  computedAt: string,
): Promise<void> {
  const map = new Map<string, ListRow>();
  for (const scope of sources) {
    const rows = await loadScopeRows(db, scope);
    for (const row of rows) {
      if (String(row.category).toUpperCase() === "OPENING") continue;
      const key = `${row.group_key}\0${row.category}`;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { ...row, scope: target, amount_g: roundGold(row.amount_g), computed_at: computedAt });
      } else {
        prev.amount_g = roundGold(prev.amount_g + row.amount_g);
        prev.computed_at = computedAt;
      }
    }
  }
  for (const row of map.values()) {
    await upsertListRow(db, row);
  }
}

/** After MySQL economy pull: mirror host list_totals into D1 and roll up official/global. */
export async function runListTotalsSnapshot(
  env: RootStatEnv,
  mysqlConn: Connection | null,
  mysqlPrefix: string,
): Promise<{ hostRows: number }> {
  const computedAt = nowIso();
  let hostRows = 0;

  // Opening balance is not shown on /list — drop stale rows.
  await env.DB.prepare(
    `DELETE FROM rootmc_list_totals
     WHERE category = 'OPENING' OR LOWER(label) = 'opening balance'`,
  ).run();

  if (mysqlConn) {
    const rows = await pullMysqlListTotals(mysqlConn, mysqlPrefix);
    hostRows = rows.length;
    for (const row of rows) {
      if (row.scope !== "claims" && row.scope !== "towny") continue;
      if (row.category.toUpperCase() === "OPENING") continue;
      await upsertListRow(env.DB, {
        ...row,
        computed_at: row.computed_at || computedAt,
      });
    }
  }

  const claims = await loadScopeRows(env.DB, "claims");
  const towny = await loadScopeRows(env.DB, "towny");
  if (claims.length === 0 && towny.length === 0) {
    await backfillGlobalFromLedger(env.DB, computedAt);
  }

  await rollupScopes(env.DB, ["claims", "towny"], "official", computedAt);

  // Gen2 rows would use scope g2 when present; for now global mirrors official (+ any g2).
  const g2 = await loadScopeRows(env.DB, "g2");
  if (g2.length > 0) {
    await rollupScopes(env.DB, ["claims", "towny", "g2"], "global", computedAt);
  } else {
    await rollupScopes(env.DB, ["claims", "towny"], "global", computedAt);
    if (claims.length === 0 && towny.length === 0) {
      // keep ledger backfill on global; also copy global → official for empty hosts
      const globalRows = await loadScopeRows(env.DB, "global");
      for (const row of globalRows) {
        await upsertListRow(env.DB, { ...row, scope: "official", computed_at: computedAt });
      }
    }
  }

  return { hostRows };
}

function emptyCatalog(): Record<string, { category: string; label: string; amount_g: number | null }[]> {
  const treasury = TREASURY_TYPE_GLOSSARY.filter((g) => g.type !== "OPENING").map((g) => ({
    category: g.type,
    label: g.label.split(" — ")[0].split(" (")[0].trim() || g.label,
    amount_g: null as number | null,
  }));
  const towny = TOWNY_INTAKE_GLOSSARY.map((g) => ({
    category: g.key,
    label: g.label.split(" - ")[0].trim() || g.label,
    amount_g: null as number | null,
  }));
  const supply = SUPPLY_LABELS.map((g) => ({ ...g, amount_g: null as number | null }));
  const pools = POOL_LABELS.map((g) => ({ ...g, amount_g: null as number | null }));
  return {
    treasury_type: treasury,
    towny_intake: towny,
    supply,
    pools,
  };
}

function fillCatalog(
  catalog: Record<string, { category: string; label: string; amount_g: number | null }[]>,
  rows: ListRow[],
): void {
  const byGroup = new Map<string, Map<string, ListRow>>();
  for (const row of rows) {
    if (String(row.category).toUpperCase() === "OPENING") continue;
    if (!byGroup.has(row.group_key)) byGroup.set(row.group_key, new Map());
    byGroup.get(row.group_key)!.set(row.category, row);
  }
  for (const [group, items] of Object.entries(catalog)) {
    const map = byGroup.get(group);
    for (const item of items) {
      const hit = map?.get(item.category);
      if (hit) {
        item.amount_g = roundGold(hit.amount_g);
        if (hit.label) item.label = hit.label;
      } else {
        item.amount_g = 0;
      }
    }
  }
}

export async function listTotalsPublicPayload(db: D1Database): Promise<Record<string, unknown>> {
  const scopes = ["claims", "towny", "official", "global"] as const;
  let anyRows = false;
  for (const scope of scopes) {
    const rows = await loadScopeRows(db, scope);
    if (rows.length > 0) {
      anyRows = true;
      break;
    }
  }
  if (!anyRows) {
    try {
      await backfillGlobalFromLedger(db, nowIso());
      await rollupScopes(db, ["global"], "official", nowIso());
    } catch (e) {
      console.warn("list_totals_bootstrap_failed", String(e).slice(0, 300));
    }
  }

  const out: Record<string, unknown> = {};
  let updatedAt: string | null = null;
  const collectionStarts: Record<string, string> = {};

  for (const scope of scopes) {
    const rows = await loadScopeRows(db, scope);
    for (const r of rows) {
      if (!updatedAt || r.computed_at > updatedAt) updatedAt = r.computed_at;
    }
    const catalog = emptyCatalog();
    fillCatalog(catalog, rows);
    out[scope] = catalog;
    collectionStarts[scope] = DATA_COLLECTION_START[scope] || MAP_262_RESET_DATE_HST;
  }

  return {
    updated_at: updatedAt,
    data_collection_start: MAP_262_RESET_DATE_HST,
    scopes: out,
    scope_meta: Object.fromEntries(
      scopes.map((scope) => [
        scope,
        { data_collection_start: collectionStarts[scope] || MAP_262_RESET_DATE_HST },
      ]),
    ),
  };
}

export async function handleListPublicRoutes(
  request: Request,
  env: RootStatEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (method !== "GET") return null;
  if (subpath !== "/rootmc/list" && subpath !== "/rootmc/list/") return null;
  try {
    const payload = await listTotalsPublicPayload(env.DB);
    return withShortPublicCache(json(payload));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Table may not exist until migration applied.
    if (/no such table: rootmc_list/i.test(msg)) {
      return withShortPublicCache(
        json({
          updated_at: null,
          scopes: {
            claims: emptyCatalog(),
            towny: emptyCatalog(),
            official: emptyCatalog(),
            global: emptyCatalog(),
          },
          error: "list_totals_not_migrated",
        }),
      );
    }
    throw e;
  }
}

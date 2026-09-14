import type { D1Database } from "@cloudflare/workers-types";

import { summarizeFarmsPlots, summarizeFarmsPlotsJson } from "./farms-catalog";
import { parseTierPlotsJson, VEGETABLE_COUNT } from "./farms-orchards";
import {
  loadEconomyDailySeries,
  readCirculationTotals,
  touchRootEconomy,
  type CirculationTotals,
} from "../../shared/root-economy-snapshot";
import { json } from "./cors";
import { formatRootsAtomic, formatRootsAtomicLocale } from "../../shared/roots-units";

export interface RootEconomyEnv {
  DB: D1Database;
}

export function shortenSolanaPubkey(pubkey: string): string {
  const s = String(pubkey || "").trim();
  if (!s) return "—";
  if (s.length <= 12) return s;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function sanitizePublicDisplayName(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.length > 32) return null;
  if (!/^[a-zA-Z0-9 _.-]+$/.test(s)) return null;
  return s;
}

export async function readPublicDisplayName(db: D1Database, accountId: string): Promise<string | null> {
  try {
    const row = await db
      .prepare("SELECT public_display_name FROM license_accounts WHERE id = ?")
      .bind(accountId)
      .first<{ public_display_name: string | null }>();
    const n = row?.public_display_name?.trim();
    return n || null;
  } catch {
    return null;
  }
}

/** PATCH `/v1/me/profile` — optional public display name for Root Economy. */
export async function handleMeProfilePatch(request: Request, env: RootEconomyEnv & { JWT_SECRET: string }): Promise<Response> {
  const { sessionFromRequest } = await import("./primary-auth");
  const sess = await sessionFromRequest(env, request);
  if (!sess) return json({ detail: "Unauthorized" }, 401);

  let body: { public_display_name?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }

  if (!("public_display_name" in body)) {
    return json({ detail: "public_display_name is required (use empty string to clear)." }, 400);
  }

  const name = sanitizePublicDisplayName(body.public_display_name);
  if (body.public_display_name != null && String(body.public_display_name).trim() && !name) {
    return json(
      { detail: "Display name must be 1–32 characters: letters, numbers, spaces, underscore, hyphen, or period." },
      400,
    );
  }

  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE license_accounts SET public_display_name = ?, updated_at = ? WHERE id = ?")
    .bind(name, now, sess.accountId)
    .run();

  return json({ ok: true, public_display_name: name });
}

type LeaderRow = {
  balance: number;
  wallet_pubkey: string;
  public_display_name: string | null;
  discord_username: string | null;
  discord_global_name: string | null;
  plots_json: string | null;
  vegetables_json: string | null;
};

export type EconomyLeaderEntry = {
  rank: number;
  balance: number;
  wallet_short: string;
  public_display_name: string | null;
  discord_username: string | null;
  discord_global_name: string | null;
  farms_plots_unlocked: number;
  farms_rows_accumulated: number;
};

export type EconomyLeaderboardData = {
  updated_at: string;
  total_circulation: number;
  entries: EconomyLeaderEntry[];
};

const LEADERBOARD_SQL = `SELECT b.balance AS balance,
              iw.pubkey AS wallet_pubkey,
              la.public_display_name AS public_display_name,
              dal.discord_username AS discord_username,
              dal.discord_global_name AS discord_global_name,
              fp.plots_json AS plots_json,
              fp.vegetables_json AS vegetables_json
       FROM rr_earn_balance b
       INNER JOIN license_accounts la ON b.user_id = ('user:' || lower(la.email))
       INNER JOIN internal_solana_wallets iw ON iw.account_id = la.id
       LEFT JOIN discord_account_links dal ON dal.account_id = la.id
       LEFT JOIN rr_farms_progress fp ON fp.user_id = b.user_id
       WHERE b.balance > 0
       ORDER BY b.balance DESC, iw.pubkey ASC
       LIMIT 100`;

export function formatEconomyUnits(n: number): string {
  return formatRootsAtomic(n);
}

export function formatEconomyUnitsLocale(n: number): string {
  return formatRootsAtomicLocale(n);
}

export function leaderboardEntryLabel(e: EconomyLeaderEntry): string {
  if (e.public_display_name) return e.public_display_name;
  if (e.discord_global_name) return e.discord_global_name;
  if (e.discord_username) {
    const u = e.discord_username.replace(/^@/, "");
    return `@${u}`;
  }
  return e.wallet_short;
}

function summarizeCombinedFarmsProgress(rootPlotsJson: string | null, vegetablesJson: string | null) {
  const roots = summarizeFarmsPlotsJson(rootPlotsJson);
  const vegetables = summarizeFarmsPlots(parseTierPlotsJson(vegetablesJson, VEGETABLE_COUNT));
  return {
    plots_unlocked: roots.plots_unlocked + vegetables.plots_unlocked,
    rows_accumulated: roots.rows_accumulated + vegetables.rows_accumulated,
    rows_active: roots.rows_active + vegetables.rows_active,
  };
}

export async function loadEconomyLeaderboardData(db: D1Database): Promise<EconomyLeaderboardData> {
  const [rows, totals] = await Promise.all([
    db.prepare(LEADERBOARD_SQL).all<LeaderRow>(),
    readCirculationTotals(db),
  ]);

  const entries = (rows.results || []).map((r, i) => {
    const balance = Math.max(0, Math.floor(Number(r.balance) || 0));
    const wallet_pubkey = String(r.wallet_pubkey || "").trim();
    const public_display_name = r.public_display_name?.trim() || null;
    const discord_username = r.discord_username?.trim() || null;
    const discord_global_name = r.discord_global_name?.trim() || null;
    const farms = summarizeCombinedFarmsProgress(r.plots_json, r.vegetables_json);
    return {
      rank: i + 1,
      balance,
      wallet_short: shortenSolanaPubkey(wallet_pubkey),
      public_display_name,
      discord_username,
      discord_global_name,
      farms_plots_unlocked: farms.plots_unlocked,
      farms_rows_accumulated: farms.rows_accumulated,
    };
  });

  return {
    updated_at: new Date().toISOString(),
    total_circulation: totals.total_circulation,
    entries,
  };
}

function parseDaysParam(url: URL): number {
  const raw = parseInt(url.searchParams.get("days") || "90", 10);
  if (!Number.isFinite(raw)) return 90;
  return Math.min(365, Math.max(7, raw));
}

function mergeSeriesWithLive(
  series: Awaited<ReturnType<typeof loadEconomyDailySeries>>,
  live: CirculationTotals,
  today: string,
): { day: string; total_circulation: number; account_count: number }[] {
  const out = [...series];
  const last = out[out.length - 1];
  if (last?.day === today) {
    last.total_circulation = live.total_circulation;
    last.account_count = live.account_count;
  } else {
    out.push({
      day: today,
      total_circulation: live.total_circulation,
      account_count: live.account_count,
    });
  }
  return out;
}

/** GET `/v1/economy/daily` — public circulation history (UTC days). */
export async function handleEconomyDaily(request: Request, env: RootEconomyEnv): Promise<Response> {
  const url = new URL(request.url);
  const days = parseDaysParam(url);
  const today = new Date().toISOString().slice(0, 10);

  let live: CirculationTotals;
  try {
    live = await touchRootEconomy(env.DB, "public_read");
  } catch {
    live = await readCirculationTotals(env.DB);
  }

  let series = await loadEconomyDailySeries(env.DB, days);
  if (!series.length) {
    series = [{ day: today, total_circulation: live.total_circulation, account_count: live.account_count }];
  } else {
    series = mergeSeriesWithLive(series, live, today);
  }

  return json(
    {
      ok: true,
      updated_at: new Date().toISOString(),
      days,
      total_circulation: live.total_circulation,
      account_count: live.account_count,
      series,
    },
    200,
    { "Cache-Control": "public, max-age=15" },
  );
}

export function buildEconomyDiscordMessage(data: EconomyLeaderboardData): string {
  const total = data.total_circulation;
  const lines: string[] = [
    "**Root Economy** — top Root Units balances",
    `**Internal circulation:** **${formatEconomyUnitsLocale(total)} Roots** (${formatEconomyUnits(total)} total in linked accounts)`,
    "",
  ];
  if (data.entries.length === 0) {
    lines.push("No balances yet.");
  } else {
    for (const e of data.entries.slice(0, 15)) {
      const farm =
        e.farms_plots_unlocked > 0
          ? ` · ${e.farms_plots_unlocked} total plot${e.farms_plots_unlocked === 1 ? "" : "s"}, ${e.farms_rows_accumulated} total rows`
          : "";
      lines.push(`**${e.rank}.** ${leaderboardEntryLabel(e)} — **${formatEconomyUnits(e.balance)}**${farm}`);
    }
    if (data.entries.length > 15) {
      lines.push(`_Showing 15 of ${data.entries.length} on the board._`);
    }
  }
  lines.push("", "Full leaderboard: **https://farms.rootrecord.info/**");
  let content = lines.join("\n");
  if (content.length > 1950) content = `${content.slice(0, 1940)}…`;
  return content;
}

/** GET `/v1/economy/leaderboard` — public top-100 Root Units balances. */
export async function handleEconomyLeaderboard(env: RootEconomyEnv): Promise<Response> {
  try {
    await touchRootEconomy(env.DB, "public_read");
  } catch {
    /* serve cached leaderboard */
  }
  const data = await loadEconomyLeaderboardData(env.DB);

  return json(
    {
      ok: true,
      updated_at: data.updated_at,
      total_circulation: data.total_circulation,
      count: data.entries.length,
      entries: data.entries,
    },
    200,
    { "Cache-Control": "public, max-age=15" },
  );
}

export async function handleRootEconomyRoutes(
  request: Request,
  env: RootEconomyEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (sub === "/v1/economy/leaderboard" && method === "GET") {
    return handleEconomyLeaderboard(env);
  }
  if (sub === "/v1/economy/daily" && method === "GET") {
    return handleEconomyDaily(request, env);
  }
  return null;
}

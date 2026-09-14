import type { ExecutionContext } from "@cloudflare/workers-types";

import { resolveUserId } from "./auth";
import { json } from "./cors";
import {
  FREE_DAILY_AI_LIMIT,
  PRO_MONTHLY_AI_LIMIT,
  loadProFlags,
  utcDayKey,
  utcMonthKey,
} from "./free-tier";
import { netWorthForPlayer, shopListingsForPlayer, shopPriceCatalog } from "./rootmc-economy";
import { publicMapUrl, publicServerAddress } from "./rootmc-server";
import { mcmmoStatsForPlayer, playtimeStatsForPlayer } from "./rootstat-minecraft";
import {
  type RootMcAiEnv,
  callGrokRootMcReport,
  compactWorldPayload,
  grokUserErrorMessage,
  insertReport,
  latestReports,
  quotaPayload,
  reportPayload,
  usedThisMonth,
  usedToday,
} from "./rootmc-world-ai";
import { latestRootMcReportBefore, previousReportForPrompt } from "./rootmc-ai-report-store";
import { ROOTMC_PLAYER_SERVER_AI_SYSTEM_PROMPT } from "./rootmc-grok-prompts";

const SERVER_AI_SYSTEM_PROMPT = ROOTMC_PLAYER_SERVER_AI_SYSTEM_PROMPT;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function recordArray(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object" && !Array.isArray(x)))
    : [];
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}...` : t;
}

function serverReportKey(serverId: string): string {
  return `server:${serverId.trim().slice(0, 120)}`;
}

function mergeWorldPayloads(worlds: Array<Record<string, unknown>>): Record<string, unknown> {
  const mergedNotes: Array<Record<string, unknown>> = [];
  const mergedCoords: Array<Record<string, unknown>> = [];
  const mergedPlans: Array<Record<string, unknown>> = [];
  let noteCount = 0;
  let coordCount = 0;
  let planCount = 0;

  for (const raw of worlds.slice(0, 6)) {
    const compact = compactWorldPayload(raw);
    noteCount += Number(record(compact.stats).note_count || 0);
    coordCount += Number(record(compact.stats).coord_count || 0);
    planCount += Number(record(compact.stats).build_plan_count || 0);
    mergedNotes.push(...recordArray(compact.notes));
    mergedCoords.push(...recordArray(compact.coordinates));
    mergedPlans.push(...recordArray(compact.build_plans));
  }

  return {
    stats: {
      note_count: noteCount,
      coord_count: coordCount,
      build_plan_count: planCount,
      worlds_included: worlds.length,
    },
    notes: mergedNotes.slice(0, 48),
    coordinates: mergedCoords.slice(0, 40),
    build_plans: mergedPlans.slice(0, 12),
  };
}

async function buildServerSnapshot(
  env: RootMcAiEnv,
  serverId: string,
  serverName: string,
  accountId: string,
  worldsPayload: Array<Record<string, unknown>>,
): Promise<{ compact: Record<string, unknown>; linked: boolean }> {
  const link = await env.DB.prepare(
    `SELECT minecraft_uuid, minecraft_username FROM rootstat_minecraft_links WHERE account_id = ? LIMIT 1`,
  )
    .bind(accountId)
    .first<Record<string, unknown>>();

  const uuid = str(link?.minecraft_uuid);
  const username = str(link?.minecraft_username) || null;

  const serverRow = await env.DB.prepare(
    `SELECT server_name, server_address, default_world_name, game_version, map_url
     FROM rootstat_servers WHERE server_id = ? LIMIT 1`,
  )
    .bind(serverId)
    .first<Record<string, unknown>>();

  const mcmmo = uuid ? await mcmmoStatsForPlayer(env.DB, serverId, uuid) : null;
  const playtime = uuid ? await playtimeStatsForPlayer(env.DB, serverId, uuid) : null;
  const netWorth = uuid ? await netWorthForPlayer(env.DB, serverId, uuid) : null;
  const shopPrices = await shopPriceCatalog(env.DB, serverId, 16);
  const myListings = uuid ? await shopListingsForPlayer(env.DB, serverId, uuid, 12) : [];

  const notesBlock = mergeWorldPayloads(worldsPayload);

  const compact = {
    server: {
      server_id: serverId,
      name: serverName || str(serverRow?.server_name) || serverId,
      address: publicServerAddress(str(serverRow?.server_address) || null),
      default_world_name: str(serverRow?.default_world_name) || null,
      game_version: str(serverRow?.game_version) || null,
      map_url: publicMapUrl(str(serverRow?.map_url) || null),
    },
    minecraft_player: uuid ? { username, uuid } : null,
    smp_stats: {
      mcmmo,
      playtime,
      net_worth: netWorth,
    },
    economy: {
      sample_prices: shopPrices.slice(0, 12),
      my_shop_listings: myListings,
    },
    block_notes: notesBlock,
    stats: record(notesBlock.stats),
  };

  return { compact, linked: Boolean(uuid) };
}

function buildServerPromptContext(
  serverKey: string,
  serverName: string,
  compact: Record<string, unknown>,
  priorReport: Record<string, unknown> | null,
): Record<string, unknown> {
  return {
    generated_at: new Date().toISOString(),
    app: "RootMC",
    report_kind: "server_player",
    instruction:
      "Analyze this player's standing and notes on the RootMC SMP. " +
      "Cover mcMMO progression, playtime, net worth, shop activity, and saved build/coord notes from companion-app worlds on this server. " +
      "Deliver ultra-professional, actionable guidance. Use only supplied data.",
    world_key: serverKey,
    world_name: serverName,
    server_data: compact,
    previous_report: priorReport,
  };
}

function serverHasData(compact: Record<string, unknown>, linked: boolean): boolean {
  const stats = record(compact.stats);
  const notes = record(compact.block_notes);
  const noteStats = record(notes.stats);
  const noteCount = Number(stats.note_count || noteStats.note_count || 0);
  const coordCount = Number(stats.coord_count || noteStats.coord_count || 0);
  const smp = record(compact.smp_stats);
  if (noteCount > 0 || coordCount > 0) return true;
  if (smp.mcmmo || smp.playtime || smp.net_worth) return true;
  if (linked) return true;
  return false;
}

async function responseForServer(
  env: RootMcAiEnv,
  userId: string,
  serverKey: string,
  serverName: string,
  pro: boolean,
  dayUtc: string,
  monthUtc: string,
  status = 200,
): Promise<Response> {
  const usedDay = await usedToday(env.DB, userId, dayUtc);
  const usedMonth = await usedThisMonth(env.DB, userId, monthUtc);
  const reports = await latestReports(env.DB, userId, serverKey);
  return json(
    {
      server_id: serverKey.replace(/^server:/, ""),
      server_key: serverKey,
      server_name: serverName,
      reports: reports.map(reportPayload),
      quota: quotaPayload(pro, usedDay, usedMonth, dayUtc, monthUtc),
      pro_unlocked: pro,
    },
    status,
  );
}

export async function handleRootMcServerAi(
  request: Request,
  env: RootMcAiEnv,
  subpath: string,
  method: string,
  _ctx?: ExecutionContext,
): Promise<Response | null> {
  if (subpath !== "/rootmc/server-ai") return null;

  const user = await resolveUserId(request, env);
  if (user instanceof Response) return user;

  const { pro } = await loadProFlags(env.DB, user);
  const dayUtc = utcDayKey();
  const monthUtc = utcMonthKey();

  let serverId = "";
  let serverName = "";
  let worldsPayload: Array<Record<string, unknown>> = [];

  if (method === "GET") {
    const url = new URL(request.url);
    serverId = url.searchParams.get("server_id") || "";
    serverName = url.searchParams.get("server_name") || "";
  } else if (method === "POST") {
    let body: { server_id?: string; server_name?: string; worlds_payload?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON" }, 400);
    }
    serverId = body.server_id || "";
    serverName = body.server_name || "";
    worldsPayload = recordArray(body.worlds_payload);
  } else {
    return null;
  }

  serverId = serverId.trim().slice(0, 120);
  serverName = truncate(serverName.trim() || serverId, 120);
  if (!serverId) return json({ detail: "server_id is required." }, 400);

  const serverKey = serverReportKey(serverId);

  if (method === "GET") {
    return responseForServer(env, user, serverKey, serverName || serverId, pro, dayUtc, monthUtc);
  }

  const usedDay = await usedToday(env.DB, user, dayUtc);
  const usedMonth = await usedThisMonth(env.DB, user, monthUtc);

  if (pro) {
    if (usedMonth >= PRO_MONTHLY_AI_LIMIT) {
      return json(
        {
          detail: "quota_exceeded",
          message: `Pro members can generate up to ${PRO_MONTHLY_AI_LIMIT} world AI reports per month.`,
          quota: quotaPayload(pro, usedDay, usedMonth, dayUtc, monthUtc),
          pro_unlocked: true,
        },
        429,
      );
    }
  } else if (usedDay >= FREE_DAILY_AI_LIMIT) {
    return json(
      {
        detail: "quota_exceeded",
        message: "Free accounts can generate 1 world AI report per day. Upgrade for up to 100 per month.",
        quota: quotaPayload(pro, usedDay, usedMonth, dayUtc, monthUtc),
        pro_unlocked: false,
      },
      429,
    );
  }

  const { compact, linked } = await buildServerSnapshot(env, serverId, serverName, user, worldsPayload);
  if (!serverHasData(compact, linked)) {
    return json(
      {
        detail: "server_data_empty",
        message:
          "Link your account (/rootmc link), play on this server, or add RootMC worlds in the companion app before generating a report.",
      },
      409,
    );
  }

  const priorRow = await latestRootMcReportBefore(env.DB, user, serverKey);
  const priorReport = previousReportForPrompt(priorRow);
  const promptContext = buildServerPromptContext(serverKey, serverName, compact, priorReport);
  const ai = await callGrokRootMcReport(env, SERVER_AI_SYSTEM_PROMPT, promptContext, {
    temperature: 0.2,
    reportMax: 2000,
  });
  if (ai.fallback_report || ai.ok !== true) {
    const detail = str(ai.detail) || "World AI report is temporarily unavailable.";
    return json(
      {
        detail: "ai_unavailable",
        message: grokUserErrorMessage(detail, Number(ai.status) || 503),
        quota: quotaPayload(pro, usedDay, usedMonth, dayUtc, monthUtc),
        pro_unlocked: pro,
      },
      503,
    );
  }

  const row = await insertReport(
    env,
    user,
    serverKey,
    serverName,
    compact,
    promptContext,
    ai,
    dayUtc,
    monthUtc,
    priorRow?.id || null,
  );
  if (!row) return json({ detail: "Could not save world AI report." }, 500);

  const nextDay = await usedToday(env.DB, user, dayUtc);
  const nextMonth = await usedThisMonth(env.DB, user, monthUtc);
  const reports = await latestReports(env.DB, user, serverKey);

  return json(
    {
      server_id: serverId,
      server_key: serverKey,
      server_name: serverName,
      report: reportPayload(row),
      reports: reports.map(reportPayload),
      quota: quotaPayload(pro, nextDay, nextMonth, dayUtc, monthUtc),
      pro_unlocked: pro,
    },
    200,
  );
}

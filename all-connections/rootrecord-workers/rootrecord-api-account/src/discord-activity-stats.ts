import type { D1Database } from "@cloudflare/workers-types";
import { json } from "./cors";
import { verifyWorkerOpsAdmin } from "./push";

export type DiscordActivityStatsEnv = {
  DB: D1Database;
  RR_PUSH_ADMIN_SECRET?: string;
  DISCORD_ANNOUNCEMENTS_CHANNEL_ID?: string;
};

const NO_STORE = { "Cache-Control": "no-store, max-age=0, must-revalidate" } as const;

/** GET /api/internal/discord-activity-daily?days=14&channel_id=all|<id> — UTC days (`X-RR-Push-Admin-Key`). */
export async function handleDiscordActivityDailyGet(request: Request, env: DiscordActivityStatsEnv): Promise<Response> {
  const secret = (env.RR_PUSH_ADMIN_SECRET || "").trim();
  if (!secret) return json({ detail: "RR_PUSH_ADMIN_SECRET is not set on this Worker." }, 503, NO_STORE);
  if (!(await verifyWorkerOpsAdmin(request, env))) {
    const has = Boolean(request.headers.get("X-RR-Push-Admin-Key"));
    return json({ detail: has ? "Invalid admin key." : "Missing X-RR-Push-Admin-Key header." }, 401, NO_STORE);
  }

  let days = 14;
  const raw = new URL(request.url).searchParams.get("days");
  if (raw != null) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) days = Math.min(366, Math.max(1, n));
  }

  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const startStr = start.toISOString().slice(0, 10);

  const channelParam = (new URL(request.url).searchParams.get("channel_id") || "all").trim();
  const oneChannel = channelParam && channelParam !== "all" ? channelParam : null;

  const chList = await env.DB.prepare(
    `SELECT channel_id, name, type FROM discord_discovered_channels ORDER BY position ASC, name ASC`,
  ).all<{ channel_id: string; name: string | null; type: number }>();

  let q: { results?: { day: string; message_count: number }[] };
  if (oneChannel) {
    q = await env.DB.prepare(
      `SELECT day, message_count FROM discord_activity_daily_by_channel WHERE day >= ? AND channel_id = ? ORDER BY day ASC`,
    )
      .bind(startStr, oneChannel)
      .all<{ day: string; message_count: number }>();
  } else {
    const agg = await env.DB
      .prepare(
        `SELECT day, SUM(message_count) AS message_count
         FROM discord_activity_daily_by_channel
         WHERE day >= ?
         GROUP BY day
         ORDER BY day ASC`,
      )
      .bind(startStr)
      .all<{ day: string; message_count: number }>();
    if ((agg.results ?? []).length > 0) {
      q = agg;
    } else {
      q = await env.DB.prepare(`SELECT day, message_count FROM discord_activity_daily WHERE day >= ? ORDER BY day ASC`)
        .bind(startStr)
        .all<{ day: string; message_count: number }>();
    }
  }

  const byChannelDaily = await env.DB
    .prepare(
      `SELECT day, channel_id, message_count FROM discord_activity_daily_by_channel WHERE day >= ? ORDER BY day ASC, channel_id ASC LIMIT 8000`,
    )
    .bind(startStr)
    .all<{ day: string; channel_id: string; message_count: number }>();

  const byDay = new Map<string, number>();
  for (const row of q.results ?? []) {
    if (row?.day) byDay.set(String(row.day), Number(row.message_count) || 0);
  }

  const series: { day: string; message_count: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    series.push({ day: key, message_count: byDay.get(key) ?? 0 });
  }

  const distinctChannels = await env.DB
    .prepare(`SELECT COUNT(DISTINCT channel_id) AS c FROM discord_channel_message_stats`)
    .first<{ c: number }>();

  return json(
    {
      ok: true,
      days,
      series,
      channel_id: oneChannel || "all",
      channels: chList.results ?? [],
      distinct_channel_count: Number(distinctChannels?.c ?? 0),
      by_channel_daily: byChannelDaily.results ?? [],
    },
    200,
    NO_STORE,
  );
}

/**
 * POST /api/internal/discord-activity-daily-rebuild — recompute daily rollups from
 * `discord_channel_message_stats` (and seed missing rows from `developer_messages` for the
 * announcements channel).
 */
export async function handleDiscordActivityDailyRebuildPost(
  request: Request,
  env: DiscordActivityStatsEnv,
): Promise<Response> {
  const secret = (env.RR_PUSH_ADMIN_SECRET || "").trim();
  if (!secret) return json({ detail: "RR_PUSH_ADMIN_SECRET is not set on this Worker." }, 503, NO_STORE);
  if (!(await verifyWorkerOpsAdmin(request, env))) {
    const has = Boolean(request.headers.get("X-RR-Push-Admin-Key"));
    return json({ detail: has ? "Invalid admin key." : "Missing X-RR-Push-Admin-Key header." }, 401, NO_STORE);
  }

  const announce = String(env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID || "").trim();

  try {
    await env.DB.prepare(`DELETE FROM discord_activity_daily`).run();
    await env.DB.prepare(`DELETE FROM discord_activity_daily_by_channel`).run();

    if (announce) {
      await env.DB
        .prepare(
          `INSERT OR IGNORE INTO discord_channel_message_stats (discord_message_id, channel_id, created_at)
           SELECT substr(id, 9, instr(substr(id, 9), ':') - 1), ?, created_at
           FROM developer_messages
           WHERE id LIKE 'discord:%' AND instr(substr(id, 9), ':') > 0`,
        )
        .bind(announce)
        .run();
    }

    await env.DB
      .prepare(
        `INSERT INTO discord_activity_daily_by_channel (day, channel_id, message_count)
         SELECT strftime('%Y-%m-%d', created_at) AS day, channel_id, COUNT(*) AS message_count
         FROM discord_channel_message_stats
         GROUP BY day, channel_id`,
      )
      .run();

    await env.DB
      .prepare(
        `INSERT INTO discord_activity_daily (day, message_count)
         SELECT strftime('%Y-%m-%d', created_at) AS day, COUNT(*) AS message_count
         FROM discord_channel_message_stats
         GROUP BY day`,
      )
      .run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, detail: msg.slice(0, 400) }, 500, NO_STORE);
  }

  const n = await env.DB.prepare(`SELECT COUNT(*) AS c FROM discord_activity_daily`).first<{ c: number }>();
  const nc = await env.DB
    .prepare(`SELECT COUNT(*) AS c FROM discord_activity_daily_by_channel`)
    .first<{ c: number }>();
  return json(
    { ok: true, day_rows: Number(n?.c ?? 0), day_channel_rows: Number(nc?.c ?? 0) },
    200,
    NO_STORE,
  );
}

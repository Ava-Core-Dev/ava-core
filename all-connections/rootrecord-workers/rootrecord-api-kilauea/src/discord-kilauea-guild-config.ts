import type { D1Database } from "@cloudflare/workers-types";

export type GuildAlertDestination = { guild_id: string; channel_id: string };

export type GuildConfigRow = {
  guild_id: string;
  alerts_channel_id: string;
  reports_channel_id: string | null;
  configured_by_discord_id: string | null;
  updated_at: string;
};

type LegacyEnv = {
  DISCORD_GUILD_ID?: string;
  DISCORD_KILAUEA_ALERTS_CHANNEL_ID?: string;
  DISCORD_KILAUEA_REPORT_CHANNEL_ID?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

export async function getGuildConfig(db: D1Database, guildId: string): Promise<GuildConfigRow | null> {
  const gid = String(guildId || "").trim();
  if (!gid) return null;
  const row = await db
    .prepare(`SELECT * FROM kilauea_discord_guild_config WHERE guild_id = ?`)
    .bind(gid)
    .first<GuildConfigRow>();
  return row || null;
}

/** All guilds that should receive automated USGS + AI posts. Includes legacy wrangler fallback. */
export async function listGuildAlertDestinations(db: D1Database, env: LegacyEnv): Promise<GuildAlertDestination[]> {
  const { results } = await db
    .prepare(
      `SELECT guild_id, alerts_channel_id AS channel_id
       FROM kilauea_discord_guild_config
       WHERE alerts_channel_id != ''`,
    )
    .all<GuildAlertDestination>();
  const out: GuildAlertDestination[] = (results || []).map((r) => ({
    guild_id: String(r.guild_id),
    channel_id: String(r.channel_id),
  }));
  const seen = new Set(out.map((d) => `${d.guild_id}:${d.channel_id}`));
  const legacyGuild = String(env.DISCORD_GUILD_ID || "").trim();
  const legacyChannel = String(
    env.DISCORD_KILAUEA_ALERTS_CHANNEL_ID || env.DISCORD_KILAUEA_REPORT_CHANNEL_ID || "",
  ).trim();
  if (legacyGuild && legacyChannel) {
    const key = `${legacyGuild}:${legacyChannel}`;
    if (!seen.has(key)) out.push({ guild_id: legacyGuild, channel_id: legacyChannel });
  }
  return out;
}

export async function resolveGuildReportChannelId(
  db: D1Database,
  env: LegacyEnv,
  guildId: string,
): Promise<string> {
  const cfg = await getGuildConfig(db, guildId);
  if (cfg?.reports_channel_id) return String(cfg.reports_channel_id).trim();
  if (cfg?.alerts_channel_id) return String(cfg.alerts_channel_id).trim();
  if (String(env.DISCORD_GUILD_ID || "") === String(guildId) && env.DISCORD_KILAUEA_REPORT_CHANNEL_ID) {
    return String(env.DISCORD_KILAUEA_REPORT_CHANNEL_ID).trim();
  }
  return "";
}

export async function setGuildAlertsChannel(
  db: D1Database,
  guildId: string,
  channelId: string,
  configuredByDiscordId: string,
): Promise<void> {
  const gid = String(guildId || "").trim();
  const cid = String(channelId || "").trim();
  if (!gid || !cid) throw new Error("guild_id and channel_id required");
  await db
    .prepare(
      `INSERT INTO kilauea_discord_guild_config
       (guild_id, alerts_channel_id, reports_channel_id, configured_by_discord_id, updated_at)
       VALUES (?, ?, NULL, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET
         alerts_channel_id = excluded.alerts_channel_id,
         configured_by_discord_id = excluded.configured_by_discord_id,
         updated_at = excluded.updated_at`,
    )
    .bind(gid, cid, configuredByDiscordId || null, nowIso())
    .run();
}

export function memberCanManageGuild(member: Record<string, unknown> | undefined): boolean {
  const raw = member?.permissions;
  try {
    const perms = BigInt(String(raw ?? "0"));
    return (perms & 0x8n) !== 0n || (perms & 0x20n) !== 0n;
  } catch {
    return false;
  }
}

function interactionSubcommand(data: Record<string, unknown> | undefined): { name: string; options: Record<string, unknown>[] } | null {
  const opts = Array.isArray(data?.options) ? (data!.options as Record<string, unknown>[]) : [];
  const sub = opts.find((o) => Number(o.type) === 1);
  if (!sub) return null;
  const inner = Array.isArray(sub.options) ? (sub.options as Record<string, unknown>[]) : [];
  return { name: String(sub.name || ""), options: inner };
}

function channelOptionValue(options: Record<string, unknown>[], name: string): string {
  const opt = options.find((o) => String(o.name || "") === name);
  return String(opt?.value || "").trim();
}

export async function handleConfigCommand(
  body: Record<string, unknown>,
  env: { DB: D1Database } & LegacyEnv,
  member: Record<string, unknown> | undefined,
): Promise<{ content: string; flags?: number }> {
  const guildId = String(body.guild_id || "").trim();
  if (!guildId) {
    return { content: "This command can only be used in a server.", flags: 64 };
  }
  if (!memberCanManageGuild(member)) {
    return { content: "You need **Manage Server** (or Administrator) to configure Kilauea Alerts.", flags: 64 };
  }

  const data = body.data as Record<string, unknown> | undefined;
  const sub = interactionSubcommand(data);
  if (!sub) {
    return { content: "Use `/config set` or `/config show`.", flags: 64 };
  }

  if (sub.name === "show") {
    const cfg = await getGuildConfig(env.DB, guildId);
    if (!cfg) {
      return {
        content:
          "No channel configured yet. Run **`/config set channel:#your-alerts-channel`** — USGS quakes and AI summaries will post there.",
        flags: 64,
      };
    }
    return {
      content: `**Alerts channel:** <#${cfg.alerts_channel_id}>\nConfigured ${cfg.updated_at.replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}.`,
      flags: 64,
    };
  }

  if (sub.name === "set") {
    const channelId = channelOptionValue(sub.options, "channel");
    if (!/^\d{10,}$/.test(channelId)) {
      return { content: "Pick a text channel for **`channel`**.", flags: 64 };
    }
    const uid = String(
      ((member?.user as Record<string, unknown> | undefined)?.id as string) || "",
    ).trim();
    await setGuildAlertsChannel(env.DB, guildId, channelId, uid);
    return {
      content: `Kilauea Alerts will post USGS earthquakes and AI summaries to <#${channelId}>.`,
      flags: 64,
    };
  }

  return { content: "Unknown subcommand. Use **`/config set`** or **`/config show**`.", flags: 64 };
}

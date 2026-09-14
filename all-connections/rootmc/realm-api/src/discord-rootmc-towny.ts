import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import {
  createChannelInvite,
  createGuildTextChannel,
  deleteGuildChannel,
  discordChannelSlug,
  discordUserForMinecraftUuid,
  patchChannel,
  sendChannelMessage,
  sendDirectMessage,
  setChannelPermissionOverwrite,
} from "./discord-rootmc-api";
import { FEATURED_SERVER_DEFAULTS } from "./rootmc-server";
import { resolveDiscordChannel } from "./rootmc-discord-channels";
import { validateServerAuth } from "./rootstat-minecraft";
import type { RootStatEnv } from "./rootstat-minecraft";

export type RootMcTownyDiscordEnv = RootStatEnv & {
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_ROOTMC_GUILD_ID?: string;
  DISCORD_ROOTMC_TOWN_CATEGORY_ID?: string;
  DISCORD_ROOTMC_NATION_CATEGORY_ID?: string;
  DISCORD_ROOTMC_TOWN_ARCHIVE_CATEGORY_ID?: string;
  DISCORD_ROOTMC_NATION_ARCHIVE_CATEGORY_ID?: string;
  DISCORD_ROOTMC_TOWN_INFO_CHANNEL_ID?: string;
  DISCORD_ROOTMC_NATION_INFO_CHANNEL_ID?: string;
};

type TownyAnnounceEvent =
  | {
      kind: "town";
      event: "founded" | "fallen";
      uuid: string;
      name: string;
      mayor_name: string | null;
      resident_count?: number;
      nation_name?: string | null;
    }
  | {
      kind: "nation";
      event: "founded" | "fallen";
      uuid: string;
      name: string;
      leader_name: string | null;
      town_count?: number;
    };

type TownRow = {
  town_uuid: string;
  town_name: string;
  mayor_uuid: string | null;
  mayor_name: string | null;
  resident_count: number;
  nation_name: string | null;
  is_capital: number;
  plot_count: number;
  town_balance_gold: number;
};

type NationRow = {
  nation_uuid: string;
  nation_name: string;
  leader_uuid: string | null;
  leader_name: string | null;
  town_count: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function parseTownPayload(raw: unknown): TownRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const townUuid = str(o.town_uuid || o.uuid);
  const townName = str(o.town_name || o.name);
  if (!townUuid || !townName) return null;
  return {
    town_uuid: townUuid.toLowerCase(),
    town_name: townName,
    mayor_uuid: str(o.mayor_uuid) || null,
    mayor_name: str(o.mayor_name) || null,
    resident_count: Math.max(0, Number(o.resident_count) || 0),
    nation_name: str(o.nation_name) || null,
    is_capital: o.is_capital === true || o.is_capital === 1 ? 1 : 0,
    plot_count: Math.max(0, Number(o.plot_count) || 0),
    town_balance_gold: Math.max(0, Number(o.town_balance_gold) || 0),
  };
}

function parseNationPayload(raw: unknown): NationRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const nationUuid = str(o.nation_uuid || o.uuid);
  const nationName = str(o.nation_name || o.name);
  if (!nationUuid || !nationName) return null;
  return {
    nation_uuid: nationUuid.toLowerCase(),
    nation_name: nationName,
    leader_uuid: str(o.leader_uuid) || null,
    leader_name: str(o.leader_name) || null,
    town_count: Math.max(0, Number(o.town_count) || 0),
  };
}

function diffTownyAnnounceEvents(
  prevTowns: Array<TownRow & { is_active: number }>,
  prevNations: Array<NationRow & { is_active: number }>,
  towns: TownRow[],
  nations: NationRow[],
  seenTown: Set<string>,
  seenNation: Set<string>,
): TownyAnnounceEvent[] {
  const events: TownyAnnounceEvent[] = [];
  const prevTownMap = new Map(prevTowns.map((t) => [t.town_uuid, t]));
  const prevNationMap = new Map(prevNations.map((n) => [n.nation_uuid, n]));

  for (const t of towns) {
    const prev = prevTownMap.get(t.town_uuid);
    if (!prev || prev.is_active === 0) {
      events.push({
        kind: "town",
        event: "founded",
        uuid: t.town_uuid,
        name: t.town_name,
        mayor_name: t.mayor_name,
        resident_count: t.resident_count,
        nation_name: t.nation_name,
      });
    }
  }

  for (const prev of prevTowns) {
    if (prev.is_active === 1 && !seenTown.has(prev.town_uuid)) {
      events.push({
        kind: "town",
        event: "fallen",
        uuid: prev.town_uuid,
        name: prev.town_name,
        mayor_name: prev.mayor_name,
      });
    }
  }

  for (const n of nations) {
    const prev = prevNationMap.get(n.nation_uuid);
    if (!prev || prev.is_active === 0) {
      events.push({
        kind: "nation",
        event: "founded",
        uuid: n.nation_uuid,
        name: n.nation_name,
        leader_name: n.leader_name,
        town_count: n.town_count,
      });
    }
  }

  for (const prev of prevNations) {
    if (prev.is_active === 1 && !seenNation.has(prev.nation_uuid)) {
      events.push({
        kind: "nation",
        event: "fallen",
        uuid: prev.nation_uuid,
        name: prev.nation_name,
        leader_name: prev.leader_name,
      });
    }
  }

  return events;
}

function formatTownyAnnouncement(event: TownyAnnounceEvent, channelId?: string | null): string {
  const channelLine = channelId ? `\nTown Discord: <#${channelId}>` : "";
  const nationChannelLine = channelId ? `\nNation Discord: <#${channelId}>` : "";
  if (event.kind === "town") {
    if (event.event === "founded") {
      const nation = event.nation_name ? `\nNation: ${event.nation_name}` : "";
      return (
        `**Town Founded  -  ${event.name}**\n` +
        `Mayor: ${event.mayor_name || " - "}  -  Residents: ${event.resident_count ?? 0}${nation}${channelLine}`
      );
    }
    return (
      `**Town Fallen  -  ${event.name}**\n` +
      `Former mayor: ${event.mayor_name || " - "}\n` +
      `_This town is no longer active on RootMC. Its Discord channel has been removed._`
    );
  }

  if (event.event === "founded") {
    return (
      `**Nation Founded  -  ${event.name}**\n` +
      `Leader: ${event.leader_name || " - "}  -  Towns: ${event.town_count ?? 0}${nationChannelLine}`
    );
  }
  return (
    `**Nation Fallen  -  ${event.name}**\n` +
    `Former leader: ${event.leader_name || " - "}\n` +
    `_This nation is no longer active on RootMC. Its Discord channel has been removed._`
  );
}

async function activeChannelId(
  db: D1Database,
  serverId: string,
  kind: "town" | "nation",
  uuid: string,
): Promise<string | null> {
  const table = kind === "town" ? "rootmc_discord_town_channels" : "rootmc_discord_nation_channels";
  const uuidCol = kind === "town" ? "town_uuid" : "nation_uuid";
  const row = await db
    .prepare(
      `SELECT channel_id FROM ${table}
       WHERE server_id = ? AND ${uuidCol} = ? AND status = 'active'
       LIMIT 1`,
    )
    .bind(serverId, uuid)
    .first<{ channel_id: string }>();
  return str(row?.channel_id) || null;
}

async function announcementAlreadyPosted(
  db: D1Database,
  serverId: string,
  event: TownyAnnounceEvent,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM rootmc_towny_announcement_events
       WHERE server_id = ? AND entity_kind = ? AND entity_uuid = ? AND event_kind = ?
       LIMIT 1`,
    )
    .bind(serverId, event.kind, event.uuid, event.event)
    .first();
  return Boolean(row);
}

async function recordAnnouncement(db: D1Database, serverId: string, event: TownyAnnounceEvent): Promise<void> {
  await db
    .prepare(
      `INSERT INTO rootmc_towny_announcement_events
         (server_id, entity_kind, entity_uuid, event_kind, entity_name, announced_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(serverId, event.kind, event.uuid, event.event, event.name, nowIso())
    .run();
}

export async function announceTownyEvents(
  env: RootMcTownyDiscordEnv,
  serverId: string,
  events: TownyAnnounceEvent[],
): Promise<void> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const townInfo = resolveDiscordChannel(env, "townInfo", { allowBlank: true });
  const nationInfo = resolveDiscordChannel(env, "nationInfo", { allowBlank: true });
  if (!token || (!townInfo && !nationInfo) || events.length === 0) {
    return;
  }

  for (const event of events) {
    if (await announcementAlreadyPosted(env.DB, serverId, event)) {
      continue;
    }
    const channelId = event.kind === "town" ? townInfo : nationInfo;
    if (!channelId) continue;

    const linkedChannel =
      event.event === "founded" ? await activeChannelId(env.DB, serverId, event.kind, event.uuid) : null;
    const content = formatTownyAnnouncement(event, linkedChannel);
    const messageId = await sendChannelMessage(token, channelId, { content });
    if (!messageId) {
      console.error("rootmc_towny_announce_failed", event.kind, event.event, event.uuid);
      continue;
    }
    await recordAnnouncement(env.DB, serverId, event);
    console.log("rootmc_towny_announce_posted", event.kind, event.event, event.name);
  }
}

export async function applyTownySnapshot(
  env: RootMcTownyDiscordEnv,
  serverId: string,
  body: { towns?: unknown[]; nations?: unknown[] },
  syncedAt = nowIso(),
): Promise<{ towns: number; nations: number; synced_at: string }> {
  const towns = (Array.isArray(body.towns) ? body.towns : [])
    .map(parseTownPayload)
    .filter((town): town is TownRow => town !== null);
  const nations = (Array.isArray(body.nations) ? body.nations : [])
    .map(parseNationPayload)
    .filter((nation): nation is NationRow => nation !== null);
  const prevTownRows = await env.DB.prepare(
    `SELECT town_uuid, town_name, mayor_uuid, mayor_name, resident_count, nation_name, is_capital, is_active
     FROM rootmc_towny_towns WHERE server_id = ?`,
  )
    .bind(serverId)
    .all<TownRow & { is_active: number }>();
  const prevNationRows = await env.DB.prepare(
    `SELECT nation_uuid, nation_name, leader_uuid, leader_name, town_count, is_active
     FROM rootmc_towny_nations WHERE server_id = ?`,
  )
    .bind(serverId)
    .all<NationRow & { is_active: number }>();
  const seenTown = new Set(towns.map((town) => town.town_uuid));
  const seenNation = new Set(nations.map((nation) => nation.nation_uuid));
  const announceEvents = diffTownyAnnounceEvents(
    prevTownRows.results || [],
    prevNationRows.results || [],
    towns,
    nations,
    seenTown,
    seenNation,
  );
  for (const town of towns) {
    await env.DB.prepare(
      `INSERT INTO rootmc_towny_towns (
         server_id, town_uuid, town_name, mayor_uuid, mayor_name, resident_count,
         nation_uuid, nation_name, is_capital, plot_count, town_balance_gold, is_active, synced_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(server_id, town_uuid) DO UPDATE SET
         town_name = excluded.town_name, mayor_uuid = excluded.mayor_uuid,
         mayor_name = excluded.mayor_name, resident_count = excluded.resident_count,
         nation_name = excluded.nation_name, is_capital = excluded.is_capital,
         plot_count = excluded.plot_count, town_balance_gold = excluded.town_balance_gold,
         is_active = 1, synced_at = excluded.synced_at`,
    )
      .bind(
        serverId,
        town.town_uuid,
        town.town_name,
        town.mayor_uuid,
        town.mayor_name,
        town.resident_count,
        town.nation_name,
        town.is_capital,
        town.plot_count,
        town.town_balance_gold,
        syncedAt,
      )
      .run();
  }
  for (const nation of nations) {
    await env.DB.prepare(
      `INSERT INTO rootmc_towny_nations (
         server_id, nation_uuid, nation_name, leader_uuid, leader_name, town_count, is_active, synced_at
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(server_id, nation_uuid) DO UPDATE SET
         nation_name = excluded.nation_name, leader_uuid = excluded.leader_uuid,
         leader_name = excluded.leader_name, town_count = excluded.town_count,
         is_active = 1, synced_at = excluded.synced_at`,
    )
      .bind(
        serverId,
        nation.nation_uuid,
        nation.nation_name,
        nation.leader_uuid,
        nation.leader_name,
        nation.town_count,
        syncedAt,
      )
      .run();
  }
  if (seenTown.size > 0) {
    const placeholders = [...seenTown].map(() => "?").join(",");
    await env.DB.prepare(
      `UPDATE rootmc_towny_towns SET is_active = 0, synced_at = ?
       WHERE server_id = ? AND town_uuid NOT IN (${placeholders})`,
    )
      .bind(syncedAt, serverId, ...seenTown)
      .run();
  } else {
    await env.DB.prepare(`UPDATE rootmc_towny_towns SET is_active = 0, synced_at = ? WHERE server_id = ?`)
      .bind(syncedAt, serverId)
      .run();
  }
  if (seenNation.size > 0) {
    const placeholders = [...seenNation].map(() => "?").join(",");
    await env.DB.prepare(
      `UPDATE rootmc_towny_nations SET is_active = 0, synced_at = ?
       WHERE server_id = ? AND nation_uuid NOT IN (${placeholders})`,
    )
      .bind(syncedAt, serverId, ...seenNation)
      .run();
  } else {
    await env.DB.prepare(`UPDATE rootmc_towny_nations SET is_active = 0, synced_at = ? WHERE server_id = ?`)
      .bind(syncedAt, serverId)
      .run();
  }
  await announceTownyEvents(env, serverId, announceEvents);
  return { towns: towns.length, nations: nations.length, synced_at: syncedAt };
}

export async function handleTownySync(
  request: Request,
  env: RootMcTownyDiscordEnv,
): Promise<Response> {
  try {
    const auth = await validateServerAuth(env, request);
    if (auth instanceof Response) return auth;

  let body: { towns?: unknown[]; nations?: unknown[] };
  try {
    body = (await request.json()) as { towns?: unknown[]; nations?: unknown[] };
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }

  const result = await applyTownySnapshot(env, auth.serverId, body);
  return json({ ok: true, ...result });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("towny_sync_error", detail.slice(0, 500));
    return json({ ok: false, detail: "Towny sync failed" }, 500);
  }
}

export async function reconcileRootMcTownyDiscord(env: RootMcTownyDiscordEnv): Promise<void> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const guildId = str(env.DISCORD_ROOTMC_GUILD_ID) || "1516108585740800042";
  // Private town/nation categories temporarily removed — do not recreate channels.
  const townCategory = str(env.DISCORD_ROOTMC_TOWN_CATEGORY_ID);
  const nationCategory = str(env.DISCORD_ROOTMC_NATION_CATEGORY_ID);
  if (!townCategory && !nationCategory) {
    console.log("rootmc_towny_discord_reconcile_skip: town/nation categories unset");
    return;
  }
  if (!token) {
    console.warn("rootmc_towny_discord_skip: no bot token");
    return;
  }

  const serverId = FEATURED_SERVER_DEFAULTS.server_id;
  const ts = nowIso();

  if (townCategory) {
  const towns = await env.DB.prepare(
    `SELECT town_uuid, town_name, mayor_uuid, mayor_name, resident_count, nation_name, is_capital, is_active
     FROM rootmc_towny_towns WHERE server_id = ? ORDER BY resident_count DESC, town_name ASC`,
  )
    .bind(serverId)
    .all<TownRow & { is_active: number }>();

  let townPos = 0;
  for (const town of towns.results || []) {
    let mapping = await env.DB.prepare(
      `SELECT channel_id, status, invite_url FROM rootmc_discord_town_channels
       WHERE server_id = ? AND town_uuid = ? LIMIT 1`,
    )
      .bind(serverId, town.town_uuid)
      .first<{ channel_id: string; status: string; invite_url: string | null }>();

    if (town.is_active === 0) {
      if (mapping?.channel_id) {
        await deleteGuildChannel(token, mapping.channel_id);
        await env.DB.prepare(
          `DELETE FROM rootmc_discord_town_channels WHERE server_id = ? AND town_uuid = ?`,
        )
          .bind(serverId, town.town_uuid)
          .run();
        console.log("rootmc_towny_channel_deleted", town.town_name, mapping.channel_id);
      }
      continue;
    }

    if (!mapping?.channel_id) {
      const slug = discordChannelSlug(town.town_name, town.town_uuid);
      const topic = `RootMC town  -  ${town.resident_count} residents${town.nation_name ? `  -  ${town.nation_name}` : ""}`;
      const created = await createGuildTextChannel(token, guildId, slug, townCategory, topic);
      if (!created?.id) continue;

      const mayorDiscord = await discordUserForMinecraftUuid(env.DB, town.mayor_uuid);
      if (mayorDiscord) {
        await setChannelPermissionOverwrite(token, created.id, guildId, false);
        await setChannelPermissionOverwrite(token, created.id, mayorDiscord, true);
      }

      const invite = await createChannelInvite(token, created.id);
      await env.DB.prepare(
        `INSERT INTO rootmc_discord_town_channels (
           server_id, town_uuid, guild_id, channel_id, invite_url, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
        .bind(serverId, town.town_uuid, guildId, created.id, invite, ts, ts)
        .run();

      if (mayorDiscord && invite) {
        await sendDirectMessage(
          token,
          mayorDiscord,
          `Your RootMC town **${town.town_name}** now has a Discord channel: ${invite}\nShare it with residents and post updates regularly.`,
        );
      }
      mapping = { channel_id: created.id, status: "active", invite_url: invite };
    }

    if (mapping?.channel_id) {
      await patchChannel(token, mapping.channel_id, {
        parent_id: townCategory,
        position: townPos,
        topic: `RootMC town  -  ${town.resident_count} residents  -  Mayor: ${town.mayor_name || " - "}`,
      });
      townPos++;
    }
  }
  }

  if (nationCategory) {
  const nations = await env.DB.prepare(
    `SELECT nation_uuid, nation_name, leader_uuid, leader_name, town_count, is_active
     FROM rootmc_towny_nations WHERE server_id = ? ORDER BY town_count DESC, nation_name ASC`,
  )
    .bind(serverId)
    .all<NationRow & { is_active: number }>();

  let nationPos = 0;
  for (const nation of nations.results || []) {
    let mapping = await env.DB.prepare(
      `SELECT channel_id, status FROM rootmc_discord_nation_channels
       WHERE server_id = ? AND nation_uuid = ? LIMIT 1`,
    )
      .bind(serverId, nation.nation_uuid)
      .first<{ channel_id: string; status: string }>();

    if (nation.is_active === 0) {
      if (mapping?.channel_id) {
        await deleteGuildChannel(token, mapping.channel_id);
        await env.DB.prepare(
          `DELETE FROM rootmc_discord_nation_channels WHERE server_id = ? AND nation_uuid = ?`,
        )
          .bind(serverId, nation.nation_uuid)
          .run();
        console.log("rootmc_towny_nation_channel_deleted", nation.nation_name, mapping.channel_id);
      }
      continue;
    }

    if (!mapping?.channel_id) {
      const slug = discordChannelSlug(nation.nation_name, nation.nation_uuid);
      const topic = `RootMC nation  -  ${nation.town_count} towns`;
      const created = await createGuildTextChannel(token, guildId, slug, nationCategory, topic);
      if (!created?.id) continue;

      const leaderDiscord = await discordUserForMinecraftUuid(env.DB, nation.leader_uuid);
      if (leaderDiscord) {
        await setChannelPermissionOverwrite(token, created.id, guildId, false);
        await setChannelPermissionOverwrite(token, created.id, leaderDiscord, true);
      }

      const invite = await createChannelInvite(token, created.id);
      await env.DB.prepare(
        `INSERT INTO rootmc_discord_nation_channels (
           server_id, nation_uuid, guild_id, channel_id, invite_url, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
        .bind(serverId, nation.nation_uuid, guildId, created.id, invite, ts, ts)
        .run();

      if (leaderDiscord && invite) {
        await sendDirectMessage(
          token,
          leaderDiscord,
          `Your RootMC nation **${nation.nation_name}** now has a Discord channel: ${invite}`,
        );
      }
    } else if (mapping.channel_id) {
      await patchChannel(token, mapping.channel_id, {
        parent_id: nationCategory,
        position: nationPos,
        topic: `RootMC nation  -  ${nation.town_count} towns  -  Leader: ${nation.leader_name || " - "}`,
      });
    }
    nationPos++;
  }
  }
}

export async function handleTownyDiscordReconcileCron(env: RootMcTownyDiscordEnv): Promise<void> {
  // Disabled while town/nation private categories are removed from the guild.
  const townCategory = str(env.DISCORD_ROOTMC_TOWN_CATEGORY_ID);
  const nationCategory = str(env.DISCORD_ROOTMC_NATION_CATEGORY_ID);
  if (!townCategory && !nationCategory) {
    return;
  }
  try {
    await reconcileRootMcTownyDiscord(env);
  } catch (e) {
    console.error("rootmc_towny_discord_reconcile_failed", e instanceof Error ? e.message : String(e));
  }
}

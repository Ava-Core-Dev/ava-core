import type { D1Database } from "@cloudflare/workers-types";
import { kilaueaBotToken, postKilaueaEmbedsToChannel, type KilaueaDiscordEnv } from "./discord-kilauea-bot";
import { listGuildAlertDestinations } from "./discord-kilauea-guild-config";

// USGS earthquakes (Big Island, ~150km of Kilauea summit, M2.0+) → Discord per-guild alert channels.
// Dedupes via `kilauea_discord_guild_quake_post` per server.

const KILAUEA_SUMMIT_LAT = 19.4205;
const KILAUEA_SUMMIT_LON = -155.287;
const MAX_RADIUS_KM = 150;
const MIN_MAGNITUDE = 2.0;
const LOOKBACK_HOURS = 2;
const EMBEDS_PER_REQUEST = 10;
const PRUNE_OLDER_THAN_DAYS = 30;
const USGS_USER_AGENT = "RootRecord Kilauea Alerts (rootrecord.info)";

type UsgsFeature = {
  id?: string;
  properties?: {
    mag?: number | null;
    place?: string | null;
    time?: number | null;
    url?: string | null;
    title?: string | null;
  };
  geometry?: { coordinates?: [number, number, number] };
};

type UsgsFeatureCollection = { features?: UsgsFeature[] };

type DiscordEmbed = {
  title: string;
  url?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  timestamp?: string;
  footer?: { text: string };
};

function magnitudeColor(mag: number): number {
  if (mag >= 5.0) return 0xc81e1e;
  if (mag >= 4.0) return 0xdf1739;
  if (mag >= 3.0) return 0xf17a13;
  if (mag >= 2.5) return 0xe4b51d;
  return 0x8ac926;
}

function kmToMiles(km: number): number {
  return km * 0.621371;
}

function imperialPlace(raw: string): string {
  if (!raw) return raw;
  return raw.replace(/(\d+(?:\.\d+)?)\s*km(\b)/i, (_m, num) => {
    const mi = kmToMiles(Number(num));
    return `${mi.toFixed(mi >= 10 ? 0 : 1)} mi`;
  });
}

function buildEmbed(feat: UsgsFeature): DiscordEmbed | null {
  const props = feat?.properties || {};
  const id = String(feat?.id || "").trim();
  if (!id) return null;
  const magNum = Number(props.mag);
  if (!Number.isFinite(magNum) || magNum < MIN_MAGNITUDE) return null;
  const place = imperialPlace(String(props.place || "").trim()) || "Unknown location";
  const tMs = Number(props.time);
  const url = typeof props.url === "string" && props.url.startsWith("http") ? props.url : `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(id)}`;
  const depthKm = Array.isArray(feat?.geometry?.coordinates) ? Number(feat.geometry.coordinates[2]) : NaN;
  const depthMi = Number.isFinite(depthKm) ? kmToMiles(depthKm) : NaN;
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: "Magnitude", value: magNum.toFixed(1), inline: true },
  ];
  if (Number.isFinite(depthMi)) {
    fields.push({ name: "Depth", value: `${depthMi.toFixed(depthMi >= 10 ? 0 : 1)} mi`, inline: true });
  }
  if (Number.isFinite(tMs) && tMs > 0) {
    fields.push({ name: "Time", value: `<t:${Math.floor(tMs / 1000)}:R>`, inline: true });
  }
  return {
    title: `M ${magNum.toFixed(1)} — ${place}`.slice(0, 256),
    url,
    color: magnitudeColor(magNum),
    fields,
    timestamp: Number.isFinite(tMs) && tMs > 0 ? new Date(tMs).toISOString() : undefined,
    footer: { text: "USGS earthquake feed" },
  };
}

async function fetchKilaueaQuakes(): Promise<UsgsFeature[]> {
  const startIso = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000).toISOString();
  const u = new URL("https://earthquake.usgs.gov/fdsnws/event/1/query");
  u.searchParams.set("format", "geojson");
  u.searchParams.set("latitude", String(KILAUEA_SUMMIT_LAT));
  u.searchParams.set("longitude", String(KILAUEA_SUMMIT_LON));
  u.searchParams.set("maxradiuskm", String(MAX_RADIUS_KM));
  u.searchParams.set("minmagnitude", String(MIN_MAGNITUDE));
  u.searchParams.set("starttime", startIso);
  u.searchParams.set("orderby", "time-asc");
  const r = await fetch(u.toString(), { headers: { "User-Agent": USGS_USER_AGENT, Accept: "application/geo+json" } });
  if (!r.ok) return [];
  const data = (await r.json()) as UsgsFeatureCollection;
  return Array.isArray(data?.features) ? data.features : [];
}

async function alreadyPostedForGuild(db: D1Database, guildId: string, eventIds: string[]): Promise<Set<string>> {
  if (!eventIds.length) return new Set();
  const placeholders = eventIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT event_id FROM kilauea_discord_guild_quake_post WHERE guild_id = ? AND event_id IN (${placeholders})`,
    )
    .bind(guildId, ...eventIds)
    .all<{ event_id: string }>();
  return new Set((results || []).map((r) => String(r.event_id)));
}

async function markPostedForGuild(
  db: D1Database,
  guildId: string,
  eventIds: string[],
  nowIso: string,
): Promise<void> {
  for (const id of eventIds) {
    try {
      await db
        .prepare(
          `INSERT INTO kilauea_discord_guild_quake_post (guild_id, event_id, posted_at) VALUES (?, ?, ?)
           ON CONFLICT(guild_id, event_id) DO NOTHING`,
        )
        .bind(guildId, id, nowIso)
        .run();
    } catch (e) {
      console.warn(`usgs_kilauea_discord guild mark ${guildId} ${id}: ${String(e)}`);
    }
  }
}

async function pruneOldGuildPosts(db: D1Database): Promise<void> {
  const cutoff = new Date(Date.now() - PRUNE_OLDER_THAN_DAYS * 86400 * 1000).toISOString();
  try {
    await db.prepare(`DELETE FROM kilauea_discord_guild_quake_post WHERE posted_at < ?`).bind(cutoff).run();
  } catch {
    /* ignore */
  }
}

export async function runUsgsKilaueaDiscordCron(env: {
  DB: D1Database;
  DISCORD_KILAUEA_USGS_WEBHOOK_URL?: string;
} & KilaueaDiscordEnv): Promise<void> {
  const destinations = await listGuildAlertDestinations(env.DB, env);
  const hasBot = kilaueaBotToken(env).length >= 40;
  const hasWebhook = /^https:\/\/discord(?:app)?\.com\/api\/webhooks\//.test(
    String(env.DISCORD_KILAUEA_USGS_WEBHOOK_URL || "").trim(),
  );
  if (!destinations.length || (!hasBot && !hasWebhook)) return;

  const features = await fetchKilaueaQuakes();
  if (!features.length) {
    if (Math.random() < 0.1) await pruneOldGuildPosts(env.DB);
    return;
  }

  const eligible = features.filter(
    (f) =>
      Number.isFinite(Number(f?.properties?.mag)) &&
      Number(f.properties!.mag) >= MIN_MAGNITUDE &&
      String(f?.id || "").trim(),
  );

  const nowIso = new Date().toISOString();

  for (const dest of destinations) {
    const ids = eligible.map((f) => String(f.id));
    const posted = await alreadyPostedForGuild(env.DB, dest.guild_id, ids);
    const fresh = eligible.filter((f) => !posted.has(String(f.id)));
    if (!fresh.length) continue;

    const embeds: DiscordEmbed[] = [];
    const postedIds: string[] = [];
    for (const feat of fresh) {
      const embed = buildEmbed(feat);
      if (!embed) continue;
      embeds.push(embed);
      postedIds.push(String(feat.id));
    }
    if (!embeds.length) continue;

    for (let i = 0; i < embeds.length; i += EMBEDS_PER_REQUEST) {
      const batch = embeds.slice(i, i + EMBEDS_PER_REQUEST);
      const batchIds = postedIds.slice(i, i + EMBEDS_PER_REQUEST);
      const ok = await postKilaueaEmbedsToChannel(env, dest.channel_id, batch);
      if (ok) await markPostedForGuild(env.DB, dest.guild_id, batchIds, nowIso);
    }
  }

  if (Math.random() < 0.1) await pruneOldGuildPosts(env.DB);
}

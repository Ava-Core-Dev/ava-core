/**
 * Public chart payloads for rootmc.net/time/  -  presence windows + player peak-hour profile.
 */

import { json } from "./cors";
import { fetchActivityTimezonePublic } from "./rootmc-activity-mysql";
import { resolveServerId } from "./rootmc-daily-report";
import {
  buildPresenceChartSeries,
  parsePresenceChartRange,
  readHostLifetimeUptime,
  readMergedDevLifetimeUptime,
} from "./rootmc-host-presence";
import { readHeartbeatOnlinePlayerCount } from "./rootmc-live-economy-status";
import {
  emptyHourBuckets,
  formatPeakHours,
  formatMaintenanceWindow,
  hourInTimeZone,
  HST_OFFSET_MINUTES,
  isHourInMaintenanceWindow,
  nearestTimezoneByOffsetMinutes,
  offsetMinutesFromDate,
  peakBandPlaySeconds,
  PEAK_HOUR_COUNT,
  shiftBucketsToOffset,
  timezoneByKey,
} from "./rootmc-timezone-defs";
import { snapshotMcDay } from "./rootmc-mc-day";
import type { RootStatEnv } from "./rootstat-minecraft";

type TimeChartsEnv = RootStatEnv & {
  ROOTMC_MYSQL?: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  ROOTMC_MYSQL_TABLE_PREFIX?: string;
};

type CfGeo = {
  timezone?: string;
  city?: string;
  region?: string;
  regionCode?: string;
  country?: string;
  colo?: string;
};

function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return "12a";
  if (h < 12) return `${h}a`;
  if (h === 12) return "12p";
  return `${h - 12}p`;
}

function readCfGeo(request: Request): CfGeo {
  const cf = (request as Request & { cf?: CfGeo }).cf;
  if (!cf || typeof cf !== "object") return {};
  return {
    timezone: typeof cf.timezone === "string" ? cf.timezone : undefined,
    city: typeof cf.city === "string" ? cf.city : undefined,
    region: typeof cf.region === "string" ? cf.region : undefined,
    regionCode: typeof cf.regionCode === "string" ? cf.regionCode : undefined,
    country: typeof cf.country === "string" ? cf.country : undefined,
    colo: typeof cf.colo === "string" ? cf.colo : undefined,
  };
}

function nearestTownLabel(geo: CfGeo): string {
  const city = String(geo.city || "").trim();
  const region = String(geo.region || geo.regionCode || "").trim();
  const country = String(geo.country || "").trim();
  if (city && region && country) return `${city}, ${region}, ${country}`;
  if (city && country) return `${city}, ${country}`;
  if (city) return city;
  if (region && country) return `${region}, ${country}`;
  if (country) return country;
  return "";
}

function formatLocalClock(iana: string | undefined, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: iana || undefined,
      hour: "numeric",
      minute: "2-digit",
    }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(at);
  }
}

export async function handleTimeLocalPublic(request: Request, env: TimeChartsEnv): Promise<Response> {
  try {
    const url = new URL(request.url);
    const geo = readCfGeo(request);
    const ianaParam = String(url.searchParams.get("tz") || "").trim();
    const iana = ianaParam || geo.timezone || "";
    const offsetMinutes = offsetMinutesFromDate(new Date(), iana || undefined);
    const def = nearestTimezoneByOffsetMinutes(offsetMinutes);

    const [activity, serverId] = await Promise.all([
      fetchActivityTimezonePublic(env).catch(() => null),
      resolveServerId(env.DB).catch(() => null),
    ]);
    const zoneRow = activity?.timezones.find((z) => z.key === def.key);
    const zoneBuckets = zoneRow?.hourBuckets || emptyHourBuckets();

    // Realm-wide play remapped into the visitor's clock (same idea as /timezone server peak).
    const globalInViewer = emptyHourBuckets();
    if (activity?.mysql) {
      for (const z of activity.timezones) {
        const shifted = shiftBucketsToOffset(z.hourBuckets, z.offsetMinutes, offsetMinutes);
        for (let h = 0; h < 24; h++) globalInViewer[h] += shifted[h] || 0;
      }
    }

    // Global busiest window → visitor's clock. Local-zone peak is secondary only.
    const peakInZone = formatPeakHours(zoneBuckets, PEAK_HOUR_COUNT);
    const peakInYourClock = formatPeakHours(globalInViewer, PEAK_HOUR_COUNT);
    const peakDisplay = peakInYourClock || null;
    const peakBandSeconds = peakBandPlaySeconds(globalInViewer, PEAK_HOUR_COUNT);

    // Quietest stretch on the visitor's clock (maintenance / least busy join time).
    const maintenanceWindow = formatMaintenanceWindow(globalInViewer);
    const viewerHour = hourInTimeZone(new Date(), iana || undefined);
    const maintenanceActive =
      Boolean(maintenanceWindow) && isHourInMaintenanceWindow(globalInViewer, viewerHour);

    // HST copy kept for ops tooling that still expects server-local quiet hours.
    const globalInHst = emptyHourBuckets();
    if (activity?.mysql) {
      for (const z of activity.timezones) {
        const shifted = shiftBucketsToOffset(z.hourBuckets, z.offsetMinutes, HST_OFFSET_MINUTES);
        for (let h = 0; h < 24; h++) globalInHst[h] += shifted[h] || 0;
      }
    }
    const maintenanceWindowHst = formatMaintenanceWindow(
      globalInHst.some((v) => (v || 0) > 0) ? globalInHst : zoneBuckets,
    );

    const town = nearestTownLabel(geo);
    const known = timezoneByKey(def.key);
    // Heartbeat online count (refreshed ~often); used as "players last hour" on the home card.
    const playersLastHour =
      serverId != null
        ? await readHeartbeatOnlinePlayerCount(env.DB, serverId, 60 * 60 * 1000)
        : null;

    const mc = snapshotMcDay();
    const mcDayCard = {
      day_id: mc.day_id,
      phase: mc.phase,
      phase_detail: mc.phase_detail,
      minutes_remaining: mc.minutes_remaining,
      next_midnight_label: mc.next_midnight_label,
      time_of_day_ticks: mc.time_of_day_ticks,
      source: "hst_clock" as const,
    };

    return json({
      ok: true,
      local_time: formatLocalClock(iana || undefined),
      iana: iana || null,
      timezone_key: def.key,
      timezone_label: known?.label || def.label,
      offset_minutes: offsetMinutes,
      nearest_town: town || null,
      source: ianaParam ? "browser" : geo.timezone ? "ip" : "browser_fallback",
      // Preferred: worldwide busiest hours, labeled in the visitor's clock.
      best_join_window: peakDisplay,
      peak_in_your_clock: peakDisplay,
      peak_activity: peakDisplay,
      peak_band_play_seconds: peakBandSeconds,
      // Secondary: when players *in your Discord TZ band* tend to play (local to that band).
      peak_in_timezone: peakInZone || null,
      quiet_window: maintenanceWindow || null,
      maintenance_window: maintenanceWindow || null,
      maintenance_window_hst: maintenanceWindowHst || null,
      maintenance_active: maintenanceActive,
      players_in_timezone: zoneRow?.players || 0,
      players_last_hour: playersLastHour,
      mysql: Boolean(activity?.mysql),
      minecraft_day: {
        length_minutes: mc.length_minutes,
        timezone: mc.timezone,
        note: "Shared HST Minecraft day (20 real minutes) on Towny and Claims",
        gen1: { label: "Towny", ...mcDayCard },
        gen2: { label: "Claims", ...mcDayCard },
      },
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("time_local_public_failed", detail.slice(0, 400));
    return json({ ok: false, detail: "local timezone unavailable" }, 503);
  }
}

export async function handleTimeChartsPublic(request: Request, env: TimeChartsEnv): Promise<Response> {
  try {
    const url = new URL(request.url);
    const range = parsePresenceChartRange(url.searchParams.get("range"));
    const tzParam = String(url.searchParams.get("tz") || "").trim();
    const geo = readCfGeo(request);
    const viewerIana = tzParam || geo.timezone || "Pacific/Honolulu";
    const viewerOffset = offsetMinutesFromDate(new Date(), viewerIana);
    const serverId = await resolveServerId(env.DB);

    const [presence, activity, serverUptime, laptopUptime, primaryUptime, mergedDevUptime] =
      await Promise.all([
        buildPresenceChartSeries(env.DB, serverId, range, Date.now(), viewerIana),
        fetchActivityTimezonePublic(env).catch(() => null),
        readHostLifetimeUptime(env.DB, serverId),
        readHostLifetimeUptime(env.DB, "laptop"),
        readHostLifetimeUptime(env.DB, "primary"),
        readMergedDevLifetimeUptime(env.DB),
      ]);

    const viewerHours = emptyHourBuckets();
    if (activity?.mysql) {
      for (const z of activity.timezones) {
        const shifted = shiftBucketsToOffset(z.hourBuckets, z.offsetMinutes, viewerOffset);
        for (let h = 0; h < 24; h++) {
          viewerHours[h] += shifted[h] || 0;
        }
      }
    }

    const peakHour = viewerHours.reduce((best, v, h) => (v > (viewerHours[best] || 0) ? h : best), 0);

    const mostActive = activity
      ? [...activity.timezones]
          .filter((z) => z.playSeconds > 0 || z.players > 0)
          .sort((a, b) => b.playSeconds - a.playSeconds || b.players - a.players)
          .slice(0, 10)
          .map((z) => {
            const inViewer = shiftBucketsToOffset(z.hourBuckets, z.offsetMinutes, viewerOffset);
            return {
              key: z.key,
              label: z.label,
              players: z.players,
              peak_local: z.peakLocal,
              peak_viewer: formatPeakHours(inViewer, PEAK_HOUR_COUNT),
              play_seconds: z.playSeconds,
            };
          })
      : [];

    return json({
      ok: true,
      time_zone: presence.time_zone,
      range: presence.range,
      window_start: presence.window_start,
      window_end: presence.window_end,
      labels: presence.labels,
      series: presence.series,
      weekday_peak: presence.weekday_peak,
      most_active_timezones: mostActive,
      player_peak_hours: {
        labels: Array.from({ length: 24 }, (_, h) => hourLabel(h)),
        play_seconds: viewerHours,
        peak_label: formatPeakHours(viewerHours, PEAK_HOUR_COUNT),
        peak_hour: peakHour,
        mysql: Boolean(activity?.mysql),
      },
      // alias kept for older clients
      player_peak_hours_hst: {
        labels: Array.from({ length: 24 }, (_, h) => hourLabel(h)),
        play_seconds: viewerHours,
        peak_label: formatPeakHours(viewerHours, PEAK_HOUR_COUNT),
        peak_hour: peakHour,
        mysql: Boolean(activity?.mysql),
      },
      uptime: {
        server: serverUptime,
        laptop: laptopUptime,
        primary: primaryUptime,
        merged_dev: mergedDevUptime,
      },
      hosts: {
        laptop: "Dev laptop",
        primary: "Dev workstation",
        server: "Game server",
        merged_dev: "Merged dev",
      },
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("time_charts_public_failed", detail.slice(0, 400));
    return json({ ok: false, detail: "time charts unavailable" }, 503);
  }
}

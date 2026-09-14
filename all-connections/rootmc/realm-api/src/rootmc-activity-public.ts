/**
 * Public Root-Activity timezone roster + peak hours for rootmc.net/time/
 */

import { json } from "./cors";
import { fetchActivityTimezonePublic } from "./rootmc-activity-mysql";
import {
  formatPeakHours,
  nearestTimezoneByOffsetMinutes,
  offsetMinutesFromDate,
  PEAK_HOUR_COUNT,
  shiftBucketsToOffset,
} from "./rootmc-timezone-defs";
import type { RootStatEnv } from "./rootstat-minecraft";

type ActivityPublicEnv = RootStatEnv & {
  ROOTMC_MYSQL?: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  ROOTMC_MYSQL_TABLE_PREFIX?: string;
};

export async function handleActivityTimezonesPublic(
  env: ActivityPublicEnv,
  request?: Request,
): Promise<Response> {
  try {
    const url = request ? new URL(request.url) : null;
    const tzParam = String(url?.searchParams.get("tz") || "").trim();
    const cfTz = request
      ? String(((request as Request & { cf?: { timezone?: string } }).cf || {}).timezone || "").trim()
      : "";
    const viewerIana = tzParam || cfTz || "";
    const viewerOffset = offsetMinutesFromDate(new Date(), viewerIana || undefined);
    const viewerBand = nearestTimezoneByOffsetMinutes(viewerOffset);

    const data = await fetchActivityTimezonePublic(env);
    const timezones = data.timezones.map((z) => {
      const inViewer = shiftBucketsToOffset(z.hourBuckets, z.offsetMinutes, viewerOffset);
      return {
        key: z.key,
        label: z.label,
        offset_minutes: z.offsetMinutes,
        players: z.players,
        peak_local: z.peakLocal,
        peak_hst: z.peakHst,
        peak_viewer: formatPeakHours(inViewer, PEAK_HOUR_COUNT),
        play_seconds: z.playSeconds,
      };
    });

    const mostActive = [...timezones]
      .filter((z) => z.play_seconds > 0 || z.players > 0)
      .sort((a, b) => b.play_seconds - a.play_seconds || b.players - a.players)
      .slice(0, 8)
      .map((z) => ({
        key: z.key,
        label: z.label,
        players: z.players,
        peakLocal: z.peak_local,
        peakHst: z.peak_hst,
        peakViewer: z.peak_viewer,
        playSeconds: z.play_seconds,
      }));

    return json({
      ok: data.ok,
      mysql: data.mysql,
      total_players: data.totalPlayers,
      viewer_time_zone: viewerIana || null,
      viewer_timezone_key: viewerBand.key,
      viewer_timezone_label: viewerBand.label,
      most_active: mostActive,
      timezones,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("activity_timezones_public_failed", detail.slice(0, 400));
    return json({ ok: false, detail: "timezone summary unavailable" }, 503);
  }
}

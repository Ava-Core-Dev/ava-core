import { json } from "./cors";
import { verifyWorkerOpsAdmin } from "./push";

export interface KilaueaLiveStreamsEnv {
  DB: D1Database;
  RR_PUSH_ADMIN_SECRET?: string;
}

export type KilaueaLiveStreamRow = {
  id: string;
  title: string;
  description: string;
  watch_url: string;
  youtube_video_id: string | null;
  sort_order: number;
  updated_at: string;
};

/** True when watch_url always resolves to the channel's current live broadcast (id changes each session). */
export function isChannelLiveWatchUrl(watchUrl: string): boolean {
  return /\/@[^/?#]+\/live\/?(?:[?#]|$)/i.test(String(watchUrl || "").trim());
}

const YOUTUBE_EMBED_QUERY = "autoplay=1&playsinline=1&rel=0&modestbranding=1";

/** `live:UC…` in youtube_video_id — permanent iframe for the channel's current broadcast. */
export function parseChannelLiveVideoIdToken(youtubeVideoId: string | null | undefined): string | null {
  const raw = String(youtubeVideoId || "").trim();
  if (!raw.toLowerCase().startsWith("live:")) return null;
  const channelId = raw.slice(5).trim();
  return /^UC[\w-]{20,}$/i.test(channelId) ? channelId : null;
}

export function embedUrlForChannelLive(channelId: string): string {
  return `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(channelId)}&${YOUTUBE_EMBED_QUERY}`;
}

/** YouTube iframe embed when we have a stable video id; otherwise the watch URL (e.g. @channel/live). */
export function embedUrlForStream(row: {
  watch_url: string;
  youtube_video_id?: string | null;
}): string {
  const channelLiveId = parseChannelLiveVideoIdToken(row.youtube_video_id);
  if (channelLiveId) {
    return embedUrlForChannelLive(channelLiveId);
  }
  const watch = String(row.watch_url || "").trim();
  if (isChannelLiveWatchUrl(watch)) {
    return watch;
  }
  const vid = String(row.youtube_video_id || "").trim();
  if (vid) {
    return `https://www.youtube.com/embed/${encodeURIComponent(vid)}?${YOUTUBE_EMBED_QUERY}`;
  }
  const m = watch.match(/[?&]v=([^&]+)/);
  if (m?.[1]) {
    return `https://www.youtube.com/embed/${encodeURIComponent(m[1])}?${YOUTUBE_EMBED_QUERY}`;
  }
  return watch;
}

/**
 * GET /api/mobile/kilauea-live-streams — ordered list for the Kīlauea app Live Feeds screen.
 */
export async function handleKilaueaLiveStreamsGet(env: KilaueaLiveStreamsEnv): Promise<Response> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, title, description, watch_url, youtube_video_id, sort_order, updated_at
       FROM kilauea_live_streams
       ORDER BY sort_order ASC, id ASC`,
    ).all<KilaueaLiveStreamRow>();
    const streams = (results ?? []).map((row) => ({
      ...row,
      embed_url: embedUrlForStream(row),
    }));
    const updated_at =
      streams.length > 0
        ? streams.reduce((max, s) => (s.updated_at > max ? s.updated_at : max), streams[0].updated_at)
        : null;
    return json({ streams, updated_at }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ detail: `Could not load live streams: ${msg}`, streams: [] }, 500);
  }
}

/**
 * POST /api/internal/kilauea-live-streams — upsert one stream row (X-RR-Push-Admin-Key).
 * Body: { id, title?, description?, watch_url, youtube_video_id?, sort_order? }
 */
export async function handleKilaueaLiveStreamsPost(
  request: Request,
  env: KilaueaLiveStreamsEnv,
): Promise<Response> {
  if (!(await verifyWorkerOpsAdmin(request, env))) {
    const has = Boolean(request.headers.get("X-RR-Push-Admin-Key"));
    return json({ detail: has ? "Invalid admin key." : "Missing X-RR-Push-Admin-Key header." }, 401);
  }
  let body: {
    id?: string;
    title?: string;
    description?: string;
    watch_url?: string;
    youtube_video_id?: string | null;
    sort_order?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON." }, 400);
  }
  const id = String(body.id || "").trim();
  const watch_url = String(body.watch_url || "").trim();
  if (!id || id.length > 64) return json({ detail: "id required (1–64 chars)." }, 400);
  if (!watch_url || watch_url.length > 500) return json({ detail: "watch_url required (1–500 chars)." }, 400);
  if (!/^https:\/\//i.test(watch_url)) return json({ detail: "watch_url must be https." }, 400);

  const title = String(body.title || id).trim().slice(0, 200);
  const description = String(body.description || "").trim().slice(0, 2000);
  const youtube_video_id = body.youtube_video_id == null ? null : String(body.youtube_video_id).trim().slice(0, 32) || null;
  const sort_order = Number.isFinite(body.sort_order) ? Math.trunc(body.sort_order as number) : 0;
  const updated_at = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO kilauea_live_streams (id, title, description, watch_url, youtube_video_id, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         watch_url = excluded.watch_url,
         youtube_video_id = excluded.youtube_video_id,
         sort_order = excluded.sort_order,
         updated_at = excluded.updated_at`,
    )
      .bind(id, title, description, watch_url, youtube_video_id, sort_order, updated_at)
      .run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ detail: msg }, 500);
  }
  return json({ ok: true, id, embed_url: embedUrlForStream({ watch_url, youtube_video_id }), updated_at }, 200);
}

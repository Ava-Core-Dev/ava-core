import { json } from "./cors";
import { verifyWorkerOpsAdmin } from "./push";
import { runDiscordAnnouncementsHistoryBackfill, type DiscordDeveloperSyncEnv } from "./discord-developer-sync";

export type DiscordChannelBackfillEnv = DiscordDeveloperSyncEnv & { RR_PUSH_ADMIN_SECRET?: string };

/** POST /api/internal/discord-channel-backfill — paginated scan of announcements history (`X-RR-Push-Admin-Key`). */
export async function handleDiscordChannelBackfillPost(request: Request, env: DiscordChannelBackfillEnv): Promise<Response> {
  if (!(await verifyWorkerOpsAdmin(request, env))) {
    const has = Boolean(request.headers.get("X-RR-Push-Admin-Key"));
    return json({ detail: has ? "Invalid admin key." : "Missing X-RR-Push-Admin-Key header." }, 401);
  }
  const secret = (env.RR_PUSH_ADMIN_SECRET || "").trim();
  if (!secret) return json({ detail: "RR_PUSH_ADMIN_SECRET is not set on this Worker." }, 503);

  let body: { before?: string | null; max_pages?: number; channel_id?: string | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const before = body.before != null ? String(body.before).trim() || null : null;
  const channel_id = body.channel_id != null ? String(body.channel_id).trim() || null : null;
  const max_pages =
    typeof body.max_pages === "number" && Number.isFinite(body.max_pages) ? body.max_pages : undefined;

  const result = await runDiscordAnnouncementsHistoryBackfill(env, { before, max_pages, channel_id });
  let hint: string;
  if (!result.ok) {
    hint = "Fix Discord token / permissions or retry.";
  } else if (result.done) {
    hint = result.next_channel_id
      ? `This channel is done. POST again with JSON { "channel_id": "${result.next_channel_id}", "before": null } for the next channel.`
      : "All configured channels are fully scanned.";
  } else {
    hint = `POST again with JSON { "channel_id": "${result.active_channel_id || ""}", "before": "${result.next_before || ""}" } to continue older messages on the same channel.`;
  }
  return json(
    {
      ok: result.ok,
      skipped: result.skipped,
      inserted: result.inserted,
      activity_upserts: result.activity_upserts,
      pages_fetched: result.pages_fetched,
      messages_scanned: result.messages_scanned,
      done: result.done,
      next_before: result.next_before,
      active_channel_id: result.active_channel_id,
      next_channel_id: result.next_channel_id,
      channel_done: result.channel_done,
      hint,
    },
    result.ok ? 200 : 502,
  );
}

/**
 * Queue visitor feedback in D1 while the origin is dark.
 * Origin drains this table and then deletes the rows.
 */

import { initHeartbeatTable, type HeartbeatEnv } from "./heartbeat";

export async function storeOfflineFeedback(
  env: HeartbeatEnv,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; id: string }> {
  await initHeartbeatTable(env);
  const id = crypto.randomUUID();
  const message = String(payload.message || payload.content || "").trim();
  if (!message) {
    throw new Error("message required");
  }
  const body = JSON.stringify({
    type: payload.type || payload.kind || "general",
    message,
    reply_email: payload.reply_email || payload.email || null,
    name: payload.name || "",
    surface: payload.surface || payload.app_id || "web",
    app_id: payload.app_id || null,
  });
  await env.AVA_HEARTBEAT_DB.prepare(
    `INSERT INTO ava_offline_inbox
      (id, at, iso, surface, channel_id, message_id, author_id, author_name, kind, content, read_at)
     VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL, ?5, 'feedback', ?6, NULL)`,
  )
    .bind(
      id,
      Date.now(),
      new Date().toISOString(),
      String(payload.surface || payload.app_id || "web").slice(0, 80),
      String(payload.name || "").slice(0, 120),
      body,
    )
    .run();
  return { ok: true, id };
}

export async function clearTempEcoflow(env: HeartbeatEnv): Promise<void> {
  try {
    await env.AVA_HEARTBEAT_DB.prepare("DELETE FROM ava_ecoflow WHERE host = 'ava-core'").run();
  } catch {
    // ignore
  }
}

import { postMessage } from "./discordApi.mjs";
import { allowsUnsolicitedPost } from "./channelPolicy.mjs";
import { pushStatusEvent } from "./store.mjs";

/**
 * Audit / changelog channel posts for significant Ava actions.
 * Never posts into #admins (unsolicited).
 */

export async function postAudit(fetchJson, channelId, { title, body }) {
  if (!fetchJson || !channelId) return null;
  if (!allowsUnsolicitedPost(channelId)) {
    pushStatusEvent(
      `audit skipped · blocked #${channelId} · ${String(title || "").slice(0, 80)}`,
    );
    return null;
  }
  const content = ["**Ava audit**", title ? `### ${title}` : null, body || ""]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1900);
  return postMessage(fetchJson, channelId, content, null);
}

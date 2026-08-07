/**
 * Drain in-game /feedback inbox — Ava reads the official list when online.
 */

import { processNextFeedback, ackFeedback, listQueuedFeedback } from "./governanceClient.mjs";
import { pushStatusEvent } from "./store.mjs";
import { AVA_CHANNELS } from "./config.mjs";
import { allowsUnsolicitedPost } from "./channelPolicy.mjs";

const MAX_PER_PASS = Math.min(20, Math.max(1, Number(process.env.AVA_FEEDBACK_MAX || 8) || 8));

function looksLikeFeatureRequest(message = "") {
  return /\b(add|please add|can we|could we|should|want|wish|feature|suggest|proposal|implement|plugin|new)\b/i.test(
    String(message),
  );
}

function digestLine(fb) {
  const who = fb.minecraft_username || "player";
  const host = fb.server_name || fb.server_id || "server";
  const msg = String(fb.message || "").replace(/\s+/g, " ").trim().slice(0, 160);
  return `**${who}** (${host}): ${msg}`;
}

/**
 * Process queued /feedback items. Optionally post a short Discord digest.
 */
export async function processPendingFeedback({
  reason = "poll",
  reply,
  channelId,
} = {}) {
  let seen = 0;
  let failed = 0;
  const lines = [];

  for (let i = 0; i < MAX_PER_PASS; i++) {
    const res = await processNextFeedback();
    if (!res || res.empty) break;
    if (!res.ok || !res.feedback?.id) {
      failed += 1;
      if (res.status === 401 || /workstation|Unauthorized/i.test(String(res.detail || ""))) {
        break;
      }
      continue;
    }

    const fb = res.feedback;
    const tip = looksLikeFeatureRequest(fb.message)
      ? " — if this is a feature ask, point them at in-game `/proposal` (64 G)"
      : "";
    const note = `Read from /feedback queue (${reason})${tip}`.slice(0, 500);
    const ack = await ackFeedback(fb.id, note);
    if (ack?.ok) {
      seen += 1;
      lines.push(digestLine(fb));
      pushStatusEvent(`feedback ${fb.id} · ${fb.minecraft_username || "?"} · seen`);
      console.log(`[feedbackInbox] seen ${fb.id} from ${fb.minecraft_username} (${reason})`);
    } else {
      failed += 1;
      console.warn(`[feedbackInbox] ack fail ${fb.id}: ${ack?.detail || "unknown"}`);
    }
  }

  if (seen && typeof reply === "function") {
    const home =
      channelId ||
      String(process.env.AVA_ANNOUNCE_CHANNEL || "").trim() ||
      AVA_CHANNELS.changelog ||
      "";
    if (home && allowsUnsolicitedPost(home)) {
      const body = [
        `tapped **${seen}** in-game \`/feedback\` item(s) from the official list:`,
        ...lines.slice(0, 6).map((l) => `• ${l}`),
        lines.length > 6 ? `_…+${lines.length - 6} more_` : null,
        "staff copy still lands in Slack #feedback. feature-shaped ones → player should use `/proposal`.",
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 1900);
      try {
        await reply(home, body);
      } catch (err) {
        console.warn("feedback digest post:", err.message);
      }
    }
  }

  if (seen || failed) {
    pushStatusEvent(`feedback inbox · ${reason} · +${seen} seen` + (failed ? ` · ${failed} failed` : ""));
  }

  return { seen, failed, lines };
}

export async function queuedFeedbackCount() {
  const res = await listQueuedFeedback({ limit: 50 });
  if (!res?.ok || !Array.isArray(res.feedback)) return 0;
  return res.feedback.length;
}

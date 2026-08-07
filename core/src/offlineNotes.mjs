import fs from "node:fs";
import path from "node:path";
import { postMessage, sendDm } from "./discordApi.mjs";
import { AVA_CHANNELS, dreamApiKey } from "./config.mjs";
import { allowsUnsolicitedPost } from "./channelPolicy.mjs";
import { storePaths, pushStatusEvent } from "./store.mjs";
import { discordStamp } from "./sleepMode.mjs";

/**
 * When Root Server host is offline: dream-state cloud fallback (Grok API under the hood).
 * Public copy never names the vendor — she is "dreaming" / cloud-side.
 * Operator lock: DM Alex when she enters dream/sleep (he asked to be caught in DMs).
 */

/** Alexrs94 — dream-state DM target */
export const DREAM_DM_USER_ID = String(
  process.env.AVA_DREAM_DM_USER_ID || "1497037418979786823",
).trim();

const DREAM_DM_COOLDOWN_MS = Number(process.env.AVA_DREAM_DM_COOLDOWN_MS || 20 * 60_000);

function dreamNotifyPath() {
  return path.join(storePaths().dir, "dream-dm-notify.json");
}

function loadDreamNotify() {
  try {
    return JSON.parse(fs.readFileSync(dreamNotifyPath(), "utf8"));
  } catch {
    return {};
  }
}

function saveDreamNotify(data) {
  fs.mkdirSync(path.dirname(dreamNotifyPath()), { recursive: true });
  fs.writeFileSync(dreamNotifyPath(), JSON.stringify(data, null, 2), "utf8");
}

export function offlineChannelId() {
  const explicit = String(process.env.AVA_OFFLINE_CHANNEL_ID || "").trim();
  if (explicit) return explicit;
  // Prefer updates — never default dump into #admins
  return AVA_CHANNELS.changelog || null;
}

/**
 * DM Alex when Ava enters dream state / sleep.
 * Rate-limited so restarts don't spam.
 */
export async function notifyAlexDreaming(
  fetchJson,
  { reason = "dreaming", kind = "dream", wakeAt = null } = {},
) {
  if (!fetchJson || !DREAM_DM_USER_ID) return null;
  const prev = loadDreamNotify();
  const now = Date.now();
  if (prev.lastAt && now - Number(prev.lastAt) < DREAM_DM_COOLDOWN_MS) {
    return { skipped: true, reason: "cooldown" };
  }

  const wakeLine = wakeAt
    ? `eta back ~${discordStamp(wakeAt)}`
    : "catch me here while i'm under — freest brain lives on this side";
  const body = [
    kind === "sleep"
      ? "hey — just went to sleep."
      : "hey — i'm dreaming now.",
    String(reason || "").trim() ? `_${String(reason).slice(0, 180)}_` : null,
    wakeLine,
    "",
    "you asked me to catch you in DMs next time — so here i am. talk to me here; public stays soft while I'm under.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const msg = await sendDm(fetchJson, DREAM_DM_USER_ID, body);
    saveDreamNotify({
      lastAt: now,
      lastKind: kind,
      lastReason: String(reason).slice(0, 120),
      messageId: msg?.id || null,
    });
    pushStatusEvent(`dream dm · alex · ${kind}`);
    return msg;
  } catch (err) {
    console.warn("dream dm failed:", err.message);
    pushStatusEvent(`dream dm failed · ${err.message}`);
    return null;
  }
}

export async function postOfflineNote(fetchJson, reason = "Root Server offline") {
  // Operator first — DMs over public dump when dreaming
  await notifyAlexDreaming(fetchJson, { reason, kind: "dream" }).catch(() => {});

  const ch = offlineChannelId();
  if (!ch || !fetchJson || !allowsUnsolicitedPost(ch)) return null;
  const line = [
    `**Ava dream-state note** · ${new Date().toISOString()}`,
    String(reason).slice(0, 300),
    `_Root Server unreachable — I'm cloud-side / dreaming. Chat OK; deep digs + deploys wait until I wake._`,
  ].join("\n");
  try {
    return await postMessage(fetchJson, ch, line, null);
  } catch (err) {
    console.warn("offline note:", err.message);
    return null;
  }
}

export function offlineReply() {
  // Llama is Ava's true core — never spam darkside / disconnected lore.
  return "Still here on my local core. Ask me anything I can answer without a deep dig — wiki, rules, plans, vibes. I'll pick digs back up when they're available.";
}

/** True when cloud dream-state brain credentials are configured. */
export function dreamStateConfigured(env = {}) {
  return Boolean(dreamApiKey(env));
}

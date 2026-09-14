import fs from "node:fs";
import path from "node:path";
import { storePaths, isHushed, pushStatusEvent } from "./store.mjs";
import { isLockoutActive } from "./lockoutMode.mjs";
import { listJobs } from "./jobQueue.mjs";
import { cursorSlots, CURSOR_CONCURRENCY } from "./cursorBrain.mjs";
import { postMessage } from "./discordApi.mjs";
import { allowsUnsolicitedPost } from "./channelPolicy.mjs";

/**
 * Ava-initiated pending-tasks check — audits her own queue locally.
 * Discord posts only when AVA_PENDING_CHECK_CHANNEL is set explicitly
 * and is not a no-unsolicited channel (#admins).
 */

const ACTIVE_STATUSES = new Set([
  "pending",
  "implementing",
  "staged",
  "waiting_restart",
]);

const PARKED_STATUSES = new Set(["blocked"]);

function statePath() {
  return path.join(storePaths().dir, "pending-tasks.json");
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return { lastAt: 0, quietStreak: 0, lastPostId: null };
  }
}

function saveState(s) {
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), "utf8");
}

function loadPendingEmojiAsks() {
  try {
    const p = path.join(storePaths().dir, "reactions", "pending-asks.json");
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return Object.keys(data.pending || {}).length;
  } catch {
    return 0;
  }
}

export function collectPendingTasks() {
  const all = listJobs(40);
  const jobs = all.filter((j) => ACTIVE_STATUSES.has(j.status));
  const parked = all.filter((j) => PARKED_STATUSES.has(j.status));
  const byStatus = {};
  for (const j of [...jobs, ...parked]) {
    byStatus[j.status] = (byStatus[j.status] || 0) + 1;
  }
  const slots = cursorSlots();
  const emojiAsks = loadPendingEmojiAsks();
  // Parked/blocked need Alex/vote — don't count as nagging "open" work
  const open = jobs.length + emojiAsks + slots.active + slots.waiting;
  return {
    jobs,
    parked,
    byStatus,
    slots,
    emojiAsks,
    open,
    hasWork: open > 0,
  };
}

export function buildPendingTasksMessage(snapshot) {
  const { jobs, parked = [], byStatus, slots, emojiAsks, hasWork } = snapshot;
  const lines = [];

  if (!hasWork) {
    lines.push("pending check — queue's clean. no active jobs, no digs waiting. I'm good.");
    if (parked.length) {
      lines.push(`parked/blocked (need vote/Alex): **${parked.length}** — not nagging.`);
    }
    lines.push("");
    lines.push(`agents **0/${CURSOR_CONCURRENCY}** · emoji asks **0**`);
    lines.push("— Ava");
    return lines.join("\n");
  }

  lines.push("pending check — looking at my own backlog:");
  lines.push("");

  if (jobs.length) {
    lines.push(`**Jobs (${jobs.length} open)**`);
    for (const [st, n] of Object.entries(byStatus)) {
      lines.push(`· ${st}: ${n}`);
    }
    const top = jobs.slice(0, 5);
    for (const j of top) {
      lines.push(`· \`${j.id}\` [${j.status}] ${String(j.title || "").slice(0, 60)}`);
    }
    if (jobs.length > 5) lines.push(`· …+${jobs.length - 5} more`);
    lines.push("");
  }

  lines.push(
    `**Root Server** · agents **${slots.active}/${slots.max}**` +
      (slots.waiting ? ` · +${slots.waiting} waiting` : ""),
  );
  if (emojiAsks) lines.push(`**Emoji teach asks** · ${emojiAsks} pending`);

  lines.push("");
  lines.push(
    slots.full
      ? "slots full — don't spam me; wait then ping."
      : "ping me if something on this list needs a push. otherwise I'm chewing.",
  );
  lines.push("— Ava");
  return lines.join("\n").slice(0, 1900);
}

export function pendingCheckIntervalMs() {
  return Math.max(
    60_000,
    Number(process.env.AVA_PENDING_CHECK_MS || 25 * 60_000) || 25 * 60_000,
  );
}

/** First check sooner after boot so she actually initiates. */
export function pendingCheckBootDelayMs() {
  return Math.max(
    30_000,
    Number(process.env.AVA_PENDING_CHECK_BOOT_MS || 90_000) || 90_000,
  );
}

function targetChannelId() {
  // Explicit opt-in only — never fall back to #admins / avaHome.
  return String(process.env.AVA_PENDING_CHECK_CHANNEL || "").trim();
}

/**
 * @returns {Promise<{ posted: boolean, reason?: string, open?: number }>}
 */
export async function runPendingTasksCheck(fetchJson, { force = false } = {}) {
  if (!fetchJson) return { posted: false, reason: "no_fetch" };
  if ((isHushed() || isLockoutActive()) && !force) return { posted: false, reason: "hushed" };

  const state = loadState();
  const interval = pendingCheckIntervalMs();
  if (!force && state.lastAt && Date.now() - state.lastAt < interval) {
    return { posted: false, reason: "too_soon" };
  }

  const snap = collectPendingTasks();
  state.lastAt = Date.now();
  state.lastOpen = snap.open;

  // Local-only by default (status page / events). No Discord spam.
  const channelId = targetChannelId();
  if (!channelId || !allowsUnsolicitedPost(channelId)) {
    if (!snap.hasWork) state.quietStreak = (state.quietStreak || 0) + 1;
    else state.quietStreak = 0;
    saveState(state);
    pushStatusEvent(
      `pending check · local · ${snap.hasWork ? snap.open + " open" : "clear"}`,
    );
    return { posted: false, reason: channelId ? "blocked_channel" : "local_only", open: snap.open };
  }

  // Quiet: skip most empty checks (post every 3rd quiet streak)
  if (!snap.hasWork && !force) {
    state.quietStreak = (state.quietStreak || 0) + 1;
    if (state.quietStreak % 3 !== 0) {
      saveState(state);
      pushStatusEvent("pending check · quiet (skipped post)");
      return { posted: false, reason: "quiet", open: 0 };
    }
  } else {
    state.quietStreak = 0;
  }

  const content = buildPendingTasksMessage(snap);
  try {
    const msg = await postMessage(fetchJson, channelId, content, null);
    state.lastPostId = msg?.id || null;
    saveState(state);
    pushStatusEvent(
      `pending check · ${snap.hasWork ? snap.open + " open" : "clear"} → #${channelId}`,
    );
    console.log(
      "pending tasks check posted",
      channelId,
      snap.hasWork ? `${snap.jobs.length} jobs` : "clear",
    );
    return { posted: true, open: snap.open, channelId };
  } catch (err) {
    console.warn("pending tasks check failed:", err.message);
    state.lastAt = Date.now();
    saveState(state);
    return { posted: false, reason: err.message };
  }
}

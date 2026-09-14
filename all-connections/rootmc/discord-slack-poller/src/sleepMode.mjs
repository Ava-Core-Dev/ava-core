/**
 * Sleep mode â€” Ava stays lightly online for summons, dreams until ~10am HST,
 * then auto-wakes and reads missed chat.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths, pushStatusEvent } from "./store.mjs";

const HST_OFFSET_MS = 10 * 60 * 60 * 1000;

function sleepPath() {
  return path.join(storePaths().dir, "sleep.json");
}

function readSleep() {
  try {
    if (!fs.existsSync(sleepPath())) return null;
    return JSON.parse(fs.readFileSync(sleepPath(), "utf8"));
  } catch {
    return null;
  }
}

function writeSleep(value) {
  fs.mkdirSync(path.dirname(sleepPath()), { recursive: true });
  fs.writeFileSync(sleepPath(), JSON.stringify(value, null, 2), "utf8");
}

/** Wall-clock parts in HST (UTC-10, no DST). */
export function hstParts(d = new Date()) {
  const x = new Date(d.getTime() - HST_OFFSET_MS);
  return {
    y: x.getUTCFullYear(),
    m: x.getUTCMonth(),
    day: x.getUTCDate(),
    h: x.getUTCHours(),
    mi: x.getUTCMinutes(),
    s: x.getUTCSeconds(),
  };
}

/** Next 10:00 America/Honolulu as UTC Date. */
export function nextWakeAt10amHst(from = new Date()) {
  const p = hstParts(from);
  let y = p.y;
  let m = p.m;
  let day = p.day;
  if (p.h > 10 || (p.h === 10 && (p.mi > 0 || p.s > 0))) {
    day += 1;
  }
  // 10:00 HST = 20:00 UTC
  let wakeMs = Date.UTC(y, m, day, 20, 0, 0);
  if (wakeMs <= from.getTime()) wakeMs += 24 * 60 * 60 * 1000;
  return new Date(wakeMs);
}

export function discordStamp(ms = Date.now()) {
  const unix = Math.floor(Number(ms) / 1000);
  return `<t:${unix}:F> Â· <t:${unix}:R>`;
}

export function loadSleepState() {
  return readSleep();
}

export function isAsleep(now = Date.now()) {
  const s = readSleep();
  if (!s?.asleep) return false;
  const wakeAt = Number(s.wakeAt || 0);
  if (wakeAt && now >= wakeAt) return false;
  return true;
}

export function setAsleep({
  reason = "goodnight",
  wakeAt,
  by = "system",
} = {}) {
  const wake = wakeAt ? new Date(wakeAt) : nextWakeAt10amHst();
  const prev = readSleep() || {};
  const payload = {
    asleep: true,
    reason: String(reason).slice(0, 200),
    by: String(by).slice(0, 80),
    sleepSince: prev.asleep ? prev.sleepSince || Date.now() : Date.now(),
    wakeAt: wake.getTime(),
    wakeAtIso: wake.toISOString(),
    summons: Array.isArray(prev.summons) ? prev.summons : [],
    updatedAt: Date.now(),
  };
  writeSleep(payload);
  pushStatusEvent(`asleep Â· wake ${payload.wakeAtIso} Â· ${payload.reason}`);
  return payload;
}

export function clearAsleep(reason = "woke") {
  const prev = readSleep();
  writeSleep({
    asleep: false,
    clearedAt: Date.now(),
    clearedReason: String(reason).slice(0, 120),
    lastSleepSince: prev?.sleepSince || null,
    lastWakeAt: prev?.wakeAt || null,
    lastSummons: prev?.summons || [],
  });
  pushStatusEvent(`woke Â· ${reason}`);
  return prev;
}

export function recordSleepSummon({
  channelId,
  messageId,
  authorId,
  authorName,
  preview,
  surface = null,
} = {}) {
  const s = readSleep() || { asleep: true, summons: [] };
  const summons = Array.isArray(s.summons) ? s.summons : [];
  summons.push({
    at: Date.now(),
    channelId: String(channelId || ""),
    messageId: String(messageId || ""),
    authorId: String(authorId || ""),
    authorName: String(authorName || "").slice(0, 64),
    preview: String(preview || "").slice(0, 160),
    surface: surface ? String(surface).slice(0, 24) : null,
  });
  while (summons.length > 40) summons.shift();
  s.summons = summons;
  s.updatedAt = Date.now();
  writeSleep(s);
  return s;
}

export function asleepReplyText(state = readSleep(), { surface = "discord" } = {}) {
  const wakeAt = Number(state?.wakeAt) || nextWakeAt10amHst().getTime();
  const eta =
    surface === "telegram" || surface === "slack"
      ? `around **10:00 HST** (${new Date(wakeAt).toISOString()})`
      : `around **10:00 HST** — ${discordStamp(wakeAt)}`;
  return [
    "shh… i'm asleep right now",
    "dreaming about more developments and analytics for RootMC",
    "",
    `eta back ${eta}`,
    "ping me again after that, or say **wake** / **wake ava** if an operator needs me early",
    "i'll read the chat when i wake up",
    surface === "telegram"
      ? "telegram stays on dream-state while i sleep — soft brain, no deep digs"
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Operator sleep command: "ava sleep" / "go to sleep" / "goodnight ava" */
export function isSleepCommand(content) {
  const q = String(content || "")
    .toLowerCase()
    .replace(/<@!?\d+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (
    /^(hey\s+|hi\s+)?ava[,:]?\s+(go\s+to\s+)?sleep\b/.test(q) ||
    /^(go\s+to\s+)?sleep[,.]?\s+ava\b/.test(q) ||
    /\bgood\s*night\b.*\bava\b|\bava\b.*\bgood\s*night\b/.test(q) ||
    /^ava[,:]?\s+goodnight\b/.test(q)
  );
}

/**
 * After wake: pull recent messages since sleep and return a short digest + raw hits.
 */
export async function catchUpSinceSleep(fetchJson, {
  channelIds = [],
  sleepSince,
  botAppId,
  limit = 30,
} = {}) {
  const since = Number(sleepSince) || Date.now() - 12 * 60 * 60 * 1000;
  const digest = [];
  const triggers = [];

  for (const channelId of channelIds) {
    try {
      const msgs = await fetchJson(
        `/channels/${channelId}/messages?limit=${Math.min(50, limit)}`,
      );
      const missed = (msgs || []).filter((m) => {
        try {
          const t = Number((BigInt(m.id) >> 22n) + 1420070400000n);
          return t >= since && m.author?.id !== botAppId;
        } catch {
          return false;
        }
      });
      if (!missed.length) continue;
      digest.push({
        channelId,
        count: missed.length,
        samples: missed.slice(0, 5).map((m) => ({
          id: m.id,
          author: m.author?.username,
          content: String(m.content || "").slice(0, 120),
        })),
      });
      for (const m of missed) {
        const c = String(m.content || "");
        if (
          c.includes(`<@${botAppId}>`) ||
          c.includes(`<@!${botAppId}>`) ||
          /\bava\b/i.test(c)
        ) {
          triggers.push({ channelId, message: m });
        }
      }
    } catch (err) {
      digest.push({ channelId, error: err.message });
    }
  }

  return { digest, triggers, since };
}

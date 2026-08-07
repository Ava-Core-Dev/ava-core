/**
 * Automated hour recap — status events digest.
 * Posts to Slack #development-feed (NOT Discord #updates) — Alex lock 2026-08-02.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths, loadStatusEvents, pushStatusEvent } from "./store.mjs";
import { AVA_CHANNELS } from "./config.mjs";
import { postAvaSlack } from "./avaPost.mjs";
import { scrubPublicReply } from "./scrub.mjs";

/** Default 60m. Override AVA_HOUR_RECAP_MS (min 15m). */
export function hourRecapIntervalMs() {
  const n = Number(process.env.AVA_HOUR_RECAP_MS || 60 * 60 * 1000);
  return Number.isFinite(n) && n >= 15 * 60 * 1000 ? n : 60 * 60 * 1000;
}

export function hourRecapBootDelayMs() {
  const n = Number(process.env.AVA_HOUR_RECAP_BOOT_MS || 180_000);
  return Number.isFinite(n) && n >= 30_000 ? n : 180_000;
}

function statePath() {
  return path.join(storePaths().dir, "hour-recap.json");
}

function loadState() {
  try {
    if (!fs.existsSync(statePath())) return { lastRunAt: 0, lastPostId: null };
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return { lastRunAt: 0, lastPostId: null };
  }
}

function saveState(state) {
  fs.mkdirSync(storePaths().dir, { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), "utf8");
}

function parseEventLine(line) {
  const tab = String(line || "").indexOf("\t");
  if (tab < 0) return null;
  const at = Date.parse(line.slice(0, tab));
  if (!Number.isFinite(at)) return null;
  return { at, text: line.slice(tab + 1).trim() };
}

function bucketLabel(text) {
  const t = String(text || "").toLowerCase();
  if (/host-site|ecoflow|solar|telemetry/.test(t)) return "host power sync";
  if (/followup|replied|soft.?ack|phase.?catch/.test(t)) return "catch-up / replies";
  if (/poll|governance|vote|prop/.test(t)) return "governance";
  if (/self.?fix|fix/.test(t)) return "self-fix";
  if (/finance|stripe/.test(t)) return "finance";
  if (/wake|sleep|dream|boot|gateway|slack/.test(t)) return "lifecycle";
  if (/hour.?recap/.test(t)) return null;
  if (/respawn/.test(t)) return "lifecycle";
  return "ops";
}

export function buildHourRecapText({
  windowMs = 60 * 60 * 1000,
  now = Date.now(),
  highlights = [],
} = {}) {
  const since = now - windowMs;
  const events = loadStatusEvents(80)
    .map(parseEventLine)
    .filter((e) => e && e.at >= since);

  const buckets = new Map();
  for (const e of events) {
    const label = bucketLabel(e.text);
    if (!label) continue;
    if (!buckets.has(label)) buckets.set(label, []);
    const list = buckets.get(label);
    if (list.length < 4) list.push(e.text.slice(0, 120));
  }

  const hours = Math.max(1, Math.round(windowMs / 3600_000));
  const lines = [`*Ava hour recap* (~last ${hours}h)`, ""];

  const hs = (Array.isArray(highlights) ? highlights : [])
    .map((h) => String(h || "").trim())
    .filter(Boolean)
    .slice(0, 12);
  if (hs.length) {
    lines.push("*Shipped / answered*");
    for (const h of hs) lines.push(`• ${h}`);
    lines.push("");
  }

  if (!buckets.size && !hs.length) {
    lines.push("• Quiet on status log — replies may still have landed via catch-up.");
  } else if (buckets.size) {
    lines.push("*Automation pulse*");
    for (const [label, items] of buckets) {
      lines.push(`• *${label}:* ${items.length} event(s)`);
      for (const item of items.slice(0, 2)) {
        lines.push(`  - ${item}`);
      }
    }
  }

  lines.push("");
  lines.push("_Staff dig channel only. Host: HI Pacific Solar Root Server._");
  lines.push("");
  lines.push("- Ava");

  return scrubPublicReply(lines.join("\n"), { surface: "slack" });
}

/**
 * Run hour recap → Slack #development-feed.
 * Boot must NOT force-spam; watermark always respected unless opts.force.
 */
export async function runHourRecap(opts = {}) {
  const force = Boolean(opts.force);
  const skipPost = Boolean(opts.skipPost);
  const windowMs = opts.windowMs || hourRecapIntervalMs();
  const state = loadState();
  const now = Date.now();

  if (!force && state.lastRunAt && now - state.lastRunAt < windowMs * 0.85) {
    return { ok: true, skipped: true, reason: "too_soon", lastRunAt: state.lastRunAt };
  }

  const content =
    opts.content ||
    buildHourRecapText({
      windowMs,
      now,
      highlights: opts.highlights || [],
    });

  const channelId = opts.channelId || AVA_CHANNELS.slackDev || "C0BMCPMDDQR";

  let postId = null;
  if (!skipPost) {
    const data = await postAvaSlack({
      channelId,
      content,
      kind: "hour_recap",
      source: "hour-recap",
    });
    postId = data?.ts || null;
  }

  saveState({ lastRunAt: now, lastPostId: postId, surface: "slack" });
  pushStatusEvent(`hour recap · slack${postId ? ` ${postId}` : ""}`);
  return { ok: true, posted: !skipPost, postId, content, channelId, surface: "slack" };
}

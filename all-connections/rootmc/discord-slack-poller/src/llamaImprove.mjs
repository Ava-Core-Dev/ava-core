/**
 * Llama self-improve — feed recent lessons into local packs + absorb chat Q/A.
 * No digs required. Overlap-safe: only appends training rows, never posts Discord.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths, pushStatusEvent } from "./store.mjs";
import { isDarkStallText } from "./darkStall.mjs";

function trainingDir() {
  const dir = path.join(storePaths().dir, "training");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function lessonsPath() {
  return path.join(trainingDir(), "local-lessons.jsonl");
}

function improveStatePath() {
  return path.join(storePaths().dir, "llama-improve.json");
}

function scrubSecrets(text) {
  return String(text || "")
    .replace(/\b(?:CURSOR_API_KEY|DISCORD_(?:ROOTMC_)?BOT_TOKEN|GROK_[A-Z0-9_]+|XAI_API_KEY|STRIPE_SECRET_KEY)\b\s*[:=]\s*\S+/gi, "[redacted]")
    .replace(/\bsk-[a-zA-Z0-9_-]{20,}\b/g, "[redacted]")
    .replace(/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g, "[redacted]");
}

function readJsonlTail(file, maxRows = 80) {
  try {
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
    const out = [];
    for (const line of lines.slice(-maxRows)) {
      try {
        out.push(JSON.parse(line));
      } catch {
        /* skip */
      }
    }
    return out;
  } catch {
    return [];
  }
}

function appendLesson(row) {
  fs.mkdirSync(trainingDir(), { recursive: true });
  fs.appendFileSync(lessonsPath(), `${JSON.stringify(row)}\n`, "utf8");
}

/** Pack recent good lessons into organizer context (self-improve for Ollama). */
export function gatherRecentLessonsBrief({ question = "", maxChars = 3500 } = {}) {
  const rows = readJsonlTail(lessonsPath(), 60).reverse();
  if (!rows.length) return "";
  const q = String(question || "").toLowerCase();
  const scored = rows
    .map((r) => {
      const qq = String(r.question || "").toLowerCase();
      const aa = String(r.answer || "");
      if (!qq || !aa || isDarkStallText(aa)) return null;
      let score = 1;
      if (q) {
        const hits = q.split(/\W+/).filter((w) => w.length > 3 && qq.includes(w));
        score += hits.length * 2;
      }
      if (r.teacher === "local" || r.brain === "local") score += 1;
      if (r.absorbed) score += 1;
      return { score, r };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  if (!scored.length) return "";
  const lines = ["### Recent Ava Llama lessons (prefer these when they fit)"];
  for (const { r } of scored) {
    lines.push(
      `- Q: ${scrubSecrets(r.question).slice(0, 180)}\n  A: ${scrubSecrets(r.answer).slice(0, 280)}`,
    );
  }
  return lines.join("\n").slice(0, maxChars);
}

function loadImproveState() {
  try {
    return JSON.parse(fs.readFileSync(improveStatePath(), "utf8"));
  } catch {
    return { lastAbsorbAt: 0, absorbedKeys: {} };
  }
}

function saveImproveState(s) {
  fs.mkdirSync(path.dirname(improveStatePath()), { recursive: true });
  // prune keys
  const entries = Object.entries(s.absorbedKeys || {});
  if (entries.length > 800) {
    entries.sort((a, b) => a[1] - b[1]);
    s.absorbedKeys = Object.fromEntries(entries.slice(-600));
  }
  fs.writeFileSync(improveStatePath(), JSON.stringify(s, null, 2), "utf8");
}

/**
 * Absorb recent Discord/Telegram Q→A pairs into local-lessons for llama.
 * Reads outbound + conversations turns — does not post anything.
 */
export function absorbRecentChatLessons({ lookbackMs = 6 * 60 * 60_000, maxNew = 24 } = {}) {
  const state = loadImproveState();
  const now = Date.now();
  const cut = now - lookbackMs;
  let added = 0;

  // Prefer conversation turns (paired Q/A)
  const turnsFile = path.join(storePaths().dir, "conversations", "turns.jsonl");
  for (const row of readJsonlTail(turnsFile, 120)) {
    if (added >= maxNew) break;
    const at = Number(row.at || 0);
    if (at && at < cut) continue;
    const q = String(row.question || "").trim();
    const a = String(row.answer || "").trim();
    if (!q || !a || a.length < 12) continue;
    if (isDarkStallText(a)) continue;
    if (/same answer as last|skipping the redo/i.test(a)) continue;
    const key = `turn:${row.channelId || "?"}:${row.messageId || at}:${q.slice(0, 40)}`;
    if (state.absorbedKeys?.[key]) continue;
    appendLesson({
      at: at || now,
      question: scrubSecrets(q).slice(0, 2000),
      answer: scrubSecrets(a).slice(0, 4000),
      teacher: "chat-absorb",
      surface: row.surface || "discord",
      authorId: row.authorId || null,
      absorbed: true,
      meta: { source: "conversations/turns" },
    });
    state.absorbedKeys[key] = now;
    added += 1;
  }

  // Also pull clean local ollama call pairs if present
  const ollamaFile = path.join(trainingDir(), "ollama-calls.jsonl");
  for (const row of readJsonlTail(ollamaFile, 80)) {
    if (added >= maxNew) break;
    const at = Number(row.at || 0);
    if (at && at < cut) continue;
    const q = String(row.question || row.prompt || "").trim();
    const a = String(row.answer || row.response || row.text || "").trim();
    if (!q || !a || a.length < 12 || isDarkStallText(a)) continue;
    const key = `ollama:${at}:${q.slice(0, 40)}`;
    if (state.absorbedKeys?.[key]) continue;
    appendLesson({
      at: at || now,
      question: scrubSecrets(q).slice(0, 2000),
      answer: scrubSecrets(a).slice(0, 4000),
      teacher: "local",
      surface: row.surface || "local",
      absorbed: true,
      meta: { source: "ollama-calls" },
    });
    state.absorbedKeys[key] = now;
    added += 1;
  }

  state.lastAbsorbAt = now;
  saveImproveState(state);
  if (added > 0) {
    pushStatusEvent(`llama improve · absorbed ${added} lesson(s)`);
  }
  return { ok: true, added, lastAbsorbAt: now };
}

export function llamaImproveIntervalMs() {
  return Math.max(
    120_000,
    Number(process.env.AVA_LLAMA_IMPROVE_MS || 10 * 60_000) || 10 * 60_000,
  );
}

export function allChannelCatchupIntervalMs() {
  return Math.max(
    180_000,
    Number(process.env.AVA_ALL_CHANNEL_SCAN_MS || 12 * 60_000) || 12 * 60_000,
  );
}

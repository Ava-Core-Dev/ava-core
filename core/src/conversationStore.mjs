import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { storePaths } from "./store.mjs";

/**
 * Persist conversation turns (JSONL + SQLite) for training + audit.
 */

function convDir() {
  const dir = path.join(storePaths().dir, "conversations");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function turnsPath() {
  return path.join(convDir(), "turns.jsonl");
}

function indexPath() {
  return path.join(convDir(), "index.json");
}

function sqlitePath() {
  return path.join(convDir(), "turns.sqlite");
}

function readIndex() {
  try {
    if (!fs.existsSync(indexPath())) return { turns: 0, byUser: {}, updatedAt: 0 };
    return JSON.parse(fs.readFileSync(indexPath(), "utf8"));
  } catch {
    return { turns: 0, byUser: {}, updatedAt: 0 };
  }
}

function writeIndex(idx) {
  fs.writeFileSync(indexPath(), JSON.stringify(idx, null, 2), "utf8");
}

let db = null;

function getDb() {
  if (db) return db;
  db = new DatabaseSync(sqlitePath());
  db.exec(`
    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      channel_id TEXT,
      message_id TEXT,
      author_id TEXT,
      author_name TEXT,
      question TEXT,
      answer TEXT,
      intent TEXT,
      job_id TEXT,
      quality TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_turns_author ON turns(author_id);
    CREATE INDEX IF NOT EXISTS idx_turns_at ON turns(at);
  `);
  return db;
}

/**
 * @param {{ channelId, messageId, authorId, authorName, question, answer, intent?, jobId?, quality? }} turn
 */
export function persistTurn(turn) {
  const row = {
    at: Date.now(),
    channelId: turn.channelId || null,
    messageId: turn.messageId || null,
    authorId: turn.authorId || null,
    authorName: turn.authorName || null,
    question: String(turn.question || "").slice(0, 4000),
    answer: String(turn.answer || "").slice(0, 4000),
    intent: turn.intent || null,
    jobId: turn.jobId || null,
    quality: turn.quality || null,
  };

  fs.appendFileSync(turnsPath(), JSON.stringify(row) + "\n", "utf8");

  try {
    getDb()
      .prepare(
        `INSERT INTO turns (at, channel_id, message_id, author_id, author_name, question, answer, intent, job_id, quality)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.at,
        row.channelId,
        row.messageId,
        row.authorId,
        row.authorName,
        row.question,
        row.answer,
        row.intent,
        row.jobId,
        row.quality,
      );
  } catch (err) {
    console.warn("sqlite turn:", err.message);
  }

  const idx = readIndex();
  idx.turns = (idx.turns || 0) + 1;
  idx.updatedAt = Date.now();
  if (row.authorId) {
    idx.byUser[row.authorId] = (idx.byUser[row.authorId] || 0) + 1;
  }
  writeIndex(idx);
  return row;
}

export function conversationStats() {
  const idx = readIndex();
  let sqliteTurns = null;
  try {
    const r = getDb().prepare("SELECT COUNT(*) AS n FROM turns").get();
    sqliteTurns = r?.n ?? null;
  } catch {
    sqliteTurns = null;
  }
  return { ...idx, sqliteTurns };
}

/**
 * Recent Q→A turns for Cursor / Ava-core resume packs.
 * Prefer same author when provided; always include Telegram operator thread if present.
 */
export function gatherRecentTurnsBrief({
  question = "",
  authorId = "",
  maxChars = 2800,
  limit = 24,
} = {}) {
  const file = turnsPath();
  if (!fs.existsSync(file)) return { brief: "", count: 0 };
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const want = String(authorId || "");
  const qTok = String(question || "")
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3)
    .slice(0, 8);
  const scored = [];
  for (let i = lines.length - 1; i >= 0 && scored.length < limit * 3; i--) {
    try {
      const row = JSON.parse(lines[i]);
      let score = 1;
      if (want && String(row.authorId || "") === want) score += 5;
      if (String(row.channelId || "").startsWith("tg:")) score += 2;
      const blob = `${row.question || ""} ${row.answer || ""}`.toLowerCase();
      for (const t of qTok) {
        if (blob.includes(t)) score += 1;
      }
      scored.push({ score, row });
    } catch {
      /* skip */
    }
  }
  scored.sort((a, b) => b.score - a.score || Number(b.row.at || 0) - Number(a.row.at || 0));
  const picked = scored.slice(0, limit).sort((a, b) => Number(a.row.at || 0) - Number(b.row.at || 0));
  if (!picked.length) return { brief: "", count: 0 };
  const linesOut = picked.map(({ row }) => {
    const when = row.at ? new Date(row.at).toISOString().slice(0, 16) : "?";
    const who = row.authorName || row.authorId || "?";
    const ch = row.channelId || "?";
    return `- ${when} · ${who} · ${ch}\n  Q: ${String(row.question || "").slice(0, 220)}\n  A: ${String(row.answer || "").slice(0, 220)}`;
  });
  let brief = `### Recent chats (saved — resume continuity)\n${linesOut.join("\n")}`;
  if (brief.length > maxChars) brief = brief.slice(0, maxChars) + "\n_[chats truncated]_";
  return { brief, count: picked.length };
}

/**
 * Most recent turn in a channel (for praise → gold).
 * @param {string} channelId
 * @param {{ excludeIntents?: string[] }} [opts]
 */


/**
 * Most recent turn in a channel (for praise → gold).
 * @param {string} channelId
 * @param {{ excludeIntents?: string[] }} [opts]
 */
export function getLastTurnForChannel(channelId, opts = {}) {
  const exclude = new Set(
    (opts.excludeIntents || []).map((x) => String(x || "").toLowerCase()),
  );
  const cid = String(channelId || "");
  try {
    const rows = getDb()
      .prepare(
        `SELECT id, at, channel_id, message_id, author_id, author_name, question, answer, intent, quality
         FROM turns WHERE channel_id = ? ORDER BY id DESC LIMIT 25`,
      )
      .all(cid);
    for (const r of rows || []) {
      const intent = String(r.intent || "").toLowerCase();
      if (exclude.has(intent)) continue;
      const answer = String(r.answer || "").trim();
      if (answer.length < 20) continue;
      return {
        id: r.id,
        at: r.at,
        channelId: r.channel_id,
        messageId: r.message_id,
        authorId: r.author_id,
        authorName: r.author_name,
        question: r.question,
        answer: r.answer,
        intent: r.intent,
        quality: r.quality,
      };
    }
  } catch (err) {
    console.warn("getLastTurnForChannel sqlite:", err.message);
  }
  try {
    if (fs.existsSync(turnsPath())) {
      const lines = fs
        .readFileSync(turnsPath(), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        let row;
        try {
          row = JSON.parse(lines[i]);
        } catch {
          continue;
        }
        if (String(row.channelId || "") !== cid) continue;
        const intent = String(row.intent || "").toLowerCase();
        if (exclude.has(intent)) continue;
        const answer = String(row.answer || "").trim();
        if (answer.length < 20) continue;
        return {
          id: null,
          at: row.at,
          channelId: row.channelId,
          messageId: row.messageId,
          authorId: row.authorId,
          authorName: row.authorName,
          question: row.question,
          answer: row.answer,
          intent: row.intent,
          quality: row.quality || null,
        };
      }
    }
  } catch (err) {
    console.warn("getLastTurnForChannel jsonl:", err.message);
  }
  return null;
}

export function markTurnQuality(turnId, quality = "good") {
  if (turnId == null) return false;
  try {
    getDb()
      .prepare(`UPDATE turns SET quality = ? WHERE id = ?`)
      .run(String(quality || "good"), Number(turnId));
    return true;
  } catch (err) {
    console.warn("markTurnQuality:", err.message);
    return false;
  }
}


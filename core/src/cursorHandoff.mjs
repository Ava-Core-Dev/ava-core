/**
 * Cursor handoff — Ava core (llama) stores notes + chat pointers
 * so Cursor digs can resume when digs are funded again.
 *
 * All conversation turns still live in conversations/turns.jsonl (persistTurn).
 * This file adds explicit "for Cursor later" notes + a gather brief.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths, pushStatusEvent } from "./store.mjs";
import { appendAction } from "./fullLog.mjs";
import { gatherRecentTurnsBrief } from "./conversationStore.mjs";
import { gatherRecentLessonsBrief } from "./llamaImprove.mjs";
import { gatherPendingCursorPacksBrief } from "./cursorPendingPack.mjs";

function trainingDir() {
  const dir = path.join(storePaths().dir, "training");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function notesPath() {
  return path.join(trainingDir(), "cursor-handoff-notes.jsonl");
}

function appendJsonl(file, row) {
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
}

function readNotes({ max = 200 } = {}) {
  const file = notesPath();
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < max; i--) {
    try {
      out.push(JSON.parse(lines[i]));
    } catch {
      /* skip */
    }
  }
  return out.reverse();
}

/**
 * @param {{
 *   text?: string,
 *   question?: string,
 *   surface?: string,
 *   authorId?: string,
 *   authorName?: string,
 *   reason?: string,
 *   channelId?: string,
 *   auto?: boolean,
 * }} opts
 */
export function addCursorHandoffNote(opts = {}) {
  const text = String(opts.text || opts.question || "").trim();
  if (!text) return null;
  const row = {
    id: `chn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    at: Date.now(),
    open: true,
    auto: Boolean(opts.auto),
    reason: String(opts.reason || "operator_note").slice(0, 80),
    surface: String(opts.surface || "").slice(0, 40),
    authorId: opts.authorId ? String(opts.authorId) : null,
    authorName: opts.authorName ? String(opts.authorName).slice(0, 80) : null,
    channelId: opts.channelId ? String(opts.channelId) : null,
    question: String(opts.question || "").slice(0, 2000),
    text: text.slice(0, 4000),
  };
  appendJsonl(notesPath(), row);
  appendAction("cursorHandoff.note", {
    id: row.id,
    auto: row.auto,
    reason: row.reason,
    chars: row.text.length,
  });
  pushStatusEvent(
    `cursor handoff note · ${row.auto ? "auto" : "saved"} · ${row.id}`,
  );
  return row;
}

export function listOpenHandoffNotes({ limit = 40, authorId = "" } = {}) {
  const want = String(authorId || "");
  const open = [];
  for (const row of readNotes({ max: 300 }).reverse()) {
    if (row?.open === false) continue;
    if (want && row.authorId && String(row.authorId) !== want) {
      // Keep auto dig notes global; operator-tagged notes prefer matching author
      if (!row.auto) continue;
    }
    open.push(row);
    if (open.length >= limit) break;
  }
  return open.reverse();
}

/** Mark open notes absorbed after a successful Cursor dig (best-effort). */
export function markHandoffNotesAbsorbed({ beforeAt = Date.now(), limit = 30 } = {}) {
  const open = listOpenHandoffNotes({ limit: 80 });
  let n = 0;
  for (const row of open) {
    if (Number(row.at || 0) > beforeAt) continue;
    appendJsonl(notesPath(), {
      ...row,
      open: false,
      absorbedAt: Date.now(),
      absorb: true,
    });
    n += 1;
    if (n >= limit) break;
  }
  if (n) {
    appendAction("cursorHandoff.absorbed", { count: n });
    pushStatusEvent(`cursor handoff absorbed · ${n}`);
  }
  return { absorbed: n };
}

/**
 * Pack for Cursor (and llama organizer): open notes + recent chats + lessons.
 */
export function gatherCursorHandoffBrief({
  question = "",
  authorId = "",
  maxChars = 6000,
} = {}) {
  const chunks = [];
  const notes = listOpenHandoffNotes({ limit: 20, authorId });
  if (notes.length) {
    const lines = notes.slice(-12).map((n) => {
      const when = n.at ? new Date(n.at).toISOString().slice(0, 16) : "?";
      const tag = n.auto ? "auto" : "note";
      return `- [${tag} ${when}] ${String(n.text || n.question || "").slice(0, 400)}`;
    });
    chunks.push(
      `### Cursor handoff notes (from Ava core / llama — resume these)\n${lines.join("\n")}`,
    );
  }

  try {
    const turns = gatherRecentTurnsBrief({
      question,
      authorId,
      maxChars: Math.min(2800, Math.floor(maxChars * 0.45)),
    });
    if (turns?.brief) chunks.push(turns.brief);
  } catch {
    /* ignore */
  }

  try {
    const lessons = gatherRecentLessonsBrief({
      question,
      maxChars: Math.min(2200, Math.floor(maxChars * 0.35)),
    });
    if (lessons) chunks.push(String(lessons));
  } catch {
    /* ignore */
  }

  try {
    const pending = gatherPendingCursorPacksBrief({ maxChars: Math.min(1200, Math.floor(maxChars * 0.2)) });
    if (pending) chunks.push(pending);
  } catch {
    /* ignore */
  }

  if (!chunks.length) return { brief: "", count: 0 };
  let brief = chunks.join("\n\n");
  if (brief.length > maxChars) brief = brief.slice(0, maxChars) + "\n_[handoff truncated]_";
  return { brief, count: notes.length };
}

export function isCursorHandoffNoteCommand(text = "") {
  const q = String(text || "")
    .toLowerCase()
    .replace(/<@!?\d+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return false;
  return (
    /^(ava[,:]?\s+)?(save|store|leave|keep)\s+(a\s+)?(note|this|that)\b/.test(q) ||
    /\b(note|save|store|remember)\b.{0,40}\b(for\s+)?(cursor|digs?|later|when\s+cursor)\b/.test(
      q,
    ) ||
    /\b(for\s+cursor|cursor\s+later|when\s+cursor\s+(is\s+)?(back|up|funded))\b/.test(q) ||
    /^\/note(\s+.+)?$/i.test(String(text || "").trim())
  );
}

/**
 * @returns {{ handled: boolean, reply?: string, note?: object } | null}
 */
export function tryHandleCursorHandoffNoteCommand({
  text = "",
  authorId = "",
  authorName = "",
  surface = "",
  channelId = "",
  isOperator = false,
} = {}) {
  if (!isCursorHandoffNoteCommand(text)) return null;
  if (!isOperator) {
    return { handled: true, reply: "Handoff notes are operator-only." };
  }
  let body = String(text || "").trim();
  body = body.replace(/^\/note\s*/i, "");
  body = body.replace(
    /^(ava[,:]?\s+)?((please\s+)?(save|store|leave|keep)\s+(a\s+)?(note|this|that)\s*(for\s+(cursor|later|digs?))?\s*[:\-–]?\s*)/i,
    "",
  );
  body = body.replace(/\b(for\s+cursor|when\s+cursor\s+is\s+back)\b/gi, "").trim();
  if (!body || body.length < 3) {
    const open = listOpenHandoffNotes({ limit: 8, authorId });
    if (!open.length) {
      return {
        handled: true,
        reply:
          "No open Cursor handoff notes. Say `save note for cursor: …` or `/note …` and I'll stash it for the next dig.",
      };
    }
    const lines = open
      .slice(-5)
      .map((n) => `• ${String(n.text || "").slice(0, 160)}`)
      .join("\n");
    return {
      handled: true,
      reply: `Open Cursor handoff notes (${open.length}):\n${lines}`,
    };
  }
  const note = addCursorHandoffNote({
    text: body,
    question: body,
    authorId,
    authorName,
    surface,
    channelId,
    reason: "operator_note",
    auto: false,
  });
  return {
    handled: true,
    note,
    reply: `Saved for Cursor · \`${note.id}\`\nWhen digs are up I'll read this with our recent chats.`,
  };
}

/** Dig-shaped asks that llama should park for Cursor. */
export function looksLikeCursorHandoffAsk(text = "") {
  const q = String(text || "");
  if (!q.trim()) return false;
  return /\b(implement|refactor|fix|patch|edit|ship|deploy|compile|gradle|wrangler|dig|cursor|codebase|file|bug|self-?fix)\b/i.test(
    q,
  );
}

/**
 * Auto-stash when Ava core answers but work still needs a Cursor dig.
 */
export function maybeAutoHandoffFromLlama({
  question = "",
  answer = "",
  surface = "",
  authorId = "",
  authorName = "",
  channelId = "",
  route = "",
  llamaOnly = false,
} = {}) {
  const q = String(question || "").trim();
  if (!q) return null;
  const routeCursor = /^cursor$/i.test(String(route || ""));
  const digAsk = looksLikeCursorHandoffAsk(q);
  if (!routeCursor && !(llamaOnly && digAsk)) return null;
  // Avoid flooding: skip if same question parked recently
  const open = listOpenHandoffNotes({ limit: 15, authorId });
  const norm = q.toLowerCase().slice(0, 160);
  if (open.some((n) => String(n.question || n.text || "").toLowerCase().slice(0, 160) === norm)) {
    return null;
  }
  return addCursorHandoffNote({
    text: `Resume dig: ${q.slice(0, 1500)}${answer ? `\nLlama said: ${String(answer).slice(0, 800)}` : ""}`,
    question: q,
    surface,
    authorId,
    authorName,
    channelId,
    reason: routeCursor ? "llama_route_cursor" : "llama_only_dig_ask",
    auto: true,
  });
}

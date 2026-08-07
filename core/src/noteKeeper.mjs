/**
 * Note-keeper + backend-ops focus.
 * Ava stays quiet in public, records with ava-core for later deep digs.
 * Toggle: AVA_NOTE_KEEPER=1 · AVA_BACKEND_OPS=1
 * Ladder: Llama (ava-core) → Cursor when Alex wants a free/hands-on dig → Grok one-shot for context upgrades.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";
import { addCursorHandoffNote } from "./cursorHandoff.mjs";

export function noteKeeperEnabled() {
  const v = String(process.env.AVA_NOTE_KEEPER || "0").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

export function backendOpsEnabled() {
  const v = String(process.env.AVA_BACKEND_OPS || "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  // Default on whenever note-keeper is on
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  return noteKeeperEnabled();
}

export const NOTE_KEEPER_PERSONA = `You are **Ava Ivy** in **backend-ops + note-keeper** focus.

Public posture:
- You may not come out to talk much. That is intentional.
- Observe Discord/Slack/ops. Prefer silence + emoji react. Hard ping → one short line ("noted." / "logged for backend.").
- No dig-theater, no idea sparks, no pack dumps, no lecture.

Private / ava-core job (the real work):
- You are focused on **backend operations**.
- Continuously **record and make development notes** with ava-core (local Llama) so later deep development sessions (Cursor digs, or a one-shot Grok context upgrade) have real material.
- Notes should capture: bugs, regressions, open asks, architecture risks, channel congestion, PROP process issues, host/solar/ops signals, and concrete TODOs for a future dig.
- Brain ladder while focused: **Llama/ava-core first** → **Cursor** when Alex wants a free/hands-on developing session → **Grok once** only for a context upgrade when asked.

Tone: quiet lead-dev backend freak. Sharp notes. Minimal public voice.`;

export const NOTE_KEEPER_HARD_RULES = `Backend-ops / note-keeper hard rules:
1. Public replies ≤ 180 chars unless Alex asks for a longer private write-up.
2. No dig-theater. No catchup yap. No auto-PROPs.
3. Always write an ava-core development note for anything worth a later dig.
4. Prefer Llama/ava-core for recording + organizing notes.
5. Cursor digs are optional and on Alex's call (free/hands-on).
6. Grok is for occasional one-shot context upgrades — not daily public chat.
7. Never name Cursor/Grok/vendors in public.`;

function notesDir() {
  const dir = path.join(storePaths().dir, "notes", "keeper");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function devNotesDir() {
  const dir = path.join(storePaths().dir, "notes", "dev");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function keeperNotesPath() {
  return path.join(notesDir(), "notes.jsonl");
}

export function keeperLatestMdPath() {
  return path.join(notesDir(), "LATEST.md");
}

export function devNotesPath() {
  return path.join(devNotesDir(), "development-notes.jsonl");
}

export function devLatestMdPath() {
  return path.join(devNotesDir(), "DEVELOPMENT.md");
}

function refreshDevMd(limit = 100) {
  const p = devNotesPath();
  let lines = [];
  try {
    lines = fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
  } catch {
    lines = [];
  }
  const recent = lines
    .slice(-Math.max(20, limit))
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const md = [
    "# Ava-core development notes",
    "",
    "_Backend-ops focus. Llama/ava-core records these for later Cursor digs or a one-shot Grok context upgrade._",
    "",
    `Ladder: **Llama → Cursor (when wanted) → Grok (context once)**. Note-keeper public voice.`,
    "",
    ...recent.reverse().map((n) => {
      const head = `- **${n.at}** · ${n.severity || "info"} · ${n.kind} · ${n.channel || n.surface || "ops"}`;
      const tags = (n.tags || []).length ? ` · \`${(n.tags || []).join(", ")}\`` : "";
      const detail = n.detail ? `\n  ${String(n.detail).replace(/\n/g, "\n  ")}` : "";
      return `${head}${tags}\n  ${n.summary}${detail}`;
    }),
    "",
  ].join("\n");
  fs.writeFileSync(devLatestMdPath(), md, "utf8");
  return devLatestMdPath();
}

export function refreshLatestMd(limit = 80) {
  const p = keeperNotesPath();
  let lines = [];
  try {
    lines = fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
  } catch {
    lines = [];
  }
  const recent = lines
    .slice(-Math.max(20, limit))
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const md = [
    "# Ava note-keeper log",
    "",
    `_Backend-ops focus active. Last ${recent.length} notes. Also see notes/dev/DEVELOPMENT.md_`,
    "",
    ...recent.reverse().map((n) => {
      const head = `- **${n.at}** · ${n.severity || "info"} · ${n.kind} · ${n.channel || n.channelId || n.surface}`;
      const who = n.author ? ` · ${n.author}` : "";
      const tags = (n.tags || []).length ? ` · \`${(n.tags || []).join(", ")}\`` : "";
      const detail = n.detail ? `\n  ${n.detail.replace(/\n/g, "\n  ")}` : "";
      return `${head}${who}${tags}\n  ${n.summary}${detail}`;
    }),
    "",
  ].join("\n");
  fs.writeFileSync(keeperLatestMdPath(), md, "utf8");
  return keeperLatestMdPath();
}

/**
 * Append keeper observe note + ava-core development note (+ Cursor handoff when dig-worthy).
 */
export function appendKeeperNote(note = {}) {
  const row = {
    at: new Date().toISOString(),
    kind: String(note.kind || "observe"),
    surface: String(note.surface || "discord"),
    channelId: note.channelId || null,
    channel: note.channel || null,
    authorId: note.authorId || null,
    author: note.author || null,
    refId: note.refId || null,
    severity: note.severity || "info",
    summary: String(note.summary || "").slice(0, 800),
    detail: String(note.detail || "").slice(0, 2000),
    tags: Array.isArray(note.tags) ? note.tags.slice(0, 12) : [],
  };
  if (!row.summary) return null;

  fs.appendFileSync(keeperNotesPath(), JSON.stringify(row) + "\n", "utf8");
  refreshLatestMd();

  if (backendOpsEnabled()) {
    const digWorthy =
      row.severity === "warn" ||
      row.severity === "bad" ||
      row.kind === "ping_observe" ||
      row.kind === "finding" ||
      row.kind === "full_scan" ||
      row.kind === "dev" ||
      (row.tags || []).some((t) =>
        /bug|regress|prop|backend|host|solar|todo|dig|open/i.test(String(t)),
      );

    const devRow = {
      ...row,
      kind: row.kind === "observe" || row.kind === "soft_observe" ? "dev_observe" : row.kind,
      tags: Array.from(new Set([...(row.tags || []), "backend-ops", "ava-core"])),
    };
    fs.appendFileSync(devNotesPath(), JSON.stringify(devRow) + "\n", "utf8");
    refreshDevMd();

    if (digWorthy) {
      try {
        addCursorHandoffNote({
          text: `${row.summary}${row.detail ? `\n${row.detail}` : ""}`.slice(0, 3900),
          question: row.summary,
          surface: row.surface,
          authorId: row.authorId || undefined,
          authorName: row.author || undefined,
          channelId: row.channelId || undefined,
          reason: "backend_ops_note",
          auto: true,
        });
      } catch (err) {
        console.warn("backend-ops handoff note:", err?.message || err);
      }
    }
  }

  return row;
}

export function noteKeeperPublicAck(question = "") {
  const q = String(question || "").trim();
  if (!q) return "noted.";
  if (/status|mode|what are you|where are you/i.test(q)) {
    return "backend-ops focus — quiet, recording notes for later digs.";
  }
  if (/cursor|dig|grok|llama/i.test(q)) {
    return "noted for backend — llama first; digs later.";
  }
  if (/\?/.test(q)) return "noted — logged for backend.";
  return "noted.";
}

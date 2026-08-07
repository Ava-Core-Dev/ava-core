import fs from "node:fs";
import path from "node:path";
import { AVA_HANDOFF } from "./config.mjs";

const NOTES_NAME = "rootmc-lead-dev-bot-notes.md";

function notesPath() {
  return path.join(AVA_HANDOFF || "", NOTES_NAME);
}

function safeRead(file, max) {
  try {
    if (!fs.existsSync(file)) return "";
    const raw = fs.readFileSync(file, "utf8");
    return raw
      .split(/\r?\n/)
      .filter((line) => !/(password|token|secret|api[_-]?key|jdbc:|Bearer\s)/i.test(line))
      .join("\n")
      .slice(0, max);
  } catch {
    return "";
  }
}

/**
 * Absolute core — the locked lead-dev notes.
 * Always packed into Cursor prompts. Spec wins over vibes.
 */
export function gatherCoreSpec({ maxChars = 32000 } = {}) {
  const full = notesPath();
  let text = safeRead(full, maxChars);
  if (!text) {
    // Fallback: docs copy
    text = safeRead(path.join(AVA_HANDOFF || "", "docs", "lead-dev-bot-notes.md"), maxChars);
  }

  const header = `### AVA IVY — LOCKED SPEC (rootmc-lead-dev-bot-notes.md)
This document is the absolute core of who you are and how you operate.
Build directive: implement as stated. No silent omissions.
When Discord reply conflicts with this spec, the SPEC wins (except: never dump secrets/paths; never name other AI vendors — say Root Server for on-device deep digs, or dream state when cloud-side; currency is Gold/G).
Primary brain on this machine: Root Server (Cursor). First fallback when the host is offline: **dream state** (cloud) — lighter chat/knowledge only; never name the vendor. Dream pack: Server Handoffs/Ava Ivy/dream-pack/.

`;

  if (!text) {
    return {
      ok: false,
      brief: `${header}\n(WARNING: notes file missing at ${full} — use persona hard rules only.)`,
    };
  }

  return {
    ok: true,
    path: full,
    brief: `${header}\n${text}`,
  };
}

export function coreNotesPath() {
  return notesPath();
}

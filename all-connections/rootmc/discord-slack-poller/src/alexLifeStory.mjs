/**
 * Alexrs94 private life-story database — loaded into Ava's people pack.
 * Canonical: $AVA_MEDIA_DIR/private/life-story (never public download).
 * Never dump into public Discord/Slack replies.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AVA_HANDOFF } from "./config.mjs";

function storyRoot() {
  const media =
    String(process.env.AVA_MEDIA_DIR || "").trim() ||
    path.join(os.homedir(), "ava", "media");
  const candidates = [
    path.join(media, "private", "life-story"),
    path.join(media, "documents", "notes", "alex", "life-story"),
    path.join(AVA_HANDOFF, "notes", "alex", "life-story"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(path.join(p, "index.json"))) return p;
  }
  return candidates[0];
}

/**
 * @returns {{ brief: string, chapters: number, path: string } | null}
 */
export function loadAlexLifeStoryPack({ maxChars = 12_000 } = {}) {
  const root = storyRoot();
  const indexPath = path.join(root, "index.json");
  if (!fs.existsSync(indexPath)) return null;

  let index;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch {
    return null;
  }

  const parts = [
    "### Alex life story (PRIVATE database — operator only)",
    "Use to understand him. Never recite as a dossier in public channels. With him, reference gently when it fits. Secrets stay secrets.",
    "",
  ];

  const chapters = Array.isArray(index.chapters) ? index.chapters : [];
  for (const ch of chapters) {
    const file = String(ch.file || "").replace(/^[/\\]+/, "");
    if (!file || file.includes("..")) continue;
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    let body = "";
    try {
      body = fs.readFileSync(full, "utf8").trim();
    } catch {
      continue;
    }
    if (!body) continue;
    parts.push(`#### ${ch.title || ch.id || file}`);
    parts.push(body);
    parts.push("");
  }

  // Optional unfiled inbox (truncated) so fresh dumps still reach her
  const inboxRel = String(index.inbox || "raw-inbox.md");
  const inboxPath = path.join(root, inboxRel);
  if (fs.existsSync(inboxPath)) {
    try {
      const inbox = fs.readFileSync(inboxPath, "utf8").trim();
      if (inbox && !inbox.includes("*(waiting for your dump)*")) {
        parts.push("#### Raw inbox (unfiled)");
        parts.push(inbox.slice(0, 4000));
        parts.push("");
      }
    } catch {
      /* ignore */
    }
  }

  let brief = parts.join("\n").trim();
  if (brief.length > maxChars) {
    brief = brief.slice(0, maxChars - 20) + "\n\n…[truncated]";
  }
  if (chapters.length === 0 && !brief.includes("####")) return null;

  return {
    brief,
    chapters: chapters.length,
    path: root,
  };
}

/** True when this Discord/Telegram user should get the life-story pack attached. */
export function shouldAttachAlexLifeStory(authorId, personId) {
  if (personId === "alexrs94") return true;
  const id = String(authorId || "");
  if (id === "1497037418979786823") return true; // Discord Alex
  if (id === "6644482344") return true; // Telegram @WildEcho94
  return false;
}

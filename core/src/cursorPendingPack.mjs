/**
 * Durable Cursor dig packs for manual replay when Cursor cannot run.
 * Writes under data/training/cursor-pending/ — never secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths, pushStatusEvent } from "./store.mjs";
import { appendAction } from "./fullLog.mjs";

function pendingDir() {
  const dir = path.join(storePaths().dir, "training", "cursor-pending");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function scrubSecrets(text = "") {
  return String(text || "")
    .replace(
      /\b(?:CURSOR_API_KEY|CURSOR_SDK_API_KEY|DISCORD_(?:ROOTMC_)?BOT_TOKEN|GROK_[A-Z0-9_]+|XAI_API_KEY|AVA_XAI_API_KEY|SEXI_XAI_API_KEY|GROQ_API_KEY|STRIPE_SECRET_KEY|GITHUB_MODELS_TOKEN|OPENROUTER_API_KEY|GEMINI_API_KEY|HF_TOKEN)\b\s*[:=]\s*\S+/gi,
      "[redacted]",
    )
    .replace(/\bxai-[A-Za-z0-9_-]{20,}\b/g, "[redacted-xai]")
    .replace(/\bgsk_[A-Za-z0-9_-]{20,}\b/g, "[redacted-gsk]")
    .replace(/\bkey_[A-Za-z0-9_-]{20,}\b/g, "[redacted-key]");
}

/**
 * @param {{
 *   question?: string,
 *   prompt?: string,
 *   context?: string,
 *   reason?: string,
 *   surface?: string,
 *   authorId?: string,
 *   authorName?: string,
 *   channelId?: string,
 *   deep?: boolean,
 *   selfFix?: boolean,
 *   meta?: object,
 * }} opts
 */
export function saveCursorPendingPack(opts = {}) {
  const question = String(opts.question || "").trim();
  const prompt = scrubSecrets(String(opts.prompt || "").trim());
  const context = scrubSecrets(String(opts.context || "").trim());
  if (!question && !prompt) return null;

  const now = Date.now();
  const id = `cpk-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const iso = new Date(now).toISOString().replace(/[:.]/g, "-");
  const reason = String(opts.reason || "cursor_unavailable").slice(0, 120);
  const dir = pendingDir();
  const base = path.join(dir, `${iso}-${id}`);

  const meta = {
    id,
    at: now,
    atIso: new Date(now).toISOString(),
    reason,
    surface: String(opts.surface || "").slice(0, 40) || null,
    authorId: opts.authorId ? String(opts.authorId) : null,
    authorName: opts.authorName ? String(opts.authorName).slice(0, 80) : null,
    channelId: opts.channelId ? String(opts.channelId) : null,
    deep: Boolean(opts.deep),
    selfFix: Boolean(opts.selfFix),
    questionChars: question.length,
    promptChars: prompt.length,
    contextChars: context.length,
    ...(opts.meta && typeof opts.meta === "object" ? { meta: opts.meta } : {}),
  };

  fs.writeFileSync(`${base}.json`, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  const md = [
    `# Cursor pending pack · ${id}`,
    ``,
    `- at: ${meta.atIso}`,
    `- reason: ${reason}`,
    `- surface: ${meta.surface || "(none)"}`,
    `- author: ${meta.authorName || meta.authorId || "(none)"}`,
    `- deep: ${meta.deep} · selfFix: ${meta.selfFix}`,
    ``,
    `## Question`,
    ``,
    scrubSecrets(question) || "(empty)",
    ``,
    `## Context`,
    ``,
    context || "(none)",
    ``,
    `## Full prompt (what would go to Cursor)`,
    ``,
    prompt || "(prompt not captured — use question + context)",
    ``,
  ].join("\n");

  fs.writeFileSync(`${base}.md`, md, "utf8");

  appendAction("cursorPendingPack", {
    id,
    reason,
    path: `${base}.md`,
    chars: md.length,
  });
  pushStatusEvent(`cursor pending pack · ${reason} · ${id}`);
  return { id, mdPath: `${base}.md`, jsonPath: `${base}.json`, reason };
}

export function listCursorPendingPacks({ limit = 12 } = {}) {
  const dir = pendingDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .map((n) => {
      const full = path.join(dir, n);
      try {
        const st = fs.statSync(full);
        const row = JSON.parse(fs.readFileSync(full, "utf8"));
        return {
          ...row,
          jsonPath: full,
          mdPath: full.replace(/\.json$/, ".md"),
          mtimeMs: st.mtimeMs,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.at || b.mtimeMs || 0) - Number(a.at || a.mtimeMs || 0));
  return files.slice(0, Math.max(1, limit));
}

export function gatherPendingCursorPacksBrief({ maxChars = 2500 } = {}) {
  const rows = listCursorPendingPacks({ limit: 8 });
  if (!rows.length) return "";
  const lines = rows.map((r) => {
    const when = r.atIso || (r.at ? new Date(r.at).toISOString().slice(0, 16) : "?");
    return `- [${when}] ${r.id} · ${r.reason} · q=${String(r.questionChars || 0)}c`;
  });
  let brief = `### Cursor pending packs (manual replay)\n${lines.join("\n")}\nDir: data/training/cursor-pending/`;
  if (brief.length > maxChars) brief = brief.slice(0, maxChars) + "\n_[truncated]_";
  return brief;
}

import fs from "node:fs";
import path from "node:path";
import { AVA_HANDOFF } from "./config.mjs";
import { downloadAttachment } from "./discordApi.mjs";

/**
 * Save Discord attachments pinged at Ava into Server Handoffs/Ava Ivy/uploads/
 */
export function uploadsDir() {
  const dir = path.join(AVA_HANDOFF, "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function plansDir() {
  const dir = path.join(AVA_HANDOFF, "plans");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeName(name) {
  return String(name || "file")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 120);
}

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
/** Skip huge blobs for Cursor vision (~8MB decoded). */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function mimeFromFilename(name, contentType = "") {
  const ct = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (ct.startsWith("image/")) return ct;
  const ext = path.extname(String(name || "")).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  return "";
}

export function isImageAttachment(att) {
  if (!att) return false;
  const mime = mimeFromFilename(att.filename || att.name, att.content_type || att.contentType);
  if (mime.startsWith("image/")) return true;
  const ext = path.extname(String(att.filename || att.name || "")).toLowerCase();
  return IMAGE_EXT.has(ext);
}

/**
 * @returns {Promise<{ relative: string, full: string, mime: string, isImage: boolean, bytes: number }[]>}
 */
export async function saveMessageAttachments(msg) {
  const atts = collectMessageAttachments(msg);
  if (!atts.length) return [];
  const saved = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const a of atts) {
    if (!a?.url || !a?.id) continue;
    const base = `${stamp}_${a.id}_${safeName(a.filename || "att")}`;
    const dest = path.join(uploadsDir(), base);
    try {
      await downloadAttachment(a.url, dest);
      const st = fs.statSync(dest);
      const mime = mimeFromFilename(a.filename, a.content_type) || "application/octet-stream";
      saved.push({
        relative: path.relative(AVA_HANDOFF, dest).replace(/\\/g, "/"),
        full: dest,
        mime,
        isImage: mime.startsWith("image/") || IMAGE_EXT.has(path.extname(dest).toLowerCase()),
        bytes: st.size,
      });
    } catch (err) {
      console.warn("upload save failed:", err.message);
    }
  }
  return saved;
}

/** Attachments on this message + referenced parent (reply-to-screenshot). */
export function collectMessageAttachments(msg) {
  const out = [];
  const seen = new Set();
  const pushAll = (list) => {
    for (const a of list || []) {
      if (!a?.id || seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(a);
    }
  };
  pushAll(msg?.attachments);
  pushAll(msg?.referenced_message?.attachments);
  for (const e of msg?.embeds || []) {
    const url = e?.image?.url || e?.thumbnail?.url;
    if (!url) continue;
    const id = `embed-${String(url).slice(-24)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      url,
      filename: path.basename(String(url).split("?")[0]) || "embed.png",
      content_type: "image/png",
    });
  }
  return out;
}

/**
 * Load saved image uploads as Cursor SDKImage payloads (base64).
 * @param {{ full: string, mime: string, isImage: boolean, bytes: number, relative?: string }[]} saved
 * @returns {{ data: string, mimeType: string }[]}
 */
export function imagesForCursor(saved, { max = 4 } = {}) {
  const images = [];
  for (const s of saved || []) {
    if (images.length >= max) break;
    if (!s?.isImage || !s.full) continue;
    if ((s.bytes || 0) > MAX_IMAGE_BYTES) {
      console.warn("skip oversized image for Cursor:", s.relative || s.full);
      continue;
    }
    try {
      const buf = fs.readFileSync(s.full);
      if (buf.length > MAX_IMAGE_BYTES) continue;
      const mimeType =
        (s.mime && s.mime.startsWith("image/") && s.mime) ||
        mimeFromFilename(s.full) ||
        "image/png";
      images.push({
        data: buf.toString("base64"),
        mimeType,
      });
    } catch (err) {
      console.warn("image read failed:", err.message);
    }
  }
  return images;
}

/** List newest upload filenames for packs. */
export function listRecentUploads(limit = 8) {
  try {
    return fs
      .readdirSync(uploadsDir())
      .map((name) => ({
        name,
        full: path.join(uploadsDir(), name),
        mtime: fs.statSync(path.join(uploadsDir(), name)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function listRecentPlans(limit = 6) {
  try {
    return fs
      .readdirSync(plansDir())
      .filter((n) => n.endsWith(".md"))
      .map((name) => ({
        name,
        full: path.join(plansDir(), name),
        mtime: fs.statSync(path.join(plansDir(), name)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Write / update a proposal plan file under plans/.
 */
export function writeProposalPlan({ proposalId, title, body }) {
  const id = String(proposalId || `draft-${Date.now()}`).replace(/[^\w.\-]+/g, "_");
  const file = path.join(plansDir(), `${id}.md`);
  const header = `# Plan: ${title || id}\n\n_Updated: ${new Date().toISOString()}_\n\n`;
  fs.writeFileSync(file, header + String(body || "").trim() + "\n", "utf8");
  return file;
}

export function proposalPlanTemplate({ problem, plan, risks, rollback }) {
  return `## Problem
${problem || "(tbd)"}

## Plan
${plan || "(tbd)"}

## Risks
${risks || "(tbd)"}

## Rollback
${rollback || "(tbd)"}
`;
}

/**
 * Central Ava media directory helpers for the desktop control app.
 * Default: $AVA_HANDOFF/media (override AVA_MEDIA_DIR).
 */
import fs from "node:fs";
import path from "node:path";

const IMAGE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".mp4",
  ".webm",
  ".mov",
]);

export function handoffRoot() {
  return process.env.AVA_HANDOFF || "/home/ava-core/ava";
}

export function mediaRoot() {
  const fromEnv = String(process.env.AVA_MEDIA_DIR || "").trim();
  return fromEnv || path.join(handoffRoot(), "media");
}

export function ensureMediaDirs() {
  const root = mediaRoot();
  for (const sub of [
    "library",
    "outbound",
    "imports",
    "weather/gifs/current",
    "weather/gifs/archive",
  ]) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
  return root;
}

export function mimeForFile(filePath) {
  const lower = String(filePath || "").toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  return "application/octet-stream";
}

export function isMediaFile(filePath) {
  return IMAGE_EXT.has(path.extname(String(filePath || "")).toLowerCase());
}

export function isImageFile(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].includes(ext);
}

/**
 * Recursively list media files under media root (follows library symlinks).
 */
export function listMediaFiles({ limit = 200, under = "library" } = {}) {
  const root = ensureMediaDirs();
  const start = under
    ? path.join(root, under)
    : root;
  const out = [];
  const walk = (dir, depth = 0) => {
    if (out.length >= limit || depth > 6) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= limit) break;
      if (ent.name.startsWith(".")) continue;
      const abs = path.join(dir, ent.name);
      let st;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(abs, depth + 1);
        continue;
      }
      if (!st.isFile() || !isMediaFile(abs)) continue;
      out.push({
        path: abs,
        name: ent.name,
        size: st.size,
        mtime: st.mtimeMs,
        relative: path.relative(root, abs),
        image: isImageFile(abs),
      });
    }
  };
  if (fs.existsSync(start)) walk(start);
  out.sort((a, b) => b.mtime - a.mtime);
  return { ok: true, root, under: under || "", files: out.slice(0, limit) };
}

/**
 * Copy external files into media/imports and return absolute paths.
 */
export function importMediaFiles(filePaths = []) {
  const root = ensureMediaDirs();
  const destDir = path.join(root, "imports");
  const imported = [];
  for (const raw of filePaths || []) {
    const src = path.resolve(String(raw || ""));
    if (!src || !fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    const base = path.basename(src);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dest = path.join(destDir, `${stamp}_${base}`);
    fs.copyFileSync(src, dest);
    imported.push({
      path: dest,
      name: path.basename(dest),
      size: fs.statSync(dest).size,
      relative: path.relative(root, dest),
      image: isImageFile(dest),
    });
  }
  return { ok: true, root, imported };
}

/** Validate paths exist and are files; return absolute paths. */
export function resolveExistingFiles(filePaths = [], { max = 10 } = {}) {
  const out = [];
  for (const raw of filePaths || []) {
    if (out.length >= max) break;
    const abs = path.resolve(String(raw || "").trim());
    if (!abs) continue;
    try {
      const st = fs.statSync(abs);
      if (!st.isFile()) continue;
      out.push(abs);
    } catch {
      /* skip */
    }
  }
  return out;
}

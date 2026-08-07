/**
 * Public files host — jars / apks / aabs for Alex + crew.
 * Disk: /var/www/publicfiles  · URLs via Ava :8787 and Apache alias.
 */
import fs from "node:fs";
import path from "node:path";
import { AVA_PORT } from "./config.mjs";

export const PUBLIC_FILES_ROOT =
  process.env.AVA_PUBLICFILES_DIR || "/var/www/publicfiles";

const KINDS = ["jars", "apks", "aabs", "misc"];

export function publicFilesUrls() {
  const port = AVA_PORT || 8787;
  return {
    public: "https://ava.rootmc.net/publicfiles/",
    lan: `http://192.168.1.62:${port}/publicfiles/`,
    apache: "http://192.168.1.62/publicfiles/",
  };
}

export function ensurePublicFilesTree() {
  fs.mkdirSync(PUBLIC_FILES_ROOT, { recursive: true });
  for (const k of KINDS) {
    fs.mkdirSync(path.join(PUBLIC_FILES_ROOT, k), { recursive: true });
  }
  const readme = path.join(PUBLIC_FILES_ROOT, "README.txt");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      "Ava public files — jars / apks / aabs / misc\nhttps://ava.rootmc.net/publicfiles/\n",
      "utf8",
    );
  }
}

function listDir(rel = "") {
  const abs = path.join(PUBLIC_FILES_ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((d) => !d.name.startsWith("."))
    .map((d) => {
      const full = path.join(abs, d.name);
      let size = 0;
      try {
        size = d.isFile() ? fs.statSync(full).size : 0;
      } catch {
        /* ignore */
      }
      return {
        name: d.name,
        dir: d.isDirectory(),
        size,
        rel: path.posix.join(rel.replace(/\\/g, "/"), d.name),
      };
    });
}

export function listPublicFilesBrief() {
  ensurePublicFilesTree();
  const lines = [];
  for (const k of KINDS) {
    const items = listDir(k).filter((x) => !x.dir);
    if (!items.length) {
      lines.push(`· ${k}/ (empty)`);
      continue;
    }
    for (const it of items.slice(0, 12)) {
      const mb = (it.size / (1024 * 1024)).toFixed(1);
      lines.push(`· ${k}/${it.name} (${mb} MB)`);
    }
    if (items.length > 12) lines.push(`· ${k}/ … +${items.length - 12} more`);
  }
  return lines.join("\n") || "· (no files yet)";
}

/** Resolve a safe path under PUBLIC_FILES_ROOT or null. */
export function resolvePublicFile(urlPath) {
  ensurePublicFilesTree();
  let rel = String(urlPath || "")
    .replace(/^\/publicfiles\/?/i, "")
    .replace(/\?.*$/, "");
  try {
    rel = decodeURIComponent(rel);
  } catch {
    /* keep */
  }
  if (!rel || rel.endsWith("/")) {
    return { kind: "index", rel: rel.replace(/\/$/, "") };
  }
  const abs = path.normalize(path.join(PUBLIC_FILES_ROOT, rel));
  const root = path.normalize(PUBLIC_FILES_ROOT);
  if (!abs.startsWith(root)) return null;
  if (!fs.existsSync(abs)) return null;
  const st = fs.statSync(abs);
  if (st.isDirectory()) return { kind: "index", rel, abs };
  return { kind: "file", rel, abs, size: st.size };
}

function indexHtml(rel = "") {
  const items = listDir(rel);
  const urls = publicFilesUrls();
  const rows = items
    .map((it) => {
      const href = `/publicfiles/${it.rel}`;
      const label = it.dir ? `${it.name}/` : it.name;
      const sz = it.dir ? "—" : `${(it.size / (1024 * 1024)).toFixed(2)} MB`;
      return `<tr><td><a href="${href}">${label}</a></td><td>${sz}</td></tr>`;
    })
    .join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>Ava public files</title>
<style>
body{font-family:ui-sans-serif,system-ui,sans-serif;margin:2rem;background:#0b0f14;color:#e8eef7}
a{color:#7dd3fc} table{border-collapse:collapse;width:100%;max-width:720px}
td,th{padding:.4rem .6rem;border-bottom:1px solid #243041;text-align:left}
h1{font-size:1.25rem} .meta{color:#9aa7b8;font-size:.9rem}
</style></head><body>
<h1>Ava public files${rel ? " / " + rel : ""}</h1>
<p class="meta">${urls.public}</p>
<table><thead><tr><th>Name</th><th>Size</th></tr></thead>
<tbody>
${rel ? `<tr><td><a href="/publicfiles/${rel.split("/").slice(0, -1).join("/")}">../</a></td><td>—</td></tr>` : ""}
${rows || "<tr><td colspan=2>(empty)</td></tr>"}
</tbody></table>
</body></html>`;
}

/**
 * Express-less handler for Ava HTTP server.
 * @returns {boolean} true if handled
 */
export function tryServePublicFiles(req, res, url) {
  const pathname = url.pathname || "";
  if (!pathname.startsWith("/publicfiles")) return false;
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    res.statusCode = 405;
    res.end("method not allowed");
    return true;
  }
  const resolved = resolvePublicFile(pathname);
  if (!resolved) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("not found");
    return true;
  }
  if (resolved.kind === "index") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    if (method === "HEAD") {
      res.end();
      return true;
    }
    res.end(indexHtml(resolved.rel || ""));
    return true;
  }
  const ext = path.extname(resolved.abs).toLowerCase();
  const type =
    ext === ".jar"
      ? "application/java-archive"
      : ext === ".apk"
        ? "application/vnd.android.package-archive"
        : ext === ".aab"
          ? "application/octet-stream"
          : ext === ".txt"
            ? "text/plain; charset=utf-8"
            : "application/octet-stream";
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Length", String(resolved.size));
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${path.basename(resolved.abs)}"`,
  );
  if (method === "HEAD") {
    res.end();
    return true;
  }
  fs.createReadStream(resolved.abs).pipe(res);
  return true;
}

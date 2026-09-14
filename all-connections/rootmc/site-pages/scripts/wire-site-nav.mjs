/**
 * One-shot: wire RootMC HTML pages to /scripts/site-nav.js
 * Run: node scripts/wire-site-nav.mjs  (from rootmc-web)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

const SKIP = new Set([
  // redirect stubs — no header
  path.join(publicDir, "plugins", "root-rewards", "index.html"),
  path.join(publicDir, "plugins", "rootmc-shops", "index.html"),
  path.join(publicDir, "plugins", "roothelp", "index.html"),
  path.join(publicDir, "g2", "index.html"),
  path.join(publicDir, "reserve", "index.html"),
  path.join(publicDir, "g2", "reserve", "index.html"),
]);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "s" || ent.name === "plugins" && false) {
        /* still walk plugins */
      }
      if (ent.name === "s") continue; // /s/* has its own chrome
      walk(p, out);
    } else if (ent.name === "index.html") {
      out.push(p);
    }
  }
  return out;
}

function modeFor(relPosix) {
  if (relPosix.startsWith("developer/")) return "developer";
  if (relPosix.startsWith("plugins/") || relPosix === "plugins/index.html" || relPosix === "servers/index.html") {
    return "operator";
  }
  // governance / council / terms — out of scope; leave alone unless they have rmc-nav
  if (
    relPosix.startsWith("governance/") ||
    relPosix.startsWith("council/") ||
    relPosix === "terms/index.html"
  ) {
    return null;
  }
  return "player";
}

function currentHint(relPosix) {
  if (relPosix.startsWith("developer/keys")) return "keys";
  if (relPosix.startsWith("developer/servers")) return "servers";
  if (relPosix.startsWith("developer/login")) return "login";
  if (relPosix.startsWith("developer/register")) return "register";
  if (relPosix === "developer/index.html") return "portal";
  if (relPosix.startsWith("plugins/")) return "plugins";
  if (relPosix === "servers/index.html") return "home";
  return "";
}

const NAV_RE = /<nav\s+class="rmc-nav"[^>]*>[\s\S]*?<\/nav>/i;
const INLINE_HEADER_NAV_RE =
  /<header class="rmc-header"><div class="container rmc-header-inner"><a class="rmc-brand"[^>]*>[\s\S]*?<\/a><nav class="rmc-nav"[^>]*>[\s\S]*?<\/nav><\/div><\/header>/i;

const TOGGLE_SNIPPET_RE =
  /<script>\s*\(function\(\)\{\s*var t = document\.querySelector\('\[data-nav-toggle\]'\);[\s\S]*?\}\)\(\);\s*<\/script>/gi;

const TOGGLE_SNIPPET_ALT_RE =
  /<script>\s*\(\s*function\s*\(\s*\)\s*\{[\s\S]*?data-nav-toggle[\s\S]*?is-open[\s\S]*?\}\s*\)\s*\(\s*\)\s*;\s*<\/script>/gi;

function ensureToggleButton(html) {
  if (/data-nav-toggle/.test(html)) return html;
  // insert before closing of rmc-header-inner if present
  if (/<\/div>\s*<\/header>/.test(html) && /rmc-header-inner/.test(html)) {
    return html.replace(
      /(<\/nav>\s*)(<\/div>\s*<\/header>)/i,
      `$1<button class="rmc-nav-toggle" type="button" aria-label="Open menu" data-nav-toggle>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      $2`,
    );
  }
  return html;
}

function ensureScript(html) {
  if (/\/scripts\/site-nav\.js/.test(html)) return html;
  // Prefer before </body>
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, '  <script src="/scripts/site-nav.js" defer></script>\n</body>');
  }
  return html + '\n<script src="/scripts/site-nav.js" defer></script>\n';
}

function stripInlineToggle(html) {
  let out = html.replace(TOGGLE_SNIPPET_RE, "");
  out = out.replace(TOGGLE_SNIPPET_ALT_RE, "");
  // time/health reference /js/nav.js — remove if present
  out = out.replace(/\s*<script src="\/js\/nav\.js"[^>]*><\/script>/gi, "");
  return out;
}

function expandMinimalHeader(html, mode, current) {
  const curAttr = current ? ` data-site-nav-current="${current}"` : "";
  const replacement = `<header class="rmc-header">
  <div class="container rmc-header-inner">
    <a class="rmc-brand" href="/">
      <span class="rmc-brand-mark" aria-hidden="true">R</span>
      RootMC
      <span class="rmc-brand-tag">${mode === "developer" ? "Dev" : "Network"}</span>
    </a>
    <nav class="rmc-nav" aria-label="Main" data-site-nav="${mode}"${curAttr}></nav>
    <button class="rmc-nav-toggle" type="button" aria-label="Open menu" data-nav-toggle>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    </button>
  </div>
</header>`;
  return html.replace(INLINE_HEADER_NAV_RE, replacement);
}

function replaceNav(html, mode, current) {
  const curAttr = current ? ` data-site-nav-current="${current}"` : "";
  const empty = `<nav class="rmc-nav" aria-label="Main" data-site-nav="${mode}"${curAttr}></nav>`;
  if (INLINE_HEADER_NAV_RE.test(html)) {
    return expandMinimalHeader(html, mode, current);
  }
  if (!NAV_RE.test(html)) return html;
  return html.replace(NAV_RE, empty);
}

function patchFile(file) {
  if (SKIP.has(file)) return "skip";
  const rel = path.relative(publicDir, file).split(path.sep).join("/");
  const mode = modeFor(rel);
  if (!mode) return "out-of-scope";

  let html = fs.readFileSync(file, "utf8");
  if (!/class="rmc-nav"/.test(html) && !/class='rmc-nav'/.test(html)) {
    return "no-nav";
  }
  // already wired
  if (/data-site-nav=/.test(html) && /\/scripts\/site-nav\.js/.test(html)) {
    return "already";
  }

  const current = currentHint(rel);
  const before = html;
  html = replaceNav(html, mode, current);
  html = ensureToggleButton(html);
  html = stripInlineToggle(html);
  html = ensureScript(html);

  // developer brand should point at /developer/
  if (mode === "developer") {
    html = html.replace(
      /<a class="rmc-brand" href="\/">/,
      '<a class="rmc-brand" href="/developer/">',
    );
    // keep existing /developer/ brands
  }

  if (html === before && !/data-site-nav=/.test(html)) {
    return "unchanged-fail";
  }
  fs.writeFileSync(file, html);
  return "ok";
}

const files = walk(publicDir);
const stats = {};
for (const f of files) {
  const r = patchFile(f);
  stats[r] = (stats[r] || 0) + 1;
  if (r === "ok" || r === "unchanged-fail") {
    console.log(r, path.relative(publicDir, f));
  }
}
console.log(JSON.stringify(stats, null, 2));

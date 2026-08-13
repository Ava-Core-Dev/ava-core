/**
 * Shared Ava Ivy web chrome — cyan/navy theme + dual transparent portraits.
 * Right: wave hello (bottom). Left: hang-from-top (thighs cut at top edge).
 * Inject into HTML pages (not OBS transparent overlays).
 */
import { AVA_COLORS, avaThemeCssVars } from "./avaTheme.mjs";

export const AVA_PORTRAIT_FILE = "ava-wave-hello-still.png";
export const AVA_PORTRAIT_HANG_FILE = "ava-portrait-hang.png";

/** Public path for the transparent Ava still (served by Ava core). */
export function avaPortraitUrl(basePath = "", file = AVA_PORTRAIT_FILE) {
  const base = String(basePath || "").replace(/\/$/, "");
  return `${base}/appearance/${file}`;
}

export function avaPortraitHangUrl(basePath = "") {
  return avaPortraitUrl(basePath, AVA_PORTRAIT_HANG_FILE);
}

/** Absolute CDN-ish fallbacks when page is proxied / wiki static. */
export function avaPortraitUrlCandidates(basePath = "") {
  const local = avaPortraitUrl(basePath);
  return [
    local,
    "https://ava.rootmc.net/appearance/ava-wave-hello-still.png",
    "https://rootrecord.info/ava/status/appearance/ava-wave-hello-still.png",
    "https://rootrecord.info/ava/assets/ava-wave-hello-still.png",
  ];
}

/** Shared RootRecord · RootMC · Ava switcher. */
export function avaEcoBarCss() {
  return `
.eco-bar {
  display: flex; align-items: center; justify-content: center; flex-wrap: wrap;
  gap: 0.15rem; padding: 0.4rem 1rem;
  background: #000d1a; border-bottom: 1px solid rgba(0, 229, 255, 0.16);
  font-family: "DM Sans", system-ui, sans-serif;
}
.eco-bar a {
  color: #7a92a8; text-decoration: none; font-size: 0.78rem; font-weight: 650;
  letter-spacing: 0.06em; text-transform: uppercase;
  padding: 0.28rem 0.9rem; border-radius: 999px;
}
.eco-bar a:hover { color: #ffffff; background: rgba(0, 229, 255, 0.08); }
.eco-bar a[aria-current="page"] {
  color: #00e5ff; background: rgba(0, 229, 255, 0.12);
}`.trim();
}

export function avaEcoBarHtml(active = "ava") {
  const items = [
    { href: "https://rootrecord.info/", key: "rootrecord", label: "RootRecord" },
    { href: "https://rootmc.net/", key: "rootmc", label: "RootMC" },
    { href: "https://rootrecord.info/ava/", key: "ava", label: "Ava" },
  ];
  const links = items
    .map((it) => {
      const on = it.key === active ? ' aria-current="page"' : "";
      return `<a href="${it.href}"${on}>${it.label}</a>`;
    })
    .join("");
  return `<nav class="eco-bar" aria-label="Ecosystem">${links}</nav>`;
}

export function avaWebChromeCss({
  portraitUrl,
  hangUrl,
} = {}) {
  const c = AVA_COLORS;
  const url = portraitUrl || avaPortraitUrl();
  const hang = hangUrl || avaPortraitHangUrl();
  return `
:root {
  ${avaThemeCssVars()}
  --panel: rgba(0, 13, 26, 0.55);
  --ava-portrait: url("${url}");
  --ava-portrait-hang: url("${hang}");
}
${avaEcoBarCss()}
html { color-scheme: dark; }
body.ava-branded,
body:has(#ava-web-portrait) {
  position: relative;
  isolation: isolate;
  color: var(--ink);
  background:
    radial-gradient(1100px 520px at 8% -8%, #00334d 0%, transparent 55%),
    radial-gradient(800px 420px at 100% 0%, #001a33 0%, transparent 48%),
    linear-gradient(168deg, var(--bg0), var(--bg1)) !important;
}
#ava-web-portrait {
  position: fixed;
  right: max(-2vw, -24px);
  bottom: 0;
  width: min(42vw, 520px);
  height: min(72vh, 720px);
  z-index: 0;
  pointer-events: none;
  user-select: none;
  background-image: var(--ava-portrait);
  background-repeat: no-repeat;
  background-position: right bottom;
  background-size: contain;
  opacity: 0.32;
  filter: drop-shadow(0 0 48px ${c.cyanGlow});
  -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 18%, #000 100%);
  mask-image: linear-gradient(90deg, transparent 0%, #000 18%, #000 100%);
}
#ava-web-portrait-hang {
  position: fixed;
  left: max(-4vw, -36px);
  top: 0;
  width: min(38vw, 440px);
  height: min(62vh, 640px);
  z-index: 0;
  pointer-events: none;
  user-select: none;
  background-image: var(--ava-portrait-hang);
  background-repeat: no-repeat;
  background-position: left top;
  background-size: contain;
  opacity: 0.36;
  filter: drop-shadow(0 0 48px ${c.cyanGlow});
  -webkit-mask-image: linear-gradient(270deg, transparent 0%, #000 22%, #000 100%);
  mask-image: linear-gradient(270deg, transparent 0%, #000 22%, #000 100%);
}
@media (max-width: 820px) {
  #ava-web-portrait {
    width: min(58vw, 380px);
    height: min(48vh, 440px);
    opacity: 0.2;
    right: -8vw;
  }
  #ava-web-portrait-hang {
    width: min(48vw, 320px);
    height: min(42vh, 360px);
    opacity: 0.22;
    left: -10vw;
  }
}
@media (max-width: 520px) {
  #ava-web-portrait { opacity: 0.12; width: 64vw; height: 38vh; }
  #ava-web-portrait-hang { opacity: 0.14; width: 52vw; height: 34vh; }
}
body.ava-branded > *:not(#ava-web-portrait):not(#ava-web-portrait-hang),
body:has(#ava-web-portrait) > *:not(#ava-web-portrait):not(#ava-web-portrait-hang) {
  position: relative;
  z-index: 1;
}
a { color: var(--accent); }
`.trim();
}

export function avaWebPortraitMarkup({ portraitUrl, hangUrl } = {}) {
  const url = portraitUrl || avaPortraitUrl();
  const hang = hangUrl || avaPortraitHangUrl();
  return (
    `<div id="ava-web-portrait-hang" aria-hidden="true" style="--ava-portrait-hang:url('${hang}')"></div>` +
    `<div id="ava-web-portrait" aria-hidden="true" style="--ava-portrait:url('${url}')"></div>`
  );
}

function shouldSkipChrome(html) {
  const h = String(html || "");
  if (!h.includes("<html") && !h.includes("<!DOCTYPE")) return true;
  if (h.includes('id="ava-web-chrome"') || h.includes('id="ava-web-portrait"')) return true;
  // OBS / transparent overlays
  if (/\/obs\/|OBS Quake|OBS Ava Reactions|Stream HUD|background:\s*transparent\s*!important/i.test(h)) {
    return true;
  }
  return false;
}

/**
 * Inject Ava colors + transparent portraits into a full HTML document.
 */
export function withAvaWebChrome(
  html,
  { basePath = "", portraitUrl = null, hangUrl = null } = {},
) {
  if (shouldSkipChrome(html)) return html;
  const url = portraitUrl || avaPortraitUrl(basePath);
  const hang = hangUrl || avaPortraitHangUrl(basePath);
  const css = avaWebChromeCss({ portraitUrl: url, hangUrl: hang });
  const mark = avaWebPortraitMarkup({ portraitUrl: url, hangUrl: hang });
  let out = String(html);

  if (/<\/head>/i.test(out)) {
    out = out.replace(
      /<\/head>/i,
      `<style id="ava-web-chrome">${css}</style>\n</head>`,
    );
  }

  if (/<body\b[^>]*>/i.test(out)) {
    out = out.replace(/<body(\s[^>]*)?>/i, (full, attrs = "") => {
      let a = attrs || "";
      if (/\bclass\s*=/i.test(a)) {
        a = a.replace(
          /\bclass\s*=\s*(["'])([^"']*)\1/i,
          (m, q, cls) => `class=${q}${cls} ava-branded${q}`,
        );
      } else {
        a = `${a} class="ava-branded"`;
      }
      const eco = /class=["']eco-bar["']/.test(out) ? "" : avaEcoBarHtml("ava");
      return `<body${a}>${mark}${eco}`;
    });
  }

  return out;
}

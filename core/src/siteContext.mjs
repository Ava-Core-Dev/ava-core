import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_PUBLIC = path.resolve(__dirname, "../../rootmc-web/public");

/** Curated public RootMC pages Ava can cite. */
export const SITE_CATALOG = [
  { id: "wiki-hub", url: "https://rootmc.net/wiki/", local: "wiki/index.html", keywords: ["wiki", "guide", "docs", "help"] },
  { id: "wiki-economy", url: "https://rootmc.net/wiki/economy/", local: "wiki/economy/index.html", keywords: ["economy", "gold", "g ", "shop", "reserve", "loan", "tax", "baltop", "mint", "note"] },
  { id: "wiki-player", url: "https://rootmc.net/wiki/player/", local: "wiki/player/index.html", keywords: ["player", "join", "link", "howto", "new"] },
  { id: "wiki-land", url: "https://rootmc.net/wiki/", local: "wiki/index.html", keywords: ["claim", "land", "chunk", "town"] },
  { id: "wiki-territories", url: "https://rootmc.net/wiki/territories/", local: "wiki/territories/index.html", keywords: ["territory", "territories", "influence"] },
  { id: "wiki-constitution", url: "https://rootmc.net/wiki/constitution/", local: "wiki/constitution/index.html", keywords: ["constitution", "governance", "rules", "treasury"] },
  { id: "wiki-plugins", url: "https://rootmc.net/wiki/plugins/", local: "wiki/plugins/index.html", keywords: ["plugin", "plugins", "suite", "install", "command", "commands"] },
  { id: "wiki-api", url: "https://rootmc.net/wiki/plugins/api/", local: "wiki/plugins/api/index.html", keywords: ["api", "manifest", "updater", "heartbeat"] },
  { id: "wiki-versioning", url: "https://rootmc.net/wiki/versioning/", local: "wiki/versioning/index.html", keywords: ["version", "versioning"] },
  { id: "wiki-awards", url: "https://rootmc.net/wiki/weekly-awards/", local: "wiki/weekly-awards/index.html", keywords: ["award", "weekly", "prize"] },
  { id: "thanks", url: "https://rootmc.net/thanks/", local: "thanks/index.html", keywords: ["thanks", "token", "appreciation", "redeem", "vote", "bonus"] },
  { id: "plugins-catalog", url: "https://rootmc.net/plugins/", local: "plugins/index.html", keywords: ["catalog", "download", "jar"] },
  { id: "economy-live", url: "https://rootmc.net/economy/", local: "economy/index.html", keywords: ["economy", "dashboard", "live"] },
  { id: "heads", url: "https://rootmc.net/wiki/", local: "wiki/index.html", keywords: ["head", "heads", "mobhead", "skull"] },
];

function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function readLocal(rel) {
  const full = path.join(WEB_PUBLIC, rel);
  if (!fs.existsSync(full)) return null;
  try {
    return htmlToText(fs.readFileSync(full, "utf8"));
  } catch {
    return null;
  }
}

async function fetchRemote(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "RootMC-Ava/0.4 (+https://rootmc.net)" },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    return htmlToText(await res.text());
  } catch {
    return null;
  }
}

/** Score catalog pages against the question; return top snippets. Prefers local files for speed. */
export async function gatherSiteContext(question, { maxPages = 3, maxChars = 6500 } = {}) {
  const q = String(question || "").toLowerCase();
  const scored = SITE_CATALOG.map((page) => {
    let score = 0;
    for (const kw of page.keywords) {
      if (q.includes(kw.toLowerCase())) score += kw.length > 4 ? 3 : 2;
    }
    if (score === 0 && /wiki|site|docs|guide|how/.test(q)) score = 1;
    return { ...page, score };
  })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);

  const picks = (
    scored.length
      ? scored
      : SITE_CATALOG.filter((p) => p.id === "wiki-hub" || p.id === "wiki-economy")
  ).slice(0, maxPages);

  const loaded = await Promise.all(
    picks.map(async (page) => {
      let text = readLocal(page.local);
      if (!text || text.length < 80) {
        text = await fetchRemote(page.url);
      }
      if (!text) return null;
      return { page, text: text.slice(0, 2000) };
    }),
  );

  const blocks = [];
  let used = 0;
  for (const item of loaded) {
    if (!item) continue;
    const block = `### ${item.page.id} (${item.page.url})\n${item.text}`;
    if (used + block.length > maxChars) break;
    blocks.push(block);
    used += block.length;
  }

  const index = SITE_CATALOG.map((p) => `- ${p.url} [${p.keywords.slice(0, 4).join(", ")}]`).join("\n");
  return {
    pages: picks.map((p) => p.url),
    brief: `Public RootMC resource index:\n${index}\n\nPulled page text (prefer these facts):\n${blocks.join("\n\n") || "(none pulled — say you're not sure, don't invent)"}`,
  };
}

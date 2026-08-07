/**
 * Expand Ava gateway/REST watch to all RootMC guild text-ish channels.
 * Keeps ~4s awareness across the whole server (Alex 2026-08-02).
 */
import { ROOTMC_GUILD_ID, AVA_CHANNELS } from "./config.mjs";

const TEXTISH = new Set([0, 5, 15, 16]); // text, announcement, forum, media

/**
 * @param {(path: string) => Promise<any>} fetchJson
 * @returns {Promise<string[]>}
 */
export async function listGuildWatchChannelIds(fetchJson) {
  if (!fetchJson) return [];
  const guild = ROOTMC_GUILD_ID || "1516108585740800042";
  const chans = await fetchJson(`/guilds/${guild}/channels`);
  if (!Array.isArray(chans)) return [];

  const ids = [];
  for (const c of chans) {
    if (!c?.id) continue;
    if (TEXTISH.has(c.type)) ids.push(String(c.id));
  }

  // Active threads (forum posts etc.) — hear live proposal / talk threads
  try {
    const active = await fetchJson(`/guilds/${guild}/threads/active`);
    for (const t of active?.threads || []) {
      if (t?.id) ids.push(String(t.id));
    }
  } catch {
    /* optional */
  }

  // Always include named criticals
  for (const id of Object.values(AVA_CHANNELS)) {
    if (id && /^\d+$/.test(String(id))) ids.push(String(id));
  }

  return [...new Set(ids)];
}

/**
 * Merge into mutable watch array + optional gateway addWatch.
 * @returns {{ added: string[], total: number }}
 */
export function mergeWatchIds(watchArr, ids, gatewayHandle = null) {
  const added = [];
  for (const id of ids || []) {
    const s = String(id || "").trim();
    if (!s || watchArr.includes(s)) continue;
    watchArr.push(s);
    added.push(s);
    gatewayHandle?.addWatch?.(s);
  }
  return { added, total: watchArr.length };
}

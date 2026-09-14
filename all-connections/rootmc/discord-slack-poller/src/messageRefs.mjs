import { DEFAULT_WATCH_CHANNELS, AVA_CHANNELS } from "./config.mjs";

/**
 * Resolve pasted Discord message snowflakes / jump links into real content.
 */

const SNOWFLAKE = /\b(\d{17,20})\b/g;
const JUMP =
  /https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/\d+\/(\d+)\/(\d+)/i;

async function fetchMsg(fetchJson, channelId, messageId) {
  if (!channelId || !messageId) return null;
  try {
    return await fetchJson(`/channels/${channelId}/messages/${messageId}`);
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<{ question: string, resolved: object[] }>}
 */
export async function expandMessageRefs(
  fetchJson,
  { question, channelId, guildId },
) {
  let q = String(question || "");
  const resolved = [];

  const jump = q.match(JUMP);
  if (jump) {
    const msg = await fetchMsg(fetchJson, jump[1], jump[2]);
    if (msg?.id) {
      resolved.push(summarize(msg));
      q = appendMsg(q, msg);
    } else {
      q += `\n\n[linked message fetch failed]`;
    }
  }

  const ids = [...q.matchAll(SNOWFLAKE)].map((m) => m[1]);
  const unique = [...new Set(ids)].slice(0, 3);
  const tryChannels = [
    channelId,
    AVA_CHANNELS.general,
    AVA_CHANNELS.admins,
    AVA_CHANNELS.avaHome,
    ...DEFAULT_WATCH_CHANNELS,
  ].filter(Boolean);

  for (const id of unique) {
    if (resolved.some((r) => r.id === id)) continue;
    let found = null;
    for (const ch of [...new Set(tryChannels)]) {
      found = await fetchMsg(fetchJson, ch, id);
      if (found?.id) break;
    }
    if (found?.id) {
      resolved.push(summarize(found));
      q = appendMsg(q, found);
    } else if (/^\d{17,20}$/.test(String(question || "").trim())) {
      q += `\n\n[could not fetch message ${id} — paste a jump link or the text]`;
    }
  }

  void guildId;
  return { question: q, resolved };
}

function appendMsg(q, msg) {
  let out = `${q}\n\n[message ${msg.id} by ${msg.author?.username || "?"}]: ${String(msg.content || "").slice(0, 500)}`;
  if (Array.isArray(msg.mentions) && msg.mentions.length) {
    out += `\n[mentions: ${msg.mentions.map((u) => `${u.username}(${u.id})`).join(", ")}]`;
  }
  return out;
}

function summarize(msg) {
  return {
    id: msg.id,
    channelId: msg.channel_id,
    authorId: msg.author?.id,
    authorName: msg.author?.username,
    content: String(msg.content || "").slice(0, 500),
  };
}

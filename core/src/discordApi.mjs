/**
 * Shared Discord REST helpers for Ava (poller + gateway).
 * Long content is multi-posted (same pattern as RootMC Official reports).
 */
import { DISCORD_API } from "./config.mjs";
import { splitDiscordContent, sleep } from "./splitContent.mjs";

export function authHeaders(token) {
  return {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "AvaIvyRootMC (rootmc.net, 0.5)",
  };
}

export function makeFetchJson(token) {
  const headers = authHeaders(token);
  return async function fetchJson(path, init = {}) {
    const res = await fetch(`${DISCORD_API}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers || {}) },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };
}

/**
 * Post one or more Discord messages. Content over ~1900 chars is split on
 * paragraph/line boundaries (report-style multipost). Only the first part
 * uses message_reference. Returns the first message object.
 */
export async function postMessage(fetchJson, channelId, content, refId) {
  const raw = String(content || "").trim();
  // Never post empty / signoff-only leftovers
  if (!raw || /^[—\-–]\s*Ava\s*$/i.test(raw)) {
    return null;
  }
  const parts = splitDiscordContent(raw).filter(
    (p) => p && !/^[—\-–]\s*Ava\s*$/i.test(String(p).trim()),
  );
  if (!parts.length) {
    return null;
  }

  let first = null;
  for (let i = 0; i < parts.length; i++) {
    const msg = await fetchJson(`/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content: parts[i].slice(0, 2000),
        message_reference:
          i === 0 && refId ? { message_id: String(refId) } : undefined,
        allowed_mentions: { parse: [] },
      }),
    });
    if (!first) first = msg;
    if (i < parts.length - 1) await sleep(350);
  }
  if (parts.length > 1) {
    first = first || {};
    first._avaParts = parts.length;
  }
  return first;
}

export async function createDmChannel(fetchJson, userId) {
  return fetchJson(`/users/@me/channels`, {
    method: "POST",
    body: JSON.stringify({ recipient_id: String(userId) }),
  });
}

export async function sendDm(fetchJson, userId, content) {
  const ch = await createDmChannel(fetchJson, userId);
  if (!ch?.id) throw new Error("dm_channel_failed");
  return postMessage(fetchJson, ch.id, content, null);
}

/**
 * Edit one of Ava's own Discord messages.
 * Bots can always edit their own posts (no Manage Messages required).
 */
export async function editMessage(fetchJson, channelId, messageId, content) {
  return fetchJson(`/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      content: String(content || "").slice(0, 2000),
      allowed_mentions: { parse: [] },
    }),
  });
}

/** Download Discord attachment into Ava uploads/. */
export async function downloadAttachment(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const fs = await import("node:fs");
  const path = await import("node:path");
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  return destPath;
}

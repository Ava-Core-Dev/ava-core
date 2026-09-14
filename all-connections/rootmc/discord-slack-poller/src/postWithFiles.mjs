/**
 * Post a Discord message with optional local file attachments (multipart).
 * Long captions multipost like RootMC Official reports — first part carries files.
 */
import fs from "node:fs";
import path from "node:path";
import { DISCORD_API } from "./config.mjs";
import { makeFetchJson, postMessage } from "./discordApi.mjs";
import { recordAvaUtterance } from "./fullLog.mjs";
import { splitDiscordContent, sleep } from "./splitContent.mjs";

/**
 * @param {string} token
 * @param {string} channelId
 * @param {string} content
 * @param {string[]} filePaths absolute paths
 */
export async function postMessageWithFiles(token, channelId, content, filePaths = []) {
  const files = (filePaths || [])
    .map((p) => String(p || "").trim())
    .filter((p) => p && fs.existsSync(p));

  const parts = splitDiscordContent(String(content || ""));
  const chunks = parts.length ? parts : [""];

  if (!files.length) {
    try {
      const msg = await postMessage(makeFetchJson(token), channelId, content, null);
      recordAvaUtterance({
        surface: "discord",
        channelId,
        content,
        kind: "boot_post",
        source: "postWithFiles",
        ok: true,
        messageId: msg?.id || null,
        meta: msg?._avaParts ? { parts: msg._avaParts } : undefined,
      });
      return msg;
    } catch (err) {
      recordAvaUtterance({
        surface: "discord",
        channelId,
        content,
        kind: "boot_post",
        source: "postWithFiles",
        ok: false,
        error: String(err.message || err).slice(0, 120),
      });
      throw err;
    }
  }

  // First chunk + files
  const form = new FormData();
  const payload = {
    content: chunks[0].slice(0, 2000),
    allowed_mentions: { parse: [] },
    attachments: files.map((p, i) => ({
      id: i,
      filename: path.basename(p),
    })),
  };
  form.append("payload_json", JSON.stringify(payload));
  for (let i = 0; i < files.length; i++) {
    const buf = fs.readFileSync(files[i]);
    const name = path.basename(files[i]);
    const lower = name.toLowerCase();
    const type = lower.endsWith(".mp4")
      ? "video/mp4"
      : lower.endsWith(".gif")
        ? "image/gif"
        : lower.endsWith(".png")
          ? "image/png"
          : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
            ? "image/jpeg"
            : lower.endsWith(".webp")
              ? "image/webp"
              : "application/octet-stream";
    const blob = new Blob([buf], { type });
    form.append(`files[${i}]`, blob, name);
  }

  const res = await fetch(
    `${DISCORD_API}/channels/${encodeURIComponent(channelId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "User-Agent": "AvaIvyRootMC (rootmc.net, 0.5)",
      },
      body: form,
    },
  );
  const text = await res.text();
  if (!res.ok) {
    recordAvaUtterance({
      surface: "discord",
      channelId,
      content,
      kind: "boot_post",
      source: "postWithFiles",
      ok: false,
      error: `${res.status}`,
      meta: { files: files.length },
    });
    throw new Error(`post+files ${res.status}: ${text.slice(0, 300)}`);
  }
  const msg = text ? JSON.parse(text) : null;

  // Remaining text parts (no files)
  if (chunks.length > 1) {
    const fetchJson = makeFetchJson(token);
    for (let i = 1; i < chunks.length; i++) {
      await fetchJson(`/channels/${channelId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content: chunks[i].slice(0, 2000),
          allowed_mentions: { parse: [] },
        }),
      });
      if (i < chunks.length - 1) await sleep(350);
    }
  }

  recordAvaUtterance({
    surface: "discord",
    channelId,
    content,
    kind: "boot_post",
    source: "postWithFiles",
    ok: true,
    messageId: msg?.id || null,
    meta: { files: files.length, parts: chunks.length },
  });
  return msg;
}

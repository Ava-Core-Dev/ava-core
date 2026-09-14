import { postMessage } from "./discordApi.mjs";
import { AVA_CHANNELS } from "./config.mjs";

/**
 * Post notable Ava/ship notes to the changelog / updates channel.
 */

export async function postChangelog(fetchJson, { title, body, channelId } = {}) {
  const ch = channelId || AVA_CHANNELS.changelog || AVA_CHANNELS.updates;
  if (!fetchJson || !ch) return null;
  const content = ["**Ava changelog**", title ? `### ${title}` : null, body || ""]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1900);
  return postMessage(fetchJson, ch, content, null);
}

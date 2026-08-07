/**
 * Split long posts the same way RootMC Official automated reports do
 * (see rootmc-discord-markdown.splitDiscordMarkdown) so Ava can take over
 * long official updates without Discord/Slack truncating mid-thought.
 */

export const DISCORD_CONTENT_MAX = 1900;
export const SLACK_CONTENT_MAX = 3800;

/**
 * @param {string} text
 * @param {number} [max]
 * @returns {string[]}
 */
export function splitContent(text, max = DISCORD_CONTENT_MAX) {
  const chunks = [];
  let rest = String(text || "").trim();
  if (!rest) return [];
  const limit = Math.max(200, Number(max) || DISCORD_CONTENT_MAX);
  while (rest.length > 0) {
    if (rest.length <= limit) {
      chunks.push(rest);
      break;
    }
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < limit * 0.45) cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.45) cut = rest.lastIndexOf(" ", limit);
    if (cut < limit * 0.45) cut = limit;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  // Drop orphaned "— Ava" / "- Ava" multipost leftovers
  return chunks.filter(
    (c) => c && !/^[—\-–]\s*Ava\s*$/i.test(c.trim()),
  );
}

export function splitDiscordContent(text) {
  return splitContent(text, DISCORD_CONTENT_MAX);
}

export function splitSlackContent(text) {
  return splitContent(text, SLACK_CONTENT_MAX);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

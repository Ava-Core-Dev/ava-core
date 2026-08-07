/**
 * Text-only Council votes in #voting (buttons retired).
 * Ava seeds ✅/❌/➖ at poll open; casts / forwards via workstation-auth API.
 */
import { AVA_CHANNELS } from "./config.mjs";
import { castTextVote } from "./governanceClient.mjs";
import { postMessage } from "./discordApi.mjs";

const AVA_APP_ID = "1532751879875072070";

const CHOICE_RE =
  /^\s*(?:ava\s+votes?\s+)?(for|against|abstain|yes|no|veto)\b(?:\s+(?:on\s+)?([A-Za-z0-9_-]{4,}))?/i;

function normalizeChoice(raw) {
  const c = String(raw || "").toLowerCase();
  if (c === "yes" || c === "for") return "for";
  if (c === "no" || c === "veto" || c === "against") return "against";
  if (c === "abstain") return "abstain";
  return null;
}

function extractProposalId(content, referencedContent) {
  const fromRef = String(referencedContent || "").match(/\b((?:PROP|BILL|VOTE)-[A-Za-z0-9_-]+|[a-f0-9]{8})\b/i);
  if (fromRef) return fromRef[1];
  const fromBody = String(content || "").match(/\b((?:PROP|BILL|VOTE)-[A-Za-z0-9_-]+|[a-f0-9]{8})\b/i);
  return fromBody ? fromBody[1] : null;
}

/**
 * @returns {Promise<boolean>} true if message was handled as a vote
 */
export async function tryHandleTextVote({ fetchJson, msg, botAppId }) {
  const channelId = String(msg.channel_id || "");
  if (channelId !== String(AVA_CHANNELS.voting)) return false;
  if (msg.author?.bot && String(msg.author.id) !== String(botAppId || AVA_APP_ID)) return false;

  const content = String(msg.content || "").trim();
  const m = content.match(CHOICE_RE);
  if (!m) return false;

  const choice = normalizeChoice(m[1]);
  if (!choice) return false;

  const ref = msg.referenced_message;
  const proposalId =
    m[2] ||
    extractProposalId(content, ref?.content) ||
    (ref?.embeds?.[0]?.footer?.text || "").match(/Proposal\s+(\S+)/i)?.[1] ||
    null;
  if (!proposalId) {
    await postMessage(
      fetchJson,
      channelId,
      "Need a proposal id — reply to the poll message or write `for PROP-XX` / `against PROP-XX`.",
      msg.id,
    ).catch(() => {});
    return true;
  }

  const asDiscord = String(msg.author?.id || "");
  if (!asDiscord) return false;

  const result = await castTextVote(proposalId, choice, asDiscord);
  const line = result?.ok
    ? `Recorded **${choice}** on **${proposalId}** — ${result.detail || "ok"}`
    : `Couldn't record that vote: ${result?.detail || "unknown error"}`;
  await postMessage(fetchJson, channelId, line, msg.id).catch(() => {});
  return true;
}

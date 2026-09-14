/**
 * Seed vote_yes / vote_no / ➖ on governance proposal & vote messages Ava opens.
 * Signal only — weighted ballots stay text / site.
 */
import { AVA_CHANNELS } from "./config.mjs";
import { appEmojiReaction } from "./appEmojis.mjs";

export const VOTE_START_REACTIONS = [
  appEmojiReaction("vote_yes") || "vote_yes:1533005800908525698",
  appEmojiReaction("vote_no") || "vote_no:1533005790829346937",
  "➖",
];

const PROP_KIND_RE =
  /^(governance_vote_open|governance_prop_forum|governance_vote|proposal_open|prop_open|vote_open|legislature_vote)(_|$)/i;

const PROP_CONTENT_RE =
  /\*\*\s*VOTE\b|\*\*\s*PROP\b|\*\*Proposal:|React:\s*(?:vote_yes|✅)|7[- ]?day weighted|Council poll|formal vote/i;

/**
 * @param {{ kind?: string, channelId?: string, content?: string, seedVoteReactions?: boolean|null }} opts
 */
export function shouldSeedProposalReactions({
  kind,
  channelId,
  content,
  seedVoteReactions,
} = {}) {
  if (seedVoteReactions === false) return false;
  if (seedVoteReactions === true) return true;
  const k = String(kind || "");
  if (/pointer|announce|progress|ops_/i.test(k)) return false;
  if (PROP_KIND_RE.test(k)) return true;
  // #voting channel: only when content looks like an open vote/PROP
  if (channelId && channelId === AVA_CHANNELS.voting && PROP_CONTENT_RE.test(String(content || ""))) {
    return true;
  }
  if (PROP_CONTENT_RE.test(String(content || ""))) return true;
  if (
    channelId &&
    channelId === AVA_CHANNELS.proposals &&
    /\*\*\s*(PROP|Proposal|VOTE)\b/i.test(String(content || ""))
  ) {
    return true;
  }
  return false;
}

/**
 * @param {((path: string, init?: object) => Promise<any>)|null} fetchJson
 * @param {string} channelId
 * @param {string} messageId
 * @param {string[]} [emojis]
 */
export async function seedVoteReactions(
  fetchJson,
  channelId,
  messageId,
  emojis = VOTE_START_REACTIONS,
) {
  if (!fetchJson || !channelId || !messageId) return false;
  let ok = true;
  for (const emoji of emojis) {
    let attempts = 0;
    while (attempts < 3) {
      attempts += 1;
      try {
        const enc = encodeURIComponent(emoji);
        await fetchJson(
          `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions/${enc}/@me`,
          { method: "PUT" },
        );
        break;
      } catch (err) {
        const msg = String(err?.message || err);
        const retry = /429|rate limited|retry_after/i.test(msg);
        if (retry && attempts < 3) {
          await new Promise((r) => setTimeout(r, 400 * attempts));
          continue;
        }
        ok = false;
        console.warn("seedVoteReactions", emoji, msg);
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return ok;
}

/**
 * Seed when a post is a proposal/vote. No-ops if not applicable.
 */
export async function maybeSeedProposalReactions(fetchJson, {
  channelId,
  messageId,
  kind,
  content,
  seedVoteReactions: seedOpt,
} = {}) {
  if (
    !shouldSeedProposalReactions({
      kind,
      channelId,
      content,
      seedVoteReactions: seedOpt,
    })
  ) {
    return false;
  }
  return seedVoteReactions(fetchJson, channelId, messageId);
}

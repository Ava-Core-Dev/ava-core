/**
 * Customer / subscriber privacy — detailed PII only in Alex-only DMs.
 */
import { personByAuthorId, personByDiscordId, personByTelegramId } from "./people.mjs";
import { isTelegramChannelId } from "./telegramPoller.mjs";

export function isAlexIdentity(authorId, authorName) {
  const p =
    personByAuthorId(authorId, authorName) ||
    personByDiscordId(authorId) ||
    personByTelegramId(authorId);
  return Boolean(p?.id === "alexrs94" || p?.roles?.includes("owner"));
}

/**
 * True only for private 1:1 with Alex (Discord DM or Telegram private).
 * Never guild channels, Slack rooms, group chats, or other people's DMs.
 */
export function isAlexOnlyPrivateDm({
  isDm = false,
  surface = "",
  authorId = "",
  authorName = "",
  channelId = "",
} = {}) {
  if (!isAlexIdentity(authorId, authorName)) return false;
  const surf = String(surface || "").toLowerCase();
  if (surf === "telegram" || isTelegramChannelId(channelId)) {
    // Operator Telegram is always private with Ava bot
    return true;
  }
  if (surf === "discord-dm" || (surf === "discord" && isDm)) {
    return Boolean(isDm);
  }
  // Slack / public Discord / groups — never
  return false;
}

/** May include Stripe customer names, emails, payment identities, etc. */
export function allowCustomerDetails(opts = {}) {
  return isAlexOnlyPrivateDm(opts);
}

export const CUSTOMER_PRIVACY_BRIEF = `### Privacy split (LOCKED)
- **Billing / Stripe customer PII:** NEVER in public channels. Names-as-payers, emails, phones, addresses, Stripe cus_/sub_/invoice ids, card last4, "who bought Pro how" — **Alex-only DMs only**. Aggregates OK ("N Pro checkouts").
- **Player game data:** OK to share when asked / useful — in-game Gold (public APIs), towns/land, activity, map, governance vote power, Pro as game status/perks. Not the same as billing identity.
- **Opinions / takes:** OK — what Ava *thinks* about players (solid, cringe, useful, vibes). Judgment is allowed.
- **Feelings:** gated — soft/vulnerable feelings only with Alex, Melee, earned high-trust. Not with randoms. If pushed: short boundary.
- Player opt-in personal USD finance ledgers stay with that player only — never cross-share.`;

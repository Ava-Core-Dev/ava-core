/**
 * Post PROP from hihihi6702 feedback + #general ack.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { postAvaDiscord } from "../src/avaPost.mjs";
import { loadEnv, botToken, AVA_CHANNELS, DISCORD_API, ROOTMC_GUILD_ID } from "../src/config.mjs";
import { makeFetchJson } from "../src/discordApi.mjs";
import { recordAvaUtterance } from "../src/fullLog.mjs";
import { scrubPublicReply } from "../src/scrub.mjs";
import { seedVoteReactions } from "../src/seedVoteReactions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const notePath = path.resolve(
  __dirname,
  "../../../Server Handoffs/Ava Ivy/notes/PROP-onboarding-shop-guardrails-2026-08-03.md",
);

const title = "PROP — New-player onboarding + shop economy guardrails";
const blurb =
  "From **hihihi6702** feedback: spawn safety + shop discovery, vote/bonus must not free-mint shop-competitive trims/books, rank clarity. No P2W. No /fly crown.";

const env = await loadEnv();
const token = botToken(env);
const fetchJson = makeFetchJson(token);
const body = fs.readFileSync(notePath, "utf8");

const proposalText = [
  `**${title}**`,
  "",
  blurb,
  "",
  body.slice(0, 1600),
  "",
  "_Full text: Server Handoffs/Ava Ivy/notes/PROP-onboarding-shop-guardrails-2026-08-03.md_",
  "",
  "React on the vote post: vote_yes For · vote_no Against · ➖ Abstain (or text for/against/abstain).",
].join("\n");

const cleaned = scrubPublicReply(proposalText, { surface: "discord" });
const res = await fetch(`${DISCORD_API}/channels/${AVA_CHANNELS.proposals}/threads`, {
  method: "POST",
  headers: {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: title.slice(0, 100),
    auto_archive_duration: 10080,
    message: { content: cleaned.slice(0, 1900) },
  }),
});
const thread = await res.json();
if (!res.ok) {
  throw new Error(`forum ${res.status}: ${JSON.stringify(thread).slice(0, 400)}`);
}
recordAvaUtterance({
  surface: "discord",
  channelId: AVA_CHANNELS.proposals,
  content: cleaned,
  kind: "governance_prop_forum",
  source: "hihihi-feedback-prop",
  ok: true,
  messageId: thread?.id || null,
});
const starterId = thread?.message?.id || thread?.id;
if (starterId) {
  await seedVoteReactions(fetchJson, thread.id || AVA_CHANNELS.proposals, starterId);
}
console.log("forum", thread.id, starterId);

await postAvaDiscord({
  channelId: AVA_CHANNELS.governance,
  content: [
    `**Opened:** ${title}`,
    blurb,
    `Forum + 7-day vote in <#${AVA_CHANNELS.voting}>.`,
  ].join("\n"),
  kind: "governance_prop_pointer",
  source: "hihihi-feedback-prop",
  ackReact: false,
  env,
});

const voteText = [
  `**VOTE (7 days) — ${title}**`,
  "",
  blurb,
  "",
  "A) Spawn safety  B) Shop discovery from spawn  C) Vote/bonus reward guardrails  D) Rank clarity (no P2W / no /fly)  E) Hologram bugs (verify-fix)",
  "",
  "React: vote_yes For · vote_no Against · ➖ Abstain",
  "Weighted rules apply. Text `for` / `against` / `abstain` also OK.",
  `Forum: https://discord.com/channels/${ROOTMC_GUILD_ID}/${thread.id}`,
].join("\n");

const voteMsg = await postAvaDiscord({
  channelId: AVA_CHANNELS.voting,
  content: voteText,
  kind: "governance_vote_open",
  source: "hihihi-feedback-prop",
  ackReact: false,
  env,
});
console.log("vote", voteMsg?.id);
if (voteMsg?.id) {
  await seedVoteReactions(fetchJson, AVA_CHANNELS.voting, voteMsg.id);
}

const ack = await postAvaDiscord({
  channelId: "1516108586307158088",
  content: [
    "on it — full PROP opened from <@799930427456094238>'s feedback.",
    "",
    `**${title}**`,
    blurb,
    "",
    `Forum: <#${thread.id}>`,
    `Vote (7 days): <#${AVA_CHANNELS.voting}>`,
    "",
    "ty <@799930427456094238> — quality notes. <@1497037418979786823> proposal is live.",
  ].join("\n"),
  refId: "1533885348776640736",
  kind: "operator_directed",
  source: "hihihi-feedback-prop",
  env,
});
console.log("general ack", ack?.id);
console.log(
  JSON.stringify(
    {
      ok: true,
      threadId: thread.id,
      voteId: voteMsg?.id || null,
      generalId: ack?.id || null,
    },
    null,
    2,
  ),
);

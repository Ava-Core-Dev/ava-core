/**
 * Post governance PROP drafts — forum thread in #proposals + vote in #voting.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { postAvaDiscord } from "../src/avaPost.mjs";
import { loadEnv, botToken, AVA_CHANNELS, DISCORD_API } from "../src/config.mjs";
import { makeFetchJson } from "../src/discordApi.mjs";
import { recordAvaUtterance } from "../src/fullLog.mjs";
import { scrubPublicReply } from "../src/scrub.mjs";
import { seedVoteReactions } from "../src/seedVoteReactions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTES = path.resolve(
  __dirname,
  "../../../Server Handoffs/Ava Ivy/notes",
);
const PROPOSALS_FORUM = AVA_CHANNELS.proposals; // type 15 forum

const PROPS = [
  {
    file: "PROP-root-ava-core.md",
    title: "PROP — Root-Ava-Core plugin",
    blurb:
      "Authorize design of Paper plugin **Root-Ava-Core** (Ava in-game companion hooks). **No live jar** until Alex greenlights after this vote. Docs under Ava Ivy notes.",
  },
  {
    file: "PROP-website-100usd.md",
    title: "PROP — Website tools ~$100 USD",
    blurb:
      "One-time **~$100 USD** (not Gold) tools/marketing budget for Ava’s site design. **Do not spend** until this vote passes.",
  },
];

async function createForumThread(token, name, content) {
  const cleaned = scrubPublicReply(content, { surface: "discord" });
  const res = await fetch(`${DISCORD_API}/channels/${PROPOSALS_FORUM}/threads`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: String(name).slice(0, 100),
      auto_archive_duration: 10080,
      message: { content: cleaned.slice(0, 1900) },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`forum thread ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  recordAvaUtterance({
    surface: "discord",
    channelId: PROPOSALS_FORUM,
    content: cleaned,
    kind: "governance_prop_forum",
    source: "wave-props",
    ok: true,
    messageId: data?.id || null,
  });
  // Forum starter message id is often data.message.id or data.id (thread id = starter in some payloads)
  const starterId = data?.message?.id || data?.id;
  if (starterId) {
    const fetchJson = makeFetchJson(token);
    // Seed on thread channel (thread id) when starter lives in the thread
    const threadId = data?.id;
    await seedVoteReactions(fetchJson, threadId || PROPOSALS_FORUM, starterId);
  }
  return data;
}

async function main() {
  const env = await loadEnv();
  const token = botToken(env);
  const fetchJson = makeFetchJson(token);

  for (const p of PROPS) {
    const body = fs.readFileSync(path.join(NOTES, p.file), "utf8");
    const proposalText = [
      `**${p.title}**`,
      "",
      p.blurb,
      "",
      body.slice(0, 1600),
      "",
      "_Full text: Server Handoffs/Ava Ivy/notes/_",
    ].join("\n");

    const thread = await createForumThread(token, p.title, proposalText);
    console.log("forum thread", p.file, thread?.id, thread?.message?.id || thread?.id);

    // Also mirror short note to #governance
    await postAvaDiscord({
      channelId: AVA_CHANNELS.governance,
      content: [
        `**Opened:** ${p.title}`,
        p.blurb,
        `Forum thread + 7-day vote in ${"<#" + AVA_CHANNELS.voting + ">"}.`,
      ].join("\n"),
      kind: "governance_prop_pointer",
      source: "wave-props",
      ackReact: false,
      env,
    });

    const voteText = [
      `**VOTE (7 days) — ${p.title}**`,
      "",
      p.blurb,
      "",
      "React: vote_yes For · vote_no Against · ➖ Abstain",
      "Weighted rules apply. Text `for` / `against` / `abstain` also OK.",
    ].join("\n");

    const voteMsg = await postAvaDiscord({
      channelId: AVA_CHANNELS.voting,
      content: voteText,
      kind: "governance_vote_open",
      source: "wave-props",
      ackReact: false,
      env,
    });
    console.log("voting", p.file, voteMsg?.id);
    // postAvaDiscord auto-seeds PROP/vote reactions; keep explicit for clarity
    if (voteMsg?.id) {
      await seedVoteReactions(makeFetchJson(token), AVA_CHANNELS.voting, voteMsg.id);
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  console.log("props posted");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

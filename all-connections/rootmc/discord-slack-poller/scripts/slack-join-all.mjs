/**
 * Join Ava to every public Slack channel she can see; list private ones she needs invites for.
 * After join (and for already-member channels), archive full history locally.
 */
import { loadEnv, slackBotToken, AVA_CHANNELS } from "../src/config.mjs";
import { archiveSlackChannel } from "../src/slackChannelArchive.mjs";

const env = await loadEnv();
const token = slackBotToken(env);
if (!token) {
  console.error("missing AVA_SLACK_BOT_TOKEN");
  process.exit(1);
}

async function api(method, body = {}) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function listAllChannels() {
  const all = [];
  let cursor = "";
  do {
    const data = await api("conversations.list", {
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 200,
      cursor: cursor || undefined,
    });
    if (!data.ok) throw new Error(data.error || "conversations.list failed");
    all.push(...(data.channels || []));
    cursor = data.response_metadata?.next_cursor || "";
  } while (cursor);
  return all;
}

const channels = await listAllChannels();
const joined = [];
const already = [];
const failed = [];
const privateNeedInvite = [];
const archived = [];

for (const ch of channels) {
  const id = ch.id;
  const name = ch.name || id;
  if (ch.is_member) {
    already.push({ id, name, private: Boolean(ch.is_private) });
    continue;
  }
  if (ch.is_private) {
    privateNeedInvite.push({ id, name });
    continue;
  }
  const j = await api("conversations.join", { channel: id });
  if (j.ok || j.error === "already_in_channel") {
    joined.push({ id, name });
  } else {
    failed.push({ id, name, error: j.error });
  }
}

// Save everything already in every channel she's in (new + existing)
for (const ch of [...joined, ...already]) {
  try {
    const r = await archiveSlackChannel(token, ch.id, { force: false });
    archived.push({
      id: ch.id,
      name: ch.name,
      messages: r.messages || 0,
      skipped: Boolean(r.skipped),
      error: r.error || null,
    });
  } catch (err) {
    archived.push({ id: ch.id, name: ch.name, error: err.message });
  }
}

// Prefer dig channels in watch list reminder
const digIds = [AVA_CHANNELS.slackDev, AVA_CHANNELS.slackPlans];
const digStatus = digIds.map((id) => {
  const c = channels.find((x) => x.id === id);
  return { id, name: c?.name || "?", member: Boolean(c?.is_member) || joined.some((j) => j.id === id) };
});

console.log(
  JSON.stringify(
    {
      total: channels.length,
      already: already.length,
      joined: joined.length,
      joinedNames: joined.map((j) => j.name),
      alreadyNames: already.map((j) => j.name),
      privateNeedInvite,
      failed,
      digStatus,
      archived,
    },
    null,
    2,
  ),
);

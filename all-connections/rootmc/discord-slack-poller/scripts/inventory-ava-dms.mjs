/**
 * Inventory every Discord DM Ava has + local evidence of private chats.
 */
import fs from "node:fs";
import path from "node:path";
import {
  loadEnv,
  botToken,
  telegramBotToken,
  DISCORD_API,
  AVA_BOT_APP_ID,
} from "../src/config.mjs";
import { storePaths } from "../src/store.mjs";

const env = await loadEnv();
const token = botToken(env);
const headers = { Authorization: `Bot ${token}` };

console.log("=== DISCORD /users/@me/channels ===");
const listRes = await fetch(`${DISCORD_API}/users/@me/channels`, { headers });
const list = await listRes.json();
console.log("status", listRes.status, "type", Array.isArray(list) ? `array(${list.length})` : typeof list);

const dmChannels = Array.isArray(list) ? list : [];

// Also scan turns/onboarding for author IDs that look like DM conversations
const dataDir = storePaths().dir;
const people = new Map(); // id -> { username, sources, lastAt, preview }

function notePerson(id, username, source, at, preview) {
  if (!id || id === AVA_BOT_APP_ID) return;
  const cur = people.get(id) || {
    id,
    username: username || null,
    sources: new Set(),
    lastAt: 0,
    preview: "",
  };
  if (username) cur.username = username;
  cur.sources.add(source);
  if (at && at > cur.lastAt) {
    cur.lastAt = at;
    if (preview) cur.preview = String(preview).slice(0, 160);
  }
  people.set(id, cur);
}

for (const c of dmChannels) {
  const recip = c.recipients || [];
  for (const r of recip) {
    notePerson(r.id, r.username, "discord-dm-list", Date.now(), "");
  }
  if (!c.id) continue;
  const mRes = await fetch(
    `${DISCORD_API}/channels/${c.id}/messages?limit=50`,
    { headers },
  );
  const msgs = await mRes.json();
  if (!Array.isArray(msgs)) continue;
  console.log(
    `\nDM ${c.id} recipients=${recip.map((r) => `${r.username}/${r.id}`).join(",") || "?"} msgs=${msgs.length}`,
  );
  for (const m of msgs) {
    const when = Number((BigInt(m.id) >> 22n) + 1420070400000n);
    const who = m.author?.username || "?";
    const isAva = m.author?.id === AVA_BOT_APP_ID || m.author?.bot;
    if (!isAva) {
      notePerson(m.author?.id, who, "discord-dm-msg", when, m.content);
    } else {
      // Ava message in a DM — attribute to recipients
      for (const r of recip) {
        notePerson(r.id, r.username, "discord-dm-ava-out", when, m.content);
      }
    }
    console.log(
      `  ${new Date(when).toISOString()} | ${isAva ? "[Ava]" : who}: ${String(m.content || "").slice(0, 200).replace(/\n/g, " ")}`,
    );
  }
}

// Known Alex DM we opened earlier
const KNOWN = ["1497037418979786823"]; // always probe Alex
for (const uid of KNOWN) {
  const dmRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient_id: uid }),
  });
  const dm = await dmRes.json();
  if (!dm?.id) continue;
  if (dmChannels.some((c) => c.id === dm.id)) continue;
  console.log(`\n(probed) DM ${dm.id} with ${uid}`);
  const mRes = await fetch(
    `${DISCORD_API}/channels/${dm.id}/messages?limit=50`,
    { headers },
  );
  const msgs = await mRes.json();
  if (!Array.isArray(msgs)) continue;
  console.log(`  msgs=${msgs.length}`);
  for (const m of [...msgs].reverse()) {
    const when = Number((BigInt(m.id) >> 22n) + 1420070400000n);
    const isAva = m.author?.id === AVA_BOT_APP_ID || m.author?.bot;
    if (!isAva) notePerson(m.author?.id, m.author?.username, "discord-dm-msg", when, m.content);
    else notePerson(uid, null, "discord-dm-ava-out", when, m.content);
    console.log(
      `  ${new Date(when).toISOString()} | ${isAva ? "[Ava]" : m.author?.username}: ${String(m.content || "").slice(0, 200).replace(/\n/g, " ")}`,
    );
  }
}

// Onboarding / guild profiles may list DM targets
const guildsDir = path.join(dataDir, "guilds");
if (fs.existsSync(guildsDir)) {
  for (const f of fs.readdirSync(guildsDir)) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(guildsDir, f), "utf8"));
      const text = JSON.stringify(j);
      if (/dm|onboard/i.test(text)) {
        console.log("guild file mentions dm:", f);
      }
    } catch {
      /* skip */
    }
  }
}

// Scan turns.jsonl for surface dm / isDm / private
const turnsPath = path.join(dataDir, "conversations", "turns.jsonl");
if (fs.existsSync(turnsPath)) {
  const lines = fs.readFileSync(turnsPath, "utf8").split(/\r?\n/).filter(Boolean);
  let dmish = 0;
  for (const line of lines) {
    let t;
    try {
      t = JSON.parse(line);
    } catch {
      continue;
    }
    const surface = String(t.surface || "").toLowerCase();
    const ch = String(t.channelId || "");
    const isDm =
      surface.includes("dm") ||
      t.isDm === true ||
      /telegram/i.test(surface) ||
      // Discord DM snowflakes often not in guild channel list — hard to detect
      false;
    if (isDm || surface === "telegram") {
      dmish++;
      notePerson(
        t.authorId,
        t.authorName,
        surface || "turn-dm",
        t.at || t.ts || 0,
        t.question || t.answer,
      );
    }
  }
  console.log("\nturns marked dm/telegram:", dmish);
}

// players dir
const playersDir = path.join(dataDir, "players");
if (fs.existsSync(playersDir)) {
  console.log("\nplayer profiles:", fs.readdirSync(playersDir).length);
}

console.log("\n=== UNIQUE PEOPLE (DM / private evidence) ===");
const rows = [...people.values()].sort((a, b) => b.lastAt - a.lastAt);
for (const p of rows) {
  console.log(
    [
      p.id,
      p.username || "?",
      [...p.sources].join("+"),
      p.lastAt ? new Date(p.lastAt).toISOString() : "-",
      JSON.stringify(p.preview || "").slice(0, 120),
    ].join(" | "),
  );
}
console.log("total people", rows.length);

// Telegram: only operator is configured; can't list other private chats without updates
console.log("\n=== TELEGRAM ===");
console.log(
  "Configured operator:",
  String(env.AVA_TELEGRAM_OPERATOR_IDS || "6644482344"),
);
console.log(
  "Bot API cannot list all private chats; only chats that message the bot appear in getUpdates (owned by live poller).",
);

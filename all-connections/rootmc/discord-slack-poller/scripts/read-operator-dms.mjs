/**
 * Read operator DMs: Discord (bot DM channels) + Telegram recent + local turns.
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv, botToken, telegramBotToken, DISCORD_API } from "../src/config.mjs";
import { storePaths } from "../src/store.mjs";

const env = await loadEnv();
const token = botToken(env);
const tgToken = telegramBotToken(env);
const tgOps = String(
  env.AVA_TELEGRAM_OPERATOR_IDS || process.env.AVA_TELEGRAM_OPERATOR_IDS || "6644482344",
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)[0];

console.log("=== DISCORD DM CHANNELS ===");
const chRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
  headers: { Authorization: `Bot ${token}` },
});
const channels = await chRes.json();
if (!Array.isArray(channels)) {
  console.log(JSON.stringify(channels).slice(0, 500));
} else {
  console.log("count", channels.length);
  // Prefer Alex Discord id
  const ALEX = "1497037418979786823";
  const sorted = [...channels].sort((a, b) => {
    const aAlex = (a.recipients || []).some((r) => r.id === ALEX) ? 0 : 1;
    const bAlex = (b.recipients || []).some((r) => r.id === ALEX) ? 0 : 1;
    return aAlex - bAlex;
  });
  for (const c of sorted.slice(0, 12)) {
    const recip = (c.recipients || [])
      .map((r) => `${r.username}/${r.id}`)
      .join(", ");
    console.log("\ndm", c.id, "recipients:", recip);
    const mRes = await fetch(
      `${DISCORD_API}/channels/${c.id}/messages?limit=50`,
      { headers: { Authorization: `Bot ${token}` } },
    );
    const msgs = await mRes.json();
    if (!Array.isArray(msgs)) {
      console.log("  err", JSON.stringify(msgs).slice(0, 200));
      continue;
    }
    for (const m of msgs.reverse()) {
      const when = new Date(
        Number((BigInt(m.id) >> 22n) + 1420070400000n),
      ).toISOString();
      const who = m.author?.bot ? "[Ava]" : m.author?.username || "?";
      console.log(`--- ${when} | ${who}`);
      console.log(String(m.content || "(no text)").slice(0, 1200));
      if (m.attachments?.length) {
        console.log(
          "[att]",
          m.attachments.map((a) => a.filename).join(", "),
        );
      }
    }
  }
}

console.log("\n=== TELEGRAM (getUpdates window) ===");
console.log("operator chat", tgOps);
const upd = await fetch(
  `https://api.telegram.org/bot${tgToken}/getUpdates?limit=100`,
);
const udata = await upd.json();
console.log("ok", udata.ok, "n", (udata.result || []).length, udata.description || "");
const opsMsgs = (udata.result || []).filter((u) => {
  const m = u.message || u.edited_message;
  if (!m) return false;
  return String(m.chat?.id) === String(tgOps) || String(m.from?.id) === String(tgOps);
});
console.log("ops messages in window", opsMsgs.length);
for (const u of opsMsgs.slice(-40)) {
  const m = u.message || u.edited_message;
  const when = new Date((m.date || 0) * 1000).toISOString();
  const who =
    String(m.from?.id) === String(tgOps)
      ? "Alex"
      : m.from?.is_bot
        ? "[Ava]"
        : m.from?.username || m.from?.id;
  let text = m.text || m.caption || "";
  if (!text && m.document) text = `[document ${m.document.file_name}]`;
  if (!text) text = "(media/other)";
  console.log(`--- ${when} | ${who}`);
  console.log(String(text).slice(0, 800));
}

console.log("\n=== LOCAL TURNS (telegram / alex) ===");
const turnsPath = path.join(storePaths().dir, "conversations", "turns.jsonl");
if (fs.existsSync(turnsPath)) {
  const lines = fs.readFileSync(turnsPath, "utf8").split(/\r?\n/).filter(Boolean);
  const hit = lines
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((t) => {
      const s = `${t.surface || ""} ${t.channelId || ""} ${t.authorId || ""}`.toLowerCase();
      return (
        s.includes("telegram") ||
        String(t.authorId) === tgOps ||
        String(t.channelId || "").includes(tgOps) ||
        String(t.authorId) === "1497037418979786823"
      );
    })
    .slice(-40);
  console.log("matching turns", hit.length);
  for (const t of hit) {
    console.log(
      `--- ${t.at || t.ts || ""} | ${t.surface} | ${t.authorName || t.authorId} | ch ${t.channelId}`,
    );
    console.log("Q:", String(t.question || "").slice(0, 400));
    console.log("A:", String(t.answer || "").slice(0, 400));
  }
} else {
  console.log("no turns.jsonl");
}

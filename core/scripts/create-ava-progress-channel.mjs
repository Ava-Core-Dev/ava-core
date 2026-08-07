#!/usr/bin/env node
/**
 * One-shot: create #ava-progress in RootMC guild (Melee ask 2026-08-05).
 * Requires bot token with Manage Channels.
 */
import { loadEnv, DISCORD_API, ROOTMC_GUILD_ID } from "../src/config.mjs";

const env = await loadEnv();
const token = String(env.AVA_DISCORD_BOT_TOKEN || process.env.AVA_DISCORD_BOT_TOKEN || "").trim();
if (!token) {
  console.error("missing AVA_DISCORD_BOT_TOKEN");
  process.exit(1);
}

const headers = {
  Authorization: `Bot ${token}`,
  "Content-Type": "application/json",
};

const listRes = await fetch(`${DISCORD_API}/guilds/${ROOTMC_GUILD_ID}/channels`, { headers });
if (!listRes.ok) {
  console.error("list channels failed", listRes.status, await listRes.text());
  process.exit(1);
}
const channels = await listRes.json();
const existing = channels.find(
  (c) =>
    c.type === 0 &&
    (c.name === "ava-progress" || c.name === "avas-progress" || /ava.*progress/i.test(c.name || "")),
);
if (existing) {
  console.log(JSON.stringify({ ok: true, existing: true, id: existing.id, name: existing.name }));
  process.exit(0);
}

const devParent = channels.find((c) => c.type === 4 && /development/i.test(c.name || ""));
const body = {
  name: "ava-progress",
  type: 0,
  topic:
    "Daily Ava progress — what she learned and got quicker at (Melee ask). Short honest reports; no dig-theater.",
  parent_id: devParent?.id || undefined,
};

const createRes = await fetch(`${DISCORD_API}/guilds/${ROOTMC_GUILD_ID}/channels`, {
  method: "POST",
  headers,
  body: JSON.stringify(body),
});
const text = await createRes.text();
if (!createRes.ok) {
  console.error("create failed", createRes.status, text);
  process.exit(1);
}
const ch = JSON.parse(text);
console.log(JSON.stringify({ ok: true, id: ch.id, name: ch.name, parent: ch.parent_id }));

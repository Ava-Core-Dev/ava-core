import fs from "node:fs";
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";
import { discordMessageUrl } from "./lib/rootmc-discord.mjs";

const API = "https://discord.com/api/v10";
const forumId = "1526664180491358419";
const token = rootMcBotToken(loadRootMcEnv()).replace(/^bot\s+/i, "").trim();
const planPath =
  process.argv[2] ||
  "D:\\.1 Work Stations\\RootMC\\Change Logs\\root-discord-to-root-core-plan.md";
const planBytes = fs.readFileSync(planPath);

const summary = [
  "**Proposal: Migrate Root-Discord → Root-Core (comms rebrand)** — planning only, not building yet.",
  "",
  "**Goal:** Absorb the Paper Discord/Slack bridge into **Root-Core** so Slack + Discord settings live in Core YAML (`cloud.yml` + `root-core.yml`), retire the separate `Root-Discord` jar.",
  "",
  "**Key moves:**",
  "• JDA chat bridge + Slack server-logs webhook client → Root-Core `comms` package",
  "• Chat flags: `root-discord.yml` → `root-core.yml` `comms.discord.chat` (one-time migrate)",
  "• Secrets stay in `cloud.yml` `discord.*` / `slack.*`",
  "• Keep `RootDiscordApi` registration on Core for RootMC / Official (compat)",
  "• Remove `root-discord-*.jar` from Claims/Towny/Test after cutover",
  "",
  "Full plan attached. Status: **parked — do not implement until approved.**",
].join("\n");

const threadRes = await fetch(`${API}/channels/${forumId}/threads`, {
  method: "POST",
  headers: {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "RootMC/post-root-core-comms-plan",
  },
  body: JSON.stringify({
    name: "Migrate Root-Discord into Root-Core (comms rebrand)",
    auto_archive_duration: 10080,
    message: { content: summary.slice(0, 2000) },
  }),
});
const threadText = await threadRes.text();
if (!threadRes.ok) throw new Error(`thread ${threadRes.status}: ${threadText.slice(0, 500)}`);
const thread = JSON.parse(threadText);
console.log("DISCORD_THREAD", discordMessageUrl(forumId, thread.id));

const form = new FormData();
form.append("payload_json", JSON.stringify({ content: "Full plan document (markdown)." }));
form.append("files[0]", new Blob([planBytes], { type: "text/markdown" }), "root-discord-to-root-core-plan.md");
const fileRes = await fetch(`${API}/channels/${thread.id}/messages`, {
  method: "POST",
  headers: { Authorization: `Bot ${token}`, "User-Agent": "RootMC/post-root-core-comms-plan" },
  body: form,
});
const fileText = await fileRes.text();
if (!fileRes.ok) throw new Error(`file ${fileRes.status}: ${fileText.slice(0, 500)}`);
const msg = JSON.parse(fileText);
console.log("DISCORD_FILE", discordMessageUrl(thread.id, msg.id));

/**
 * One-shot intro post for Root Record Global Updater → primary releases channel.
 *
 * Usage:
 *   node scripts/discord-post-global-updater-intro.mjs --channel 1512245745166581821
 */
import fs from "node:fs";
import path from "node:path";

function readEnvFile(p) {
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function arg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] || "").trim();
}

const channelId = arg("--channel") || "1512245745166581821";
if (!/^\d{10,}$/.test(channelId)) {
  console.error("Usage: node scripts/discord-post-global-updater-intro.mjs --channel <channelId>");
  process.exit(1);
}

const credPath =
  process.env.CREDENTIALS_ENV ||
  path.resolve(process.cwd(), "../../../credentials.env");
const env = readEnvFile(credPath);
const token = String(env.DISCORD_BOT_TOKEN || "").replace(/^bot\s+/i, "").trim();
if (token.length < 40) {
  console.error("Missing DISCORD_BOT_TOKEN in credentials.env");
  process.exit(1);
}

const clientId = String(env.DISCORD_CLIENT_ID || "1500289560343740566").trim();
const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=84992&scope=bot%20applications.commands`;

const embed = {
  title: "Root Record Global Updater",
  description:
    "This channel is the **primary home for Root Record product version releases** and cross-app update notes.\n\n" +
    "Other servers can add the same bot and choose **only the product lines they care about** — no backend keys, no accounting noise.",
  color: 0x2d6a4f,
  fields: [
    {
      name: "Add the bot to your server",
      value: inviteUrl,
      inline: false,
    },
    {
      name: "Setup (server admins)",
      value:
        "1. **`/root channel set`** — pick your updates channel\n" +
        "2. **`/root categories set`** — e.g. `weather,blocknotes` or `releases`\n" +
        "3. **`/root categories list`** — all category ids\n" +
        "4. **`/root help`** — full guide",
      inline: false,
    },
    {
      name: "What goes where",
      value:
        "• **This channel + `releases`** — platform / version release notes\n" +
        "• **Per-app categories** — Weather, BM, Block Notes, Root Goals, etc.\n" +
        "• **Kīlauea live feeds** — separate **Kīlauea Alerts** Discord bot\n" +
        "• **ROOTS economy** — separate **Root Economy** Discord bot\n" +
        "• **Never fan-out** — treasury, mints, custodial/accounting, or internal ops",
      inline: false,
    },
    {
      name: "Verified RootRecord users",
      value: "Link at https://rootrecord.online/discord-verify. ROOTS **`/bal`** and **`/send`** are on the **Root Economy** bot (separate invite).",
      inline: false,
    },
    {
      name: "Products",
      value: "https://rootrecord.online/products",
      inline: false,
    },
  ],
  footer: { text: "Root Record Software Solutions" },
};

const followUp =
  "**Category cheat sheet** (comma-separate in `/root categories set`):\n" +
  "`releases` · `weather` · `bm` · `token_manager` · `account_hub` · `blocknotes` · `root_goals` · `root_farms` · `solana` · `visiting_hawaii` · `all` (every product feed — opt-in only)\n\n" +
  "_Kīlauea USGS/AI monitoring uses the **Kīlauea Alerts** bot. ROOTS uses **Root Economy**._";

async function post(payload) {
  const res = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "RootRecord/global-updater-intro",
    },
    body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`Discord HTTP ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

const first = await post({ embeds: [embed] });
console.log("posted embed", first.id);
const second = await post({ content: followUp });
console.log("posted follow-up", second.id);
console.log("done");

import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";

const CHANNEL = "1545284354157187083";
const token = rootMcBotToken(loadRootMcEnv());

const content = `# RootMC ops update

Tonight we shipped a few Discord + automation improvements:

• **Staff reference channels** — pinned channel ID list and cron/automation inventory for dev/staff lookup
• **Monthly Activity Dividend** — #economy-guide now gets a monthly Grok report with exact per-player Gold payouts (wallet credits still queue in-game as before)
• **Test dividend preview** posted to economy — no payouts issued, format check only

Daily/weekly briefs, town plot counts, and wallet vs net worth reporting from earlier this week are live on the Worker — deploy + plugin sync if anything still looks stale in-game.

Questions → staff or #economy-guide for treasury/dividend stuff.`;

const res = await fetch(`https://discord.com/api/v10/channels/${CHANNEL}/messages`, {
  method: "POST",
  headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ content: content.slice(0, 2000) }),
});
const data = await res.json();
if (!res.ok) {
  console.error(res.status, data);
  process.exit(1);
}
console.log(`https://discord.com/channels/1516108585740800042/${CHANNEL}/${data.id}`);

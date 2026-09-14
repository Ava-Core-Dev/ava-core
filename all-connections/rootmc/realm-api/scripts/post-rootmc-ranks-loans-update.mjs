/**
 * Post ranks + loans economy update to #updates.
 *
 * Usage:
 *   node scripts/post-rootmc-ranks-loans-update.mjs
 *   node scripts/post-rootmc-ranks-loans-update.mjs --channel 1545284423740563528
 */
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";

const API = "https://discord.com/api/v10";
const DEFAULT_CHANNEL = "1545284423740563528";

const channelArgIdx = process.argv.indexOf("--channel");
const channelId =
  channelArgIdx >= 0 ? String(process.argv[channelArgIdx + 1] || "").trim() : DEFAULT_CHANNEL;

const env = loadRootMcEnv();
const token = rootMcBotToken(env);

if (!/^\d{10,}$/.test(channelId)) {
  console.error("Invalid --channel");
  process.exit(1);
}
if (token.length < 40) {
  console.error("Need DISCORD_ROOTMC_BOT_TOKEN");
  process.exit(1);
}

const content = `# 📢 Economy update — Player ranks & personal loans

Two changes are live on the server (configs + **Root-Loans** plugin). Full reference: <https://rootmc.net/wiki/economy/>

## 🏅 \`/rank buy\` — lower prices

Player-track ranks are **cheaper** so progression fits the closed-loop economy (town **400 G**, warp **500 G**). Still **one tier at a time**, in order. Gold sinks to the **Server Reserve** on purchase.

| Rank | Price |
|------|------:|
| Wanderer | **500 G** |
| Settler | **1,500 G** |
| Pioneer | **4,000 G** |
| Citizen | **10,000 G** |
| Veteran | **25,000 G** |
| Elite | **60,000 G** |
| Champion | **150,000 G** |

• List ranks: \`/ranks\` or \`/rank\`
• Reload on server: \`/rootranks reload\` (staff)

## 💳 \`/loan\` — borrow limit matches your rank

Personal loans (**Root-Loans**) no longer use the old **50 G → ×1.1 → 500 G** growth system.

**New rule:** your max borrow = the **price of your highest purchased player rank**. No rank yet → **100 G** default cap.

| Purchased rank | Max borrow |
|--------------|----------:|
| *(none / default)* | **100 G** |
| Wanderer | **500 G** |
| Settler | **1,500 G** |
| Pioneer | **4,000 G** |
| Citizen | **10,000 G** |
| Veteran | **25,000 G** |
| Elite | **60,000 G** |
| Champion | **150,000 G** |

• **Staff & donors:** same rule — only **player-track** ranks count (not mod/admin/donor groups).
• **10% interest** per borrow · **one active loan** · **3 takes / 24h**
• While in debt, incoming gold pays the loan first (\`/loan repay\` for manual paydown)
• Check your limit: \`/loan info\`

Wiki: <https://rootmc.net/wiki/player/#loans> · Taxes & fees: <https://rootmc.net/wiki/economy/#taxes-fees-reference>

_Questions? Ask in <#1545284354157187083>._`;

async function postMessage(body) {
  const res = await fetch(`${API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "RootRecord/rootmc-ranks-loans-update",
    },
    body: JSON.stringify({ content: body.slice(0, 2000) }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Discord ${res.status}: ${err.slice(0, 300)}`);
  }
  return res.json();
}

function splitAtNewline(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf("\n", maxLen);
    if (cut < Math.floor(maxLen * 0.35)) cut = maxLen;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest) chunks.push(rest);
  return chunks;
}

const chunks = splitAtNewline(content, 2000);
let firstId = null;
for (const chunk of chunks) {
  const posted = await postMessage(chunk);
  if (!firstId) firstId = posted.id;
  console.log("posted chunk", posted.id);
}
console.log("done — channel", channelId, "message", firstId);

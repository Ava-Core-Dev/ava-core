/**
 * Post RootMC backend / data-flow reference for admins.
 *
 * Usage (from Web/cloudflare/rootmc-realm-api/):
 *   node scripts/post-rootmc-admin-backend.mjs
 */
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";

const API = "https://discord.com/api/v10";
const GUILD_ID = "1516108585740800042";
const CHANNEL_ID = "1516121832493678612";
const EMBED_SLATE = 0x4a5568;

const env = loadRootMcEnv();
const token = rootMcBotToken(env);

if (token.length < 40) {
  console.error("Need DISCORD_ROOTMC_BOT_TOKEN in credentials.env or Desktop RootMC .env");
  process.exit(1);
}

const EMBEDS = [
  {
    title: "Where things live",
    description:
      "**Game server (Shockbyte)** — Paper + plugins. **Source of truth** for chest stock, in-game `/buy` `/sell`, and live gameplay.\n\n" +
      "**MySQL (separate host)** — Durable game data: player **G balances**, treasury ledger, playtime, shop listing rows (`root_rootstat_shop_listings` + `stock_quantity`), Towny, mcMMO, etc.\n\n" +
      "**api.rootmc.net (Cloudflare Worker + D1)** — Public API, Discord bot, account link, economy **read model** for website/market, AI reports, cron jobs.\n\n" +
      "**rootmc.net (Pages)** — Website reads the API/D1; it does **not** talk to MySQL or the game server directly.",
    color: EMBED_SLATE,
  },
  {
    title: "Economy — what is authoritative?",
    description:
      "| Layer | Role | Real-time in-game? |\n" +
      "|---|---|---|\n" +
      "| Chest + RootMC-Shops | Stock & sales | **Yes** — always live chest scan on trade |\n" +
      "| Root-Essentials MySQL | G balances | **Yes** in-game |\n" +
      "| MySQL shop table | Listing + last known stock | Updated on shop events |\n" +
      "| D1 / website market | Browse, charts, net worth display | **Can lag** — display only |\n\n" +
      "**Rule for admins:** If a player says “web shows X but chest has Y”, trust the **chest** until a sale/sync event runs. Website lag is expected; **duping** is prevented because purchases in-game never use stale D1 data.",
    color: EMBED_SLATE,
  },
  {
    title: "How shop data syncs (2025+ incremental mode)",
    description:
      "**Old (disabled):** every minute, scan **all** shop chests → push huge payload to cloud → main-thread lag / timeouts.\n\n" +
      "**Now (default):**\n" +
      "1. Player buys/sells or edits a shop → plugin scans **that shop only** → updates **MySQL row** + **single-shop D1 POST**.\n" +
      "2. Bulk export uses **cached stock** for display only — **not** for in-game trades.\n" +
      "3. Every **~5 min** (players online): light cloud sync — balances/playtime from MySQL reads + online inventory for net worth; **no** full chest sweep.\n" +
      "4. Optional **Worker cron + Hyperdrive**: MySQL → D1 pull every ~10 min when configured (`mysql-pull-authoritative` on server).\n\n" +
      "Rollback lever on live host: `economy.legacy-bulk-sync: true` in `plugins/RootRecord/rootmc.yml` (avoid unless debugging).",
    color: EMBED_SLATE,
  },
  {
    title: "Cloud API & crons (api.rootmc.net)",
    description:
      "**Worker:** `rootmc-api` on RootMC Cloudflare account, D1 database `rootmc`.\n\n" +
      "**Crons (every 10 min unless noted):** Town/nation Discord channel reconcile, shop price alerts, Discord activity sync, paper token price, optional MySQL economy pull.\n\n" +
      "**Daily ~midnight HST:** Combined AI daily reports → `#daily-summary`.\n\n" +
      "**Weekly Sun 08:00 HST:** Weekly awards + intelligence suite.\n\n" +
      "**Monthly:** Treasury activity dividend cron.\n\n" +
      "**Deploy:** `Web/cloudflare/rootmc-api/deploy.ps1` (not routine worker batch). **Never** redeploy frozen `rootrecord-solana-tx` as part of normal updates.",
    color: EMBED_SLATE,
  },
  {
    title: "Discord bot responsibilities",
    description:
      "**RootMC bot app** — interactions, OAuth link (`/realm/verify`), in-game chat bridge `#ingame-chat`, feedback/reports, town/nation channel automation, economy AI briefs, daily/weekly reports.\n\n" +
      "**Key channels:** `#admins` (this), `#economy-guide`, `#daily-summary`, `#general-chat`, `#ingame-chat`.\n\n" +
      "**MC-linked role** — assigned on successful `/realm/verify`; required to speak in most public channels.\n\n" +
      "Secrets live in Cloudflare (`DISCORD_ROOTMC_BOT_TOKEN`, etc.) — never in git.",
    color: EMBED_SLATE,
  },
  {
    title: "Account link & player stats",
    description:
      "In-game `/link` → short code → **rootmc.net/verify** → D1 `rootstat_minecraft_links`.\n\n" +
      "McMMO + playtime: read from MySQL on server, pushed to cloud on sync interval.\n\n" +
      "Public stats: **rootmc.net/player** — backed by D1, not live server queries.",
    color: EMBED_SLATE,
  },
  {
    title: "Future: web/app shop purchases",
    description:
      "**Not live yet.** When added, checkout **must** be server-authoritative:\n" +
      "web requests purchase → server (or queue consumed by server) does live stock check + chest withdraw + Vault transfer → then MySQL/D1 update.\n\n" +
      "Letting the website deduct stock from D1 alone would risk dupes. Display can be minutes behind; **settlements cannot.**",
    color: EMBED_SLATE,
  },
  {
    title: "Admin ops cheat sheet",
    description:
      "• **Restart server:** `/rootrestart` or `/rrrestart` (not `root restart`)\n" +
      "• **Plugin deploy:** build in MonoRepo → upload jars to Shockbyte `plugins/` → restart\n" +
      "• **API deploy:** you run `deploy.ps1` after Worker changes\n" +
      "• **MySQL:** Shockbyte shared DB — same DB as Towny/mcMMO; prefix `root_`\n" +
      "• **Map:** map.rootmc.net ← BlueMap + R2 (tiles render on server)\n" +
      "• **Timeouts while mining?** Check for economy bulk-sync re-enabled or plugin main-thread scans — not “out of RAM” by default",
    color: EMBED_SLATE,
  },
];

async function sendMessage(body) {
  const res = await fetch(`${API}/channels/${encodeURIComponent(CHANNEL_ID)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord ${res.status}: ${text}`);
  }
  return res.json();
}

const header = await sendMessage({
  content:
    "# fun informative information of backend processes\n" +
    "_Admin reference — how RootMC data moves between Shockbyte, MySQL, Cloudflare, and the website. " +
    "In-game trades are always live; web/market can lag._",
});
console.log("Posted header:", header.id);

const body = await sendMessage({ embeds: EMBEDS });
console.log("Posted embeds:", body.id);
console.log(`https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${body.id}`);

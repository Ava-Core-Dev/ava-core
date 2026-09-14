/** Simulate proposal vote eligibility — node scripts/check-vote-eligibility.mjs [discord_user_id] */
import { loadRootMcEnv } from "./lib/rootmc-env.mjs";

const D1 = "6cf71128-67e3-47b2-a802-d6c23d6489e0";
const discordId = process.argv[2] || "1497037418979786823";

const env = loadRootMcEnv();
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_API_TOKEN;

async function q(sql) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${D1}/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql }),
    },
  );
  const d = await res.json();
  if (!d.success) throw new Error(JSON.stringify(d.errors));
  return d.result?.[0]?.results || [];
}

const joined = await q(
  `SELECT d.discord_user_id, l.minecraft_uuid, l.minecraft_username
   FROM discord_account_links d
   INNER JOIN rootstat_minecraft_links l ON l.account_id = d.account_id
   WHERE d.discord_user_id = '${discordId}' LIMIT 1`,
);
if (!joined.length) {
  console.log("NOT LINKED — no discord+mc join for", discordId);
  process.exit(1);
}
const row = joined[0];
console.log("Linked:", row.minecraft_username, row.minecraft_uuid);

const server = await q(`SELECT server_id FROM rootstat_servers ORDER BY updated_at DESC LIMIT 1`);
const serverId = server[0]?.server_id;
const uuid = String(row.minecraft_uuid).toLowerCase();

const play = await q(
  `SELECT total_playtime_seconds FROM rootstat_player_playtime
   WHERE server_id = '${serverId}' AND minecraft_uuid = '${uuid}' LIMIT 1`,
);
const playSec = Number(play[0]?.total_playtime_seconds) || 0;
console.log("Playtime seconds:", playSec, playSec >= 3600 ? "(eligible)" : "(need ≥3600)");

const bal = await q(
  `SELECT balance_value, inventory_value, net_worth FROM rootstat_player_net_worth
   WHERE server_id = '${serverId}' AND minecraft_uuid = '${uuid}' LIMIT 1`,
);
console.log("Net worth row:", bal[0] || "none");

console.log("\nIf linked + playtime OK, poll buttons should work after API fix deploy.");
console.log("Discord quick test: /balance and /vote in RootMC server.");

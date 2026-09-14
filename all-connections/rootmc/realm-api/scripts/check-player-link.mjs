/** Quick D1 link diagnostic — node scripts/check-player-link.mjs [discord_id] [uuid] */
import { loadRootMcEnv } from "./lib/rootmc-env.mjs";

const D1 = "6cf71128-67e3-47b2-a802-d6c23d6489e0";
const discordId = process.argv[2] || "1497037418979786823";
const uuid = (process.argv[3] || "3e660994-b16c-4714-bc15-9081aa928729").toLowerCase();

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

console.log("Discord:", discordId);
console.log("UUID:", uuid);
console.log("\ndiscord_account_links:");
console.log(await q(`SELECT * FROM discord_account_links WHERE discord_user_id = '${discordId}' LIMIT 5`));
console.log("\nrootstat_minecraft_links:");
console.log(await q(`SELECT * FROM rootstat_minecraft_links WHERE minecraft_uuid = '${uuid}' LIMIT 5`));
console.log("\njoined:");
console.log(
  await q(
    `SELECT d.discord_user_id, d.discord_username, d.account_id, l.minecraft_uuid, l.minecraft_username
     FROM discord_account_links d
     INNER JOIN rootstat_minecraft_links l ON l.account_id = d.account_id
     WHERE d.discord_user_id = '${discordId}' OR l.minecraft_uuid = '${uuid}'`,
  ),
);

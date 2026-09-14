/** Purge Fall (exiled) from discord_message_activity before weekly repost. */
import { loadRootMcEnv } from "./lib/rootmc-env.mjs";

const FALL_ID = "272763043484794900";
const env = loadRootMcEnv();
const token = env.CLOUDFLARE_API_TOKEN;
const account = env.CLOUDFLARE_ACCOUNT_ID || "f3372b30093435bacc35b69972abeb2e";
const db = "6cf71128-67e3-47b2-a802-d6c23d6489e0";

async function exec(sql) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${db}/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql }),
    },
  );
  const data = await res.json();
  if (!data.success) throw new Error(JSON.stringify(data.errors));
  return data.result?.[0];
}

const before = await exec(
  `SELECT COUNT(*) AS n FROM discord_message_activity WHERE discord_user_id = '${FALL_ID}'`,
);
console.log("messages before", before?.results?.[0]?.n);

await exec(`DELETE FROM discord_message_activity WHERE discord_user_id = '${FALL_ID}'`);

const after = await exec(
  `SELECT COUNT(*) AS n FROM discord_message_activity WHERE discord_user_id = '${FALL_ID}'`,
);
console.log("messages after", after?.results?.[0]?.n);
console.log("purged Fall discord activity from D1");

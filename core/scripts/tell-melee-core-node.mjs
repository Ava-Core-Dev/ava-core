import { loadEnv, botToken, DISCORD_API, AVA_CHANNELS } from "../src/config.mjs";
import { authHeaders } from "../src/discordApi.mjs";

const MELEE = "154446475789729792";
const DEVELOPMENT = AVA_CHANNELS.development || "1532929974154166522";
const ADMINS = AVA_CHANNELS.admins;

const env = await loadEnv();
const headers = authHeaders(botToken(env));

const part1 = [
  `<@${MELEE}>`,
  "",
  "**Root-Core-Node** — Alex is building this. full scope below.",
  "**Need your call:** should we open a **proposal** to expand onto **additional database nodes**?",
  "",
  "**What it is today**",
  "Windows tray/UI (`scripts/root-core-node` → `Root-Core-Node.exe`):",
  "• Discord login for operators",
  "• Starts local-edge (API / gateway / preference / presence)",
  "• Local MySQL **:3307** — full Shockbyte replicas",
  "• Replica loop (~15m): Claims + Towny → local schemas",
  "• Local Testing tab — Desktop Paper DEV (start/stop/sync jars / `rootmc_dev`)",
  "• phpMyAdmin + health + logon autostart",
  "Install: `Desktop\\RootMC test server\\Root-Core-Node\\`",
].join("\n");

const part2 = [
  "**Database scope now (single local node)**",
  "• `rootmc_claims` ← Claims Shockbyte (full replica)",
  "• `rootmc_towny` ← Towny Shockbyte (full replica, mcMMO until skills cutover)",
  "• `rootmc_dev` ← local ROOTMC DEV Paper DB",
  "• `rootmc_network` ← local node/network registry",
  "",
  "Sync via `Sync-RemoteMySQLToLocal.ps1` + `Update-MysqlReplicaLoop.ps1` (Node UI).",
  "Does **not** rewrite live `database.yml` / peer configs — read replicas for tooling + DEV.",
  "",
  "**“Additional database nodes” — proposal candidates**",
  "1. More remote sources (Test / future hosts, not just Claims+Towny)",
  "2. Multi-workstation nodes (other staff PCs + their own :3307, registry/auth)",
  "3. Split/HA layout (dedicated DB machine for replicas/backups/phpMyAdmin)",
  "4. Post–root-skills: verify migrator on local replicas before live migrate",
  "5. Guardrails: never write back to live Shockbyte; secrets in `.env`; vote first",
  "",
  "**Ask:** draft a formal vote proposal? Which of 1–4 in v1 scope?",
  "Reply here or Slack `#development`.",
].join("\n");

async function post(channelId, content, mention = true) {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      content: content.slice(0, 2000),
      allowed_mentions: mention ? { users: [MELEE] } : { parse: [] },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${channelId} ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

console.log("len", part1.length, part2.length);
const a = await post(DEVELOPMENT, part1, true);
const b = await post(DEVELOPMENT, part2, false);
console.log("development", a.id, b.id);

const short = `<@${MELEE}> Root-Core-Node full scope + DB-node expansion ask is in <#${DEVELOPMENT}> — need your call on a proposal.`;
const adm = await post(ADMINS, short, true);
console.log("admins", adm.id);

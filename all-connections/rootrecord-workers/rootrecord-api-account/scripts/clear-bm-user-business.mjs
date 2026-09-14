/**
 * Delete Business Manager owned rows for ONE user (D1 bm_owned_row), by email.
 * Does not touch other users. Default collections: categories, projects, quick_actions.
 *
 * Usage (from rootrecord-primary):
 *   node scripts/clear-bm-user-business.mjs rootrecord@outlook.com
 *   node scripts/clear-bm-user-business.mjs rootrecord@outlook.com --all-bm
 *
 * --all-bm: also removes time_entries, active_session, money rows, etc. (everything in bm_owned_row for that user_key)
 */
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const args = process.argv.slice(2).filter((a) => a !== "--all-bm");
const allBm = process.argv.includes("--all-bm");
const email = (args[0] || "").trim().toLowerCase();
if (!email || !email.includes("@") || email.includes("'")) {
  console.error("Usage: node scripts/clear-bm-user-business.mjs <email> [--all-bm]");
  process.exit(1);
}

const userKey = `user:${email}`;
const esc = userKey.replace(/'/g, "''");

const sql = allBm
  ? `DELETE FROM bm_owned_row WHERE user_key = '${esc}';`
  : `DELETE FROM bm_owned_row WHERE user_key = '${esc}' AND coll IN ('categories','projects','quick_actions');`;

console.log(allBm ? "Deleting ALL bm_owned_row for:" : "Deleting categories/projects/quick_actions for:");
console.log(" ", userKey);
console.log();

execSync(`npx wrangler d1 execute root-record --remote --command "${sql}"`, {
  cwd: root,
  stdio: "inherit",
  shell: true,
});

/**
 * Scan D1 `bm_owned_row` (Business Manager) and optionally delete every row for all users.
 * Does not touch auth, billing, earn, or other tables — only `bm_owned_row`.
 *
 * Usage (from rootrecord-primary, requires `wrangler login` / CF credentials):
 *   node scripts/clear-bm-all-users.mjs              # scan only
 *   node scripts/clear-bm-all-users.mjs --execute  # DELETE all bm_owned_row (irreversible)
 */
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function d1(sql) {
  const escaped = sql.replace(/"/g, '\\"');
  execSync(`npx wrangler d1 execute root-record --remote --command "${escaped}"`, {
    cwd: root,
    stdio: "inherit",
    shell: true,
  });
}

const execute = process.argv.includes("--execute");

console.log("Database: root-record (remote)\n");

if (execute) {
  console.log("Before wipe:\n");
  d1("SELECT COUNT(*) AS total_rows FROM bm_owned_row");
  console.log("\nRunning DELETE FROM bm_owned_row;\n");
  d1("DELETE FROM bm_owned_row");
  console.log("\nAfter wipe:\n");
  d1("SELECT COUNT(*) AS total_rows FROM bm_owned_row");
  d1("SELECT COUNT(DISTINCT user_key) AS distinct_users FROM bm_owned_row");
  console.log("\nDone.\n");
  process.exit(0);
}

d1("SELECT COUNT(*) AS total_rows FROM bm_owned_row");
d1("SELECT COUNT(DISTINCT user_key) AS distinct_users FROM bm_owned_row");
d1("SELECT user_key, COUNT(*) AS n FROM bm_owned_row GROUP BY user_key ORDER BY n DESC");
d1("SELECT coll, COUNT(*) AS n FROM bm_owned_row GROUP BY coll ORDER BY n DESC");

console.log("\nScan complete. To delete ALL Business Manager rows for ALL users, run:\n");
console.log("  npm run d1:bm:clear-all\n");
console.log("  node scripts/clear-bm-all-users.mjs --execute\n");

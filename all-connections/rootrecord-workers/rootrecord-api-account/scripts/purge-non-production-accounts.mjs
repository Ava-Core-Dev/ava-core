/**
 * Remove fake / test portal accounts from D1 `root-record` (remote).
 * Keeps only emails boxed in the operator review (May 2026).
 *
 * Usage (from rootrecord-api-account, requires `wrangler login` / CF API token):
 *   node scripts/purge-non-production-accounts.mjs              # dry-run (default)
 *   node scripts/purge-non-production-accounts.mjs --execute    # irreversible deletes
 */
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnvFile(path) {
  const text = readFileSync(path, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (!(k in process.env) || !String(process.env[k]).trim()) process.env[k] = v;
  }
}

function loadCfCredentials() {
  let probe = root;
  for (let i = 0; i < 16; i++) {
    loadEnvFileIf(join(probe, "credentials.env"));
    loadEnvFileIf(join(probe, ".env"));
    const webDir = join(probe, "Web");
    if (existsSync(webDir)) {
      loadEnvFileIf(join(webDir, "credentials.env"));
      loadEnvFileIf(join(webDir, ".env"));
    }
    const parent = dirname(probe);
    if (!parent || parent === probe) break;
    probe = parent;
  }
}

function loadEnvFileIf(path) {
  if (existsSync(path)) loadEnvFile(path);
}

loadCfCredentials();

/** Lowercase emails to retain (boxed review + operator keep list). */
const KEEP_EMAILS = new Set(
  [
    "rootrecord@outlook.com",
    "sarastoreyjobsearch@gmail.com",
    "alexanderstorey94@gmail.com",
    "42thingsbyjo@gmail.com",
    "john.viperorton@gmail.com",
    "zhasulanov.erasyl@mail.ru",
    "gameofniftyofficial@gmail.com",
    "baipinsoft@gmail.com",
    "raju@gmail.com",
    "mert7ziya@gmail.com",
    "tamimtest00@gmail.com",
    "devnewsny@gmail.com",
    "jhonnycastro352@gmail.com",
    "zunzuncrypto@gmail.com",
    "soufiane.eljahid@gmail.com",
    "pjdbussc@gmail.com",
    "dattqgame1701@gmail.com",
    "wildecho94@gmail.com",
    "ellohjohn6@gmail.com",
    "shabeeolamilekan@gmail.com",
    "juliusdynamic018@gmail.com",
    "yupptirex@gmail.com",
    "mayank9835@gmail.com",
    "langvan0605@gmail.com",
    "ivaylozhivkov14@gmail.com",
    "danedred15@gmail.com",
    "berriauj@gmail.com",
    "alexrs_media@gmail.com",
    "charneski@yahoo.com",
    "contact.hotavinh@gmail.com",
    "endurancenuhu56@gmail.com",
    "isuruakalanka071@gmail.com",
    "johnnyhashim@gmail.com",
    "jpbbcool@hotmail.com",
    "luckatoji@gmail.com",
    "marcodidioreno86@gmail.com",
    "ntaylor1690@outlook.com",
    "santox42@gmx.de",
    "timeblimp@gmail.com",
  ].map((e) => e.toLowerCase()),
);

function escSql(s) {
  return String(s).replace(/'/g, "''");
}

function d1Json(sql) {
  const escaped = sql.replace(/"/g, '\\"');
  const out = execSync(
    `npx wrangler d1 execute root-record --remote --json --command "${escaped}"`,
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, shell: true },
  );
  const parsed = JSON.parse(out);
  for (const block of parsed) {
    const rows = block?.results;
    if (!Array.isArray(rows) || !rows.length) continue;
    if (rows[0] && typeof rows[0] === "object" && !("success" in rows[0])) return rows;
  }
  return [];
}

function d1File(filePath) {
  const escapedPath = filePath.replace(/"/g, '\\"');
  execSync(`npx wrangler d1 execute root-record --remote --file "${escapedPath}"`, {
    cwd: root,
    stdio: "inherit",
    shell: true,
  });
}

function deleteStatements(accountId, email) {
  const emailLower = email.trim().toLowerCase();
  const aid = escSql(accountId.trim());
  const e = escSql(emailLower);
  const userId = escSql(`user:${emailLower}`);
  return [
    `DELETE FROM license_sessions WHERE account_id = '${aid}';`,
    `DELETE FROM license_email_change WHERE account_id = '${aid}';`,
    `DELETE FROM license_account_login_aliases WHERE account_id = '${aid}' OR email = '${e}';`,
    `DELETE FROM discord_account_links WHERE account_id = '${aid}';`,
    `DELETE FROM solana_linked_wallets WHERE account_id = '${aid}';`,
    `DELETE FROM internal_solana_wallets WHERE account_id = '${aid}';`,
    `DELETE FROM custodial_wallet_token_slots WHERE account_id = '${aid}';`,
    `DELETE FROM rr_earn_custodial_state WHERE account_id = '${aid}';`,
    `DELETE FROM rr_earn_custodial_ledger WHERE account_id = '${aid}';`,
    `DELETE FROM rr_earn_internal_transfer WHERE from_account_id = '${aid}' OR to_account_id = '${aid}';`,
    `DELETE FROM rr_withdrawal_intent WHERE account_id = '${aid}';`,
    `DELETE FROM volcano_photo_submissions WHERE account_id = '${aid}';`,
    `DELETE FROM rrwm_locations WHERE user_id = '${userId}';`,
    `DELETE FROM rrwm_push_tokens WHERE user_id = '${userId}';`,
    `DELETE FROM weather_data WHERE user_id = '${userId}';`,
    `DELETE FROM rrwm_alert_seen WHERE user_id = '${userId}';`,
    `DELETE FROM rrwm_user_prefs WHERE user_id = '${userId}';`,
    `DELETE FROM rr_earn_balance WHERE user_id = '${userId}';`,
    `DELETE FROM rr_earn_day WHERE user_id = '${userId}';`,
    `DELETE FROM rr_earn_state WHERE user_id = '${userId}';`,
    `DELETE FROM rr_earn_app_day WHERE user_id = '${userId}';`,
    `DELETE FROM rr_earn_app_total WHERE user_id = '${userId}';`,
    `DELETE FROM rr_earn_signup_bonus WHERE user_id = '${userId}';`,
    `DELETE FROM rr_earn_discord_peer_transfer WHERE from_user_id = '${userId}' OR to_user_id = '${userId}';`,
    `DELETE FROM rr_farms_progress WHERE user_id = '${userId}';`,
    `DELETE FROM rr_farms_varmint_events WHERE user_id = '${userId}';`,
    `DELETE FROM bm_owned_row WHERE user_key = '${userId}';`,
    `DELETE FROM me_password_attempt WHERE account_id = '${aid}';`,
    `DELETE FROM user_accounts WHERE email = '${e}';`,
    `DELETE FROM license_accounts WHERE id = '${aid}' AND email = '${e}';`,
  ];
}

const execute = process.argv.includes("--execute");

console.log("Database: root-record (remote)");
console.log(`Mode: ${execute ? "EXECUTE (destructive)" : "dry-run"}\n`);
console.log(`Keep list: ${KEEP_EMAILS.size} emails\n`);

const rows = d1Json("SELECT id, email FROM license_accounts ORDER BY email");
const all = rows.map((r) => ({ id: String(r.id), email: String(r.email).trim().toLowerCase() }));
const keep = all.filter((r) => KEEP_EMAILS.has(r.email));
const purge = all.filter((r) => !KEEP_EMAILS.has(r.email));

console.log(`license_accounts total: ${all.length}`);
console.log(`keeping: ${keep.length}`);
console.log(`purging: ${purge.length}\n`);

if (keep.length) {
  console.log("--- KEEP ---");
  for (const r of keep.sort((a, b) => a.email.localeCompare(b.email))) {
    console.log(`  ${r.email}  ${r.id}`);
  }
  console.log("");
}

if (purge.length) {
  console.log("--- PURGE ---");
  for (const r of purge.sort((a, b) => a.email.localeCompare(b.email))) {
    console.log(`  ${r.email}  ${r.id}`);
  }
  console.log("");
} else {
  console.log("Nothing to purge.\n");
  process.exit(0);
}

if (!execute) {
  console.log("Dry-run only. To delete the accounts above (D1 rows + custodial wallet keys), run:\n");
  console.log("  node scripts/purge-non-production-accounts.mjs --execute\n");
  console.log("  npm run d1:purge:test-accounts:execute\n");
  process.exit(0);
}

const sqlParts = ["-- purge-non-production-accounts.mjs generated", `PRAGMA foreign_keys = OFF;`];
for (const r of purge) {
  sqlParts.push(`-- ${r.email}`);
  sqlParts.push(...deleteStatements(r.id, r.email));
}
sqlParts.push(`PRAGMA foreign_keys = ON;`);

const dir = mkdtempSync(join(tmpdir(), "rr-purge-"));
const file = join(dir, "purge-accounts.sql");
writeFileSync(file, sqlParts.join("\n"), "utf8");

console.log(`Executing ${purge.length} account purge(s) via ${file}\n`);
try {
  d1File(file);
  const after = d1Json("SELECT COUNT(*) AS n FROM license_accounts");
  console.log("\nDone. license_accounts count:", after[0]?.n ?? after);
} finally {
  try {
    unlinkSync(file);
  } catch {
    /* ignore */
  }
}

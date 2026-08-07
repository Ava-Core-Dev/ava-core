/**
 * Personal Telegram urgent digest.
 *   node scripts/urgent-telegram.mjs
 *   node scripts/urgent-telegram.mjs --force
 *   node scripts/urgent-telegram.mjs --dry
 */
import {
  collectUrgentItems,
  buildUrgentTelegramMessage,
  runUrgentTelegramAlert,
} from "../src/urgentTelegram.mjs";

const force = process.argv.includes("--force");
const dry = process.argv.includes("--dry");

if (dry) {
  const items = collectUrgentItems();
  console.log(buildUrgentTelegramMessage(items) || "(empty)");
  console.log("--- count", items.length);
  process.exit(0);
}

const r = await runUrgentTelegramAlert({ force });
console.log(JSON.stringify(r, null, 2));
process.exit(r.sent || r.reason === "nothing_urgent" || r.reason === "unchanged" ? 0 : 1);

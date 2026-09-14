/**
 * Silent local upgrade/restart — POST /api/upgrade on Ava's status server.
 * Usage: node scripts/restart-ava.mjs [reason]
 */
import { AVA_PORT } from "../src/config.mjs";

const reason = process.argv.slice(2).join(" ").trim() || "silent upgrade push";
const url = `http://127.0.0.1:${AVA_PORT}/api/upgrade`;

const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    reason,
    requestedBy: "cli",
    silent: true,
    delayMs: 1500,
  }),
});

const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = { raw: text };
}

if (!res.ok) {
  console.error("restart failed", res.status, body);
  process.exit(1);
}

console.log("silent restart queued", body);
process.exit(0);

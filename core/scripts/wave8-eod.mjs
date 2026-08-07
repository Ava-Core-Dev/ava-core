/**
 * Wave 8 — EOD master status to operator Telegram only.
 */
import { postAvaTelegram } from "../src/avaPost.mjs";
import { listJobs } from "../src/jobQueue.mjs";
import { loadTokenEconomy, tokenBoardText } from "../src/tokenEconomy.mjs";
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "../src/store.mjs";

const TG = "6644482344";

function urgentLines() {
  try {
    const p = path.join(storePaths().dir, "urgent-registry.json");
    const reg = JSON.parse(fs.readFileSync(p, "utf8"));
    return (reg.items || [])
      .filter((i) => i.status === "open")
      .map((i) => `• [${i.priority}] ${i.title}`);
  } catch {
    return ["• (registry unreadable)"];
  }
}

const jobs = listJobs(30);
const openish = jobs.filter((j) =>
  ["pending", "implementing", "staged", "waiting_restart", "blocked"].includes(
    j.status,
  ),
);

loadTokenEconomy();

const text = [
  `Ava EOD — ${new Date().toISOString()}`,
  `(continued after power outage)`,
  ``,
  `SHIPPED TODAY`,
  `• Wave 0: Telegram brief + Slack all-channels ops blast + Discord pointer`,
  `• Manipulation gate live (Alex-only inject)`,
  `• Llama v1 student docs + Root-Ava-Core PROP (forum + #voting)`,
  `• Website ~$100 USD PROP (forum + #voting) — no spend until pass`,
  `• Official parity checklist (do not kick Official)`,
  `• Desktop MVP runnable: Web Files/rootmc-ava-desktop/dist/AvaIvy-0.1.0-win/Ava Ivy.exe`,
  `  (rewrite via :8787/api/rewrite; last 42 msgs; portable nsis blocked by winCodeSign symlink privs)`,
  `• Token/reserve board + soft rate hooks + status page panels`,
  `• Morning boot log check wired + ran`,
  `• Jobs closed: sweater (msb2d5f9), Slack-dev move (ms9qhtmc)`,
  `• Blocked jobs parked: notes/DECISION-blocked-jobs-2026-08-02.md`,
  `• D→E Work Stations sync finished earlier (exit 3 OK); re-sync after outages`,
  ``,
  `WAITING ON YOU`,
  `• Confirm 1.8.0 live (Shockbyte/FileZilla restart)`,
  `• ava.rootmc.net tunnel + Access → :8787`,
  `• Root-Ava-Core jar yes/no after PROP`,
  `• OptiPlex Ubuntu cutover when ready`,
  `• Bond/reserve live ledger check`,
  ``,
  `OPEN URGENCY`,
  ...urgentLines(),
  ``,
  `OPEN/BLOCKED JOBS (${openish.length})`,
  ...openish
    .slice(0, 8)
    .map((j) => `• ${j.id} [${j.status}] ${(j.title || "").slice(0, 60)}`),
  ``,
  `TOKEN BOARD`,
  tokenBoardText(),
  ``,
  `PARKED (not today)`,
  `• Elite skills / mcMMO replace`,
  `• Ban→vote-weight constitution`,
  `• Kick Official before parity green`,
  ``,
  `No Discord/Slack EOD spam. Incremental dumps/urgents stay on schedule.`,
].join("\n");

await postAvaTelegram({
  chatId: TG,
  content: text,
  kind: "wave8_eod",
  source: "wave8-eod",
});
console.log("eod telegram ok");

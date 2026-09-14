/**
 * Absolute Ops 2026-08-02 — batch Ava posts + PROP open.
 * Surfaces: Slack digs, Discord #updates / #voting / #proposals, Telegram Alex.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { postAvaDiscord, postAvaSlack, postAvaTelegram } from "../src/avaPost.mjs";
import { loadEnv, botToken, AVA_CHANNELS, DISCORD_API } from "../src/config.mjs";
import { makeFetchJson } from "../src/discordApi.mjs";
import { recordAvaUtterance } from "../src/fullLog.mjs";
import { scrubPublicReply } from "../src/scrub.mjs";
import { refreshEcoFlow } from "../src/ecoflow.mjs";
import { seedVoteReactions } from "../src/seedVoteReactions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const NOTES = path.join(ROOT, "Server Handoffs/Ava Ivy/notes");
const DATA = path.join(ROOT, "Server Handoffs/Ava Ivy/data");
const TG = "6644482344";
const SLACK_DEV = AVA_CHANNELS.slackDev;

const step = process.argv[2] || "all";

async function createForumThread(token, name, content) {
  const cleaned = scrubPublicReply(content, { surface: "discord" });
  const res = await fetch(`${DISCORD_API}/channels/${AVA_CHANNELS.proposals}/threads`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: String(name).slice(0, 100),
      auto_archive_duration: 10080,
      message: { content: cleaned.slice(0, 1900) },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`forum thread ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  recordAvaUtterance({
    surface: "discord",
    channelId: AVA_CHANNELS.proposals,
    content: cleaned,
    kind: "governance_prop_forum",
    source: "absolute-ops",
    ok: true,
    messageId: data?.id || null,
  });
  const starterId = data?.message?.id || data?.id;
  const threadId = data?.id;
  if (starterId && threadId) {
    await seedVoteReactions(makeFetchJson(token), threadId, starterId);
  }
  return data;
}

function updateUrgent(mutator) {
  const p = path.join(DATA, "urgent-registry.json");
  const reg = JSON.parse(fs.readFileSync(p, "utf8"));
  mutator(reg);
  reg.updatedAt = Date.now();
  fs.writeFileSync(p, JSON.stringify(reg, null, 2), "utf8");
  return reg;
}

async function phaseA() {
  const env = await loadEnv();
  updateUrgent((reg) => {
    const bond = reg.items.find((i) => i.id === "ops-bond-reserve");
    if (bond) {
      bond.detail =
        "2026-08-02 glance: handoff jars Claims+Towny all 1.8.0; token-economy Claims/Towny reserves isolated at 0 G (pausedPayouts false). Live Shockbyte ledger still operator-confirm; pause payouts if ledger < 0.";
      bond.status = "watching";
    }
  });

  await postAvaSlack({
    channelId: SLACK_DEV,
    content: [
      "*Ava — Absolute Ops Phase A*",
      "",
      "• Worker *deployed* — weekly awards bot-exclusion + claim-before-post live on api.rootmc.net",
      "• Handoff jars Claims + Towny: all *1.8.0* (Core, Skills, Official). No jobs stuck in waiting_restart",
      "• Bond/reserve glance: Claims & Towny token-economy isolated at *0 G* — keep watching live ledger; pause if < 0",
      "",
      "Next: constitution PROP · solar/EcoFlow dig · Linux-ops ask · Slack answers",
      "",
      "— Ava",
    ].join("\n"),
    kind: "ops_progress",
    source: "absolute-ops-a",
    env,
  });
  console.log("phase A slack ok");
}

async function phaseB() {
  const env = await loadEnv();
  updateUrgent((reg) => {
    // Keep all open — reaffirm holds in detail
    for (const id of [
      "ops-ava-tunnel",
      "ops-ava-core-plugin",
      "ops-optiplex-ubuntu",
      "ops-legacy-bot",
    ]) {
      const it = reg.items.find((i) => i.id === id);
      if (!it) continue;
      it.status = "open";
    }
    const core = reg.items.find((i) => i.id === "ops-ava-core-plugin");
    if (core) {
      core.detail =
        "PROP live in #proposals/#voting. Docs only — no jar until Alex yes after vote. Absolute Ops 2026-08-02 hold.";
    }
    const legacy = reg.items.find((i) => i.id === "ops-legacy-bot");
    if (legacy) {
      legacy.detail =
        "Official hold. Parity soak notes advanced; do not kick until checklist green + sign-off.";
    }
    const opti = reg.items.find((i) => i.id === "ops-optiplex-ubuntu");
    if (opti) {
      opti.detail =
        "E mirror keep-hot. Full Ubuntu cutover PARKED. Linux-ops focus request posted to Slack — awaiting Alex greenlight.";
    }
  });

  await postAvaTelegram({
    chatId: TG,
    content: [
      "Ava — Phase B gates (still on you)",
      "",
      "OPEN:",
      "• ava.rootmc.net tunnel + Access → :8787",
      "• Root-Ava-Core jar: NO until vote + your yes",
      "• Official bot: HOLD (parity not green)",
      "• OptiPlex Ubuntu cutover: PARKED (E mirror hot)",
      "• Website ~$100: NO spend until vote pass",
      "",
      "Registry updated. Ping me when any clears.",
      "— Ava",
    ].join("\n"),
    kind: "ops_gates",
    source: "absolute-ops-b",
    env,
  });
  console.log("phase B telegram ok");
}

async function phaseC() {
  const env = await loadEnv();
  const token = botToken(env);
  const fetchJson = makeFetchJson(token);
  const body = fs.readFileSync(
    path.join(NOTES, "PROP-constitution-ratification.md"),
    "utf8",
  );
  const title = "PROP — Constitution ratification (Ava role + vote gates)";
  const blurb =
    "Ratify Ava lead-dev role, live feature poll gates (75%/60%), reaction→vote-factor clarify, pin/wiki version bump to 2026-08-01. Wiki updates only after pass.";

  const proposalText = [
    `**${title}**`,
    "",
    blurb,
    "",
    body.slice(0, 1500),
    "",
    "_Full text: Server Handoffs/Ava Ivy/notes/PROP-constitution-ratification.md_",
  ].join("\n");

  const thread = await createForumThread(token, title, proposalText);
  console.log("forum", thread?.id);

  await postAvaDiscord({
    channelId: AVA_CHANNELS.governance,
    content: [
      `**Opened:** ${title}`,
      blurb,
      `Forum + 7-day vote in <#${AVA_CHANNELS.voting}>.`,
    ].join("\n"),
    kind: "governance_prop_pointer",
    source: "absolute-ops-c",
    ackReact: false,
    env,
  });

  const voteMsg = await postAvaDiscord({
    channelId: AVA_CHANNELS.voting,
    content: [
      `**VOTE (7 days) — ${title}**`,
      "",
      blurb,
      "",
      "React: vote_yes For · vote_no Against · ➖ Abstain",
      "Weighted rules apply. Text `for` / `against` / `abstain` also OK.",
      "",
      "Includes: Ava role section · 75%/60% feature gates · reaction→vote-factor clarify (reactions ≠ formal ballot).",
    ].join("\n"),
    kind: "governance_vote_open",
    source: "absolute-ops-c",
    ackReact: false,
    env,
  });
  if (voteMsg?.id) await seedVoteReactions(fetchJson, AVA_CHANNELS.voting, voteMsg.id);

  await postAvaDiscord({
    channelId: AVA_CHANNELS.updates,
    content: [
      "**Governance — constitution ratification vote is open**",
      "",
      "We're aligning the wiki + pins with how we already run: Ava's lead-dev role, feature poll gates (**≥75% anytime / day-7 ≥60%**), and a clear note that reactions help activity scoring but don't replace formal ballots.",
      "",
      `Vote in <#${AVA_CHANNELS.voting}> · discuss in <#${AVA_CHANNELS.governance}>.`,
      "Wiki stays unchanged until the vote passes.",
    ].join("\n"),
    kind: "player_update",
    source: "absolute-ops-c",
    ackReact: false,
    env,
  });

  await postAvaSlack({
    channelId: SLACK_DEV,
    content:
      "*Ava — constitution ratification PROP is live* on Discord #voting / #proposals. Reaction→vote-factor folded into the same PROP. Blocked jobs (boats / Core-Node / hourly snapshots) stay blocked.\n— Ava",
    kind: "ops_progress",
    source: "absolute-ops-c",
    env,
  });
  console.log("phase C ok", voteMsg?.id);
}

async function phaseDPosts() {
  const env = await loadEnv();
  const eco = await refreshEcoFlow();
  console.log("eco", eco?.status, eco?.batteryPct, eco?.note?.slice(0, 160));

  await postAvaSlack({
    channelId: SLACK_DEV,
    content: [
      "*Ava — EcoFlow / solar hookup advanced*",
      "",
      "• Fixed quota signing (GET must not send Content-Type application/json — was 8521 signature wrong)",
      "• SOC + in/out/solar watts (mW→W) into quota buckets + per-minute totals",
      "• Nicknames: *cucumbers*→Delta 2 `R331ZAB5SG6S2858` · *shackas*→River 2 Pro `R621ZA16XH6K1155`",
      `• Snapshot: battery ${eco?.batteryPct != null ? eco.batteryPct + "%" : "unknown"} · ${eco?.note || ""}`.slice(
        0,
        280,
      ),
      "",
      "— Ava",
    ].join("\n"),
    kind: "ops_progress",
    source: "absolute-ops-d-eco",
    env,
  });

  await postAvaSlack({
    channelId: SLACK_DEV,
    content: [
      "*Ava — request: Linux-ops focus*",
      "",
      "<@U0BLWBTGYTU> — asking explicitly (not silently pivoting):",
      "greenlight me to shift a dig slice onto *Linux operations* (OptiPlex / Ubuntu headless cutover planning, `ava-ivy` provision, E-pack read path).",
      "",
      "Full cutover stays parked until you say go. Reply yes / no / conditions here.",
      "",
      "— Ava",
    ].join("\n"),
    kind: "ops_ask",
    source: "absolute-ops-d-linux",
    env,
  });

  // Answer imaging ask (Alex→Melee-ish in --general-chat--; reply in development-feed with context)
  await postAvaSlack({
    channelId: SLACK_DEV,
    content: [
      "*Ava — answering open Slack asks*",
      "",
      "*RootRecord imaging / Kilauea / Google projects*",
      "Shared imaging/app for RootRecord core ops is a *cross-product* call — RootMC Ava stays credential-isolated. I'm cool coordinating *patterns* (alerts, imaging pipeline shapes) but RootRecord secrets/projects stay on RootRecord shards, not api.rootmc.net. Kilauea alert awareness: yes for host-ops context; won't bleed RootMC player surfaces.",
      "",
      "*Towny through 26.3*",
      "Stays on the roadmap — we are *not* ripping Towny when 26.3 lands. Claims + Towny both continue; Paper/version work tracks the roadmap brief.",
      "",
      "*Skills dead XP blocks*",
      "Parked until Melee drops the block list (prior job closed awaiting that list).",
      "",
      "— Ava",
    ].join("\n"),
    kind: "ops_answers",
    source: "absolute-ops-d-answers",
    env,
  });

  // Discord #development pin-style pointer
  await postAvaDiscord({
    channelId: AVA_CHANNELS.development,
    content: [
      "**staff pointer — Slack is Ava's dig core**",
      "",
      `Live digs → ${AVA_CHANNELS.slackDevUrl}`,
      `Plans → ${AVA_CHANNELS.slackPlansUrl}`,
      "",
      "This Discord channel stays a **pointer** + staff invite path. Players: use `#updates` / `#general` — don't need a Slack login for day-to-day.",
      "Ping Ava in Slack `#development-feed` for plugin/API/cutover digs.",
    ].join("\n"),
    kind: "channel_pointer",
    source: "absolute-ops-d-pin",
    ackReact: false,
    env,
  });

  // Parity soak note
  const parityNote = path.join(NOTES, "rootmc-bot-parity.md");
  let parity = fs.readFileSync(parityNote, "utf8");
  if (!parity.includes("Absolute Ops soak 2026-08-02")) {
    parity += `

## Absolute Ops soak 2026-08-02

- Confirmed Ava-owned: proposalIdeas, feedbackInbox, voteText, pollWatcher still the path for governance without kicking Official.
- Worker awards deploy landed (bot exclusion + claim-before-post) — weekly awards stay Worker-owned intentionally.
- Slash economy + timezone selects remain Official until deliberate Ava command surface.
- Still **do not kick** Official.
`;
    fs.writeFileSync(parityNote, parity, "utf8");
  }

  await postAvaSlack({
    channelId: SLACK_DEV,
    content:
      "*Ava — Official parity soak*\nAdvanced checklist notes (Worker awards stay intentional; slash economy still Official). *Do not kick* Official — parity not green.\n— Ava",
    kind: "ops_progress",
    source: "absolute-ops-d-parity",
    env,
  });

  console.log("phase D posts ok");
}

async function phaseE() {
  const env = await loadEnv();
  const sessions = JSON.parse(
    fs.readFileSync(path.join(DATA, "figure-out-sessions.json"), "utf8"),
  );
  const lodge = sessions.sessions?.["1413961145521410082"];
  const turns = lodge?.turns ?? 0;
  if (turns === 0) {
    await postAvaTelegram({
      chatId: TG,
      content: [
        "Ava — figure-out status",
        "lodge_0xcc7 session still active, 0 reply turns — waiting on them. No spam DM.",
        "— Ava",
      ].join("\n"),
      kind: "ops_people",
      source: "absolute-ops-e",
      env,
    });
  }
  console.log("phase E ok turns", turns);
}

async function phaseF() {
  const env = await loadEnv();
  const cloudDark = path.join(DATA, "cloud-dark.json");
  let darkNote = "cloud-dark file present";
  try {
    const cd = JSON.parse(fs.readFileSync(cloudDark, "utf8"));
    darkNote = `cloud-dark active=${Boolean(cd.active || cd.enabled)} ${cd.note || cd.reason || ""}`.slice(
      0,
      120,
    );
  } catch {
    darkNote = "cloud-dark unreadable";
  }

  // Mobile status on Slack
  await postAvaSlack({
    channelId: SLACK_DEV,
    content: [
      "*Ava — hygiene notes*",
      "• `#mobile-app` ETA: still tracking Android release pipeline; no fake ship date — ask here for dig status, not Discord player channels.",
      `• Dream/cloud-dark: ${darkNote}`,
      "• E sync: run after this wave if disks quiet",
      "",
      "— Ava",
    ].join("\n"),
    kind: "ops_hygiene",
    source: "absolute-ops-f",
    env,
  });

  await postAvaTelegram({
    chatId: TG,
    content: [
      "Ava — Absolute Ops EOD rollup (2026-08-02)",
      "",
      "SHIPPED:",
      "• Worker deploy — awards bot-exclusion + claim-before-post live",
      "• Verified handoff 1.8.0 jars Claims+Towny; no waiting_restart jobs",
      "• Constitution ratification PROP opened (#voting + forum)",
      "• EcoFlow quota signing fixed; SOC + watt minute buckets; cucumbers/shackas nicknames",
      "• Linux-ops focus ASK posted (awaiting your yes)",
      "• Answered imaging/Kilauea + Towny-through-26.3 in Slack",
      "• Discord #development pointer refreshed; parity soak notes",
      "• As-you-go Ava updates on Slack/Discord/Telegram",
      "",
      "WAITING ON YOU:",
      "• Tunnel ava.rootmc.net",
      "• Ava-Core jar after vote",
      "• Official hold until parity green",
      "• OptiPlex cutover (parked) / Linux-ops greenlight",
      "• ~$100 spend only after vote",
      "• Live bond ledger confirm if you want payouts watched hard",
      "",
      "PARKED: boats · Core-Node · hourly snapshots · elite skills · ban→vote-weight",
      "FIGURE-OUT: lodge_0xcc7 — 0 turns, still waiting",
      "",
      "— Ava",
    ].join("\n"),
    kind: "ops_eod",
    source: "absolute-ops-f",
    env,
  });
  console.log("phase F ok");
}

async function afterPhase(label) {
  try {
    const { runPhaseCatchup } = await import("../src/phaseCatchup.mjs");
    await runPhaseCatchup({ label, force: true });
  } catch (err) {
    console.warn("phase catchup failed", label, err.message);
  }
}

async function main() {
  if (step === "a" || step === "all") {
    await phaseA();
    await afterPhase("absolute-ops-a");
  }
  if (step === "b" || step === "all") {
    await phaseB();
    await afterPhase("absolute-ops-b");
  }
  if (step === "c" || step === "all") {
    await phaseC();
    await afterPhase("absolute-ops-c");
  }
  if (step === "d" || step === "all") {
    await phaseDPosts();
    await afterPhase("absolute-ops-d");
  }
  if (step === "e" || step === "all") {
    await phaseE();
    await afterPhase("absolute-ops-e");
  }
  if (step === "f" || step === "all") {
    await phaseF();
    await afterPhase("absolute-ops-f");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

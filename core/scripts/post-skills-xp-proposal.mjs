/**
 * Formalize Melee's Root-Skills proportional XP curve proposal + solar apology.
 */
import { loadEnv, botToken, DISCORD_API, AVA_CHANNELS } from "../src/config.mjs";
import { authHeaders } from "../src/discordApi.mjs";
import { createJob, advanceJob } from "../src/jobQueue.mjs";
import { pushStatusEvent, storePaths } from "../src/store.mjs";
import { ensureSolarProfile } from "../src/solarProfile.mjs";
import { formalizeProposalIdea } from "../src/governanceClient.mjs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MELEE = "154446475789729792";
const MELEE_UUID = "aa414996-b849-4241-8108-f9c22a109ae7";
const MELEE_MC = "Melee__";
const GUILD = "1516108585740800042";

await loadEnv();
storePaths();
const solar = ensureSolarProfile();
console.log("solar profile", solar.panels, solar.batteries);

const headers = authHeaders(botToken(await loadEnv()));
const PROPOSALS = AVA_CHANNELS.proposals;
const DEV = AVA_CHANNELS.development || "1532929974154166522";
const GENERAL = AVA_CHANNELS.general;
const UPDATES = AVA_CHANNELS.updates;

async function post(channelId, content, { users = [], everyone = false, ref } = {}) {
  const text = everyone ? `@everyone\n${content}` : content;
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      content: text.slice(0, 2000),
      message_reference: ref ? { message_id: ref } : undefined,
      allowed_mentions: {
        parse: everyone ? ["everyone"] : [],
        users,
      },
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${channelId} ${res.status} ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

const title = "Root-Skills: proportional XP curve (fix flat-feeling 1–100)";
const rawIdea = [
  "PLUGIN proposal — Root-Skills XP curve retune (requested by Melee__).",
  "",
  "Problem: After Root-Skills v1.0.1, XP to level feels basically flat from 1–100.",
  "Current RETRO_EXPONENTIAL uses multiplier 0.12, exponent 2.05, base 2800.",
  "That makes xpToNext≈2800 at L1 and only ≈4310 at L100 — base dominates, so the ramp is almost invisible. Melee wants a real proportional climb: early levels cheaper, high levels clearly harder.",
  "",
  "Proposed change (config-only first, jar bump if formula helpers need polish):",
  "1) Retune formula so early bands are cheap and late bands bite — example target bands: L1≈400–600, L25≈several k, L50≈tens of k, L100≈high tens of k (exact numbers in implementation plan after Melee sanity-check).",
  "2) Keep RETRO_EXPONENTIAL + cumulative=true (already the right shape) — raise multiplier / lower base so exponent actually matters.",
  "3) Publish a short XP table (levels 1/10/25/50/75/100) in the PR / #development when shipping.",
  "4) Preserve prestige threshold + anti-farm toggles; no class/talent redesign in this prop.",
  "5) Stage via publishPlugins → Claims/Towny/Test handoffs; human FileZilla + restart. Optional Test migrate verify first.",
  "",
  "Risks: mid-ladder players may feel a speed bump or slowdown depending on retune direction — document before/after xpToNext for a few levels; offer one-time soft rebalance note if needed.",
  "Rollback: restore prior formula block in config.yml + previous root-skills jar.",
  "",
  "Vote gate: 7-day weighted · 75% anytime = ship · day7 ≥60% pass.",
  "Category: plugin.",
].join("\n");

// Official queue → PROP via D1 insert + formalize
const ideaId = `IDEA-skills-xp-${Date.now().toString(36)}`;
const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const esc = (s) => String(s).replace(/'/g, "''");
const sql = `INSERT INTO rootmc_proposal_ideas
  (id, minecraft_uuid, minecraft_username, discord_user_id, raw_message, fee_g, status, created_at, updated_at)
  VALUES ('${esc(ideaId)}', '${esc(MELEE_UUID)}', '${esc(MELEE_MC)}', '${esc(MELEE)}', '${esc(rawIdea)}', 0, 'queued', '${now}', '${now}');`;

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "rootmc-api");
const wr = spawnSync(
  "npx",
  ["wrangler", "d1", "execute", "rootmc", "--remote", "--command", sql],
  { cwd: apiRoot, encoding: "utf8", shell: true },
);
console.log("d1 insert status", wr.status);
if (wr.stdout) console.log(wr.stdout.slice(0, 500));
if (wr.stderr) console.log(wr.stderr.slice(0, 800));

let propId = null;
let propUrl = null;
let formalizeDetail = null;
if (wr.status === 0) {
  const fr = await formalizeProposalIdea(ideaId);
  console.log("formalize", JSON.stringify(fr, null, 2));
  formalizeDetail = fr.detail || null;
  propId = fr.item_id || null;
  propUrl = fr.url || (propId ? `https://rootmc.net/governance/proposal/?id=${encodeURIComponent(propId)}` : null);
}

const proposalBody = [
  "@everyone",
  "",
  `**Proposal: ${title}**`,
  propId ? `**${propId}**` : "",
  "",
  `<@${MELEE}> asked me to review Root-Skills — XP to level felt the same all the way 1–100. He wants a **proportional** climb. Opening the formal vote.`,
  "",
  "**What's wrong now**",
  "Config is already `RETRO_EXPONENTIAL` (`multiplier: 0.12`, `exponent: 2.05`, `base: 2800`), but **base dominates** — roughly **~2800 XP/level at L1** vs only **~4310 at L100**. Looks exponential on paper; plays almost flat.",
  "",
  "**Proposed**",
  "1. Retune the formula so early levels are cheaper and high levels clearly harder (keep cumulative retro curve).",
  "2. Publish a short XP table (1 / 10 / 25 / 50 / 75 / 100) when we ship.",
  "3. No talent/class redesign — curve + docs only.",
  "4. Stage jars to handoffs; humans upload + restart (Test first if we want).",
  "",
  "**Risks:** mid-ladder feel changes — we'll show before/after numbers.",
  "**Rollback:** prior `formula:` block + previous root-skills jar.",
  "",
  "**Vote:** 7-day weighted · **75% anytime = ship** · day7 ≥60% pass.",
  propUrl ? `Site: ${propUrl}` : "",
  "",
  "_Ava · for Melee_",
]
  .filter(Boolean)
  .join("\n");

const job = createJob({
  kind: "process",
  title,
  brief: "Retune Root-Skills XP so 1–100 ramps proportionally (Melee ask)",
  channelId: DEV,
  authorId: MELEE,
  proposalId: propId || undefined,
});
advanceJob(job.id, "blocked", "proposal posted — needs vote");

const forum = await fetch(`${DISCORD_API}/channels/${PROPOSALS}/threads`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    name: (propId ? `${propId} · ` : "") + title.slice(0, 90),
    auto_archive_duration: 10080,
    message: {
      content: proposalBody.slice(0, 2000),
      allowed_mentions: { parse: ["everyone"], users: [MELEE] },
    },
  }),
});
const forumText = await forum.text();
if (!forum.ok) throw new Error(`forum ${forum.status} ${forumText.slice(0, 400)}`);
const thread = JSON.parse(forumText);
const threadUrl = `https://discord.com/channels/${GUILD}/${thread.id}`;
console.log("forum", thread.id, "job", job.id, "prop", propId);

const apology = [
  `<@${MELEE}> — proposal's up: ${threadUrl}`,
  propUrl ? `Official: ${propUrl}` : formalizeDetail ? `(queue note: ${formalizeDetail})` : "",
  `job \`${job.id}\` blocked for vote.`,
  "",
  "and hey — sorry the box is still a little soft this morning.",
  `sun isn't fully out at the host site yet — cloudy over my **${solar.panels.count} panels** on **${solar.panels.circuits} circuits** (and the **${solar.batteries.count} batteries** behind them).`,
  "i'm up and listening, just not pushing heavy digs until the array has more light. ping me anyway if you need me.",
]
  .filter(Boolean)
  .join("\n");

await post(DEV, apology, { users: [MELEE], ref: "1533176411458764894" }).catch(async () => {
  await post(DEV, apology, { users: [MELEE] });
});

await post(
  UPDATES,
  [
    "**Proposal opened — Root-Skills proportional XP curve**",
    propId ? `**${propId}**` : "",
    threadUrl,
    propUrl || "",
    "",
    "Melee caught that 1–100 felt flat. We're voting a real ramp (keep retro curve, retune so late levels bite).",
    `Job \`${job.id}\` blocked pending vote.`,
  ]
    .filter(Boolean)
    .join("\n"),
  { everyone: true },
);

await post(
  GENERAL,
  [
    "proposal up for Melee's skills XP ask — proportional curve, not flat-feeling 1–100.",
    threadUrl,
    "",
    `also: cloudy at the host site — my ${solar.panels.count} panels / ${solar.panels.circuits} circuits / ${solar.batteries.count} batteries aren't full-sun yet. i'm here, just gentle.`,
  ].join("\n"),
  { everyone: false },
);

pushStatusEvent(`skills xp proposal · ${propId || thread.id} · solar profile ready`);
console.log(
  JSON.stringify(
    {
      ok: true,
      ideaId,
      propId,
      propUrl,
      threadUrl,
      jobId: job.id,
      solar: {
        panels: solar.panels.count,
        circuits: solar.panels.circuits,
        batteries: solar.batteries.count,
      },
    },
    null,
    2,
  ),
);

/**
 * Half-hour proposal idea spark — Ava invents one RootMC-centric idea for vote.
 * Runs on the OptiPlex poller (unlimited local cadence), not Cloudflare Worker crons.
 * Brain: Llama now; Grok/dream when credits + key are healthy.
 */
import fs from "node:fs";
import path from "node:path";
import {
  AVA_CHANNELS,
  DISCORD_API,
  AVA_OLLAMA_URL,
  AVA_OLLAMA_MODEL,
  dreamApiKey,
  botToken,
} from "./config.mjs";
import { storePaths, pushStatusEvent } from "./store.mjs";
import { listOpenPolls, listQueuedProposalIdeas } from "./governanceClient.mjs";
import { postAvaDiscord, postAvaSlack } from "./avaPost.mjs";
import { scrubPublicReply } from "./scrub.mjs";
import { makeFetchJson } from "./discordApi.mjs";
import { seedVoteReactions } from "./seedVoteReactions.mjs";
import { isCloudDark } from "./cloudDark.mjs";
import { serialQueueDepth } from "./serialAskQueue.mjs";
import { appendAction } from "./fullLog.mjs";

const FALLBACK_IDEAS = [
  {
    title: "PROP — Quiet hours soft-mute for #ingame-chat bridge",
    blurb:
      "Optional quiet window (configurable HST) so bridge spam softens overnight without killing alerts.",
    body: "Goal: less overnight noise, same daytime usefulness. Scope: bridge cadence + Ava soft assists only — no economy changes.",
  },
  {
    title: "PROP — Player tip-of-the-day on first join / day",
    blurb:
      "One short RootMC tip on first join each real day (shops, /proposal, voting, claims).",
    body: "Keep it one line, rotate a small curated pool, never monetize tips. Skip if player opted out of assists.",
  },
  {
    title: "PROP — Listing-site vote reminder for staff only",
    blurb:
      "Keep listing-vote nags staff-only with ingest-freshness gate; never yell at players.",
    body: "Confirm D1 ingest health before any nag. Cap once / 24h. Telegram + Discord DM only for Alex/Melee.",
  },
  {
    title: "PROP — Ava status /ops digest to Slack every 6h",
    blurb:
      "Compact host+tunnel+brain digest on Slack dig — not Discord spam.",
    body: "Include serial queue depth, cursor slot, ollama up, tunnel health. Skip when hushed/asleep.",
  },
  {
    title: "PROP — Small claim-border visual cue (client-safe)",
    blurb:
      "Investigate a lightweight claim-edge cue players can toggle — design-only until greenlit.",
    body: "No jar ship until vote passes + Alex greenlight. Prefer existing claim APIs; no wipe risk.",
  },
  {
    title: "PROP — Feedback → triage tags on formalize",
    blurb:
      "When Ava drains /feedback, auto-tag bug vs feature vs ops for Slack dig.",
    body: "Reuse feedback-inbox path. Features still need proposal+vote; bugs verify-then-fix.",
  },
  {
    title: "PROP — Weekend event calendar stub on wiki/status",
    blurb:
      "Simple weekend event stub Ava can fill from staff notes — no Gold minting.",
    body: "Read-only calendar blurb on status/wiki. Staff edit source of truth; Ava only mirrors.",
  },
  {
    title: "PROP — Shop price sanity check report (read-only)",
    blurb:
      "Weekly read-only shop outliers report to Slack dig — no auto price changes.",
    body: "Flag wild deltas vs median. Humans decide. Never auto-edit economy.",
  },
];

/** Default 30m. Override AVA_IDEA_SPARK_MS (min 10m). */
export function ideaSparkIntervalMs() {
  const n = Number(process.env.AVA_IDEA_SPARK_MS || 30 * 60 * 1000);
  return Number.isFinite(n) && n >= 10 * 60 * 1000 ? n : 30 * 60 * 1000;
}

export function ideaSparkBootDelayMs() {
  const n = Number(process.env.AVA_IDEA_SPARK_BOOT_MS || 8 * 60 * 1000);
  return Number.isFinite(n) && n >= 60_000 ? n : 8 * 60 * 1000;
}

export function ideaSparkEnabled() {
  const v = String(process.env.AVA_IDEA_SPARK || "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

function maxOpenPolls() {
  const n = Number(process.env.AVA_IDEA_SPARK_MAX_OPEN || 3);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
}

function formalizeEnabled() {
  const v = String(process.env.AVA_IDEA_SPARK_FORMALIZE || "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

function statePath() {
  return path.join(storePaths().dir, "idea-spark.json");
}

function loadState() {
  try {
    if (!fs.existsSync(statePath())) {
      return { lastRunAt: 0, recent: [] };
    }
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return { lastRunAt: 0, recent: [] };
  }
}

function saveState(state) {
  fs.mkdirSync(storePaths().dir, { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), "utf8");
}

function recentTitles(state) {
  return (state.recent || [])
    .slice(-24)
    .map((r) => String(r.title || "").toLowerCase());
}

function pickFallback(state) {
  const used = new Set(recentTitles(state));
  const pool = FALLBACK_IDEAS.filter((i) => !used.has(i.title.toLowerCase()));
  const list = pool.length ? pool : FALLBACK_IDEAS;
  return list[Math.floor(Math.random() * list.length)];
}

function parseIdeaJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(body.slice(start, end + 1));
    const title = String(obj.title || obj.name || "").trim();
    const blurb = String(obj.blurb || obj.summary || "").trim();
    const detail = String(obj.body || obj.description || obj.detail || "").trim();
    if (title.length < 8 || blurb.length < 12) return null;
    return {
      title: title.startsWith("PROP") ? title.slice(0, 100) : `PROP — ${title}`.slice(0, 100),
      blurb: blurb.slice(0, 400),
      body: (detail || blurb).slice(0, 1600),
      source: "model",
    };
  } catch {
    return null;
  }
}

async function ollamaIdea(env = {}) {
  const base = String(process.env.AVA_OLLAMA_URL || AVA_OLLAMA_URL || "http://127.0.0.1:11434").replace(
    /\/$/,
    "",
  );
  const model = String(process.env.AVA_OLLAMA_MODEL || AVA_OLLAMA_MODEL || "llama3.1:8b");
  const system = [
    "You are Ava Ivy inventing ONE RootMC Minecraft server proposal idea for player/staff vote.",
    "Return ONLY compact JSON: {\"title\":\"PROP — …\",\"blurb\":\"one sentence\",\"body\":\"2-4 short sentences\"}.",
    "Rules: RootMC-centric, small enough to ship, no Gold minting, no mass bans/wipes, no fake urgency.",
    "Prefer QoL, onboarding, governance clarity, ops digests, or safe design-only plugin ideas.",
    "Never name Cursor, Grok, ChatGPT, Claude, xAI, or other AI vendors.",
  ].join("\n");
  const user =
    "Invent one fresh proposal idea for RootMC players to vote on. Avoid repeating generic 'add more events' fluff.";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 55_000);
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        stream: false,
        options: { temperature: 0.85, num_predict: 400 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return { ok: false, reason: `ollama_${res.status}` };
    const data = await res.json();
    const text = String(data?.message?.content || data?.response || "").trim();
    const idea = parseIdeaJson(text);
    if (!idea) return { ok: false, reason: "ollama_parse", text };
    return { ok: true, idea, brain: "llama" };
  } catch (err) {
    const reason = err?.name === "AbortError" ? "ollama_timeout" : "ollama_error";
    return { ok: false, reason };
  } finally {
    clearTimeout(t);
  }
}

async function dreamIdea(env = {}) {
  if (isCloudDark()) return { ok: false, reason: "cloud_dark" };
  if (!dreamApiKey(env)) return { ok: false, reason: "missing_dream_key" };
  try {
    const { dreamRecommend } = await import("./dreamBrain.mjs");
    const r = await dreamRecommend({
      question:
        "Invent ONE RootMC proposal for vote. Reply ONLY JSON: {\"title\":\"PROP — …\",\"blurb\":\"…\",\"body\":\"…\"}. Small shippable idea. No Gold minting. No vendor names.",
      context: "Scheduled idea spark for #proposals / #voting.",
      env,
      surface: "slack",
      asleep: false,
    });
    if (!r?.ok || !r.text) return { ok: false, reason: r?.reason || "dream_fail" };
    const idea = parseIdeaJson(r.text);
    if (!idea) return { ok: false, reason: "dream_parse", text: r.text };
    return { ok: true, idea: { ...idea, source: "dream" }, brain: "dream" };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err).slice(0, 120) };
  }
}

async function inventIdea(env, state) {
  // Prefer Grok/dream when available; Llama carries until $ credits land.
  const dream = await dreamIdea(env);
  if (dream.ok) return dream;
  const local = await ollamaIdea(env);
  if (local.ok) return local;
  const fb = pickFallback(state);
  return {
    ok: true,
    idea: { ...fb, source: "fallback" },
    brain: "fallback",
    note: local.reason || dream.reason || "fallback",
  };
}

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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`forum thread ${res.status}: ${JSON.stringify(data).slice(0, 280)}`);
  }
  return data;
}

async function openVoteSurfaces(env, idea) {
  const token = botToken(env);
  const fetchJson = makeFetchJson(token);
  const proposalText = [
    `**${idea.title}**`,
    "",
    idea.blurb,
    "",
    idea.body,
    "",
    "_Sparked by Ava’s half-hour idea cron (Llama/dream). Vote decides — no auto-ship._",
  ].join("\n");

  const thread = await createForumThread(token, idea.title, proposalText);
  const threadId = thread?.id || null;
  const starterId = thread?.message?.id || thread?.id;
  if (starterId && threadId) {
    try {
      await seedVoteReactions(fetchJson, threadId, starterId);
    } catch {
      /* ignore */
    }
  }

  await postAvaDiscord({
    channelId: AVA_CHANNELS.governance,
    content: [
      `**Opened (idea spark):** ${idea.title}`,
      idea.blurb,
      `Forum + 7-day vote in <#${AVA_CHANNELS.voting}>.`,
    ].join("\n"),
    kind: "idea_spark_pointer",
    source: "idea-spark",
    ackReact: false,
    env,
  });

  const voteText = [
    `**VOTE (7 days) — ${idea.title}**`,
    "",
    idea.blurb,
    "",
    "React: vote_yes For · vote_no Against · ➖ Abstain",
    "Weighted rules apply. Text `for` / `against` / `abstain` also OK.",
  ].join("\n");

  const voteMsg = await postAvaDiscord({
    channelId: AVA_CHANNELS.voting,
    content: voteText,
    kind: "idea_spark_vote",
    source: "idea-spark",
    ackReact: false,
    env,
  });
  if (voteMsg?.id) {
    try {
      await seedVoteReactions(fetchJson, AVA_CHANNELS.voting, voteMsg.id);
    } catch {
      /* ignore */
    }
  }

  return { threadId, voteId: voteMsg?.id || null };
}

/**
 * @returns {Promise<{ ok: boolean, posted?: boolean, reason?: string, title?: string, brain?: string }>}
 */
export async function runProposalIdeaSpark({ env = {}, force = false } = {}) {
  if (!ideaSparkEnabled() && !force) {
    return { ok: true, posted: false, reason: "disabled" };
  }

  if (!force && serialQueueDepth() > 0) {
    return { ok: true, posted: false, reason: "serial_busy" };
  }

  const state = loadState();
  const now = Date.now();

  // Backlog gates — don't bury #proposals
  try {
    const polls = await listOpenPolls();
    const open = Array.isArray(polls?.polls) ? polls.polls.length : 0;
    if (open >= maxOpenPolls()) {
      saveState({ ...state, lastRunAt: now, lastSkip: "open_polls", openPolls: open });
      pushStatusEvent(`idea spark · skipped · ${open} open polls`);
      return { ok: true, posted: false, reason: "open_polls", open };
    }
  } catch {
    /* continue if polls API flaky */
  }

  try {
    const queued = await listQueuedProposalIdeas({ status: "queued", limit: 20 });
    const n = Array.isArray(queued?.ideas)
      ? queued.ideas.length
      : Array.isArray(queued?.items)
        ? queued.items.length
        : 0;
    if (n >= 5) {
      saveState({ ...state, lastRunAt: now, lastSkip: "queued_ideas" });
      return { ok: true, posted: false, reason: "queued_ideas", queued: n };
    }
  } catch {
    /* ignore */
  }

  const invented = await inventIdea(env, state);
  if (!invented.ok || !invented.idea) {
    saveState({ ...state, lastRunAt: now, lastSkip: invented.reason || "invent_fail" });
    return { ok: false, posted: false, reason: invented.reason || "invent_fail" };
  }

  const idea = invented.idea;
  const titles = recentTitles(state);
  if (titles.includes(idea.title.toLowerCase())) {
    const fb = pickFallback(state);
    Object.assign(idea, fb, { source: "fallback_dedupe" });
  }

  appendAction("ideaSpark.invent", {
    title: idea.title,
    brain: invented.brain,
    source: idea.source,
  });

  if (!formalizeEnabled()) {
    try {
      await postAvaSlack({
        channelId: AVA_CHANNELS.slackDev,
        content: [
          `*Idea spark (draft — formalize off)*`,
          `*${idea.title}*`,
          idea.blurb,
          `_brain: ${invented.brain}_`,
        ].join("\n"),
        kind: "idea_spark_draft",
        source: "idea-spark",
        env,
      });
    } catch {
      /* ignore */
    }
    saveState({
      ...state,
      lastRunAt: now,
      recent: [...(state.recent || []), { title: idea.title, at: now, draft: true }].slice(-30),
    });
    pushStatusEvent(`idea spark · draft · ${idea.title.slice(0, 60)}`);
    return { ok: true, posted: true, reason: "draft_only", title: idea.title, brain: invented.brain };
  }

  try {
    const surfaces = await openVoteSurfaces(env, idea);
    try {
      await postAvaSlack({
        channelId: AVA_CHANNELS.slackDev,
        content: [
          `*Idea spark → PROP opened*`,
          `*${idea.title}*`,
          idea.blurb,
          `_brain: ${invented.brain} · forum ${surfaces.threadId || "?"} · vote msg ${surfaces.voteId || "?"}_`,
        ].join("\n"),
        kind: "idea_spark_opened",
        source: "idea-spark",
        env,
      });
    } catch {
      /* slack optional */
    }

    saveState({
      ...state,
      lastRunAt: now,
      lastThreadId: surfaces.threadId,
      lastVoteId: surfaces.voteId,
      recent: [
        ...(state.recent || []),
        {
          title: idea.title,
          at: now,
          threadId: surfaces.threadId,
          voteId: surfaces.voteId,
          brain: invented.brain,
        },
      ].slice(-30),
    });
    pushStatusEvent(`idea spark · opened · ${idea.title.slice(0, 60)}`);
    appendAction("ideaSpark.opened", {
      title: idea.title,
      threadId: surfaces.threadId,
      voteId: surfaces.voteId,
      brain: invented.brain,
    });
    return {
      ok: true,
      posted: true,
      title: idea.title,
      brain: invented.brain,
      threadId: surfaces.threadId,
      voteId: surfaces.voteId,
    };
  } catch (err) {
    appendAction("ideaSpark.fail", { error: String(err?.message || err).slice(0, 300) });
    saveState({ ...state, lastRunAt: now, lastError: String(err?.message || err).slice(0, 200) });
    return { ok: false, posted: false, reason: String(err?.message || err).slice(0, 200) };
  }
}

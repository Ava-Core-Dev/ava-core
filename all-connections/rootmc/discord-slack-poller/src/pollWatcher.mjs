import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";
import { listOpenPolls, evaluatePollGate, getVote, castTextVote } from "./governanceClient.mjs";
import { postMessage } from "./discordApi.mjs";
import { createJob, markStaged } from "./jobQueue.mjs";
import { AVA_CHANNELS } from "./config.mjs";
import { postAudit } from "./audit.mjs";
import { seedVoteReactions, VOTE_START_REACTIONS } from "./seedVoteReactions.mjs";

/**
 * Poll watcher — tracks open governance polls vs Ava vote gates.
 * Seeds ✅/❌/➖ on new polls; posts progress notes; enqueues stage-only jobs on pass.
 */

function statePath() {
  return path.join(storePaths().dir, "poll-watcher.json");
}

function loadState() {
  try {
    if (!fs.existsSync(statePath())) return { polls: {}, updatedAt: 0 };
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return { polls: {}, updatedAt: 0 };
  }
}

function saveState(s) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), "utf8");
}

async function seedVoteStart(fetchJson, channelId, messageId) {
  return seedVoteReactions(fetchJson, channelId, messageId, VOTE_START_REACTIONS);
}

export async function runPollWatcher({ fetchJson, channelId, force = false }) {
  if (!channelId || !fetchJson) return { checked: 0, posts: 0 };
  const res = await listOpenPolls();
  if (!res?.ok || !Array.isArray(res.polls)) return { checked: 0, posts: 0, error: res?.detail };

  const state = loadState();
  let posts = 0;
  let seeded = 0;
  for (const p of res.polls) {
    const gate = evaluatePollGate(p);
    const prev = state.polls[p.id];
    const prevGate = prev?.gate;

    if (p.channel_id && p.message_id && !prev?.reactionsSeeded) {
      const did = await seedVoteStart(fetchJson, p.channel_id, p.message_id);
      if (did) seeded += 1;
      state.polls[p.id] = {
        ...(state.polls[p.id] || {}),
        reactionsSeeded: true,
        channelId: p.channel_id,
        messageId: p.message_id,
      };
    }

    // Ensure Ava's weighted ballot is on every open poll immediately.
    if (!state.polls[p.id]?.avaVoted) {
      try {
        const cast = await castTextVote(p.id, "for", "1532751879875072070");
        if (cast?.ok) {
          state.polls[p.id] = { ...(state.polls[p.id] || {}), avaVoted: true, avaChoice: "for" };
          console.log("poll watcher Ava auto-vote for", p.id, cast.detail || "ok");
        } else {
          console.warn("poll watcher Ava auto-vote:", p.id, cast?.detail);
        }
      } catch (err) {
        console.warn("poll watcher Ava auto-vote:", p.id, err.message);
      }
    }

    state.polls[p.id] = {
      ...(state.polls[p.id] || {}),
      gate: gate.gate,
      forPct: gate.forPct,
      againstPct: gate.againstPct,
      title: p.title,
      at: Date.now(),
    };
    if (!force && prevGate === gate.gate) continue;
    if (gate.gate === "waiting" && prevGate === "waiting") continue;

    const line = [
      `**Poll update · ${p.id}**`,
      p.title || "",
      gate.note,
      p.url ? `<${p.url}>` : null,
      gate.gate === "implement_now" || gate.gate === "pass"
        ? `_Gate passed — staging plan only; humans still own FileZilla/restart._`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await postMessage(fetchJson, channelId, line, null);
      posts += 1;
    } catch (err) {
      console.warn("poll watcher post:", err.message);
    }

    if (
      (gate.gate === "implement_now" || gate.gate === "pass") &&
      prevGate !== gate.gate
    ) {
      const job = createJob({
        kind: "feature",
        title: `Gate ${gate.gate}: ${p.title || p.id}`,
        proposalId: p.id,
        channelId,
        brief: `Governance gate ${gate.gate} for poll ${p.id} (${gate.note})`,
        fetchJson,
        auditChannelId: AVA_CHANNELS.audit,
      });
      markStaged(job.id, `governance ${gate.gate} — stage-only`, { fetchJson });
      postAudit(fetchJson, AVA_CHANNELS.audit, {
        title: `Gate ${gate.gate} · ${p.id}`,
        body: `${p.title || ""}\n${gate.note}\njob ${job.id}`,
      }).catch(() => {});
    }
  }
  state.updatedAt = Date.now();
  saveState(state);
  return { checked: res.polls.length, posts, seeded };
}

export async function summarizePoll(id) {
  const res = await getVote(id);
  if (!res?.ok || !res.poll) return null;
  const gate = evaluatePollGate(res.poll);
  return { poll: res.poll, gate };
}

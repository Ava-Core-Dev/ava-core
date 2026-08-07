/**
 * Open dig commitments — stop Ava from "give me a beat" then going idle.
 * Pipeline opens these when she accepts work or defers; poller chases them.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths, pushStatusEvent, writeHeartbeat } from "./store.mjs";
import { createJob, markImplementing, markDone, getJob } from "./jobQueue.mjs";
import { recommend } from "./recommend.mjs";
import { postMessage } from "./discordApi.mjs";
import { isSlackChannelId } from "./slackGateway.mjs";
import { recordAvaUtterance, appendAction } from "./fullLog.mjs";

function commitmentsPath() {
  return path.join(storePaths().dir, "commitments.json");
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(commitmentsPath(), "utf8"));
  } catch {
    return { items: [] };
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(commitmentsPath()), { recursive: true });
  fs.writeFileSync(commitmentsPath(), JSON.stringify(data, null, 2), "utf8");
}

function markDigging(on, lastAsk = "") {
  writeHeartbeat({
    digging: Boolean(on),
    ...(lastAsk ? { lastAsk: String(lastAsk).slice(0, 120), lastAskAt: Date.now() } : {}),
  });
}

/** Operator / lead dig assign — not small talk. */
export function looksLikeDigAssign(question = "") {
  const q = String(question || "");
  return (
    /\b(look\s+at|read|update|audit|rewrite|revise|review|dig\s+into|pull\s+(up|the)|line\s+(it\s+)?up)\b/i.test(
      q,
    ) &&
    /\b(constitution|governance|wiki|changelog|proposal|plugin|skills?|economy|docs?|channel)\b/i.test(
      q,
    )
  );
}

/** Ava promised deferred work instead of delivering. */
export function looksLikeDeferredPromise(answer = "") {
  const a = String(answer || "");
  return /\b(give\s+me\s+a\s+beat|give\s+me\s+(a\s+)?(minute|sec|second|moment)|i'?ll\s+(pull|read|draft|dig|line|check|come\s+back|post\s+the\s+diff)|lining\s+it\s+up|pulling\s+the\b|take\s+a\s+(look|beat)|brb\b)/i.test(
    a,
  );
}

export function listOpenCommitments() {
  return load().items.filter((c) => c.status === "open");
}

export function hasOpenCommitments() {
  return listOpenCommitments().length > 0;
}

export function openCommitment({
  title,
  brief,
  channelId,
  messageId,
  authorId,
  surface = "discord",
  jobId = null,
  reason = "accepted_dig",
} = {}) {
  const data = load();
  const key = `${channelId}|${String(brief || title || "").slice(0, 80).toLowerCase()}`;
  const existing = data.items.find(
    (c) =>
      c.status === "open" &&
      `${c.channelId}|${String(c.brief || "").slice(0, 80).toLowerCase()}` === key,
  );
  if (existing) {
    existing.updatedAt = Date.now();
    save(data);
    markDigging(true, title || brief);
    return existing;
  }

  let linkedJob = jobId;
  if (!linkedJob) {
    const job = createJob({
      kind: "dig",
      title: String(title || brief || "Open dig").slice(0, 80),
      channelId,
      messageId,
      authorId,
      brief: String(brief || title || "").slice(0, 2000),
    });
    markImplementing(job.id, "commitment opened — must deliver");
    linkedJob = job.id;
  } else {
    const j = getJob(linkedJob);
    if (j && !["implementing", "pending"].includes(j.status)) {
      markImplementing(linkedJob, "commitment chase — still digging");
    }
  }

  const item = {
    id: `cmt-${Date.now().toString(36)}`,
    status: "open",
    title: String(title || brief || "Open dig").slice(0, 120),
    brief: String(brief || title || "").slice(0, 2000),
    channelId: channelId || null,
    messageId: messageId || null,
    authorId: authorId || null,
    surface:
      surface === "slack" || isSlackChannelId(channelId) ? "slack" : "discord",
    jobId: linkedJob,
    reason,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    nudgeCount: 0,
  };
  data.items.push(item);
  save(data);
  appendAction("commitment.open", {
    id: item.id,
    jobId: linkedJob,
    title: item.title,
    channelId: item.channelId,
  });
  pushStatusEvent(`commitment open · ${item.title.slice(0, 80)}`);
  markDigging(true, item.title);
  return item;
}

export function closeCommitment(id, note = "delivered") {
  const data = load();
  const item = data.items.find((c) => c.id === id);
  if (!item) return null;
  item.status = "done";
  item.updatedAt = Date.now();
  item.closeNote = String(note || "").slice(0, 400);
  save(data);
  if (item.jobId) markDone(item.jobId, note);
  appendAction("commitment.close", { id, note: String(note).slice(0, 200) });
  if (!hasOpenCommitments()) markDigging(false);
  return item;
}

export function commitmentChaseIntervalMs() {
  return Math.max(
    45_000,
    Number(process.env.AVA_COMMITMENT_CHASE_MS || 90_000) || 90_000,
  );
}

export function commitmentChaseBootDelayMs() {
  return Math.max(
    15_000,
    Number(process.env.AVA_COMMITMENT_CHASE_BOOT_MS || 45_000) || 45_000,
  );
}

/**
 * @param {{ fetchJson: Function, env: object, postSlack?: Function }} opts
 * postSlack(channelId, text, threadTs) optional
 */
export async function chaseCommitments({ fetchJson, env, postSlack } = {}) {
  const open = listOpenCommitments().sort(
    (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
  );
  if (!open.length) return { chased: 0 };

  const item = open[0];
  markDigging(true, item.title);

  const question = `FINISH this open commitment now — do not defer again.

Commitment: ${item.title}
Original ask: ${item.brief}

Deliver the first real artifact in this reply:
- For constitution/governance: concrete stale sections + proposed edit bullets (post-ready for #governance).
- For docs/wiki: the actual draft text or clear diff.
- For plugin digs: verified status + next concrete step.

Hard: no "give me a beat" / "I'll pull later". If blocked, say exactly what blocks you.`;

  let answer;
  try {
    answer = await recommend({
      question,
      context: `Open commitment ${item.id} (job ${item.jobId || "none"}). You already accepted this — deliver.`,
      env,
      authorId: item.authorId || "",
      authorName: "commitment-chase",
      intent: { intent: "governance", reason: "commitment_chase", confidence: 1 },
      surface: item.surface || "discord",
    });
  } catch (err) {
    console.warn("commitment chase recommend:", err.message);
    return { chased: 0, error: err.message };
  }

  const text = String(answer || "").trim();
  if (!text) return { chased: 0, error: "empty" };

  if (looksLikeDeferredPromise(text) && (item.nudgeCount || 0) < 3) {
    const data = load();
    const cur = data.items.find((c) => c.id === item.id);
    if (cur) {
      cur.nudgeCount = (cur.nudgeCount || 0) + 1;
      cur.updatedAt = Date.now();
      save(data);
    }
    pushStatusEvent(
      `commitment defer · ${item.id} nudge=${(item.nudgeCount || 0) + 1}`,
    );
    return { chased: 0, deferred: true };
  }

  try {
    if (item.surface === "slack" || isSlackChannelId(item.channelId)) {
      if (typeof postSlack !== "function") {
        throw new Error("slack_post_unavailable");
      }
      await postSlack(item.channelId, text, item.messageId);
    } else if (fetchJson && item.channelId) {
      await postMessage(fetchJson, item.channelId, text, item.messageId);
    } else {
      throw new Error("no_post_target");
    }
  } catch (err) {
    console.warn("commitment chase post:", err.message);
    return { chased: 0, error: err.message };
  }

  recordAvaUtterance({
    surface: item.surface || "discord",
    channelId: item.channelId,
    content: text,
    refId: item.messageId,
    kind: "commitment_deliver",
    source: "commitment-chase",
    user: item.brief,
    authorId: item.authorId,
  });

  closeCommitment(item.id, "first deliverable posted");
  pushStatusEvent(`commitment delivered · ${item.title.slice(0, 80)}`);
  return { chased: 1, id: item.id };
}

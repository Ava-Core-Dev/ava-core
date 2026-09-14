import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";
import { writeProposalPlan, proposalPlanTemplate } from "./uploads.mjs";
import { postAudit } from "./audit.mjs";
import { postChangelog } from "./changelog.mjs";
import { postMessage } from "./discordApi.mjs";
import { appendAction } from "./fullLog.mjs";

/**
 * Cursor / Root Server job queue.
 * States: pending → implementing → staged → waiting_restart → watching | failed | blocked
 * Early phases: stage-only (no auto Shockbyte restart).
 */

function jobsDir() {
  const dir = path.join(storePaths().dir, "jobs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function jobPath(id) {
  return path.join(jobsDir(), `${id}.json`);
}

function readJob(id) {
  try {
    return JSON.parse(fs.readFileSync(jobPath(id), "utf8"));
  } catch {
    return null;
  }
}

function writeJob(job) {
  fs.writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2), "utf8");
  return job;
}

export function listJobs(limit = 20) {
  try {
    return fs
      .readdirSync(jobsDir())
      .filter((n) => n.endsWith(".json"))
      .map((n) => readJob(n.replace(/\.json$/, "")))
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function createJob({
  kind = "cursor",
  title,
  proposalId,
  channelId,
  messageId,
  authorId,
  brief,
  fetchJson,
  auditChannelId,
}) {
  const id = `job-${Date.now().toString(36)}`;
  const planBody = proposalPlanTemplate({
    problem: brief || title || "(from Discord)",
    plan: "Pending Root Server dig. Stage jars via publishPlugins / handoffs only — no auto restart.",
    risks: "Scope creep; secret leakage; unvoted feature work.",
    rollback: "Revert staged jar; keep prior handoff version.",
  });
  const planFile = writeProposalPlan({
    proposalId: proposalId || id,
    title: title || "Ava job",
    body: planBody,
  });

  const job = {
    id,
    kind,
    status: "pending",
    title: title || id,
    proposalId: proposalId || null,
    channelId: channelId || null,
    messageId: messageId || null,
    authorId: authorId || null,
    brief: String(brief || "").slice(0, 2000),
    planFile,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    history: [{ at: Date.now(), status: "pending", note: "created" }],
  };
  writeJob(job);

  appendAction("job.created", {
    jobId: job.id,
    kind: job.kind,
    title: job.title,
    channelId: job.channelId,
  });

  if (fetchJson && auditChannelId) {
    postAudit(fetchJson, auditChannelId, {
      title: `Job created · ${job.id}`,
      body: `${job.title}\nstatus: pending\nplan: \`${path.basename(planFile)}\`\n_Stage-only — humans own FileZilla/restart._`,
    }).catch(() => {});
  }
  return job;
}

export function advanceJob(id, status, note = "", { fetchJson } = {}) {
  const job = readJob(id);
  if (!job) return null;
  const allowed = [
    "pending",
    "implementing",
    "staged",
    "waiting_restart",
    "watching",
    "failed",
    "blocked",
    "done",
  ];
  if (!allowed.includes(status)) return job;
  const prev = job.status;
  job.status = status;
  job.updatedAt = Date.now();
  job.history = job.history || [];
  job.history.push({ at: Date.now(), status, note: String(note || "").slice(0, 400) });
  writeJob(job);

  appendAction("job.advance", {
    jobId: job.id,
    from: prev,
    to: status,
    note: String(note || "").slice(0, 200),
  });

  // Thread/channel progress note on meaningful transitions
  if (fetchJson && job.channelId && prev !== status) {
    const line = `**Job ${job.id}** → \`${status}\`${note ? ` — ${note.slice(0, 120)}` : ""}`;
    postMessage(fetchJson, job.channelId, line, job.messageId).catch(() => {});
  }

  // Changelog only on staged / watching (significant), not every queue
  if (fetchJson && (status === "staged" || status === "watching")) {
    postChangelog(fetchJson, {
      title: `${status} · ${job.id}`,
      body: `${job.title}\n_${job.kind || "job"}_`,
    }).catch(() => {});
  }
  return job;
}

export function markImplementing(id, note = "Root Server dig started") {
  return advanceJob(id, "implementing", note);
}

/** Soft: plan/jars staged — stays staged (no fake restart gate). */
export function markStaged(id, note = "staged — plan or jars ready", opts = {}) {
  return advanceJob(id, "staged", note, opts);
}

/** Jar deploy needs human FileZilla / Shockbyte restart. */
export function markAwaitingRestart(
  id,
  note = "staged to handoff — awaiting human restart",
  opts = {},
) {
  const job = advanceJob(id, "staged", note, opts);
  return advanceJob(id, "waiting_restart", "awaiting human restart", opts) || job;
}

export function markWatching(id, note = "human restarted — watching", opts = {}) {
  return advanceJob(id, "watching", note, opts);
}

export function markFailed(id, note = "failed", opts = {}) {
  return advanceJob(id, "failed", note, opts);
}

export function markDone(id, note = "done", opts = {}) {
  return advanceJob(id, "done", note, opts);
}

/**
 * Update plan file after dig with Ava's summary (problem/plan already seeded).
 */
export function updateJobPlan(id, { plan, risks, rollback, answerPreview } = {}) {
  const job = readJob(id);
  if (!job?.planFile) return null;
  const body = proposalPlanTemplate({
    problem: job.brief || job.title,
    plan: plan || answerPreview || "(from dig)",
    risks: risks || "See dig notes; stage-only deploy.",
    rollback: rollback || "Revert staged jar; keep prior handoff version.",
  });
  writeProposalPlan({
    proposalId: job.proposalId || job.id,
    title: job.title,
    body,
  });
  job.updatedAt = Date.now();
  writeJob(job);
  return job;
}

export function gatherJobsBrief() {
  const jobs = listJobs(8);
  if (!jobs.length) return { brief: "" };
  return {
    brief: `### Ava jobs (local queue — stage-only deploys)
${jobs
  .map((j) => `- ${j.id} [${j.status}] ${j.title}`)
  .join("\n")}`,
  };
}

export { readJob as getJob };

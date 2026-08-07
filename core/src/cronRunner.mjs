/**
 * Ava cron runner — owns all schedules previously on Cloudflare Workers.
 * Persists watermarks; on wake, catch-up replays missed offline jobs.
 */
import { CRON_JOBS, getEnv } from "./cronJobs.mjs";
import { recordRunStart, recordRunFinish, getWatermark } from "./cronWatermarks.mjs";
import { pushStatusEvent } from "./store.mjs";
import { logOps } from "./logOps.mjs";

const lastFired = new Map();
let timer = null;
let running = new Set();
let started = false;

async function runJob(job, { force = false, reason = "tick" } = {}) {
  if (running.has(job.id)) {
    return { ok: false, skipped: true, reason: "already_running" };
  }
  running.add(job.id);
  const env = getEnv();
  const { runId, startedAt } = await recordRunStart(job.id);
  try {
    const result = await job.run({ env, force, reason });
    const ok = Boolean(result?.ok ?? result?.status < 400);
    const detail = JSON.stringify(result?.json || result?.text || result).slice(0, 1500);
    await recordRunFinish(job.id, runId, {
      ok,
      detail,
      error: ok ? null : detail,
    });
    lastFired.set(job.id, Date.now());
    logOps({
      type: "cron.run",
      level: ok ? "info" : "error",
      jobId: job.id,
      ok,
      status: result?.status ?? null,
      durationMs: Date.now() - startedAt,
      error: ok ? null : detail,
      meta: { reason, force: Boolean(force) },
    });
    if (!result?.json?.skipped) {
      pushStatusEvent(`cron · ${job.id} · ${ok ? "ok" : "fail"}`);
    }
    return { ok, result, startedAt };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordRunFinish(job.id, runId, { ok: false, error: msg });
    logOps({
      type: "cron.run",
      level: "error",
      jobId: job.id,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: msg,
      meta: { reason, force: Boolean(force) },
    });
    pushStatusEvent(`cron · ${job.id} · error`);
    console.warn("cronRunner", job.id, msg);
    return { ok: false, error: msg, startedAt };
  } finally {
    running.delete(job.id);
  }
}

async function tick() {
  const now = Date.now();
  for (const job of CRON_JOBS) {
    const every = Number(job.everyMs || 0);
    if (!every) continue;
    const last = lastFired.get(job.id) || 0;
    // Seed lastFired from watermark so restart doesn't storm
    if (!last) {
      const wm = await getWatermark(job.id);
      if (wm?.last_finished_at) lastFired.set(job.id, Number(wm.last_finished_at));
    }
    const prev = lastFired.get(job.id) || 0;
    if (now - prev < every - 250) continue;
    // fire without awaiting all sequentially forever — small concurrency
    void runJob(job, { reason: "interval" });
  }
}

export function startCronRunner() {
  if (started) return { ok: true, already: true };
  if (String(process.env.AVA_CRON_RUNNER || "1").trim() === "0") {
    console.log("cronRunner disabled (AVA_CRON_RUNNER=0)");
    return { ok: false, reason: "disabled" };
  }
  started = true;
  // Stagger first tick
  setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), 15_000);
  }, Number(process.env.AVA_CRON_BOOT_MS || 45_000) || 45_000);
  console.log(`cronRunner · ${CRON_JOBS.length} jobs · boot in ${process.env.AVA_CRON_BOOT_MS || 45000}ms`);
  pushStatusEvent(`cronRunner · ${CRON_JOBS.length} jobs`);
  return { ok: true, jobs: CRON_JOBS.length };
}

export function stopCronRunner() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

export async function runCronJobNow(jobId, opts = {}) {
  const job = CRON_JOBS.find((j) => j.id === jobId);
  if (!job) return { ok: false, detail: "unknown_job" };
  return runJob(job, { force: true, reason: opts.reason || "manual" });
}

export function listCronJobs() {
  return CRON_JOBS.map((j) => ({
    id: j.id,
    everyMs: j.everyMs,
    cronHint: j.cronHint,
    catchup: Boolean(j.catchup),
  }));
}

export { runJob };

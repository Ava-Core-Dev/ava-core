/**
 * Ava self-fix — she may patch her own runtime/tools/finance/scripts when
 * something is buggy or a small Ava-owned feature is needed.
 * Player Minecraft features still need proposal + vote.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { cursorApiKey } from "./config.mjs";
import { cursorSelfFix } from "./cursorBrain.mjs";
import { createJob, markImplementing, markDone, markStaged } from "./jobQueue.mjs";
import { appendAction } from "./fullLog.mjs";
import { recordLocalLesson } from "./localBrain.mjs";
import { storePaths, pushStatusEvent } from "./store.mjs";
import { runAvaGithubPush } from "../scripts/ava-github-push.mjs";
import { loadStripeSnapshot, explainStripeBalance } from "./stripeFinance.mjs";

/** Pre-fix finance_review briefs that looped on healthy Stripe penny negatives. */
const FINANCE_NEG_BRIEF_RE =
  /finance\s+review\s+tooling\s+error.*(?:negative|available\s+balance)/i;

export function isStaleFinanceNegativeBalanceBrief(brief = "") {
  return FINANCE_NEG_BRIEF_RE.test(String(brief || ""));
}

function queuePath() {
  return path.join(storePaths().dir, "self-fix-queue.json");
}

function loadQueue() {
  try {
    if (!fs.existsSync(queuePath())) return { items: [], lastRunAt: 0 };
    return JSON.parse(fs.readFileSync(queuePath(), "utf8"));
  } catch {
    return { items: [], lastRunAt: 0 };
  }
}

function saveQueue(q) {
  fs.mkdirSync(path.dirname(queuePath()), { recursive: true });
  fs.writeFileSync(queuePath(), JSON.stringify(q, null, 2), "utf8");
}

/** Ava-owned surface — safe to self-fix without PROP. */
export function looksLikeAvaOwnedSurface(text = "") {
  const q = String(text || "").toLowerCase();
  return (
    /\b(rootmc-ava|ava\s+ivy|her\s+(own\s+)?(code|runtime|poller|persona|tools?|scripts?|finance|ledger|stripe|accounts?)|finance\s+(lane|review|ledger|account)|ops-ledger|playerFinance|ingame\s+chat\s+assist|phase-catchup|ava-github-push|self[-\s]?evo|self[-\s]?fix)\b/i.test(
      q,
    ) ||
    /\b(your|ava'?s?)\s+(bug|bugs|insides|prompt|routing|logging|tools?|finance|accounts?)\b/i.test(
      q,
    )
  );
}

/** Explicit operator / self permission to apply. */
export function looksLikeSelfFixCommand(text = "") {
  return /\b(fix\s+it\s+yourself|fix\s+yourself|ship\s+the\s+fix|patch\s+(it\s+)?yourself|apply\s+the\s+fix|self[-\s]?fix|go\s+ahead\s+and\s+fix|just\s+fix\s+it)\b/i.test(
    String(text || ""),
  );
}

/**
 * True when Ava should implement (not only describe) — Ava tooling bugs/features.
 * Never for player game features / economy rates / permissions / core plugins.
 */
export function isSelfFixableAsk(text = "", classified = null) {
  const q = String(text || "");
  if (
    /\b(shockbyte|filezilla|restart\s+the\s+server|ban\s+boats|core[-\s]?node|prod\s+spatial|official\s+kick)\b/i.test(
      q,
    )
  ) {
    return false;
  }
  if (
    /\b(player\s+feature|minecraft\s+feature|new\s+plugin|towny|claims\s+plugin|economy\s+rate|permission\s+node|p2w)\b/i.test(
      q,
    ) &&
    !looksLikeAvaOwnedSurface(q)
  ) {
    return false;
  }
  if (looksLikeSelfFixCommand(q)) return true;
  if (classified?.intent === "self_evo") return true;
  if (classified?.intent === "bug" && classified?.target === "ava") return true;
  if (
    (classified?.intent === "bug" || classified?.intent === "feature") &&
    looksLikeAvaOwnedSurface(q)
  ) {
    return true;
  }
  if (classified?.intent === "feature" && looksLikeAvaOwnedSurface(q)) return true;
  return false;
}

function briefFingerprint(brief = "") {
  return crypto
    .createHash("sha256")
    .update(String(brief || "").trim().toLowerCase())
    .digest("hex")
    .slice(0, 20);
}

export function enqueueSelfFix({
  brief,
  channelId = null,
  messageId = null,
  authorId = null,
  priority = "normal",
  source = "ask",
} = {}) {
  const q = loadQueue();
  const fp = briefFingerprint(brief);
  const dup = q.items.find(
    (i) =>
      (i.status === "queued" || i.status === "running") &&
      briefFingerprint(i.brief) === fp,
  );
  if (dup) {
    appendAction("selfFix.enqueue_skip", { reason: "duplicate", id: dup.id });
    return dup;
  }
  const item = {
    id: `sfx-${Date.now().toString(36)}`,
    brief: String(brief || "").slice(0, 2000),
    channelId,
    messageId,
    authorId,
    priority,
    source,
    status: "queued",
    createdAt: Date.now(),
  };
  q.items.push(item);
  if (q.items.length > 40) q.items = q.items.slice(-40);
  saveQueue(q);
  appendAction("selfFix.enqueue", { id: item.id, source });
  return item;
}

export function listQueuedSelfFixes() {
  return loadQueue().items.filter((i) => i.status === "queued");
}

/**
 * Cancel queued/running finance_review self-fix loops when Stripe is healthy
 * (trivial negative available + pending cover — fee/payout timing, not tooling).
 */
export function cancelStaleFinanceSelfFixes(snap = null) {
  const s = snap || loadStripeSnapshot();
  const bal = explainStripeBalance(s);
  if (!bal?.healthyTiming) return { cancelled: 0 };

  const q = loadQueue();
  let cancelled = 0;
  for (const item of q.items) {
    if (
      (item.status === "queued" || item.status === "running") &&
      item.source === "finance_review" &&
      isStaleFinanceNegativeBalanceBrief(item.brief)
    ) {
      item.status = "cancelled";
      item.cancelledAt = Date.now();
      item.cancelReason = "healthy_stripe_timing";
      cancelled += 1;
    }
  }
  if (cancelled) {
    saveQueue(q);
    appendAction("selfFix.cancel_stale", { cancelled, reason: "healthy_stripe_timing" });
  }
  return { cancelled };
}

/**
 * Run one self-fix dig via Cursor (writes Ava-owned files), then github push.
 */
export async function runSelfFix({
  brief,
  env = {},
  jobId = null,
  push = true,
  absorb = true,
} = {}) {
  if (!cursorApiKey(env)) {
    return { ok: false, reason: "missing_cursor_api_key" };
  }
  const text = String(brief || "").trim();
  if (!text) return { ok: false, reason: "empty_brief" };

  let job = jobId;
  if (!job) {
    const created = createJob({
      kind: "self_fix",
      title: `Self-fix: ${text.slice(0, 60)}`,
      brief: text,
      authorId: "ava-self",
      channelId: null,
    });
    job = created?.id || null;
  }
  if (job) markImplementing(job, "Ava self-fix dig started");

  pushStatusEvent(`self-fix · dig · ${text.slice(0, 80)}`);
  const dig = await cursorSelfFix({ brief: text, env });
  if (!dig.ok) {
    if (job) markStaged(job, `self-fix failed: ${dig.reason}`, {});
    appendAction("selfFix.failed", { reason: dig.reason, jobId: job });
    return { ok: false, reason: dig.reason, jobId: job, text: dig.text || null };
  }

  let pushResult = null;
  if (push) {
    try {
      pushResult = await runAvaGithubPush({
        message: `Ava: self-fix — ${text.slice(0, 72)}`,
      });
    } catch (err) {
      pushResult = { ok: false, reason: err.message };
    }
  }

  if (absorb) {
    try {
      recordLocalLesson({
        question: `Self-fix: ${text.slice(0, 120)}`,
        answer: String(dig.text || "").slice(0, 800),
        teacher: "ava-self",
        surface: "ops",
        meta: { kind: "self_fix", runId: dig.runId || null },
      });
    } catch {
      /* non-fatal */
    }
  }

  if (job) {
    markDone(
      job,
      `self-fix applied${pushResult?.ok && pushResult?.pushed ? " + pushed" : pushResult?.committed ? " + committed (push pending auth)" : ""}`,
    );
  }

  appendAction("selfFix.ok", {
    jobId: job,
    runId: dig.runId || null,
    push: pushResult?.reason || null,
  });
  pushStatusEvent(`self-fix · done · ${text.slice(0, 60)}`);

  return {
    ok: true,
    reason: "ok",
    jobId: job,
    text: dig.text,
    push: pushResult,
    runId: dig.runId,
  };
}

/**
 * Drain one queued self-fix (poller). Skip if too soon / no Cursor key.
 */
export async function runQueuedSelfFix({ env = {}, force = false } = {}) {
  const q = loadQueue();
  const minGap = Number(process.env.AVA_SELF_FIX_GAP_MS || 10 * 60 * 1000);
  if (!force && q.lastRunAt && Date.now() - q.lastRunAt < minGap) {
    return { ok: true, skipped: true, reason: "too_soon" };
  }
  cancelStaleFinanceSelfFixes();

  let next = null;
  for (const item of q.items) {
    if (item.status !== "queued") continue;
    if (isStaleFinanceNegativeBalanceBrief(item.brief)) {
      const bal = explainStripeBalance(loadStripeSnapshot());
      if (bal?.healthyTiming) {
        item.status = "cancelled";
        item.cancelledAt = Date.now();
        item.cancelReason = "healthy_stripe_timing";
        saveQueue(q);
        appendAction("selfFix.skip_stale", { id: item.id });
        continue;
      }
    }
    next = item;
    break;
  }
  if (!next) return { ok: true, skipped: true, reason: "empty" };

  next.status = "running";
  next.startedAt = Date.now();
  saveQueue(q);

  const result = await runSelfFix({ brief: next.brief, env, push: true });
  next.status = result.ok ? "done" : "failed";
  next.finishedAt = Date.now();
  next.resultReason = result.reason;
  q.lastRunAt = Date.now();
  saveQueue(q);
  return { ...result, queueId: next.id };
}

export function selfFixIntervalMs() {
  const n = Number(process.env.AVA_SELF_FIX_MS || 15 * 60 * 1000);
  return Number.isFinite(n) && n >= 60_000 ? n : 15 * 60 * 1000;
}

export function selfFixBootDelayMs() {
  const n = Number(process.env.AVA_SELF_FIX_BOOT_MS || 120_000);
  return Number.isFinite(n) && n >= 15_000 ? n : 120_000;
}

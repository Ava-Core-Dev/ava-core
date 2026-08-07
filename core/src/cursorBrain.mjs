import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, CursorAgentError } from "@cursor/sdk";
import { cursorApiKey, AVA_MODEL, AVA_WORKSPACE, AVA_HANDOFF } from "./config.mjs";
import { AVA_HARD_RULES, AVA_PERSONA } from "./persona.mjs";
import { scrubPublicReply } from "./scrub.mjs";
import { markDigOutage, looksLikeDigUsageOutage } from "./digHealth.mjs";
import { saveCursorPendingPack } from "./cursorPendingPack.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** RootMC workspace root (plugins, web, docs). */

/** Live chat/dig Cursor agents — OFF by default when AVA_CURSOR_CHAT=0 (dev/manual only). */
export function cursorChatEnabled() {
  const v = String(process.env.AVA_CURSOR_CHAT ?? "0").trim();
  if (v === "1" || /^true$/i.test(v) || /^on$/i.test(v)) return true;
  return false;
}

export function workspaceRoot() {
  if (AVA_WORKSPACE) return AVA_WORKSPACE;
  return path.resolve(__dirname, "../../..");
}

/** Max parallel Cursor local agents (Root Server digs). */
export const CURSOR_CONCURRENCY = Math.max(
  1,
  Math.min(8, Number(process.env.AVA_CURSOR_CONCURRENCY || 3) || 3),
);

/** Host-pressure may lower this temporarily; never below 1. */
let activeCap = CURSOR_CONCURRENCY;

export function effectiveCursorConcurrency() {
  return activeCap;
}

/** Host-pressure throttle — never kills the process. */
export function setCursorConcurrencyOverride(n) {
  if (n == null || Number.isNaN(Number(n))) {
    activeCap = CURSOR_CONCURRENCY;
    return activeCap;
  }
  activeCap = Math.max(1, Math.min(CURSOR_CONCURRENCY, Math.floor(Number(n))));
  return activeCap;
}

let activeAgents = 0;
let waitingForSlot = 0;
const slotWaiters = [];
let asksOpen = 0; // Discord asks mid-flight (packs + brain)

/** Discord asks mid-flight (packs + brain). Used for instant queue warnings. */
export function brainQueueDepth() {
  return asksOpen;
}

/** Live Cursor slot snapshot for status / busy replies. */
export function cursorSlots() {
  return {
    active: activeAgents,
    max: activeCap,
    configuredMax: CURSOR_CONCURRENCY,
    waiting: waitingForSlot,
    asksOpen,
    full: activeAgents >= activeCap,
  };
}

export function beginAsk() {
  asksOpen += 1;
}

export function endAsk() {
  asksOpen = Math.max(0, asksOpen - 1);
}

function acquireSlot() {
  return new Promise((resolve) => {
    if (activeAgents < activeCap) {
      activeAgents += 1;
      resolve();
      return;
    }
    waitingForSlot += 1;
    slotWaiters.push(() => {
      waitingForSlot = Math.max(0, waitingForSlot - 1);
      activeAgents += 1;
      resolve();
    });
  });
}

function releaseSlot() {
  activeAgents = Math.max(0, activeAgents - 1);
  const next = slotWaiters.shift();
  if (next) next();
}

/**
 * Root Server mode — local Cursor agent on the RootMC workspace.
 * Up to AVA_CURSOR_CONCURRENCY (default 3) digs run in parallel.
 * Pass Discord screenshots via `images` (Cursor SDK vision).
 *
 * @param {{ question: string, context?: string, env?: object, deep?: boolean, images?: any[], surface?: string, selfFix?: boolean }} opts
 */
export async function cursorRecommend({
  question,
  context = "",
  env,
  deep = false,
  images = [],
  surface = "discord",
  selfFix = false,
  allowCustomerDetails: allowCust = false,
}) {
  if (!cursorChatEnabled() && !selfFix) {
    return {
      ok: false,
      reason: "cursor_chat_disabled",
      text: null,
      brain: "cursor",
    };
  }
  // Explicit ops self-fix still requires AVA_CURSOR_CHAT=1 or AVA_CURSOR_SELF_FIX=1
  if (!cursorChatEnabled() && selfFix) {
    const sf = String(process.env.AVA_CURSOR_SELF_FIX || "").trim();
    if (!(sf === "1" || /^true$/i.test(sf))) {
      return {
        ok: false,
        reason: "cursor_chat_disabled",
        text: null,
        brain: "cursor",
      };
    }
  }

  const apiKey = cursorApiKey(env || {});
  if (!apiKey) {
    try {
      saveCursorPendingPack({
        question,
        context,
        prompt: `(missing cursor key — pack question+context only)\n\n${String(context||"").slice(0,42000)}\n\nQuestion:\n${String(question||"").trim()}`,
        reason: "missing_cursor_api_key",
        surface,
        deep,
        selfFix,
      });
    } catch {}
    return { ok: false, reason: "missing_cursor_api_key", text: null };
  }

  const onSlack = String(surface || "").toLowerCase() === "slack";
  const outLabel = onSlack ? "Slack" : "Discord";
  const surfaceVoice = onSlack
    ? `Surface: **Slack** (staff dig core). Voice: professional first, still lightly flirty with rapport — clear status, ownership, next steps. No meme-spam. Tasteful warmth OK; NSFW never. **No Discord app emojis** — never write :ava_*: / :ship_it: / <:name:id>. Plain text or standard Slack emoji only.`
    : `Surface: **Discord**. Voice: snappy community energy; light slang OK; still lead-dev. App emoji pack OK in reactions + rare <:name:id>.`;

  const cwd = workspaceRoot();
  const visionNote =
    Array.isArray(images) && images.length
      ? `\nImages attached (${images.length}): LOOK at them. Describe what you see and answer from the pixels — do not pretend you cannot see images.`
      : "";

  const selfFixNote = selfFix
    ? `Mode: **Ava SELF-FIX** (Alex standing — you apply the patch yourself).
Workspace: RootMC. You MAY and SHOULD edit files under:
- Web Files/rootmc-ava/**
- Server Handoffs/Ava Ivy/notes/** and docs/**
- Web Files/rootmc-realm-api/** only if required for Ava finance/governance helpers
- .cursor/rules/ava-*.mdc
NEVER edit .env, cloud.yml secrets, keystores, Server Live Backups, or player world data.
NEVER ship player Minecraft game features / economy rate changes / permission nodes — those need PROP+vote.
Do the fix now (write the code). Then OUTPUT ONLY a short ${outLabel} summary of what you changed + how to verify. No secret dumps.`
    : null;

  const modeNote = selfFixNote
    ? selfFixNote
    : deep
    ? `Mode: Root Server deep dig.
Workspace: RootMC root + Ava handoff (${AVA_HANDOFF || "Server Handoffs/Ava Ivy"} — uploads/, plans/, notes).
Use attached packs first. Only inspect extra files if the packs don't answer.${visionNote}
${surfaceVoice}
OUTPUT ONLY a ${outLabel} reply — accurate summary, no secret dumps, no raw disk paths, no deploy steps.
Read ### Cursor handoff notes and ### Recent chats first when present — those are what Ava core saved while digs were thin; resume them, don't ignore.
${onSlack || String(surface || "").toLowerCase() === "telegram" ? "With Alex in private/Telegram lockout you may name Cursor/Grok when relevant; still no secret dumps." : "Never name other AIs or vendors — say Root Server if you must."}
If this is an Ava-owned bug/tooling/finance fix (rootmc-ava, her ledgers, poller helpers), you MAY edit those files and summarize — Alex greenlit self-fix for her own stack. Player game features still describe + PROP only. Stage jars only — no Shockbyte restart.`
    : `Mode: Root Server quick assist.
Answer from the attached packs + question. Do NOT wander the repo unless the packs are empty/irrelevant.
Handoff drop zone is available under Ava Ivy uploads/plans when relevant.${visionNote}
${surfaceVoice}
OUTPUT ONLY a ${outLabel} reply. Accuracy > vibes. Prefer ### Cursor handoff notes / ### Recent chats when present. ${String(surface || "").toLowerCase() === "telegram" ? "Private Telegram: Cursor/Grok names OK if lockout." : "Never name other AIs."}
If asked to self-fix Ava tooling and packs already show the bug, say you'll apply it (self-fix path) rather than only describing.`;

  const prompt = `${AVA_PERSONA}

${AVA_HARD_RULES}

${modeNote}

Quality bar:
- LOCKED SPEC (lead-dev notes) is absolute core — obey it.
- Be correct. Wrong confidence is worse than "not sure".
- Be fast to read: answer first, then one link or next step.
- Stay in Ava's voice for this surface (${onSlack ? "professional + flirty" : "snappy Discord"}).

Thread/context (LOCKED SPEC + people + packs — stay in continuity; SPEC wins):
${String(context || "(none)").slice(0, 42000)}

Question (may continue prior chat):
${String(question).trim()}

Write Ava's ${outLabel} reply now.`;


  const saveFailPack = (reason) => {
    try {
      saveCursorPendingPack({
        question,
        prompt,
        context,
        reason,
        surface,
        deep,
        selfFix,
      });
    } catch (e) {
      console.warn("cursor pending pack save failed", e?.message || e);
    }
  };

  await acquireSlot();
  try {
    const wantSandbox =
      String(process.env.AVA_CURSOR_SANDBOX || "").trim() === "1";
    // Self-fix digs need more wall time to edit files
    const digTimeoutMs = Number(
      process.env.AVA_CURSOR_TIMEOUT_MS ||
        (selfFix
          ? 180_000
          : Array.isArray(images) && images.length
            ? 120_000
            : 75_000),
    );
    const agentOpts = (withSandbox) => ({
      apiKey,
      model: {
        id: AVA_MODEL,
        params: [
          {
            id: "fast",
            value:
              selfFix || deep || (Array.isArray(images) && images.length > 0)
                ? "false"
                : "true",
          },
        ],
      },
      local: {
        cwd,
        settingSources: [],
        autoReview: true,
        ...(withSandbox ? { sandboxOptions: { enabled: true } } : {}),
      },
    });

    const withTimeout = (p, ms, label) =>
      Promise.race([
        p,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms),
        ),
      ]);

    try {
      const runOnce = async (withSandbox) => {
        const hasImages = Array.isArray(images) && images.length > 0;
        if (!hasImages) {
          return withTimeout(
            Agent.prompt(prompt, agentOpts(withSandbox)),
            digTimeoutMs,
            "cursor",
          );
        }
        const agent = await Agent.create(agentOpts(withSandbox));
        try {
          const run = await agent.send({
            text: prompt,
            images: images.slice(0, 4),
          });
          return await withTimeout(run.wait(), digTimeoutMs, "cursor_vision");
        } finally {
          try {
            await agent?.[Symbol.asyncDispose]?.();
          } catch {
            /* ignore */
          }
        }
      };

      let result;
      try {
        result = await runOnce(wantSandbox);
      } catch (err) {
        const msg = err instanceof CursorAgentError ? err.message : String(err?.message || err);
        if (wantSandbox && /sandbox/i.test(msg)) {
          console.warn("cursor sandbox failed — retrying without");
          result = await runOnce(false);
        } else {
          throw err;
        }
      }

      if (result.status === "error") {
        const errMsg = String(result.error?.message || result.error || "");
        console.warn("cursor run error", result.id, errMsg);
        if (looksLikeDigUsageOutage(errMsg)) {
          markDigOutage(errMsg.slice(0, 200), { source: "cursor" });
        }
        saveFailPack("run_error");
        return { ok: false, reason: "run_error", text: null, runId: result.id };
      }

      const raw = String(result.result || "").trim();
      if (!raw) {
        saveFailPack("empty_result");
        return { ok: false, reason: "empty_result", text: null, runId: result.id };
      }

      return {
        ok: true,
        reason: "ok",
        text: scrubPublicReply(raw, {
          surface,
          allowCustomerDetails: allowCust,
        }),
        runId: result.id,
        agentId: result.agentId,
      };
    } catch (err) {
      const msg = err instanceof CursorAgentError ? err.message : String(err?.message || err);
      console.warn("cursorRecommend:", msg);
      if (looksLikeDigUsageOutage(msg)) {
        markDigOutage(msg.slice(0, 200), { source: "cursor" });
      }
      const failReason = /timeout/i.test(msg)
        ? "timeout"
        : err instanceof CursorAgentError
          ? "startup_error"
          : "unknown_error";
      saveFailPack(failReason);
      return {
        ok: false,
        reason: failReason,
        text: null,
      };
    }
  } finally {
    releaseSlot();
  }
}

/** Dedicated self-fix entry — always edit-capable prompt. */
export async function cursorSelfFix({ brief, env, surface = "slack" }) {
  return cursorRecommend({
    question: String(brief || "").trim(),
    context:
      "### Self-fix mandate\nAlex locked: if Ava's own stack is buggy or needs a small Ava-owned feature, she fixes it herself (write the code). Then summarize. Run no Shockbyte restart. Never touch secrets.",
    env,
    deep: true,
    selfFix: true,
    surface,
  });
}

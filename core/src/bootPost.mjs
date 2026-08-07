/**
 * One-shot boot posts (e.g. good morning + bedtime follow-up) under Ava data/.
 */

import fs from "node:fs";
import path from "node:path";
import { AVA_HANDOFF, AVA_CHANNELS } from "./config.mjs";
import { storePaths, pushStatusEvent } from "./store.mjs";
import { postMessageWithFiles } from "./postWithFiles.mjs";
import { avaHomeChannelId } from "./guildScout.mjs";
import { notifyAlexDreaming } from "./offlineNotes.mjs";
import { makeFetchJson } from "./discordApi.mjs";
import { setAsleep } from "./sleepMode.mjs";

function pendingPath() {
  return path.join(storePaths().dir, "pending-boot-post.json");
}

export function loadPendingBootPost() {
  try {
    return JSON.parse(fs.readFileSync(pendingPath(), "utf8"));
  } catch {
    return null;
  }
}

export function savePendingBootPost(payload) {
  const dir = storePaths().dir;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(pendingPath(), JSON.stringify(payload, null, 2), "utf8");
  return pendingPath();
}

export function clearPendingBootPost() {
  try {
    fs.unlinkSync(pendingPath());
  } catch {
    /* ignore */
  }
}

function resolveChannelId(pending, fallbackChannelId) {
  return (
    String(pending.channel_id || "").trim() ||
    avaHomeChannelId() ||
    AVA_CHANNELS.avaHome ||
    AVA_CHANNELS.general ||
    fallbackChannelId
  );
}

function resolveFiles(fileList) {
  const files = [];
  for (const rel of fileList || []) {
    const p = path.isAbsolute(rel) ? rel : path.join(AVA_HANDOFF, rel);
    if (fs.existsSync(p)) files.push(p);
  }
  return files;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Normalize legacy single-post shape into steps[]. */
function stepsFromPending(pending) {
  if (Array.isArray(pending.steps) && pending.steps.length) {
    return pending.steps;
  }
  return [
    {
      content: pending.content,
      files: pending.files || [],
      delay_ms: 0,
      then_sleep: Boolean(pending.then_sleep),
    },
  ];
}

/**
 * If a pending boot post exists and is not done, post step(s) once then mark done.
 * Optional step.then_sleep puts Ava in soft sleep after that step.
 */
export async function runPendingBootPost({ token, fallbackChannelId }) {
  const pending = loadPendingBootPost();
  if (!pending || pending.done) return { ok: false, skipped: true };

  const channelId = resolveChannelId(pending, fallbackChannelId);
  if (!channelId) {
    return { ok: false, detail: "no channel" };
  }

  const steps = stepsFromPending(pending);
  const messageIds = [];
  let slept = false;

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i] || {};
      const delay = Math.max(0, Number(step.delay_ms || 0));
      if (delay > 0) await sleep(delay);

      const content =
        String(step.content || pending.content || "").trim() ||
        "good morning — i'm up.";
      const files = resolveFiles(step.files || (i === 0 ? pending.files : []));

      const msg = await postMessageWithFiles(token, channelId, content, files);
      messageIds.push(msg?.id || null);
      pushStatusEvent(
        `boot post · step ${i + 1}/${steps.length} · ${channelId} · ${files.length} file(s)`,
      );
      console.log(
        "pending boot post step",
        i + 1,
        msg?.id,
        files.map((f) => path.basename(f)).join(",") || "(text)",
      );

      if (step.then_sleep || (i === steps.length - 1 && pending.then_sleep)) {
        const state = setAsleep({
          reason: String(step.sleep_reason || pending.sleep_reason || "nobody here — back to bed"),
          by: "boot-post",
        });
        slept = true;
        try {
          const fetchJson = makeFetchJson(token);
          await notifyAlexDreaming(fetchJson, {
            reason: state.reason || "boot-post sleep",
            kind: "sleep",
            wakeAt: state.wakeAt,
          });
        } catch (err) {
          console.warn("boot dream dm:", err.message);
        }
      }
    }

    pending.done = true;
    pending.posted_at = new Date().toISOString();
    pending.message_id = messageIds[0] || null;
    pending.message_ids = messageIds;
    pending.channel_id = channelId;
    savePendingBootPost(pending);
    return {
      ok: true,
      messageId: messageIds[0],
      messageIds,
      channelId,
      slept,
    };
  } catch (err) {
    pushStatusEvent(`boot post failed · ${err.message}`);
    console.warn("pending boot post failed:", err.message);
    return { ok: false, detail: err.message };
  }
}

/**
 * Global serial ask queue — one brain job at a time (Llama or Cursor).
 * Higher favorPriority runs sooner; equal priority stays FIFO.
 */
import { appendAction } from "./fullLog.mjs";

const queue = [];
let running = false;
let activeMeta = null;

export function serialQueueSnapshot() {
  return {
    running: Boolean(running),
    waiting: queue.length,
    depth: queue.length + (running ? 1 : 0),
    active: activeMeta,
  };
}

export function serialQueueDepth() {
  return queue.length + (running ? 1 : 0);
}

/**
 * @param {() => Promise<any>} task
 * @param {{ channelId?: string, messageId?: string, surface?: string, authorId?: string, priority?: number }=} meta
 */
export function enqueueSerial(task, meta = {}) {
  return new Promise((resolve, reject) => {
    const priority = Number(meta.priority);
    const item = {
      task,
      meta: {
        channelId: meta.channelId || null,
        messageId: meta.messageId || null,
        surface: meta.surface || null,
        authorId: meta.authorId || null,
        priority: Number.isFinite(priority) ? priority : 0,
        enqueuedAt: Date.now(),
      },
      resolve,
      reject,
    };
    // Higher priority first; same priority → FIFO
    let i = 0;
    while (
      i < queue.length &&
      (queue[i].meta.priority || 0) >= item.meta.priority
    ) {
      i += 1;
    }
    queue.splice(i, 0, item);
    appendAction("serial.enqueue", {
      waiting: queue.length,
      depth: serialQueueDepth(),
      priority: item.meta.priority,
      surface: item.meta.surface,
      channelId: item.meta.channelId,
    });
    void drain();
  });
}

/** Position if this ask were enqueued now (1 = next after current / first). */
export function nextQueuePosition(priority = 0) {
  const p = Number(priority) || 0;
  let ahead = running ? 1 : 0;
  for (const item of queue) {
    if ((item.meta.priority || 0) >= p) ahead += 1;
  }
  return ahead + 1;
}

async function drain() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const item = queue.shift();
      activeMeta = {
        ...item.meta,
        startedAt: Date.now(),
        waitedMs: Date.now() - item.meta.enqueuedAt,
      };
      appendAction("serial.start", {
        waitedMs: activeMeta.waitedMs,
        waiting: queue.length,
        priority: item.meta.priority,
        surface: item.meta.surface,
        channelId: item.meta.channelId,
      });
      try {
        const result = await item.task(activeMeta);
        item.resolve(result);
        appendAction("serial.done", {
          ms: Date.now() - activeMeta.startedAt,
          surface: item.meta.surface,
          channelId: item.meta.channelId,
        });
      } catch (err) {
        appendAction("serial.fail", {
          error: String(err?.message || err).slice(0, 300),
          surface: item.meta.surface,
          channelId: item.meta.channelId,
        });
        item.reject(err);
      } finally {
        activeMeta = null;
      }
    }
  } finally {
    running = false;
    if (queue.length) void drain();
  }
}

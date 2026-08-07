/**
 * Operator channel cleanup — when Alex/Melee say "clean up" / "tidy" / "condense",
 * Ava SUPER-cleans: deletes nearly all of her own messages in that channel.
 * Keeps only a tiny set of lock / board posts so the room stays readable.
 */
import { AVA_BOT_APP_ID } from "./config.mjs";
import { pushStatusEvent } from "./store.mjs";

const KEEP_PATTERNS = [
  /\bPROP-\d+/i,
  /\*\*Power status\*\*/i,
  /\bsolar tracking page is live\b/i,
  /ava\.rootmc\.net\/solar/i,
  /\bCouncil voting shares\b/i,
  /\bpinned\b/i,
  /surface\s*split\s*[—\-–]\s*locked/i,
  /\*\*today'?s board\*\*/i,
  /##\s*RootMC surface split/i,
  /\b18\+\s*[—\-–?]+\s*locked\b/i,
  /\*\*RootMC Pro\*\* is donor membership/i,
];

/** Soft max keepers so a "clean" never leaves a wall of Ava again. */
const MAX_KEEPERS = 3;

export function isChannelCleanupCommand(content = "") {
  const q = String(content || "")
    .toLowerCase()
    .replace(/<@!?\d+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return false;
  // Must address Ava OR be a clear channel-hygiene ask in a watched ops channel
  const addresses =
    /\b(ava|ivy|cleanup|clean\s*up|tidy|condense|declutter)\b/.test(q) ||
    /<@!?1532751879875072070>/.test(String(content || ""));
  if (!addresses && !/\b(clean|tidy|condense)\b/.test(q)) return false;
  return (
    /\b(clean\s*up|cleanup|super\s*clean|really\s*clean|tidy(\s*(up|it|this|the\s*channel))?|condense|declutter|wipe\s*(your|ava'?s)?\s*(posts|messages|spam)|purge\s*(your|ava'?s)?\s*(posts|messages))\b/i.test(
      q,
    ) ||
    /\b(clean|tidy)\s+(this\s+)?(channel|room|chat|#updates)\b/i.test(q) ||
    /\bwould like you to clean\b/i.test(q) ||
    /\bcondense\s+(this|these|it)\b/i.test(q)
  );
}

function isKeeper(content = "") {
  const t = String(content || "");
  return KEEP_PATTERNS.some((re) => re.test(t));
}

async function listOwnMessages(fetchJson, channelId, { max = 800 } = {}) {
  const out = [];
  let before;
  while (out.length < max) {
    const q = before
      ? `?limit=100&before=${before}`
      : `?limit=100`;
    const batch = await fetchJson(`/channels/${channelId}/messages${q}`);
    if (!Array.isArray(batch) || !batch.length) break;
    for (const m of batch) {
      if (m.author?.id === AVA_BOT_APP_ID || /ava\s*ivy/i.test(m.author?.username || "")) {
        out.push(m);
      }
    }
    before = batch[batch.length - 1].id;
    if (batch.length < 100) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}

async function deleteOwn(fetchJson, channelId, messageId) {
  await fetchJson(`/channels/${channelId}/messages/${messageId}`, {
    method: "DELETE",
  });
}

function retryAfterMs(err) {
  const raw = String(err?.message || err || "");
  const m = raw.match(/"retry_after"\s*:\s*([0-9.]+)/);
  if (m) return Math.ceil(Number(m[1]) * 1000) + 150;
  if (/\b429\b/.test(raw)) return 2500;
  return 0;
}

/**
 * Super-clean: keep up to MAX_KEEPERS lock/board posts; delete every other Ava message.
 * @returns {{ kept: string[], deleted: number, failed: number, scanned: number }}
 */
export async function superCleanChannel(fetchJson, channelId, opts = {}) {
  const own = await listOwnMessages(fetchJson, channelId, {
    max: opts.maxScan || 800,
  });
  // Newest first from Discord; pick keepers preferring newest matches
  const keepers = [];
  const toDelete = [];
  for (const m of own) {
    if (keepers.length < MAX_KEEPERS && isKeeper(m.content)) {
      keepers.push(m.id);
    } else {
      toDelete.push(m.id);
    }
  }

  // Protect explicit keep ids (e.g. a just-posted status)
  const protect = new Set((opts.protectIds || []).map(String));
  for (const id of protect) {
    const idx = toDelete.indexOf(id);
    if (idx >= 0) toDelete.splice(idx, 1);
    if (!keepers.includes(id) && keepers.length < MAX_KEEPERS) keepers.push(id);
  }

  let deleted = 0;
  let failed = 0;
  const leftover = [];
  for (const id of toDelete) {
    let ok = false;
    for (let attempt = 0; attempt < 4 && !ok; attempt++) {
      try {
        await deleteOwn(fetchJson, channelId, id);
        deleted++;
        ok = true;
        await new Promise((r) => setTimeout(r, 450));
      } catch (err) {
        const wait = retryAfterMs(err);
        if (wait) {
          await new Promise((r) => setTimeout(r, wait));
        } else {
          console.warn("channelCleanup delete fail", id, String(err.message || err).slice(0, 120));
          break;
        }
      }
    }
    if (!ok) {
      failed++;
      leftover.push(id);
    }
  }

  // Second pass on leftovers after a cool-down
  if (leftover.length) {
    await new Promise((r) => setTimeout(r, 5000));
    for (const id of leftover.slice()) {
      try {
        await deleteOwn(fetchJson, channelId, id);
        deleted++;
        failed = Math.max(0, failed - 1);
        leftover.splice(leftover.indexOf(id), 1);
        await new Promise((r) => setTimeout(r, 600));
      } catch (err) {
        const wait = retryAfterMs(err);
        if (wait) await new Promise((r) => setTimeout(r, wait));
        console.warn("channelCleanup leftover fail", id, String(err.message || err).slice(0, 80));
      }
    }
  }

  pushStatusEvent(
    `channel cleanup · #${channelId} · deleted ${deleted}/${toDelete.length} · kept ${keepers.length}`,
  );

  return {
    kept: keepers,
    deleted,
    failed: leftover.length,
    scanned: own.length,
    targeted: toDelete.length,
  };
}

export function cleanupWorkingLine() {
  return "on it — super-cleaning this channel. deleting my spam, keeping only the locks / board.";
}

export function cleanupDoneLine(result) {
  const kept = result?.kept?.length ?? 0;
  const n = result?.deleted ?? 0;
  return [
    `done — **super-cleaned**.`,
    `deleted **${n}** of my posts. kept **${kept}** lock/board message${kept === 1 ? "" : "s"}.`,
    kept
      ? "room should read clean now."
      : "nothing matched a lock to keep — channel was wiped of my posts.",
  ].join("\n");
}

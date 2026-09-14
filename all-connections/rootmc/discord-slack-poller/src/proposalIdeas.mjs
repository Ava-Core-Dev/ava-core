/**
 * Drain in-game /proposal idea queue — Ava alone formalizes PROP + Discord thread.
 */

import {
  listQueuedProposalIdeas,
  processNextProposalIdea,
  formalizeProposalIdea,
} from "./governanceClient.mjs";
import { pushStatusEvent } from "./store.mjs";

const MAX_PER_PASS = Math.min(20, Math.max(1, Number(process.env.AVA_PROPOSAL_IDEAS_MAX || 8) || 8));

/**
 * Process queued ideas (boot, wake, periodic). Returns how many formalized.
 */
export async function processPendingProposalIdeas({ reason = "poll" } = {}) {
  let formalized = 0;
  let failed = 0;
  const errors = [];

  for (let i = 0; i < MAX_PER_PASS; i++) {
    const res = await processNextProposalIdea();
    if (!res || res.empty) break;
    if (res.ok && res.item_id) {
      formalized += 1;
      pushStatusEvent(
        `proposal idea ${res.idea_id} → ${res.item_id}${res.title ? ` · ${String(res.title).slice(0, 40)}` : ""}`,
      );
      console.log(`[proposalIdeas] formalized ${res.idea_id} → ${res.item_id} (${reason})`);
    } else {
      failed += 1;
      errors.push(res.detail || "formalize failed");
      console.warn(`[proposalIdeas] fail ${res.idea_id || "?"}: ${res.detail || "unknown"}`);
      // Stop on hard auth/config failures; continue on single idea errors
      if (res.status === 401 || /workstation|Unauthorized/i.test(String(res.detail || ""))) {
        break;
      }
    }
  }

  if (formalized || failed) {
    pushStatusEvent(
      `proposal queue · ${reason} · +${formalized} formalized` + (failed ? ` · ${failed} failed` : ""),
    );
  }

  return { formalized, failed, errors };
}

/** Peek count for status lines. */
export async function queuedProposalIdeaCount() {
  const res = await listQueuedProposalIdeas({ limit: 50 });
  if (!res?.ok || !Array.isArray(res.ideas)) return 0;
  return res.ideas.length;
}

export { formalizeProposalIdea };

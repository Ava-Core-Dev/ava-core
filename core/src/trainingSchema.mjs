/**
 * Training dig schema — append-only JSONL under Ava handoff.
 * Used by roadmap Goal A (Cursor-independent future brain).
 */
export const TRAINING_DIGS_REL = "data/training/digs.jsonl";

/**
 * @typedef {{
 *   at: number,
 *   jobId?: string | null,
 *   surface?: "discord" | "slack" | "cli",
 *   messages: Array<{ role: string, content: string, meta?: object }>,
 * }} DigTrainingRow
 */

export function digTrainingSkeleton({
  system,
  user,
  assistant,
  jobId = null,
  surface = "discord",
  meta = {},
}) {
  return {
    at: Date.now(),
    jobId,
    surface,
    messages: [
      {
        role: "system",
        content:
          system ||
          "Ava Ivy — lead developer of the RootMC ecosystem. Tools: read/search-replace/verify. Gold=G. Features need votes.",
      },
      { role: "user", content: String(user || "") },
      {
        role: "assistant",
        content: String(assistant || ""),
        meta: { ok: true, ...meta },
      },
    ],
  };
}

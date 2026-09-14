import { slimEarthquakeContextForAi } from "./kilauea-earthquake-stats";

/**
 * `kilauea_ai_analyses.prompt_json` is written once per trigger, so a single fat context is stored
 * several times per cron run. Two of those blobs (raw `hawaii_earthquakes` plus NWS alert geometry)
 * grew `root-record` D1 past its 500 MB limit on 2026-08-18, which made every INSERT fail —
 * including signup and sign-in. D1 now keeps a bounded copy; the full payload still goes to the
 * Discord raw archive channel.
 */
const ARCHIVE_CONTEXT_MAX_BYTES = 32_000;

/** Post caps tried in order when the slimmed context is still over budget. */
const OFFICIAL_POST_CAPS = [25, 10, 3, 0];

function jsonForArchive(v: unknown): string {
  return JSON.stringify(v, (_k, value) => (typeof value === "bigint" ? value.toString() : value));
}

function recordArray(raw: unknown): Array<Record<string, unknown>> {
  return Array.isArray(raw)
    ? raw.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object" && !Array.isArray(x)))
    : [];
}

/** JSON for `prompt_json`: quake bulk dropped, then capped to a fixed byte budget. */
export function archiveContextJson(context: Record<string, unknown>): string {
  const slim = slimEarthquakeContextForAi(context);
  const full = jsonForArchive(slim);
  if (full.length <= ARCHIVE_CONTEXT_MAX_BYTES) return full;

  const officialX = (slim.official_x_updates as Record<string, unknown> | undefined) || {};
  const posts = recordArray(officialX.posts);
  for (const cap of OFFICIAL_POST_CAPS) {
    const out = jsonForArchive({
      generated_at: slim.generated_at ?? null,
      trigger: slim.trigger ?? null,
      earthquake_activity: slim.earthquake_activity ?? null,
      hawaii_earthquakes_fetched: slim.hawaii_earthquakes_fetched ?? null,
      previous_report: slim.previous_report ?? null,
      // officialPostsFromPromptJson() reads these back when the report is posted to Discord.
      official_x_updates: { ...officialX, posts: posts.slice(0, cap) },
      archive_truncated: true,
    });
    if (out.length <= ARCHIVE_CONTEXT_MAX_BYTES) return out;
  }
  return jsonForArchive({ generated_at: slim.generated_at ?? null, archive_truncated: true });
}

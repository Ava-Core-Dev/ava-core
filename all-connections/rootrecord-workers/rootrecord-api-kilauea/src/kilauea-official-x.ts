/** Official X accounts scanned for Kīlauea / Hawaiʻi hazard briefs. */
export const OFFICIAL_KILAUEA_X_SOURCES = [
  "USGSVolcanoes",
  "USGS_Quakes",
  "NWSHonolulu",
  "NWS_PTWC",
  "Hawaii_EMA",
  "CivilDefenseHI",
] as const;

const HAWAII_RELEVANCE_RE =
  /\b(k[īi]lauea|mauna\s*loa|hvo|hawai[ʻ']i|hawaii|big\s*island|hilo|p[āa]hoa|volcanoes\s*national|hawaiian\s*volcano|honolulu|maui|kauai|oahu|lanai|molokai)\b/i;

const UNRELATED_VOLCANO_REGION_RE =
  /\b(cascade|cascades|cascades\s*volcano|mount\s+rainier|mt\.?\s*rainier|mount\s+hood|mt\.?\s*hood|newberry|mount\s+st\.?\s*helens|st\.?\s*helens|yellowstone|mount\s+baker|mt\.?\s*baker|mount\s+adams|glacier\s+peak|crater\s+lake|lassen|shasta|long\s+valley)\b/i;

const TSUNAMI_RE = /\b(tsunami|ptwc|tidal\s*wave)\b/i;

const EXCEPTIONAL_HAZARD_RE =
  /\b(evacuat|life.?threat|major\s+eruption|significant\s+eruption|massive\s+eruption|deadly|fatal|casualt|aviation\s+color\s+code\s*:?\s*red|alert\s+level\s*:?\s*warning|state\s+of\s+emergency)\b/i;

const ROUTINE_OBSERVATORY_RE =
  /\b(normal\s+background|background\s+levels?|observatory\s+update|routine\s+levels?\s+of\s+activity)\b/i;

const HAWAII_FOCUSED_X_HANDLES = new Set(["nwshonolulu", "hawaii_ema", "civildefensehi"]);

export const KILAUEA_BRIEF_SCOPE_INSTRUCTION =
  "Scope reports to Kīlauea, Hawaiʻi Island, and Hawaiʻi-relevant hazards only. " +
  "Do not mention mainland or other-region volcano activity, routine observatory roundups, or distant earthquakes unless the event is massive, life-threatening, or tsunami-related for Hawaiʻi/Pacific interests. " +
  "Keep language professional and public-facing. Never mention Ava, Ava Ivy, OptiPlex, Root Server, MariaDB, Discord digs, Cursor, operators, internal tooling, cron jobs, or other backend/ops context.";

function xHandle(account: string | null | undefined): string {
  return String(account || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

function magnitudeFromText(text: string): number | null {
  const match = text.match(/\bM\s*([0-9]+(?:\.[0-9]+)?)\b/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/** Keep posts that belong in a Kīlauea / Big Island brief (drop routine mainland roundups). */
export function isKilaueaBriefRelevantOfficialXPost(text: string, account?: string | null): boolean {
  const t = String(text || "").trim();
  if (!t) return false;

  const handle = xHandle(account);
  if (HAWAII_FOCUSED_X_HANDLES.has(handle)) return true;

  if (handle === "nws_ptwc") return TSUNAMI_RE.test(t) || EXCEPTIONAL_HAZARD_RE.test(t);

  if (HAWAII_RELEVANCE_RE.test(t)) return true;
  if (TSUNAMI_RE.test(t)) return true;
  if (EXCEPTIONAL_HAZARD_RE.test(t)) return true;

  if (UNRELATED_VOLCANO_REGION_RE.test(t)) return false;
  if (ROUTINE_OBSERVATORY_RE.test(t)) return false;

  if (/\bM\s*[0-9]/i.test(t)) {
    const mag = magnitudeFromText(t);
    if (mag != null) return mag >= 4.5;
    return false;
  }

  if (/\bvolcano\b/i.test(t)) return false;

  return false;
}

export function filterKilaueaRelevantOfficialXPosts(
  posts: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return posts.filter((post) =>
    isKilaueaBriefRelevantOfficialXPost(String(post.text || ""), String(post.account || "")),
  );
}

type OfficialXEnv = { GROK_X_BEARER_TOKEN?: string };

function truncateText(raw: unknown, max: number): string {
  const s = String(raw ?? "").trim();
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…` : s;
}

/** Recent official X posts scoped to Kīlauea / Hawaiʻi hazards. */
export async function fetchOfficialKilaueaXUpdates(env: OfficialXEnv): Promise<Record<string, unknown>> {
  const bearer = String(env.GROK_X_BEARER_TOKEN || "").trim();
  const accounts = [...OFFICIAL_KILAUEA_X_SOURCES];
  if (!bearer) {
    return {
      configured: false,
      source: "X.com official-source recent search",
      accounts,
      posts: [],
      note: "GROK_X_BEARER_TOKEN is not configured; official X updates were not scanned.",
    };
  }

  const query =
    `(${accounts.map((name) => `from:${name}`).join(" OR ")}) ` +
    `(Kilauea OR Kīlauea OR Hawaii OR Hawaiʻi OR "Big Island" OR volcano OR lava OR earthquake OR tsunami OR advisory OR warning OR watch) ` +
    `-is:retweet -Cascade -Rainier -Hood -"St. Helens" -Newberry -Oregon -Washington`;
  const url = new URL("https://api.twitter.com/2/tweets/search/recent");
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", "20");
  url.searchParams.set("tweet.fields", "created_at,public_metrics,lang");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "name,username,verified");

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${bearer}`,
        "User-Agent": "RootRecordKilauea/1 (official X scan)",
      },
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const includes = data.includes as Record<string, unknown> | undefined;
    const rawUsers = Array.isArray(includes?.users) ? (includes.users as Array<Record<string, unknown>>) : [];
    const users = new Map<string, Record<string, unknown>>();
    for (const user of rawUsers) users.set(String(user.id || ""), user);
    const tweets = Array.isArray(data.data) ? (data.data as Array<Record<string, unknown>>) : [];
    const posts = tweets.map((tweet) => {
      const author = users.get(String(tweet.author_id || "")) || {};
      const username = String(author.username || "");
      const id = String(tweet.id || "");
      return {
        id,
        account: username ? `@${username}` : tweet.author_id || null,
        name: author.name || null,
        created_at: tweet.created_at || null,
        text: truncateText(tweet.text, 500),
        url: username && id ? `https://x.com/${username}/status/${id}` : null,
        metrics: tweet.public_metrics || null,
      };
    });
    const filtered = filterKilaueaRelevantOfficialXPosts(posts);
    return {
      configured: true,
      ok: res.ok,
      status: res.status,
      source: "X.com official-source recent search",
      accounts,
      query,
      posts: filtered,
      filtered_out: Math.max(0, posts.length - filtered.length),
      error: res.ok ? null : data,
    };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      source: "X.com official-source recent search",
      accounts,
      query,
      posts: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * GET /api/weekly-work-log — GitHub commit rollup across all owner repos (Pages secret).
 *
 * Requires `GITHUB_TOKEN` on the Pages project (repo scope for private repos).
 * Optional `GITHUB_OWNER` (defaults to RootRecord).
 */
type Env = {
  GITHUB_TOKEN?: string;
  GITHUB_OWNER?: string;
};

type GitHubRepo = {
  name: string;
  private: boolean;
  created_at: string;
  pushed_at: string | null;
  description: string | null;
  language: string | null;
};

type GitHubCommit = {
  commit: {
    committer: { date: string } | null;
    author: { date: string } | null;
  };
};

type RepoSummary = {
  name: string;
  private: boolean;
  createdAt: string;
  lastPush: string | null;
  language: string;
  totalCommits: number;
  firstCommit: string | null;
  lastCommit: string | null;
  activeWeeks: number;
  url: string;
};

type WeeklyWorkLogPayload = {
  ok: true;
  generatedAt: string;
  account: string;
  repoCount: number;
  publicRepos: number;
  privateRepos: number;
  totalCommits: number;
  firstActivityWeek: string | null;
  lastActivityWeek: string | null;
  activeWeekCount: number;
  weeklyGlobal: Record<string, number>;
  weeklyByRepo: Record<string, Record<string, number>>;
  repos: RepoSummary[];
};

const CACHE_TTL_SEC = 3600;
const MAX_COMMIT_PAGES = 50;

function jsonResponse(body: unknown, status = 200, cacheControl = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
    },
  });
}

function weekStartKey(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate.slice(0, 10);
  d.setUTCHours(0, 0, 0, 0);
  const daysFromMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysFromMonday);
  return d.toISOString().slice(0, 10);
}

function dateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return iso.slice(0, 10);
}

async function ghFetch(path: string, token: string): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "rootrecord-website/1 (weekly-work-log)",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

async function listOwnerRepos(owner: string, token: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  const ownerLower = owner.toLowerCase();
  for (let page = 1; page <= 10; page++) {
    // /users/{owner}/repos hides private repos; /user/repos with affiliation=owner includes them.
    const res = await ghFetch(
      `/user/repos?affiliation=owner&visibility=all&sort=pushed&direction=desc&per_page=100&page=${page}`,
      token,
    );
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`GitHub repo list failed (${res.status}): ${detail.slice(0, 240)}`);
    }
    const batch = (await res.json()) as Array<GitHubRepo & { owner?: { login?: string } }>;
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const repo of batch) {
      const login = String(repo.owner?.login || "").toLowerCase();
      if (login === ownerLower) repos.push(repo);
    }
    if (batch.length < 100) break;
  }
  return repos;
}

async function fetchRepoCommits(owner: string, repo: string, token: string): Promise<string[]> {
  const dates: string[] = [];
  for (let page = 1; page <= MAX_COMMIT_PAGES; page++) {
    const res = await ghFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=100&page=${page}`,
      token,
    );
    if (res.status === 409) return dates;
    if (!res.ok) {
      if (res.status === 404 || res.status === 403) return dates;
      const detail = await res.text();
      throw new Error(`GitHub commits failed for ${repo} (${res.status}): ${detail.slice(0, 240)}`);
    }
    const batch = (await res.json()) as GitHubCommit[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const row of batch) {
      const raw = row.commit?.committer?.date || row.commit?.author?.date;
      if (raw) dates.push(raw);
    }
    if (batch.length < 100) break;
  }
  return dates;
}

async function buildWeeklyWorkLog(owner: string, token: string): Promise<WeeklyWorkLogPayload> {
  const ghRepos = await listOwnerRepos(owner, token);
  const weeklyGlobal: Record<string, number> = {};
  const weeklyByRepo: Record<string, Record<string, number>> = {};
  const repos: RepoSummary[] = [];

  for (const repo of ghRepos) {
    const dates = await fetchRepoCommits(owner, repo.name, token);
    const repoWeekly: Record<string, number> = {};
    let earliest: Date | null = null;
    let latest: Date | null = null;

    for (const raw of dates) {
      const dt = new Date(raw);
      if (Number.isNaN(dt.getTime())) continue;
      const key = weekStartKey(raw);
      repoWeekly[key] = (repoWeekly[key] ?? 0) + 1;
      weeklyGlobal[key] = (weeklyGlobal[key] ?? 0) + 1;
      if (!earliest || dt < earliest) earliest = dt;
      if (!latest || dt > latest) latest = dt;
    }

    weeklyByRepo[repo.name] = repoWeekly;
    repos.push({
      name: repo.name,
      private: repo.private,
      createdAt: repo.created_at,
      lastPush: repo.pushed_at,
      language: repo.language || "-",
      totalCommits: dates.length,
      firstCommit: earliest ? dateOnly(earliest.toISOString()) : null,
      lastCommit: latest ? dateOnly(latest.toISOString()) : null,
      activeWeeks: Object.keys(repoWeekly).length,
      url: `https://github.com/${owner}/${repo.name}`,
    });
  }

  repos.sort((a, b) => b.totalCommits - a.totalCommits || a.name.localeCompare(b.name));

  const weekKeys = Object.keys(weeklyGlobal).sort();
  const totalCommits = repos.reduce((sum, r) => sum + r.totalCommits, 0);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    account: owner,
    repoCount: repos.length,
    publicRepos: repos.filter((r) => !r.private).length,
    privateRepos: repos.filter((r) => r.private).length,
    totalCommits,
    firstActivityWeek: weekKeys[0] ?? null,
    lastActivityWeek: weekKeys[weekKeys.length - 1] ?? null,
    activeWeekCount: weekKeys.length,
    weeklyGlobal,
    weeklyByRepo,
    repos,
  };
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const token = String(context.env.GITHUB_TOKEN || "").trim();
  if (!token) {
    return jsonResponse(
      {
        ok: false,
        detail: "GITHUB_TOKEN is not set on Pages. Add a GitHub PAT with repo scope as a Pages secret.",
      },
      503,
    );
  }

  const owner = String(context.env.GITHUB_OWNER || "RootRecord").trim() || "RootRecord";
  const url = new URL(context.request.url);
  const bypassCache = url.searchParams.get("refresh") === "1";
  const cacheKey = new Request(`https://weekly-work-log.internal/${owner}`, { method: "GET" });
  const cache = caches.default;

  if (!bypassCache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  try {
    const payload = await buildWeeklyWorkLog(owner, token);
    const res = jsonResponse(payload, 200, `public, max-age=${CACHE_TTL_SEC}`);
    context.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ ok: false, detail: msg }, 502);
  }
};

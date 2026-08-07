/**
 * Public api.rootmc.net governance client (no API key).
 */

const BASE = String(
  process.env.AVA_API_BASE || process.env.ROOTMC_API_BASE || "https://api.rootmc.net",
).replace(/\/$/, "");

const DAY_MS = 7 * 24 * 60 * 60 * 1000;

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: "application/json", "User-Agent": "AvaIvyRootMC/0.5" },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    return { ok: false, status: res.status, detail: data?.detail || text.slice(0, 200) };
  }
  return data || { ok: false };
}

export async function listOpenPolls() {
  return getJson("/api/governance/polls");
}

export async function getVote(id) {
  return getJson(`/api/governance/votes/${encodeURIComponent(id)}`);
}

export async function getCouncil() {
  return getJson("/api/governance/council");
}

export async function getVotingPower({ discordUserId, uuid } = {}) {
  const q = new URLSearchParams();
  if (discordUserId) q.set("discord_user_id", String(discordUserId));
  if (uuid) q.set("uuid", String(uuid));
  return getJson(`/api/governance/voting-power?${q}`);
}

function workstationKey() {
  return String(
    process.env.ROOTMC_DEV_WORKSTATION_KEY || process.env.ROOTMC_INTERNAL_API_KEY || "",
  ).trim();
}

/**
 * Push Ava reaction quality scores into D1 vote-factor bonuses.
 * @param {Array<{ discord_user_id: string, good_count?: number, bad_count?: number, neutral_count?: number, quality_score?: number }>} factors
 */
export async function syncAvaReactionFactors(factors) {
  const key = workstationKey();
  if (!key) {
    return {
      ok: false,
      detail: "ROOTMC_DEV_WORKSTATION_KEY missing — cannot sync reaction factors.",
    };
  }
  const list = Array.isArray(factors) ? factors : [];
  const res = await fetch(`${BASE}/api/governance/ava-reaction-factors`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "AvaIvyRootMC/0.5",
      "X-RootMC-Dev-Key": key,
    },
    body: JSON.stringify({ factors: list }),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      detail: data?.detail || text.slice(0, 200),
    };
  }
  return data || { ok: true };
}

/** Rebuild local reactor index and POST Discord factors to api.rootmc.net. */
export async function pushReactorVoteFactorsToApi(listReactorVoteFactors) {
  const factors =
    typeof listReactorVoteFactors === "function"
      ? listReactorVoteFactors()
      : Array.isArray(listReactorVoteFactors)
        ? listReactorVoteFactors
        : [];
  if (!factors.length) {
    return { ok: true, upserted: 0, factors: 0 };
  }
  const result = await syncAvaReactionFactors(factors);
  return { ...result, factors: factors.length };
}

/** Cast a text vote (Ava or forwarded player) via workstation auth. */
export async function castTextVote(proposalId, vote, discordUserId) {
  const key = workstationKey();
  if (!key) {
    return { ok: false, detail: "ROOTMC_DEV_WORKSTATION_KEY missing — cannot cast text votes." };
  }
  const res = await fetch(`${BASE}/api/governance/votes/${encodeURIComponent(proposalId)}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "AvaIvyRootMC/0.5",
      "X-RootMC-Dev-Key": key,
    },
    body: JSON.stringify({
      vote: String(vote || "").toLowerCase(),
      discord_user_id: String(discordUserId || ""),
    }),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    return { ok: false, status: res.status, detail: data?.detail || text.slice(0, 200) };
  }
  return data || { ok: true };
}

/** Official in-game /proposal queue — Ava picks these up when online. */
export async function listQueuedProposalIdeas({ status = "queued", limit = 20 } = {}) {
  const key = workstationKey();
  if (!key) {
    return { ok: false, detail: "ROOTMC_DEV_WORKSTATION_KEY missing — cannot list proposal ideas." };
  }
  const q = new URLSearchParams({ status: String(status), limit: String(limit) });
  const res = await fetch(`${BASE}/api/governance/proposal-ideas?${q}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "AvaIvyRootMC/0.5",
      "X-RootMC-Dev-Key": key,
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    return { ok: false, status: res.status, detail: data?.detail || text.slice(0, 200) };
  }
  return data || { ok: false };
}

export async function processNextProposalIdea() {
  const key = workstationKey();
  if (!key) {
    return { ok: false, detail: "ROOTMC_DEV_WORKSTATION_KEY missing — cannot formalize ideas." };
  }
  const res = await fetch(`${BASE}/api/governance/proposal-ideas/process-next`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "AvaIvyRootMC/0.5",
      "X-RootMC-Dev-Key": key,
    },
    body: "{}",
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    return { ok: false, status: res.status, detail: data?.detail || text.slice(0, 200), ...(data || {}) };
  }
  return data || { ok: false };
}

export async function formalizeProposalIdea(ideaId) {
  const key = workstationKey();
  if (!key) {
    return { ok: false, detail: "ROOTMC_DEV_WORKSTATION_KEY missing — cannot formalize ideas." };
  }
  const res = await fetch(
    `${BASE}/api/governance/proposal-ideas/${encodeURIComponent(ideaId)}/formalize`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "AvaIvyRootMC/0.5",
        "X-RootMC-Dev-Key": key,
      },
      body: "{}",
    },
  );
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    return { ok: false, status: res.status, detail: data?.detail || text.slice(0, 200), ...(data || {}) };
  }
  return data || { ok: false };
}

/** In-game /feedback queue for Ava. */
export async function listQueuedFeedback({ status = "queued", limit = 20 } = {}) {
  const key = workstationKey();
  if (!key) {
    return { ok: false, detail: "ROOTMC_DEV_WORKSTATION_KEY missing — cannot list feedback." };
  }
  const q = new URLSearchParams({ status: String(status), limit: String(limit) });
  const res = await fetch(`${BASE}/api/governance/feedback-inbox?${q}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "AvaIvyRootMC/0.5",
      "X-RootMC-Dev-Key": key,
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    return { ok: false, status: res.status, detail: data?.detail || text.slice(0, 200) };
  }
  return data || { ok: false };
}

export async function processNextFeedback() {
  const key = workstationKey();
  if (!key) {
    return { ok: false, detail: "ROOTMC_DEV_WORKSTATION_KEY missing — cannot process feedback." };
  }
  const res = await fetch(`${BASE}/api/governance/feedback-inbox/process-next`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "AvaIvyRootMC/0.5",
      "X-RootMC-Dev-Key": key,
    },
    body: "{}",
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    return { ok: false, status: res.status, detail: data?.detail || text.slice(0, 200), ...(data || {}) };
  }
  return data || { ok: false };
}

export async function ackFeedback(feedbackId, avaNote = "") {
  const key = workstationKey();
  if (!key) {
    return { ok: false, detail: "ROOTMC_DEV_WORKSTATION_KEY missing — cannot ack feedback." };
  }
  const res = await fetch(
    `${BASE}/api/governance/feedback-inbox/${encodeURIComponent(feedbackId)}/ack`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "AvaIvyRootMC/0.5",
        "X-RootMC-Dev-Key": key,
      },
      body: JSON.stringify({ ava_note: String(avaNote || "").slice(0, 500) }),
    },
  );
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    return { ok: false, status: res.status, detail: data?.detail || text.slice(0, 200), ...(data || {}) };
  }
  return data || { ok: false };
}

/**
 * Ava vote gates:
 * - 75% anytime → implement_now
 * - day 7 (closes_at OR opened_at+7d) ≥60% → pass
 * - day 7 <60% → close
 */
export function evaluatePollGate(poll) {
  if (!poll) return { gate: "unknown", note: "no poll" };
  const forPct = Number(poll.weighted_for_pct ?? 0);
  const againstPct = Number(poll.weighted_against_pct ?? 0);
  const closesAt = poll.closes_at ? Date.parse(poll.closes_at) : NaN;
  const openedAt = poll.opened_at
    ? Date.parse(poll.opened_at)
    : poll.created_at
      ? Date.parse(poll.created_at)
      : NaN;
  const day7At = Number.isFinite(closesAt)
    ? closesAt
    : Number.isFinite(openedAt)
      ? openedAt + DAY_MS
      : NaN;
  const open = poll.open !== false && String(poll.status || "") === "open";
  const now = Date.now();

  if (forPct >= 75) {
    return {
      gate: "implement_now",
      note: `≥75% for (${forPct}%) — implement immediately per Ava rules`,
      forPct,
      againstPct,
      open,
    };
  }

  const closedOrDue = !open || (Number.isFinite(day7At) && now >= day7At);
  if (closedOrDue) {
    if (forPct >= 60) {
      return {
        gate: "pass",
        note: `day-7/close ≥60% for (${forPct}%) — pass`,
        forPct,
        againstPct,
        open,
      };
    }
    return {
      gate: "close",
      note: `day-7/close <60% for (${forPct}%) — close (reopenable)`,
      forPct,
      againstPct,
      open,
    };
  }

  return {
    gate: "waiting",
    note: `open — for ${forPct}% / against ${againstPct}% (need 75% anytime or ≥60% at day-7/close)`,
    forPct,
    againstPct,
    open,
  };
}

function extractVoteId(question = "") {
  const m = String(question || "").match(
    /\b(?:vote|poll|proposal)[:\s#]*([A-Za-z0-9_-]{4,})\b/i,
  );
  return m?.[1] || null;
}

/** Pack for Cursor prompts — never invent poll numbers. */
export async function gatherGovernanceBrief({ discordUserId, question } = {}) {
  try {
    const voteId = extractVoteId(question || "");
    const [pollsRes, powerRes, councilRes, voteRes] = await Promise.all([
      listOpenPolls(),
      discordUserId ? getVotingPower({ discordUserId }) : Promise.resolve(null),
      getCouncil(),
      voteId ? getVote(voteId) : Promise.resolve(null),
    ]);
    const lines = ["### Governance (live api.rootmc.net — do not invent numbers)"];
    if (pollsRes?.ok && Array.isArray(pollsRes.polls)) {
      if (!pollsRes.polls.length) lines.push("Open polls: none");
      for (const p of pollsRes.polls.slice(0, 6)) {
        const g = evaluatePollGate(p);
        lines.push(
          `- **${p.id}** ${p.title || ""} · for ${p.weighted_for_pct ?? "?"}% / against ${p.weighted_against_pct ?? "?"}% · gate: ${g.gate}`,
        );
      }
    } else {
      lines.push(`Polls fetch: ${pollsRes?.detail || "unavailable"}`);
    }
    if (voteRes?.ok && voteRes.poll) {
      const g = evaluatePollGate(voteRes.poll);
      lines.push(
        `Asked vote **${voteRes.poll.id}**: for ${voteRes.poll.weighted_for_pct ?? "?"}% · gate ${g.gate} (${g.note})`,
      );
    }
    if (councilRes?.ok) {
      lines.push(
        `Council: eligible≈${councilRes.eligible_count ?? "?"} · synced ${councilRes.synced_at || "?"}`,
      );
      for (const c of (councilRes.council || []).slice(0, 5)) {
        lines.push(
          `  - ${c.minecraft_username || "?"} share ${c.share_percent ?? "?"}%`,
        );
      }
    }
    if (powerRes?.ok) {
      lines.push(
        `Asker voting power: eligible=${powerRes.eligible} share=${powerRes.share_percent ?? "?"}% · ${powerRes.summary || ""}`,
      );
    } else if (discordUserId && powerRes && powerRes.ok === false) {
      lines.push(`Asker voting power: ${powerRes.detail || "not linked / unavailable"}`);
    }
    lines.push(
      "Rules: features need proposal + vote; 75% anytime = implement; day7 ≥60% = pass; bugs verify then fix.",
    );
    return {
      brief: lines.join("\n"),
      polls: pollsRes,
      power: powerRes,
      council: councilRes,
      vote: voteRes,
    };
  } catch (err) {
    return {
      brief: `### Governance\n(unavailable: ${err.message})`,
      polls: null,
      power: null,
    };
  }
}

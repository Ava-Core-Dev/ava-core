/**
 * Staff listing-vote nag — Alex + Melee only.
 * If either has not cast a listing-site vote in 24h, Ava yells once,
 * then literally ends with: Go fkn vote
 *
 * Disable: AVA_STAFF_VOTE_NAG=0
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv, botToken } from "./config.mjs";
import { makeFetchJson, sendDm } from "./discordApi.mjs";
import { getVotingPower } from "./governanceClient.mjs";
import { postAvaTelegram } from "./avaPost.mjs";
import { guardedRcon, rconConfigured, rconTargets } from "./rconGuard.mjs";
import { recordAvaUtterance } from "./fullLog.mjs";
import { isEmergencyStopped } from "./emergencyStop.mjs";
import { isHushed, storePaths, pushStatusEvent } from "./store.mjs";
import { isPoweredOff } from "./powerDown.mjs";
import { isLockoutActive } from "./lockoutMode.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const CF_ACCOUNT = "f3372b30093435bacc35b69972abeb2e";
const D1_ROOTMC = "6cf71128-67e3-47b2-a802-d6c23d6489e0";

const STAFF = [
  {
    id: "alex",
    discordId: "1497037418979786823",
    mc: "Alexrs94",
    telegram: "6644482344",
  },
  {
    id: "melee",
    discordId: "154446475789729792",
    mc: "Melee__",
    telegram: null,
  },
];

export function staffVoteNagEnabled() {
  const v = String(process.env.AVA_STAFF_VOTE_NAG || "1").trim();
  return !(v === "0" || /^false$/i.test(v) || /^off$/i.test(v));
}

/** How often to check (yell still capped once / 24h per person). */
export function staffVoteNagIntervalMs() {
  const n = Number(process.env.AVA_STAFF_VOTE_NAG_MS || 3_600_000);
  return Number.isFinite(n) && n >= 300_000 ? n : 3_600_000;
}

export function staffVoteNagBootDelayMs() {
  const n = Number(process.env.AVA_STAFF_VOTE_NAG_BOOT_MS || 45_000);
  return Number.isFinite(n) && n >= 10_000 ? n : 45_000;
}

function statePath() {
  return path.join(storePaths().dir, "staff-vote-nag.json");
}

function loadState() {
  try {
    if (!fs.existsSync(statePath())) return { lastYellById: {}, lastCheckAt: 0 };
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return { lastYellById: {}, lastCheckAt: 0 };
  }
}

function saveState(s) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), "utf8");
}

function yellBody(displayName) {
  const name = String(displayName || "hey").trim() || "hey";
  return [
    `${name}. 24 hours. zero listing votes from you. that's embarrassing — /vote the sites.`,
    "Go fkn vote",
  ].join("\n");
}

function sanitizeTell(text) {
  return String(text || "")
    .replace(/[\r\n\t]+/g, " · ")
    .replace(/§./g, "")
    .replace(/["`']/g, "'")
    .slice(0, 220)
    .trim();
}

async function lastListingVoteAt(env, uuid) {
  const token = String(
    env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN || "",
  ).trim();
  if (!token || !uuid) return null;
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${D1_ROOTMC}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sql: "SELECT MAX(voted_at) AS last_vote FROM rootmc_listing_votes WHERE lower(minecraft_uuid) = ?",
        params: [String(uuid).toLowerCase()],
      }),
    },
  );
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) {
    throw new Error(data?.errors?.[0]?.message || `d1_${res.status}`);
  }
  const last = data?.result?.[0]?.results?.[0]?.last_vote;
  if (!last) return null;
  const ms = Date.parse(String(last));
  return Number.isFinite(ms) ? ms : null;
}

/** Global listing-vote freshness — if nobody's votes land, don't blame staff. */
async function globalLastListingVoteAt(env) {
  const token = String(
    env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN || "",
  ).trim();
  if (!token) return null;
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${D1_ROOTMC}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sql: "SELECT MAX(voted_at) AS last_vote FROM rootmc_listing_votes",
        params: [],
      }),
    },
  );
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) {
    throw new Error(data?.errors?.[0]?.message || `d1_${res.status}`);
  }
  const last = data?.result?.[0]?.results?.[0]?.last_vote;
  if (!last) return null;
  const ms = Date.parse(String(last));
  return Number.isFinite(ms) ? ms : null;
}

async function resolveUuid(person) {
  const power = await getVotingPower({ discordUserId: person.discordId });
  if (power?.ok && power.minecraft_uuid) return String(power.minecraft_uuid);
  return null;
}

async function tellIfOnline(mcName, body) {
  if (!rconConfigured()) return { tried: false };
  const msg = sanitizeTell(body);
  const name = String(mcName || "").trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(name) || !msg) return { tried: false };
  const results = [];
  for (const dest of rconTargets()) {
    const target = dest.id;
    try {
      const list = await guardedRcon("list", { allow: true, target });
      const out = String(list?.output || "");
      if (!new RegExp(`\\b${name}\\b`, "i").test(out)) {
        results.push({ target, online: false });
        continue;
      }
      const res = await guardedRcon(`tell ${name} ${msg}`, {
        allow: true,
        target,
      });
      results.push({ target, online: true, ok: Boolean(res?.ok) });
    } catch (err) {
      results.push({ target, error: err.message });
    }
  }
  return { tried: true, results };
}

/**
 * @param {{ env?: object, force?: boolean }} [opts]
 */
export async function runStaffVoteNag(opts = {}) {
  if (!staffVoteNagEnabled()) return { ok: true, skipped: "disabled" };
  if (isHushed() || isLockoutActive() || isPoweredOff() || isEmergencyStopped()) {
    return { ok: true, skipped: "quiet" };
  }

  const env = opts.env || (await loadEnv());
  const token = botToken(env);
  if (!token) return { ok: false, reason: "no_discord_token" };
  if (!String(env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN || "").trim()) {
    return { ok: false, reason: "no_cf_token" };
  }

  const state = loadState();
  const now = Date.now();
  const cutoff = now - DAY_MS;
  const fetchJson = makeFetchJson(token);
  const yelled = [];
  const skipped = [];

  // If D1 hasn't seen *any* listing vote recently, ingest is broken — don't yell at staff.
  try {
    const globalLast = await globalLastListingVoteAt(env);
    const staleMs = Number(process.env.AVA_STAFF_VOTE_INGEST_STALE_MS || 2 * DAY_MS);
    if (globalLast == null || now - globalLast > staleMs) {
      const reason =
        globalLast == null
          ? "listing_vote_ingest_empty"
          : `listing_vote_ingest_stale:${new Date(globalLast).toISOString()}`;
      if (!state.ingestAlertAt || now - Number(state.ingestAlertAt) > DAY_MS) {
        pushStatusEvent(
          `staff vote nag paused · ${reason} · fix listing-vote sync before yelling`,
        );
        state.ingestAlertAt = now;
        state.lastCheckAt = now;
        saveState(state);
      }
      return { ok: true, skipped: reason, globalLastVoteAt: globalLast };
    }
  } catch (err) {
    pushStatusEvent(`staff vote nag · d1 global check failed · ${err.message}`);
    return { ok: false, reason: `d1_global_${err.message}` };
  }

  for (const person of STAFF) {
    const lastYell = Number(state.lastYellById?.[person.id] || 0);
    if (!opts.force && lastYell > 0 && now - lastYell < DAY_MS) {
      skipped.push({ id: person.id, reason: "already_yelled_24h" });
      continue;
    }

    let uuid = null;
    try {
      uuid = await resolveUuid(person);
    } catch (err) {
      skipped.push({ id: person.id, reason: `uuid_${err.message}` });
      continue;
    }
    if (!uuid) {
      skipped.push({ id: person.id, reason: "no_uuid" });
      continue;
    }

    let lastVoteMs = null;
    try {
      lastVoteMs = await lastListingVoteAt(env, uuid);
    } catch (err) {
      skipped.push({ id: person.id, reason: `d1_${err.message}` });
      continue;
    }

    if (lastVoteMs != null && lastVoteMs >= cutoff) {
      skipped.push({
        id: person.id,
        reason: "voted_fresh",
        lastVoteAt: new Date(lastVoteMs).toISOString(),
      });
      continue;
    }

    const body = yellBody(person.mc);
    const surfaces = {};

    try {
      const dm = await sendDm(fetchJson, person.discordId, body);
      surfaces.discordDm = dm?.id || true;
    } catch (err) {
      surfaces.discordDm = `fail:${err.message}`;
    }

    if (person.telegram) {
      try {
        await postAvaTelegram({
          chatId: person.telegram,
          content: body,
          kind: "staff_vote_nag",
          source: "staffVoteNag",
          env,
        });
        surfaces.telegram = true;
      } catch (err) {
        surfaces.telegram = `fail:${err.message}`;
      }
    }

    try {
      surfaces.ingame = await tellIfOnline(person.mc, body);
    } catch (err) {
      surfaces.ingame = { error: err.message };
    }

    state.lastYellById = state.lastYellById || {};
    state.lastYellById[person.id] = now;
    yelled.push({
      id: person.id,
      mc: person.mc,
      lastVoteAt: lastVoteMs ? new Date(lastVoteMs).toISOString() : null,
      surfaces,
    });

    recordAvaUtterance({
      surface: "discord",
      channelId: `dm:${person.discordId}`,
      content: body,
      kind: "staff_vote_nag",
      source: "staffVoteNag",
      ok: true,
      user: person.id,
      authorId: person.discordId,
      authorName: person.mc,
      meta: { lastVoteAt: lastVoteMs, surfaces },
    });
  }

  state.lastCheckAt = now;
  saveState(state);
  if (yelled.length) {
    pushStatusEvent(
      `staff vote nag · ${yelled.map((y) => y.id).join(",")} · Go fkn vote`,
    );
  }
  return { ok: true, yelled, skipped };
}

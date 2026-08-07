/**
 * Membership core sync — Root Record ↔ RootMC share Pro/life via Discord link.
 * Grant-only sticky MAX. Never copies Stripe fields. Runs on Ava OptiPlex core.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";
import { pushStatusEvent } from "./store.mjs";

const ROOTMC_D1 = {
  name: "rootmc",
  id: "6cf71128-67e3-47b2-a802-d6c23d6489e0",
  auth: "token",
};
const RR_D1 = {
  name: "root-record",
  id: "0b49c598-1f91-4a09-84a8-6ba8241c6df3",
  auth: "global",
};

function loadEnv(base = process.env) {
  const out = { ...base };
  const p = path.join(storePaths().dir, "..", ".env");
  const alt = "/home/ava-core/ava/.env";
  for (const file of [p, alt]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (out[k] == null || out[k] === "") out[k] = v;
    }
  }
  return out;
}

function headersFor(spec, env) {
  if (spec.auth === "token") {
    return {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "content-type": "application/json",
    };
  }
  return {
    "X-Auth-Email": env.CLOUDFLARE_EMAIL,
    "X-Auth-Key": env.CLOUDFLARE_GLOBAL_API_KEY,
    "content-type": "application/json",
  };
}

async function resolveRrAccountId(env) {
  if (env.ROOTRECORD_CLOUDFLARE_ACCOUNT_ID) {
    return env.ROOTRECORD_CLOUDFLARE_ACCOUNT_ID;
  }
  const res = await fetch(
    "https://api.cloudflare.com/client/v4/accounts?per_page=50",
    { headers: headersFor({ auth: "global" }, env) },
  );
  const json = await res.json();
  if (!json.success) throw new Error(JSON.stringify(json.errors));
  const hit =
    (json.result || []).find((a) => /outlook/i.test(a.name || "")) ||
    (json.result || []).find((a) => /root.?record/i.test(a.name || ""));
  if (!hit?.id) throw new Error("root-record Cloudflare account not found");
  return hit.id;
}

async function d1Query(spec, env, sql, params = []) {
  const account =
    spec.account ||
    (spec.name === "rootmc"
      ? env.ROOTMC_CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID
      : await resolveRrAccountId(env));
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${spec.id}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: headersFor(spec, env),
    body: JSON.stringify({ sql, params }),
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(
      `${spec.name} d1: ${JSON.stringify(json.errors || json).slice(0, 400)}`,
    );
  }
  return json.result?.[0]?.results || json.result?.results || [];
}

function futureIso(iso) {
  if (!iso) return false;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms > Date.now();
}

function entitlement(row) {
  const life = Number(row.life_member || 0) === 1;
  const proCol = Number(row.pro_unlocked || 0) === 1;
  const sub = String(row.subscription_status || "").toLowerCase();
  const subActive = ["active", "trialing", "past_due"].includes(sub);
  const redeemed = futureIso(row.pro_redeemed_until);
  const paid = futureIso(row.pro_paid_until);
  const pro = life || proCol || subActive || redeemed || paid;
  return { life, pro };
}

const LINK_SQL = `
SELECT
  d.discord_user_id AS discord_user_id,
  d.discord_username AS discord_username,
  d.account_id AS account_id,
  d.email AS link_email,
  u.email AS email,
  u.pro_unlocked AS pro_unlocked,
  u.life_member AS life_member,
  u.subscription_status AS subscription_status,
  u.pro_redeemed_until AS pro_redeemed_until,
  u.pro_paid_until AS pro_paid_until,
  u.stripe_customer_id AS stripe_customer_id,
  u.stripe_subscription_id AS stripe_subscription_id
FROM discord_account_links d
LEFT JOIN user_accounts u ON u.account_id = d.account_id OR lower(u.email) = lower(d.email)
WHERE d.discord_user_id IS NOT NULL AND trim(d.discord_user_id) != ''
`;

async function loadSide(spec, env) {
  // pro_paid_until may not exist on RR — select with fallback
  let rows;
  try {
    rows = await d1Query(spec, env, LINK_SQL);
  } catch (err) {
    if (!/pro_paid_until/i.test(String(err.message || err))) throw err;
    const sql = LINK_SQL.replace(
      "u.pro_paid_until AS pro_paid_until,",
      "NULL AS pro_paid_until,",
    );
    rows = await d1Query(spec, env, sql);
  }
  const byDiscord = new Map();
  for (const r of rows) {
    const did = String(r.discord_user_id || "").trim();
    if (!did) continue;
    const email = String(r.email || r.link_email || "").trim();
    if (!email) continue;
    const ent = entitlement(r);
    byDiscord.set(did, {
      discord_user_id: did,
      discord_username: r.discord_username || null,
      account_id: r.account_id,
      email,
      pro_unlocked: Number(r.pro_unlocked || 0),
      life_member: Number(r.life_member || 0),
      subscription_status: r.subscription_status || "none",
      pro_redeemed_until: r.pro_redeemed_until || null,
      pro_paid_until: r.pro_paid_until || null,
      stripe_customer_id: r.stripe_customer_id || null,
      stripe_subscription_id: r.stripe_subscription_id || null,
      life: ent.life,
      pro: ent.pro,
      side: spec.name,
    });
  }
  return byDiscord;
}

async function grantFlags(spec, env, email, { life, pro }) {
  const now = new Date().toISOString();
  // Sticky MAX — never lower, never touch Stripe columns
  await d1Query(
    spec,
    env,
    `UPDATE user_accounts
     SET pro_unlocked = MAX(COALESCE(pro_unlocked, 0), ?),
         life_member = MAX(COALESCE(life_member, 0), ?),
         updated_at = ?
     WHERE lower(email) = lower(?)`,
    [pro ? 1 : 0, life ? 1 : 0, now, email],
  );
}

function logPath() {
  const dir = path.join(storePaths().dir, "membership");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "core-sync.jsonl");
}

function appendLog(row) {
  fs.appendFileSync(logPath(), `${JSON.stringify(row)}\n`, "utf8");
}

/**
 * Sync membership core across Root Record + RootMC for Discord-linked accounts.
 * @param {{ dryRun?: boolean, discordUserId?: string, env?: object }} [opts]
 */
export async function syncMembershipCore(opts = {}) {
  const env = opts.env || loadEnv();
  const dryRun = Boolean(opts.dryRun);
  const onlyDiscord = opts.discordUserId
    ? String(opts.discordUserId).trim()
    : null;

  const rootmcSpec = {
    ...ROOTMC_D1,
    account: env.ROOTMC_CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID,
  };
  const rrSpec = { ...RR_D1 };

  const [rr, rootmc] = await Promise.all([
    loadSide(rrSpec, env),
    loadSide(rootmcSpec, env),
  ]);

  const discordIds = new Set([...rr.keys(), ...rootmc.keys()]);
  const planned = [];
  const applied = [];
  const skipped = [];

  for (const did of discordIds) {
    if (onlyDiscord && did !== onlyDiscord) continue;
    const a = rr.get(did);
    const b = rootmc.get(did);
    if (!a || !b) {
      skipped.push({
        discord_user_id: did,
        reason: !a ? "missing_rr_link" : "missing_rootmc_link",
        have: a ? "rr" : "rootmc",
      });
      continue;
    }

    const wantLife = Boolean(a.life || b.life);
    const wantPro = Boolean(wantLife || a.pro || b.pro);

    const rrNeeds =
      (wantLife && !a.life) || (wantPro && Number(a.pro_unlocked || 0) !== 1);
    const mcNeeds =
      (wantLife && !b.life) || (wantPro && Number(b.pro_unlocked || 0) !== 1);

    if (!rrNeeds && !mcNeeds) {
      skipped.push({
        discord_user_id: did,
        reason: "already_aligned",
        username: a.discord_username || b.discord_username,
      });
      continue;
    }

    const plan = {
      discord_user_id: did,
      username: a.discord_username || b.discord_username,
      wantLife,
      wantPro,
      rr: { email: a.email, life: a.life_member, pro: a.pro_unlocked, needs: rrNeeds },
      rootmc: {
        email: b.email,
        life: b.life_member,
        pro: b.pro_unlocked,
        needs: mcNeeds,
      },
    };
    planned.push(plan);

    if (dryRun) continue;

    if (rrNeeds) {
      await grantFlags(rrSpec, env, a.email, { life: wantLife, pro: wantPro });
      applied.push({ side: "root-record", email: a.email, did, wantLife, wantPro });
    }
    if (mcNeeds) {
      await grantFlags(rootmcSpec, env, b.email, {
        life: wantLife,
        pro: wantPro,
      });
      applied.push({ side: "rootmc", email: b.email, did, wantLife, wantPro });
    }
  }

  const summary = {
    ok: true,
    at: new Date().toISOString(),
    dryRun,
    onlyDiscord,
    rrLinked: rr.size,
    rootmcLinked: rootmc.size,
    planned: planned.length,
    applied: applied.length,
    skipped: skipped.length,
    plans: planned,
    appliedRows: applied,
    skippedSample: skipped.slice(0, 20),
  };

  appendLog({
    type: "membership_core_sync",
    ...summary,
    plans: planned,
    appliedRows: applied,
  });

  if (!dryRun && applied.length) {
    pushStatusEvent(
      `membership core · granted ${applied.length} · ${planned.length} discord`,
    );
  }

  return summary;
}

/** Cron entry — live grant-only reconcile every few minutes on Ava core. */
export async function runMembershipCoreSyncCron({ env, force } = {}) {
  const dry =
    !force && String(process.env.AVA_MEMBERSHIP_SYNC_DRY || "0") === "1";
  try {
    const result = await syncMembershipCore({ env: env || loadEnv(), dryRun: dry });
    return {
      ok: true,
      status: 200,
      json: {
        skipped: false,
        dryRun: dry,
        planned: result.planned,
        applied: result.applied,
        rrLinked: result.rrLinked,
        rootmcLinked: result.rootmcLinked,
      },
    };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      json: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

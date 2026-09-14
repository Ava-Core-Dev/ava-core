/**
 * RootRecord Business Manager — mobile data on primary Worker (D1 `bm_owned_row`).
 * Auth + earn stay shared with Weather; rows are keyed by the same `user:email` as rr_earn_*.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { json } from "./cors";
import { extractAuthToken, sessionFromRequest, type AuthEnv } from "./primary-auth";
import { fetchBillingSnapshot } from "../../shared/billing-state";
import { readUserAccountAccessFlags } from "./accounts";

export type BusinessEnv = AuthEnv;

const BM_ROOTS = new Set([
  "categories",
  "projects",
  "quick-actions",
  "time",
  "money",
  "clients",
  "invoices",
  "products",
  "supplies",
  "schedule",
  "debts",
  "scheduled-expenses",
  "resources",
  "funds",
  "businesses",
  "settings",
  "dashboard",
]);

function nowIso(): string {
  return new Date().toISOString().replace("+00:00", "Z");
}

function newId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * Ensures D1 has `bm_owned_row` (see migrations/0023_bm_owned_row.sql). If a database
 * predates that migration, every business route used to throw until migrations were applied.
 */
let bmOwnedSchemaEnsured = false;
async function ensureBmOwnedTable(db: D1Database): Promise<void> {
  if (bmOwnedSchemaEnsured) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS bm_owned_row (
        user_key TEXT NOT NULL,
        coll TEXT NOT NULL,
        id TEXT NOT NULL,
        doc TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_key, coll, id)
      )`
    )
    .run();
  await db
    .prepare(`CREATE INDEX IF NOT EXISTS bm_owned_row_coll ON bm_owned_row (user_key, coll)`)
    .run();
  bmOwnedSchemaEnsured = true;
}

function partsFromSub(sub: string): string[] {
  return sub.replace(/^\/+/, "").split("/").filter(Boolean);
}

async function requireUserKey(request: Request, env: BusinessEnv): Promise<string | Response> {
  const sess = await sessionFromRequest(env, request);
  if (sess) {
    const email = String(sess.email || "")
      .trim()
      .toLowerCase();
    if (email) return `user:${email}`;
  }
  if (extractAuthToken(request)) {
    return json({ detail: "Invalid or expired session." }, 401);
  }
  return json({ detail: "Missing token" }, 401);
}

async function rowGet(db: D1Database, userKey: string, coll: string, id: string): Promise<Record<string, unknown> | null> {
  const r = await db
    .prepare("SELECT doc FROM bm_owned_row WHERE user_key = ? AND coll = ? AND id = ?")
    .bind(userKey, coll, id)
    .first<{ doc: string }>();
  if (!r?.doc) return null;
  try {
    return JSON.parse(r.doc) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function rowPut(db: D1Database, userKey: string, coll: string, id: string, doc: Record<string, unknown>) {
  const now = nowIso();
  const prev = await rowGet(db, userKey, coll, id);
  const created = (prev?.created_at as string) || now;
  const incoming = { ...doc } as Record<string, unknown>;
  delete incoming.user_key;
  delete incoming.account_id;
  const merged = {
    ...incoming,
    id,
    user_id: userKey,
    user_key: userKey,
    created_at: created,
    updated_at: now,
  };
  const j = JSON.stringify(merged);
  await db
    .prepare(
      `INSERT INTO bm_owned_row (user_key, coll, id, doc, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_key, coll, id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at`
    )
    .bind(userKey, coll, id, j, created, now)
    .run();
  return merged;
}

async function rowDelete(db: D1Database, userKey: string, coll: string, id: string) {
  await db.prepare("DELETE FROM bm_owned_row WHERE user_key = ? AND coll = ? AND id = ?").bind(userKey, coll, id).run();
}

function normQuickActionLabel(label: unknown): string {
  return String(label ?? "").trim().toLowerCase();
}

/** Returns id of another quick_action with the same label, or null. */
function quickActionLabelConflict(
  rows: Record<string, unknown>[],
  labelNorm: string,
  excludeId?: string
): string | null {
  if (!labelNorm) return null;
  for (const r of rows) {
    const id = String(r.id || "");
    if (!id || (excludeId && id === excludeId)) continue;
    if (normQuickActionLabel(r.label) === labelNorm) return id;
  }
  return null;
}

function normCategoryKey(name: unknown, kind: unknown): string {
  const n = String(name ?? "").trim().toLowerCase();
  const k = String(kind ?? "time").trim().toLowerCase() || "time";
  return `${n}\t${k}`;
}

function categoryKeyConflict(rows: Record<string, unknown>[], key: string, excludeId?: string): string | null {
  const namePart = key.split("\t")[0] ?? "";
  if (!namePart) return null;
  for (const r of rows) {
    const id = String(r.id || "");
    if (!id || (excludeId && id === excludeId)) continue;
    if (normCategoryKey(r.name, r.kind) === key) return id;
  }
  return null;
}

function normProjectName(name: unknown): string {
  return String(name ?? "").trim().toLowerCase();
}

/** Returns id of another project with the same name (case-insensitive), or null. */
function projectNameConflict(rows: Record<string, unknown>[], nameNorm: string, excludeId?: string): string | null {
  if (!nameNorm) return null;
  for (const r of rows) {
    const id = String(r.id || "");
    if (!id || (excludeId && id === excludeId)) continue;
    if (normProjectName(r.name) === nameNorm) return id;
  }
  return null;
}

/** Bump when dedupe rules change so existing users are re-scanned. */
const BM_NAME_DEDUPE_V = 1;

function rowDedupeSortTuple(row: Record<string, unknown>): [number, string, string] {
  const so = Number(row.sort_order) || 0;
  const c = String(row.created_at || row.updated_at || "");
  const id = String(row.id || "");
  return [so, c, id];
}

function pickDedupeWinner(group: Record<string, unknown>[]): Record<string, unknown> {
  return group.slice().sort((a, b) => {
    const ka = rowDedupeSortTuple(a);
    const kb = rowDedupeSortTuple(b);
    for (let i = 0; i < 3; i++) {
      if (ka[i] !== kb[i]) return ka[i]! < kb[i]! ? -1 : 1;
    }
    return 0;
  })[0]!;
}

function hasDupes(rows: Record<string, unknown>[], keyFn: (r: Record<string, unknown>) => string | null): boolean {
  const seen = new Set<string>();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

async function maybeDedupeBmNamedEntities(db: D1Database, userKey: string): Promise<void> {
  const settings = await rowGet(db, userKey, "settings", "default");
  if (Number(settings?.name_dedupe_v ?? 0) >= BM_NAME_DEDUPE_V) return;

  const cats = await listColl(db, userKey, "categories", "name");
  const projs = await listColl(db, userKey, "projects", "updated");
  const qas = await listColl(db, userKey, "quick_actions", "updated");

  const catDup = hasDupes(cats, (c) => {
    const k = normCategoryKey(c.name, c.kind);
    return k.split("\t")[0] ? k : null;
  });
  const projDup = hasDupes(projs, (p) => normProjectName(p.name) || null);
  const qaDup = hasDupes(qas, (q) => normQuickActionLabel(q.label) || null);

  if (!catDup && !projDup && !qaDup) {
    const merged = { ...(settings || { user_id: userKey }), name_dedupe_v: BM_NAME_DEDUPE_V };
    await rowPut(db, userKey, "settings", "default", merged);
    return;
  }

  const catRemap = new Map<string, string>();
  const byCatKey = new Map<string, Record<string, unknown>[]>();
  for (const c of cats) {
    const k = normCategoryKey(c.name, c.kind);
    if (!k.split("\t")[0]) continue;
    const arr = byCatKey.get(k) || [];
    arr.push(c);
    byCatKey.set(k, arr);
  }
  for (const [, group] of byCatKey) {
    if (group.length < 2) continue;
    const w = pickDedupeWinner(group);
    const wid = String(w.id || "");
    for (const r of group) {
      const id = String(r.id || "");
      if (id && id !== wid) catRemap.set(id, wid);
    }
  }

  const projRemap = new Map<string, string>();
  const byProjName = new Map<string, Record<string, unknown>[]>();
  for (const p of projs) {
    const n = normProjectName(p.name);
    if (!n) continue;
    const arr = byProjName.get(n) || [];
    arr.push(p);
    byProjName.set(n, arr);
  }
  for (const [, group] of byProjName) {
    if (group.length < 2) continue;
    const w = pickDedupeWinner(group);
    const wid = String(w.id || "");
    for (const r of group) {
      const id = String(r.id || "");
      if (id && id !== wid) projRemap.set(id, wid);
    }
  }

  const qaRemap = new Map<string, string>();
  const byQaLabel = new Map<string, Record<string, unknown>[]>();
  for (const q of qas) {
    const lb = normQuickActionLabel(q.label);
    if (!lb) continue;
    const arr = byQaLabel.get(lb) || [];
    arr.push(q);
    byQaLabel.set(lb, arr);
  }
  for (const [, group] of byQaLabel) {
    if (group.length < 2) continue;
    const w = pickDedupeWinner(group);
    const wid = String(w.id || "");
    for (const r of group) {
      const id = String(r.id || "");
      if (id && id !== wid) qaRemap.set(id, wid);
    }
  }

  const r = await db
    .prepare("SELECT coll, id, doc FROM bm_owned_row WHERE user_key = ?")
    .bind(userKey)
    .all<{ coll: string; id: string; doc: string }>();
  for (const row of r.results || []) {
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(row.doc) as Record<string, unknown>;
    } catch {
      continue;
    }
    let changed = false;
    const cid = doc.category_id != null && doc.category_id !== "" ? String(doc.category_id) : "";
    if (cid && catRemap.has(cid)) {
      doc = { ...doc, category_id: catRemap.get(cid) };
      changed = true;
    }
    const pid = doc.project_id != null && doc.project_id !== "" ? String(doc.project_id) : "";
    if (pid && projRemap.has(pid)) {
      doc = { ...doc, project_id: projRemap.get(pid) };
      changed = true;
    }
    const qid =
      doc.started_via_quick_action_id != null && doc.started_via_quick_action_id !== ""
        ? String(doc.started_via_quick_action_id)
        : "";
    if (qid && qaRemap.has(qid)) {
      doc = { ...doc, started_via_quick_action_id: qaRemap.get(qid) };
      changed = true;
    }
    if (changed) await rowPut(db, userKey, row.coll, row.id, doc);
  }

  for (const oldId of catRemap.keys()) await rowDelete(db, userKey, "categories", oldId);
  for (const oldId of projRemap.keys()) await rowDelete(db, userKey, "projects", oldId);
  for (const oldId of qaRemap.keys()) await rowDelete(db, userKey, "quick_actions", oldId);

  const prevSettings = (await rowGet(db, userKey, "settings", "default")) || { user_id: userKey };
  await rowPut(db, userKey, "settings", "default", { ...prevSettings, name_dedupe_v: BM_NAME_DEDUPE_V });
}

async function listColl(
  db: D1Database,
  userKey: string,
  coll: string,
  sort: "updated" | "name" | "start" = "updated"
): Promise<Record<string, unknown>[]> {
  try {
    const r = await db
      .prepare("SELECT doc FROM bm_owned_row WHERE user_key = ? AND coll = ?")
      .bind(userKey, coll)
      .all<{ doc: string }>();
    const rows = (r.results || [])
      .map((x) => {
        try {
          return JSON.parse(x.doc) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Record<string, unknown>[];
    if (sort === "name") {
      rows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    } else if (sort === "start") {
      rows.sort((a, b) => String(b.start_utc || "").localeCompare(String(a.start_utc || "")));
    } else {
      rows.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
    }
    return rows;
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("listColl", coll, msg);
    return [];
  }
}

/**
 * First-run: one placeholder business + program settings only.
 * Never inserts categories, projects, or quick_actions (empty until a client POSTs them).
 */
async function ensureSeed(db: D1Database, userKey: string) {
  const t = nowIso();

  const bizCount = await db
    .prepare("SELECT COUNT(1) AS c FROM bm_owned_row WHERE user_key = ? AND coll = 'businesses'")
    .bind(userKey)
    .first<{ c: number }>();
  if ((bizCount?.c || 0) === 0) {
    const bizId = newId();
    await rowPut(db, userKey, "businesses", bizId, {
      id: bizId,
      user_id: userKey,
      name: "My Business",
      legal_name: "",
      owner: "",
      tax_id: "",
      email: "",
      phone: "",
      website: "",
      address: "",
      timezone: "system",
      invoice_notes: "",
      is_default: true,
      created_at: t,
      updated_at: t,
    });
  }

  const settingsRow = await rowGet(db, userKey, "settings", "default");
  if (!settingsRow) {
    await rowPut(db, userKey, "settings", "default", {
      user_id: userKey,
      currency_default: "USD",
      theme: "dark",
      prompt_interval_sec: 900,
      prompt_first_delay_sec: 120,
      prompt_response_timeout_sec: 45,
      default_hourly_cents: 0,
      show_money_in_dashboard: true,
      help_bubbles_enabled: true,
      business_timezone: "system",
      active_business_id: null,
      updated_at: t,
    });
  }
}

export async function handleBusinessAuthEntitlement(request: Request, env: BusinessEnv): Promise<Response> {
  const sess = await sessionFromRequest(env, request);
  if (!sess) {
    return json({ detail: extractAuthToken(request) ? "Unauthorized" : "Missing token" }, 401);
  }
  const billing = await fetchBillingSnapshot(env.DB, sess.email);
  const acct = await readUserAccountAccessFlags(env.DB, sess.email);
  const pro = Boolean(billing?.pro_unlocked) || Boolean(acct?.pro_unlocked);
  const life = Boolean(billing?.life_member) || Boolean(acct?.life_member);
  const subscription_status = billing ? billing.subscription_status : "none";
  const plan = pro || life ? "pro" : "free";
  return json(
    {
      ok: true,
      plan,
      access: { tier: pro ? "pro" : "none", reason: pro ? "paid" : "none" },
      reason: pro ? "paid" : "none",
      valid_until: null,
      subscription_status,
    },
    200
  );
}

function invoiceTotals(data: Record<string, unknown>) {
  const raw = data.lines;
  const lines = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  let subtotal = 0;
  for (const line of lines) {
    const q = Number(line.quantity ?? 1) || 1;
    const p = Number(line.unit_price_cents ?? 0) || 0;
    subtotal += Math.floor(q * p);
  }
  const tax = Number(data.tax_cents ?? 0) || 0;
  return { subtotal_cents: subtotal, tax_cents: tax, total_cents: subtotal + tax };
}

/** Wipe all `bm_owned_row` rows for the signed-in user (Business Manager data only). */
export async function bmWipeOwnedRows(request: Request, env: BusinessEnv): Promise<Response> {
  const u = await requireUserKey(request, env);
  if (u instanceof Response) return u;
  const db = env.DB;
  try {
    await ensureBmOwnedTable(db);
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("bm_owned_row DDL", msg);
    return json(
      { detail: "Business data storage is not ready. Try again shortly or contact support." },
      503
    );
  }
  try {
    const r = await db.prepare("DELETE FROM bm_owned_row WHERE user_key = ?").bind(u).run();
    const changes = typeof r.meta?.changes === "number" ? r.meta.changes : undefined;
    return json({ ok: true, deleted_rows: changes }, 200);
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("business wipe", msg);
    return json({ detail: "Could not wipe data. Try again." }, 500);
  }
}

export async function handleBusinessRoutes(
  request: Request,
  env: BusinessEnv,
  sub: string,
  method: string
): Promise<Response | null> {
  const parts = partsFromSub(sub);

  // Weather Manager uses GET /api/dashboard?lat=&lon= for the combined bundle. Business
  // Manager also uses a top-level `dashboard` segment (`/api/dashboard/summary`). Router
  // calls this handler before the Weather branch — without this guard, Weather requests are
  // swallowed by `requireUserKey` (401) or fall through to 404.
  if (method === "GET" && parts.length === 1 && parts[0] === "dashboard") {
    const url = new URL(request.url);
    const latQ = url.searchParams.get("lat");
    const lonQ = url.searchParams.get("lon");
    if (latQ != null && String(latQ).trim() !== "" && lonQ != null && String(lonQ).trim() !== "") {
      return null;
    }
  }

  /** DELETE /api/account/business-data — all Business Manager owned rows for this user only. */
  if (parts.length === 2 && parts[0] === "account" && parts[1] === "business-data" && method === "DELETE") {
    return bmWipeOwnedRows(request, env);
  }

  if (!parts.length) return null;
  if (!BM_ROOTS.has(parts[0]!) && parts[0] !== "money") return null;
  if (parts[0] === "money" && parts.length > 1 && !["income", "expenses"].includes(parts[1]!)) return null;

  const u = await requireUserKey(request, env);
  if (u instanceof Response) return u;
  const userKey = u;
  const db = env.DB;

  try {
    await ensureBmOwnedTable(db);
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("bm_owned_row DDL", msg);
    return json(
      { detail: "Business data storage is not ready. Try again shortly or contact support." },
      503
    );
  }

  try {
    await ensureSeed(db, userKey);
  } catch (e) {
    console.error("bm seed", e);
  }

  try {
    await maybeDedupeBmNamedEntities(db, userKey);
  } catch (e) {
    console.error("bm name dedupe", e);
  }

  try {
    // ---- categories
    if (parts[0] === "categories") {
      if (method === "GET" && parts.length === 1) {
        return json(await listColl(db, userKey, "categories", "name"), 200);
      }
      if (method === "POST" && parts.length === 1) {
        const body = (await request.json()) as Record<string, unknown>;
        const key = normCategoryKey(body.name, body.kind);
        if (!key.split("\t")[0]) return json({ detail: "Name is required." }, 400);
        const cats = await listColl(db, userKey, "categories", "name");
        if (categoryKeyConflict(cats, key)) {
          return json({ detail: "You already have a category with that name and type." }, 409);
        }
        const id = newId();
        const doc = await rowPut(db, userKey, "categories", id, {
          ...body,
          id,
          user_id: userKey,
          created_at: nowIso(),
          updated_at: nowIso(),
        });
        return json(doc, 200);
      }
      if (method === "PATCH" && parts.length === 2) {
        const prev = await rowGet(db, userKey, "categories", parts[1]!);
        if (!prev) return json({ detail: "categories not found" }, 404);
        const body = (await request.json()) as Record<string, unknown>;
        const merged = { ...prev, ...body, id: parts[1] } as Record<string, unknown>;
        const key = normCategoryKey(merged["name"], merged["kind"]);
        if (!key.split("\t")[0]) return json({ detail: "Name is required." }, 400);
        const cats = await listColl(db, userKey, "categories", "name");
        if (categoryKeyConflict(cats, key, parts[1])) {
          return json({ detail: "You already have a category with that name and type." }, 409);
        }
        const doc = await rowPut(db, userKey, "categories", parts[1]!, merged);
        return json(doc, 200);
      }
      if (method === "DELETE" && parts.length === 2) {
        await rowDelete(db, userKey, "categories", parts[1]!);
        return json({ ok: true }, 200);
      }
    }

    // ---- projects
    if (parts[0] === "projects") {
      if (method === "GET" && parts.length === 1) return json(await listColl(db, userKey, "projects"), 200);
      if (method === "POST" && parts.length === 1) {
        const body = (await request.json()) as Record<string, unknown>;
        const nameNorm = normProjectName(body.name);
        if (!nameNorm) return json({ detail: "Name is required." }, 400);
        const existing = await listColl(db, userKey, "projects", "updated");
        if (projectNameConflict(existing, nameNorm)) {
          return json({ detail: "You already have a project with that name." }, 409);
        }
        const id = newId();
        return json(await rowPut(db, userKey, "projects", id, { ...body, id, user_id: userKey }), 200);
      }
      if (method === "DELETE" && parts.length === 2) {
        await rowDelete(db, userKey, "projects", parts[1]!);
        return json({ ok: true }, 200);
      }
    }

    // ---- quick actions
    if (parts[0] === "quick-actions") {
      if (method === "GET" && parts.length === 1) {
        const rows = await listColl(db, userKey, "quick_actions", "updated");
        rows.sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
        return json(rows, 200);
      }
      if (method === "POST" && parts.length === 1) {
        const body = (await request.json()) as Record<string, unknown>;
        const labelNorm = normQuickActionLabel(body.label);
        if (!labelNorm) return json({ detail: "Label is required." }, 400);
        const qas = await listColl(db, userKey, "quick_actions", "updated");
        if (quickActionLabelConflict(qas, labelNorm)) {
          return json({ detail: "You already have a quick action with that name." }, 409);
        }
        const id = newId();
        return json(await rowPut(db, userKey, "quick_actions", id, { ...body, id, user_id: userKey }), 200);
      }
      if (method === "PATCH" && parts.length === 2) {
        const prev = await rowGet(db, userKey, "quick_actions", parts[1]!);
        if (!prev) return json({ detail: "not found" }, 404);
        const body = (await request.json()) as Record<string, unknown>;
        const merged = { ...prev, ...body, id: parts[1] } as Record<string, unknown>;
        const labelNorm = normQuickActionLabel(merged["label"]);
        if (!labelNorm) return json({ detail: "Label is required." }, 400);
        const qas = await listColl(db, userKey, "quick_actions", "updated");
        if (quickActionLabelConflict(qas, labelNorm, parts[1])) {
          return json({ detail: "You already have a quick action with that name." }, 409);
        }
        return json(await rowPut(db, userKey, "quick_actions", parts[1]!, merged), 200);
      }
      if (method === "DELETE" && parts.length === 2) {
        await rowDelete(db, userKey, "quick_actions", parts[1]!);
        return json({ ok: true }, 200);
      }
      if (method === "POST" && parts.length === 3 && parts[2] === "run") {
        const qa = await rowGet(db, userKey, "quick_actions", parts[1]!);
        if (!qa) return json({ detail: "Quick action not found" }, 404);
        const active = await rowGet(db, userKey, "active_session", "_");
        if (active?.active) return json({ detail: "Already clocked in" }, 409);
        const t = nowIso();
        const s = {
          user_id: userKey,
          active: true,
          category_id: qa.category_id ?? null,
          project_id: qa.project_id ?? null,
          description: String(qa.default_description || ""),
          started_at_utc: t,
          started_via_quick_action_id: qa.id,
        };
        await rowPut(db, userKey, "active_session", "_", s as unknown as Record<string, unknown>);
        return json(s, 200);
      }
    }

    // ---- time
    if (parts[0] === "time") {
      if (method === "GET" && parts[1] === "session") {
        const s = await rowGet(db, userKey, "active_session", "_");
        return json(s && s.active ? s : { active: false }, 200);
      }
      if (method === "POST" && parts[1] === "clock-in") {
        const active = await rowGet(db, userKey, "active_session", "_");
        if (active?.active) return json({ detail: "Already clocked in" }, 409);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const t = nowIso();
        const s = {
          user_id: userKey,
          active: true,
          category_id: body.category_id ?? null,
          project_id: body.project_id ?? null,
          description: String(body.description || ""),
          started_at_utc: t,
        };
        await rowPut(db, userKey, "active_session", "_", s as Record<string, unknown>);
        return json(s, 200);
      }
      if (method === "POST" && parts[1] === "clock-out") {
        const s = await rowGet(db, userKey, "active_session", "_");
        if (!s?.active) return json({ detail: "No active session" }, 404);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const end = nowIso();
        const entry = {
          id: newId(),
          user_id: userKey,
          start_utc: s.started_at_utc,
          end_utc: end,
          category_id: s.category_id ?? null,
          project_id: s.project_id ?? null,
          description: String(body.description || s.description || ""),
          source: "clock",
          created_at: end,
          updated_at: end,
        };
        await rowPut(db, userKey, "time_entries", entry.id, entry);
        await rowDelete(db, userKey, "active_session", "_");
        return json(entry, 200);
      }
      if (method === "POST" && parts[1] === "manual") {
        const body = (await request.json()) as Record<string, unknown>;
        const id = newId();
        const doc = {
          ...body,
          id,
          user_id: userKey,
          source: "manual",
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        return json(await rowPut(db, userKey, "time_entries", id, doc), 200);
      }
      if (method === "GET" && parts[1] === "entries") {
        const url = new URL(request.url);
        const start = url.searchParams.get("start") || "";
        const end = url.searchParams.get("end") || "";
        const qf = (url.searchParams.get("q") || "").toLowerCase();
        const cat = url.searchParams.get("category_id") || "";
        let rows = await listColl(db, userKey, "time_entries", "start");
        if (start) rows = rows.filter((r) => String(r.start_utc || "") >= start);
        if (end) rows = rows.filter((r) => String(r.start_utc || "") <= end);
        if (cat) rows = rows.filter((r) => String(r.category_id || "") === cat);
        if (qf) rows = rows.filter((r) => String(r.description || "").toLowerCase().includes(qf));
        return json(rows.slice(0, 500), 200);
      }
      if (method === "DELETE" && parts[1] === "entries" && parts[2]) {
        await rowDelete(db, userKey, "time_entries", parts[2]!);
        return json({ ok: true }, 200);
      }
      if (method === "PATCH" && parts[1] === "entries" && parts[2]) {
        const prev = await rowGet(db, userKey, "time_entries", parts[2]!);
        if (!prev) return json({ detail: "not found" }, 404);
        const body = (await request.json()) as Record<string, unknown>;
        return json(await rowPut(db, userKey, "time_entries", parts[2]!, { ...prev, ...body, id: parts[2] }), 200);
      }
    }

    // ---- money
    if (parts[0] === "money" && parts[1] === "income") {
      const coll = "income_entries";
      if (method === "GET" && parts.length === 2) return json(await listColl(db, userKey, coll), 200);
      if (method === "POST" && parts.length === 2) {
        const body = (await request.json()) as Record<string, unknown>;
        if (!body.received_at_utc) body.received_at_utc = nowIso();
        const id = newId();
        return json(await rowPut(db, userKey, coll, id, { ...body, id, user_id: userKey }), 200);
      }
      if (method === "DELETE" && parts.length === 3) {
        await rowDelete(db, userKey, coll, parts[2]!);
        return json({ ok: true }, 200);
      }
    }
    if (parts[0] === "money" && parts[1] === "expenses") {
      const coll = "expense_entries";
      if (method === "GET" && parts.length === 2) return json(await listColl(db, userKey, coll), 200);
      if (method === "POST" && parts.length === 2) {
        const body = (await request.json()) as Record<string, unknown>;
        if (!body.spent_at_utc) body.spent_at_utc = nowIso();
        const id = newId();
        return json(await rowPut(db, userKey, coll, id, { ...body, id, user_id: userKey }), 200);
      }
      if (method === "DELETE" && parts.length === 3) {
        await rowDelete(db, userKey, coll, parts[2]!);
        return json({ ok: true }, 200);
      }
    }

    // ---- generic owned: clients, invoices, products, supplies, schedule_events, debts, scheduled_expenses, resources, funds, businesses
    const genericMap: Record<string, string> = {
      clients: "clients",
      invoices: "invoices",
      products: "products",
      supplies: "supplies",
      schedule: "schedule_events",
      debts: "debts",
      "scheduled-expenses": "scheduled_expenses",
      resources: "resources",
      funds: "funds",
      businesses: "businesses",
    };
    const g0 = parts[0]!;
    if (genericMap[g0]) {
      const coll = genericMap[g0]!;
      if (method === "GET" && parts.length === 1) return json(await listColl(db, userKey, coll), 200);
      if (method === "POST" && parts.length === 1) {
        const body = (await request.json()) as Record<string, unknown>;
        const id = newId();
        if (coll === "invoices") {
          const t = invoiceTotals({ ...body, lines: body.lines || [] });
          Object.assign(body, t);
          if (!body.issued_at_utc) body.issued_at_utc = nowIso();
        }
        return json(await rowPut(db, userKey, coll, id, { ...body, id, user_id: userKey }), 200);
      }
      if (method === "PATCH" && parts.length === 2) {
        const prev = await rowGet(db, userKey, coll, parts[1]!);
        if (!prev) return json({ detail: "not found" }, 404);
        const body = (await request.json()) as Record<string, unknown>;
        const next = { ...prev, ...body, id: parts[1] };
        if (coll === "invoices") Object.assign(next, invoiceTotals(next));
        return json(await rowPut(db, userKey, coll, parts[1]!, next), 200);
      }
      if (method === "DELETE" && parts.length === 2) {
        await rowDelete(db, userKey, coll, parts[1]!);
        return json({ ok: true }, 200);
      }
    }

    // ---- settings singleton
    if (parts[0] === "settings") {
      if (method === "GET" && parts.length === 1) {
        const s = await rowGet(db, userKey, "settings", "default");
        return json(s || {}, 200);
      }
      if (method === "PATCH" && parts.length === 1) {
        const prev = (await rowGet(db, userKey, "settings", "default")) || { user_id: userKey };
        const body = (await request.json()) as Record<string, unknown>;
        return json(await rowPut(db, userKey, "settings", "default", { ...prev, ...body }), 200);
      }
    }

    // ---- dashboard summary
    if (parts[0] === "dashboard" && parts[1] === "summary" && method === "GET") {
      const url = new URL(request.url);
      const start =
        url.searchParams.get("start") ||
        new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1, 0, 0, 0)).toISOString().replace("+00:00", "Z");
      const end = url.searchParams.get("end") || nowIso();
      const entries = await listColl(db, userKey, "time_entries", "start");
      const cats = await listColl(db, userKey, "categories", "name");
      const catMap = new Map(cats.map((c) => [String(c.id), c]));
      const byCat: Record<string, number> = {};
      let totalSeconds = 0;
      for (const e of entries) {
        if (String(e.start_utc || "") < start || String(e.start_utc || "") > end) continue;
        const s = Date.parse(String(e.start_utc));
        const f = Date.parse(String(e.end_utc));
        if (!Number.isFinite(s) || !Number.isFinite(f)) continue;
        const secs = Math.max(0, Math.floor((f - s) / 1000));
        if (!Number.isFinite(secs)) continue;
        totalSeconds += secs;
        const key = String(e.category_id || "uncategorized");
        byCat[key] = (byCat[key] || 0) + secs;
      }
      if (!Number.isFinite(totalSeconds)) totalSeconds = 0;
      const breakdown = Object.entries(byCat).map(([cid, secs]) => {
        const c = catMap.get(cid);
        return {
          category_id: cid,
          name: c ? String(c.name) : "Uncategorized",
          color: c ? String(c.color) : "#687777",
          hours: Math.round((secs / 3600) * 100) / 100,
        };
      });
      breakdown.sort((a, b) => b.hours - a.hours);
      let incTotal = 0;
      for (const d of await listColl(db, userKey, "income_entries")) {
        if (String(d.received_at_utc || "") >= start && String(d.received_at_utc || "") <= end) {
          const add = Math.floor(Number(d.amount_cents) || 0);
          if (Number.isFinite(add)) incTotal += add;
        }
      }
      let expTotal = 0;
      for (const d of await listColl(db, userKey, "expense_entries")) {
        if (String(d.spent_at_utc || "") >= start && String(d.spent_at_utc || "") <= end) {
          const add = Math.floor(Number(d.amount_cents) || 0);
          if (Number.isFinite(add)) expTotal += add;
        }
      }
      const hoursOut = Math.round((totalSeconds / 3600) * 100) / 100;
      return json(
        {
          start,
          end,
          hours: Number.isFinite(hoursOut) ? hoursOut : 0,
          income_cents: incTotal,
          expense_cents: expTotal,
          net_cents: incTotal - expTotal,
          breakdown,
        },
        200
      );
    }

    return json({ detail: "Not Found" }, 404);
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    const stack = e instanceof Error ? e.stack || "" : "";
    console.error("business-mobile", msg, stack);
    return json({ detail: "Server error" }, 500);
  }
}

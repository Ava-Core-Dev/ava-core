/**
 * Website Hosting API (scaffold).
 * Auth: license_accounts sessions via sessionFromRequest (same as Visiting Hawaiʻi).
 * Stripe live keys are optional — create starts a local trial; checkout wires later.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { json } from "./cors";
import { sessionFromRequest, extractAuthToken, type AuthEnv } from "./primary-auth";

export type SitesEnv = AuthEnv & {
  DB: D1Database;
  SITE_URL?: string;
  /** Recurring Price id for Website Hosting ($10/mo). Optional for scaffold. */
  STRIPE_WEBSITE_HOSTING_PRICE_ID?: string;
  STRIPE_SECRET_KEY?: string;
};

type SiteRow = {
  id: string;
  account_id: string;
  slug: string | null;
  title: string;
  custom_domain: string | null;
  nameserver_status: string;
  trial_ends_at: string | null;
  subscription_status: string;
  stripe_subscription_id: string | null;
  config_json: string;
  created_at: string;
  updated_at: string;
};

type InvoiceRow = {
  id: string;
  site_id: string;
  amount_cents: number;
  due_at: string;
  paid_at: string | null;
  stripe_invoice_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

const TRIAL_DAYS = 14;
const MONTHLY_CENTS = 1000;
const CF_NS_PLACEHOLDERS = ["ns1.cloudflare.com", "ns2.cloudflare.com"] as const;

function clampText(raw: unknown, max: number): string {
  return String(raw ?? "")
    .trim()
    .slice(0, max);
}

function parseConfig(raw: string | null | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function siteAccessActive(row: SiteRow, now = new Date()): boolean {
  const status = String(row.subscription_status || "").toLowerCase();
  if (status === "active") return true;
  if (status === "trialing") {
    if (!row.trial_ends_at) return true;
    const ends = Date.parse(row.trial_ends_at);
    return Number.isFinite(ends) ? ends > now.getTime() : true;
  }
  return false;
}

function publicPathFor(row: SiteRow, siteUrl: string): string {
  const base = (siteUrl || "https://rootrecord.info").replace(/\/+$/, "");
  return `${base}/sites/${encodeURIComponent(row.id)}`;
}

function rowToOwner(row: SiteRow, siteUrl: string) {
  const active = siteAccessActive(row);
  return {
    id: row.id,
    accountId: row.account_id,
    slug: row.slug,
    title: row.title,
    customDomain: row.custom_domain,
    nameserverStatus: row.nameserver_status,
    nameservers: CF_NS_PLACEHOLDERS,
    trialEndsAt: row.trial_ends_at,
    subscriptionStatus: row.subscription_status,
    stripeSubscriptionId: row.stripe_subscription_id,
    config: parseConfig(row.config_json),
    accessActive: active,
    paywall: !active,
    publicUrl: publicPathFor(row, siteUrl),
    altPublicUrl: `${(siteUrl || "https://rootrecord.info").replace(/\/+$/, "")}/${encodeURIComponent(row.id)}`,
    monthlyPriceCents: MONTHLY_CENTS,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPublic(row: SiteRow) {
  const active = siteAccessActive(row);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title || "Untitled site",
    customDomain: row.custom_domain,
    config: parseConfig(row.config_json),
    subscriptionStatus: row.subscription_status,
    trialEndsAt: row.trial_ends_at,
    paywall: !active,
    accessActive: active,
  };
}

async function getSiteById(db: D1Database, id: string): Promise<SiteRow | null> {
  return db.prepare("SELECT * FROM rr_sites WHERE id = ?").bind(id).first<SiteRow>();
}

async function getSiteForAccount(db: D1Database, accountId: string): Promise<SiteRow | null> {
  return db
    .prepare("SELECT * FROM rr_sites WHERE account_id = ? LIMIT 1")
    .bind(accountId)
    .first<SiteRow>();
}

async function openInvoiceIfNeeded(db: D1Database, site: SiteRow): Promise<InvoiceRow | null> {
  if (siteAccessActive(site)) return null;
  const existing = await db
    .prepare(
      `SELECT * FROM rr_site_invoices
       WHERE site_id = ? AND status IN ('open', 'past_due')
       ORDER BY due_at DESC LIMIT 1`,
    )
    .bind(site.id)
    .first<InvoiceRow>();
  if (existing) return existing;

  const now = new Date();
  const id = crypto.randomUUID();
  const due = now.toISOString();
  const created = due;
  await db
    .prepare(
      `INSERT INTO rr_site_invoices (
        id, site_id, amount_cents, due_at, paid_at, stripe_invoice_id, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, 'open', ?, ?)`,
    )
    .bind(id, site.id, MONTHLY_CENTS, due, created, created)
    .run();

  return {
    id,
    site_id: site.id,
    amount_cents: MONTHLY_CENTS,
    due_at: due,
    paid_at: null,
    stripe_invoice_id: null,
    status: "open",
    created_at: created,
    updated_at: created,
  };
}

async function requireSession(
  request: Request,
  env: SitesEnv,
): Promise<{ accountId: string; email: string } | Response> {
  const sess = await sessionFromRequest(env, request);
  if (!sess) {
    const detail = extractAuthToken(request) ? "Sign in required." : "Sign in required.";
    return json({ detail }, 401);
  }
  return sess;
}

async function handleCreate(request: Request, env: SitesEnv, sess: { accountId: string }): Promise<Response> {
  const existing = await getSiteForAccount(env.DB, sess.accountId);
  if (existing) {
    return json({ detail: "This account already has a site.", site: rowToOwner(existing, env.SITE_URL || "") }, 409);
  }

  let body: { title?: string; slug?: string; config?: Record<string, unknown> } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const title = clampText(body.title, 120) || "My site";
  let slug = clampText(body.slug, 64)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length < 2) slug = "";

  const config =
    body.config && typeof body.config === "object" && !Array.isArray(body.config)
      ? body.config
      : { theme: "default", pages: [{ path: "/", title: "Home", body: "" }] };

  const now = new Date();
  const trialEnds = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const id = crypto.randomUUID();
  const created = now.toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO rr_sites (
        id, account_id, slug, title, custom_domain, nameserver_status,
        trial_ends_at, subscription_status, stripe_subscription_id, config_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, 'none', ?, 'trialing', NULL, ?, ?, ?)`,
    )
      .bind(
        id,
        sess.accountId,
        slug || null,
        title,
        trialEnds.toISOString(),
        JSON.stringify(config),
        created,
        created,
      )
      .run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/UNIQUE|unique/i.test(msg)) {
      return json({ detail: "Slug already taken. Choose another." }, 409);
    }
    return json({ detail: "Could not create site (migration may be pending).", error: msg }, 503);
  }

  const row = await getSiteById(env.DB, id);
  if (!row) return json({ detail: "Created but failed to load site." }, 500);
  return json(
    {
      site: rowToOwner(row, env.SITE_URL || ""),
      trialDays: TRIAL_DAYS,
      note: "Trial started. Stripe subscription attaches after onboarding (see README-website-hosting.md).",
    },
    201,
  );
}

async function handleMe(env: SitesEnv, sess: { accountId: string }): Promise<Response> {
  const row = await getSiteForAccount(env.DB, sess.accountId);
  let invoice: InvoiceRow | null = null;
  if (row && !siteAccessActive(row)) {
    try {
      invoice = await openInvoiceIfNeeded(env.DB, row);
    } catch {
      invoice = null;
    }
  }
  return json(
    {
      site: row ? rowToOwner(row, env.SITE_URL || "") : null,
      invoice: invoice
        ? {
            id: invoice.id,
            amountCents: invoice.amount_cents,
            dueAt: invoice.due_at,
            paidAt: invoice.paid_at,
            status: invoice.status,
            stripeInvoiceId: invoice.stripe_invoice_id,
          }
        : null,
      priceCents: MONTHLY_CENTS,
      trialDays: TRIAL_DAYS,
      stripePriceConfigured: Boolean(
        (env.STRIPE_WEBSITE_HOSTING_PRICE_ID || "").trim().startsWith("price_"),
      ),
    },
    200,
  );
}

async function handlePatch(
  request: Request,
  env: SitesEnv,
  sess: { accountId: string },
  siteId: string,
): Promise<Response> {
  const row = await getSiteById(env.DB, siteId);
  if (!row || row.account_id !== sess.accountId) return json({ detail: "Site not found." }, 404);

  let body: { title?: string; slug?: string; config?: Record<string, unknown> } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON." }, 400);
  }

  const title = body.title != null ? clampText(body.title, 120) || row.title : row.title;
  let slug = row.slug;
  if (body.slug != null) {
    const next = clampText(body.slug, 64)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    slug = next.length >= 2 ? next : null;
  }
  let configJson = row.config_json;
  if (body.config && typeof body.config === "object" && !Array.isArray(body.config)) {
    configJson = JSON.stringify({ ...parseConfig(row.config_json), ...body.config });
  }
  const now = new Date().toISOString();

  try {
    await env.DB.prepare(
      `UPDATE rr_sites SET title = ?, slug = ?, config_json = ?, updated_at = ? WHERE id = ? AND account_id = ?`,
    )
      .bind(title, slug, configJson, now, siteId, sess.accountId)
      .run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/UNIQUE|unique/i.test(msg)) return json({ detail: "Slug already taken." }, 409);
    return json({ detail: "Update failed.", error: msg }, 500);
  }

  const updated = await getSiteById(env.DB, siteId);
  return json({ site: updated ? rowToOwner(updated, env.SITE_URL || "") : null }, 200);
}

async function handleDomainPost(
  request: Request,
  env: SitesEnv,
  sess: { accountId: string },
  siteId: string,
): Promise<Response> {
  const row = await getSiteById(env.DB, siteId);
  if (!row || row.account_id !== sess.accountId) return json({ detail: "Site not found." }, 404);

  let body: { domain?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON." }, 400);
  }

  const domain = clampText(body.domain, 253)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  if (!domain || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    return json({ detail: "Enter a valid domain (e.g. alexrs94.site)." }, 400);
  }

  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `UPDATE rr_sites SET custom_domain = ?, nameserver_status = 'pending', updated_at = ?
       WHERE id = ? AND account_id = ?`,
    )
      .bind(domain, now, siteId, sess.accountId)
      .run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/UNIQUE|unique/i.test(msg)) {
      return json({ detail: "That domain is already linked to another site." }, 409);
    }
    return json({ detail: "Could not save domain.", error: msg }, 500);
  }

  const updated = await getSiteById(env.DB, siteId);
  return json(
    {
      site: updated ? rowToOwner(updated, env.SITE_URL || "") : null,
      nameservers: CF_NS_PLACEHOLDERS,
      instructions:
        "Point your domain’s nameservers to Cloudflare (shown above). Until DNS is live, use rootrecord.info/sites/<id>.",
    },
    200,
  );
}

async function handlePublicGet(env: SitesEnv, siteId: string): Promise<Response> {
  const id = clampText(siteId, 64);
  if (!id) return json({ detail: "Missing site id." }, 400);

  let row: SiteRow | null = null;
  try {
    row = await getSiteById(env.DB, id);
    if (!row) {
      row = await env.DB.prepare("SELECT * FROM rr_sites WHERE slug = ? LIMIT 1").bind(id).first<SiteRow>();
    }
  } catch {
    return json({ detail: "Sites table unavailable (run migration 0140).", paywall: true }, 503);
  }

  if (!row) return json({ detail: "Site not found.", paywall: true }, 404);

  let invoice: InvoiceRow | null = null;
  if (!siteAccessActive(row)) {
    try {
      invoice = await openInvoiceIfNeeded(env.DB, row);
    } catch {
      /* ignore */
    }
  }

  return json(
    {
      ...rowToPublic(row),
      invoice: invoice
        ? {
            amountCents: invoice.amount_cents,
            dueAt: invoice.due_at,
            status: invoice.status,
          }
        : null,
    },
    200,
  );
}

/** Non-/api path: GET /public/sites/:id */
export async function handlePublicSitesPath(
  request: Request,
  env: SitesEnv,
  pathname: string,
  method: string,
): Promise<Response | null> {
  const m = pathname.match(/^\/public\/sites\/([^/]+)$/);
  if (!m) return null;
  if (method !== "GET") return json({ detail: "Method not allowed." }, 405);
  return handlePublicGet(env, decodeURIComponent(m[1]));
}

/** /api subpaths: /sites, /sites/me, /sites/:id, /sites/:id/domain, /public/sites/:id */
export async function handleSitesRoutes(
  request: Request,
  env: SitesEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  const path = sub.replace(/\/+$/, "") || sub;

  if (method === "GET" && path.startsWith("/public/sites/")) {
    const id = path.slice("/public/sites/".length).split("/")[0] || "";
    return handlePublicGet(env, decodeURIComponent(id));
  }

  if (!path.startsWith("/sites")) return null;

  if (method === "POST" && path === "/sites") {
    const sess = await requireSession(request, env);
    if (sess instanceof Response) return sess;
    return handleCreate(request, env, sess);
  }

  if (method === "GET" && path === "/sites/me") {
    const sess = await requireSession(request, env);
    if (sess instanceof Response) return sess;
    return handleMe(env, sess);
  }

  const patchMatch = path.match(/^\/sites\/([^/]+)$/);
  if (method === "PATCH" && patchMatch) {
    const sess = await requireSession(request, env);
    if (sess instanceof Response) return sess;
    return handlePatch(request, env, sess, decodeURIComponent(patchMatch[1]));
  }

  const domainMatch = path.match(/^\/sites\/([^/]+)\/domain$/);
  if (method === "POST" && domainMatch) {
    const sess = await requireSession(request, env);
    if (sess instanceof Response) return sess;
    return handleDomainPost(request, env, sess, decodeURIComponent(domainMatch[1]));
  }

  if (path.startsWith("/sites")) {
    return json({ detail: "Not found." }, 404);
  }
  return null;
}

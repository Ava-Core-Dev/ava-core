import { json } from "./cors";
import { sessionFromRequest, extractAuthToken, type AuthEnv } from "./primary-auth";
import { createVisitingHawaiiSponsoredCheckout, visitingHawaiiSponsoredCheckoutAvailable } from "./billing-stripe";
import {
  VISITING_HAWAII_CATEGORY_IDS,
  VISITING_HAWAII_COST_RANGES,
  VISITING_HAWAII_ISLAND_IDS,
  clampText,
  isEmailLike,
  isHttpsUrl,
  parseSubFilters,
  rotateSponsoredListings,
  rowToPublic,
  type SponsoredListingRow,
} from "../../shared/visiting-hawaii-sponsored";

export type VisitingHawaiiSponsoredEnv = AuthEnv & {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
  STRIPE_VISITING_HAWAII_SPONSORED_PRICE_ID?: string;
  SITE_URL?: string;
};

type ApplicationBody = {
  strict?: boolean;
  id?: string;
  businessName?: string;
  contactEmail?: string;
  contactPhone?: string;
  websiteUrl?: string;
  islandId?: string;
  categoryId?: string;
  subFilters?: unknown;
  title?: string;
  shortDescription?: string;
  description?: string;
  imageUrl?: string;
  lat?: unknown;
  lng?: unknown;
  addressLine?: string;
  costRange?: string;
  ctaLabel?: string;
  ctaUrl?: string;
};

function newListingId(): string {
  return `vhsl_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function parseCoord(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

function validateIsland(id: string): string | null {
  return (VISITING_HAWAII_ISLAND_IDS as readonly string[]).includes(id) ? id : null;
}

function validateCategory(id: string): string | null {
  return (VISITING_HAWAII_CATEGORY_IDS as readonly string[]).includes(id) ? id : null;
}

function validateCostRange(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  return (VISITING_HAWAII_COST_RANGES as readonly string[]).includes(v) ? v : null;
}

function applicationFromBody(body: ApplicationBody) {
  return {
    businessName: clampText(body.businessName, 180),
    contactEmail: clampText(body.contactEmail, 200).toLowerCase(),
    contactPhone: clampText(body.contactPhone, 60),
    websiteUrl: clampText(body.websiteUrl, 400),
    islandId: clampText(body.islandId, 40),
    categoryId: clampText(body.categoryId, 40),
    subFilters: parseSubFilters(body.subFilters),
    title: clampText(body.title, 160),
    shortDescription: clampText(body.shortDescription, 320),
    description: clampText(body.description, 8000),
    imageUrl: clampText(body.imageUrl, 600),
    lat: parseCoord(body.lat),
    lng: parseCoord(body.lng),
    addressLine: clampText(body.addressLine, 240),
    costRange: clampText(body.costRange, 8),
    ctaLabel: clampText(body.ctaLabel, 80),
    ctaUrl: clampText(body.ctaUrl, 400),
  };
}

function validateForSave(app: ReturnType<typeof applicationFromBody>, strict: boolean): string | null {
  if (app.contactEmail && !isEmailLike(app.contactEmail)) return "Contact email looks invalid.";
  if (app.islandId && !validateIsland(app.islandId)) return "Select a valid island.";
  if (app.categoryId && !validateCategory(app.categoryId)) return "Select a valid category.";
  if (app.imageUrl && !isHttpsUrl(app.imageUrl)) return "Image URL must be a valid https:// link.";
  if (app.websiteUrl && !isHttpsUrl(app.websiteUrl)) return "Website must be a valid https:// URL.";
  if (app.ctaUrl && !isHttpsUrl(app.ctaUrl)) return "CTA URL must be a valid https:// URL.";
  if (app.costRange && !validateCostRange(app.costRange)) return "Invalid cost range.";
  if (!strict) return null;
  if (!app.businessName) return "Business name is required.";
  if (!app.contactEmail || !isEmailLike(app.contactEmail)) return "A valid contact email is required.";
  if (!validateIsland(app.islandId)) return "Select a valid island.";
  if (!validateCategory(app.categoryId)) return "Select a valid category.";
  if (!app.title) return "Listing title is required.";
  if (!app.shortDescription) return "Short description is required.";
  if (!app.description) return "Full description is required.";
  if (!app.imageUrl || !isHttpsUrl(app.imageUrl)) return "Image URL must be a valid https:// link.";
  return null;
}

async function getListingForAccount(db: D1Database, id: string, accountId: string): Promise<SponsoredListingRow | null> {
  return db
    .prepare("SELECT * FROM visiting_hawaii_sponsored_listings WHERE id = ? AND account_id = ?")
    .bind(id, accountId)
    .first<SponsoredListingRow>();
}

async function handlePublicList(request: Request, env: VisitingHawaiiSponsoredEnv): Promise<Response> {
  const url = new URL(request.url);
  const islandId = validateIsland(clampText(url.searchParams.get("island"), 40) || "");
  const categoryId = validateCategory(clampText(url.searchParams.get("category"), 40) || "");
  const limit = Math.min(12, Math.max(1, Number(url.searchParams.get("limit") || 3) || 3));
  const now = new Date().toISOString();

  let sql = `SELECT * FROM visiting_hawaii_sponsored_listings
    WHERE status = 'active' AND (paid_through IS NULL OR paid_through > ?)`;
  const binds: (string | number)[] = [now];
  if (islandId) {
    sql += ` AND island_id = ?`;
    binds.push(islandId);
  }
  if (categoryId) {
    sql += ` AND category_id = ?`;
    binds.push(categoryId);
  }
  sql += ` ORDER BY updated_at DESC LIMIT 80`;

  const { results } = await env.DB.prepare(sql)
    .bind(...binds)
    .all<SponsoredListingRow>();
  const rows = results ?? [];
  const rotated = rotateSponsoredListings(rows, limit);
  return json(
    {
      listings: rotated.map(rowToPublic),
      rotatedAt: new Date().toISOString(),
      priceUsdYear: 100,
    },
    200,
  );
}

async function handleMine(request: Request, env: VisitingHawaiiSponsoredEnv, sess: { accountId: string; email: string }): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM visiting_hawaii_sponsored_listings WHERE account_id = ? ORDER BY updated_at DESC LIMIT 40`,
  )
    .bind(sess.accountId)
    .all<SponsoredListingRow>();

  return json(
    {
      listings: (results ?? []).map((row) => ({
        ...rowToPublic(row),
        status: row.status,
        paidThrough: row.paid_through,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      checkoutAvailable: visitingHawaiiSponsoredCheckoutAvailable(env),
    },
    200,
  );
}

async function handleApplicationPost(request: Request, env: VisitingHawaiiSponsoredEnv, sess: { accountId: string; email: string }): Promise<Response> {
  let body: ApplicationBody;
  try {
    body = (await request.json()) as ApplicationBody;
  } catch {
    return json({ detail: "Invalid JSON." }, 400);
  }

  const strict = body.strict === true;
  const app = applicationFromBody(body);
  if (!strict) {
    if (!validateIsland(app.islandId)) app.islandId = "oahu";
    if (!validateCategory(app.categoryId)) app.categoryId = "food";
  }
  const err = validateForSave(app, strict);
  if (err) return json({ detail: err }, 400);

  const now = new Date().toISOString();
  const existingId = clampText(body.id, 64);
  let id = existingId;

  if (existingId) {
    const row = await getListingForAccount(env.DB, existingId, sess.accountId);
    if (!row) return json({ detail: "Listing not found." }, 404);
    if (row.status === "active") {
      return json({ detail: "Active listings cannot be edited here. Contact support for changes." }, 409);
    }
    await env.DB.prepare(
      `UPDATE visiting_hawaii_sponsored_listings SET
        business_name = ?, contact_email = ?, contact_phone = ?, website_url = ?,
        island_id = ?, category_id = ?, sub_filters_json = ?,
        title = ?, short_description = ?, description = ?, image_url = ?,
        lat = ?, lng = ?, address_line = ?, cost_range = ?,
        cta_label = ?, cta_url = ?, status = 'draft', updated_at = ?
      WHERE id = ? AND account_id = ?`,
    )
      .bind(
        app.businessName,
        app.contactEmail || sess.email,
        app.contactPhone || null,
        app.websiteUrl || null,
        app.islandId,
        app.categoryId,
        JSON.stringify(app.subFilters),
        app.title,
        app.shortDescription,
        app.description,
        app.imageUrl,
        app.lat,
        app.lng,
        app.addressLine || null,
        validateCostRange(app.costRange) || null,
        app.ctaLabel || null,
        app.ctaUrl || null,
        now,
        existingId,
        sess.accountId,
      )
      .run();
  } else {
    id = newListingId();
    await env.DB.prepare(
      `INSERT INTO visiting_hawaii_sponsored_listings (
        id, account_id, business_name, contact_email, contact_phone, website_url,
        island_id, category_id, sub_filters_json,
        title, short_description, description, image_url,
        lat, lng, address_line, cost_range, cta_label, cta_url,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    )
      .bind(
        id,
        sess.accountId,
        app.businessName,
        app.contactEmail || sess.email,
        app.contactPhone || null,
        app.websiteUrl || null,
        app.islandId,
        app.categoryId,
        JSON.stringify(app.subFilters),
        app.title,
        app.shortDescription,
        app.description,
        app.imageUrl,
        app.lat,
        app.lng,
        app.addressLine || null,
        validateCostRange(app.costRange) || null,
        app.ctaLabel || null,
        app.ctaUrl || null,
        now,
        now,
      )
      .run();
  }

  const row = await getListingForAccount(env.DB, id, sess.accountId);
  return json(
    {
      ok: true,
      listingId: id,
      listing: row ? { ...rowToPublic(row), status: row.status } : null,
      checkoutAvailable: visitingHawaiiSponsoredCheckoutAvailable(env),
    },
    200,
  );
}

async function handleCheckoutPost(request: Request, env: VisitingHawaiiSponsoredEnv, sess: { accountId: string; email: string }): Promise<Response> {
  if (!visitingHawaiiSponsoredCheckoutAvailable(env)) {
    return json({ detail: "Sponsored checkout is not configured yet (STRIPE_VISITING_HAWAII_SPONSORED_PRICE_ID)." }, 503);
  }

  let body: { listingId?: string };
  try {
    body = (await request.json()) as { listingId?: string };
  } catch {
    return json({ detail: "Invalid JSON." }, 400);
  }

  const listingId = clampText(body.listingId, 64);
  if (!listingId) return json({ detail: "listingId is required." }, 400);

  const row = await getListingForAccount(env.DB, listingId, sess.accountId);
  if (!row) return json({ detail: "Listing not found." }, 404);

  const app = applicationFromBody({
    businessName: row.business_name,
    contactEmail: row.contact_email,
    islandId: row.island_id,
    categoryId: row.category_id,
    subFilters: row.sub_filters_json,
    title: row.title,
    shortDescription: row.short_description,
    description: row.description,
    imageUrl: row.image_url,
    lat: row.lat,
    lng: row.lng,
    addressLine: row.address_line ?? undefined,
    costRange: row.cost_range ?? undefined,
    ctaLabel: row.cta_label ?? undefined,
    ctaUrl: row.cta_url ?? undefined,
    websiteUrl: row.website_url ?? undefined,
  });
  const err = validateForSave(app, true);
  if (err) return json({ detail: `Complete your listing before checkout: ${err}` }, 400);

  const site = (env.SITE_URL || "https://rootrecord.cloud").replace(/\/+$/, "");
  const checkout = await createVisitingHawaiiSponsoredCheckout({
    secretKey: String(env.STRIPE_SECRET_KEY || ""),
    priceId: String(env.STRIPE_VISITING_HAWAII_SPONSORED_PRICE_ID || ""),
    customerEmail: sess.email,
    accountId: sess.accountId,
    listingId,
    siteUrl: site,
  });

  if (!checkout.ok) return json({ detail: checkout.message }, 502);

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE visiting_hawaii_sponsored_listings SET status = 'pending_payment', stripe_checkout_session_id = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(checkout.sessionId ?? null, now, listingId)
    .run();

  return json({ ok: true, url: checkout.url, listingId }, 200);
}

export async function handleVisitingHawaiiSponsoredRoutes(
  request: Request,
  env: VisitingHawaiiSponsoredEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (!sub.startsWith("/visiting-hawaii/sponsored")) return null;

  const path = sub.replace(/\/+$/, "") || sub;

  if (method === "GET" && path === "/visiting-hawaii/sponsored") {
    return handlePublicList(request, env);
  }

  const sess = await sessionFromRequest(env, request);
  if (path === "/visiting-hawaii/sponsored/mine" && method === "GET") {
    if (!sess) {
      if (extractAuthToken(request)) return json({ detail: "Sign in required." }, 401);
      return json({ detail: "Sign in required." }, 401);
    }
    return handleMine(request, env, sess);
  }

  if (!sess) {
    if (extractAuthToken(request)) return json({ detail: "Sign in required." }, 401);
    return json({ detail: "Sign in required." }, 401);
  }

  if (method === "POST" && path === "/visiting-hawaii/sponsored/applications") {
    return handleApplicationPost(request, env, sess);
  }

  if (method === "POST" && path === "/visiting-hawaii/sponsored/checkout") {
    return handleCheckoutPost(request, env, sess);
  }

  return json({ detail: "Not found." }, 404);
}

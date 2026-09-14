/**
 * Visiting Hawaiʻi sponsored listings — shared D1 helpers (account + license Workers).
 */

export type SponsoredListingStatus = "draft" | "pending_payment" | "active" | "expired" | "canceled";

export const VISITING_HAWAII_ISLAND_IDS = ["oahu", "maui", "kauai", "hawaii", "molokai", "lanai"] as const;
export const VISITING_HAWAII_CATEGORY_IDS = [
  "beaches",
  "hikes",
  "culture",
  "food",
  "adventure",
  "drives",
  "hidden",
  "practical",
] as const;

export const VISITING_HAWAII_COST_RANGES = ["free", "$", "$$", "$$$"] as const;

export type VisitingHawaiiIslandId = (typeof VISITING_HAWAII_ISLAND_IDS)[number];
export type VisitingHawaiiCategoryId = (typeof VISITING_HAWAII_CATEGORY_IDS)[number];

export type SponsoredListingRow = {
  id: string;
  account_id: string;
  business_name: string;
  contact_email: string;
  contact_phone: string | null;
  website_url: string | null;
  island_id: string;
  category_id: string;
  sub_filters_json: string;
  title: string;
  short_description: string;
  description: string;
  image_url: string;
  lat: number | null;
  lng: number | null;
  address_line: string | null;
  cost_range: string | null;
  cta_label: string | null;
  cta_url: string | null;
  status: string;
  stripe_checkout_session_id: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  paid_through: string | null;
  rotation_weight: number;
  created_at: string;
  updated_at: string;
  activated_at: string | null;
};

export type SponsoredListingPublic = {
  id: string;
  businessName: string;
  islandId: string;
  categoryId: string;
  subFilters: string[];
  title: string;
  shortDescription: string;
  description: string;
  imageUrl: string;
  lat: number | null;
  lng: number | null;
  addressLine: string | null;
  costRange: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  websiteUrl: string | null;
  sponsored: true;
};

export function clampText(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);
}

export function isEmailLike(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isHttpsUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseSubFilters(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => clampText(x, 40)).filter(Boolean).slice(0, 12);
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.map((x) => clampText(x, 40)).filter(Boolean).slice(0, 12);
    } catch {
      return raw
        .split(",")
        .map((s) => clampText(s, 40))
        .filter(Boolean)
        .slice(0, 12);
    }
  }
  return [];
}

export function rowToPublic(row: SponsoredListingRow): SponsoredListingPublic {
  let subFilters: string[] = [];
  try {
    const parsed = JSON.parse(row.sub_filters_json) as unknown;
    if (Array.isArray(parsed)) subFilters = parsed.map((x) => String(x)).filter(Boolean);
  } catch {
    subFilters = [];
  }
  return {
    id: row.id,
    businessName: row.business_name,
    islandId: row.island_id,
    categoryId: row.category_id,
    subFilters,
    title: row.title,
    shortDescription: row.short_description,
    description: row.description,
    imageUrl: row.image_url,
    lat: row.lat,
    lng: row.lng,
    addressLine: row.address_line,
    costRange: row.cost_range,
    ctaLabel: row.cta_label,
    ctaUrl: row.cta_url,
    websiteUrl: row.website_url,
    sponsored: true,
  };
}

/** Stable rotation order that shifts every 5 minutes. */
export function rotateSponsoredListings<T extends { id: string; rotation_weight?: number }>(
  items: T[],
  limit: number,
  nowMs = Date.now(),
): T[] {
  if (!items.length || limit <= 0) return [];
  const bucket = Math.floor(nowMs / (5 * 60 * 1000));
  const weighted: T[] = [];
  for (const item of items) {
    const w = Math.max(1, Math.min(5, Math.floor(Number((item as { rotation_weight?: number }).rotation_weight) || 1)));
    for (let i = 0; i < w; i++) weighted.push(item);
  }
  if (!weighted.length) return [];
  const start = bucket % weighted.length;
  const out: T[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < weighted.length && out.length < limit; i++) {
    const pick = weighted[(start + i) % weighted.length]!;
    if (seen.has(pick.id)) continue;
    seen.add(pick.id);
    out.push(pick);
  }
  return out;
}

export function isVisitingHawaiiSponsoredCheckout(session: Record<string, unknown>): boolean {
  const meta = session.metadata as Record<string, unknown> | undefined;
  const product = String(meta?.product || meta?.Product || "").trim();
  const listingId = String(meta?.listing_id || meta?.listingId || "").trim();
  return product === "visiting_hawaii_sponsored" && listingId.startsWith("vhsl_");
}

export function listingIdFromCheckoutSession(session: Record<string, unknown>): string {
  const meta = session.metadata as Record<string, unknown> | undefined;
  return String(meta?.listing_id || meta?.listingId || "").trim();
}

export async function activateVisitingHawaiiListing(
  db: D1Database,
  listingId: string,
  opts: {
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    stripeCheckoutSessionId?: string | null;
    paidThroughIso?: string | null;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE visiting_hawaii_sponsored_listings SET
        status = 'active',
        stripe_customer_id = COALESCE(?, stripe_customer_id),
        stripe_subscription_id = COALESCE(?, stripe_subscription_id),
        stripe_checkout_session_id = COALESCE(?, stripe_checkout_session_id),
        paid_through = COALESCE(?, paid_through),
        activated_at = COALESCE(activated_at, ?),
        updated_at = ?
      WHERE id = ?`,
    )
    .bind(
      opts.stripeCustomerId ?? null,
      opts.stripeSubscriptionId ?? null,
      opts.stripeCheckoutSessionId ?? null,
      opts.paidThroughIso ?? null,
      now,
      now,
      listingId,
    )
    .run();
}

export async function refreshVisitingHawaiiListingPeriod(
  db: D1Database,
  stripeSubscriptionId: string,
  paidThroughIso: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE visiting_hawaii_sponsored_listings SET
        status = 'active',
        paid_through = ?,
        updated_at = ?
      WHERE stripe_subscription_id = ?`,
    )
    .bind(paidThroughIso, now, stripeSubscriptionId)
    .run();
}

export async function expireVisitingHawaiiListingBySubscription(db: D1Database, stripeSubscriptionId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE visiting_hawaii_sponsored_listings SET status = 'expired', updated_at = ? WHERE stripe_subscription_id = ?`,
    )
    .bind(now, stripeSubscriptionId)
    .run();
}

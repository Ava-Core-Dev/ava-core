type SiteConfigEnv = {
  STRIPE_PRICING_TABLE_ID?: string;
  STRIPE_PUBLISHABLE_KEY?: string;
  STRIPE_CUSTOMER_PORTAL_URL?: string;
};

export const onRequestGet = async (context: { request: Request; env: SiteConfigEnv }) => {
  const origin = new URL(context.request.url).origin;
  // Account portal calls /v1/* on this same origin; `functions/v1/[[path]].ts` proxies portal routes (auth, me, discord, …) to the account Worker.
  // Returning the worker URL here caused fetch() to fail when *.workers.dev is blocked (common on mobile).
  const apiBase = origin.replace(/\/+$/, "");
  const stripePricingTableId = String(context.env.STRIPE_PRICING_TABLE_ID || "").trim();
  const stripePublishableKey = String(context.env.STRIPE_PUBLISHABLE_KEY || "").trim();
  const stripeCustomerPortalUrl = String(context.env.STRIPE_CUSTOMER_PORTAL_URL || "").trim();
  const payload: Record<string, string> = { apiBase };
  if (stripePricingTableId) payload.stripePricingTableId = stripePricingTableId;
  if (stripePublishableKey) payload.stripePublishableKey = stripePublishableKey;
  if (stripeCustomerPortalUrl) payload.stripeCustomerPortalUrl = stripeCustomerPortalUrl;
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
};

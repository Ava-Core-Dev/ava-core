/**
 * Per-goal Stripe donate: product + custom-amount price + Payment Link.
 * 5% Root Record service fee is taken from the charged amount (goal is credited the rest).
 */
import { CARD_FEE_BPS, feeFromBps } from "../../shared/platform-fees";

function stripeOk(secret: string | undefined): boolean {
  const s = (secret || "").trim();
  return s.startsWith("sk_") && s.length > 30;
}

async function stripeForm(
  secret: string,
  path: string,
  body: URLSearchParams,
): Promise<{ ok: boolean; data: Record<string, unknown>; status: number }> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret.trim()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = (await res.json()) as Record<string, unknown>;
  return { ok: res.ok, data, status: res.status };
}

export async function createGoalStripeDonateLink(params: {
  secretKey?: string;
  siteUrl: string;
  goalId: string;
  title: string;
  imageUrl?: string | null;
}): Promise<
  | { ok: true; url: string; productId: string; priceId: string }
  | { ok: false; message: string }
> {
  const secret = (params.secretKey || "").trim();
  if (!stripeOk(secret)) return { ok: false, message: "stripe_not_configured" };

  const site = params.siteUrl.replace(/\/+$/, "") || "https://rootrecord.online";
  const title = String(params.title || "Goal").slice(0, 80);

  const productBody = new URLSearchParams();
  productBody.set("name", `Donate · ${title}`);
  productBody.set("description", `Donation toward: ${title}. Includes a 5% Root Record service fee; Stripe processing is extra.`);
  productBody.set("metadata[goal_id]", params.goalId);
  productBody.set("metadata[kind]", "goal_donation");
  if (params.imageUrl) productBody.set("images[0]", params.imageUrl);

  const product = await stripeForm(secret, "/products", productBody);
  const productId = String(product.data.id || "");
  if (!product.ok || !productId.startsWith("prod_")) {
    const msg =
      (product.data.error as { message?: string } | undefined)?.message ||
      `product_http_${product.status}`;
    return { ok: false, message: msg };
  }

  const priceBody = new URLSearchParams();
  priceBody.set("currency", "usd");
  priceBody.set("product", productId);
  priceBody.set("custom_unit_amount[enabled]", "true");
  priceBody.set("custom_unit_amount[minimum]", "100");
  priceBody.set("custom_unit_amount[preset]", "2500");
  priceBody.set("metadata[goal_id]", params.goalId);
  priceBody.set("metadata[kind]", "goal_donation");

  const price = await stripeForm(secret, "/prices", priceBody);
  const priceId = String(price.data.id || "");
  if (!price.ok || !priceId.startsWith("price_")) {
    const msg =
      (price.data.error as { message?: string } | undefined)?.message || `price_http_${price.status}`;
    return { ok: false, message: msg };
  }

  const linkBody = new URLSearchParams();
  linkBody.set("line_items[0][price]", priceId);
  linkBody.set("line_items[0][quantity]", "1");
  linkBody.set("after_completion[type]", "redirect");
  linkBody.set("after_completion[redirect][url]", `${site}/goals/${params.goalId}?donated=1`);
  linkBody.set("metadata[goal_id]", params.goalId);
  linkBody.set("metadata[kind]", "goal_donation");
  linkBody.set("payment_intent_data[metadata][goal_id]", params.goalId);
  linkBody.set("payment_intent_data[metadata][kind]", "goal_donation");
  linkBody.set(
    "custom_text[submit][message]",
    "A 5% Root Record service fee supports hosting. Stripe also charges card processing. The goal is credited the rest. Solana/USDC donations are 2.5%.",
  );

  const link = await stripeForm(secret, "/payment_links", linkBody);
  const url = String(link.data.url || "");
  if (!link.ok || !url) {
    const msg =
      (link.data.error as { message?: string } | undefined)?.message || `link_http_${link.status}`;
    return { ok: false, message: msg };
  }
  return { ok: true, url, productId, priceId };
}

export async function recordGoalStripeDonation(
  db: {
    prepare: (q: string) => {
      bind: (...a: unknown[]) => { run: () => Promise<unknown>; first: <T>() => Promise<T | null> };
    };
  },
  params: {
    goalId: string;
    amountCents: number;
    txRef: string;
    payerEmail?: string | null;
  },
): Promise<boolean> {
  const goalId = String(params.goalId || "").trim();
  const txRef = String(params.txRef || "").trim();
  const cents = Math.max(0, Math.round(Number(params.amountCents) || 0));
  if (!goalId || !txRef || cents <= 0) return false;

  const existing = await db
    .prepare(`SELECT id FROM rg_goal_donations WHERE tx_ref = ?`)
    .bind(txRef)
    .first<{ id: string }>();
  if (existing?.id) return false;

  const fee = feeFromBps(cents, CARD_FEE_BPS);
  const net = Math.max(0, cents - fee);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO rg_goal_donations (id, goal_id, source, amount_cents, currency, tx_ref, payer_email, created_at, fee_cents, net_cents)
       VALUES (?, ?, 'stripe', ?, 'usd', ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), goalId, cents, txRef, params.payerEmail || null, now, fee, net)
    .run();
  await db
    .prepare(
      `UPDATE rg_goals SET raised_cents = COALESCE(raised_cents, 0) + ?, updated_at = ? WHERE id = ?`,
    )
    .bind(net, now, goalId)
    .run();
  return true;
}

# Stripe Pro webhook (RootMC)

Endpoint (after `deploy.ps1`): `https://api.rootmc.info/v1/stripe/webhook`

## Dashboard steps

### Product & prices

1. Product `prod_UyLfBFLcoBZc1Q` — ensure three prices:
   - **Monthly subscription** (~$4.99/mo) → `STRIPE_ROOTMC_PRICE_MONTHLY`
   - **1 Month one-time** ($4.99) → `STRIPE_ROOTMC_PRICE_ONE_MONTH`
   - **Lifetime one-time** (~$75) → `STRIPE_ROOTMC_PRICE_LIFETIME`
2. Put those `price_…` ids in the shared `.env` and (optionally) wrangler `[vars]`.
3. Payment Links (one per price): monthly sub, 1-month, Lifetime. Each needs a **required** custom text field **Minecraft username** (key preferably `minecraft_username`). Webhook `whsec` stays valid if the endpoint URL is unchanged.

### Webhook

1. Stripe Dashboard → Developers → Webhooks → **Add endpoint** (or reuse existing RootMC endpoint)
2. URL: `https://api.rootmc.info/v1/stripe/webhook`
3. Events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `charge.dispute.created`
   - `charge.dispute.funds_withdrawn`
   - `charge.dispute.closed`
   - `charge.refunded`
4. Copy the **RootMC** endpoint signing secret (`whsec_…`) into the shared `.env` as `STRIPE_WEBHOOK_SECRET_ROOTMC`
5. Leave RootRecord’s endpoint secret as `STRIPE_WEBHOOK_SECRET` in the same file
6. Re-run `Web Files\rootmc-api\deploy.ps1` — uploads Worker binding `STRIPE_WEBHOOK_SECRET` from `STRIPE_WEBHOOK_SECRET_ROOTMC` only
7. Smoke-test: checkout with a **linked Minecraft username** (gift beneficiary). Monthly sub → account Pro; 1-month / Lifetime → vault voucher (`/vault`), redeem in-game.

## Fulfillment behavior

| Checkout | Result |
|---|---|
| Subscription (monthly price) | `pro_unlocked` on linked account (username field → link; email fallback) |
| Payment + one-month price | Pending vault item `rootmc:pro_voucher_month` (tradeable until redeem → `pro_paid_until`) |
| Payment + lifetime price | Pending vault item `rootmc:pro_voucher_life` (tradeable until redeem → `life_member`) |
| Refund / dispute | Void unclaimed vouchers for that charge; revoke redeemed entitlements when applicable |

Identity: **Minecraft username** (required) resolves via linked player → account. Stripe Checkout **purchaser email** is stored on vouchers (`purchaser_email`) and billing audit — may differ from the beneficiary’s linked email when gifting. Weekly award Pro uses `pro_redeemed_until` and does not share `pro_paid_until`.

## Secrets (single shared `.env`)

| `.env` key | Used by |
|---|---|
| `STRIPE_WEBHOOK_SECRET` | RootRecord Workers |
| `STRIPE_WEBHOOK_SECRET_ROOTMC` | RootMC `deploy.ps1` → rootmc-api Worker |
| `STRIPE_SECRET_KEY` | Shared Stripe account (same `sk_` if one account) |
| `STRIPE_ROOTMC_PRICE_MONTHLY` | Worker price-id branch |
| `STRIPE_ROOTMC_PRICE_ONE_MONTH` | Worker price-id branch |
| `STRIPE_ROOTMC_PRICE_LIFETIME` | Worker price-id branch |

RootMC deploy does **not** read `STRIPE_WEBHOOK_SECRET`. Never commit `.env` / keys / webhook secrets.

Public vars: `STRIPE_ROOTMC_PRODUCT_ID=prod_UyLfBFLcoBZc1Q`, payment link in wrangler `[vars]`.

## Rotate after chat paste

If `sk_live_…` was pasted in chat, **rotate the secret key in Stripe** after the first successful webhook, then update `.env` and redeploy.

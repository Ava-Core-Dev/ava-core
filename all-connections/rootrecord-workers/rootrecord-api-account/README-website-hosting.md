# Website Hosting — Stripe product notes

Personal sites for Root Record members (`rr_sites` / `rr_site_invoices`).

## Pricing

| Phase | Amount | Notes |
| --- | --- | --- |
| Onboarding trial | $0 | Created on `POST /api/sites`. Default **14 days** (`trial_ends_at`). Status `trialing`. |
| After trial | **$10 / month** | Recurring Stripe subscription. Product name: **Website Hosting**. |

Scaffold does **not** require live Stripe keys. Sites work in trial mode without Checkout.

## Stripe Dashboard setup (when going live)

1. Create Product **Website Hosting**.
2. Add recurring Price: **$10.00 USD / month**.
3. Copy Price id (`price_…`) into Worker var:
   - `STRIPE_WEBSITE_HOSTING_PRICE_ID` in `wrangler.toml` `[vars]` (or Dashboard).
4. Reuse existing `STRIPE_SECRET_KEY` Worker secret (same as membership billing).
5. Webhooks (license / billing worker): on `invoice.paid` / `customer.subscription.*` for this product, set:
   - `rr_sites.subscription_status` → `active` | `past_due` | `canceled` | …
   - `rr_sites.stripe_subscription_id`
   - Mark matching `rr_site_invoices` `paid` when Stripe invoice id matches.

Suggested Checkout metadata:

- `product=website_hosting`
- `site_id=<uuid>`
- `account_id=<license_accounts.id>`

Trial → paid: attach subscription with `trial_end` aligned to `rr_sites.trial_ends_at`, or start Checkout after trial with no free trial on the Price.

## Public URLs

Until a custom domain is live:

- `https://rootrecord.info/sites/<uuid>`
- `https://rootrecord.info/<uuid>` (optional short path; Pages rewrite TBD)

Custom domain: customer points **nameservers** at Cloudflare; `POST /api/sites/:id/domain` stores domain and sets `nameserver_status=pending`.

## Lapse / paywall

When `subscription_status` is not `active` and trial has ended:

- API sets `paywall: true` on `GET /public/sites/:id` and owner `GET /api/sites/me`.
- An open `rr_site_invoices` row ($10) is created for recurring collection UX.
- Public shell (`/sites/index.html`) shows a paywall modal + link to Account billing / Website settings.

## API sketch

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/api/sites` | Session — create site, start trial |
| `GET` | `/api/sites/me` | Session — owner site + open invoice |
| `PATCH` | `/api/sites/:id` | Session — title / slug / config |
| `POST` | `/api/sites/:id/domain` | Session — custom domain + NS instructions |
| `GET` | `/public/sites/:id` | Public — config + `paywall` |

Apply migration: `migrations/0140_rr_sites_website_hosting.sql`.

# RootRecord Website — PRD

## Original problem statement
> "I've provided a copy of our website. I would like to completely modernize it."
> User follow-up: "Just do what you think is best. I just want a professional website."

## Product
RootRecord — maker of multi-device software: **Business Manager** (Android-first; legacy Windows installers may remain on GitHub), **Weather Manager** (Windows and Android), **Kīlauea Alerts** (Android + web), and web accounts and billing. The site markets those programs, hosts account sign-in for the rootrecord.info license worker, and publishes Terms/Privacy for compliance. Testing-rewards points can be redeemed on the Beta tester rewards page (100,000 points = 1 month of Pro).

## Architecture (unchanged from original repo — required for Cloudflare Pages deploy)
- **Static HTML + CSS** deployed via Cloudflare Pages (`wrangler.toml`, `package.json`, `functions/api/site-config.ts`)
- **Account portal (`account.html` + `account.js`)** calls the separate `rootrecord-license` Cloudflare Worker via `apiBase` returned from `/api/site-config`
- **Preview environment** here: minimal FastAPI stub at `/app/backend`, `serve` static server at `/app/frontend` serving files from `/app/` on port 3000

## What was done (2026-04-24 — modernization sprint)
- Complete visual redesign using a new design system in `styles.css`:
  - **Typography**: Fraunces (variable serif display with italic accents) + Geist (sans body) + JetBrains Mono (metadata/kickers)
  - **Palette (dark neon brand — matches user-supplied artwork)**: midnight navy `#081C2B` + emerald gradient `#0D2F22` background, electric green `#3FE28D` primary accent, cyan `#5CE1F0` secondary, sun yellow `#FCD34D` highlight, near-white `#E7F3EC` text. Cards use `#0F2232` surface with `#13304A` hover.
  - **Components**: pill buttons with neon-green glow, glass-blur sticky header, real brand artwork as hero visual (at `/assets/hero.jpg`) with two floating glass-blur badges ("Rooted locally" / "Optional cloud"), feature cards with radial-glow hover, pricing cards (featured plan with emerald gradient + neon border + glow), dark `cta-band`, 4-column footer with neon-green top rule, FAQ accordion-style items, editorial long-form prose for legal pages
- All 11 pages rewritten with new structure & shared header/footer: `index.html`, `products.html`, `pricing.html`, `about.html`, `faq.html`, `contact.html`, `privacy.html`, `terms.html`, `account.html`, `rootrecord-business-manager.html`, `rootrecord-weather-manager.html`
- Hero artwork + secondary brand image stored in `/app/assets/` (hero.jpg, brand.jpg) — deploys with the Pages project automatically
- **Preserved all `account.js` selectors** (status, panel-loading, panel-forms, panel-account, form-login, login-email, login-password, form-signup, signup-email, signup-password, account-details, billing-intro, billing-unavailable, billing-actions, billing-email, btn-billing, btn-logout) so production license-worker integration is untouched
- Preserved all external URLs (GitHub releases, Discord invite, X, rootrecord.info/billing, /auth/signup, etc.)
- Mobile nav toggle + responsive breakpoints at 880/760/640
- `prefers-reduced-motion` respected

## What's intentionally unchanged
- `account.js`, `functions/api/site-config.ts`, `wrangler.toml`, `tsconfig.json`, root `package.json` — so `wrangler pages deploy .` still works identically

## P0 / P1 / P2 backlog
- **P1**: Add Open Graph images and favicon set (site currently has no favicon)
- **P1**: Add real screenshots of the two apps to replace the hero illustration on product pages
- **P2**: Dark mode toggle (palette is ready)
- **P2**: Blog / changelog section tied to GitHub releases
- **P2**: Schema.org SoftwareApplication markup for SEO
- **P2**: Lifetime-plan "what's included" comparison table

## Next action items
1. Deploy to Cloudflare Pages (`npx wrangler pages deploy .`) and verify `/api/site-config` returns the production `ROOTRECORD_API_BASE`
2. Plug in real app screenshots when available (product pages still use the brand artwork as decorative visual)

## Assets shipped (2026-04-24)
- `/favicon.ico` (multi-resolution 16/32/48 from tree-icon crop of brand artwork)
- `/favicon-16.png`, `/favicon-32.png`, `/favicon-180.png` (apple-touch-icon)
- `/assets/icon-192.png`, `/assets/icon-512.png` (PWA manifest icons)
- `/assets/og.jpg` — 1200x630 Open Graph / Twitter card (tree artwork + RootRecord brand + tagline)
- `/site.webmanifest` — PWA manifest with theme color #081C2B
- Full OG + Twitter meta tags wired into all 11 HTML pages with per-page title/description + canonical URL

## Personas
- **Independent operator (primary)** — runs a small shop, wants real books, distrusts SaaS lock-in
- **Hazard-aware homeowner / site operator (secondary)** — wants weather/alert clarity without tab overload
- **Returning RootRecord user** — comes to the site to sign in, see plan status, manage billing

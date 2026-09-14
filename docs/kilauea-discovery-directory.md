# Kilauea Discovery Directory

## Purpose

Build a dedicated Kilauea and Volcano-area discovery service for residents, visitors, researchers, emergency planners, and local businesses.

The service combines:

- A live Kilauea conditions and metrics dashboard
- A historical volcano and Volcano Village information database
- A verified local business directory
- Search engine optimization (SEO) and generative engine optimization (GEO) pages
- Optional website and visibility services for participating businesses

The directory is a discovery layer. It does not replace a business's own website, booking system, ordering system, or social accounts.

## Initial Geography

Start with a clearly defined area:

- Fern Forest
- Volcano Village
- Volcano
- Glenwood
- Nearby Puna businesses that serve the Kilauea and Volcano area

The site should publish its geographic boundary and expand it deliberately rather than claiming complete coverage without evidence.

## Kilauea Information Platform

The public science and conditions section should collect, normalize, timestamp, and attribute every useful public metric that can be found.

Potential data categories:

- USGS and HVO eruption status and alerts
- Earthquakes, magnitude, depth, location, and time
- Ground deformation and GPS observations
- Volcanic gas and sulfur dioxide information
- Lava lake, lava flow, vent, and thermal observations when officially available
- Webcams and official imagery
- Weather, rainfall, wind, temperature, humidity, and visibility
- Air quality and particulate information
- Road conditions, closures, outages, and emergency notices
- Tides, sunrise, sunset, moon, and astronomical conditions
- Historical eruptions, earthquakes, hazards, and community events
- Volcano Village services, lodging, food, tours, shops, and local resources

Every scientific or operational value must retain:

- Source organization and source URL
- Original metric name
- Normalized value and unit
- Retrieval timestamp
- Observation timestamp when available
- Quality, warning, or stale-data status
- Historical revision or correction information

Official observations must remain clearly separate from estimates, commentary, business claims, and sponsored material. The system must never invent missing measurements.

## Business Discovery Workflow

AI may collect publicly discoverable businesses from maps, official websites, directories, social pages, tourism listings, and other lawful public sources. It should produce research records, not pretend that a business has agreed to participate.

For each prospect, AI should:

1. Discover and deduplicate possible businesses.
2. Record source URLs and confidence.
3. Classify the business and service area.
4. Extract public contact, hours, website, booking, and social links.
5. Identify missing or conflicting information.
6. Calculate a transparent SEO/GEO visibility score.
7. Prepare a short owner-facing audit.
8. Mark the record as unclaimed until the owner verifies it.

Owner interaction should be handled directly by RootRecord staff or the operator. Businesses should be able to claim, correct, approve, or remove their information.

Use these listing states:

- `discovered`: found through public research, not verified
- `contacted`: outreach attempted
- `claimed`: owner has claimed the record
- `verified`: owner approved the displayed information
- `sponsored`: paid placement or founding listing is active
- `unclaimed`: publicly available record not yet confirmed
- `retired`: no longer operating or removed at the owner's request

## $50 Founding Discovery Page

The initial offer is a one-time $50 founding listing.

The page includes:

- Dedicated RootRecord discovery page
- Accurate business name, category, location, and service area
- Owner-approved description
- Search-optimized title, description, headings, and local schema
- Phone, website, booking, ordering, and social links
- Owner-approved photos and captions
- Map location or service-area presentation
- SEO/GEO visibility score
- Verified and last-updated status
- Inclusion in relevant Fern Forest, Volcano, and Kilauea guides
- Clear sponsorship disclosure where applicable

The customer-facing explanation should be:

> We create a verified discovery page that helps people and search engines find your existing business website. We do not replace your website.

The $50 page should be easy to understand and easy to buy. It should not promise a specific Google ranking, traffic volume, AI answer placement, or business result.

## SEO and GEO Score

Call this an independent RootRecord visibility score. It is not a Google score, official certification, or guarantee of ranking.

Possible scoring categories:

- Website exists and works
- Mobile usability
- HTTPS
- Page speed
- Accurate name, address, phone, and hours
- Google Business Profile presence
- Local business and service schema
- Search title and description
- Clear service and location language
- Image quality and descriptive alt text
- Review and profile completeness
- Directory and social consistency
- Accessibility basics
- Freshness of contact information
- Factual completeness for AI answer systems

Show the business the reasons behind the score and the highest-value improvements. Keep score history so owners can see progress.

GEO pages should make factual answers easy for search engines and AI systems to identify:

- What the business is
- Where it is
- Who it serves
- What it offers
- When it is open
- How to contact or book it
- What makes it distinct

## Additional Website Services

The discovery page is the entry offer. Additional services can improve the business's primary website without taking ownership away from the business.

Potential services:

- Website SEO audit
- Local SEO cleanup
- Google Business Profile improvements
- Structured data and schema implementation
- Page-speed and mobile improvements
- Accessibility improvements
- AI-search and GEO content optimization
- New service or location landing pages
- Website rebuilds
- Analytics and conversion improvements
- Monthly updates and visibility reporting

All work should link back to and reinforce the business's own website, booking system, phone number, and direct customer relationship.

## Trust and Consent Rules

- Never imply that an unclaimed business endorsed RootRecord.
- Never claim Google, HVO, USGS, Airbnb, or another organization endorses the directory without written authorization.
- Do not copy Airbnb's full listing database or present Airbnb listings as direct partners.
- Link to official booking pages and collect permission for owner-provided descriptions and photos.
- Clearly label sponsored, paid, featured, and editorial content.
- Provide a correction, claim, opt-out, and removal process.
- Keep personal owner contact information private unless explicitly approved for publication.
- Preserve source URLs and retrieval dates for automated research.
- Respect robots.txt, platform terms, rate limits, copyright, and applicable privacy laws.
- Treat Kilauea and Hawaii cultural information with care, context, and appropriate attribution.

## Technical Shape

Use a split deployment:

```text
Vercel
  Next.js discovery website, public pages, previews, CDN, and lightweight request handlers

IONOS VPS
  FastAPI, scheduled ingestion, scoring jobs, database, media processing, and APIs

Object storage
  Approved business photos, generated media, and historical source artifacts

RootRecord operator desk
  Review queue, owner onboarding, corrections, and publication controls
```

Recommended initial data model:

- `businesses`
- `business_sources`
- `business_claims`
- `business_verifications`
- `business_sponsorships`
- `business_score_snapshots`
- `business_photos`
- `scientific_sources`
- `scientific_observations`
- `hazard_events`
- `places`
- `audit_log`

AI-generated records should enter a review queue. Publication should require either owner verification or a clearly marked unclaimed status.

## Launch Sequence

1. Define the geographic boundary and category taxonomy.
2. Build the Kilauea conditions dashboard from official sources.
3. Build the business research and deduplication pipeline.
4. Create the first SEO/GEO score report.
5. Generate draft pages marked `unclaimed`.
6. Prepare a simple owner claim and correction workflow.
7. Personally visit or contact businesses in Fern Forest and Volcano.
8. Launch the $50 founding offer with a small group of local businesses.
9. Publish verified listings and measure search impressions, referrals, and corrections.
10. Offer website audits and improvements to businesses that want more help.

## Funding Model

At the one-time $50 price:

- 20 founding sponsors: $1,000
- 50 founding sponsors: $2,500
- 100 founding sponsors: $5,000

This can fund several years of modest hosting at an early stage. Long-term sustainability can come from optional recurring services:

- Enhanced listing subscription
- Featured placement
- Seasonal promotion packages
- Website maintenance
- SEO/GEO reporting
- New landing pages and website rebuilds

The scientific dashboard should remain useful without payment. Sponsored business content must never alter official hazard readings or emergency information.

## Product Positioning

The central promise is:

> RootRecord helps people discover the Kilauea and Volcano area, and helps local businesses become easier to find without replacing the websites they already own.

The first release should be a useful Kilauea conditions dashboard plus a verified Volcano-area discovery directory. The complete historical data platform can grow behind that focused public product.

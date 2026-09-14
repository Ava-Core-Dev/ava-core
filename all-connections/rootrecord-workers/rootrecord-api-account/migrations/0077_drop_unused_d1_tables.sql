-- 0077: Drop D1 tables with no runtime references (verified 2026-06-05 against live `root-record`).
-- Apply once: `Web/cloudflare/rootrecord-api-account/d1-apply-remote.ps1` (or account deploy.ps1).
--
-- custodial_sol_wallets       — empty; superseded by internal_solana_wallets
-- discord_posted_quakes       — superseded by kilauea_discord_guild_quake_post (usgs-discord-cron.ts)
-- ecosystem_bot_events        — empty orphan (legacy Solana bot schema; not in repo)
-- ecosystem_otc_fulfillments  — OTC locks; no Worker src reads/writes (4 stale rows)
-- ecosystem_reinvest_queue    — empty orphan (legacy ecosystem bot schema)
-- rr_meta                     — empty bootstrap KV from 0001_init; never wired in app code
-- solana_site                 — My Actions log; UI proxies exist but no Worker SQL (2 stale rows)
-- solana_site_challenges      — wallet-challenge nonces for My Actions; unwired (3 stale rows)
--
-- Active Solana site logging uses solana_site_token_create (solana-site-log.ts).

DROP TABLE IF EXISTS custodial_sol_wallets;
DROP TABLE IF EXISTS discord_posted_quakes;
DROP TABLE IF EXISTS ecosystem_bot_events;
DROP TABLE IF EXISTS ecosystem_otc_fulfillments;
DROP TABLE IF EXISTS ecosystem_reinvest_queue;
DROP TABLE IF EXISTS rr_meta;
DROP TABLE IF EXISTS solana_site;
DROP TABLE IF EXISTS solana_site_challenges;

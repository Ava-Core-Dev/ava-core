-- RootMC Discord OAuth PKCE (store verifier server-side; no client secret at token exchange)

ALTER TABLE rootmc_discord_oauth_states ADD COLUMN code_verifier TEXT NOT NULL DEFAULT '';

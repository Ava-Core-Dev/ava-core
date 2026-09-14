-- Distinguish Root Units vs RRTT Discord sends; store Solana sig for RRTT.
ALTER TABLE rr_earn_discord_peer_transfer ADD COLUMN asset TEXT DEFAULT 'RUNIT';
ALTER TABLE rr_earn_discord_peer_transfer ADD COLUMN tx_signature TEXT;

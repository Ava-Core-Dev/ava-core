-- OTC fulfillment display: optional LP tx + quote received + human token count (D1 / Worker).

ALTER TABLE ecosystem_otc_fulfillments ADD COLUMN liquidity_tx TEXT;
ALTER TABLE ecosystem_otc_fulfillments ADD COLUMN quote_received_raw TEXT;
ALTER TABLE ecosystem_otc_fulfillments ADD COLUMN tokens_whole TEXT;
ALTER TABLE ecosystem_otc_fulfillments ADD COLUMN token_decimals TEXT;

-- Idempotent OTC fulfillment locks (payment tx signature is consumed once).
CREATE TABLE IF NOT EXISTS ecosystem_otc_fulfillments (
  payment_tx_signature TEXT PRIMARY KEY NOT NULL,
  buyer TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  amount_raw TEXT NOT NULL,
  pay_with TEXT NOT NULL,
  out_tx TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

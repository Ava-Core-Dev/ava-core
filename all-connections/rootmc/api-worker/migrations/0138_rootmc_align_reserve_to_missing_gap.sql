-- Align reserve to target gap: gold_found_since_july - wallet_notes = 863.05 G.
-- Snapshot used: wallet=1521.77, found=2384.82, reserve=14.69, delta=848.36.
INSERT INTO rootmc_treasury_ledger (
  server_id,
  mysql_id,
  entry_type,
  amount,
  from_uuid,
  to_uuid,
  details,
  created_at,
  synced_at
)
SELECT
  'rootmc',
  COALESCE(MAX(mysql_id), 0) + 1,
  'TAX',
  848.36,
  NULL,
  'a73f39b0-1b7c-2930-b4a3-ce101812d926',
  'executive:reserve_gap_alignment_2026_07_08',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM rootmc_treasury_ledger
WHERE server_id = 'rootmc'
  AND NOT EXISTS (
    SELECT 1
    FROM rootmc_treasury_ledger
    WHERE server_id = 'rootmc'
      AND details = 'executive:reserve_gap_alignment_2026_07_08'
  );


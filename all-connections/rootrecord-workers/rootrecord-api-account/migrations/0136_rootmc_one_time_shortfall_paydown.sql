-- One-time reserve note-burn to clear current over-issue shortfall.
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
  'NOTE_BURN',
  415.41,
  'a73f39b0-1b7c-2930-b4a3-ce101812d926',
  NULL,
  'debt_repayment:over_issue_shortfall_one_time',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM rootmc_treasury_ledger
WHERE server_id = 'rootmc'
  AND NOT EXISTS (
    SELECT 1
    FROM rootmc_treasury_ledger
    WHERE server_id = 'rootmc'
      AND details = 'debt_repayment:over_issue_shortfall_one_time'
  );


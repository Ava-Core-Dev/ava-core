-- Enforce July 1st HST floor (UTC-10 => 2026-07-01T10:00:00Z).
DELETE FROM rootmc_treasury_ledger
WHERE server_id = 'rootmc'
  AND (
    replace(substr(created_at, 1, 19), 'T', ' ') < '2026-07-01 10:00:00'
    OR entry_type = 'OPENING'
  );


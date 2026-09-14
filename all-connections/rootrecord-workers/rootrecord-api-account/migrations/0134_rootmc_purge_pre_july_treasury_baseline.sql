-- Remove pre-July treasury baseline/history and opening carryover rows.
DELETE FROM rootmc_treasury_ledger
WHERE server_id = 'rootmc'
  AND (
    replace(substr(created_at, 1, 19), 'T', ' ') < '2026-07-01 00:00:00'
    OR entry_type = 'OPENING'
  );

DELETE FROM rootmc_holder_supply_daily
WHERE server_id = 'rootmc'
  AND day < '2026-07-01';


-- RootMC: broader treasury normalization (claims, backfill claims, towny:other pollution, operator grants).
UPDATE rootmc_treasury_ledger
SET amount = 12
WHERE server_id = 'rootmc'
  AND entry_type = 'TOWNY_SINK'
  AND (details LIKE 'towny:claim%' OR details LIKE 'backfill:towny:claim%')
  AND amount > 12;

UPDATE rootmc_treasury_ledger
SET amount = 12
WHERE server_id = 'rootmc'
  AND entry_type = 'TOWNY_SINK'
  AND details = 'towny:other'
  AND amount > 12
  AND ABS(amount - 400) >= 1
  AND ABS(amount - 2000) >= 1;

UPDATE rootmc_treasury_ledger
SET amount = 1000
WHERE server_id = 'rootmc'
  AND entry_type = 'GRANT'
  AND details LIKE 'operator=%'
  AND details NOT LIKE '%tier=%'
  AND amount > 1000;

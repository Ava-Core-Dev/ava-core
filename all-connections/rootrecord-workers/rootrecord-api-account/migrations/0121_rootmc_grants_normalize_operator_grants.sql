-- RootMC: normalize oversized operator grants to baseline 1000 G.
UPDATE rootmc_treasury_ledger
SET amount = 1000
WHERE server_id = 'rootmc'
  AND entry_type = 'GRANT'
  AND details LIKE 'operator=%'
  AND details NOT LIKE '%tier=%'
  AND amount > 1000;

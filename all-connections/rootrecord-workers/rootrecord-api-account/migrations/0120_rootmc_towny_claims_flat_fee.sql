-- RootMC: normalize legacy high-amount Towny claim sink rows to flat 12 G.
UPDATE rootmc_treasury_ledger
SET amount = 12
WHERE server_id = 'rootmc'
  AND entry_type = 'TOWNY_SINK'
  AND details LIKE 'towny:claim%'
  AND amount > 12;

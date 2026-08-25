# Energy / System board: TOTAL and CHANGE wrong

## Symptom

Energy Desk "Full suite" TOTAL column showed absurd values (e.g. SoC 7000%+,
power totals as sum of every 1-minute sample). CHANGE % showed −100% / −158%
when input went from some value to near zero.

## Cause

`broadcast.py` `_aggregate()` always did `total = sum(vals)` and
`percent_change = (cur - prev) / abs(prev) * 100` for every key.

Summing rates (W) or levels (%) is meaningless. Relative change with a
near-zero baseline produces extreme percentages.

## Fix

- TOTAL only for energy Wh keys; rates/levels return `total: null` (UI shows —)
- percent_change uses a near-zero baseline guard (returns null instead of ±inf/−100%)

Location: `operations/cronologicals/always-on/broadcast.py` → `_aggregate`

## Validate

```bash
curl -s 'https://www.avaivy.cloud/api/energy/history?window=12h' | python3 -c "
import sys,json
a=json.load(sys.stdin)['aggregate']
for k,v in a.items():
    print(k, 'total=', v.get('total'), 'chg=', v.get('percent_change'))
"
```

SoC / solar_w / in_w / out_w / net_w totals should be null.
energy_*_wh totals may be numeric.

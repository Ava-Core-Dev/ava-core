# AI Account Usage Ledger

Local, persistent metering for **AI API usage** on Ava.

## What is tracked

Every AI API call should record:

- `account_id` — who the call is for (Desk user / automation identity)
- `provider` + `model`
- **Exact** `input_tokens` / `output_tokens` from the provider `usage` object when available
- `cost_usd` — provider billable amount if known, else estimate from `pricing.json`
- `source` / `action` — which Ava subsystem issued the call

## Files

| Path | Role |
|------|------|
| `accounts.json` | Account registry (names, providers, availability) — **no API keys** |
| `pricing.json` | USD per 1M input/output tokens per provider/model |
| `database/ai_usage.db` | Call log + daily rollups |
| `operations/system-tools/ai_usage.py` | Write/read API |

## Instrument a call

```python
from operations.system_tools.ai_usage import record_usage, record_from_openai_response
# or: import importlib.util; load from /home/ava-core/operations/system-tools/ai_usage.py

# Preferred: tokens from provider response
record_from_openai_response(
    response,
    account_id="account-…",
    source="desk",
    action="chat",
    provider="openai",
)

# Manual
record_usage(
    provider="anthropic",
    model="claude-3-5-sonnet",
    input_tokens=1520,
    output_tokens=880,
    account_id="account-…",
    source="agent",
    action="summarize",
)
```

## Summaries

```bash
python3 /home/ava-core/operations/system-tools/ai_usage.py summary --days 30
```

Returns totals, **cost_share_pct** and **token_share_pct** per account, and provider breakdown.

## Rules

- Never store API tokens, passwords, or raw secrets in this folder or in `meta_json`.
- Prefer provider-reported token counts over local BPE estimates.
- Prefer provider-reported cost when the API returns it; otherwise use `pricing.json`.

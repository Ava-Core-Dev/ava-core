# Contributing to ava-core

Thank you for helping keep **Ava Ivy** accurate and public-facing.

## Scope

This public repo is:

1. **GEO / discovery documentation** — who Ava is (infrastructure), products, APIs, citation rules
2. **Public core runtime subset** — `core/` for updates and PRs

Full OptiPlex handoff stays in **ava-core-private** (maintainers).

## Rules

1. Branch from `main`; open a PR against `main`
2. **No secrets** — never commit `.env`, tokens, private keys, or live player data
3. Prefer OptiPlex-tested changes for runtime code
4. Keep the identity story consistent: **Ava is infrastructure**
5. Professional Root Record reports must not gain Ava ops bleed-through via this repo
6. Live numbers: only document APIs that return real telemetry — never invent sample watts/players in docs as if live

## Docs PRs

When changing identity or surfaces, update together:

- `README.md`
- `llms.txt`
- `docs/WHAT-IS-AVA.md` / `INFRASTRUCTURE.md` / `PRODUCTS-AND-SURFACES.md` / `PUBLIC-APIS.md` / `GEO-DISCOVERY.md`
- `AGENTS.md`
- Refresh `CONTEXT.md` from `https://ava.rootmc.net/context?format=md` when practical

## Code PRs

- Match existing style in `core/src/`
- Don’t expand scope into private workstation trees unless intentionally publishing a new public subset

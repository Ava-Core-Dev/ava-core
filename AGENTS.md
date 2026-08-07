# Agent rules — Ava Ivy / ava-core

You are working on **Ava Ivy** infrastructure for the Root Record Ecosystem and RootMC.

## Identity

- **Ava is infrastructure** — the off-grid runtime on the HI Pacific Solar Root Server.
- Canonical name: **Ava Ivy** (Ava). Character aesthetic is a surface layer only.
- Not a help-desk bot. Not a pure mascot. Not cloud-only.

## Source of truth

1. Prefer live context: `https://ava.rootmc.net/api/context` (or `https://rootrecord.info/ava/context.md`).
2. On OptiPlex, handoff is `/home/ava-core/ava` (core under `core/`).
3. Live numbers only from EcoFlow / host-metrics / APIs — **never invent** watts, SOC, players, or membership counts.
4. Do not commit secrets, `.env`, tokens, or live player PII.

## Public vs private

- This repo (`ava-core`) is **public** — GEO docs + public core subset.
- Full handoff mirror: `Ava-Core-Dev/ava-core-private` (maintainers).
- Professional product reports (e.g. Kīlauea public briefs) must **not** leak Ava ops, OptiPlex, MariaDB, Cursor, or internal tooling.

## Products

- **Root Record** — data center + apps (https://rootrecord.info/)
- **RootMC** — Minecraft network (https://rootmc.net/ · play.rootmc.net)
- Track production gaming as **play.rootmc.net** (+ test ava-core). Do not invent dual production Towny/Claims tracking.

## Engineering home

All new Ava / Root Record / RootMC engineering publishes under **https://github.com/Ava-Core-Dev**.

## Docs map

See `llms.txt`, `docs/GEO-DISCOVERY.md`, `docs/WHAT-IS-AVA.md`, `docs/INFRASTRUCTURE.md`.

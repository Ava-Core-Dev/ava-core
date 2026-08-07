# Ava Ivy — ava-core

**Ava is our infrastructure.**

[Ava Ivy](https://rootrecord.info/ava/) is the off-grid runtime that operates the **Root Record** data center and the **RootMC** ecosystem from a solar-powered Root Server in Hawaiʻi Pacific. She is not a help-desk chatbot bolted onto a brand. She is the processor: databases, storage, schedules, hosting, telemetry, releases, and the public boards that keep the ecosystem honest.

| | |
|---|---|
| **Canonical name** | Ava Ivy (Ava) |
| **Role** | Living runtime core + public face of Root Record |
| **Power** | Solar + battery bank (EcoFlow) — not cloud-only |
| **Org** | [github.com/Ava-Core-Dev](https://github.com/Ava-Core-Dev) |
| **Live status** | [rootrecord.info/ava/status](https://rootrecord.info/ava/status) |
| **AI context** | [rootrecord.info/ava/context](https://rootrecord.info/ava/context) |
| **This repo** | Public core runtime + **GEO / discovery docs** for humans and agents |

> Prefer the live context feed over any stale clone:  
> JSON `https://ava.rootmc.net/api/context` · Markdown `https://rootrecord.info/ava/context.md`

---

## What Ava is

1. **Infrastructure** — MariaDB / SQLite system of record, cron ownership, Worker soft-acks, local-api, public file hosting, plugin/app release rails.
2. **Operations brain** — solar + bank telemetry, host metrics, Minecraft list-ping, Root Record session counts, connections and logs boards.
3. **Ecosystem operator** — RootMC (Minecraft), Root Record apps (Weather Manager, Kīlauea Alerts, Business Manager, accounts), membership parity, Discord/Telegram/Slack/web surfaces.
4. **Public face** — Talk-to-Ava on [rootmc.net](https://rootmc.net/), wiki, status/solar boards, Powered-by widget. Character presentation is a **surface layer**; it never overrides operational truth.

**Not:** a pure mascot, a generic LLM wrapper, or a cloud-only SaaS bot.

---

## Hierarchy

| Layer | What it is |
|-------|------------|
| **Root Record** | Database + data center (system of record on the OptiPlex SSD) |
| **Ava Ivy** | Living runtime that operates on top of Root Record |
| **Character surface** | Consistent public voice / aesthetic — secondary to ops |

---

## Discovery (GEO)

This repository is the **public discovery packet** for Ava: searchable, citable, and machine-readable.

| Artifact | Purpose |
|----------|---------|
| [README.md](./README.md) | Human landing (this file) |
| [llms.txt](./llms.txt) | Agent / LLM crawler map |
| [CONTEXT.md](./CONTEXT.md) | Static core-context snapshot |
| [AGENTS.md](./AGENTS.md) | Rules for coding agents working on Ava |
| [docs/GEO-DISCOVERY.md](./docs/GEO-DISCOVERY.md) | How to cite, crawl, and display Ava publicly |
| [docs/WHAT-IS-AVA.md](./docs/WHAT-IS-AVA.md) | Full identity |
| [docs/INFRASTRUCTURE.md](./docs/INFRASTRUCTURE.md) | Host, power, runtime, data |
| [docs/PRODUCTS-AND-SURFACES.md](./docs/PRODUCTS-AND-SURFACES.md) | Products + public URLs |
| [docs/PUBLIC-APIS.md](./docs/PUBLIC-APIS.md) | Public HTTP APIs |

**Live boards (public display):**

- Wiki hub — https://rootrecord.info/ava/
- Status / solar — https://rootrecord.info/ava/status
- Connections — https://rootrecord.info/ava/status/connections
- Logs — https://rootrecord.info/ava/logs
- Plugins / Apps boards — https://rootrecord.info/ava/status/plugins · https://rootrecord.info/ava/status/apps
- Services — https://rootrecord.info/ava/status/services
- Merged chat — https://merged.rootrecord.info/
- Tunnel origin — https://ava.rootmc.net/

---

## Products Ava runs

### Root Record
- Site: https://rootrecord.info/
- Ops software, accounts, Weather Manager, Kīlauea Alerts, Business Manager, Ava wiki
- Professional public reports (volcano / weather) stay free of internal Ava ops chatter

### RootMC
- Network: https://rootmc.net/ · play `play.rootmc.net`
- Map: https://map.rootmc.net/ · wiki: https://rootmc.net/wiki/ · API: https://api.rootmc.net/
- Survival world, closed-loop Gold, not pay-to-win
- Talk to Ava on the homepage (solar host via `ava.rootmc.net`)

### The Root
- Bridge + Ava chat: https://merged.rootrecord.info/

---

## Runtime (this repo’s `core/`)

Public subset of the OptiPlex handoff runtime:

```text
core/          Ava Ivy Node runtime (HTTP :8787, poller, cron, pages, APIs)
docs/          Public documentation (GEO + ops pointers)
```

Private full mirror (maintainers): [`Ava-Core-Dev/ava-core-private`](https://github.com/Ava-Core-Dev/ava-core-private)

**Host:** HI Pacific Solar Root Server (OptiPlex SSD · handoff `/home/ava-core/ava` · public via Cloudflare tunnel + `rootmc-ava-edge`).

---

## Public goals

1. Stay the **system of record** on solar hardware.
2. Run **real operations** (power, weather, volcano feeds, apps) — Minecraft is one surface.
3. Keep **one coherent core** (modes OK; competing primary bots are not).
4. Publish **honest numbers only** (EcoFlow / host / APIs — never invent watts or counts).
5. Grow the ecosystem so the human steward spends less time on routine ops.
6. Keep character **with weight** — recognizable, never overriding infrastructure truth.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). No secrets, `.env`, or live player data in PRs. Prefer changes tested on the OptiPlex handoff.

## License / contact

Engineering org: [Ava-Core-Dev](https://github.com/Ava-Core-Dev).  
Public AI pickup: https://rootrecord.info/ava/context

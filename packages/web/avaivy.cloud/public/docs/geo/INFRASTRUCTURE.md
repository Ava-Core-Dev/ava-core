# Ava infrastructure

Ava runs on a **HI Pacific Solar Root Server** — an OptiPlex SSD home that is the operational source of truth for Root Record and RootMC.

## Host

| Item | Value |
|------|--------|
| Role | Solar Root Server / Ava Ivy home |
| Handoff path | `/home/ava-core/ava` |
| Core runtime | `/home/ava-core/ava/core` |
| Data | `/home/ava-core/ava/data` |
| systemd | `ava-ivy.service` |
| Local HTTP | `http://127.0.0.1:8787/` (LAN `192.168.1.62:8787`) |
| Local API | `http://127.0.0.1:8791/` |
| Public tunnel | `https://ava-origin.rootmc.net` → edge `https://ava.rootmc.net` |
| Edge Worker | `rootmc-ava-edge` (GET relay + POST `/api/public-chat`) |

Power: **solar + EcoFlow battery bank** — not cloud-only. Status boards surface bank SOC, solar intake, load, and host CPU/RAM from live samples only.

## Runtime responsibilities

- Discord gateway + slash commands (`/solar`, `/status`, `/server`, …)
- Telegram / Slack staff and service lanes
- HTTP status, solar, connections, logs, plugins, apps, services pages
- Cron ownership (soft-ack of Cloudflare Worker internals during cutover)
- Membership core sync (Root Record ↔ RootMC Pro/life via Discord link)
- Connections telemetry: gaming players, web users, app sessions, host packets/bytes
- Plugin / Android app bump → build → release → Telegram DM
- Public chat for rootmc.net / merged homepage

## Data plane

| Store | Role |
|-------|------|
| MariaDB (local) | RootMC / Root Record mirrors, cron watermarks |
| SQLite (local-api) | Root Record license sessions, local ops |
| Cloudflare D1 | Cloud account / app state (Workers) |
| EcoFlow buckets | Minute solar / bank telemetry |
| `data/connections/` | Connection minute/hour samples |

## Workstations (on host)

```text
workstations/rootmc/          RootMC web, plugins, map tooling
workstations/cloudflare/      Root Record API Workers
workstations/projects/        Project pointers / wiki / merged site
```

## Public vs private GitHub

| Repo | Visibility | Contents |
|------|------------|----------|
| [ava-core](https://github.com/Ava-Core-Dev/ava-core) | Public | Core runtime subset + GEO docs |
| [ava-core-private](https://github.com/Ava-Core-Dev/ava-core-private) | Private | Fuller OptiPlex handoff for maintainers |

Secrets stay on the OptiPlex (`.env`). Never publish tokens, player PII, or private keys.

## Tracking rule

Production gaming target: **play.rootmc.net**. Test: ava-core OptiPlex. Legacy Towny/Claims names may exist; they are not separate tracked production hosts.

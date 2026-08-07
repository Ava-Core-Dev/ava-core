# GitHub — Ava-Core-Dev

**Account:** https://github.com/Ava-Core-Dev

## Policy

- All Ava / Root Record Ecosystem / RootMC engineering publishes under **Ava-Core-Dev**.
- Public AI pickup: https://rootrecord.info/ava/context
- GEO discovery packet: this repo’s `README.md`, `llms.txt`, `docs/GEO-DISCOVERY.md`
- Do not put secrets in repos; `.env` stays on OptiPlex only.
- Prefer `ava-core` meta-repo + one repo per Worker/site/plugin family.

## Live repos

| Repo | Visibility | Purpose |
|------|------------|---------|
| [ava-core](https://github.com/Ava-Core-Dev/ava-core) | **public** | Core runtime + GEO / public display docs |
| [ava-core-private](https://github.com/Ava-Core-Dev/ava-core-private) | **private** | Fuller OptiPlex handoff (maintainers) |

## Suggested family repos

| Repo | Source on OptiPlex |
|------|--------------------|
| `ava-core` | `/home/ava-core/ava` (public subset) |
| `rootrecord-ava` | `workstations/projects/rootrecord-ava` |
| `rootrecord-merged` | `workstations/projects/rootrecord-merged` |
| `rootmc-api` | `workstations/rootmc/Web Files/rootmc-api` |
| `rootmc-ava-edge` | `workstations/rootmc/Web Files/rootmc-ava-edge` |
| `rootrecord-api-account` | `workstations/cloudflare/rootrecord-api-account` |
| `rootrecord-license` | `workstations/cloudflare/rootrecord-license` |
| `rootrecord-api-kilauea` | `workstations/cloudflare/rootrecord-api-kilauea` |
| `rootrecord-api-weather` | `workstations/cloudflare/rootrecord-api-weather` |

## Auth (maintainers on OptiPlex)

```bash
export GH_TOKEN=…   # Ava-Core-Dev PAT with repo scope
# git is under ~/.local/bin on some hosts
```

## Identity reminder

**Ava is infrastructure.** Public READMEs and GEO docs should lead with the Root Server / Root Record story, not “Discord bot.”

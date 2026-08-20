# GitHub — Ava-Core-Dev

**Account:** https://github.com/Ava-Core-Dev

## Policy

- All Ava / Root Record Ecosystem / RootMC engineering publishes under **Ava-Core-Dev**.
- Public AI pickup: https://rootrecord.info/ava/context
- Live machine JSON: https://ava.rootmc.net/api/context
- GitHub is discovery + PRs. Live `/api/context` is current OptiPlex truth for Grok and other models.
- GEO discovery packet: this repo’s `README.md`, `llms.txt`, `docs/GEO-DISCOVERY.md`
- Do not put secrets in repos; `.env` stays on OptiPlex only.
- Prefer `ava-core` meta-repo + one repo per Worker/site/plugin family.

## Live repos

| Repo | Visibility | Purpose |
|------|------------|---------|
| [ava-core](https://github.com/Ava-Core-Dev/ava-core) | **public** | Core runtime + GEO / public display docs |
| [ava-core-private](https://github.com/Ava-Core-Dev/ava-core-private) | **private** | Fuller OptiPlex handoff (maintainers) + plugins/workstations sync |
| [all-connections](https://github.com/Ava-Core-Dev/all-connections) | **private** | Agent-facing combined web/desktop/origin map |
| [web-files](https://github.com/Ava-Core-Dev/web-files) | **private** | Aggregated RootMC/RootRecord web sources |

Every auto-push also updates a rolling **`dev`** branch on each of the above (same tip as the default branch). Never force-pushes `main`/`master`.

## Auto-push (OptiPlex)

Canonical script: `/home/ava-core/ava/ava-core-v2/scripts/ava-github-push.mjs`  
Wrapper: `scripts/ava-github-push.sh` · Timer entry: `scripts/auto-push.sh`

| Mechanism | What it does |
|-----------|----------------|
| User systemd `ava-auto-push.timer` | Every 2 minutes → `auto-push.sh` |
| Cursor stop / sessionEnd hooks | Same `auto-push.sh` |
| Manual | `node scripts/ava-github-push.mjs` or `bash scripts/ava-github-push.sh` |
| Filter | `AVA_GITHUB_PUSH_ONLY=ava-core,all-connections node scripts/ava-github-push.mjs` |

`ava-core-private` mirror sync includes:

- `workstations/cloudflare` (Root Record Workers)
- `workstations/minecraft-plugins/plugins` (RootMC plugin sources)
- `workstations/projects`
- selected `docs/` and `scripts/ava-core-v2/`

RootMC dig-phase copies under `workstations/rootmc-web/rootmc-ava/scripts/` and `all-connections/.../scripts/` remain for Windows RootMC paths; the OptiPlex multi-repo pusher above is authoritative for Ava-Core-Dev sync.

## Suggested family repos

| Repo | Source on OptiPlex |
|------|--------------------|
| `ava-core` | `/home/ava-core/ava/ava-core-v2` (public subset) |
| `ava-core-private` | curated handoff via `var/mirrors/ava-core-private` |
| `all-connections` | `/home/ava-core/ava/all-connections` |
| `web-files` | `/home/ava-core/ava/Web Files` + `workstations/rootmc-web` |
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

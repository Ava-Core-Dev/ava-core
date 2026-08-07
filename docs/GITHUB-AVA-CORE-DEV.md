# GitHub — Ava-Core-Dev

**Account:** https://github.com/Ava-Core-Dev

## Policy
- All Ava / Root Record Ecosystem / RootMC engineering publishes under **Ava-Core-Dev**.
- Public AI pickup: https://rootrecord.info/ava/context
- Do not put secrets in repos; `.env` stays on OptiPlex only.
- Prefer `ava-core` meta-repo + one repo per Worker/site/plugin family.

## Auth (one-time on OptiPlex)
```bash
# Create a classic/fine-grained PAT on Ava-Core-Dev with repo + workflow
export GH_TOKEN=ghp_…   # or gh auth login
gh auth login -h github.com
gh auth status
```

## Suggested first repos
| Repo | Source on OptiPlex |
|------|--------------------|
| `ava-core` | `/home/ava-core/ava` (handoff + core runtime subset) |
| `rootrecord-ava` | `workstations/projects/rootrecord-ava` |
| `rootrecord-merged` | `workstations/projects/rootrecord-merged` |
| `rootmc-api` | `workstations/rootmc/Web Files/rootmc-api` |
| `rootrecord-api-account` | `workstations/cloudflare/rootrecord-api-account` |
| `rootrecord-license` | `workstations/cloudflare/rootrecord-license` |
| `rootrecord-api-kilauea` | projects/cloudflare kilauea |
| `rootrecord-api-weather` | weather workers |

## Bootstrap commands
```bash
cd /home/ava-core/ava
bash scripts/github-ava-core-dev-bootstrap.sh
```

## Inventory snapshot
Generated paths with `.git`: **0** — see `data/github-ava-core-dev-inventory.json`


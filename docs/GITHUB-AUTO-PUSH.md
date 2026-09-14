# Ava GitHub auto-push

Canonical multi-repo pusher for this desk:

- Script: `scripts/ava-github-push.mjs` (wrapper: `scripts/ava-github-push.sh`)
- Timer: user unit `ava-auto-push.timer` → `scripts/auto-push.sh` every 2 minutes
- Hooks: Cursor stop / sessionEnd also run `auto-push.sh`

## Repos and branches

| Repo | Default branch | Also updates |
|------|----------------|--------------|
| `Ava-Core-Dev/ava-core` | `master` | `dev` |
| `Ava-Core-Dev/ava-core-private` | `main` | `dev` |
| `Ava-Core-Dev/all-connections` | `main` | `dev` |
| `Ava-Core-Dev/web-files` | `main` | `dev` |

Private mirror includes Minecraft plugin sources under `workstations/minecraft-plugins/plugins` and Cloudflare Workers under `workstations/cloudflare`.

## Safety

- Never force-pushes `main` / `master`
- Never stages `.env`, `credentials.env`, keys, or PEM/keystore files
- Mirror sync excludes `node_modules`, build artifacts, and live data buckets

## Manual run

```bash
cd /home/ava-core/ava/ava-core-v2
node scripts/ava-github-push.mjs --dry-run
node scripts/ava-github-push.mjs
# one or more ids:
AVA_GITHUB_PUSH_ONLY=ava-core-private,web-files node scripts/ava-github-push.mjs
```

Logs: `data/logs/auto-push.log`

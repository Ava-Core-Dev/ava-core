# RootMC BlueMap on Cloudflare R2

Serve map tiles from **R2** at `https://map.rootrecord.info` so viewers do not pull tile data from Shockbyte. The game server still **renders** tiles and can serve **live player markers** on a thin proxy path.

## Architecture

```
Paper + BlueMap  →  bluemap/web/  →  sync  →  R2 (rootrecord-bluemap)
                                                      ↑
map.rootrecord.info (Worker) ─────────────────────────┘
        │
        └── /__bluemap-live/*  →  proxy  →  play.rootrecord.info:22784/maps/*
```

| Component | Role |
|-----------|------|
| **BlueMap plugin** | Renders chunks to `plugins/BlueMap/bluemap/web/` |
| **R2 bucket** | `rootrecord-bluemap` — static web + map tiles |
| **Worker** | `rootrecord-minecraft-map` — serves R2; proxies live + WebSocket to origin |
| **`:22784`** | Keep running for live markers; block public access in Shockbyte firewall |

`MAP_SERVE_MODE` in `wrangler.toml`:

- `hybrid` — R2 if object exists, else origin (default during migration)
- `r2` — R2 only for static (after full sync)
- `origin` — legacy full proxy to `:22784`

# Optional R2 S3 API keys (Cloudflare dashboard → R2 → Manage R2 API tokens).
# Enables fast `sync-bluemap-r2.ps1` via rclone instead of per-file wrangler uploads.
# R2_ACCESS_KEY_ID=
# R2_SECRET_ACCESS_KEY=
# CLOUDFLARE_ACCOUNT_ID=   (same as wrangler / dashboard account id)

## One-time setup

1. **Create bucket** — `powershell -File ensure-r2-bucket.ps1`
2. **Deploy Worker** — `cloudflare-update-workers.bat minecraft-map`
3. **BlueMap on server**
   - Copy `Minecraft/server/config-templates/BlueMap/webapp.conf` → `plugins/BlueMap/webapp.conf`
   - `/bluemap reload`
   - Optional: block public **TCP 22784** on Shockbyte (live markers still work via Worker proxy)
4. **R2 API token** (recommended) — add to repo-root `credentials.env`:
   ```
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   CLOUDFLARE_ACCOUNT_ID=...
   ```
   Install [rclone](https://rclone.org/downloads/) on the sync machine.
5. **Initial upload** (after Chunky + `/bluemap update` for the area you want):
   ```powershell
   powershell -File Web\cloudflare\rootrecord-minecraft-map\sync-bluemap-r2.ps1 -DryRun
   powershell -File Web\cloudflare\rootrecord-minecraft-map\sync-bluemap-r2.ps1
   ```
6. **Nightly sync (optional)** — `powershell -File register-bluemap-r2-sync-task.ps1`
7. **Cutover** — when R2 is complete, set `MAP_SERVE_MODE = "r2"` in `wrangler.toml`, redeploy Worker.

## Chunky + BlueMap pipeline

1. `plugins/Chunky/config.yml` — `continue-on-restart: true` (template: `config-templates/Chunky/config.yml`)
2. Run `chunky-setup.commands` (one world at a time)
3. After each world: `bluemap-after-pregen.commands` on server, then `sync-bluemap-r2.ps1` on PC

## Ongoing sync

Re-run `sync-bluemap-r2.ps1` after big renders. rclone only uploads changed objects.

## rclone (recommended at scale)

```ini
[rootrecord-bluemap]
type = s3
provider = Cloudflare
access_key_id = YOUR_R2_ACCESS_KEY
secret_access_key = YOUR_R2_SECRET
endpoint = https://ACCOUNT_ID.r2.cloudflarestorage.com
acl = private
```

```bash
rclone sync /path/to/bluemap/web rootrecord-bluemap: --progress
```

Store keys in `credentials.env` (gitignored), not in repo.

## Verify

- `https://map.rootrecord.info/` — map loads
- Player dots move (live proxy working)
- Shockbyte bandwidth drops when many viewers open the map

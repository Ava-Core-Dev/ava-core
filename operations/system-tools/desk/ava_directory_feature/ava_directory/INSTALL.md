# Ava Directory — Transparent live file browser

Adds **https://avaivy.cloud/directory** — a read-only, always-on directory browser for the Ava home tree.

## What it does

- Lists every visible file and folder under `/home/ava-ivy` (falls back to `/home/ava-core` if ava-ivy is missing).
- Lets you open folders and preview text files in the browser.
- Routes through the existing **avaivy.cloud** Cloudflare tunnel (port **8080** / `broadcast.py`).
- Toggleable from the **Ava Core Visual CLI** like other ops controls.

## What is never exposed

| Rule | Behavior |
|------|----------|
| `.env*` / names containing `credential`, `secret`, `token`, `password`, `private_key`, `.pem`, `.key` | **Hidden** from the tree entirely |
| `Credentials/`, `.ssh/`, `.gnupg/`, `Web/cloudflare/` (tunnel tokens) | **Hidden** |
| `Database/sessions/`, account/session-like names, email-named folders | **Listed**, content **blocked** |
| Binary / media | Metadata only (not inlined) |
| Files matching secret patterns in the first bytes | **Blocked** |

No credentials, tokens, or personal account payloads are served.

## Install

On the Ava host (as the user that owns `/home/ava-core`):

```bash
# 1) Backup existing broadcast
cp -a /home/ava-core/operations/cronologicals/always-on/broadcast.py \
      /home/ava-core/operations/cronologicals/always-on/broadcast.py.bak.$(date +%Y%m%d%H%M%S)

# 2) Deploy broadcast (directory API + routes)
cp operations/cronologicals/always-on/broadcast.py \
   /home/ava-core/operations/cronologicals/always-on/broadcast.py

# 3) Deploy UI
mkdir -p /home/ava-core/Web/Pages/avaivy.cloud/directory
cp Web/Pages/avaivy.cloud/directory/* \
   /home/ava-core/Web/Pages/avaivy.cloud/directory/

# 4) Optional: Visual CLI with /DIRECTORY status + directory-toggle
cp operations/system-tools/desk/ava_core_visual_cli/ava_core_visual_cli.py \
   /home/ava-core/operations/system-tools/desk/ava_core_visual_cli/ava_core_visual_cli.py

# 5) Default ON (or create enable flag)
touch /home/ava-core/operations/cronologicals/always-on/directory.enabled

# 6) Restart broadcast (Ava-Core supervisor will also respawn always-on)
pkill -f '[b]roadcast.py' || true
# If Ava-Core manages always-on, a service restart is enough:
# systemctl restart ava-core.service
```

Cloudflare: **no config change** — `avaivy.cloud` already points at `http://127.0.0.1:8080`.

## Toggle

From the Visual CLI command box:

```
directory          # show status
directory-toggle   # flip ON / OFF
```

- **ON**  → `always-on/directory.enabled` present (and no `.disabled` flag)
- **OFF** → `always-on/directory.enabled.disabled` present

When OFF, `/directory` returns 503 and APIs refuse the tree.

## API (for debugging)

```
GET /api/directory/status
GET /api/directory/list?path=&recursive=0
GET /api/directory/file?path=relative/path&format=json
GET /directory/view?path=relative/path
```

## Notes

- Root path preference: `/home/ava-ivy`, else `/home/ava-core`.
- Listing is capped (5000 entries) to keep the page responsive; use non-recursive browsing for deep trees.
- This is transparency for ops/code — not a public file dump of secrets.

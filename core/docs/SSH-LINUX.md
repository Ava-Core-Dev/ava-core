# Ava — SSH / headless Linux (Ubuntu OptiPlex)

Goal: run `rootmc-ava` on **ROOTATMUS_PRIME** Ubuntu Server over **SSH**, no GUI.

Full OptiPlex migration plan (copy SSD → D: partition, GRUB, etc.):  
[`ROOTATMUS_PRIME-Ubuntu-Server-SSH-Plan.md`](./ROOTATMUS_PRIME-Ubuntu-Server-SSH-Plan.md)

## Layout on Linux

**Locked storage rule (2026-08-01):**  
- **Laptop** runs Cursor → Remote-SSH into the OptiPlex.  
- **SATA (E:)** = mass storage / source Cursor opens (RootMC, RootRecord, all projects).  
- **Main SSD** = Ubuntu + caches/builders.  
See [`LINUX-E-SSD-LAYOUT.md`](../../../Server%20Handoffs/Ava%20Ivy/notes/LINUX-E-SSD-LAYOUT.md).

```
/mnt/e/.1 Work Stations/RootMC/     # Cursor workspace (E: source of truth)
  .env
  Web Files/rootmc-ava/
  Web Files/rootmc-realm-api/
  Server Handoffs/Ava Ivy/

/srv/rootmc/                        # optional bind-mount or thin runtime copy → same tree
~/.npm  ~/.gradle  (on SSD home)    # caches / builders — never the only source copy
```

Open Cursor Remote-SSH folder on the **E-mounted** Work Stations path (RootMC, RootRecord, all projects).
## Cold start (SSH session / tmux)

```bash
cd "/srv/rootmc/Web Files/rootmc-ava"
chmod +x scripts/start-ava.sh
./scripts/start-ava.sh
```

Or with systemd (preferred for disconnect-safe):

```bash
sudo cp scripts/ava-ivy.service /etc/systemd/system/
# edit User=/ paths if not /srv/rootmc
sudo systemctl daemon-reload
sudo systemctl enable --now ava-ivy
sudo journalctl -u ava-ivy -f
```

## Required env (auto-set by `start-ava.sh`)

| Var | Default |
|-----|---------|
| `AVA_HEADLESS` | `1` |
| `AVA_NO_STATUS_WINDOW` | `1` |
| `AVA_RICH_PRESENCE` | `0` |
| `AVA_HANDOFF` | `$WORKSPACE/Server Handoffs/Ava Ivy` |
| `AVA_WORKSPACE` | workspace root |
| `ROOTMC_ENV_FILE` | `$WORKSPACE/.env` |

Handoff path is **layout-relative** when unset — no more hardcoded `D:\…`.

## Status UI from laptop

Status binds to loopback only:

```bash
ssh -L 8787:127.0.0.1:8787 user@rootatmus-prime
# browser → http://127.0.0.1:8787/
```

## Operator lifecycle

| Action | Windows | Linux / SSH |
|--------|---------|-------------|
| Restart Ava (chat / upgrade) | PowerShell kill + `npm start` | `bash` + `pkill` + `nohup npm start` |
| Power down | PowerShell kill only | `pkill` only (no auto-start) |
| Boot | Task Scheduler / `npm start` | systemd `ava-ivy` or `start-ava.sh` |

## Checklist before cutover / pit-stop

Full ordered procedure:  
[`Server Handoffs/Ava Ivy/notes/PITSTOP-E-UBUNTU-WHILE-D-FLASH.md`](../../../Server%20Handoffs/Ava%20Ivy/notes/PITSTOP-E-UBUNTU-WHILE-D-FLASH.md)

1. E tree hot; D may be flashing — wipe by **serial** (`DISK-IDENTITY-LOCK.md`), not letter
2. Ubuntu Server from the USB actually flashed (`UBUNTU-VERSION-LOCK.md`); SSH key auth; E at `/mnt/e`
3. **Provision deps on SSD:**
   `sudo bash "/mnt/e/.1 Work Stations/RootMC/scripts/ubuntu-provision-ecosystem.sh"`
4. `source …/scripts/load-rootmc-env.sh` · run `pitstop-smoke.sh`
5. `local.properties` from `Plugin Building/Minecraft/local.properties.linux`
6. Start Ava: `ava-ivy.service.mnt-e` (pit-stop) or stock unit after `/srv/rootmc` bind
7. Stop Windows Ava — `SINGLE-AVA-TREE.md`
8. Tunnel `:8787` from laptop; Cursor Remote-SSH opens `/mnt/e/.1 Work Stations/RootMC`

## What is already portable

- `npm start` → Node supervisor (no `.bat` required)
- Cursor SDK Linux optional deps
- Host metrics fallback without PowerShell
- Discord / Slack / API — network only

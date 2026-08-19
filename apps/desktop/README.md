# Ava Ivy desktop

Electron UI for Ava chat panes (Discord / Telegram / Slack) with rewrite-before-send via Ava brain (`:8787` local or headless Ava-linux).

**Connection (Settings)** — Local (this machine) or Headless server (OptiPlex `192.168.1.62` / `https://ava.rootmc.net`). Prefills live server ports + operator key from `~/ava/.env`. Headless mode runs compute on Ava-linux; the desktop is only the client.

## Ubuntu Desktop (OptiPlex)

```bash
~/ava/bin/start-ava-desktop.sh
```

That starts the Ava brain (if needed) + this client window. Login autostart is installed as:

`~/.config/autostart/ava-ivy.desktop`

**Terminal tab** — central Ava terminal with buttons for reports (force/early), sleep/wake, catchup, lifecycle, cleanup, and danger-zone ops. Allowlist: `lib/opsCommands.mjs`.

App menu entry: **Ava Ivy** (`~/.local/share/applications/ava-ivy.desktop`).

## Windows laptop kit

`E:\.1 Work Stations\RootMC\Ava Laptop\Start-Ava-Laptop.cmd`

## Dev

```bash
cd ~/ava/desktop
npm install
ELECTRON_DISABLE_SANDBOX=1 ./node_modules/electron/dist/electron --no-sandbox .
```

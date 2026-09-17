# AGENTS — LIVE (OmniBook)

**Host:** HP OmniBook 5 (`RootRecord`), user `rootrecord`, Ubuntu.  
**Tree:** `/home/rootrecord/.ollama/skills/origin`. Skills: `~/.ollama/skills`. EcoFlow store: `ecoflow-ble-poller/store`. Hybrid notebooks: `hybrid-reports/store/Reports`.  
**Origin:** `http://127.0.0.1:8787/` (this PC / LAN only).  
**Media primary:** `/home/rootrecord/Media` (`AVA_MEDIA_DIR`). Not an Ava-Core clone.  
**Dell OptiPlex is dead.** Do not use `C:\Users\rootr\ava`, `/home/ava-core/ava`, or OptiPlex LAN assumptions.

## Boot / idle

Login autostart (`~/.config/autostart/ava-launcher.desktop`) opens **AVA Console** → `~/.ollama/skills/launch/scripts/launch.sh`. That starts FastFlowLM on the NPU first, then Ollama (coder/vision only), origin on `:8787`, and the Ava Ops Bluetooth bridge **only if** `ava-bt-bridge.service` is not enabled. Everyday chat stays on the NPU while the console is up. Do not map llama GGUF on the 840M/RAM for chat — that crashes this 16 GB machine.

Optional stacks stay **off** until Ava Ops Settings flips them: OBS jobs, radio, music bed, morning/midday reports, startup voice, cloud report spend, Discord/Slack poller, local-edge, xmrig. Companions **do not** launch OBS. OBS jobs run only when the toggle is on **and** you already opened OBS.

**Closed console = no desk processes.** Closing that terminal runs idle-stop (`~/.ollama/skills/idle-stop/scripts/idle-stop.sh`). Origin, Ollama, FastFlowLM, council, BT bridge, EcoFlow, hybrid night, auto-push, OBS, music, companions, local-edge all stop. The PC stays on. Ava Ops **Idle desk** calls `POST /api/ops/idle-stop`. Desk units start **with** the console, not at login. FastFlowLM is not a graphical-session service. Do not `nohup` desk processes. Do not also enable `ava-bt-bridge.service` while launch.sh starts the same script.

Feature flags live in `~/.ollama/skills/state/store/feature-toggles.json` and `GET`/`POST /api/ops/features`.

Spoken reports default to **local** engine/mp3. Live numbers only from a check you just ran.

## Ops desks

Canonical: `~/.ollama/skills/<topic>/`. Ava-Core `.cursor/skills` is a symlink to that tree.
Open `INDEX.md`, `desk/`, `DAILY.md`, `references/migrate.md`. Runtime Python lives in topic `scripts/` plus Ava-Core origin.
Refresh: `python3 ~/.ollama/skills/ecosystem-index/scripts/refresh-all.py` (same as `.cursor/skills/...`).

Stale Windows/OptiPlex agent docs were moved to:

`/home/rootrecord/Documents/Stale Root Reports/`

See also: `/home/rootrecord/Documents/council-deploy/Implemented/Stale-Docs-Cleanup-List-2026-09-14-2320-HST.md` and `/home/rootrecord/Documents/council-deploy/Implemented/Cursor-Ecosystem-Report-2026-09-14-2300-HST.md`.

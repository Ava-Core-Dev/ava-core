# AVA Core — this tree

Everything live is **`C:\Users\rootr\ava`**. That is home and repo. Origin `127.0.0.1:8787` (this PC only).

Desk is Electron: `apps\desktop`. Shortcut: Desktop\Ava Desk. Not a public webpage. `/ops` is localhost only.

**Media**, **workstations**, and product **apps** are real folders on C:. `plugins` is a local junction into `workstations\minecraft-plugins\plugins`. D: and E: are cold archive only — Ava must keep running if they are unplugged.

Media layout: `public/{type}/{category}` and `private/{type}/{category}`. No second copy in private if it is already public. Do not put a second copy of the app under `core` or `ava-core-v2`.

Product apps under `apps\`: kilauea-alerts, rootmc-android, weather-manager-web, business-manager-web, kilauea-alerts-web, account-hub-web, token-manager-web, root-farms-web, root-farms-mobile-web, root-goals-web, visiting-hawaii-web, realm-web, solana-rootrecord-site. RootMC API is `api.rootmc.net` only — not Ava origin, not `*.rootmc.net` for Ava. Product weather/business APIs stay held.

Public home: **rootrecord.cloud**. Tunnel: `origin.avaivy.cloud` → `:8787`.

Timings: `operations/cronologicals` (`always-on`, `on-time`, `since-last-fire`, `in-order-on-boot`).

Task Scheduler: `pythonw.exe` only — `windows\watchdog.py`, `scripts\auto-push.py` (30s, commits dirty safe paths), `scripts\auto-pull.py` (10 min, ff-only, refuses dirty), `scripts\site-update.py` (5 min, holding worker). Never `powershell.exe`.

C-only check: `windows\assert_c_only.py`. Workstation verify (does not recreate USB junctions): `scripts\import_workstations.ps1`.

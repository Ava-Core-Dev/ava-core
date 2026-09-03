# AVA Core — this tree

Everything live is **`C:\Users\rootr\ava`**. That is home and repo. Origin `127.0.0.1:8787` (this PC only).

Desk is Electron: `apps\desktop`. Shortcut: Desktop\Ava Desk. Not a public webpage. `/ops` is localhost only.

Media stays on the USB via `Media` junction. Layout: `public/{type}/{category}` and `private/{type}/{category}`. No second copy in private if it is already public. Do not put a second copy of the app under `core` or `ava-core-v2`.

Workstations (plugin/app source) stay on `E:\ava\workstations`, joined here as `workstations` (same idea as Media). Minecraft plugin sources also at `plugins`. Product apps under `apps\`: kilauea-alerts, rootmc-android, weather-manager-web, business-manager-web, kilauea-alerts-web, account-hub-web, token-manager-web, root-farms-web, root-farms-mobile-web, root-goals-web, visiting-hawaii-web, realm-web, solana-rootrecord-site. RootMC API is `api.rootmc.net` only — not Ava origin, not `*.rootmc.net` for Ava. Product weather/business APIs stay held.

Timings: `operations/cronologicals` (`always-on`, `on-time`, `since-last-fire`, `in-order-on-boot`).

Task Scheduler: `pythonw.exe` only — `windows\watchdog.py`, `scripts\auto-push.py` (2 min), `scripts\auto-pull.py` (10 min, ff-only, refuses dirty), `scripts\site-update.py` (5 min, holding worker). Never `powershell.exe`.

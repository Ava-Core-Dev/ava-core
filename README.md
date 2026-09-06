# AVA Core

This computer. One folder: `C:\Users\rootr\ava`

- **Desk:** Electron app `apps\desktop` (shortcut: Desktop\Ava Desk)
- **Origin:** `127.0.0.1:8787` — this PC only. Not the internet.
- **Media:** `Media` → USB
- **Visitor sites:** Kīlauea Alerts and RootMC stay on their own hosts. Holding page is not the desk.

## GitHub → live tree

Public clone is `https://github.com/Ava-Core-Dev/ava-core.git`. Auto-push (1 min) and auto-pull (10 min, ff-only, refuses a dirty tree) run from Task Scheduler.

**Pull now:** Ava Desk header **Pull GitHub**, or Settings → GitHub · live tree. That is a safe ff-only pull. If the tree is dirty, auto-push or commit first.

After a pull that changes Desk files, restart Ava Desk. After origin/Python changes, recycle the origin listener tree (not a random extra uvicorn PID).

## Desk feature switches

Settings → Desk features (also on the Radio page):

- Hurricane desk on public radio (06:35 / 13:12 / 17:02 HST, outside report play locks)
- Reports and chimes on `/radio/live.mp3`
- Listener “Share a thought” on the listen page
- Delta 2 AC solar gate, and keep AC on when Delta SOC is over 80%

## Hurricane Ara clips

Record stems and slots from `docs/hurricane-ara-prompt.md`. Drop WAVs in `Media/public/audio/words/hurricane/{phrase_id}.wav`. Live names are `storm_<name>.wav` (one clip, just the name). Numbers already exist.

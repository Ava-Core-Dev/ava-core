# OBS Overlay Cards

Each board card is an isolated 1920×1080 transparent page.

Base URL: `http://127.0.0.1:8787`

| Board | Card | OBS Browser URL |
|---|---|---|
| chrome | `brand-chip` | `/obs/card/chrome/brand-chip` |
| chrome | `clock` | `/obs/card/chrome/clock` |
| dev | `panel` | `/obs/card/dev/panel` |
| dev | `toast` | `/obs/card/dev/toast` |
| economy | `foot` | `/obs/card/economy/foot` |
| economy | `panel` | `/obs/card/economy/panel` |
| goals | `list` | `/obs/card/goals/list` |
| goals | `top-bar` | `/obs/card/goals/top-bar` |
| kilauea | `bottom` | `/obs/card/kilauea/bottom` |
| kilauea | `feed-card` | `/obs/card/kilauea/feed-card` |
| kilauea | `top-bar` | `/obs/card/kilauea/top-bar` |
| quake | `alert` | `/obs/card/quake/alert` |
| quake | `global-list` | `/obs/card/quake/global-list` |
| quake | `island-list` | `/obs/card/quake/island-list` |
| solar | `averages` | `/obs/card/solar/averages` |
| solar | `battery-bank` | `/obs/card/solar/battery-bank` |
| solar | `bottom-flow` | `/obs/card/solar/bottom-flow` |
| solar | `root-server` | `/obs/card/solar/root-server` |
| solar | `site-volcano` | `/obs/card/solar/site-volcano` |
| solar | `top-bar` | `/obs/card/solar/top-bar` |
| solar | `totals-now` | `/obs/card/solar/totals-now` |
| support | `copy-panel` | `/obs/card/support/copy-panel` |
| support | `foot` | `/obs/card/support/foot` |
| weather | `bottom` | `/obs/card/weather/bottom` |
| weather | `current` | `/obs/card/weather/current` |
| weather | `top-bar` | `/obs/card/weather/top-bar` |

## Folders

- App templates: `ava-core-v2/apps/core/templates/overlays/{board}/`
- Media copies: `media/stream/overlays/cards/{board}/`
- Shared CSS/JS: `overlays/_shared/`

Stack multiple card URLs as separate OBS Browser Sources to compose a board.

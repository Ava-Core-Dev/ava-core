# Root-Joint — SpigotMC resource copy

**Resource:** https://www.spigotmc.org/resources/root-joint-pass-the-haste.137389/  
**Site guide:** https://rootmc.net/plugins/root-joint/  
**Jar / manifest:** https://rootmc.net/plugins/manifest.json (`root-joint`)  
**bStats:** https://bstats.org/plugin/bukkit/Root%20Joint/32894  

Saved from the Spigot **Description** and **Documentation** fields used when listing the resource (July 2026).

---

## Description

**Root-Joint** is a social pass-the-joint minigame for Paper/Spigot servers.

One player lights it. Everyone keeps it alive by passing. Let the timer run out and it burns out — unless you set a new longest-burn record.

### Features
- **`/joint`** — light the joint (configurable Gold fee → server reserve when economy is available)
- **`/pass <player>`** — pass to another online player to reset the hold timer
- **Only one joint at a time** — keeps the whole server in on the same session
- **Burn timer** with holder warnings + a global 30s ping
- **Longest joint record** — `/joint longest` (who sparked it, who held last, duration)
- **Walking light** — optional invisible light follows the holder so nearby players see real glow
- **Potion effects** while holding (regen / night vision / haste — all configurable)
- **Chat/tab tag** while holding (e.g. `[J]`) + PlaceholderAPI support
- **Optional Discord relay** when used with RootMC (spark / pass / burn-out / new records)

### Commands
| Command | Description |
|---|---|
| `/joint` | Light a joint |
| `/joint longest` | Show the server record |
| `/joint price [amount]` | View/set Gold cost (staff) |
| `/joint reload` | Reload config (staff) |
| `/pass <player>` | Pass the joint (`/jointpass`) |

### Permissions
- `rootjoint.use` — light & pass (default: true)
- `rootjoint.bypass-fee` — skip Gold cost (default: op)
- `rootjoint.price` / `rootjoint.reload` — staff config

### Installation
1. Drop `Root-Joint.jar` into `/plugins`
2. Restart (or load) the server
3. Edit `plugins/RootMC/root-joint.yml` (created on first run)
4. Optional: install **Vault** + an economy plugin for the Gold fee; **PlaceholderAPI** for `%rootjoint_*%` tags

### Soft depends
Root-Core, Vault, PlaceholderAPI, RootMC (Discord relay). The minigame still runs without them — fee / placeholders / Discord are optional.

### Config highlights
- `cost-gold` — price to spark (default `1.0`)
- `hold-seconds` — how long each holder gets before burnout (default `180`)
- `holder-light` — walking torch light level
- `effects` — regen / night vision / haste amplifiers
- `warn-global-seconds` / `warn-holder-seconds` — countdown pings
- Fully customizable messages

### Support
Site: https://rootmc.net  
Made for RootMC — works on any Paper 1.21+ / Paper 26.x host.

---

## Documentation

### How to play
1. A player runs **`/joint`** to light the joint (pays Gold if economy is available).
2. Only **one** joint can be active at a time.
3. The holder has a limited time (default **180 seconds**). Use **`/pass <player>`** before it burns out.
4. Passing resets the hold timer for the new holder.
5. If the timer hits zero, the joint burns out. If that session beat the server record, a new longest-joint is announced.

### Commands
- **`/joint`** — light a joint
- **`/joint longest`** — show the longest burn record (who sparked it, last holder, duration)
- **`/pass <player>`** (alias **`/jointpass`**) — pass the joint to an online player
- **`/joint price`** — view current Gold cost (staff)
- **`/joint price <amount>`** — set Gold cost (staff)
- **`/joint reload`** — reload `root-joint.yml` (staff)

### Permissions
- **`rootjoint.use`** — light and pass (default: true)
- **`rootjoint.bypass-fee`** — skip the Gold fee (default: op)
- **`rootjoint.price`** — view/set price (default: op)
- **`rootjoint.reload`** — reload config (default: op)

### Config
File: **`plugins/RootMC/root-joint.yml`**

Useful keys:
- **`cost-gold`** — fee to spark (default `1.0`)
- **`hold-seconds`** — seconds each holder gets (default `180`)
- **`treasury-channel`** — where fees go when RootMC treasury is present
- **`discord-relay`** — relay spark/pass/burnout/records via RootMC Discord bridge
- **`chat-tag`** — prefix while holding (e.g. `[J]`)
- **`holder-light`** — walking light on the holder
- **`effects`** — regen / night vision / haste while holding
- **`warn-global-seconds`** / **`warn-holder-seconds`** — countdown warnings
- **`messages`** — all chat strings

### Soft depends (optional)
- **Vault + economy** (or Root-Economy) — Gold fee
- **PlaceholderAPI** — holder tags (`%rootjoint_*%`)
- **RootMC** — Discord #ingame-chat relay
- **Root-Core** — shared RootMC config folder / suite updater

### Install guide
Full guide + jar download: **https://rootmc.net/plugins/root-joint/**

Manifest (auto-update with Root-Core): **https://rootmc.net/plugins/manifest.json**

# Root-Ping — SpigotMC resource copy

**Suggested title:** Root-Ping — Detailed Connection Analytics  
**Resource:** https://www.spigotmc.org/resources/root-ping-detailed-connection-analytics.137392/  
**Site guide:** https://rootmc.net/plugins/root-ping/  
**Jar:** https://rootmc.net/plugins/manifest.json (`root-ping` → live filename)  
**Manifest:** https://rootmc.net/plugins/manifest.json (`root-ping`)  
**Depends:** [Root-Core](https://rootmc.net/plugins/root-core/) (required)  
**bStats:** https://bstats.org/plugin/bukkit/Root-Ping/32911 (id `32911`)  
**Discord:** https://discord.com/invite/yeQA4VkmRM  
**Play:** play.rootmc.net  

---

## Description

Paste into Spigot **Description**:

**Root-Ping — Detailed Connection Analytics** owns `/ping` on Paper/Spigot. Today it shows live latency + server load in chat and writes rich connection samples to MySQL. That sample stream is the foundation for a full interactive analytics surface on the roadmap.

### What you get now
- **`/ping`** (alias **`/latency`**) — player ping + TPS / MSPT / online / heap in one shot
- **Periodic background samples** while online (default every 5 minutes) so quality is measured over a session, not only when someone types a command
- **Detailed MySQL rows** via Root-Core DB settings (`root_ping_samples`) — ping, IP, protocol, client brand, locale, view distance, virtual host, TPS/MSPT, heap, CPU, disk, host label, server id
- **Multi-host labels** — auto `claims` / `local` (or override) so labeled hosts can be compared later
- **Configurable chat messages** — prefix, ping line, server line
- **Root-Essentials aware** — when Root-Ping is installed, Essentials leaves `/ping` alone

### Roadmap — interactive analytics
Root-Ping is intentionally shipping the **collector first**. The MySQL schema is already shaped for dashboards, not just a one-line `/ping`.

Planned interactive analytics (web / developer portal style):
- **Per-player latency timelines** — ping over a session or across days; spikes vs steady play
- **Host & region comparisons** — your own `host-label`s; which entry hostname / virtual host correlates with worse RTT
- **Server-load correlation** — overlay player ping with TPS, MSPT, heap, and online count from the same sample row
- **Client fingerprint views** — protocol, brand, locale, view distance distributions (ops-friendly; privacy-aware)
- **Filters & drill-down** — by player, server id, host label, time range, trigger (`COMMAND` vs `INTERVAL`)
- **Live / near-live ops panels** — “who is lagging right now?” without digging through SQL by hand

Until that UI lands, you already have the hard part: continuous, structured samples you can query yourself or feed into your own BI tools. Interactive charts and filters will read the same tables — no re-instrumentation planned.

### Commands
| Command | Description |
|---|---|
| `/ping` | Show your ping + current server load |
| `/latency` | Same as `/ping` |
| `/ping reload` | Reload config (staff) |

### Permissions
- `rootping.use` — use `/ping` (default: **true**)
- `rootping.admin` — `/ping reload` (default: op)

### Installation
1. Install **Root-Core** first (shared config folder + MySQL settings)
2. Drop `root-ping-*.jar` into `/plugins`
3. Restart the server
4. Edit `plugins/RootMC/root-ping.yml` (created on first run)

### Depends
- **Root-Core** (required) — database settings, server id, RootMC config folder
- **Root-Essentials** (soft) — avoids duplicate `/ping` ownership

### Config highlights
- `enabled` — master switch
- `interval-minutes` — automatic sample period (default `5`)
- `server-id` / `host-label` — optional overrides for analytics grouping
- `messages.*` — fully customizable chat lines (`{ping}`, `{tps}`, `{mspt}`, `{online}`, `{max}`, `{heap}`)

### Support
Site: https://rootmc.net/plugins/root-ping/  
Discord: https://discord.com/invite/yeQA4VkmRM  
Test live: **play.rootmc.net**  
Made for RootMC — Paper 1.21+ / Paper 26.x.

---

## Documentation

Paste into Spigot **Documentation**:

### What it does today
`/ping` prints two lines: your client latency, then a compact server-load line (TPS, MSPT, players online, heap %). On a schedule (and on each `/ping`), Root-Ping appends a **detailed connection sample** to MySQL — the same dataset interactive analytics will visualize later.

### Roadmap — full interactive analytics
**Phase shipped:** in-game `/ping` + async sample collector + MySQL schema (`{prefix}ping_samples`).

**Phase next (interactive):**
1. **Player analytics** — interactive ping charts (session / day / week), p50/p95 style summaries, spike detection
2. **Host analytics** — compare labeled hosts (custom `host-label`s); virtual-host / join-hostname breakdowns
3. **Load correlation** — same timestamp row ties client RTT to TPS, MSPT, heap, CPU, disk, and player count
4. **Ops views** — filterable tables, “worst ping right now,” export for staff
5. **Portal integration** — RootMC developer / ops web surfaces reading the existing sample table (no second collector)

This roadmap is why samples store more than chat needs: client metadata, host labels, and server load live on **one row** so a future UI can cross-filter without joining guesswork.

### Commands
- **`/ping`** / **`/latency`** — sample + show ping/load
- **`/ping reload`** — reload `root-ping.yml` (`rootping.admin`)

### Permissions
- **`rootping.use`** — use `/ping` (default true)
- **`rootping.admin`** — reload

### Config (`plugins/RootMC/root-ping.yml`)
- **`enabled`** — turn sampling/command messaging on/off
- **`interval-minutes`** — minutes between automatic samples while a player is online
- **`server-id`** — blank → Root-Core / cloud server id
- **`host-label`** — blank → auto-detect (`claims` if Root-Claims present, else `local`)
- **`messages`** — prefix, ping-line, server-line, disabled, no-permission

### MySQL table
When Root-Core MySQL is configured, samples go to `{prefix}ping_samples` (default `root_ping_samples`). Command use and interval samples both write asynchronously — a DB outage does not block `/ping` chat output.

### Sample fields (stored)
Trigger, server id, host label, UUID, username, ping ms, IP/port, protocol version, client brand, locale, client view distance, virtual host, TPS 1/5/15m, MSPT, online/max players, heap used/max/%, process CPU %, disk used %.

### Requirements
- Paper **1.21+** / **26.x** (`api-version` 26.1)
- **Root-Core** on the same server
- MySQL optional for chat-only `/ping`; **recommended** if you want history or upcoming interactive analytics

### Download
- Jar: https://rootmc.net/plugins/manifest.json (`root-ping`)  
- Manifest (suite updater): https://rootmc.net/plugins/manifest.json  
- Root-Core: https://rootmc.net/plugins/root-core/  
- bStats: https://bstats.org/plugin/bukkit/Root-Ping/32911  

### Support
Discord: https://discord.com/invite/yeQA4VkmRM  
Play: play.rootmc.net  
Site: https://rootmc.net

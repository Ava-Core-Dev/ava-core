# Root-ItemInfo — SpigotMC resource copy

**Suggested title:** Root-ItemInfo — World Item Census  
**Site guide:** https://rootmc.net/plugins/root-iteminfo/  
**Jar:** https://rootmc.net/plugins/manifest.json (`root-iteminfo` → live filename)  
**Manifest:** https://rootmc.net/plugins/manifest.json (`root-iteminfo`)  
**bStats:** https://bstats.org/plugin/bukkit/Root-ItemInfo/32906 (id `32906`)  
**Discord:** https://discord.com/invite/yeQA4VkmRM  
**Play:** play.rootmc.net  

---

## Description

Paste into Spigot **Description**:

**Root-ItemInfo** is a live world item census for Paper/Spigot. Players and staff ask `/info` and get scanned totals for any material — how much exists in loaded inventories and containers right now, plus an average Gold value when your economy plugins expose prices.

### Features
- **`/info`** — look up the item in hand (aliases **`/iteminfo`**, **`/ii`**)
- **`/info <material>`** — lookup by id (e.g. `diamond`, `gold_ingot`)
- **`/info gold`** — mint-peg summary of scanned gold nuggets / raw / ingots / blocks
- **`/info top`** — top materials by scanned count (staff)
- **Periodic census** — scans online inventories, ender chests, loaded containers, and optional ground items
- **Average value (G)** — pulls from RootMC price registry or Root-Essentials worth when present
- **YAML snapshot** — `plugins/RootMC/item-census.yml` for local ops
- **Optional MySQL push** — through RootMC when networked (feeds resource / economy pages)

### Commands
| Command | Description |
|---|---|
| `/info` | Info for held item |
| `/info hand` | Same as `/info` |
| `/info <material>` | Info for a material id |
| `/info gold` | Scanned gold items + mint-peg G |
| `/info top` | Top resources by count (staff) |
| `/info reload` | Reload config + schedule rescan (staff) |

### Permissions
- `rootiteminfo.use` — use `/info` (default: **true**)
- `rootiteminfo.admin` — `/info top` (default: op)
- `rootiteminfo.reload` — `/info reload` (default: op)

### Installation
1. Drop `root-iteminfo-*.jar` into `/plugins`
2. Restart the server
3. Edit `plugins/RootMC/root-iteminfo.yml` (created on first run)
4. Optional: **Root-Core** / **RootMC** for shared folder + MySQL; **Root-Essentials** or **RootMC** for average Gold values

### Soft depends
RootMC, Root-Essentials, RootMC-Shops, Vault — all optional. Census + `/info` counts work standalone; averages and MySQL sync unlock when those plugins are present.

### Config highlights
- `scan.enabled` / `scan.interval-seconds` — automatic rescans
- `scan.max-chunks-per-pass` — how many loaded chunks to walk per pass
- `scan.include-ground-items` — count item entities on the ground
- `mysql.min-write-interval-seconds` — throttle RootMC MySQL writes
- Fully customizable `messages.*`

### Honest limits
Totals cover **loaded** containers + online inventories. Unloaded chunks are invisible until loaded — the as-of line says so. This is a live ops snapshot, not a full world map dump.

### Support
Site: https://rootmc.net/plugins/root-iteminfo/  
Discord: https://discord.com/invite/yeQA4VkmRM  
Test live: **play.rootmc.net**  
Made for RootMC — Paper 1.21+ / Paper 26.x.

---

## Documentation

Paste into Spigot **Documentation**:

### What it does
Root-ItemInfo maintains a **running census** of item stacks it can see: player inventories, ender chests, tile containers in loaded chunks, optional ground drops, and shop-related storage when RootMC-Shops Gen2 hooks are available. `/info` reads that snapshot and shows:
1. Material id  
2. World total (scanned count)  
3. Average unit value in Gold (G) when a price source exists  
4. For gold materials — mint-peg G for those stacks  
5. Timestamp / scope note  

### Commands
- **`/info`** / **`/iteminfo`** / **`/ii`** — held item  
- **`/info hand`** — held item  
- **`/info <material>`** — e.g. `diamond`, `oak_log`  
- **`/info gold`** — gold_nugget / raw_gold / gold_ingot / gold_block (+ raw_gold_block) with mint peg  
- **`/info top`** — top N by count (`rootiteminfo.admin`)  
- **`/info reload`** — reload yml + request full scan (`rootiteminfo.reload`)

### Permissions
- **`rootiteminfo.use`** — default true  
- **`rootiteminfo.admin`** — top lists  
- **`rootiteminfo.reload`** — reload + force rescan  

### Config (`plugins/RootMC/root-iteminfo.yml`)
- **`enabled`** — master switch  
- **`scan.enabled`** — periodic + startup scans  
- **`scan.interval-seconds`** — default `120`  
- **`scan.min-trigger-interval-seconds`** — debounce event-driven scans  
- **`scan.max-chunks-per-pass`** — default `48`  
- **`scan.include-ground-items`** — default `true`  
- **`scan.include-entity-equipment`** — default `false`  
- **`mysql.min-write-interval-seconds`** — default `120`  
- **`messages`** — all chat strings  

### Data files
- Config: `plugins/RootMC/root-iteminfo.yml`  
- Local census: `plugins/RootMC/item-census.yml`  
- Optional MySQL: via RootMC reporting when RootMC is enabled  

### Average value sources
1. RootMC `averagePrice(itemKey)` when RootMC is online  
2. Else Root-Essentials `itemPrice(Material)` / worth bridge  
3. Else “unknown (no shop/worth data yet)”  

Mint peg for physical gold (same as RootMC economy): nugget = ¹⁄₉ G, raw/ingot = 1 G, block / raw block = 9 G.

### Requirements
- Paper **1.21+** / **26.x** (`api-version` 26.1)  
- Soft: Root-Core, RootMC, Root-Essentials, Vault, RootMC-Shops  

### Download
- Jar: https://rootmc.net/plugins/manifest.json (`root-iteminfo`)  
- Manifest: https://rootmc.net/plugins/manifest.json  
- Guide: https://rootmc.net/plugins/root-iteminfo/  
- bStats: https://bstats.org/plugin/bukkit/Root-ItemInfo/32906  

### Support
Discord: https://discord.com/invite/yeQA4VkmRM  
Play: play.rootmc.net  
Site: https://rootmc.net

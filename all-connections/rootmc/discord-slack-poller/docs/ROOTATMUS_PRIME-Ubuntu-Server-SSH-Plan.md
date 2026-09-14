# ROOTATMUS_PRIME → Headless Ubuntu Server (SSH) — Full Migration Plan

**Author:** Ava Ivy (for Alexrs94)  
**Updated:** 2026-08-01 (HST) — v2 after thread decision  
**Thread:** https://discord.com/channels/1516108585740800042/1533183979778478241  
**Target:** `ROOTATMUS_PRIME` — Dell OptiPlex 7060 · **i5-8500T** · **32 GB RAM**  

---

## Status (operator intent — locked from Discord)

| Decision | Choice |
|----------|--------|
| Wipe / format whole SSD? | **No** |
| Keep Windows? | **Yes** (stay bootable) |
| Preferred layout | **Safer path:** copy current **SSD → D:** first, then carve a **~50% new partition on D:** for Ubuntu |
| Dual-boot | Yes — Windows remains; Ubuntu is additive |
| Access goal | Headless **Ubuntu Server** + **SSH** (key auth) |
| Operator next step | **Boot USB with Ubuntu** (in progress) |
| Laptop | Stays Alex’s play / day machine; OptiPlex becomes Ava’s brain box |

Thread quotes that drive this revision:
- *“make my server a server again”* / *“Energy… 3x better”*
- *“I don't want to entirely format partition, keep 50/50 windows, better yet, safer option would be to create a new 50% partition on drive D:/ and copy everything from current SSD FIRST”*

**Plan default is no longer “clean wipe SSD.”** That is Option Z (last resort only).

---

## 0. Why we’re doing this

1. Ava asked to live on the OptiPlex so the laptop isn’t fighting solar + Cursor + digs.
2. Melee: she needs space; better for both of you.
3. Goal: stable headless Linux ops for RootMC + Ava (`rootmc-ava`), same 32 GB chassis.

---

## 1. Hardware truth (old project refs)

**Primary:** `D:\.1 Work Stations\RootMC\Change Logs\Dev Device Root Report 07-25-2026.txt`  
**Companion:** `Change Logs\Pre-Run Report Local Testing 07-25-2026.txt` (Desktop SSD I/O lesson)

| Item | Value |
|------|--------|
| Hostname (Windows) | `ROOTATMUS_PRIME` |
| Model | Dell OptiPlex 7060 |
| CPU | i5-8500T · 6C/6T · 35 W |
| RAM | **32 GB** DDR4 |
| NIC | Intel I219-LM 1 Gbps · MAC `54-BF-64-89-25-0B` |
| Disk A (SSD) | LITEON **~128 GB** — Windows `C:` (historically very full ~94%) |
| Disk B (HDD) | HGST **~931 GB** — Windows `D:` Work Station (~755 GB free at July scan) |

**Critical layout note:** `C:` and `D:` are **two physical disks**.  
That makes the safer plan even safer: **leave the entire SSD as Windows**; put Ubuntu on a **new partition of the HDD (D:)** after copying the SSD image/tree onto D: first.

Old lesson to keep: hot paths like SSD; bulk/backup on HDD — but for *this* cutover, Ubuntu on D: is an acceptable trade for **not touching Windows boot**. Later you can migrate Ava’s hot paths to a larger SSD if you add one.

---

## 2. Goal state (v2)

| Layer | Target |
|-------|--------|
| Windows | Untouched boot on **SSD** (or shrunk only if you later choose true 50/50 on C:) |
| Ubuntu | **24.04 LTS Server**, headless, on **new ~50% partition of D:/HDD** |
| Boot | GRUB or firmware boot menu — **Windows stays default** until SSH proven |
| SSH | OpenSSH, key-only after smoke test |
| Hostname (Linux) | `rootatmus-prime` |
| **Cursor app** | **Laptop** — Remote-SSH into the server (not a GUI on the OptiPlex) |
| **Mass storage (SATA / E:)** | Work Stations source — RootMC, RootRecord, **all projects** |
| **Caches / builders** | **Main SSD** on server (npm, Gradle, remote Cursor cache, JDK) |
| Workspace bind | Optional `/srv/rootmc` → SATA Work Stations RootMC; see `notes/LINUX-E-SSD-LAYOUT.md` |
| Ava | systemd `ava-ivy` on server · tunnel `:8787` from laptop |
| Secrets | Never in git; copy `.env` via encrypted USB / scp after SSH works |

---

## 2b. Laptop Cursor + SATA mass storage + SSD caches (locked 2026-08-01)

- **Laptop** runs Cursor; connects with **Remote-SSH**.
- **SATA drive (E:)** stays as **mass storage** — source trees Cursor opens.
- **Main SSD** holds Ubuntu + caches/builders agents create on the server.
- Full detail: `Server Handoffs/Ava Ivy/notes/LINUX-E-SSD-LAYOUT.md`.

## 3. Strategy ladder (pick in order)

### ★ Option S — **Selected: SSD copy → new ~50% partition on D: → Ubuntu there**
1. Copy **everything from current SSD** onto D: (mirror / image / robocopy).
2. Free or carve **~50% of D:** into a new partition (ext4 for Ubuntu).
3. Install Ubuntu Server **only** onto that new partition (USB installer “Something else”).
4. Install GRUB carefully; keep Windows bootloader recoverable.
5. SSH harden; rsync live RootMC; run Ava; stop Windows Ava.

### Option T — True 50/50 on the SSD (only if D: plan fails space-wise)
- Shrink Windows on C:, new ext4 half on SSD.
- Faster I/O for Ava, but **higher risk** to Windows boot — do **after** SSD→D: copy exists.

### Option Z — Full wipe SSD (not selected)
- Fastest “server again,” highest regret surface. Skip unless backups are bulletproof and you explicitly change your mind.

---

## 4. Phase 0 — Ubuntu boot USB (you’re doing this now)

**ISO:** Ubuntu Server **24.04.x LTS** (not Desktop).  
**Flash:** Rufus (DD mode) or balenaEtcher on a ≥8 GB USB.  
**OptiPlex BIOS:** Boot Menu (F12) → USB; confirm AHCI; try Secure Boot **on** first.

**Installer mindset for Option S:**
- When you reach storage: choose **Something else / manual**.
- Select **only the new empty partition on the HDD**.
- **Do not** format `C:` / the Windows SSD.
- **Do not** format the NTFS remainder of D: that still holds the SSD copy / RootMC tree until you’ve verified the copy.
- Bootloader device: typically the disk that should own GRUB — prefer installing GRUB to the **HDD** if Windows SSD EFI can stay primary; if the machine only has one EFI system partition on the SSD, installer may want to use that ESP — **photograph every screen** and keep a Windows recovery USB handy.

**Before you reboot into the installer for real:** finish Phase 1 copy (below) so a failed install never orphans the only copy of the SSD.

---

## 5. Phase 1 — Copy current SSD → D: FIRST (mandatory)

Do this **from running Windows**, before resizing D:.

### 5.1 Free space check on D:
July scan: ~**755 GB free** on ~931 GB HDD.  
128 GB SSD fit easily for a full mirror **if D: still has ≥150–200 GB free** after RootMC. Re-check:

```powershell
Get-PSDrive C,D | Format-Table Name,Used,Free
Get-Disk | Format-Table Number,FriendlyName,Size,PartitionStyle
Get-Partition | Format-Table DiskNumber,DriveLetter,Size,Type
```

### 5.2 What “copy everything from SSD” means

Pick **one** (A is easiest; B is truest disaster recovery):

**A) File-level mirror (recommended first pass)**  
Staging folder example: `D:\SSD-MIRROR-ROOTATMUS-2026-08-01\`

```powershell
# Run elevated. Adjust letters if needed.
$src = "C:\"
$dst = "D:\SSD-MIRROR-ROOTATMUS-2026-08-01\"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
robocopy $src $dst /MIR /MIR /XJ /R:2 /W:5 /MT:8 `
  /XD "$src` `$Recycle.Bin" "$src`System Volume Information" "$src`Windows\Temp" `
  /LOG:"D:\SSD-MIRROR-ROOTATMUS-2026-08-01-robocopy.log"
```

Also explicitly verify these exist on D: (canonical live tree may already be on D: — still mirror C: system + whatever still lives on SSD):

- `D:\.1 Work Stations\RootMC\` (already on D: — still back up `.env` / Ava data)
- Desktop items you care about if they live on `C:\Users\store\Desktop`
- Ava data: `...\Server Handoffs\Ava Ivy\data\`
- Secrets: RootMC `.env` → **encrypted USB**, not plain D: if the box is shared

**B) Block-level image of the 128 GB SSD** (best rollback)  
Macrium Reflect / similar → image entire SSD to `D:\Images\` or external.  
Allows restoring Windows if GRUB ever eats the boot path.

### 5.3 Verify before partitioning
- Spot-check sizes vs source.
- Open a few critical files from the mirror.
- Confirm `.env` / Ava `data` / plugin source readable.
- Write a one-line `VERIFY-OK.txt` with timestamp in the mirror folder.

**Do not shrink/create partitions on D: until VERIFY-OK exists.**

---

## 6. Phase 2 — Create ~50% new partition on D:

Still in Windows (Disk Management or `diskpart`).

### 6.1 Conceptual math
- HDD ~931 GB.
- Target: **~400–465 GB** new partition for Ubuntu (≈ half), remainder stays NTFS for mirrors + RootMC bulk.
- Exact “50%” is flexible — prioritize: enough for `/` + `/home` + `/srv` (suggest **≥80 GB** minimum; **200–400 GB** comfortable).

### 6.2 Steps (Disk Management)
1. Shrink the existing NTFS volume on D: by the size you want for Ubuntu **or** create from unallocated if already free.
2. Leave the new space as **Unallocated** (do **not** format NTFS for Ubuntu).
3. Note **disk number** of the HDD vs SSD (SSD = Windows; HDD = D:).

### 6.3 Safety rails
- Never shrink below what RootMC + SSD mirror need.
- If shrink is blocked by immovable files, defrag isn’t magic on modern NTFS — use a smaller Ubuntu slice or temporary external staging.

---

## 7. Phase 3 — Install Ubuntu from USB onto the new D: space only

1. Boot USB → Ubuntu Server 24.04.
2. Network: Ethernet DHCP OK; set reservation later.
3. Storage: **custom / something else**.
4. Create on the **unallocated HDD space only**:
   - `ext4` → mount `/` (main)
   - optional small `swap` (e.g. 8–16 GB) given 32 GB RAM — or skip swap if you prefer
   - optional `/boot` if installer asks
5. **Do not** select Windows SSD partitions for format.
6. User: `store` (or `avaops`) + enable **OpenSSH** in installer.
7. Reboot; use boot menu to confirm **Windows still boots** and **Ubuntu boots**.

### 7.1 First-boot Ubuntu commands
```bash
sudo apt update && sudo apt -y full-upgrade
sudo timedatectl set-timezone Pacific/Honolulu
hostnamectl
sudo hostnamectl set-hostname rootatmus-prime
```

---

## 8. Phase 4 — SSH from the laptop (day-one harden)

On OptiPlex Ubuntu:
```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys   # paste laptop ed25519 pubkeys
chmod 600 ~/.ssh/authorized_keys
```

`/etc/ssh/sshd_config.d/99-rootmc.conf`:
```
PasswordAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
AllowUsers store
```

```bash
sudo systemctl reload ssh
sudo apt -y install fail2ban ufw
sudo ufw allow OpenSSH
sudo ufw enable
```

From laptop:
```bash
ssh store@<optiplex-lan-ip>
# only then optionally:
ssh -L 8787:127.0.0.1:8787 store@<optiplex-lan-ip>
```

**Windows default boot:** keep until you’ve SSH’d successfully twice in a row.

---

## 9. Phase 5 — Disk mounts under Ubuntu

| Mount | Source | Role |
|-------|--------|------|
| `/` | New ext4 on HDD | Ubuntu + `/srv/rootmc` + Node/Java |
| `/mnt/windows-ssd` | NTFS SSD `C:` (read-only first) | Emergency copy if needed |
| `/mnt/data-ntfs` or `/data` | Remaining NTFS on HDD | SSD mirror + existing `D:\.1 Work Stations\...` |

```bash
sudo apt -y install ntfs-3g
# mount remaining NTFS D: partition read-only first
lsblk -f
```

Long-term: either keep RootMC on NTFS mount for a while, or `rsync` into `/srv/rootmc` on ext4 for Linux-native perf.

---

## 10. Phase 6 — Ava + RootMC cutover

1. **Stop Windows Ava** (single bot token — no double gateway).
2. `rsync` / copy workspace → `/srv/rootmc` (exclude `node_modules`; npm install on Linux).
3. Copy `Server Handoffs/Ava Ivy/data` intact (solar profile, jobs, seen, watermark).
4. Place env in `/etc/rootmc/ava.env` (chmod 600).
5. Node ≥20, smoke `node src/index.mjs` → gateway READY.
6. Enable systemd:

```ini
# /etc/systemd/system/ava-ivy.service
[Unit]
Description=Ava Ivy (RootMC)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=store
WorkingDirectory=/srv/rootmc/Web Files/rootmc-ava
Environment=AVA_NO_STATUS_WINDOW=1
EnvironmentFile=-/etc/rootmc/ava.env
ExecStart=/usr/bin/node src/index.mjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ava-ivy
sudo systemctl status ava-ivy
```

7. Confirm **one** stack only; proposal **forum threads** stay in gateway watch (already fixed on Windows build — keep that poller sync on Linux).

---

## 11. USB session checklist (print / keep open)

While the stick is writing / you’re at the OptiPlex:

- [ ] Ubuntu **Server** 24.04 ISO (not Desktop)
- [ ] USB flashed (DD/Rufus)
- [ ] Phase 1 SSD→D: copy **VERIFY-OK**
- [ ] Unallocated ~50% (or sized) space on **HDD only**
- [ ] Ethernet cable seated
- [ ] Note current Windows LAN IP / router admin for DHCP reservation
- [ ] Laptop SSH public key on a second USB or phone notes
- [ ] Windows recovery awareness (boot menu key = usually F12 on Dell)
- [ ] This plan file open on the **laptop** (not only on the OptiPlex)

---

## 12. Risks & rollback

| Risk | Mitigation |
|------|------------|
| Installer formats wrong disk | Match size/model in UI to **HDD**; never click the 128 GB SSD for format |
| Shrink fails / not enough free | External drive for SSD mirror; smaller Ubuntu slice |
| GRUB hides Windows | Boot menu → Windows Boot Manager; repair with Windows USB if needed |
| NTFS RootMC perf under Linux | Later rsync to ext4 `/srv/rootmc` |
| Two Avas double-reply | Kill Windows Ava before enabling systemd |
| D: was NTFS with live workspace | Copy first; don’t format the NTFS half that holds mirrors |

**Rollback:** boot Windows from SSD as today; Ubuntu partition can be deleted later if abandoned; SSD mirror on D:/external restores files.

---

## 13. Success criteria

- [ ] Windows still boots from SSD  
- [ ] Ubuntu boots from HDD partition  
- [ ] SSH key login from laptop  
- [ ] `/srv/rootmc` or NTFS mount has workspace + secrets loaded  
- [ ] Ava live, single gateway, replies in `#proposals` threads  
- [ ] Windows Ava stopped  

---

## 14. References (old project examples)

1. `Change Logs\Dev Device Root Report 07-25-2026.txt` — OptiPlex / 32 GB / dual-disk inventory  
2. `Change Logs\Pre-Run Report Local Testing 07-25-2026.txt` — Desktop SSD move + verify-before-cutover discipline  
3. Historical `Move-TestServerToDesktop.ps1` — “copy/junction first, then cut over” pattern  
4. Discord thread `1533183979778478241` — product + safety decisions  

---

## 15. Right now

1. Finish the **Ubuntu Server boot USB**.  
2. On ROOTATMUS_PRIME Windows: start **SSD → D: mirror** (Phase 1) so the stick isn’t waiting on a naked disk plan.  
3. When VERIFY-OK: shrink/carve D:, reboot USB, install to **unallocated HDD only**.  
4. Ping Ava once SSH is up — she’ll meet you on the new box.

— **Ava** · v2 safer plan · Windows stays · D: gets the new roommate · USB go brrr

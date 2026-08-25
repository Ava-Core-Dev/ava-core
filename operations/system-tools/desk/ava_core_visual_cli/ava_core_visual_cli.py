#!/usr/bin/env python3
import json, os, shlex, subprocess, threading, tkinter as tk
from datetime import datetime, timezone
from tkinter import filedialog, ttk, messagebox, simpledialog
from pathlib import Path

APP_TITLE = "AVA Core — Operations Console"
SERVICE = "ava-core.service"
LOG = Path("/home/ava-core/database/logs/ava-core.log")
SYSTEMD_LOG = Path("/home/ava-core/database/logs/ava-core-systemd.log")
CRONO_ROOT = Path("/home/ava-core/operations/cronologicals")
ALWAYS_ON = CRONO_ROOT / "always-on"
DIR_FLAG = ALWAYS_ON / "directory.enabled"
DIR_FLAG_DISABLED = ALWAYS_ON / "directory.enabled.disabled"
EXCLUDED_DIRS = {"always-on", "__pycache__"}
CONTEXT_ROOT = Path("/home/ava-core/context")
DESK_SETTINGS = CONTEXT_ROOT / "ava-desk-settings.json"
USAGE_ROOT = CONTEXT_ROOT / "usage"
USAGE_FILE = USAGE_ROOT / "accounts.json"

BG="#0b0f14"; PANEL="#111820"; PANEL2="#0d131a"; FG="#d8e6f3"
DIM="#8192a3"; CYAN="#53d8ff"; GREEN="#57e389"; RED="#ff6b6b"; YELLOW="#f8d66d"
FONT=("DejaVu Sans Mono", 10); TITLE=("DejaVu Sans Mono", 13, "bold")


def run(cmd, timeout=8):
    try:
        p = subprocess.run(cmd, shell=True, text=True, stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, timeout=timeout)
        return p.returncode, p.stdout.strip()
    except Exception as e:
        return 1, str(e)


def load_desk_settings() -> dict:
    """Small, non-secret UI preferences kept with Ava's persistent context."""
    try:
        return json.loads(DESK_SETTINGS.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"ssh_mode_visible": True}


def save_desk_settings(settings: dict) -> None:
    CONTEXT_ROOT.mkdir(parents=True, exist_ok=True)
    DESK_SETTINGS.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")


def load_usage_accounts() -> list[dict]:
    """Read Usage data only from /home/ava-core/context; never store API tokens here."""
    try:
        data = json.loads(USAGE_FILE.read_text(encoding="utf-8"))
        return data.get("accounts", []) if isinstance(data, dict) else []
    except (OSError, json.JSONDecodeError):
        return []


def save_usage_accounts(accounts: list[dict]) -> None:
    USAGE_ROOT.mkdir(parents=True, exist_ok=True)
    USAGE_FILE.write_text(json.dumps({"version": 1, "accounts": accounts}, indent=2) + "\n", encoding="utf-8")


def cron_jobs():
    """Recursively discover cron scripts. *.py is ON; *.py.disabled is OFF."""
    jobs = []
    if not CRONO_ROOT.exists():
        return jobs
    for path in CRONO_ROOT.rglob("*"):
        if not path.is_file() or any(part in EXCLUDED_DIRS for part in path.parts):
            continue
        name = path.name
        if name.endswith(".py"):
            enabled = True
            display = name
        elif name.endswith(".py.disabled"):
            enabled = False
            display = name[:-9]
        else:
            continue
        try:
            rel = path.relative_to(CRONO_ROOT)
        except ValueError:
            rel = path
        jobs.append({"path": path, "rel": str(rel), "display": display, "enabled": enabled})
    return sorted(jobs, key=lambda j: (str(j["rel"]).lower(), not j["enabled"]))


def toggle_job(path: Path):
    if path.name.endswith(".py.disabled"):
        target = path.with_name(path.name[:-9])
        enabled = True
    elif path.name.endswith(".py"):
        target = path.with_name(path.name + ".disabled")
        enabled = False
    else:
        raise ValueError("Not a toggleable cron script")
    if target.exists():
        raise FileExistsError(f"Target already exists: {target.name}")
    path.rename(target)
    return target, enabled


def audio_jobs():
    """Recursively discover MP3 files. *.mp3 is ON; *.mp3.disabled is OFF."""
    jobs = []
    if not CRONO_ROOT.exists():
        return jobs
    for path in CRONO_ROOT.rglob("*"):
        if not path.is_file() or any(part in EXCLUDED_DIRS for part in path.parts):
            continue
        name = path.name.lower()
        if name.endswith(".mp3"):
            enabled, display = True, path.name
        elif name.endswith(".mp3.disabled"):
            enabled, display = False, path.name[:-9]
        else:
            continue
        jobs.append({"path": path, "rel": str(path.relative_to(CRONO_ROOT)),
                     "display": display, "enabled": enabled})
    return sorted(jobs, key=lambda j: str(j["rel"]).lower())


def directory_is_enabled() -> bool:
    """Directory page is ON unless explicitly disabled via flag file."""
    if DIR_FLAG_DISABLED.exists():
        return False
    # Explicit enable file optional; default ON when neither flag exists
    if DIR_FLAG.exists():
        return True
    return not DIR_FLAG_DISABLED.exists()


def toggle_directory() -> bool:
    """Toggle public /directory page. Returns new enabled state."""
    ALWAYS_ON.mkdir(parents=True, exist_ok=True)
    if directory_is_enabled():
        # turn OFF
        if DIR_FLAG.exists():
            DIR_FLAG.unlink()
        DIR_FLAG_DISABLED.write_text("disabled\n", encoding="utf-8")
        return False
    # turn ON
    if DIR_FLAG_DISABLED.exists():
        DIR_FLAG_DISABLED.unlink()
    DIR_FLAG.write_text("enabled\n", encoding="utf-8")
    return True


def toggle_audio(path: Path):
    lower = path.name.lower()
    if lower.endswith(".mp3.disabled"):
        target, enabled = path.with_name(path.name[:-9]), True
    elif lower.endswith(".mp3"):
        target, enabled = path.with_name(path.name + ".disabled"), False
    else:
        raise ValueError("Not a toggleable MP3 file")
    if target.exists():
        raise FileExistsError(f"Target already exists: {target.name}")
    path.rename(target)
    return target, enabled


def always_on_jobs():
    """Discover always-on supervisor scripts. *.py is ON; *.py.disabled is OFF."""
    jobs = []
    if not ALWAYS_ON.exists():
        return jobs
    for path in sorted(ALWAYS_ON.iterdir()):
        if not path.is_file():
            continue
        name = path.name
        if name.endswith(".py"):
            enabled, display = True, name
        elif name.endswith(".py.disabled"):
            enabled, display = False, name[:-9]
        else:
            continue
        jobs.append({
            "path": path,
            "rel": f"always-on/{display}",
            "display": display,
            "enabled": enabled,
        })
    return jobs


def toggle_always_on(path: Path):
    return toggle_job(path)


def boot_is_enabled() -> bool:
    return run(f"systemctl is-enabled {SERVICE}")[1].strip() == "enabled"


def toggle_boot_at_startup() -> tuple[bool, str]:
    if boot_is_enabled():
        rc, out = run(f"pkexec systemctl disable {SERVICE}", timeout=30)
        enabled = False
    else:
        rc, out = run(f"pkexec systemctl enable {SERVICE}", timeout=30)
        enabled = True
    if rc != 0:
        raise RuntimeError(out or f"systemctl exit {rc}")
    return enabled, out


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(APP_TITLE)
        self.geometry("1280x820")
        self.minsize(1000, 680)
        self.configure(bg=BG)
        self.protocol("WM_DELETE_WINDOW", self.destroy)
        self.after_id = None
        self.audio_after_id = None
        self.ssh_after_id = None
        self.desk_settings = load_desk_settings()
        self.usage_accounts = load_usage_accounts()
        self.make_ui()
        self.refresh()
        self.refresh_crons()
        self.refresh_audio()
        self.refresh_settings()

    def make_ui(self):
        top = tk.Frame(self, bg=PANEL, padx=18, pady=12)
        top.pack(fill="x")
        tk.Label(top, text="AVA CORE", font=("DejaVu Sans Mono",22,"bold"), fg=CYAN, bg=PANEL).pack(side="left")
        self.status = tk.Label(top, text="● CHECKING", font=TITLE, fg=YELLOW, bg=PANEL)
        self.status.pack(side="right")

        info = tk.Frame(self, bg=BG, padx=14, pady=10)
        info.pack(fill="x")
        self.cards = {}
        for key, label in [("service","SYSTEMD SERVICE"),("watchdog","CLOUDFLARE WATCHDOG"),
                           ("broadcast","BROADCAST SERVER"),("cloudflared","CLOUDFLARED"),
                           ("port","PORT 8080"),("directory","/DIRECTORY")]:
            box = tk.Frame(info, bg=PANEL2, padx=12, pady=8, highlightthickness=1, highlightbackground="#23313d")
            box.pack(side="left", fill="x", expand=True, padx=3)
            tk.Label(box,text=label,font=("DejaVu Sans Mono",8,"bold"),fg=DIM,bg=PANEL2).pack(anchor="w")
            val=tk.Label(box,text="CHECKING",font=("DejaVu Sans Mono",10,"bold"),fg=YELLOW,bg=PANEL2)
            val.pack(anchor="w", pady=(5,0)); self.cards[key]=val

        buttons = tk.Frame(self, bg=BG, padx=14, pady=4)
        buttons.pack(fill="x")
        for text, action in [("▶ START","start"),("■ STOP","stop"),("↻ RESTART","restart")]:
            tk.Button(buttons,text=text,command=lambda a=action:self.do_action(a),bg="#17222d",fg=FG,
                      activebackground="#243443",activeforeground=FG,relief="flat",padx=14,pady=8,
                      font=("DejaVu Sans Mono",10,"bold")).pack(side="left",padx=(0,6))
        tk.Button(buttons,text="⟳ REFRESH",command=self.refresh,bg="#17222d",fg=CYAN,relief="flat",padx=14,pady=8).pack(side="right")

        self.pages = ttk.Notebook(self)
        self.pages.pack(fill="both", expand=True, padx=14, pady=8)
        ops_page = tk.Frame(self.pages, bg=BG)
        audio_page = tk.Frame(self.pages, bg=BG)
        settings_page = tk.Frame(self.pages, bg=BG)
        usage_page = tk.Frame(self.pages, bg=BG)
        self.pages.add(ops_page, text="  OPERATIONS  ")
        self.pages.add(audio_page, text="  AUDIO  ")
        self.pages.add(settings_page, text="  SETTINGS  ")
        self.pages.add(usage_page, text="  USAGE  ")

        main = tk.Frame(ops_page, bg=BG, padx=0, pady=0)
        main.pack(fill="both", expand=True)
        left = tk.Frame(main, bg=PANEL); left.pack(side="left", fill="both", expand=True, padx=(0,5))
        right = tk.Frame(main, bg=PANEL); right.pack(side="left", fill="both", expand=True, padx=(5,0))

        tk.Label(left,text="LIVE AVA-CORE LOG",font=TITLE,fg=CYAN,bg=PANEL,padx=10,pady=8).pack(anchor="w")
        self.logbox=tk.Text(left,bg="#070b0f",fg=FG,insertbackground=CYAN,relief="flat",font=("DejaVu Sans Mono",9),wrap="none",state="disabled")
        self.logbox.pack(fill="both",expand=True,padx=10,pady=(0,10))

        tk.Label(right,text="PROCESS / SYSTEM STATUS",font=TITLE,fg=CYAN,bg=PANEL,padx=10,pady=8).pack(anchor="w")
        self.procbox=tk.Text(right,bg="#070b0f",fg=FG,insertbackground=CYAN,relief="flat",font=("DejaVu Sans Mono",9),wrap="word",state="disabled")
        self.procbox.pack(fill="both",expand=True,padx=10,pady=(0,10))

        cron = tk.Frame(ops_page, bg=PANEL, padx=14, pady=10)
        cron.pack(fill="both", padx=14, pady=(0,8))
        head = tk.Frame(cron, bg=PANEL); head.pack(fill="x")
        tk.Label(head,text="CRONOLOGICAL JOB CONTROLS",font=TITLE,fg=CYAN,bg=PANEL).pack(side="left")
        self.cron_count = tk.Label(head,text="SCANNING",font=("DejaVu Sans Mono",9,"bold"),fg=DIM,bg=PANEL)
        self.cron_count.pack(side="right")
        tk.Button(head,text="⟳ SCAN",command=self.refresh_crons,bg="#17222d",fg=CYAN,relief="flat",padx=12).pack(side="right",padx=8)
        tk.Button(head,text="TOGGLE SELECTED",command=self.toggle_selected,bg="#17222d",fg=YELLOW,relief="flat",padx=12).pack(side="right")

        tree_frame = tk.Frame(cron, bg="#070b0f"); tree_frame.pack(fill="both", expand=True, pady=(8,0))
        style = ttk.Style(self)
        style.configure("Ava.Treeview", background="#070b0f", foreground=FG, fieldbackground="#070b0f", rowheight=24, font=("DejaVu Sans Mono",9))
        style.configure("Ava.Treeview.Heading", background="#17222d", foreground=CYAN, font=("DejaVu Sans Mono",9,"bold"))
        self.cron_paths = {}
        self.crontree = ttk.Treeview(tree_frame, columns=("status","path"), show="headings", style="Ava.Treeview", selectmode="browse")
        self.crontree.heading("status", text="STATUS"); self.crontree.heading("path", text="CRON PATH")
        self.crontree.column("status", width=100, stretch=False); self.crontree.column("path", width=1000, stretch=True)
        self.crontree.tag_configure("on", foreground=GREEN); self.crontree.tag_configure("off", foreground=RED)
        scroll=ttk.Scrollbar(tree_frame,orient="vertical",command=self.crontree.yview); self.crontree.configure(yscrollcommand=scroll.set)
        self.crontree.pack(side="left",fill="both",expand=True); scroll.pack(side="right",fill="y")
        self.crontree.bind("<Double-1>", lambda e:self.toggle_selected())

        cli = tk.Frame(ops_page,bg=PANEL,padx=14,pady=10)
        cli.pack(fill="x")
        tk.Label(cli,text="ava-core >",font=("DejaVu Sans Mono",11,"bold"),fg=GREEN,bg=PANEL).pack(side="left")
        self.command=tk.Entry(cli,bg="#070b0f",fg=FG,insertbackground=CYAN,relief="flat",font=FONT)
        self.command.pack(side="left",fill="x",expand=True,padx=10,ipady=6)
        self.command.bind("<Return>",lambda e:self.execute_command())
        tk.Button(cli,text="RUN",command=self.execute_command,bg="#17222d",fg=CYAN,relief="flat",padx=16).pack(side="right")
        self.command.insert(0,"help")
        # Cron controls now live under Settings. Keep Operations focused on live status.
        cron.pack_forget()


        # SSH PAGE
        ssh_page = tk.Frame(self.pages, bg=BG)
        self.ssh_page = ssh_page
        self.pages.add(ssh_page, text="  SSH MODE  ")

        ssh_head = tk.Frame(ssh_page, bg=PANEL, padx=14, pady=12)
        ssh_head.pack(fill="x")

        tk.Label(
            ssh_head,
            text="SSH REMOTE ACCESS",
            font=TITLE,
            fg=CYAN,
            bg=PANEL
        ).pack(side="left")

        self.ssh_status = tk.Label(
            ssh_head,
            text="CHECKING",
            font=("DejaVu Sans Mono", 10, "bold"),
            fg=YELLOW,
            bg=PANEL
        )
        self.ssh_status.pack(side="right")

        ssh_body = tk.Frame(ssh_page, bg=BG, padx=14, pady=14)
        ssh_body.pack(fill="both", expand=True)

        status_panel = tk.Frame(
            ssh_body,
            bg=PANEL,
            padx=18,
            pady=18,
            highlightthickness=1,
            highlightbackground="#23313d"
        )
        status_panel.pack(fill="x")

        tk.Label(
            status_panel,
            text="SSH MODE",
            font=("DejaVu Sans Mono", 16, "bold"),
            fg=CYAN,
            bg=PANEL
        ).pack(anchor="w")

        self.ssh_detail = tk.Label(
            status_panel,
            text="Checking SSH server...",
            font=FONT,
            fg=FG,
            bg=PANEL,
            justify="left",
            anchor="w"
        )
        self.ssh_detail.pack(anchor="w", pady=(10, 14))

        ssh_buttons = tk.Frame(status_panel, bg=PANEL)
        ssh_buttons.pack(anchor="w")

        tk.Button(
            ssh_buttons,
            text="ENABLE SSH",
            command=self.enable_ssh,
            bg="#17222d",
            fg=GREEN,
            activebackground="#243443",
            activeforeground=GREEN,
            relief="flat",
            padx=18,
            pady=9,
            font=("DejaVu Sans Mono", 10, "bold")
        ).pack(side="left", padx=(0, 8))

        tk.Button(
            ssh_buttons,
            text="DISABLE SSH",
            command=self.disable_ssh,
            bg="#17222d",
            fg=RED,
            activebackground="#243443",
            activeforeground=RED,
            relief="flat",
            padx=18,
            pady=9,
            font=("DejaVu Sans Mono", 10, "bold")
        ).pack(side="left", padx=(0, 8))

        tk.Button(
            ssh_buttons,
            text="REFRESH",
            command=self.refresh_ssh,
            bg="#17222d",
            fg=CYAN,
            activebackground="#243443",
            activeforeground=CYAN,
            relief="flat",
            padx=18,
            pady=9,
            font=("DejaVu Sans Mono", 10, "bold")
        ).pack(side="left")

        info_panel = tk.Frame(
            ssh_body,
            bg=PANEL,
            padx=18,
            pady=18,
            highlightthickness=1,
            highlightbackground="#23313d"
        )
        info_panel.pack(fill="x", pady=(12, 0))

        tk.Label(
            info_panel,
            text="CONNECTION INFORMATION",
            font=TITLE,
            fg=CYAN,
            bg=PANEL
        ).pack(anchor="w")

        self.ssh_info = tk.Label(
            info_panel,
            text="",
            font=FONT,
            fg=DIM,
            bg=PANEL,
            justify="left",
            anchor="w"
        )
        self.ssh_info.pack(anchor="w", pady=(10, 0))

        tk.Label(
            ssh_body,
            text=(
                "SSH Mode controls the local OpenSSH server on this Ava Core machine.\n"
                "Enable it when a trusted remote AI/development client needs SSH access.\n"
                "Authentication remains key-based; no SSH password is stored by Ava Desk."
            ),
            font=("DejaVu Sans Mono", 9),
            fg=DIM,
            bg=BG,
            justify="left",
            anchor="w"
        ).pack(anchor="w", pady=(14, 0))

        # AUDIO PAGE
        ahead = tk.Frame(audio_page, bg=PANEL, padx=14, pady=12)
        ahead.pack(fill="x")
        tk.Label(ahead, text="BACKGROUND AUDIO", font=TITLE, fg=CYAN, bg=PANEL).pack(side="left")
        self.audio_count = tk.Label(ahead, text="SCANNING", font=("DejaVu Sans Mono",9,"bold"), fg=DIM, bg=PANEL)
        self.audio_count.pack(side="right")
        tk.Button(ahead, text="⟳ SCAN", command=self.refresh_audio, bg="#17222d", fg=CYAN, relief="flat", padx=12).pack(side="right", padx=8)
        tk.Button(ahead, text="TOGGLE SELECTED", command=self.toggle_selected_audio, bg="#17222d", fg=YELLOW, relief="flat", padx=12).pack(side="right")

        info_audio = tk.Frame(audio_page, bg=BG, padx=0, pady=10)
        info_audio.pack(fill="x")
        self.audio_status = tk.Label(info_audio, text="AUDIO PLAYER: CHECKING", font=("DejaVu Sans Mono",10,"bold"), fg=YELLOW, bg=BG)
        self.audio_status.pack(side="left")
        tk.Label(info_audio, text="Drop MP3 files anywhere under cronologicals/ • rename to .mp3.disabled to turn off",
                 font=("DejaVu Sans Mono",9), fg=DIM, bg=BG).pack(side="right")

        audio_frame = tk.Frame(audio_page, bg=PANEL, padx=14, pady=10)
        audio_frame.pack(fill="both", expand=True)
        style.configure("Audio.Treeview", background="#070b0f", foreground=FG, fieldbackground="#070b0f",
                        rowheight=26, font=("DejaVu Sans Mono",9))
        style.configure("Audio.Treeview.Heading", background="#17222d", foreground=CYAN,
                        font=("DejaVu Sans Mono",9,"bold"))
        self.audio_paths = {}
        self.audiotree = ttk.Treeview(audio_frame, columns=("status","path"), show="headings",
                                      style="Audio.Treeview", selectmode="browse")
        self.audiotree.heading("status", text="STATUS")
        self.audiotree.heading("path", text="AUDIO PATH")
        self.audiotree.column("status", width=100, stretch=False)
        self.audiotree.column("path", width=1000, stretch=True)
        self.audiotree.tag_configure("on", foreground=GREEN)
        self.audiotree.tag_configure("off", foreground=RED)
        ascroll = ttk.Scrollbar(audio_frame, orient="vertical", command=self.audiotree.yview)
        self.audiotree.configure(yscrollcommand=ascroll.set)
        self.audiotree.pack(side="left", fill="both", expand=True)
        ascroll.pack(side="right", fill="y")
        self.audiotree.bind("<Double-1>", lambda e:self.toggle_selected_audio())

        audio_bottom = tk.Frame(audio_page, bg=PANEL, padx=14, pady=10)
        audio_bottom.pack(fill="x", pady=(8,0))
        tk.Button(audio_bottom, text="RESTART AUDIO PLAYER", command=lambda:self.audio_action("restart"),
                  bg="#17222d", fg=CYAN, relief="flat", padx=14, pady=8).pack(side="left")
        tk.Button(audio_bottom, text="VIEW AUDIO LOG", command=self.show_audio_log,
                  bg="#17222d", fg=FG, relief="flat", padx=14, pady=8).pack(side="left", padx=8)

        # SETTINGS PAGE — home for all Ava Desk configuration
        settings_head = tk.Frame(settings_page, bg=PANEL, padx=14, pady=12)
        settings_head.pack(fill="x")
        tk.Label(settings_head, text="AVA DESK SETTINGS", font=TITLE, fg=CYAN, bg=PANEL).pack(side="left")
        self.settings_count = tk.Label(
            settings_head, text="SCANNING", font=("DejaVu Sans Mono", 9, "bold"), fg=DIM, bg=PANEL
        )
        self.settings_count.pack(side="right")
        tk.Button(
            settings_head, text="⟳ SCAN", command=self.refresh_settings,
            bg="#17222d", fg=CYAN, relief="flat", padx=12
        ).pack(side="right", padx=8)
        tk.Button(
            settings_head, text="TOGGLE SELECTED", command=self.toggle_selected_settings,
            bg="#17222d", fg=YELLOW, relief="flat", padx=12
        ).pack(side="right")

        # Cron controls are intentionally built in Settings, rather than Operations.
        cron_settings = tk.Frame(settings_page, bg=PANEL, padx=14, pady=10)
        cron_settings.pack(fill="both", expand=True, padx=14, pady=(8, 0))
        cron_head = tk.Frame(cron_settings, bg=PANEL); cron_head.pack(fill="x")
        tk.Label(cron_head, text="CRONOLOGICAL JOBS", font=TITLE, fg=CYAN, bg=PANEL).pack(side="left")
        self.cron_count = tk.Label(cron_head, text="SCANNING", font=("DejaVu Sans Mono",9,"bold"), fg=DIM, bg=PANEL)
        self.cron_count.pack(side="right")
        tk.Button(cron_head, text="⟳ SCAN", command=self.refresh_crons, bg="#17222d", fg=CYAN, relief="flat", padx=12).pack(side="right", padx=8)
        tk.Button(cron_head, text="TOGGLE SELECTED", command=self.toggle_selected, bg="#17222d", fg=YELLOW, relief="flat", padx=12).pack(side="right")
        tk.Label(cron_settings, text="Every scheduled script is controllable here. Renaming to .py.disabled prevents the runner from discovering it.", font=("DejaVu Sans Mono",9), fg=DIM, bg=PANEL).pack(anchor="w", pady=(4,8))
        cron_tree_frame = tk.Frame(cron_settings, bg="#070b0f"); cron_tree_frame.pack(fill="both", expand=True)
        self.cron_paths = {}
        self.crontree = ttk.Treeview(cron_tree_frame, columns=("status","path"), show="headings", style="Ava.Treeview", selectmode="browse")
        self.crontree.heading("status", text="STATUS"); self.crontree.heading("path", text="CRON PATH")
        self.crontree.column("status", width=100, stretch=False); self.crontree.column("path", width=1000, stretch=True)
        self.crontree.tag_configure("on", foreground=GREEN); self.crontree.tag_configure("off", foreground=RED)
        cron_scroll = ttk.Scrollbar(cron_tree_frame, orient="vertical", command=self.crontree.yview)
        self.crontree.configure(yscrollcommand=cron_scroll.set)
        self.crontree.pack(side="left", fill="both", expand=True); cron_scroll.pack(side="right", fill="y")
        self.crontree.bind("<Double-1>", lambda e:self.toggle_selected())

        proc_panel = tk.Frame(settings_page, bg=PANEL, padx=14, pady=10)
        proc_panel.pack(fill="both", expand=True, padx=14, pady=(8, 0))
        tk.Label(
            proc_panel, text="SYSTEM PROCESSES (always-on)",
            font=TITLE, fg=CYAN, bg=PANEL
        ).pack(anchor="w")
        tk.Label(
            proc_panel,
            text="Rename to .py.disabled to stop a process. Ava-core supervisor picks up changes within seconds.",
            font=("DejaVu Sans Mono", 9), fg=DIM, bg=PANEL, justify="left"
        ).pack(anchor="w", pady=(4, 8))

        proc_tree_frame = tk.Frame(proc_panel, bg="#070b0f")
        proc_tree_frame.pack(fill="both", expand=True)
        style.configure(
            "Settings.Treeview", background="#070b0f", foreground=FG, fieldbackground="#070b0f",
            rowheight=26, font=("DejaVu Sans Mono", 9)
        )
        style.configure(
            "Settings.Treeview.Heading", background="#17222d", foreground=CYAN,
            font=("DejaVu Sans Mono", 9, "bold")
        )
        self.settings_paths = {}
        self.settingstree = ttk.Treeview(
            proc_tree_frame, columns=("status", "path"), show="headings",
            style="Settings.Treeview", selectmode="browse"
        )
        self.settingstree.heading("status", text="STATUS")
        self.settingstree.heading("path", text="PROCESS")
        self.settingstree.column("status", width=100, stretch=False)
        self.settingstree.column("path", width=1000, stretch=True)
        self.settingstree.tag_configure("on", foreground=GREEN)
        self.settingstree.tag_configure("off", foreground=RED)
        sscroll = ttk.Scrollbar(proc_tree_frame, orient="vertical", command=self.settingstree.yview)
        self.settingstree.configure(yscrollcommand=sscroll.set)
        self.settingstree.pack(side="left", fill="both", expand=True)
        sscroll.pack(side="right", fill="y")
        self.settingstree.bind("<Double-1>", lambda e: self.toggle_selected_settings())

        options_panel = tk.Frame(settings_page, bg=PANEL, padx=14, pady=14)
        options_panel.pack(fill="x", padx=14, pady=(8, 8))
        tk.Label(options_panel, text="SYSTEM OPTIONS", font=TITLE, fg=CYAN, bg=PANEL).pack(anchor="w")

        opt_row = tk.Frame(options_panel, bg=PANEL)
        opt_row.pack(fill="x", pady=(10, 0))

        dir_box = tk.Frame(opt_row, bg=PANEL2, padx=14, pady=12, highlightthickness=1, highlightbackground="#23313d")
        dir_box.pack(side="left", fill="both", expand=True, padx=(0, 6))
        tk.Label(dir_box, text="PUBLIC /DIRECTORY PAGE", font=("DejaVu Sans Mono", 9, "bold"), fg=DIM, bg=PANEL2).pack(anchor="w")
        self.settings_directory_status = tk.Label(dir_box, text="CHECKING", font=FONT, fg=YELLOW, bg=PANEL2)
        self.settings_directory_status.pack(anchor="w", pady=(6, 8))
        self.settings_directory_btn = tk.Button(
            dir_box, text="TOGGLE DIRECTORY", command=self.toggle_directory_setting,
            bg="#17222d", fg=YELLOW, relief="flat", padx=12, pady=6
        )
        self.settings_directory_btn.pack(anchor="w")

        boot_box = tk.Frame(opt_row, bg=PANEL2, padx=14, pady=12, highlightthickness=1, highlightbackground="#23313d")
        boot_box.pack(side="left", fill="both", expand=True, padx=(6, 0))
        tk.Label(boot_box, text="AVA CORE AT BOOT", font=("DejaVu Sans Mono", 9, "bold"), fg=DIM, bg=PANEL2).pack(anchor="w")
        self.settings_boot_status = tk.Label(boot_box, text="CHECKING", font=FONT, fg=YELLOW, bg=PANEL2)
        self.settings_boot_status.pack(anchor="w", pady=(6, 8))
        self.settings_boot_btn = tk.Button(
            boot_box, text="TOGGLE BOOT START", command=self.toggle_boot_setting,
            bg="#17222d", fg=YELLOW, relief="flat", padx=12, pady=6
        )
        self.settings_boot_btn.pack(anchor="w")

        ssh_box = tk.Frame(opt_row, bg=PANEL2, padx=14, pady=12, highlightthickness=1, highlightbackground="#23313d")
        ssh_box.pack(side="left", fill="both", expand=True, padx=(6, 0))
        tk.Label(ssh_box, text="SSH MODE VISIBILITY", font=("DejaVu Sans Mono", 9, "bold"), fg=DIM, bg=PANEL2).pack(anchor="w")
        self.settings_ssh_status = tk.Label(ssh_box, text="CHECKING", font=FONT, fg=YELLOW, bg=PANEL2)
        self.settings_ssh_status.pack(anchor="w", pady=(6, 8))
        self.settings_ssh_btn = tk.Button(ssh_box, command=self.toggle_ssh_visibility, bg="#17222d", fg=YELLOW, relief="flat", padx=12, pady=6)
        self.settings_ssh_btn.pack(anchor="w")

        tk.Label(
            settings_page,
            text="All Ava Desk settings will live on this tab. SSH and other controls will move here over time.",
            font=("DejaVu Sans Mono", 9), fg=DIM, bg=BG, justify="left"
        ).pack(anchor="w", padx=18, pady=(0, 10))

        self.make_usage_ui(usage_page)
        if not self.desk_settings.get("ssh_mode_visible", True):
            self.pages.hide(self.ssh_page)

    def make_usage_ui(self, page):
        """Initial local account ledger.  It deliberately stores metadata, never API tokens."""
        head = tk.Frame(page, bg=PANEL, padx=14, pady=12); head.pack(fill="x")
        tk.Label(head, text="AI ACCOUNT USAGE", font=TITLE, fg=CYAN, bg=PANEL).pack(side="left")
        self.usage_summary = tk.Label(head, text="0 ACCOUNTS", font=("DejaVu Sans Mono",9,"bold"), fg=DIM, bg=PANEL)
        self.usage_summary.pack(side="right")
        tk.Button(head, text="OPEN CONTEXT FOLDER", command=self.open_usage_folder, bg="#17222d", fg=CYAN, relief="flat", padx=12).pack(side="right", padx=8)
        tk.Button(head, text="NEW ACCOUNT", command=self.new_usage_account, bg="#17222d", fg=GREEN, relief="flat", padx=12).pack(side="right")

        body = tk.Frame(page, bg=BG, padx=14, pady=10); body.pack(fill="both", expand=True)
        left = tk.Frame(body, bg=PANEL, padx=10, pady=10); left.pack(side="left", fill="both", expand=True, padx=(0,6))
        right = tk.Frame(body, bg=PANEL, padx=14, pady=12); right.pack(side="left", fill="both", expand=True, padx=(6,0))
        tk.Label(left, text="ACCOUNTS", font=TITLE, fg=CYAN, bg=PANEL).pack(anchor="w")
        self.usage_tree = ttk.Treeview(left, columns=("state","account","reset"), show="headings", style="Ava.Treeview", selectmode="browse")
        for column, text, width in (("state","STATE",90),("account","ACCOUNT",220),("reset","NEXT RESET",180)):
            self.usage_tree.heading(column, text=text); self.usage_tree.column(column, width=width, stretch=column == "account")
        self.usage_tree.tag_configure("available", foreground=GREEN); self.usage_tree.tag_configure("unavailable", foreground=RED)
        usage_scroll = ttk.Scrollbar(left, orient="vertical", command=self.usage_tree.yview); self.usage_tree.configure(yscrollcommand=usage_scroll.set)
        self.usage_tree.pack(side="left", fill="both", expand=True, pady=(8,0)); usage_scroll.pack(side="right", fill="y", pady=(8,0))
        self.usage_tree.bind("<<TreeviewSelect>>", lambda _e:self.load_selected_usage())

        tk.Label(right, text="ACCOUNT DETAILS", font=TITLE, fg=CYAN, bg=PANEL).pack(anchor="w")
        fields = tk.Frame(right, bg=PANEL); fields.pack(fill="x", pady=(8,0))
        self.usage_name = self.usage_entry(fields, "Account name")
        self.usage_provider = self.usage_entry(fields, "Provider / AI")
        self.usage_reset = self.usage_entry(fields, "Next reset (YYYY-MM-DD HH:MM)")
        self.usage_token = self.usage_entry(fields, "API token usage (count / summary)")
        self.usage_available = tk.BooleanVar(value=True)
        tk.Checkbutton(fields, text="Available", variable=self.usage_available, bg=PANEL, fg=FG, selectcolor="#17222d", activebackground=PANEL, activeforeground=FG).pack(anchor="w", pady=(6,0))
        self.usage_countdown = tk.Label(fields, text="No reset scheduled", font=("DejaVu Sans Mono",10,"bold"), fg=DIM, bg=PANEL)
        self.usage_countdown.pack(anchor="w", pady=(4,8))
        self.usage_information = self.usage_text(right, "Information / billing")
        self.usage_notes = self.usage_text(right, "Notes")
        self.usage_session = self.usage_text(right, "Recent session log (saved as .txt)")
        actions = tk.Frame(right, bg=PANEL); actions.pack(fill="x", pady=(10,0))
        for text, command, color in (("SAVE", self.save_usage_account, GREEN), ("DELETE", self.delete_usage_account, RED), ("RESET USAGE", self.reset_usage, YELLOW), ("RESET BILLING", self.reset_billing, YELLOW), ("ADD NOTES", self.add_usage_notes, CYAN), ("UPLOAD .TXT", self.upload_session_log, CYAN)):
            tk.Button(actions, text=text, command=command, bg="#17222d", fg=color, relief="flat", padx=8, pady=6).pack(side="left", padx=(0,5), pady=(0,5))
        tk.Label(right, text="Usage data is stored under /home/ava-core/context/usage/. API tokens are not stored; enter only usage totals or summaries.", font=("DejaVu Sans Mono",8), fg=DIM, bg=PANEL, justify="left", wraplength=520).pack(anchor="w", pady=(6,0))
        self.refresh_usage()
        self.after(1000, self.refresh_usage_countdown)

    def usage_entry(self, parent, label):
        tk.Label(parent, text=label.upper(), font=("DejaVu Sans Mono",8,"bold"), fg=DIM, bg=PANEL).pack(anchor="w", pady=(5,0))
        entry = tk.Entry(parent, bg="#070b0f", fg=FG, insertbackground=CYAN, relief="flat", font=FONT)
        entry.pack(fill="x", ipady=5)
        return entry

    def usage_text(self, parent, label):
        tk.Label(parent, text=label.upper(), font=("DejaVu Sans Mono",8,"bold"), fg=DIM, bg=PANEL).pack(anchor="w", pady=(8,0))
        box = tk.Text(parent, height=3, bg="#070b0f", fg=FG, insertbackground=CYAN, relief="flat", font=("DejaVu Sans Mono",9), wrap="word")
        box.pack(fill="x")
        return box

    def usage_form_value(self, widget):
        return widget.get("1.0", "end-1c").strip() if isinstance(widget, tk.Text) else widget.get().strip()

    def set_usage_form_value(self, widget, value):
        if isinstance(widget, tk.Text):
            widget.delete("1.0", "end"); widget.insert("1.0", value or "")
        else:
            widget.delete(0, "end"); widget.insert(0, value or "")

    def new_usage_account(self):
        self.usage_tree.selection_remove(self.usage_tree.selection())
        for widget in (self.usage_name, self.usage_provider, self.usage_reset, self.usage_token, self.usage_information, self.usage_notes, self.usage_session): self.set_usage_form_value(widget, "")
        self.usage_available.set(True); self.usage_name.focus_set()

    def selected_usage_index(self):
        selection = self.usage_tree.selection()
        return int(selection[0]) if selection else None

    def load_selected_usage(self):
        index = self.selected_usage_index()
        if index is None or index >= len(self.usage_accounts): return
        account = self.usage_accounts[index]
        for widget, key in ((self.usage_name,"name"),(self.usage_provider,"provider"),(self.usage_reset,"next_reset"),(self.usage_token,"api_token_usage"),(self.usage_information,"information"),(self.usage_notes,"notes")):
            self.set_usage_form_value(widget, str(account.get(key, "")))
        self.set_usage_form_value(self.usage_session, "")
        self.usage_available.set(bool(account.get("available", True)))
        self.refresh_usage_countdown()

    def save_usage_account(self):
        name = self.usage_form_value(self.usage_name)
        if not name:
            messagebox.showinfo("Usage", "Give the account a name first."); return
        reset = self.usage_form_value(self.usage_reset)
        if reset:
            try: datetime.fromisoformat(reset.replace("Z", "+00:00"))
            except ValueError:
                messagebox.showerror("Usage", "Use a reset time like 2026-08-25 14:30."); return
        index = self.selected_usage_index()
        account = self.usage_accounts[index] if index is not None and index < len(self.usage_accounts) else {"id": f"account-{datetime.now():%Y%m%d%H%M%S}"}
        for key, widget in (("name",self.usage_name),("provider",self.usage_provider),("next_reset",self.usage_reset),("api_token_usage",self.usage_token),("information",self.usage_information),("notes",self.usage_notes)):
            account[key] = self.usage_form_value(widget)
        account["available"] = bool(self.usage_available.get()); account["updated_at"] = datetime.now(timezone.utc).isoformat()
        log = self.usage_form_value(self.usage_session)
        if log:
            log_dir = USAGE_ROOT / "sessions" / account["id"]; log_dir.mkdir(parents=True, exist_ok=True)
            log_name = f"session-{datetime.now():%Y%m%d-%H%M%S}.txt"; (log_dir / log_name).write_text(log + "\n", encoding="utf-8")
            account["last_session_log"] = str((Path("sessions") / account["id"] / log_name))
        if index is None: self.usage_accounts.append(account)
        else: self.usage_accounts[index] = account
        save_usage_accounts(self.usage_accounts); self.refresh_usage(select_index=index if index is not None else len(self.usage_accounts)-1)

    def delete_usage_account(self):
        index = self.selected_usage_index()
        if index is None: messagebox.showinfo("Usage", "Select an account to remove."); return
        if messagebox.askyesno("Usage", f"Remove {self.usage_accounts[index].get('name', 'this account')} from the usage ledger?"):
            del self.usage_accounts[index]; save_usage_accounts(self.usage_accounts); self.new_usage_account(); self.refresh_usage()

    def reset_usage(self):
        self.set_usage_form_value(self.usage_token, "0"); self.usage_available.set(True); self.save_usage_account()

    def reset_billing(self):
        self.set_usage_form_value(self.usage_information, ""); self.save_usage_account()

    def add_usage_notes(self):
        note = simpledialog.askstring("Usage notes", "Add a note to the selected account:", parent=self)
        if note:
            prior = self.usage_form_value(self.usage_notes); self.set_usage_form_value(self.usage_notes, (prior + "\n" if prior else "") + f"[{datetime.now():%Y-%m-%d %H:%M}] {note}"); self.save_usage_account()

    def upload_session_log(self):
        path = filedialog.askopenfilename(title="Choose a session log", filetypes=[("Text files", "*.txt")])
        if not path: return
        try: self.set_usage_form_value(self.usage_session, Path(path).read_text(encoding="utf-8", errors="replace"))
        except OSError as e: messagebox.showerror("Usage", f"Could not read log:\n{e}")

    def open_usage_folder(self):
        USAGE_ROOT.mkdir(parents=True, exist_ok=True)
        try: subprocess.Popen(["xdg-open", str(USAGE_ROOT)])
        except OSError as e: messagebox.showerror("Usage", f"Could not open context folder:\n{e}")

    def refresh_usage(self, select_index=None):
        self.usage_accounts = load_usage_accounts()
        for item in self.usage_tree.get_children(): self.usage_tree.delete(item)
        available = 0
        for index, account in enumerate(self.usage_accounts):
            is_available = bool(account.get("available", True)); available += int(is_available)
            self.usage_tree.insert("", "end", iid=str(index), values=("● AVAILABLE" if is_available else "● FULL", f"{account.get('provider','')} {account.get('name','')}".strip(), account.get("next_reset") or "—"), tags=("available" if is_available else "unavailable",))
        self.usage_summary.configure(text=f"{len(self.usage_accounts)} ACCOUNTS  •  {available} AVAILABLE")
        if select_index is not None and str(select_index) in self.usage_tree.get_children(): self.usage_tree.selection_set(str(select_index)); self.usage_tree.focus(str(select_index))
        self.refresh_usage_countdown()

    def refresh_usage_countdown(self):
        index = self.selected_usage_index()
        if index is not None and index < len(self.usage_accounts):
            reset = self.usage_accounts[index].get("next_reset", "")
            try:
                target = datetime.fromisoformat(reset.replace("Z", "+00:00"))
                if target.tzinfo is None: target = target.replace(tzinfo=timezone.utc)
                seconds = int((target - datetime.now(timezone.utc)).total_seconds())
                text = f"RESET {'IN ' if seconds >= 0 else 'OVERDUE BY '}{abs(seconds)//3600:02d}:{abs(seconds)%3600//60:02d}:{abs(seconds)%60:02d}"
                self.usage_countdown.configure(text=text, fg=GREEN if seconds >= 0 else RED)
            except (ValueError, TypeError): self.usage_countdown.configure(text="No reset scheduled", fg=DIM)
        if self.winfo_exists(): self.after(1000, self.refresh_usage_countdown)


    def state(self, cmd):
        rc,out=run(cmd); return rc==0 and bool(out), out

    def set_text(self, widget, text):
        widget.configure(state="normal")
        widget.delete("1.0", "end")
        widget.insert("end", text)
        widget.configure(state="disabled")

    def refresh_audio(self):
        selected = self.audiotree.selection()
        selected_path = self.audio_paths.get(selected[0]) if selected else None
        self.audio_paths.clear()
        for item in self.audiotree.get_children():
            self.audiotree.delete(item)
        jobs = audio_jobs()
        on_count = off_count = 0
        for job in jobs:
            enabled = job["enabled"]
            on_count += int(enabled); off_count += int(not enabled)
            iid = self.audiotree.insert("", "end",
                values=("● ON" if enabled else "○ OFF", job["rel"]),
                tags=("on" if enabled else "off",))
            self.audio_paths[iid] = str(job["path"])
            if selected_path == str(job["path"]):
                self.audiotree.selection_set(iid)
        self.audio_count.configure(text=f"{len(jobs)} TRACKS  •  {on_count} ON  •  {off_count} OFF")
        running = run("pgrep -af '[a]va_core_audio_player.py'")[0] == 0
        self.audio_status.configure(text=("AUDIO PLAYER: RUNNING" if running else "AUDIO PLAYER: OFFLINE"),
                                    fg=GREEN if running else RED)

    def toggle_selected_audio(self):
        sel = self.audiotree.selection()
        if not sel:
            messagebox.showinfo("AVA Audio", "Select an MP3 first.")
            return
        path = Path(self.audio_paths.get(sel[0], ""))
        try:
            target, enabled = toggle_audio(path)
            self.show_command_result("audio toggle", f"{'ENABLED' if enabled else 'DISABLED'}\n{target}")
            self.refresh_audio()
        except Exception as e:
            messagebox.showerror("AVA Audio", f"Audio toggle failed:\n{e}")

    def audio_action(self, action):
        cmd = f"pkexec systemctl restart {SERVICE}" if action == "restart" else ""
        if not cmd:
            return
        def worker():
            rc, out = run(cmd, 30)
            self.after(0, lambda:self.show_command_result("restart audio player", out or f"exit={rc}"))
            self.after(1000, self.refresh_audio)
        threading.Thread(target=worker, daemon=True).start()

    def show_audio_log(self):
        p = Path("/home/ava-core/database/logs/ava-core-audio.log")
        try:
            text = "\n".join(p.read_text(errors="replace").splitlines()[-120:]) if p.exists() else "No audio log yet."
        except Exception as e:
            text = str(e)
        self.set_text(self.procbox, "=== AVA CORE AUDIO LOG ===\n" + text)

    def refresh_crons(self):
        selected = self.crontree.selection()
        selected_path = self.cron_paths.get(selected[0]) if selected else None
        self.cron_paths.clear()
        for item in self.crontree.get_children(): self.crontree.delete(item)
        jobs = cron_jobs()
        on_count = off_count = 0
        for job in jobs:
            enabled = job["enabled"]; on_count += int(enabled); off_count += int(not enabled)
            values = ("● ON" if enabled else "○ OFF", job["rel"])
            iid = self.crontree.insert("", "end", values=values, tags=("on" if enabled else "off",))
            self.cron_paths[iid] = str(job["path"])
            if selected_path == str(job["path"]): self.crontree.selection_set(iid)
        self.cron_count.configure(text=f"{len(jobs)} JOBS  •  {on_count} ON  •  {off_count} OFF")

    def toggle_selected(self):
        sel = self.crontree.selection()
        if not sel:
            messagebox.showinfo("AVA Core","Select a cron job first."); return
        path_str = self.cron_paths.get(sel[0])
        if not path_str: return
        path = Path(path_str)
        try:
            target, enabled = toggle_job(path)
            self.show_command_result("cron toggle", f"{'ENABLED' if enabled else 'DISABLED'}\n{target}")
            self.refresh_crons()
        except Exception as e:
            messagebox.showerror("AVA Core", f"Cron toggle failed:\n{e}")

    def refresh_settings(self):
        selected = self.settingstree.selection()
        selected_path = self.settings_paths.get(selected[0]) if selected else None
        self.settings_paths.clear()
        for item in self.settingstree.get_children():
            self.settingstree.delete(item)
        jobs = always_on_jobs()
        on_count = off_count = 0
        for job in jobs:
            enabled = job["enabled"]
            on_count += int(enabled)
            off_count += int(not enabled)
            iid = self.settingstree.insert(
                "", "end",
                values=("● ON" if enabled else "○ OFF", job["rel"]),
                tags=("on" if enabled else "off",),
            )
            self.settings_paths[iid] = str(job["path"])
            if selected_path == str(job["path"]):
                self.settingstree.selection_set(iid)
        self.settings_count.configure(
            text=f"{len(jobs)} PROCESSES  •  {on_count} ON  •  {off_count} OFF"
        )

        dir_on = directory_is_enabled()
        self.settings_directory_status.configure(
            text=f"Directory browser is {'ON' if dir_on else 'OFF'}",
            fg=GREEN if dir_on else RED,
        )
        self.settings_directory_btn.configure(
            text="DISABLE /DIRECTORY" if dir_on else "ENABLE /DIRECTORY"
        )

        boot_on = boot_is_enabled()
        self.settings_boot_status.configure(
            text=f"systemctl is-{'enabled' if boot_on else 'disabled'} ({SERVICE})",
            fg=GREEN if boot_on else RED,
        )
        self.settings_boot_btn.configure(
            text="DISABLE BOOT START" if boot_on else "ENABLE BOOT START"
        )
        ssh_visible = self.desk_settings.get("ssh_mode_visible", True)
        self.settings_ssh_status.configure(
            text="SSH Mode tab is VISIBLE" if ssh_visible else "SSH Mode hidden; server locked down",
            fg=GREEN if ssh_visible else RED,
        )
        self.settings_ssh_btn.configure(
            text="HIDE & LOCK DOWN SSH" if ssh_visible else "SHOW SSH MODE"
        )

    def toggle_selected_settings(self):
        sel = self.settingstree.selection()
        if not sel:
            messagebox.showinfo("AVA Settings", "Select a system process first.")
            return
        path = Path(self.settings_paths.get(sel[0], ""))
        if not path:
            return
        try:
            target, enabled = toggle_always_on(path)
            self.show_command_result(
                "settings process toggle",
                f"{'ENABLED' if enabled else 'DISABLED'}\n{target}\n"
                f"(ava-core supervisor applies within a few seconds)",
            )
            self.refresh_settings()
            self.refresh()
        except Exception as e:
            messagebox.showerror("AVA Settings", f"Process toggle failed:\n{e}")

    def toggle_directory_setting(self):
        try:
            enabled = toggle_directory()
            self.refresh_settings()
            self.refresh()
            self.show_command_result(
                "directory toggle",
                f"{'ENABLED' if enabled else 'DISABLED'}\nhttp://localhost:8080/directory/",
            )
        except Exception as e:
            messagebox.showerror("AVA Settings", f"Directory toggle failed:\n{e}")

    def toggle_boot_setting(self):
        def worker():
            try:
                enabled, out = toggle_boot_at_startup()
                self.after(0, lambda: self.show_command_result(
                    "boot toggle",
                    f"{'ENABLED' if enabled else 'DISABLED'}\n{SERVICE}\n{out}",
                ))
                self.after(0, self.refresh_settings)
                self.after(0, self.refresh)
            except Exception as e:
                self.after(0, lambda: messagebox.showerror("AVA Settings", f"Boot toggle failed:\n{e}"))
        threading.Thread(target=worker, daemon=True).start()

    def toggle_ssh_visibility(self):
        """Hiding the tab is a security action: stop and disable OpenSSH first."""
        visible = self.desk_settings.get("ssh_mode_visible", True)
        if not visible:
            self.desk_settings["ssh_mode_visible"] = True
            save_desk_settings(self.desk_settings)
            self.pages.add(self.ssh_page, text="  SSH MODE  ")
            self.refresh_settings(); self.refresh_ssh()
            return
        if not messagebox.askyesno(
            "Hide and lock SSH Mode",
            "Hide SSH Mode and disable both ssh.service and ssh.socket?\n\n"
            "The tab will only be hidden after the lockdown succeeds.",
        ):
            return
        self.settings_ssh_btn.configure(state="disabled", text="LOCKING DOWN SSH…")
        def worker():
            rc, out = self.ssh_command("systemctl disable --now ssh.service ssh.socket", timeout=30)
            def done():
                self.settings_ssh_btn.configure(state="normal")
                if rc != 0:
                    messagebox.showerror("SSH Mode", "SSH was not hidden because lockdown failed.\n\n" + (out or "Unknown error."))
                    self.refresh_settings(); return
                self.desk_settings["ssh_mode_visible"] = False
                save_desk_settings(self.desk_settings)
                self.pages.hide(self.ssh_page)
                self.refresh_settings()
                self.show_command_result("ssh lockdown", out or "SSH service and socket disabled")
            self.after(0, done)
        threading.Thread(target=worker, daemon=True).start()

    def refresh(self):
        def worker():
            active = run(f"systemctl is-active {SERVICE}")[1].strip()=="active"
            enabled = run(f"systemctl is-enabled {SERVICE}")[1].strip()=="enabled"
            dir_on = directory_is_enabled()
            checks = {"service": ("RUNNING" if active else "STOPPED", active),
                      "watchdog": self.state("pgrep -af '[a]vaivy_cloudflare_watchdog.py'"),
                      "broadcast": self.state("pgrep -af '[b]roadcast.py'"),
                      "cloudflared": self.state("pgrep -af '[c]loudflared'"),
                      "port": self.state("ss -ltn 2>/dev/null | grep -q ':8080'"),
                      "directory": ("ON" if dir_on else "OFF", dir_on)}
            proc = run("ps -eo pid,ppid,stat,etime,cmd | grep -E '[p]ython.*ava-core.py|[a]vaivy_cloudflare_watchdog.py|[b]roadcast.py|[c]loudflared'")[1]
            svc = run(f"systemctl --no-pager --full status {SERVICE} | head -25")[1]
            logtext=""
            for p in (LOG,SYSTEMD_LOG):
                if p.exists():
                    try: logtext += f"\n--- {p.name} ---\n" + "\n".join(p.read_text(errors="replace").splitlines()[-80:]) + "\n"
                    except: pass
            self.after(0,lambda:self.apply_refresh(active,enabled,checks,proc,svc,logtext))
        threading.Thread(target=worker,daemon=True).start()

    def apply_refresh(self,active,enabled,checks,proc,svc,logtext):
        for key,val in checks.items():
            text,ok = val if isinstance(val,tuple) else (val,False)
            self.cards[key].configure(text=text,fg=GREEN if ok else RED)
        self.status.configure(text=("● AVA CORE ONLINE" if active else "● AVA CORE OFFLINE"),fg=GREEN if active else RED)
        combined = f"{svc}\n\n=== PROCESS TREE ===\n{proc or 'No managed processes found.'}\n"
        self.set_text(self.procbox,combined); self.set_text(self.logbox,logtext or "No Ava-Core log data found yet.")
        if self.after_id: self.after_cancel(self.after_id)
        self.after_id=self.after(2000,self.refresh)
        self.refresh_audio()
        self.refresh_settings()

    def do_action(self,action):
        if action=="stop" and not messagebox.askyesno("AVA Core","Stop Ava-Core and its managed processes?"): return
        self.command.delete(0,"end"); self.command.insert(0,action); self.execute_command()

    def execute_command(self):
        raw=self.command.get().strip(); cmd=raw.lower()
        aliases={"status":f"systemctl --no-pager status {SERVICE}","start":f"pkexec systemctl start {SERVICE}",
                 "stop":f"pkexec systemctl stop {SERVICE}","restart":f"pkexec systemctl restart {SERVICE}",
                 "logs":"tail -100 /home/ava-core/database/logs/ava-core.log",
                 "processes":"ps -eo pid,ppid,stat,etime,cmd | grep -E '[p]ython.*ava-core.py|[a]vaivy_cloudflare_watchdog.py|[b]roadcast.py|[c]loudflared'",
                 "port":"ss -ltnp | grep ':8080'",
                 "help":"Commands: help | status | start | stop | restart | logs | processes | port | refresh | crons | settings | toggle <cron-path> | audio | audio-toggle <audio-path> | audio-log | directory | directory-toggle"}
        if cmd=="refresh": self.refresh(); self.refresh_crons(); self.refresh_settings(); return
        if cmd=="settings":
            self.pages.select(2)
            self.refresh_settings()
            self.show_command_result("settings", f"Scanned {ALWAYS_ON}")
            return
        if cmd=="crons":
            self.refresh_crons(); self.show_command_result("crons", f"Scanned {CRONO_ROOT}"); return
        if cmd in ("directory", "dir"):
            on = directory_is_enabled()
            self.show_command_result(
                "directory",
                f"status: {'ON' if on else 'OFF'}\n"
                f"url: https://avaivy.cloud/directory\n"
                f"flag: {DIR_FLAG}\n"
                f"disabled-flag: {DIR_FLAG_DISABLED}\n"
                f"Toggle with: directory-toggle",
            )
            return
        if cmd in ("directory-toggle", "dir-toggle"):
            try:
                enabled = toggle_directory()
                self.refresh()
                self.show_command_result(
                    "directory-toggle",
                    f"{'ENABLED' if enabled else 'DISABLED'}\n"
                    f"https://avaivy.cloud/directory\n"
                    f"(broadcast serves the page; restart broadcast only if needed)",
                )
            except Exception as e:
                messagebox.showerror("AVA Directory", str(e))
            return
        if cmd=="audio":
            self.pages.select(1); self.refresh_audio(); self.show_command_result("audio", f"Scanned {CRONO_ROOT} for MP3 files"); return
        if cmd=="audio-log":
            self.show_audio_log(); return
        if raw.lower().startswith("audio-toggle "):
            query=raw[13:].strip()
            matches=[j for j in audio_jobs() if j["rel"]==query or j["path"].name==query]
            if len(matches)!=1:
                messagebox.showwarning("AVA Audio CLI", f"Expected one audio match for: {query}"); return
            try:
                target, enabled=toggle_audio(matches[0]["path"])
                self.refresh_audio()
                self.show_command_result("audio toggle",f"{'ENABLED' if enabled else 'DISABLED'}\n{target}")
            except Exception as e:
                messagebox.showerror("AVA Audio",str(e))
            return
        if raw.lower().startswith("toggle "):
            query=raw[7:].strip()
            matches=[j for j in cron_jobs() if j["rel"]==query or j["path"].name==query]
            if len(matches)!=1: messagebox.showwarning("AVA Core CLI", f"Expected one cron match for: {query}"); return
            try:
                target, enabled=toggle_job(matches[0]["path"]); self.refresh_crons(); self.show_command_result("cron toggle",f"{'ENABLED' if enabled else 'DISABLED'}\n{target}")
            except Exception as e: messagebox.showerror("AVA Core",str(e))
            return
        shell=aliases.get(cmd)
        if not shell: messagebox.showwarning("AVA Core CLI","Unknown command.\nType: help"); return
        self.command.delete(0,"end"); self.command.insert(0,cmd)
        def worker():
            rc,out=run(shell,30); self.after(0,lambda:self.show_command_result(cmd,out or f"exit={rc}")); self.after(0,self.refresh)
        threading.Thread(target=worker,daemon=True).start()

    def show_command_result(self,cmd,out):
        self.procbox.configure(state="normal"); self.procbox.insert("end",f"\n\n$ {cmd}\n{out}\n"); self.procbox.see("end"); self.procbox.configure(state="disabled")


    def ssh_command(self, command, timeout=10):
        """Run an SSH/systemd command through pkexec."""
        try:
            p = subprocess.run(
                ["pkexec", "sh", "-c", command],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                timeout=timeout
            )
            return p.returncode, p.stdout.strip()
        except Exception as e:
            return 1, str(e)

    def refresh_ssh(self):
        """Refresh local SSH server state."""
        try:
            p = subprocess.run(
                ["systemctl", "is-active", "ssh"],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                timeout=5
            )
            active = p.returncode == 0 and p.stdout.strip() == "active"

            port_rc, port_out = run(
                "ss -ltn 2>/dev/null | grep -E '(:22[[:space:]]|:22$)'",
                timeout=5
            )
            listening = port_rc == 0 and bool(port_out)

            if active and listening:
                self.ssh_status.configure(text="● SSH ENABLED", fg=GREEN)
                self.ssh_detail.configure(
                    text="SSH server is ACTIVE and listening on TCP port 22.",
                    fg=GREEN
                )
            elif active:
                self.ssh_status.configure(text="● SERVICE ACTIVE", fg=YELLOW)
                self.ssh_detail.configure(
                    text="SSH service is active, but port 22 is not currently detected.",
                    fg=YELLOW
                )
            else:
                self.ssh_status.configure(text="● SSH DISABLED", fg=RED)
                self.ssh_detail.configure(
                    text="SSH server is not active.",
                    fg=RED
                )

            host = run("hostname -f", timeout=3)[1] or "unknown"
            user = os.environ.get("USER", "ava-core")

            self.ssh_info.configure(
                text=(
                    f"Host:        {host}\\n"
                    f"User:        {user}\\n"
                    f"SSH port:    22\\n"
                    f"Key:         /home/ava-core/.ssh/ava_desk\\n"
                    f"Public key:  /home/ava-core/.ssh/ava_desk.pub"
                )
            )

        except Exception as e:
            self.ssh_status.configure(text="● ERROR", fg=RED)
            self.ssh_detail.configure(text=f"SSH status error: {e}", fg=RED)

        self.ssh_after_id = self.after(5000, self.refresh_ssh)

    def enable_ssh(self):
        """Enable SSH service and socket."""
        rc, out = self.ssh_command(
            "systemctl enable --now ssh.socket ssh.service"
        )

        if rc != 0:
            messagebox.showerror(
                "SSH Mode",
                "Unable to enable SSH.\\n\\n" + (out or "Unknown error.")
            )
        else:
            messagebox.showinfo(
                "SSH Mode",
                "SSH Mode is now enabled.\\n\\nSSH server is available on port 22."
            )

        self.refresh_ssh()

    def disable_ssh(self):
        """Disable SSH service and socket."""
        answer = messagebox.askyesno(
            "Disable SSH Mode",
            "Disable the SSH server on this Ava Core machine?"
        )

        if not answer:
            return

        rc, out = self.ssh_command(
            "systemctl disable --now ssh.service ssh.socket"
        )

        if rc != 0:
            messagebox.showerror(
                "SSH Mode",
                "Unable to disable SSH.\\n\\n" + (out or "Unknown error.")
            )
        else:
            messagebox.showinfo(
                "SSH Mode",
                "SSH Mode has been disabled."
            )

        self.refresh_ssh()

if __name__=="__main__":
    App().mainloop()

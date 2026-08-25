#!/usr/bin/env python3
"""AVA IVY CLOUDFLARE TUNNEL WATCHDOG.

Owns only the Ava Ivy remotely-managed tunnel token.  The command explicitly
uses an Ava Ivy-only config file so cloudflared cannot inherit an unrelated
~/.cloudflared/config.yml from an older installation.
"""
import logging, os, signal, subprocess, sys, time
from pathlib import Path

BASE = Path("/home/ava-core")
CLOUDFLARE_DIR = BASE / "web" / "cloudflare"
CLOUDFLARED = CLOUDFLARE_DIR / "cloudflared"
AVAIVY_DIR = CLOUDFLARE_DIR / "avaivy.cloud"
TOKEN_FILE = AVAIVY_DIR / "tunnel.token"
TOKEN_RUN_CONFIG = AVAIVY_DIR / "token-run.yml"
LOG_DIR = BASE / "database" / "logs"
LOG_FILE = LOG_DIR / "avaivy-cloudflare.log"
RESTART_DELAY, MAX_DELAY = 5, 60
running, child = True, None

def setup_logging():
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("avaivy_cloudflare")
    logger.setLevel(logging.INFO); logger.handlers.clear()
    fmt = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s", "%Y-%m-%d %H:%M:%S")
    fh = logging.FileHandler(LOG_FILE, encoding="utf-8"); fh.setFormatter(fmt)
    sh = logging.StreamHandler(sys.stdout); sh.setFormatter(fmt)
    logger.addHandler(fh); logger.addHandler(sh)
    return logger
log = setup_logging()

def shutdown(signum, _frame):
    global running
    running = False
    log.info("Shutdown signal received: %s", signum)
    if child is not None and child.poll() is None:
        try: child.terminate()
        except ProcessLookupError: pass

def valid():
    checks = [
        (CLOUDFLARED.is_file(), f"Missing cloudflared: {CLOUDFLARED}"),
        (os.access(CLOUDFLARED, os.X_OK), f"cloudflared is not executable: {CLOUDFLARED}"),
        (TOKEN_FILE.is_file(), f"Missing Ava Ivy tunnel token: {TOKEN_FILE}"),
        (os.access(TOKEN_FILE, os.R_OK), f"Ava Ivy tunnel token is not readable: {TOKEN_FILE}"),
        (TOKEN_RUN_CONFIG.is_file(), f"Missing token-run config: {TOKEN_RUN_CONFIG}"),
    ]
    ok = True
    for passed, message in checks:
        if not passed: log.error(message); ok = False
    return ok

def main():
    global child
    signal.signal(signal.SIGINT, shutdown); signal.signal(signal.SIGTERM, shutdown)
    log.info("=" * 60); log.info("AVA IVY CLOUDFLARE WATCHDOG STARTING")
    log.info("Binary: %s", CLOUDFLARED); log.info("Token: %s", TOKEN_FILE)
    log.info("Config isolation: %s", TOKEN_RUN_CONFIG); log.info("=" * 60)
    delay = RESTART_DELAY
    while running:
        if not valid() or not TOKEN_FILE.read_text(encoding="utf-8").strip():
            if valid(): log.error("Ava Ivy tunnel token is empty: %s", TOKEN_FILE)
            time.sleep(delay); delay = min(delay * 2, MAX_DELAY); continue
        cmd = [str(CLOUDFLARED), "--config", str(TOKEN_RUN_CONFIG), "tunnel", "run", "--token-file", str(TOKEN_FILE)]
        log.info("Starting Ava Ivy tunnel with isolated configuration.")
        try:
            child = subprocess.Popen(cmd, cwd=str(AVAIVY_DIR), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
            delay = RESTART_DELAY
            if child.stdout:
                for line in child.stdout:
                    if not running: break
                    line=line.rstrip()
                    if line: log.info("cloudflared | %s", line)
            if not running and child.poll() is None: child.terminate()
            code=child.wait(); child=None
            if running:
                log.warning("cloudflared exited with code %s. Restarting in %s seconds.", code, delay)
                time.sleep(delay); delay=min(delay*2,MAX_DELAY)
        except Exception as exc:
            log.exception("Watchdog error: %s", exc); child=None
            if running: time.sleep(delay); delay=min(delay*2,MAX_DELAY)
    log.info("AVA IVY CLOUDFLARE WATCHDOG STOPPED")
if __name__ == "__main__": main()

#!/usr/bin/env python3
"""
AVA IVY CLOUDFLARE TUNNEL WATCHDOG

Keeps ONLY the dedicated avaivy-cloud tunnel running.
Config: /home/ava-core/Web/cloudflare/avaivy.cloud/config.yml
Logs:   /home/ava-core/Database/logs/avaivy-cloudflare.log
"""

import logging
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

CLOUDFLARE_DIR = Path("/home/ava-core/Web/cloudflare")
CLOUDFLARED = CLOUDFLARE_DIR / "cloudflared"
CONFIG = CLOUDFLARE_DIR / "avaivy.cloud" / "config.yml"
LOG_DIR = Path("/home/ava-core/Database/logs")
LOG_FILE = LOG_DIR / "avaivy-cloudflare.log"

RESTART_DELAY = 5
MAX_DELAY = 60

running = True
child = None


def setup_logging():
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("avaivy_cloudflare")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    fmt = logging.Formatter(
        "%(asctime)s | %(levelname)s | %(message)s",
        "%Y-%m-%d %H:%M:%S",
    )

    fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
    fh.setFormatter(fmt)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)

    logger.addHandler(fh)
    logger.addHandler(sh)
    return logger


log = setup_logging()


def shutdown(signum, _frame):
    global running
    running = False
    log.info("Shutdown signal received: %s", signum)
    if child is not None and child.poll() is None:
        try:
            child.terminate()
        except ProcessLookupError:
            pass


def valid():
    if not CLOUDFLARED.is_file():
        log.error("Missing cloudflared: %s", CLOUDFLARED)
        return False
    if not os.access(CLOUDFLARED, os.X_OK):
        log.error("cloudflared is not executable: %s", CLOUDFLARED)
        return False
    if not CONFIG.is_file():
        log.error("Missing tunnel config: %s", CONFIG)
        return False
    return True


def main():
    global child

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    log.info("=" * 60)
    log.info("AVA IVY CLOUDFLARE WATCHDOG STARTING")
    log.info("Config: %s", CONFIG)
    log.info("Log: %s", LOG_FILE)
    log.info("=" * 60)

    delay = RESTART_DELAY

    while running:
        if not valid():
            log.error("Validation failed. Retrying in %s seconds.", delay)
            time.sleep(delay)
            delay = min(delay * 2, MAX_DELAY)
            continue

        cmd = [
            str(CLOUDFLARED),
            "--config", str(CONFIG),
            "tunnel", "run",
        ]

        log.info("Starting avaivy-cloud tunnel.")

        try:
            child = subprocess.Popen(
                cmd,
                cwd=str(CLOUDFLARE_DIR),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )

            delay = RESTART_DELAY

            if child.stdout:
                for line in child.stdout:
                    if not running:
                        break
                    line = line.rstrip()
                    if line:
                        log.info("cloudflared | %s", line)

            if not running and child.poll() is None:
                child.terminate()

            code = child.wait()
            child = None

            if running:
                log.warning(
                    "cloudflared exited with code %s. Restarting in %s seconds.",
                    code, delay
                )
                time.sleep(delay)
                delay = min(delay * 2, MAX_DELAY)

        except Exception as exc:
            log.exception("Watchdog error: %s", exc)
            child = None
            if running:
                time.sleep(delay)
                delay = min(delay * 2, MAX_DELAY)

    log.info("AVA IVY CLOUDFLARE WATCHDOG STOPPED")


if __name__ == "__main__":
    main()

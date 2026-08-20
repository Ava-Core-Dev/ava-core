"""System performance cron — CPU, RAM, uptime snapshot."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import psutil

log = logging.getLogger("ava.cron.system_perf")


async def run():
    from apps.core import config

    now = datetime.now(timezone.utc)
    cpu = psutil.cpu_percent(interval=1)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage(str(config.AVA_HOME))
    load = psutil.getloadavg()
    uptime_s = now.timestamp() - psutil.boot_time()

    content = (
        f"# System Performance — {now.strftime('%Y-%m-%dT%H')}\n\n"
        f"CPU: {cpu}%\n"
        f"RAM: {mem.percent}% used ({mem.used // 1024 // 1024}MB / {mem.total // 1024 // 1024}MB)\n"
        f"Disk (ava home): {disk.percent}% used\n"
        f"Load (1/5/15): {load[0]:.2f} / {load[1]:.2f} / {load[2]:.2f}\n"
        f"Uptime: {int(uptime_s // 3600)}h {int((uptime_s % 3600) // 60)}m\n"
    )

    report_path = config.REPORTS_DIR / f"system-performance-{now.strftime('%Y-%m-%dT%H')}.md"
    report_path.write_text(content)
    try:
        from apps.core.crons.solar_weather import record_host_sample
        record_host_sample(force=True)
    except Exception as e:
        log.debug("host sample from system_perf skipped: %s", e)
    log.info("System performance written: %s  cpu=%s%%  ram=%s%%", report_path.name, cpu, mem.percent)

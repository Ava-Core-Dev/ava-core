#!/usr/bin/env python3
"""
aggregate_minutes_to_hours.py

Aggregate minute-level DB into hourly buckets and trim minute rows older than 24 hours.

Default paths:
  Minutes DB: /home/ava-core/database/system-1min.db
  Hours DB:   /home/ava-core/database/system-1hour.db

Behavior:
- Reads minute_* tables and groups minute_ts into hour buckets (floor to hour).
- Aggregates numeric stats (count, mean, median (approx), min, max).
- Merges JSON blobs for extras/smart/misc, uses last-known for non-numeric fields.
- Writes aggregated rows into hour_* tables (creates schema if missing).
- After successful aggregation, deletes minute rows where minute_ts < now - 24*3600.

Usage:
  python3 aggregate_minutes_to_hours.py [--src /path/system-1min.db] [--dst /path/system-1hour.db] [--dry-run] [--verbose]

Note:
- Median at the hour level is approximated by taking the median of minute medians (not exact).
- The script deletes minute rows older than 24 hours AFTER successful aggregation.
"""
from __future__ import annotations
import argparse
import sqlite3
import json
import os
import math
import statistics
import time
import datetime
from collections import defaultdict
from typing import Any, Dict, List, Optional

DEFAULT_MIN_DB = "/home/ava-core/database/system-1min.db"

# ---------- Helpers ----------
def now_epoch() -> float:
    return time.time()

def floor_hour(ts_epoch: float) -> int:
    return int(math.floor(ts_epoch / 3600.0) * 3600)

def safe_load(x):
    if x is None:
        return None
    if isinstance(x, (dict, list)):
        return x
    try:
        return json.loads(x)
    except Exception:
        return None

def stats_from_minute_objs(minute_objs: List[Dict[str, Any]]):
    """
    minute_objs: list of dicts representing per-minute stats with shape like:
      {"count":N, "mean":m, "median":md, "min":mi, "max":ma}
    We'll compute:
      total_count, weighted_mean, median_of_medians, min(mins), max(maxs)
    """
    counts = []
    means = []
    medians = []
    mins = []
    maxs = []
    for o in minute_objs:
        if not isinstance(o, dict):
            continue
        c = o.get("count")
        m = o.get("mean")
        md = o.get("median")
        mi = o.get("min")
        ma = o.get("max")
        if isinstance(c, (int,float)) and isinstance(m, (int,float)):
            counts.append(float(c))
            means.append((float(c), float(m)))  # store (count, mean)
        else:
            # fallback: if mean exists without count, treat as single sample
            if isinstance(m, (int,float)):
                counts.append(1.0)
                means.append((1.0, float(m)))
        if isinstance(md, (int,float)):
            medians.append(float(md))
        if isinstance(mi, (int,float)):
            mins.append(float(mi))
        if isinstance(ma, (int,float)):
            maxs.append(float(ma))
    total_count = int(sum(counts)) if counts else 0
    weighted_mean = None
    if means and total_count > 0:
        weighted_mean = sum(c*m for (c,m) in means) / sum(c for (c,m) in means)
    median_of_medians = statistics.median(medians) if medians else None
    min_val = min(mins) if mins else None
    max_val = max(maxs) if maxs else None
    return {"count": total_count, "mean": weighted_mean, "median": median_of_medians, "min": min_val, "max": max_val}

def merge_json_list(objs: List[Any]):
    """Merge a list of JSON-like objects: if dicts prefer last non-null per key, if lists concat, else return last."""
    if not objs:
        return None
    dicts = [o for o in objs if isinstance(o, dict)]
    lists = [o for o in objs if isinstance(o, list)]
    if dicts:
        out = {}
        for d in dicts:
            out.update(d or {})
        return out
    if lists:
        res = []
        for l in lists:
            res.extend(l)
        return res
    return objs[-1]

# ---------- Destination schema ----------
def ensure_hour_schema(conn: sqlite3.Connection):
    c = conn.cursor()
    c.execute("""
    CREATE TABLE IF NOT EXISTS hour_runs (
        hour_ts INTEGER PRIMARY KEY,
        start_ts TEXT,
        end_ts TEXT,
        minute_count INTEGER,
        hostnames TEXT
    )""")
    c.execute("CREATE TABLE IF NOT EXISTS hour_cpu (hour_ts INTEGER PRIMARY KEY, stats TEXT)")
    c.execute("CREATE TABLE IF NOT EXISTS hour_memory (hour_ts INTEGER PRIMARY KEY, stats TEXT)")
    c.execute("CREATE TABLE IF NOT EXISTS hour_disks (hour_ts INTEGER, device TEXT, mountpoint TEXT, fstype TEXT, stats TEXT, extra TEXT, PRIMARY KEY(hour_ts, device, mountpoint))")
    c.execute("CREATE TABLE IF NOT EXISTS hour_temps (hour_ts INTEGER, sensor_key TEXT, stats TEXT, PRIMARY KEY(hour_ts, sensor_key))")
    c.execute("CREATE TABLE IF NOT EXISTS hour_battery (hour_ts INTEGER PRIMARY KEY, stats TEXT)")
    c.execute("CREATE TABLE IF NOT EXISTS hour_network (hour_ts INTEGER, iface TEXT, stats TEXT, PRIMARY KEY(hour_ts, iface))")
    c.execute("CREATE TABLE IF NOT EXISTS hour_processes (hour_ts INTEGER, pid INTEGER, name TEXT, exe TEXT, cmdline TEXT, stats TEXT, PRIMARY KEY(hour_ts, pid, name))")
    c.execute("CREATE TABLE IF NOT EXISTS hour_smart (hour_ts INTEGER, device TEXT, kname TEXT, info TEXT, PRIMARY KEY(hour_ts, device))")
    c.execute("CREATE TABLE IF NOT EXISTS hour_misc (hour_ts INTEGER, key TEXT, value TEXT, PRIMARY KEY(hour_ts, key))")
    conn.commit()

# ---------- Load minutes ----------
def load_minute_rows(conn: sqlite3.Connection):
    """Return minute_ts list and dictionaries mapping minute_ts -> rows for each minute table."""
    cur = conn.cursor()
    # get all minute_ts from minute_runs
    minute_rows = {}
    try:
        cur.execute("SELECT minute_ts, start_ts, end_ts, run_count, hostnames FROM minute_runs")
        for row in cur.fetchall():
            mt = int(row[0])
            minute_rows[mt] = {"start_ts": row[1], "end_ts": row[2], "run_count": row[3], "hostnames": safe_load(row[4])}
    except Exception:
        # no minute_runs table
        minute_rows = {}

    tables = ["minute_cpu","minute_memory","minute_disks","minute_temps","minute_battery","minute_network","minute_processes","minute_smart","minute_misc"]
    data = {t: defaultdict(list) for t in tables}
    for t in tables:
        try:
            cur.execute(f"SELECT * FROM {t}")
            cols = [d[0] for d in cur.description]
            for r in cur.fetchall():
                row = dict(zip(cols, r))
                ts = row.get("minute_ts")
                if ts is None:
                    continue
                data[t][int(ts)].append(row)
        except Exception:
            # table missing or incompatible; keep empty
            data[t] = defaultdict(list)
    return minute_rows, data

# ---------- Aggregate into hours ----------
def aggregate_minutes_to_hours(minute_rows: Dict[int, Dict], data: Dict[str, Dict[int, List[Dict]]], verbose: bool=False):
    # Build set of minute_ts we have data for
    minute_ts_list = sorted(set(list(minute_rows.keys()) + list(data.get("minute_cpu", {}).keys())))
    if not minute_ts_list:
        return {}

    # Group minutes into hours
    hour_buckets = defaultdict(list)  # hour_ts -> list of minute_ts
    for m in minute_ts_list:
        hour_buckets[floor_hour(m)].append(m)

    aggregates = {}  # hour_ts -> dict of aggregated rows per table
    for hour_ts, minutes in sorted(hour_buckets.items()):
        agg = {}
        minutes_sorted = sorted(minutes)
        start_iso = minute_rows.get(minutes_sorted[0], {}).get("start_ts")
        end_iso = minute_rows.get(minutes_sorted[-1], {}).get("end_ts")
        # minute_count and hostnames
        hostnames = []
        for m in minutes_sorted:
            hn = minute_rows.get(m, {}).get("hostnames")
            if hn:
                if isinstance(hn, list):
                    hostnames.extend(hn)
                else:
                    try:
                        hostnames.extend(list(hn))
                    except Exception:
                        pass
        agg["hour_runs"] = (hour_ts, start_iso, end_iso, len(minutes_sorted), json.dumps(sorted(list(set(hostnames)))))

        # CPU: collect minute_cpu.stats (JSON)
        cpu_min_objs = []
        per_core_lists = []
        for m in minutes_sorted:
            rows = data.get("minute_cpu", {}).get(m, [])
            for r in rows:
                s = safe_load(r.get("stats"))
                if isinstance(s, dict):
                    p = s.get("percent")
                    if isinstance(p, dict):
                        cpu_min_objs.append(p)
                    if s.get("per_core"):
                        per_core_lists.append(s.get("per_core"))
        cpu_agg = stats_from_minute_objs(cpu_min_objs)
        # per_core: minute stored per_core as list of stats dicts; we compute elementwise weighted mean across minute counts
        per_core_agg = None
        if per_core_lists:
            # convert minute per_core lists to per-core aggregated stats: for each core index, collect stats dicts across minutes
            min_len = min(len(l) for l in per_core_lists)
            per_core_agg = []
            for i in range(min_len):
                objs = []
                for pl in per_core_lists:
                    if len(pl) > i:
                        objs.append(pl[i])
                per_core_agg.append(stats_from_minute_objs(objs))
            cpu_agg["per_core"] = per_core_agg
        agg["hour_cpu"] = (hour_ts, json.dumps(cpu_agg))

        # MEMORY
        mem_objs = []
        for m in minutes_sorted:
            for r in data.get("minute_memory", {}).get(m, []):
                mem = safe_load(r.get("stats"))
                if isinstance(mem, dict):
                    # we have fields: used, percent, swap_used: each is stats dict
                    used = mem.get("used")
                    pct = mem.get("percent")
                    swap = mem.get("swap_used")
                    if isinstance(used, dict): mem_objs.append(used)
                    if isinstance(pct, dict): mem_objs.append(pct)
                    if isinstance(swap, dict): mem_objs.append(swap)
        # aggregate separately for used/percent/swap using their minute-level stats
        # The simple approach is to collect minute-level stats objects per metric
        used_list = []
        percent_list = []
        swap_list = []
        for m in minutes_sorted:
            for r in data.get("minute_memory", {}).get(m, []):
                s = safe_load(r.get("stats"))
                if not isinstance(s, dict):
                    continue
                if isinstance(s.get("used"), dict):
                    used_list.append(s.get("used"))
                if isinstance(s.get("percent"), dict):
                    percent_list.append(s.get("percent"))
                if isinstance(s.get("swap_used"), dict):
                    swap_list.append(s.get("swap_used"))
        mem_agg = {"used": stats_from_minute_objs(used_list), "percent": stats_from_minute_objs(percent_list), "swap_used": stats_from_minute_objs(swap_list)}
        agg["hour_memory"] = (hour_ts, json.dumps(mem_agg))

        # DISKS: group by (device, mountpoint, fstype)
        disk_map = defaultdict(list)
        for m in minutes_sorted:
            for r in data.get("minute_disks", {}).get(m, []):
                device = r.get("device"); mount = r.get("mountpoint"); fstype = r.get("fstype")
                stats = safe_load(r.get("stats"))
                extra = safe_load(r.get("extra"))
                disk_map[(device, mount, fstype)].append({"stats": stats, "extra": extra})
        hour_disks = []
        for (device, mount, fstype), items in disk_map.items():
            stats_objs = [it["stats"] for it in items if isinstance(it.get("stats"), dict)]
            merged_extra = merge_json_list([it["extra"] for it in items if it.get("extra") is not None])
            stats_agg = {}
            # stats_objs likely have keys used/percent/total each being stats dicts
            if stats_objs:
                # collect used stats objects
                used_objs = [so.get("used") for so in stats_objs if isinstance(so.get("used"), dict)]
                pct_objs = [so.get("percent") for so in stats_objs if isinstance(so.get("percent"), dict)]
                total_objs = [so.get("total") for so in stats_objs if isinstance(so.get("total"), dict)]
                stats_agg = {"used": stats_from_minute_objs(used_objs), "percent": stats_from_minute_objs(pct_objs), "total": stats_from_minute_objs(total_objs)}
            hour_disks.append((hour_ts, device, mount, fstype, json.dumps(stats_agg), json.dumps(merged_extra)))
        agg["hour_disks"] = hour_disks

        # TEMPS: minute_temps rows have stats mapping labels->stats
        temps_by_sensor = defaultdict(lambda: defaultdict(list))  # sensor -> label -> list of stats objs
        for m in minutes_sorted:
            for r in data.get("minute_temps", {}).get(m, []):
                sensor = r.get("sensor_key")
                s = safe_load(r.get("stats")) or {}
                if isinstance(s, dict):
                    for label, st in s.items():
                        if isinstance(st, dict):
                            temps_by_sensor[sensor][label].append(st)
        hour_temps = []
        for sensor, labels in temps_by_sensor.items():
            label_stats = {label: stats_from_minute_objs(objs) for label, objs in labels.items()}
            hour_temps.append((hour_ts, sensor, json.dumps(label_stats)))
        agg["hour_temps"] = hour_temps

        # BATTERY
        bat_objs = []
        for m in minutes_sorted:
            for r in data.get("minute_battery", {}).get(m, []):
                s = safe_load(r.get("stats"))
                if isinstance(s, dict) and isinstance(s.get("percent"), dict):
                    bat_objs.append(s.get("percent"))
        bat_agg = {"percent": stats_from_minute_objs(bat_objs)}
        agg["hour_battery"] = (hour_ts, json.dumps(bat_agg))

        # NETWORK: minute_network.stats may have bytes_sent_per_sec etc OR "last"
        net_by_iface = defaultdict(list)
        for m in minutes_sorted:
            for r in data.get("minute_network", {}).get(m, []):
                iface = r.get("iface")
                s = safe_load(r.get("stats")) or {}
                net_by_iface[iface].append(s)
        hour_network = []
        for iface, samples in net_by_iface.items():
            # prefer numeric rate fields (bytes_sent_per_sec etc) and aggregate their means
            rates = {}
            for key in ("bytes_sent_per_sec","bytes_recv_per_sec","packets_sent_per_sec","packets_recv_per_sec"):
                vals = [s.get(key) for s in samples if isinstance(s.get(key), (int,float))]
                rates[key] = stats_from_minute_objs([{"count": len(vals), "mean": statistics.mean(vals) if vals else None, "median": statistics.median(vals) if vals else None, "min": min(vals) if vals else None, "max": max(vals) if vals else None}]) if vals else {"count":0,"mean":None,"median":None,"min":None,"max":None}
            # if samples have "last" counters, store last-known merged
            last_candidates = [s.get("last") for s in samples if isinstance(s.get("last"), dict)]
            merged_last = merge_json_list(last_candidates) if last_candidates else None
            rates["last"] = merged_last
            hour_network.append((hour_ts, iface, json.dumps(rates)))
        agg["hour_network"] = hour_network

        # PROCESSES: aggregate by pid+name across minute rows
        proc_map = {}
        for m in minutes_sorted:
            for r in data.get("minute_processes", {}).get(m, []):
                pid = r.get("pid"); name = r.get("name") or ""
                key = (pid, name)
                stats = safe_load(r.get("stats")) or {}
                # stats likely include avg_cpu, avg_mem, samples OR cpu_stats/mem_stats as stats objects
                ent = proc_map.setdefault(key, {"pid": pid, "name": name, "exe": r.get("exe"), "cmdline": r.get("cmdline"), "cpu_objs": [], "mem_objs": [], "samples": 0})
                # If stats contain avg and samples, convert to stats-like obj
                if isinstance(stats, dict):
                    samples = stats.get("samples") or 0
                    avg_cpu = stats.get("avg_cpu")
                    avg_mem = stats.get("avg_mem")
                    if isinstance(avg_cpu, (int,float)):
                        ent["cpu_objs"].append({"count": samples or 1, "mean": avg_cpu, "median": stats.get("cpu_stats", {}).get("median") if stats.get("cpu_stats") else None, "min": stats.get("cpu_stats", {}).get("min") if stats.get("cpu_stats") else None, "max": stats.get("cpu_stats", {}).get("max") if stats.get("cpu_stats") else None})
                    if isinstance(avg_mem, (int,float)):
                        ent["mem_objs"].append({"count": samples or 1, "mean": avg_mem, "median": stats.get("mem_stats", {}).get("median") if stats.get("mem_stats") else None, "min": stats.get("mem_stats", {}).get("min") if stats.get("mem_stats") else None, "max": stats.get("mem_stats", {}).get("max") if stats.get("mem_stats") else None})
                    ent["samples"] += samples or 0
        hour_procs = []
        for (pid, name), v in proc_map.items():
            cpu_agg = stats_from_minute_objs(v["cpu_objs"]) if v["cpu_objs"] else {"count":0,"mean":None,"median":None,"min":None,"max":None}
            mem_agg = stats_from_minute_objs(v["mem_objs"]) if v["mem_objs"] else {"count":0,"mean":None,"median":None,"min":None,"max":None}
            combined = {"cpu": cpu_agg, "mem": mem_agg, "samples": v["samples"]}
            hour_procs.append((hour_ts, pid, name, v.get("exe"), v.get("cmdline"), json.dumps(combined)))
        agg["hour_processes"] = hour_procs

        # SMART: keep merged/last
        smart_map = defaultdict(list)
        for m in minutes_sorted:
            for r in data.get("minute_smart", {}).get(m, []):
                dev = r.get("device"); kname = r.get("kname")
                info = safe_load(r.get("info"))
                smart_map[(dev,kname)].append(info)
        hour_smart = []
        for (dev,kname), infos in smart_map.items():
            merged = merge_json_list([i for i in infos if i is not None])
            hour_smart.append((hour_ts, dev, kname, json.dumps(merged)))
        agg["hour_smart"] = hour_smart

        # MISC: merge values by key
        misc_map = defaultdict(list)
        for m in minutes_sorted:
            for r in data.get("minute_misc", {}).get(m, []):
                key = r.get("key")
                val = safe_load(r.get("value"))
                misc_map[key].append(val)
        hour_misc = []
        for k, vals in misc_map.items():
            hour_misc.append((hour_ts, k, json.dumps(merge_json_list(vals))))
        agg["hour_misc"] = hour_misc

        aggregates[hour_ts] = agg
    return aggregates

# ---------- Write to hour DB ----------
def write_hour_aggregates(dst_conn: sqlite3.Connection, aggregates: Dict[int, Dict], verbose: bool=False):
    c = dst_conn.cursor()
    for hour_ts, agg in aggregates.items():
        # hour_runs
        c.execute("INSERT OR REPLACE INTO hour_runs (hour_ts, start_ts, end_ts, minute_count, hostnames) VALUES (?, ?, ?, ?, ?)",
                  agg["hour_runs"])
        # hour_cpu
        c.execute("INSERT OR REPLACE INTO hour_cpu (hour_ts, stats) VALUES (?, ?)", agg["hour_cpu"])
        # hour_memory
        c.execute("INSERT OR REPLACE INTO hour_memory (hour_ts, stats) VALUES (?, ?)", agg["hour_memory"])
        # hour_disks
        for row in agg.get("hour_disks", []):
            c.execute("INSERT OR REPLACE INTO hour_disks (hour_ts, device, mountpoint, fstype, stats, extra) VALUES (?, ?, ?, ?, ?, ?)", row)
        # hour_temps
        for row in agg.get("hour_temps", []):
            c.execute("INSERT OR REPLACE INTO hour_temps (hour_ts, sensor_key, stats) VALUES (?, ?, ?)", row)
        # hour_battery
        c.execute("INSERT OR REPLACE INTO hour_battery (hour_ts, stats) VALUES (?, ?)", agg["hour_battery"])
        # hour_network
        for row in agg.get("hour_network", []):
            c.execute("INSERT OR REPLACE INTO hour_network (hour_ts, iface, stats) VALUES (?, ?, ?)", row)
        # hour_processes
        for row in agg.get("hour_processes", []):
            c.execute("INSERT OR REPLACE INTO hour_processes (hour_ts, pid, name, exe, cmdline, stats) VALUES (?, ?, ?, ?, ?, ?)", row)
        # hour_smart
        for row in agg.get("hour_smart", []):
            c.execute("INSERT OR REPLACE INTO hour_smart (hour_ts, device, kname, info) VALUES (?, ?, ?, ?)", row)
        # hour_misc
        for row in agg.get("hour_misc", []):
            c.execute("INSERT OR REPLACE INTO hour_misc (hour_ts, key, value) VALUES (?, ?, ?, ?)"[:0])  # placeholder to avoid style issues
            # correct execute below:
        for row in agg.get("hour_misc", []):
            c.execute("INSERT OR REPLACE INTO hour_misc (hour_ts, key, value) VALUES (?, ?, ?)", row)
    dst_conn.commit()

# ---------- Delete old minutes ----------
def delete_old_minutes(min_conn: sqlite3.Connection, retention_seconds: int = 24*3600, verbose: bool=False):
    cutoff = int(now_epoch() - retention_seconds)
    c = min_conn.cursor()
    tables = ["minute_runs","minute_cpu","minute_memory","minute_disks","minute_temps","minute_battery","minute_network","minute_processes","minute_smart","minute_misc"]
    for t in tables:
        try:
            c.execute(f"DELETE FROM {t} WHERE minute_ts < ?", (cutoff,))
            if verbose:
                print(f"Deleted from {t} rows with minute_ts < {cutoff}")
        except Exception:
            # table may not exist
            continue
    min_conn.commit()

# ---------- Main ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_MIN_DB, help="Minute DB path (default: %(default)s)")
    ap.add_argument("--dst", help="Hour DB path (default: same folder system-1hour.db)")
    ap.add_argument("--dry-run", action="store_true", help="Do not write hour DB or delete minutes; just report")
    ap.add_argument("--verbose", action="store_true", help="Verbose output")
    args = ap.parse_args()

    src = os.path.expanduser(args.src)
    if not os.path.exists(src):
        print("Minute DB not found:", src)
        return
    dst = args.dst or os.path.join(os.path.dirname(src), "system-1hour.db")
    if args.verbose:
        print("Minutes DB:", src)
        print("Hours DB:", dst)

    min_conn = sqlite3.connect(src)
    min_conn.row_factory = sqlite3.Row

    minute_rows, data = load_minute_rows(min_conn)
    if not minute_rows and all(not v for v in data.values()):
        print("No minute data found; nothing to do.")
        min_conn.close()
        return

    aggregates = aggregate_minutes_to_hours(minute_rows, data, verbose=args.verbose)
    if not aggregates:
        print("No aggregates produced.")
        min_conn.close()
        return

    if args.dry_run:
        print("Dry run: would produce", len(aggregates), "hour buckets. Exiting without write/delete.")
        min_conn.close()
        return

    # write to hour DB
    ensure_dir = lambda p: os.makedirs(os.path.dirname(p), exist_ok=True) if os.path.dirname(p) else None
    ensure_dir(dst)
    dst_conn = sqlite3.connect(dst)
    try:
        ensure_hour_schema(dst_conn)
        write_hour_aggregates(dst_conn, aggregates, verbose=args.verbose)
        if args.verbose:
            print("Wrote aggregates to", dst)
    finally:
        dst_conn.close()

    # delete minute rows older than 24 hours
    delete_old_minutes(min_conn, retention_seconds=24*3600, verbose=args.verbose)
    min_conn.close()
    print("Aggregation to hours completed; old minute rows older than 24h deleted.")

if __name__ == "__main__":
    main()
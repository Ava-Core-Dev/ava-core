#!/usr/bin/env python3
"""
aggregate_minutes_to_hours_atomic.py

Atomically aggregate minute DB into hourly DB:

- Moves minute DB -> minute.db.INPROGRESS.<ts>
- Creates fresh minute DB at original path (so writer can continue)
- Aggregates data from INPROGRESS into hour DB
- Copies minute rows newer than 24 hours from INPROGRESS into fresh minute DB (preserve recent 24h)
- Deletes INPROGRESS file

Usage:
  python3 aggregate_minutes_to_hours_atomic.py [--src /path/system-1min.db] [--dst /path/system-1hour.db] [--dry-run] [--verbose]

Notes:
- Uses a non-blocking file lock at /tmp/agg-hours.lock to avoid concurrent runs.
- Dry-run will not rename or write files; it will report what would be done.
"""
from __future__ import annotations
import argparse
import sqlite3
import json
import os
import time
import datetime
import shutil
import fcntl
from collections import defaultdict
from typing import Any, Dict, List, Optional

DEFAULT_MIN_DB = "/home/ava-core/Database/system/system-1min.db"
DEFAULT_HOUR_DB = None  # computed relative to minute DB

LOCK_PATH = "/tmp/agg-hours.lock"
RETENTION_SECONDS = 24 * 3600

# --- Helpers ---
def now_epoch() -> int:
    return int(time.time())

def floor_hour(ts_epoch: int) -> int:
    return int((ts_epoch // 3600) * 3600)

def safe_load(x):
    if x is None:
        return None
    if isinstance(x, (dict, list)):
        return x
    try:
        return json.loads(x)
    except Exception:
        return None

def merge_json_list(objs: List[Any]):
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

# --- Minute DB schema creator (fresh) ---
def create_minute_schema(conn: sqlite3.Connection):
    c = conn.cursor()
    c.execute("""
    CREATE TABLE IF NOT EXISTS minute_runs (
        minute_ts INTEGER PRIMARY KEY,
        start_ts TEXT,
        end_ts TEXT,
        run_count INTEGER,
        hostnames TEXT
    )""")
    c.execute("CREATE TABLE IF NOT EXISTS minute_cpu (minute_ts INTEGER PRIMARY KEY, stats TEXT)")
    c.execute("CREATE TABLE IF NOT EXISTS minute_memory (minute_ts INTEGER PRIMARY KEY, stats TEXT)")
    c.execute("CREATE TABLE IF NOT EXISTS minute_disks (minute_ts INTEGER, device TEXT, mountpoint TEXT, fstype TEXT, stats TEXT, extra TEXT, PRIMARY KEY(minute_ts, device, mountpoint))")
    c.execute("CREATE TABLE IF NOT EXISTS minute_temps (minute_ts INTEGER, sensor_key TEXT, stats TEXT, PRIMARY KEY(minute_ts, sensor_key))")
    c.execute("CREATE TABLE IF NOT EXISTS minute_battery (minute_ts INTEGER PRIMARY KEY, stats TEXT)")
    c.execute("CREATE TABLE IF NOT EXISTS minute_network (minute_ts INTEGER, iface TEXT, stats TEXT, PRIMARY KEY(minute_ts, iface))")
    c.execute("CREATE TABLE IF NOT EXISTS minute_processes (minute_ts INTEGER, pid INTEGER, name TEXT, exe TEXT, cmdline TEXT, stats TEXT, PRIMARY KEY(minute_ts, pid, name))")
    c.execute("CREATE TABLE IF NOT EXISTS minute_smart (minute_ts INTEGER, device TEXT, kname TEXT, info TEXT, PRIMARY KEY(minute_ts, device))")
    c.execute("CREATE TABLE IF NOT EXISTS minute_misc (minute_ts INTEGER, key TEXT, value TEXT, PRIMARY KEY(minute_ts, key))")
    conn.commit()

# --- Hour DB schema creator ---
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

# --- Load minute tables from a minute DB connection ---
def load_minute_rows(min_conn: sqlite3.Connection):
    cur = min_conn.cursor()
    minute_rows = {}
    try:
        cur.execute("SELECT minute_ts, start_ts, end_ts, run_count, hostnames FROM minute_runs")
        for row in cur.fetchall():
            mt = int(row[0])
            minute_rows[mt] = {"start_ts": row[1], "end_ts": row[2], "run_count": row[3], "hostnames": safe_load(row[4])}
    except Exception:
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
            data[t] = defaultdict(list)
    return minute_rows, data

# --- Aggregation logic (reuse approach from prior script) ---
def stats_from_minute_objs(minute_objs: List[Dict[str, Any]]):
    counts = []
    means = []
    medians = []
    mins = []
    maxs = []
    import statistics as _st
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
            means.append((float(c), float(m)))
        else:
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
    median_of_medians = _st.median(medians) if medians else None
    min_val = min(mins) if mins else None
    max_val = max(maxs) if maxs else None
    return {"count": total_count, "mean": weighted_mean, "median": median_of_medians, "min": min_val, "max": max_val}

def aggregate_minutes_to_hours(minute_rows: Dict[int, Dict], data: Dict[str, Dict[int, List[Dict]]], verbose: bool=False):
    minute_ts_list = sorted(set(list(minute_rows.keys()) + list(data.get("minute_cpu", {}).keys())))
    if not minute_ts_list:
        return {}
    hour_buckets = defaultdict(list)
    for m in minute_ts_list:
        hour_buckets[floor_hour(m)].append(m)
    aggregates = {}
    for hour_ts, minutes in sorted(hour_buckets.items()):
        agg = {}
        minutes_sorted = sorted(minutes)
        start_iso = minute_rows.get(minutes_sorted[0], {}).get("start_ts")
        end_iso = minute_rows.get(minutes_sorted[-1], {}).get("end_ts")
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
        # CPU
        cpu_min_objs = []
        per_core_lists = []
        for m in minutes_sorted:
            for r in data.get("minute_cpu", {}).get(m, []):
                s = safe_load(r.get("stats"))
                if isinstance(s, dict):
                    p = s.get("percent")
                    if isinstance(p, dict):
                        cpu_min_objs.append(p)
                    if s.get("per_core"):
                        per_core_lists.append(s.get("per_core"))
        cpu_agg = stats_from_minute_objs(cpu_min_objs)
        per_core_agg = None
        if per_core_lists:
            min_len = min(len(l) for l in per_core_lists)
            per_core_agg = []
            for i in range(min_len):
                objs = [pl[i] for pl in per_core_lists if len(pl) > i and isinstance(pl[i], dict)]
                per_core_agg.append(stats_from_minute_objs(objs))
            cpu_agg["per_core"] = per_core_agg
        agg["hour_cpu"] = (hour_ts, json.dumps(cpu_agg))
        # MEMORY
        used_list = []; percent_list = []; swap_list = []
        for m in minutes_sorted:
            for r in data.get("minute_memory", {}).get(m, []):
                s = safe_load(r.get("stats")) or {}
                if isinstance(s.get("used"), dict): used_list.append(s.get("used"))
                if isinstance(s.get("percent"), dict): percent_list.append(s.get("percent"))
                if isinstance(s.get("swap_used"), dict): swap_list.append(s.get("swap_used"))
        mem_agg = {"used": stats_from_minute_objs(used_list), "percent": stats_from_minute_objs(percent_list), "swap_used": stats_from_minute_objs(swap_list)}
        agg["hour_memory"] = (hour_ts, json.dumps(mem_agg))
        # DISKS
        disk_map = defaultdict(list)
        for m in minutes_sorted:
            for r in data.get("minute_disks", {}).get(m, []):
                key = (r.get("device"), r.get("mountpoint"), r.get("fstype"))
                disk_map[key].append({"stats": safe_load(r.get("stats")), "extra": safe_load(r.get("extra"))})
        hour_disks = []
        for (device, mount, fstype), items in disk_map.items():
            stats_objs = [it["stats"] for it in items if isinstance(it.get("stats"), dict)]
            merged_extra = merge_json_list([it["extra"] for it in items if it.get("extra") is not None])
            stats_agg = {}
            if stats_objs:
                used_objs = [so.get("used") for so in stats_objs if isinstance(so.get("used"), dict)]
                pct_objs = [so.get("percent") for so in stats_objs if isinstance(so.get("percent"), dict)]
                total_objs = [so.get("total") for so in stats_objs if isinstance(so.get("total"), dict)]
                stats_agg = {"used": stats_from_minute_objs(used_objs), "percent": stats_from_minute_objs(pct_objs), "total": stats_from_minute_objs(total_objs)}
            hour_disks.append((hour_ts, device, mount, fstype, json.dumps(stats_agg), json.dumps(merged_extra)))
        agg["hour_disks"] = hour_disks
        # TEMPS
        temps_by_sensor = defaultdict(lambda: defaultdict(list))
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
        # NETWORK
        net_by_iface = defaultdict(list)
        for m in minutes_sorted:
            for r in data.get("minute_network", {}).get(m, []):
                iface = r.get("iface")
                s = safe_load(r.get("stats")) or {}
                net_by_iface[iface].append(s)
        hour_network = []
        for iface, samples in net_by_iface.items():
            rates = {}
            for key in ("bytes_sent_per_sec","bytes_recv_per_sec","packets_sent_per_sec","packets_recv_per_sec"):
                vals = [s.get(key) for s in samples if isinstance(s.get(key), (int,float))]
                if vals:
                    import statistics as _st
                    rates[key] = {"count": len(vals), "mean": float(_st.mean(vals)), "median": float(_st.median(vals)), "min": float(min(vals)), "max": float(max(vals))}
                else:
                    rates[key] = {"count":0,"mean":None,"median":None,"min":None,"max":None}
            last_candidates = [s.get("last") for s in samples if isinstance(s.get("last"), dict)]
            merged_last = merge_json_list(last_candidates) if last_candidates else None
            rates["last"] = merged_last
            hour_network.append((hour_ts, iface, json.dumps(rates)))
        agg["hour_network"] = hour_network
        # PROCESSES
        proc_map = {}
        for m in minutes_sorted:
            for r in data.get("minute_processes", {}).get(m, []):
                pid = r.get("pid"); name = r.get("name") or ""
                key = (pid, name)
                stats = safe_load(r.get("stats")) or {}
                ent = proc_map.setdefault(key, {"pid": pid, "name": name, "exe": r.get("exe"), "cmdline": r.get("cmdline"), "cpu_objs": [], "mem_objs": [], "samples": 0})
                samples = stats.get("samples") or 0
                avg_cpu = stats.get("avg_cpu")
                avg_mem = stats.get("avg_mem")
                if isinstance(avg_cpu, (int,float)): ent["cpu_objs"].append({"count": samples or 1, "mean": avg_cpu})
                if isinstance(avg_mem, (int,float)): ent["mem_objs"].append({"count": samples or 1, "mean": avg_mem})
                ent["samples"] += samples or 0
        hour_procs = []
        for (pid,name), v in proc_map.items():
            cpu_agg = stats_from_minute_objs(v["cpu_objs"]) if v["cpu_objs"] else {"count":0,"mean":None,"median":None,"min":None,"max":None}
            mem_agg = stats_from_minute_objs(v["mem_objs"]) if v["mem_objs"] else {"count":0,"mean":None,"median":None,"min":None,"max":None}
            combined = {"cpu": cpu_agg, "mem": mem_agg, "samples": v["samples"]}
            hour_procs.append((hour_ts, pid, name, v.get("exe"), v.get("cmdline"), json.dumps(combined)))
        agg["hour_processes"] = hour_procs
        # SMART
        smart_map = defaultdict(list)
        for m in minutes_sorted:
            for r in data.get("minute_smart", {}).get(m, []):
                dev = r.get("device"); kname = r.get("kname"); info = safe_load(r.get("info"))
                smart_map[(dev,kname)].append(info)
        hour_smart = []
        for (dev,kname), infos in smart_map.items():
            merged = merge_json_list([i for i in infos if i is not None])
            hour_smart.append((hour_ts, dev, kname, json.dumps(merged)))
        agg["hour_smart"] = hour_smart
        # MISC
        misc_map = defaultdict(list)
        for m in minutes_sorted:
            for r in data.get("minute_misc", {}).get(m, []):
                key = r.get("key"); val = safe_load(r.get("value"))
                misc_map[key].append(val)
        hour_misc = []
        for k, vals in misc_map.items():
            hour_misc.append((hour_ts, k, json.dumps(merge_json_list(vals))))
        agg["hour_misc"] = hour_misc
        aggregates[hour_ts] = agg
    return aggregates

def write_hour_aggregates(dst_conn: sqlite3.Connection, aggregates: Dict[int, Dict], verbose: bool=False):
    c = dst_conn.cursor()
    for hour_ts, agg in aggregates.items():
        c.execute("INSERT OR REPLACE INTO hour_runs (hour_ts, start_ts, end_ts, minute_count, hostnames) VALUES (?, ?, ?, ?, ?)", agg["hour_runs"])
        c.execute("INSERT OR REPLACE INTO hour_cpu (hour_ts, stats) VALUES (?, ?)", agg["hour_cpu"])
        c.execute("INSERT OR REPLACE INTO hour_memory (hour_ts, stats) VALUES (?, ?)", agg["hour_memory"])
        for row in agg.get("hour_disks", []):
            c.execute("INSERT OR REPLACE INTO hour_disks (hour_ts, device, mountpoint, fstype, stats, extra) VALUES (?, ?, ?, ?, ?, ?)", row)
        for row in agg.get("hour_temps", []):
            c.execute("INSERT OR REPLACE INTO hour_temps (hour_ts, sensor_key, stats) VALUES (?, ?, ?)", row)
        c.execute("INSERT OR REPLACE INTO hour_battery (hour_ts, stats) VALUES (?, ?)", agg["hour_battery"])
        for row in agg.get("hour_network", []):
            c.execute("INSERT OR REPLACE INTO hour_network (hour_ts, iface, stats) VALUES (?, ?, ?)", row)
        for row in agg.get("hour_processes", []):
            c.execute("INSERT OR REPLACE INTO hour_processes (hour_ts, pid, name, exe, cmdline, stats) VALUES (?, ?, ?, ?, ?, ?)", row)
        for row in agg.get("hour_smart", []):
            c.execute("INSERT OR REPLACE INTO hour_smart (hour_ts, device, kname, info) VALUES (?, ?, ?, ?)", row)
        for row in agg.get("hour_misc", []):
            c.execute("INSERT OR REPLACE INTO hour_misc (hour_ts, key, value) VALUES (?, ?, ?)", row)
    dst_conn.commit()

# --- Copy recent minute rows from INPROGRESS into new minute DB ---
def copy_recent_minutes(old_conn: sqlite3.Connection, new_conn: sqlite3.Connection, cutoff_ts: int, verbose: bool=False):
    tables = ["minute_runs","minute_cpu","minute_memory","minute_disks","minute_temps","minute_battery","minute_network","minute_processes","minute_smart","minute_misc"]
    old_cur = old_conn.cursor()
    new_cur = new_conn.cursor()
    copied_counts = {}
    for t in tables:
        try:
            old_cur.execute(f"SELECT * FROM {t} WHERE minute_ts >= ?", (cutoff_ts,))
            rows = old_cur.fetchall()
            if not rows:
                copied_counts[t] = 0
                continue
            cols = [d[0] for d in old_cur.description]
            placeholders = ",".join("?" for _ in cols)
            insert_q = f"INSERT OR REPLACE INTO {t} ({','.join(cols)}) VALUES ({placeholders})"
            new_cur.executemany(insert_q, rows)
            copied_counts[t] = len(rows)
            if verbose:
                print(f"Copied {len(rows)} rows into {t}")
        except Exception:
            copied_counts[t] = 0
            continue
    new_conn.commit()
    return copied_counts

# --- File lock ---
class FileLock:
    def __init__(self, path):
        self.path = path
        self.f = None
    def acquire(self):
        self.f = open(self.path, "w")
        try:
            fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except IOError:
            self.f.close()
            self.f = None
            return False
    def release(self):
        if self.f:
            try:
                fcntl.flock(self.f, fcntl.LOCK_UN)
            except Exception:
                pass
            try:
                self.f.close()
            except Exception:
                pass
            self.f = None

# --- Main flow ---
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_MIN_DB, help="Minute DB path")
    ap.add_argument("--dst", help="Hour DB path (default: same folder system-1hour.db)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    src = os.path.expanduser(args.src)
    dst = args.dst or os.path.join(os.path.dirname(src), "system-1hour.db")
    if args.verbose:
        print("Minute DB:", src)
        print("Hour DB:", dst)
        print("Dry run:", args.dry_run)

    if args.dry_run:
        # Just load and report minutes -> hours counts
        if not os.path.exists(src):
            print("Minute DB not found (dry-run):", src)
            return
        conn = sqlite3.connect(src)
        conn.row_factory = sqlite3.Row
        minute_rows, data = load_minute_rows(conn)
        aggregates = aggregate_minutes_to_hours(minute_rows, data, verbose=args.verbose)
        print("Dry-run would produce", len(aggregates), "hour buckets")
        conn.close()
        return

    # Acquire lock
    lock = FileLock(LOCK_PATH)
    if not lock.acquire():
        print("Failed to acquire lock; another run may be active. Exiting.")
        return
    try:
        if not os.path.exists(src):
            print("Minute DB not found:", src)
            return

        ts = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        tmp = f"{src}.INPROGRESS.{ts}.{os.getpid()}"
        # Atomically move the minute DB to INPROGRESS
        try:
            os.rename(src, tmp)
            if args.verbose:
                print(f"Renamed {src} -> {tmp}")
        except Exception as e:
            print("Failed to rename minute DB:", e)
            return

        # Create fresh minute DB at src
        try:
            new_min_conn = sqlite3.connect(src)
            create_minute_schema(new_min_conn)
            new_min_conn.close()
            if args.verbose:
                print("Created fresh minute DB at", src)
        except Exception as e:
            # Attempt to move tmp back to src (best effort)
            try:
                os.rename(tmp, src)
                print("Restored original minute DB after failure creating fresh DB")
            except Exception:
                print("Failed to restore original minute DB; manual intervention required. Error:", e)
            return

        # Open the INPROGRESS minute DB for reading
        old_min_conn = sqlite3.connect(tmp)
        old_min_conn.row_factory = sqlite3.Row

        # load minute data from INPROGRESS
        minute_rows, data = load_minute_rows(old_min_conn)
        if args.verbose:
            print("Loaded minute data from INPROGRESS; minutes:", len(minute_rows))

        # Aggregate into hours
        aggregates = aggregate_minutes_to_hours(minute_rows, data, verbose=args.verbose)
        if not aggregates:
            if args.verbose:
                print("No hour aggregates to write.")
        # Ensure hour DB schema and write aggregates
        os.makedirs(os.path.dirname(dst), exist_ok=True) if os.path.dirname(dst) else None
        dst_conn = sqlite3.connect(dst)
        ensure_hour_schema(dst_conn)
        if aggregates:
            write_hour_aggregates(dst_conn, aggregates, verbose=args.verbose)
            if args.verbose:
                print("Wrote", len(aggregates), "hour buckets into", dst)
        dst_conn.close()

        # Copy recent minute rows (>= now - 24h) back into the fresh minute DB
        cutoff = int(now_epoch() - RETENTION_SECONDS)
        new_min_conn = sqlite3.connect(src)
        create_minute_schema(new_min_conn)  # ensure tables exist
        copied = copy_recent_minutes(old_min_conn, new_min_conn, cutoff, verbose=args.verbose)
        if args.verbose:
            print("Copied recent minutes counts:", copied)
        new_min_conn.close()
        old_min_conn.close()

        # Remove INPROGRESS file
        try:
            os.remove(tmp)
            if args.verbose:
                print("Removed INPROGRESS file", tmp)
        except Exception as e:
            print("Warning: failed to remove INPROGRESS file:", e)

        print("Atomic aggregation completed successfully.")
    finally:
        lock.release()

if __name__ == "__main__":
    import datetime
    main()
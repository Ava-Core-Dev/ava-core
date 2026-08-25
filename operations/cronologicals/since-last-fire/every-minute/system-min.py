#!/usr/bin/env python3
"""
aggregate_and_reset.py

Aggregate the fast-writer collector DB into 1-minute buckets and write aggregates to
system-1min.db, then DELETE the original system.db and create a fresh DB with the collector schema.

Usage:
  python3 aggregate_and_reset.py
  python3 aggregate_and_reset.py --src /home/ava-core/database/system.db --dst /home/ava-core/database/system-1min.db

WARNING: This script deletes the source DB file after aggregation. Stop the collector or ensure it tolerates the DB being replaced.
"""
from __future__ import annotations
import argparse
import sqlite3
import json
import os
import math
import statistics
import datetime
import time
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

DEFAULT_SRC = "/home/ava-core/database/system.db"

# ---------- Helpers ----------
def iso_to_epoch(ts_iso: Optional[str]) -> Optional[float]:
    if not ts_iso:
        return None
    try:
        if ts_iso.endswith("Z"):
            ts_iso = ts_iso[:-1]
        return datetime.datetime.fromisoformat(ts_iso).timestamp()
    except Exception:
        try:
            return datetime.datetime.strptime(ts_iso.split(".")[0], "%Y-%m-%dT%H:%M:%S").timestamp()
        except Exception:
            return None

def floor_minute(epoch: float) -> int:
    return int(math.floor(epoch / 60.0) * 60)

def stats_from_numbers(nums: List[float]) -> Dict[str, Optional[float]]:
    nums = [float(x) for x in nums if x is not None]
    if not nums:
        return {"count": 0, "mean": None, "median": None, "min": None, "max": None}
    return {"count": len(nums), "mean": statistics.mean(nums), "median": statistics.median(nums), "min": min(nums), "max": max(nums)}

def safe_json_load(x):
    if x is None:
        return None
    if isinstance(x, (dict, list)):
        return x
    try:
        return json.loads(x)
    except Exception:
        return None

def merge_json_objects(objs: List[Any]) -> Any:
    if not objs:
        return None
    if all(isinstance(o, dict) for o in objs):
        out = {}
        for o in objs:
            out.update(o or {})
        return out
    if all(isinstance(o, list) for o in objs):
        res = []
        for o in objs:
            res.extend(o)
        return res
    return objs[-1]

# ---------- Destination schema ----------
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

# ---------- Collector schema recreator (fresh system.db) ----------
def create_collector_schema(conn: sqlite3.Connection):
    c = conn.cursor()
    c.execute("""
    CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY,
        ts_utc TEXT NOT NULL,
        hostname TEXT,
        os_info TEXT,
        uptime_seconds REAL
    )""")
    c.execute("CREATE TABLE IF NOT EXISTS cpu (run_id INTEGER, info TEXT)")
    c.execute("CREATE TABLE IF NOT EXISTS memory (run_id INTEGER, info TEXT)")
    c.execute("CREATE TABLE IF NOT EXISTS disks (run_id INTEGER, device TEXT, mountpoint TEXT, fstype TEXT, usage TEXT, extra TEXT)")
    c.execute("CREATE TABLE IF NOT EXISTS temps (run_id INTEGER, sensor_key TEXT, entries TEXT)")
    c.execute("CREATE TABLE IF NOT EXISTS battery (run_id INTEGER, info TEXT)")
    c.execute("CREATE TABLE IF NOT EXISTS network (run_id INTEGER, iface TEXT, addrs TEXT, stats TEXT, io TEXT)")
    c.execute("CREATE TABLE IF NOT EXISTS processes (run_id INTEGER, pid INTEGER, username TEXT, name TEXT, status TEXT, create_time REAL, cpu_percent REAL, memory_percent REAL, memory_info TEXT, cmdline TEXT, exe TEXT, cwd TEXT, env TEXT)")
    c.execute("CREATE TABLE IF NOT EXISTS misc (run_id INTEGER, key TEXT, value TEXT)")
    c.execute("CREATE TABLE IF NOT EXISTS smart (run_id INTEGER, device TEXT, kname TEXT, info TEXT)")
    conn.commit()

# ---------- Load source helpers ----------
def load_runs(conn: sqlite3.Connection) -> List[Dict[str,Any]]:
    cur = conn.cursor()
    cur.execute("SELECT id, ts_utc, hostname FROM runs ORDER BY id")
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]

def fetch_table_rows_for_runs(conn: sqlite3.Connection, table: str, run_ids: List[int]) -> List[Dict[str,Any]]:
    if not run_ids:
        return []
    cur = conn.cursor()
    placeholders = ",".join("?" for _ in run_ids)
    q = f"SELECT * FROM {table} WHERE run_id IN ({placeholders})"
    try:
        cur.execute(q, run_ids)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]
    except Exception:
        return []

# ---------- Aggregation ----------
def aggregate_all(src_conn: sqlite3.Connection, dst_conn: sqlite3.Connection, verbose: bool=False, top_procs: int=25) -> int:
    runs = load_runs(src_conn)
    if not runs:
        if verbose: print("No runs found in source DB.")
        return 0

    # Bucket runs by minute
    buckets = defaultdict(list)
    for r in runs:
        epoch = iso_to_epoch(r.get("ts_utc"))
        if epoch is None:
            continue
        buckets[floor_minute(epoch)].append(r)
    minute_keys = sorted(buckets.keys())
    if verbose: print(f"Found {len(minute_keys)} minute buckets")

    # Preload rows for run_ids
    run_ids = [r['id'] for r in runs]
    tables = ["cpu","memory","disks","temps","battery","network","processes","smart","misc"]
    rows_index = {t: defaultdict(list) for t in tables}
    for t in tables:
        rows = fetch_table_rows_for_runs(src_conn, t, run_ids)
        for row in rows:
            rid = row.get("run_id")
            if rid is None:
                continue
            rows_index[t][rid].append(row)

    dst_cur = dst_conn.cursor()
    inserted = 0

    for minute in minute_keys:
        bucket_runs = buckets[minute]
        rids = [r['id'] for r in bucket_runs]
        # start/end iso
        start_epoch = min((iso_to_epoch(r['ts_utc']) for r in bucket_runs if iso_to_epoch(r['ts_utc']) is not None), default=None)
        end_epoch = max((iso_to_epoch(r['ts_utc']) for r in bucket_runs if iso_to_epoch(r['ts_utc']) is not None), default=None)
        start_iso = datetime.datetime.utcfromtimestamp(start_epoch).isoformat() + "Z" if start_epoch else None
        end_iso = datetime.datetime.utcfromtimestamp(end_epoch).isoformat() + "Z" if end_epoch else None
        hostnames = list({r.get("hostname") for r in bucket_runs if r.get("hostname")})

        # minute_runs
        dst_cur.execute(
            "INSERT OR REPLACE INTO minute_runs (minute_ts, start_ts, end_ts, run_count, hostnames) VALUES (?, ?, ?, ?, ?)",
            (minute, start_iso, end_iso, len(bucket_runs), json.dumps(hostnames))
        )

        # CPU
        cpu_percents = []
        per_cpu_lists = []
        for rid in rids:
            for row in rows_index["cpu"].get(rid, []):
                info = safe_json_load(row.get("info"))
                if isinstance(info, dict):
                    p = info.get("percent")
                    if isinstance(p, (int,float)): cpu_percents.append(p)
                    per = info.get("percent_per_cpu")
                    if isinstance(per, list): per_cpu_lists.append(per)
        cpu_summary = {"percent": stats_from_numbers(cpu_percents)}
        if per_cpu_lists:
            min_len = min(len(l) for l in per_cpu_lists)
            per_core = []
            for i in range(min_len):
                vals = [l[i] for l in per_cpu_lists if isinstance(l[i], (int,float))]
                per_core.append(stats_from_numbers(vals))
            cpu_summary["per_core"] = per_core
        dst_cur.execute("INSERT OR REPLACE INTO minute_cpu (minute_ts, stats) VALUES (?, ?)", (minute, json.dumps(cpu_summary)))

        # MEMORY
        used_vals = []
        percent_vals = []
        swap_used_vals = []
        for rid in rids:
            for row in rows_index["memory"].get(rid, []):
                info = safe_json_load(row.get("info"))
                if isinstance(info, dict):
                    vm = info.get("virtual_memory") or {}
                    if isinstance(vm, dict):
                        u = vm.get("used"); p = vm.get("percent")
                        if isinstance(u, (int,float)): used_vals.append(u)
                        if isinstance(p, (int,float)): percent_vals.append(p)
                    sw = info.get("swap") or {}
                    if isinstance(sw, dict):
                        su = sw.get("used")
                        if isinstance(su, (int,float)): swap_used_vals.append(su)
        mem_summary = {"used": stats_from_numbers(used_vals), "percent": stats_from_numbers(percent_vals), "swap_used": stats_from_numbers(swap_used_vals)}
        dst_cur.execute("INSERT OR REPLACE INTO minute_memory (minute_ts, stats) VALUES (?, ?)", (minute, json.dumps(mem_summary)))

        # DISKS
        disk_map = defaultdict(list)
        for rid in rids:
            for row in rows_index["disks"].get(rid, []):
                key = (row.get("device"), row.get("mountpoint"), row.get("fstype"))
                disk_map[key].append({"usage": safe_json_load(row.get("usage")), "extra": safe_json_load(row.get("extra"))})
        for (device, mount, fstype), items in disk_map.items():
            used = [i["usage"].get("used") for i in items if isinstance(i.get("usage"), dict) and isinstance(i["usage"].get("used"), (int,float))]
            percent = [i["usage"].get("percent") for i in items if isinstance(i.get("usage"), dict) and isinstance(i["usage"].get("percent"), (int,float))]
            total = [i["usage"].get("total") for i in items if isinstance(i.get("usage"), dict) and isinstance(i["usage"].get("total"), (int,float))]
            extras = [i["extra"] for i in items if i.get("extra") is not None]
            stats = {"used": stats_from_numbers(used), "percent": stats_from_numbers(percent), "total": stats_from_numbers(total)}
            merged_extra = merge_json_objects([e for e in extras if e is not None])
            dst_cur.execute("INSERT OR REPLACE INTO minute_disks (minute_ts, device, mountpoint, fstype, stats, extra) VALUES (?, ?, ?, ?, ?, ?)",
                            (minute, device, mount, fstype, json.dumps(stats), json.dumps(merged_extra)))

        # TEMPS
        temps_map = defaultdict(list)
        for rid in rids:
            for row in rows_index["temps"].get(rid, []):
                sensor = row.get("sensor_key")
                entries = safe_json_load(row.get("entries")) or []
                for e in entries:
                    label = e.get("label") or e.get("sensor") or "unknown"
                    curv = e.get("current") or e.get("temp") or e.get("value")
                    if isinstance(curv, (int,float)):
                        temps_map[(sensor, label)].append(curv)
        # aggregate per sensor_key (store mapping label->stats)
        # We'll group by sensor (not label) for DB row
        per_sensor = defaultdict(lambda: defaultdict(list))
        for (sensor, label), vals in temps_map.items():
            per_sensor[sensor][label].extend(vals)
        for sensor, labels in per_sensor.items():
            label_stats = {label: stats_from_numbers(vals) for label, vals in labels.items()}
            dst_cur.execute("INSERT OR REPLACE INTO minute_temps (minute_ts, sensor_key, stats) VALUES (?, ?, ?)",
                            (minute, sensor, json.dumps(label_stats)))

        # BATTERY
        bat_percents = []
        plugged_count = 0
        bat_samples = 0
        for rid in rids:
            for row in rows_index["battery"].get(rid, []):
                info = safe_json_load(row.get("info"))
                if isinstance(info, dict):
                    p = info.get("percent")
                    if isinstance(p, (int,float)): bat_percents.append(p)
                    if info.get("power_plugged") is True: plugged_count += 1
                    bat_samples += 1
        bat_summary = {"percent": stats_from_numbers(bat_percents), "plugged_count": plugged_count, "samples": bat_samples}
        dst_cur.execute("INSERT OR REPLACE INTO minute_battery (minute_ts, stats) VALUES (?, ?)", (minute, json.dumps(bat_summary)))

        # NETWORK: compute rates per iface using earliest and latest sample in the minute
        net_by_iface = defaultdict(list)
        for rid in rids:
            for row in rows_index["network"].get(rid, []):
                iface = row.get("iface")
                io = safe_json_load(row.get("io")) or {}
                ts = iso_to_epoch(next((r['ts_utc'] for r in bucket_runs if r['id'] == rid), None))
                net_by_iface[iface].append((ts, io))
        for iface, samples in net_by_iface.items():
            samples_sorted = sorted([s for s in samples if s[0] is not None], key=lambda x: x[0])
            stats = {}
            if len(samples_sorted) >= 2:
                t0, io0 = samples_sorted[0]; t1, io1 = samples_sorted[-1]
                dt = t1 - t0 if t1 and t0 else None
                if dt and dt > 0:
                    def rate(field):
                        a = (io1.get(field) or 0)
                        b = (io0.get(field) or 0)
                        try:
                            return (a - b) / dt
                        except Exception:
                            return None
                    stats = {
                        "bytes_sent_per_sec": rate("bytes_sent"),
                        "bytes_recv_per_sec": rate("bytes_recv"),
                        "packets_sent_per_sec": rate("packets_sent"),
                        "packets_recv_per_sec": rate("packets_recv"),
                        "samples": len(samples_sorted)
                    }
                else:
                    stats = {"last": samples_sorted[-1][1], "samples": len(samples_sorted)}
            else:
                stats = {"last": samples_sorted[-1][1] if samples_sorted else {}, "samples": len(samples_sorted)}
            dst_cur.execute("INSERT OR REPLACE INTO minute_network (minute_ts, iface, stats) VALUES (?, ?, ?)",
                            (minute, iface, json.dumps(stats)))

        # PROCESSES: aggregate per pid+name
        proc_map = {}
        for rid in rids:
            for row in rows_index["processes"].get(rid, []):
                pid = row.get("pid")
                name = row.get("name") or ""
                key = (pid, name)
                entry = proc_map.setdefault(key, {"pid": pid, "name": name, "exe": row.get("exe"), "cmdline": row.get("cmdline"), "cpu": [], "mem": [], "count": 0})
                cpu_v = row.get("cpu_percent")
                mem_v = row.get("memory_percent")
                if isinstance(cpu_v, (int,float)): entry["cpu"].append(cpu_v)
                if isinstance(mem_v, (int,float)): entry["mem"].append(mem_v)
                entry["count"] += 1
        # prepare top processes by avg mem
        proc_items = []
        for k,v in proc_map.items():
            avg_cpu = statistics.mean(v["cpu"]) if v["cpu"] else None
            avg_mem = statistics.mean(v["mem"]) if v["mem"] else None
            stats = {"avg_cpu": avg_cpu, "avg_mem": avg_mem, "samples": v["count"], "cpu_stats": stats_from_numbers(v["cpu"]) if v["cpu"] else None, "mem_stats": stats_from_numbers(v["mem"]) if v["mem"] else None}
            proc_items.append((v["pid"], v["name"], v["exe"], v["cmdline"], stats))
        proc_items_sorted = sorted(proc_items, key=lambda x: (x[4].get("avg_mem") or 0, x[4].get("avg_cpu") or 0), reverse=True)[:top_procs]
        for pid, name, exe, cmdline, stats in proc_items_sorted:
            dst_cur.execute("INSERT OR REPLACE INTO minute_processes (minute_ts, pid, name, exe, cmdline, stats) VALUES (?, ?, ?, ?, ?, ?)",
                            (minute, pid, name, exe, cmdline, json.dumps(stats)))

        # SMART: use last-known info per device
        smart_map = defaultdict(list)
        for rid in rids:
            for row in rows_index["smart"].get(rid, []):
                dev = row.get("device")
                kname = row.get("kname")
                info = safe_json_load(row.get("info"))
                ts = iso_to_epoch(next((r['ts_utc'] for r in bucket_runs if r['id'] == rid), None))
                smart_map[(dev, kname)].append((ts, info))
        for (dev, kname), samples in smart_map.items():
            samples_sorted = sorted([s for s in samples if s[0] is not None], key=lambda x: x[0])
            last_info = samples_sorted[-1][1] if samples_sorted else samples[-1][1] if samples else None
            merged = merge_json_objects([s for _, s in samples if s is not None])
            final = merged if isinstance(merged, dict) else last_info
            dst_cur.execute("INSERT OR REPLACE INTO minute_smart (minute_ts, device, kname, info) VALUES (?, ?, ?, ?)",
                            (minute, dev, kname, json.dumps(final)))

        # MISC: merge by key
        misc_map = defaultdict(list)
        for rid in rids:
            for row in rows_index["misc"].get(rid, []):
                k = row.get("key")
                v = safe_json_load(row.get("value"))
                misc_map[k].append(v)
        for k, vals in misc_map.items():
            merged = merge_json_objects(vals)
            dst_cur.execute("INSERT OR REPLACE INTO minute_misc (minute_ts, key, value) VALUES (?, ?, ?)",
                            (minute, k, json.dumps(merged)))

        inserted += 1

    dst_conn.commit()
    return inserted

# ---------- Main ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC, help="Source collector DB path")
    ap.add_argument("--dst", help="Destination 1min DB path (default: same folder system-1min.db)")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--top-procs", type=int, default=25, help="Top processes to keep per minute")
    args = ap.parse_args()

    src = os.path.expanduser(args.src)
    if not os.path.exists(src):
        print("Source DB not found:", src)
        return
    dst = args.dst or os.path.join(os.path.dirname(src), "system-1min.db")
    if args.verbose:
        print("Source:", src)
        print("Dest:", dst)

    # open DBs
    src_conn = sqlite3.connect(src)
    src_conn.row_factory = sqlite3.Row
    ensure_dir = lambda p: os.makedirs(os.path.dirname(p), exist_ok=True) if os.path.dirname(p) else None
    ensure_dir(dst)
    dst_conn = sqlite3.connect(dst)
    create_minute_schema(dst_conn)

    try:
        inserted = aggregate_all(src_conn, dst_conn, verbose=args.verbose, top_procs=args.top_procs)
        if args.verbose:
            print(f"Inserted/updated {inserted} minute rows in {dst}")
    finally:
        # close DBs first
        try:
            src_conn.close()
        except Exception:
            pass
        try:
            dst_conn.close()
        except Exception:
            pass

    # DELETE the original system.db per your request
    try:
        os.remove(src)
        print("Deleted source DB:", src)
    except Exception as e:
        print("Failed to delete source DB:", e)
        return

    # Create a fresh system.db with collector schema
    try:
        new_conn = sqlite3.connect(src)
        create_collector_schema(new_conn)
        new_conn.close()
        print("Created fresh collector DB at", src)
    except Exception as e:
        print("Failed to create fresh collector DB:", e)
        return

    print("Aggregation and reset completed successfully.")

if __name__ == "__main__":
    main()
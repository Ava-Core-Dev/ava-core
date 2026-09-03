"""Import accounts, accounting, and membership identifiers onto the live store.

Re-run: ``python windows/import_accounts.py`` from ``C:\\Users\\rootr\\ava``.
Does not print emails, UUIDs, Discord ids, or Solana keys.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

from apps.core import config
from apps.core.services import identities

log = logging.getLogger("ava.account_import")

# D1 ids from the old membershipSync.mjs (not secrets). Env wins when set.
_RR_D1_FALLBACK = "0b49c598-1f91-4a09-84a8-6ba8241c6df3"
_ROOTMC_D1_FALLBACK = "6cf71128-67e3-47b2-a802-d6c23d6489e0"

USERCACHE_PATHS = [
    Path(r"E:\ava\workstations\shockbyte\usercache.json"),
    Path(r"E:\ava\workstations\minecraft-plugins\server\usercache.json"),
    Path(r"E:\ava\workstations\minecraft-test\usercache.json"),
    Path.home() / "Ava" / "Workstations" / "minecraft-test" / "usercache.json",
    Path.home() / "ava" / "Workstations" / "minecraft-test" / "usercache.json",
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_credentials() -> list[str]:
    loaded = []
    for p in (
        config.AVA_HOME / "credentials.env",
        Path(r"E:\ava\credentials.env"),
        Path.home() / "Ava" / "credentials.env",
        config.AVA_HOME / ".env",
    ):
        if p.is_file():
            load_dotenv(p, override=False)
            loaded.append(str(p))
    return loaded


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _scan_user_qr(conn, summary: dict) -> None:
    roots = [
        config.MEDIA_DIR / "private" / "users",
        config.AVA_HOME / "Media" / "private" / "users",
        Path(r"E:\ava\media\private\users"),
    ]
    seen: set[Path] = set()
    n = 0
    used = []
    for root in roots:
        try:
            root = root.resolve()
        except OSError:
            continue
        if not root.is_dir() or root in seen:
            continue
        seen.add(root)
        used.append(str(root))
        for meta in root.glob("*/meta.json"):
            data = _read_json(meta)
            if not isinstance(data, dict):
                continue
            identities.upsert(
                conn,
                identifiers={
                    "email": data.get("email"),
                    "account_id": data.get("account_id"),
                    "solana": data.get("solana_public") or data.get("custodial_pubkey") or data.get("linked_pubkey"),
                },
                account_id=str(data.get("account_id") or ""),
                slug=str(data.get("slug") or meta.parent.name),
                kind=str(data.get("kind") or "member"),
                source="private_users_qr",
                path=str(meta),
            )
            n += 1
    summary["sources"]["qr_users"] = {
        "ok": bool(used),
        "rows": n,
        "paths": used,
        **({} if used else {"reason": "missing"}),
    }


def _scan_players(conn, summary: dict) -> None:
    roots = [
        config.DATA_DIR / "players",
        Path(r"E:\ava\data\players"),
        Path(r"D:\db backup\Database\players"),
    ]
    seen: set[str] = set()
    n_discord = 0
    n_mc = 0
    for root in roots:
        if not root.is_dir():
            continue
        for f in root.glob("*.json"):
            key = f.name.lower()
            if key in seen:
                continue
            seen.add(key)
            data = _read_json(f)
            if not isinstance(data, dict):
                continue
            did = str(data.get("discordId") or f.stem)
            identities.upsert(
                conn,
                identifiers={"discord": did, "username": data.get("username") or data.get("knownId")},
                member=1 if data.get("member") else 0,
                source="player_profile",
                path=str(f),
            )
            n_discord += 1
        mc = root / "mc"
        if mc.is_dir():
            for f in mc.glob("*.json"):
                key = f"mc:{f.name.lower()}"
                if key in seen:
                    continue
                seen.add(key)
                data = _read_json(f) or {}
                name = str((data.get("minecraftName") if isinstance(data, dict) else None) or f.stem)
                identities.upsert(
                    conn,
                    identifiers={"username": name},
                    source="player_mc",
                    path=str(f),
                )
                n_mc += 1
    summary["sources"]["players"] = {"ok": True, "discord_files": n_discord, "mc_files": n_mc}


def _scan_sessions(conn, summary: dict) -> None:
    root = Path(r"D:\db backup\Database\sessions")
    if not root.is_dir():
        summary["sources"]["sessions"] = {"ok": False, "reason": "missing"}
        return
    n = 0
    for p in root.iterdir():
        if p.is_dir() and "@" in p.name:
            identities.upsert(
                conn,
                identifiers={"email": p.name},
                source="db_backup_sessions",
                path=str(p),
            )
            n += 1
    summary["sources"]["sessions"] = {"ok": True, "email_dirs": n, "path": str(root)}


def _scan_usercache(conn, summary: dict) -> None:
    n_files = 0
    n_rows = 0
    used = []
    for path in USERCACHE_PATHS:
        if not path.is_file():
            continue
        data = _read_json(path)
        if not isinstance(data, list):
            continue
        n_files += 1
        used.append(str(path))
        for row in data:
            if not isinstance(row, dict):
                continue
            identities.upsert(
                conn,
                identifiers={"uuid": row.get("uuid"), "username": row.get("name")},
                source="usercache",
                path=str(path),
            )
            n_rows += 1
    summary["sources"]["usercache"] = {"ok": True, "files": n_files, "rows": n_rows, "paths": used}


def _scan_local_account_file(conn, summary: dict) -> None:
    path = config.DATA_DIR / "ava-rootrecord-account.local.json"
    if not path.is_file():
        summary["sources"]["local_account_file"] = {"ok": False, "reason": "missing"}
        return
    data = _read_json(path)
    if not isinstance(data, dict):
        summary["sources"]["local_account_file"] = {"ok": False, "reason": "unreadable"}
        return
    identities.upsert(
        conn,
        identifiers={
            "email": data.get("email"),
            "username": data.get("minecraft_username"),
        },
        source="local_account_file",
        path=str(path),
    )
    summary["sources"]["local_account_file"] = {"ok": True, "imported_fields": ["email", "minecraft_username"]}


def _scan_subscribers(conn, summary: dict) -> None:
    try:
        from apps.core.services import subscribers

        rows = subscribers.list_all()
    except Exception as e:
        summary["sources"]["subscribers"] = {"ok": False, "reason": type(e).__name__}
        return
    n = 0
    for row in rows:
        surface = str(row.get("surface") or "")
        sid = str(row.get("id") or "")
        if surface == "discord":
            identities.upsert(
                conn,
                identifiers={"discord": sid, "username": row.get("label")},
                source="report_subscribers",
                path="data/state/report-subscribers.json",
            )
            n += 1
        elif surface == "telegram" and sid:
            identities.upsert(
                conn,
                identifiers={"membership_id": f"telegram:{sid}"},
                source="report_subscribers",
                path="data/state/report-subscribers.json",
            )
            n += 1
    summary["sources"]["subscribers"] = {"ok": True, "rows": n}


def _scan_membership_log(conn, summary: dict) -> None:
    paths = [
        config.DATA_DIR / "membership" / "core-sync.jsonl",
        Path(r"E:\ava\data\membership\core-sync.jsonl"),
    ]
    n_lines = 0
    n_discord = 0
    for path in paths:
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line.strip():
                continue
            n_lines += 1
            try:
                data = json.loads(line)
            except Exception:
                continue
            blobs = []
            for key in ("skippedSample", "appliedRows", "plans"):
                blobs.extend(data.get(key) or [])
            for row in blobs:
                if not isinstance(row, dict):
                    continue
                did = row.get("discord_user_id") or row.get("did")
                email = None
                if isinstance(row.get("rr"), dict):
                    email = row["rr"].get("email")
                if not email and isinstance(row.get("rootmc"), dict):
                    email = row["rootmc"].get("email")
                email = email or row.get("email")
                if did or email:
                    identities.upsert(
                        conn,
                        identifiers={
                            "discord": did,
                            "email": email,
                            "username": row.get("username"),
                        },
                        source="membership_core_sync",
                        path=str(path),
                    )
                    n_discord += 1
    summary["sources"]["membership_log"] = {"ok": True, "lines": n_lines, "link_rows": n_discord}


def _d1_rows(body: dict) -> list[dict]:
    result = body.get("result") or []
    if not result:
        return []
    first = result[0] if isinstance(result, list) else result
    if not isinstance(first, dict):
        return []
    rows = first.get("results") or first.get("rows") or []
    return [r for r in rows if isinstance(r, dict)]


async def _scan_d1(conn, summary: dict) -> None:
    from apps.core.services import d1

    db_account = config.CF_D1_ACCOUNT_DB_ID or os.getenv("D1_DATABASE_ID") or _RR_D1_FALLBACK
    db_rootmc = config.CF_D1_ROOTMC_DB_ID or os.getenv("D1_ROOTMC_LIVE_ID") or _ROOTMC_D1_FALLBACK
    queries = [
        (
            db_account,
            "license_accounts",
            "SELECT id AS account_id, email FROM license_accounts LIMIT 5000",
        ),
        (
            db_account,
            "discord_account_links",
            "SELECT account_id, email, discord_user_id AS discord, discord_username AS username FROM discord_account_links LIMIT 5000",
        ),
        (
            db_account,
            "user_accounts",
            "SELECT id AS account_id, email, account_id AS membership_id, pro_unlocked AS pro, life_member AS life FROM user_accounts LIMIT 5000",
        ),
        (
            db_account,
            "internal_solana_wallets",
            "SELECT account_id, pubkey AS solana FROM internal_solana_wallets LIMIT 5000",
        ),
        (
            db_account,
            "solana_linked_wallets",
            "SELECT account_id, pubkey AS solana FROM solana_linked_wallets LIMIT 5000",
        ),
        (
            db_rootmc,
            "player_balances",
            "SELECT uuid, name AS username FROM player_balances LIMIT 5000",
        ),
        (
            db_rootmc,
            "g2_minecraft_link",
            "SELECT minecraft_uuid AS uuid, minecraft_username AS username, account_id, email FROM g2_minecraft_link LIMIT 5000",
        ),
        (
            db_rootmc,
            "discord_account_links_mc",
            "SELECT account_id, email, discord_user_id AS discord, discord_username AS username FROM discord_account_links LIMIT 5000",
        ),
        (
            db_rootmc,
            "user_accounts_mc",
            "SELECT id AS account_id, email, pro_unlocked AS pro, life_member AS life FROM user_accounts LIMIT 5000",
        ),
    ]
    out = {}
    for db_id, name, sql in queries:
        db_ids = [db_id]
        if name in {
            "player_balances",
            "g2_minecraft_link",
            "discord_account_links_mc",
            "user_accounts_mc",
        } and _ROOTMC_D1_FALLBACK not in db_ids:
            db_ids.append(_ROOTMC_D1_FALLBACK)
        last_err = "no_db_id"
        body = None
        used = ""
        for candidate in [d for d in db_ids if d]:
            try:
                body = await d1.query(candidate, sql)
            except Exception as e:
                last_err = type(e).__name__
                continue
            if body.get("success"):
                used = candidate
                break
            errs = body.get("errors") or []
            msg = ""
            if errs and isinstance(errs[0], dict):
                msg = str(errs[0].get("message") or errs[0].get("code") or "")[:80]
            last_err = msg or "d1_error"
        if not body or not body.get("success"):
            out[name] = {"ok": False, "reason": last_err}
            continue
        rows = _d1_rows(body)
        n = 0
        for row in rows:
            identities.upsert(
                conn,
                identifiers={
                    "email": row.get("email"),
                    "discord": row.get("discord"),
                    "uuid": row.get("uuid"),
                    "solana": row.get("solana"),
                    "username": row.get("username"),
                    "account_id": row.get("account_id"),
                    "membership_id": row.get("membership_id"),
                },
                account_id=str(row.get("account_id") or ""),
                pro=int(row.get("pro") or 0),
                life=int(row.get("life") or 0),
                member=1 if (row.get("pro") or row.get("life")) else 0,
                source=f"d1:{name}",
                path=db_id[:8],
            )
            n += 1
        out[name] = {"ok": True, "rows": n}
    summary["sources"]["d1"] = out


async def _scan_mysql(conn, summary: dict) -> None:
    from apps.core.services import mysql

    tables = await mysql.query("SHOW TABLES")
    names = {str(v).lower() for row in tables for v in row.values()}
    if not names:
        summary["sources"]["mysql"] = {"ok": False, "reason": "unavailable"}
        return
    out = {"tables_seen": len(names)}
    if "license_accounts" in names:
        rows = await mysql.query("SELECT id AS account_id, email FROM license_accounts LIMIT 5000")
        n = 0
        for row in rows:
            identities.upsert(
                conn,
                identifiers={"account_id": row.get("account_id"), "email": row.get("email")},
                source="mysql_license_accounts",
            )
            n += 1
        out["license_accounts"] = n
    for sql, src in (
        ("SELECT minecraft_uuid AS uuid, minecraft_username AS username FROM root_economy_balances LIMIT 5000", "mysql_economy"),
        ("SELECT uuid, name AS username FROM player_balances LIMIT 5000", "mysql_player_balances"),
    ):
        try:
            rows = await mysql.query(sql)
        except Exception:
            rows = []
        n = 0
        for row in rows:
            identities.upsert(
                conn,
                identifiers={"uuid": row.get("uuid"), "username": row.get("username")},
                source=src,
            )
            n += 1
        out[src] = n
    summary["sources"]["mysql"] = {"ok": True, **out}


async def _scan_discord(conn, summary: dict) -> None:
    from apps.core.services import discord as discord_svc

    if not config.discord_bot_token():
        summary["sources"]["discord"] = {"ok": False, "reason": "no_bot_token"}
        return
    guild = config.ROOTMC_GUILD_ID
    n = 0
    after = "0"
    last_status = 200
    async with httpx.AsyncClient(timeout=20) as client:
        for _ in range(20):
            r = await client.get(
                f"{config.DISCORD_API}/guilds/{guild}/members",
                params={"limit": 1000, "after": after},
                headers=discord_svc._auth_headers(),
            )
            last_status = r.status_code
            if r.status_code != 200:
                summary["sources"]["discord"] = {
                    "ok": False,
                    "reason": f"http_{r.status_code}",
                    "imported": n,
                }
                return
            batch = r.json()
            if not isinstance(batch, list) or not batch:
                break
            for m in batch:
                user = m.get("user") if isinstance(m, dict) else None
                if not isinstance(user, dict):
                    continue
                uid = str(user.get("id") or "")
                uname = user.get("global_name") or user.get("username")
                identities.upsert(
                    conn,
                    identifiers={"discord": uid, "username": uname},
                    source="discord_guild",
                    path=guild,
                )
                n += 1
                after = uid
            if len(batch) < 1000:
                break
    summary["sources"]["discord"] = {"ok": True, "members": n, "http": last_status}


def _copy_sqlite(summary: dict) -> None:
    copies = []
    skipped = []
    mapping = [
        (Path(r"D:\db backup\ecoflow-10s.db"), config.DATA_DIR / "ecoflow" / "ecoflow-10s.db"),
        (Path(r"D:\db backup\ecoflow-1min.db"), config.DATA_DIR / "ecoflow" / "ecoflow-1min.db"),
        (Path(r"D:\db backup\ecoflow-state.db"), config.DATA_DIR / "ecoflow" / "ecoflow-state.db"),
        (Path(r"D:\db backup\system.db"), config.DATA_DIR / "system" / "system.db"),
        (Path(r"D:\db backup\weather.db"), config.DATA_DIR / "weather" / "weather.db"),
    ]
    large = [
        (Path(r"D:\db backup\quakes.db"), 438_000_000),
        (Path(r"D:\db backup\system-1min.db"), 330_000_000),
    ]
    for src, dest in mapping:
        if not src.is_file():
            skipped.append({"path": str(src), "reason": "missing"})
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.is_file() and dest.stat().st_size >= src.stat().st_size:
            skipped.append({"path": str(dest), "reason": "already_present", "bytes": dest.stat().st_size})
            continue
        shutil.copy2(src, dest)
        copies.append({"dest": str(dest), "bytes": dest.stat().st_size})
    summary["sqlite_copied"] = copies
    summary["sqlite_skipped"] = skipped
    summary["sqlite_left_on_d"] = [
        {"path": str(p), "bytes": p.stat().st_size if p.is_file() else 0, "reason": "large_leave_on_D"}
        for p, _lim in large
        if p.is_file()
    ]


def _merge_finance(summary: dict) -> None:
    live = config.DATA_DIR / "finance" / "ops-ledger.json"
    archive = Path(r"E:\ava\data\finance\ops-ledger.json")
    if not live.is_file():
        summary["finance"] = {"ok": False, "reason": "live_ledger_missing"}
        return
    live_data = _read_json(live)
    arch_data = _read_json(archive) if archive.is_file() else None
    if not isinstance(live_data, dict):
        summary["finance"] = {"ok": False, "reason": "live_unreadable"}
        return
    added = 0

    def expense_ids(obj: Any) -> set[str]:
        found: set[str] = set()
        if isinstance(obj, dict):
            if obj.get("id") and ("amountUsd" in obj or "period" in obj):
                found.add(str(obj["id"]))
            for v in obj.values():
                found |= expense_ids(v)
        elif isinstance(obj, list):
            for v in obj:
                found |= expense_ids(v)
        return found

    def find_expenses(obj: Any) -> list[dict]:
        rows: list[dict] = []
        if isinstance(obj, dict):
            if obj.get("id") and "amountUsd" in obj and obj.get("label"):
                rows.append(obj)
            for v in obj.values():
                rows.extend(find_expenses(v))
        elif isinstance(obj, list):
            for v in obj:
                rows.extend(find_expenses(v))
        return rows

    have = expense_ids(live_data)
    extras = []
    if isinstance(arch_data, dict):
        for row in find_expenses(arch_data):
            rid = str(row.get("id") or "")
            if rid and rid not in have and float(row.get("amountUsd") or 0) != 0:
                extras.append(row)
                have.add(rid)
    if extras:
        live_data.setdefault("expenses", [])
        if isinstance(live_data["expenses"], list):
            live_data["expenses"].extend(extras)
            added += len(extras)
        projects = live_data.get("projects") or []
        if projects and isinstance(projects, list) and isinstance(projects[0], dict):
            accounts = projects[0].get("accounts") or []
            if accounts and isinstance(accounts[0], dict):
                accounts[0].setdefault("expenses", [])
                if isinstance(accounts[0]["expenses"], list):
                    existing = {str(x.get("id")) for x in accounts[0]["expenses"] if isinstance(x, dict)}
                    for row in extras:
                        if str(row.get("id")) not in existing:
                            accounts[0]["expenses"].append(row)
            projects[0].setdefault("expenses", [])
            if isinstance(projects[0]["expenses"], list):
                existing = {str(x.get("id")) for x in projects[0]["expenses"] if isinstance(x, dict)}
                for row in extras:
                    if str(row.get("id")) not in existing:
                        projects[0]["expenses"].append(row)
        live_data["updatedAt"] = int(datetime.now().timestamp() * 1000)
        tmp = live.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(live_data, indent=2) + "\n", encoding="utf-8")
        tmp.replace(live)
    summary["finance"] = {
        "ok": True,
        "ledger": str(live),
        "merged_nonzero_rows": added,
        "stripe_snapshot": (config.DATA_DIR / "finance" / "stripe-snapshot.json").is_file(),
    }


def _write_summary(summary: dict) -> Path:
    dest = config.DATA_DIR / "state" / "identity-import-summary.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return dest


async def run() -> dict[str, Any]:
    creds = _load_credentials()
    summary: dict[str, Any] = {
        "ok": True,
        "at": _now(),
        "store": str(identities.db_path()),
        "credentials_files": creds,
        "sources": {},
    }
    conn = identities.connect()
    try:
        _scan_user_qr(conn, summary)
        _scan_players(conn, summary)
        _scan_sessions(conn, summary)
        _scan_usercache(conn, summary)
        _scan_local_account_file(conn, summary)
        _scan_subscribers(conn, summary)
        _scan_membership_log(conn, summary)
        conn.commit()
        try:
            await _scan_d1(conn, summary)
            conn.commit()
        except Exception as e:
            summary["sources"]["d1"] = {"ok": False, "reason": type(e).__name__}
        try:
            await _scan_mysql(conn, summary)
            conn.commit()
        except Exception as e:
            summary["sources"]["mysql"] = {"ok": False, "reason": type(e).__name__}
        try:
            await _scan_discord(conn, summary)
            conn.commit()
        except Exception as e:
            summary["sources"]["discord"] = {"ok": False, "reason": type(e).__name__}
        summary["counts"] = identities.counts(conn)
        sample = identities.sample_uuid(conn)
        if sample:
            hit = identities.lookup(sample, conn)
            summary["uuid_lookup_ok"] = bool(hit and hit.get("found"))
        else:
            summary["uuid_lookup_ok"] = False
    finally:
        conn.close()
    _copy_sqlite(summary)
    _merge_finance(summary)
    try:
        from apps.core.services import membership as membership_svc

        summary["rootmc_membership"] = await membership_svc.rootmc_stats()
        # strip development_note if it contains emails — it doesn't, counts only
    except Exception as e:
        summary["rootmc_membership"] = {"ok": False, "reason": type(e).__name__}
    path = _write_summary(summary)
    summary["summary_path"] = str(path)
    log.info(
        "account import identities=%s emails=%s discord=%s uuid=%s solana=%s",
        (summary.get("counts") or {}).get("identities"),
        (summary.get("counts") or {}).get("id_email"),
        (summary.get("counts") or {}).get("id_discord"),
        (summary.get("counts") or {}).get("id_uuid"),
        (summary.get("counts") or {}).get("id_solana"),
    )
    return summary

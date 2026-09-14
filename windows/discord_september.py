"""September Discord archive, optional nuke, then pin rebuild.

Usage:
  python windows/discord_september.py archive
  python windows/discord_september.py nuke     # refuses without MANIFEST.json
  python windows/discord_september.py rebuild
"""
from __future__ import annotations

import asyncio
import ctypes
import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
for envp in (ROOT / ".env", ROOT / "credentials.env", Path.home() / "ava" / "credentials.env"):
    if envp.is_file():
        load_dotenv(envp, override=False)

API = "https://discord.com/api/v10"
OUT = ROOT / "data" / "discord pre september"
LOG = ROOT / "data" / "logs" / "discord-september-nuke.log"
LOCK = ROOT / "data" / "logs" / "discord-september.lock"
MANIFEST = OUT / "MANIFEST.json"
ID_MAP = OUT / "CHANNEL_ID_MAP.json"

GUILDS = {
    "rootrecord": {
        "id": "1497039564345442406",
        "token_keys": ("DISCORD_BOT_TOKEN",),
        "home": "1497160346358644767",
        "pins": [
            ("1497160346358644767", "welcome"),
            ("1500286864119038103", "announcements"),
            ("1497039565461000214", "verified-chat"),
        ],
    },
    "rootmc": {
        "id": "1516108585740800042",
        "token_keys": ("AVA_DISCORD_BOT_TOKEN", "DISCORD_ROOTMC_BOT_TOKEN", "SEXI_DISCORD_BOT_TOKEN"),
        "home": "1545284354157187083",
        "pins": [
            ("1516392367869919243", "rules"),
            ("1545284354157187083", "general"),
        ],
    },
}

TEXT_TYPES = {0, 5, 11, 12, 15, 16}
CLONE_TYPES = {0, 5}
SKIP_TYPES = {2, 13}  # voice, stage
# Fat leftovers get cloned (IDs remapped in config + wrangler). Pins follow CHANNEL_ID_MAP.
FAT_PAGES = 2  # 200 msgs sampled; still-full → recreate
HTTP_RETRIES = 12
CLONE_MIN = 80

PATCH_ROOTS = (
    ROOT / "apps",
    ROOT / "windows",
    ROOT / "operations",
    ROOT / "all-connections",
)
PATCH_FILES = (ROOT / ".env", ROOT / "credentials.env")
SKIP_DIR_NAMES = {
    ".git",
    ".venv",
    "node_modules",
    "__pycache__",
    ".cargo",
    "backups",
}


def _token(keys: tuple[str, ...]) -> str:
    for k in keys:
        v = (os.getenv(k) or "").strip().removeprefix("Bot ").removeprefix("bot ")
        if v:
            return v
    return ""


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bot {token}",
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "AvaIvyRootMC (rootmc.net, 2.0)",
    }


def _log(msg: str) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    line = f"{datetime.now(timezone.utc).isoformat()} {msg}\n"
    with LOG.open("a", encoding="utf-8") as fh:
        fh.write(line)
    print(msg, flush=True)


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    handle = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
    if handle:
        ctypes.windll.kernel32.CloseHandle(handle)
        return True
    return False


def _acquire_lock() -> None:
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    if LOCK.is_file():
        try:
            old = int((LOCK.read_text(encoding="utf-8") or "0").strip() or "0")
        except ValueError:
            old = 0
        if old and old != os.getpid() and _pid_alive(old):
            raise SystemExit(f"another discord_september pid={old} — refuse")
        try:
            LOCK.unlink()
        except OSError:
            pass
    try:
        fd = os.open(str(LOCK), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode("ascii"))
        os.close(fd)
    except FileExistsError:
        raise SystemExit("discord_september lock exists — refuse")


def _release_lock() -> None:
    try:
        if LOCK.is_file() and LOCK.read_text(encoding="utf-8").strip() == str(os.getpid()):
            LOCK.unlink()
    except OSError:
        pass


async def _sleep_429(r: httpx.Response) -> None:
    try:
        wait = float((r.json() or {}).get("retry_after") or 1)
    except Exception:
        wait = float(r.headers.get("Retry-After") or 1)
    await asyncio.sleep(min(max(wait, 0.4), 30))


async def _request(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    token: str,
    **kwargs,
) -> httpx.Response:
    last: httpx.Response | None = None
    for attempt in range(HTTP_RETRIES):
        try:
            r = await client.request(method, url, headers=_headers(token), **kwargs)
        except (
            httpx.ReadError,
            httpx.ConnectError,
            httpx.TimeoutException,
            httpx.RemoteProtocolError,
            httpx.WriteError,
        ) as e:
            _log(f"http retry {type(e).__name__} {method} {url} try={attempt + 1}")
            await asyncio.sleep(min(2**attempt, 20))
            continue
        if r.status_code == 429:
            await _sleep_429(r)
            last = r
            continue
        return r
    if last is not None:
        return last
    raise RuntimeError(f"http failed {method} {url}")


async def _get(client: httpx.AsyncClient, url: str, token: str) -> httpx.Response:
    return await _request(client, "GET", url, token)


async def _archive_guild(name: str, spec: dict) -> dict:
    token = _token(tuple(spec["token_keys"]))
    if len(token) < 20:
        return {"ok": False, "guild": name, "detail": "no_token"}
    gid = spec["id"]
    dest = OUT / name
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "channels").mkdir(exist_ok=True)
    (dest / "threads").mkdir(exist_ok=True)
    (dest / "members").mkdir(exist_ok=True)
    (dest / "media").mkdir(exist_ok=True)
    (dest / "messages").mkdir(exist_ok=True)
    stats = {"channels": 0, "messages": 0, "media": 0, "members": 0, "bytes": 0}

    timeout = httpx.Timeout(60.0, connect=20.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        g = await _get(client, f"{API}/guilds/{gid}", token)
        (dest / "guild.json").write_text(g.text, encoding="utf-8")
        chs = await _get(client, f"{API}/guilds/{gid}/channels", token)
        channels = chs.json() if chs.status_code == 200 else []
        (dest / "channels" / "list.json").write_text(json.dumps(channels, indent=2), encoding="utf-8")
        after = None
        members: list = []
        while True:
            q = "?limit=1000" + (f"&after={after}" if after else "")
            r = await _get(client, f"{API}/guilds/{gid}/members{q}", token)
            batch = r.json() if r.status_code == 200 and isinstance(r.json(), list) else []
            if not batch:
                break
            members.extend(batch)
            after = batch[-1].get("user", {}).get("id")
            if len(batch) < 1000:
                break
        public = [
            {"id": (m.get("user") or {}).get("id"), "username": (m.get("user") or {}).get("username")}
            for m in members
        ]
        (dest / "members" / "public.json").write_text(json.dumps(public, indent=2), encoding="utf-8")
        stats["members"] = len(public)

        async def dump_channel(cid: str) -> None:
            out = dest / "messages" / f"{cid}.jsonl"
            before = None
            n = 0
            with out.open("a", encoding="utf-8") as fh:
                while True:
                    q = "?limit=100" + (f"&before={before}" if before else "")
                    r = await _get(client, f"{API}/channels/{cid}/messages{q}", token)
                    if r.status_code != 200:
                        break
                    batch = r.json() if isinstance(r.json(), list) else []
                    if not batch:
                        break
                    for msg in batch:
                        fh.write(json.dumps(msg) + "\n")
                        n += 1
                        for att in msg.get("attachments") or []:
                            url = att.get("url") or att.get("proxy_url")
                            if not url:
                                continue
                            try:
                                raw = await client.get(url, timeout=60)
                                if raw.status_code == 200:
                                    fn = dest / "media" / f"{cid}-{att.get('id') or n}{Path(str(att.get('filename') or 'bin')).suffix}"
                                    fn.write_bytes(raw.content)
                                    stats["media"] += 1
                                    stats["bytes"] += len(raw.content)
                            except Exception:
                                pass
                    before = batch[-1].get("id")
                    if len(batch) < 100:
                        break
                    await asyncio.sleep(0.35)
            stats["messages"] += n
            stats["channels"] += 1

        for ch in channels:
            if int(ch.get("type") or 0) not in TEXT_TYPES:
                continue
            await dump_channel(str(ch["id"]))
            tr = await _get(client, f"{API}/channels/{ch['id']}/threads/active", token)
            threads = []
            if tr.status_code == 200:
                threads.extend((tr.json() or {}).get("threads") or [])
            ar = await _get(
                client,
                f"{API}/channels/{ch['id']}/threads/archived/public?limit=100",
                token,
            )
            if ar.status_code == 200:
                threads.extend((ar.json() or {}).get("threads") or [])
            (dest / "threads" / f"{ch['id']}.json").write_text(json.dumps(threads, indent=2), encoding="utf-8")
            for th in threads:
                tid = str(th.get("id") or "")
                if tid:
                    await dump_channel(tid)

    stats["ok"] = True
    stats["guild"] = name
    stats["guild_id"] = gid
    return stats


def _write_manifest(rows: list[dict]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    body = {
        "at": datetime.now(timezone.utc).isoformat(),
        "guilds": rows,
        "bytes": sum(int(r.get("bytes") or 0) for r in rows),
        "messages": sum(int(r.get("messages") or 0) for r in rows),
    }
    MANIFEST.write_text(json.dumps(body, indent=2), encoding="utf-8")


async def archive() -> None:
    rows = []
    for name, spec in GUILDS.items():
        print("archive", name, flush=True)
        rows.append(await _archive_guild(name, spec))
    _write_manifest(rows)
    print("manifest", MANIFEST, flush=True)


def _clone_payload(ch: dict) -> dict:
    overwrites = []
    for o in ch.get("permission_overwrites") or []:
        overwrites.append(
            {
                "id": str(o.get("id")),
                "type": int(o.get("type") or 0),
                "allow": str(o.get("allow") or "0"),
                "deny": str(o.get("deny") or "0"),
            }
        )
    body: dict = {
        "name": ch.get("name") or "channel",
        "type": int(ch.get("type") or 0),
        "topic": ch.get("topic") or "",
        "parent_id": ch.get("parent_id"),
        "position": int(ch.get("position") or 0),
        "nsfw": bool(ch.get("nsfw") or False),
        "rate_limit_per_user": int(ch.get("rate_limit_per_user") or 0),
        "permission_overwrites": overwrites,
    }
    if ch.get("default_auto_archive_duration"):
        body["default_auto_archive_duration"] = ch["default_auto_archive_duration"]
    return body


async def _leftover_fat(client: httpx.AsyncClient, token: str, cid: str) -> tuple[int, bool]:
    n = 0
    before = None
    more = False
    for _ in range(FAT_PAGES):
        q = "?limit=100" + (f"&before={before}" if before else "")
        r = await _get(client, f"{API}/channels/{cid}/messages{q}", token)
        if r.status_code != 200:
            return n, False
        batch = r.json() if isinstance(r.json(), list) else []
        if not batch:
            return n, False
        n += len(batch)
        before = batch[-1].get("id")
        if len(batch) < 100:
            return n, False
        more = True
        await asyncio.sleep(0.25)
    return n, more


async def _clone_channel(
    client: httpx.AsyncClient, token: str, guild_id: str, ch: dict
) -> str | None:
    old = str(ch["id"])
    payload = _clone_payload(ch)
    r = await _request(client, "POST", f"{API}/guilds/{guild_id}/channels", token, json=payload)
    if r.status_code not in (200, 201):
        _log(f"clone fail ch={old} name={ch.get('name')} status={r.status_code}")
        return None
    new = str((r.json() or {}).get("id") or "")
    if not new:
        return None
    await _request(
        client,
        "PATCH",
        f"{API}/channels/{new}",
        token,
        json={"position": int(ch.get("position") or 0), "parent_id": ch.get("parent_id")},
    )
    d = await _request(client, "DELETE", f"{API}/channels/{old}", token)
    if d.status_code not in (200, 204):
        _log(f"clone delete-old fail ch={old} new={new} status={d.status_code}")
        return None
    _log(f"cloned {ch.get('name')} {old} -> {new}")
    return new


def _should_skip_patch(path: Path) -> bool:
    parts = {p.lower() for p in path.parts}
    if parts & {n.lower() for n in SKIP_DIR_NAMES}:
        return True
    if "discord pre september" in str(path).lower():
        return True
    if "windows" in path.parts and "backups" in path.parts:
        return True
    if path.name.startswith("_tmp_"):
        return True
    return False


def _patch_id_map(mapping: dict[str, str]) -> list[str]:
    if not mapping:
        return []
    touched: list[str] = []
    files: list[Path] = [p for p in PATCH_FILES if p.is_file()]
    for root in PATCH_ROOTS:
        if not root.is_dir():
            continue
        for p in root.rglob("*"):
            if not p.is_file() or _should_skip_patch(p):
                continue
            if p.suffix.lower() not in {".py", ".mjs", ".js", ".ts", ".toml", ".json", ".env", ".md", ".yml", ".yaml"}:
                continue
            if p.name in {"MANIFEST.json", "CHANNEL_ID_MAP.json"}:
                continue
            files.append(p)
    for p in files:
        try:
            text = p.read_text(encoding="utf-8")
        except Exception:
            continue
        orig = text
        for old, new in mapping.items():
            if old and new and old != new:
                text = text.replace(old, new)
        if text != orig:
            p.write_text(text, encoding="utf-8")
            touched.append(str(p.relative_to(ROOT)))
    return touched


async def _nuke_channel(client: httpx.AsyncClient, token: str, name: str, cid: str) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(days=14)
    empty_streak = 0
    while True:
        r = await _get(client, f"{API}/channels/{cid}/messages?limit=100", token)
        if r.status_code in (403, 404, 50001, 50013):
            _log(f"nuke skip ch={cid} status={r.status_code}")
            return
        if r.status_code != 200:
            _log(f"nuke fetch fail {name} ch={cid} status={r.status_code}")
            await asyncio.sleep(2)
            empty_streak += 1
            if empty_streak >= 5:
                return
            continue
        batch = r.json() if isinstance(r.json(), list) else []
        if not batch:
            return
        empty_streak = 0
        recent, old = [], []
        for m in batch:
            ts = str(m.get("timestamp") or "")
            try:
                when = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            except Exception:
                when = datetime.now(timezone.utc)
            mid = str(m["id"])
            if when >= cutoff:
                recent.append(mid)
            else:
                old.append(mid)

        async def _del_one(mid: str) -> int:
            while True:
                d = await _request(client, "DELETE", f"{API}/channels/{cid}/messages/{mid}", token)
                if d.status_code in (200, 204, 404):
                    return int(d.status_code)
                if d.status_code in (403, 50013):
                    return int(d.status_code)
                await asyncio.sleep(0.4)
                return int(d.status_code)

        denied = False
        for i in range(0, len(recent), 100):
            chunk = recent[i : i + 100]
            if len(chunk) < 2:
                for mid in chunk:
                    code = await _del_one(mid)
                    if code in (403, 50013):
                        denied = True
                continue
            d = await _request(
                client,
                "POST",
                f"{API}/channels/{cid}/messages/bulk-delete",
                token,
                json={"messages": chunk},
            )
            if d.status_code in (403, 50013):
                _log(f"nuke no MANAGE_MESSAGES bulk ch={cid} status={d.status_code}")
                denied = True
            elif d.status_code not in (200, 204):
                _log(f"bulk-delete {cid} {d.status_code} — falling back")
                for mid in chunk:
                    code = await _del_one(mid)
                    if code in (403, 50013):
                        denied = True
        if denied:
            return
        sem = asyncio.Semaphore(1)

        async def _del(mid: str) -> int:
            async with sem:
                return await _del_one(mid)

        codes = await asyncio.gather(*[_del(mid) for mid in old]) if old else []
        if any(c in (403, 50013) for c in codes):
            _log(f"nuke no MANAGE_MESSAGES del ch={cid}")
            return
        _log(f"nuke progress {name} ch={cid} n={len(batch)}")


async def _collect_ids(client: httpx.AsyncClient, token: str, channels: list) -> list[str]:
    ids: list[str] = []
    for ch in channels:
        ctype = int(ch.get("type") or 0)
        if ctype in SKIP_TYPES:
            continue
        if ctype not in TEXT_TYPES:
            continue
        cid = str(ch["id"])
        ids.append(cid)
        tr = await _get(client, f"{API}/channels/{cid}/threads/active", token)
        if tr.status_code == 200:
            ids.extend(str(t["id"]) for t in (tr.json() or {}).get("threads") or [])
        ar = await _get(client, f"{API}/channels/{cid}/threads/archived/public?limit=100", token)
        if ar.status_code == 200:
            ids.extend(str(t["id"]) for t in (ar.json() or {}).get("threads") or [])
    return list(dict.fromkeys(ids))


async def _wipe_guild(name: str, spec: dict) -> dict[str, str]:
    token = _token(tuple(spec["token_keys"]))
    mapping: dict[str, str] = {}
    if len(token) < 20:
        _log(f"nuke skip {name} no_token")
        return mapping
    gid = spec["id"]
    timeout = httpx.Timeout(60.0, connect=20.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        chs = await _get(client, f"{API}/guilds/{gid}/channels", token)
        if chs.status_code != 200:
            _log(f"nuke channels fail {name} {chs.status_code}")
            return mapping
        channels = chs.json() if isinstance(chs.json(), list) else []
        for ch in channels:
            ctype = int(ch.get("type") or 0)
            cid = str(ch.get("id") or "")
            if ctype not in CLONE_TYPES:
                continue
            n, more = await _leftover_fat(client, token, cid)
            if more or n >= CLONE_MIN:
                _log(f"recreate {name} ch={cid} name={ch.get('name')} leftover>={n}")
                new = await _clone_channel(client, token, gid, ch)
                if new:
                    mapping[cid] = new
                await asyncio.sleep(0.5)
        chs2 = await _get(client, f"{API}/guilds/{gid}/channels", token)
        channels = chs2.json() if chs2.status_code == 200 and isinstance(chs2.json(), list) else channels
        ids = await _collect_ids(client, token, channels)
        for cid in ids:
            _log(f"nuke channel {name} ch={cid}")
            await _nuke_channel(client, token, name, cid)
    return mapping


def _write_id_map(mapping: dict[str, str], touched: list[str]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    prev = {}
    if ID_MAP.is_file():
        try:
            prev = json.loads(ID_MAP.read_text(encoding="utf-8"))
        except Exception:
            prev = {}
    channels = dict(prev.get("channels") or {})
    channels.update(mapping)
    ID_MAP.write_text(
        json.dumps(
            {
                "at": datetime.now(timezone.utc).isoformat(),
                "channels": channels,
                "patched_files": touched,
            },
            indent=2,
        ),
        encoding="utf-8",
    )


async def nuke() -> None:
    if not MANIFEST.is_file():
        raise SystemExit("no MANIFEST.json — archive first")
    _acquire_lock()
    try:
        mapping: dict[str, str] = {}
        for name, spec in GUILDS.items():
            mapping.update(await _wipe_guild(name, spec))
            if mapping:
                _write_id_map(mapping, [])
                _log(f"id map checkpoint {name} n={len(mapping)}")
        if mapping:
            for spec in GUILDS.values():
                spec["pins"] = [(mapping.get(cid, cid), label) for cid, label in spec["pins"]]
                spec["home"] = mapping.get(spec["home"], spec["home"])
            touched = _patch_id_map(mapping)
            _write_id_map(mapping, touched)
            _log(f"id map {len(mapping)} channels patched_files={len(touched)}")
        else:
            _write_id_map({}, [])
            _log("id map empty (no recreates)")
    finally:
        _release_lock()


RR_WELCOME = (
    "Welcome to RootRecord.\n\n"
    "We build Kīlauea Alerts, Weather Manager, Business Manager, and the tools around them. "
    "This server is for product support and service.\n\n"
    "Site: https://rootrecord.cloud/\n"
    "Kīlauea app: https://kilauea.cloud/\n"
    "Feedback: https://rootrecord.cloud/feedback\n\n"
    "Be kind. No spam. Staff will help when we can."
)
RR_ABOUT = (
    "RootRecord — software from Hawaiʻi.\n\n"
    "Public door: https://rootrecord.cloud/\n"
    "Status desk: https://rootrecord.cloud/status\n"
    "Kīlauea: https://kilauea.cloud/\n\n"
    "September event unfolding: this server was reset. Old chat is archived on the Root Server."
)
RMC_ABOUT = (
    "RootMC — survival Minecraft.\n\n"
    "Join: play.rootmc.net\n"
    "Site: https://rootmc.net/\n"
    "Talk with Ava: https://avaivy.cloud/\n\n"
    "September event unfolding: channels were reset. Old chat is archived on the Root Server."
)
RMC_RULES = (
    "RootMC rules\n\n"
    "Be respectful. No harassment, hate, or doxxing.\n"
    "Staff may warn, mute, kick, or ban as the situation needs.\n"
    "Appeals: open a thread in the appeals forum.\n"
    "Play: play.rootmc.net · wiki: https://rootmc.net/wiki/\n"
)


def _pin_channel(guild_key: str, label: str, fallback: str) -> str:
    if ID_MAP.is_file():
        try:
            channels = (json.loads(ID_MAP.read_text(encoding="utf-8")) or {}).get("channels") or {}
            if fallback in channels:
                return str(channels[fallback])
        except Exception:
            pass
    for cid, lab in GUILDS[guild_key]["pins"]:
        if lab == label:
            return cid
    return fallback


async def _post_pin(client: httpx.AsyncClient, token: str, channel: str, text: str) -> str:
    r = await _request(
        client,
        "POST",
        f"{API}/channels/{channel}/messages",
        token,
        json={"content": text[:1900], "allowed_mentions": {"parse": []}},
    )
    if r.status_code not in (200, 201):
        _log(f"pin post fail ch={channel} {r.status_code}")
        return ""
    mid = str((r.json() or {}).get("id") or "")
    if mid:
        p = await _request(client, "PUT", f"{API}/channels/{channel}/pins/{mid}", token)
        _log(f"pin ok ch={channel} msg={mid} pin_status={p.status_code}")
    return mid


async def rebuild() -> None:
    timeout = httpx.Timeout(60.0, connect=20.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        rr = _token(tuple(GUILDS["rootrecord"]["token_keys"]))
        ava = _token(tuple(GUILDS["rootmc"]["token_keys"]))
        if rr:
            await _post_pin(
                client, rr, _pin_channel("rootrecord", "welcome", "1497160346358644767"), RR_WELCOME
            )
            await _post_pin(
                client,
                rr,
                _pin_channel("rootrecord", "announcements", "1500286864119038103"),
                RR_ABOUT,
            )
            await _post_pin(
                client,
                rr,
                _pin_channel("rootrecord", "verified-chat", "1497039565461000214"),
                RR_ABOUT,
            )
        if ava:
            await _post_pin(
                client, ava, _pin_channel("rootmc", "rules", "1516392367869919243"), RMC_RULES
            )
            await _post_pin(
                client, ava, _pin_channel("rootmc", "general", "1545284354157187083"), RMC_ABOUT
            )
    _log("rebuild pins done")


def main() -> None:
    cmd = (sys.argv[1] if len(sys.argv) > 1 else "archive").lower()
    if cmd == "archive":
        asyncio.run(archive())
    elif cmd == "nuke":
        asyncio.run(nuke())
    elif cmd == "rebuild":
        asyncio.run(rebuild())
    else:
        raise SystemExit("archive | nuke | rebuild")


if __name__ == "__main__":
    main()

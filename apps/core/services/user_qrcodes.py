"""Generate per-user Solana / 1:1 QR codes. Public keys only — never private keys."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path

from apps.core import config

log = logging.getLogger("ava.user_qrcodes")

AVA_SOLANA = "3euG8kS4Dwvicq2xDwiwQEoDBipBjwyUQxp9CFo2gwtL"
PUBLIC_PROFILE = "https://g.rootrecord.info"
MEMBERSHIPS = "https://rootmc.net/pro/"
WALLETS_PAGE = "https://avaivy.cloud/wallets"


def public_qr_dir() -> Path:
    return config.MEDIA_DIR / "public" / "qrcodes"


def private_users_dir() -> Path:
    return config.MEDIA_DIR / "private" / "users"


def ava_qr_path() -> Path:
    return config.MEDIA_DIR / "images" / "qrcodes" / "ava-solana-main.png"


def slugify(raw: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", str(raw or "").lower()).strip("-")
    return (s[:48] or "member")


def _write_qr_png(path: Path, payload: str, box: int = 12) -> None:
    import qrcode

    path.parent.mkdir(parents=True, exist_ok=True)
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=box, border=2)
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    img.save(path)


def _write_qr_svg(path: Path, payload: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        import qrcode.image.svg as svg

        factory = svg.SvgPathImage
        img = qrcode.make(payload, image_factory=factory, error_correction=qrcode.constants.ERROR_CORRECT_M, border=2)
        img.save(path)
    except Exception:
        path.write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg"><desc>{_xml_esc(payload)}</desc></svg>\n',
            encoding="utf-8",
        )


def _xml_esc(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def write_pair(folder: Path, *, public_payload: str, private_payload: str, meta: dict) -> dict:
    folder.mkdir(parents=True, exist_ok=True)
    pub_png = folder / "qr-public.png"
    pub_svg = folder / "qr-public.svg"
    priv_png = folder / "qr-private.png"
    priv_svg = folder / "qr-private.svg"
    _write_qr_png(pub_png, public_payload)
    _write_qr_svg(pub_svg, public_payload)
    _write_qr_png(priv_png, private_payload)
    _write_qr_svg(priv_svg, private_payload)
    (folder / "qr-public.txt").write_text(public_payload + "\n", encoding="utf-8")
    (folder / "qr-private.txt").write_text(private_payload + "\n", encoding="utf-8")
    meta_out = {
        **meta,
        "public_payload": public_payload,
        "private_payload": private_payload,
        "files": [
            pub_png.name,
            pub_svg.name,
            priv_png.name,
            priv_svg.name,
            "qr-public.txt",
            "qr-private.txt",
        ],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    (folder / "meta.json").write_text(json.dumps(meta_out, indent=2) + "\n", encoding="utf-8")
    return {"folder": str(folder), "public": public_payload, "private": private_payload}


def write_ava_main_qr() -> Path:
    payload = f"solana:{AVA_SOLANA}"
    dest = ava_qr_path()
    _write_qr_png(dest, payload, box=16)
    _write_qr_svg(dest.with_suffix(".svg"), payload)
    dest.with_suffix(".txt").write_text(payload + "\n", encoding="utf-8")
    public_dir = public_qr_dir() / "ava-ivy"
    public_dir.mkdir(parents=True, exist_ok=True)
    _write_qr_png(public_dir / "solana-main.png", payload, box=16)
    _write_qr_svg(public_dir / "solana-main.svg", payload)
    (public_dir / "solana-main.txt").write_text(payload + "\n", encoding="utf-8")
    write_pair(
        private_users_dir() / "ava-ivy",
        public_payload=payload,
        private_payload="ava-1-1:ava-ivy",
        meta={
            "slug": "ava-ivy",
            "label": "Ava Ivy",
            "kind": "ava_main",
            "solana": AVA_SOLANA,
            "wallets": WALLETS_PAGE,
            "memberships": MEMBERSHIPS,
        },
    )
    return dest


def _d1_rows(body: dict) -> list[dict]:
    result = body.get("result") or []
    if not result:
        return []
    first = result[0] if isinstance(result, list) else result
    if not isinstance(first, dict):
        return []
    rows = first.get("results") or first.get("rows") or []
    return [r for r in rows if isinstance(r, dict)]


async def _load_accounts() -> list[dict]:
    from apps.core.services import d1

    db_ids = [
        config.CF_D1_ACCOUNT_DB_ID,
        config.CF_D1_ROOTMC_DB_ID,
        config.CF_D1_HEARTBEAT_DB_ID,
    ]
    sql = (
        "SELECT la.id AS account_id, la.email AS email, iw.pubkey AS custodial_pubkey "
        "FROM license_accounts la "
        "LEFT JOIN internal_solana_wallets iw ON iw.account_id = la.id"
    )
    rows: list[dict] = []
    used_db = ""
    last_err = None
    for db_id in [d for d in db_ids if d]:
        body = await d1.query(db_id, sql)
        if body.get("success"):
            rows = _d1_rows(body)
            used_db = db_id
            break
        last_err = body.get("errors")
    if last_err and not rows:
        log.warning("user qr D1 query failed: %s", last_err)
    linked: dict[str, str] = {}
    if used_db:
        link_body = await d1.query(
            used_db,
            "SELECT account_id, pubkey FROM solana_linked_wallets",
        )
        for r in _d1_rows(link_body):
            aid = str(r.get("account_id") or "").strip()
            pk = str(r.get("pubkey") or "").strip()
            if aid and pk:
                linked[aid] = pk
    if not rows:
        rows = await _load_accounts_mysql()
    if not rows:
        rows = _load_accounts_local()
    out = []
    for r in rows:
        aid = str(r.get("account_id") or "").strip()
        email = str(r.get("email") or "").strip()
        custodial = str(r.get("custodial_pubkey") or r.get("public_pubkey") or "").strip()
        public_pk = linked.get(aid) or custodial
        local = email.split("@")[0] if "@" in email else (email or r.get("slug") or aid[:12])
        slug = slugify(str(r.get("slug") or local or aid))
        out.append(
            {
                "account_id": aid or slug,
                "email": email,
                "slug": slug,
                "custodial_pubkey": custodial,
                "linked_pubkey": linked.get(aid, ""),
                "public_pubkey": public_pk,
            }
        )
    return out


async def _load_accounts_mysql() -> list[dict]:
    from apps.core.services import mysql

    tables = await mysql.query("SHOW TABLES")
    names = {str(v).lower() for row in tables for v in row.values()}
    if "license_accounts" in names:
        return await mysql.query(
            "SELECT id AS account_id, email, NULL AS custodial_pubkey FROM license_accounts"
        )
    return []


def _load_accounts_local() -> list[dict]:
    rows: list[dict] = []
    try:
        from apps.core.services import subscribers
        for s in subscribers.list_all():
            sid = str(s.get("id") or "")
            label = str(s.get("label") or s.get("surface") or "member")
            slug = slugify(f"{s.get('surface')}-{label or sid}")
            rows.append({"account_id": sid, "email": "", "slug": slug, "custodial_pubkey": ""})
    except Exception:
        pass
    grok = config.MEDIA_DIR / "private" / "accounts" / "AIConversations" / "grok"
    if grok.is_dir():
        for p in grok.iterdir():
            if p.is_dir() and "@" in p.name:
                rows.append({
                    "account_id": p.name,
                    "email": p.name,
                    "slug": slugify(p.name.split("@")[0]),
                    "custodial_pubkey": "",
                })
    return rows


def _save_user(row: dict) -> dict:
    slug = row["slug"]
    aid = row["account_id"] or slug
    pk = row.get("public_pubkey") or ""
    public_payload = f"solana:{pk}" if pk else f"{PUBLIC_PROFILE}/memberships"
    private_payload = f"ava-1-1:{aid}"
    folder = private_users_dir() / slug
    meta = {
        "slug": slug,
        "account_id": aid,
        "email": row.get("email") or "",
        "solana_public": pk,
        "custodial_pubkey": row.get("custodial_pubkey") or "",
        "linked_pubkey": row.get("linked_pubkey") or "",
        "kind": "member",
    }
    written = write_pair(folder, public_payload=public_payload, private_payload=private_payload, meta=meta)
    pub = public_qr_dir() / slug
    pub.mkdir(parents=True, exist_ok=True)
    _write_qr_png(pub / "qr-public.png", public_payload)
    _write_qr_svg(pub / "qr-public.svg", public_payload)
    (pub / "qr-public.txt").write_text(public_payload + "\n", encoding="utf-8")
    written["public_copy"] = str(pub)
    return written


async def backfill() -> dict:
    ava = str(write_ava_main_qr())
    accounts = await _load_accounts()
    written = []
    for row in accounts:
        try:
            written.append(_save_user(row))
        except Exception as e:
            log.warning("qr backfill failed slug=%s: %s", row.get("slug"), e)
    manifest = {
        "ok": True,
        "ava_qr": ava,
        "users": len(written),
        "private_root": str(private_users_dir()),
        "public_root": str(public_qr_dir()),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    private_users_dir().mkdir(parents=True, exist_ok=True)
    (private_users_dir() / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return {**manifest, "sample": written[:5]}

#!/usr/bin/env python3
"""One-time: copy BlueMap R2 tiles maps/world/ -> maps/world-old/ (archive)."""
from __future__ import annotations

import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

WORKERS = int(os.environ.get("R2_COPY_WORKERS", "32"))


def load_env(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def main() -> int:
    repo = Path(__file__).resolve().parents[2]
    for candidate in (
        repo / "RootMC Workspace" / "Plugin Building" / "Minecraft" / ".env",
        repo / "credentials.env",
    ):
        load_env(candidate)

    account = os.environ.get("ROOTMC_CLOUDFLARE_ACCOUNT_ID") or os.environ.get(
        "CLOUDFLARE_ACCOUNT_ID", "f3372b30093435bacc35b69972abeb2e"
    )
    key_id = os.environ.get("R2_ACCESS_KEY_ID")
    secret = os.environ.get("R2_SECRET_ACCESS_KEY")
    if not key_id or not secret:
        print("Missing R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY", file=sys.stderr)
        return 1

    bucket = os.environ.get("R2_BUCKET", "rootmc-bluemap")
    src_prefix = "maps/world/"
    dest_prefix = "maps/world-old/"

    cfg = Config(max_pool_connections=max(WORKERS + 4, 36))
    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=key_id,
        aws_secret_access_key=secret,
        region_name="auto",
        config=cfg,
    )

    paginator = s3.get_paginator("list_objects_v2")
    keys: list[str] = []
    existing: set[str] = set()
    for page in paginator.paginate(Bucket=bucket, Prefix=dest_prefix):
        for obj in page.get("Contents", []):
            existing.add(obj["Key"])
    for page in paginator.paginate(Bucket=bucket, Prefix=src_prefix):
        for obj in page.get("Contents", []):
            src_key = obj["Key"]
            dest_key = dest_prefix + src_key[len(src_prefix) :]
            if dest_key not in existing:
                keys.append(src_key)

    total = len(keys)
    print(
        f"Copying {total} object(s) s3://{bucket}/{src_prefix} -> "
        f"s3://{bucket}/{dest_prefix} ({WORKERS} workers)",
        flush=True,
    )

    copied = 0
    skipped = 0
    errors = 0
    started = time.time()

    def copy_one(src_key: str) -> str:
        dest_key = dest_prefix + src_key[len(src_prefix) :]
        try:
            s3.copy_object(
                Bucket=bucket,
                Key=dest_key,
                CopySource={"Bucket": bucket, "Key": src_key},
            )
            return "ok"
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in ("404", "NoSuchKey"):
                return "skip"
            raise

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(copy_one, k): k for k in keys}
        for fut in as_completed(futures):
            try:
                result = fut.result()
                if result == "skip":
                    skipped += 1
                else:
                    copied += 1
            except ClientError as exc:
                errors += 1
                print(f"ERROR {futures[fut]}: {exc}", file=sys.stderr, flush=True)
            done = copied + skipped + errors
            if done % 2000 == 0 or done == total:
                elapsed = time.time() - started
                rate = done / elapsed if elapsed else 0
                print(
                    f"  {done}/{total} ({rate:.0f}/s, {errors} errors)",
                    flush=True,
                )

    elapsed = time.time() - started
    print(
        f"Done: {copied} copied, {skipped} skipped, {errors} errors in {elapsed:.0f}s"
    )
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())

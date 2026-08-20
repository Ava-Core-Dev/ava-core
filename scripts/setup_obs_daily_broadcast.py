#!/usr/bin/env python3
"""Create the Ava Daily Broadcast OBS collection and switch to Main."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from apps.core.services.obs_studio import setup_daily_broadcast  # noqa: E402


async def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--start-stream",
        action="store_true",
        help="Also call OBS StartStream (off by default; OBS_AUTO_STREAM=0)",
    )
    args = p.parse_args()
    result = await setup_daily_broadcast(start_stream=args.start_stream)
    print(json.dumps(result, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

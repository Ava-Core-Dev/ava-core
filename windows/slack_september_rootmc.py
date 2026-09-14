"""One dual post of RootMC rules/about into Slack. No deletes."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

for envp in (ROOT / ".env", ROOT / "credentials.env", Path.home() / "ava" / "credentials.env"):
    if envp.is_file():
        load_dotenv(envp, override=False)

from datetime import datetime, timezone

from apps.core import config
from apps.core.services import slack
from windows.discord_september import RMC_ABOUT, RMC_RULES

LOG = ROOT / "data" / "logs" / "slack-september-rootmc.log"
MARKER = "September event unfolding"


def _log(line: str) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with LOG.open("a", encoding="utf-8") as fh:
        fh.write(f"{stamp} {line}\n")
    print(line)


async def _already_has(cid: str) -> bool:
    for msg in await slack.history(cid, limit=40):
        text = msg.get("text") or ""
        if MARKER in text and "RootMC rules" in text:
            return True
    return False


async def main() -> None:
    probe = await slack.auth_test()
    if not probe.get("ok"):
        _log(f"skip auth.error={probe.get('error')}")
        return
    _log(f"auth.ok team={probe.get('team')} user={probe.get('user')}")
    text = RMC_RULES + "\n\n" + RMC_ABOUT
    for key in ("dev", "plans"):
        cid = config.SLACK_CHANNELS.get(key) or ""
        if not cid:
            continue
        if await _already_has(cid):
            _log(f"{key} already_present channel={cid}")
            continue
        r = await slack.post_message(cid, text)
        if r.get("ok"):
            _log(f"{key} posted channel={cid} ts={r.get('ts')}")
        else:
            _log(f"{key} failed channel={cid} error={r.get('error')}")


if __name__ == "__main__":
    asyncio.run(main())

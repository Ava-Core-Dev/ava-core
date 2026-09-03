"""Once-on-boot identity import. Same job as since_last_fire.account_import."""

from __future__ import annotations

from apps.core.crons.since_last_fire.account_import import run

__all__ = ["run"]

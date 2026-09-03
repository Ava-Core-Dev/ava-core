"""Cron jobs in always_on / since_last_fire / on_time (backup cronologicals method)."""

from importlib import import_module

_PACKAGES = ("always_on", "since_last_fire", "on_time")


def __getattr__(name: str):
    last = None
    for pkg in _PACKAGES:
        try:
            return import_module(f"apps.core.crons.{pkg}.{name}")
        except ModuleNotFoundError as exc:
            last = exc
    raise AttributeError(name) from last

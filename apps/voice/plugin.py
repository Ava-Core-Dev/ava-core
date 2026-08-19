"""Plugin base class and registry."""

from __future__ import annotations

import importlib.util
import logging
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

log = logging.getLogger("ava.plugin")


class Plugin(ABC):
    """Base class every Ava plugin must inherit."""

    name: str = "unnamed"
    version: str = "0.0.0"
    description: str = ""

    def __init__(self, core: Any = None):
        self.core = core  # reference back to AvaCore instance

    def on_load(self) -> None:
        """Called once when the plugin is registered."""
        pass

    def on_unload(self) -> None:
        """Called when the plugin is removed / core shuts down."""
        pass

    @abstractmethod
    def run(self, **kwargs) -> Any:
        """Main entry point. Called by core or scheduler."""
        raise NotImplementedError

    def on_new_report(self, path: Path) -> None:
        """Optional: called when a new report file appears."""
        pass

    def on_hour(self) -> None:
        """Optional: called at the top of every hour."""
        pass


class PluginRegistry:
    def __init__(self):
        self._plugins: dict[str, Plugin] = {}

    def register(self, plugin: Plugin) -> None:
        if plugin.name in self._plugins:
            log.warning("Plugin %s already registered – replacing", plugin.name)
        self._plugins[plugin.name] = plugin
        plugin.on_load()
        log.info("Registered plugin: %s v%s", plugin.name, plugin.version)

    def get(self, name: str) -> Plugin | None:
        return self._plugins.get(name)

    def all(self) -> list[Plugin]:
        return list(self._plugins.values())

    def run(self, name: str, **kwargs) -> Any:
        p = self.get(name)
        if not p:
            raise KeyError(f"Plugin not found: {name}")
        return p.run(**kwargs)

    def notify_new_report(self, path: Path) -> None:
        for p in self._plugins.values():
            try:
                p.on_new_report(path)
            except Exception as e:
                log.exception("Plugin %s on_new_report failed: %s", p.name, e)

    def notify_hour(self) -> None:
        for p in self._plugins.values():
            try:
                p.on_hour()
            except Exception as e:
                log.exception("Plugin %s on_hour failed: %s", p.name, e)

    def load_from_dir(self, directory: Path, core: Any = None) -> int:
        """Import every *.py file in directory that defines a Plugin subclass."""
        count = 0
        if not directory.exists():
            return 0
        for path in sorted(directory.glob("*.py")):
            if path.name.startswith("_"):
                continue
            try:
                spec = importlib.util.spec_from_file_location(path.stem, path)
                if not spec or not spec.loader:
                    continue
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                for attr in dir(mod):
                    obj = getattr(mod, attr)
                    if (
                        isinstance(obj, type)
                        and issubclass(obj, Plugin)
                        and obj is not Plugin
                    ):
                        instance = obj(core=core)
                        self.register(instance)
                        count += 1
            except Exception as e:
                log.exception("Failed to load plugin from %s: %s", path, e)
        return count

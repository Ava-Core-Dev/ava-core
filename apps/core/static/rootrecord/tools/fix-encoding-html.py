"""Normalize corrupted punctuation in static HTML to HTML entities (UTF-8)."""
from __future__ import annotations

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]

REPLACEMENTS: list[tuple[bytes, bytes]] = [
    (
        b"\xc3\x83\xc2\xa2\xc3\xa2\xe2\x80\x9a\xc2\xac\xc3\xa2\xe2\x82\xac\xc2\x9d",
        b"&mdash;",
    ),
    (
        b"\xc3\x83\xc2\xa2\xc3\xa2\xe2\x80\x9a\xc2\xac\xc3\xa2\xe2\x82\xac\xc5\x93",
        b"&ndash;",
    ),
    (b"\xc3\x83\xe2\x80\x9a\xc3\x82\xc2\xb7", b"&middot;"),
    (b"\xc3\x83\xe2\x80\x9a\xc3\x82\xc2\xa9", b"&copy;"),
    (
        b"\xc3\x83\xc2\xa2\xc3\xa2\xe2\x82\xac\xc2\xa0\xc3\x82\xc2\x90 ",
        b"&larr; ",
    ),
    (
        b"\xc3\x83\xc2\xa2\xc3\xa2\xe2\x82\xac\xc2\xa0\xc3\xa2\xe2\x82\xac\xe2\x84\xa2 ",
        b"&rarr; ",
    ),
    (
        b"\xc3\x83\xc2\xa2\xc3\xa2\xe2\x80\x9a\xc2\xac\xc3\x82\xc2\xa6",
        b"&hellip;",
    ),
    (b"\xc3\xa2\xe2\x82\xac\xe2\x80\x9d", b"&mdash;"),
    (b"\xc3\xa2\xe2\x82\xac\xc2\xa6", b"&hellip;"),
    (b"\xc3\x82\xc2\xa9", b"&copy;"),
    (b"\xc3\x82\xc2\xb7", b"&middot;"),
]


def scrub_icon_divs(raw: bytes) -> bytes:
    def repl(m: re.Match[bytes]) -> bytes:
        inner = m.group(2)
        if not inner or inner.strip() == b"":
            return m.group(0)
        if inner in (b"R", b"$", b"!") or max(inner) > 127:
            return m.group(1) + b'<span aria-hidden="true">&#9679;</span>' + m.group(3)
        return m.group(0)

    return re.sub(
        rb'(<div class="(?:feature-icon|hero-badge-icon)">)([^<]*)(</div>)',
        repl,
        raw,
    )


def fix_file(path: pathlib.Path) -> bool:
    raw = path.read_bytes()
    orig = raw
    for bad, good in REPLACEMENTS:
        raw = raw.replace(bad, good)
    raw = scrub_icon_divs(raw)
    raw = raw.replace(b"\xc2\x9d", b"")
    if raw == orig:
        return False
    path.write_bytes(raw)
    return True


def main() -> None:
    fixed = []
    for path in sorted(ROOT.glob("*.html")):
        if fix_file(path):
            fixed.append(path.name)
    print("Updated:", ", ".join(fixed) if fixed else "(none)")


if __name__ == "__main__":
    main()

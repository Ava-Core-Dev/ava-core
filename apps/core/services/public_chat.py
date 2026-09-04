"""Public Ava Ivy replies — short talk first. Links only when they ask where to go.

Greetings are not canned — they go to the local model on this host.
"""

from __future__ import annotations

import re

LINKS = {
    "home": "https://avaivy.cloud",
    "status": "https://avaivy.cloud/status",
    "media": "https://avaivy.cloud/media",
    "goals": "https://avaivy.cloud/status/goals",
    "wallets": "https://avaivy.cloud/wallets",
    "blog": "https://avaivy.cloud/blog",
    "context": "https://avaivy.cloud/context",
    "login": "https://avaivy.cloud/login",
    "rootmc": "https://rootmc.net",
    "wiki": "https://rootmc.net/wiki/player/",
    "mc_blog": "https://rootmc.net/blog/",
    "pro": "https://rootmc.net/pro/",
    "mc_login": "https://rootmc.net/login/",
    "discord": "https://discord.gg/rFFQYrNaqS",
    "play": "play.rootmc.net",
    "record": "https://rootrecord.cloud",
    "g": "https://rootrecord.cloud",
    "github": "https://github.com/Ava-Core-Dev",
}

GREETING = "I'm Ava Ivy. Ask about the host, weather, packs, Kīlauea, or RootMC."

_GREET_ONLY = {
    "hi",
    "hey",
    "hello",
    "aloha",
    "yo",
    "gm",
    "good morning",
    "good night",
    "howdy",
    "sup",
}

TOPICS: list[tuple[str, tuple[str, ...], str]] = [
    (
        "thanks",
        ("thanks", "thank you", "mahalo", "ty"),
        "Anytime.",
    ),
    (
        "who",
        ("who are you", "what are you", "who is ava", "ava ivy", "your name", "introduce"),
        "I'm Ava Ivy. I run the solar host, Kīlauea, and weather on the Big Island. "
        "RootMC is the Minecraft world when you want that.",
    ),
    (
        "login",
        ("login", "log in", "sign in", "signin", "account", "register", "sign up", "password"),
        "Yes — log in with your RootMC web account (Discord). Same login unlocks this panel. "
        f"Start at {LINKS['mc_login']} · this page is {LINKS['login']}. "
        "Public answers here stay free. A live custom talk uses that account "
        "(one free live turn per IP, then canned stays unlimited).",
    ),
    (
        "rootmc",
        ("rootmc", "minecraft", "survival", "gold", "claims", "towny", "votes", "server"),
        "RootMC is survival Minecraft — closed-loop Gold, land, votes, the whole journey. "
        f"Join at {LINKS['play']}. Site + wiki: {LINKS['rootmc']} · player guide: {LINKS['wiki']} · "
        f"Minecraft updates: {LINKS['mc_blog']} · Discord: {LINKS['discord']}. "
        f"I am not the game world. Real-life solar sits on {LINKS['record']}.",
    ),
    (
        "join",
        ("how to join", "how do i join", "ip", "address", "play.rootmc", "connect"),
        f"Java edition → server address {LINKS['play']}. That's the only join host. "
        f"Fresh? {LINKS['wiki']} walks Gold, claims, and linking your account. "
        f"Crew hangs in Discord: {LINKS['discord']}.",
    ),
    (
        "discord",
        ("discord", "community", "chat discord"),
        f"Player Discord is {LINKS['discord']}. I keep that side quiet except the morning boot note in #updates. "
        f"This panel ({LINKS['home']}) is where I talk in public on the web.",
    ),
    (
        "solar",
        ("solar", "battery", "panel", "power", "ecoflow", "host", "uptime", "offline", "night"),
        "I run on the HI Pacific Solar Root Server — panels and a battery bank on the Big Island. "
        "At night I may go quiet if the bank is thin. I won't invent a kWh number.",
    ),
    (
        "kilauea",
        ("kilauea", "kīlauea", "volcano", "lava", "erupt"),
        "Kīlauea is real Hawaiʻi — USGS-style activity on the Root Record desk. "
        "I don't invent alert levels.",
    ),
    (
        "weather",
        ("weather", "noaa", "rain", "forecast", "hilo", "big island"),
        "NOAA / Big Island weather is on the Root Record desk. "
        "Public label is HI Pacific Solar Root Server — I don't publish a street or town.",
    ),
    (
        "rootrecord",
        ("root record", "rootrecord", "data center", "dashboard", "real life", "real-world"),
        "Root Record is the real-world side: solar, volcano, weather, business ops, goals. "
        f"Live dashboard: {LINKS['record']} · funding board: {LINKS['g']}. "
        f"Minecraft stays at {LINKS['rootmc']}. I'm the runtime that ties them: {LINKS['home']}.",
    ),
    (
        "goals",
        ("goal", "wishlist", "donate", "funding", "stripe"),
        "Goals are ranked public records — hardware and ops we actually want, not invented totals. "
        f"Ava's list: {LINKS['goals']} · community board: {LINKS['g']}. "
        "Card links are masked on those pages. I won't paste raw checkout URLs in chat.",
    ),
    (
        "wallets",
        ("wallet", "solana", "sol", "usdc", "crypto", "address"),
        f"Official Ava Core Wallets — a QR for each network, public keys only, no seeds: {LINKS['wallets']}. "
        "Don't send player Gold there. Helpers for public goals use Ava allocation / earned income.",
    ),
    (
        "media",
        ("media", "index", "download", "audio", "video", "report", "catalog"),
        f"Public media library is {LINKS['media']} — reports, audio, video, brand. "
        "1:1 DMs and private life-story stay off that list. Downloads need the host up.",
    ),
    (
        "context",
        ("context", "ops", "what do you know"),
        f"Live ops context (refreshed about every minute when I'm up): {LINKS['context']}. "
        f"If that page says night mode, check {LINKS['status']} too.",
    ),
    (
        "status",
        ("status", "cpu", "ram", "online", "are you up"),
        f"Host pulse is {LINKS['status']}. Solar + Minecraft player counts live on {LINKS['record']}. "
        "If I'm dark, that's usually night on the battery — not a crash drama.",
    ),
    (
        "blog",
        ("blog", "updates", "news", "changelog"),
        f"Three streams, on purpose: me ({LINKS['blog']}), Minecraft ({LINKS['mc_blog']}), "
        f"real-world/business ({LINKS['record']}/blog). Discord players only get the morning boot note.",
    ),
    (
        "pro",
        ("pro", "member", "subscribe", "membership", "lifetime"),
        f"RootMC Pro is support + voice, not pay-to-win. Perks and checkout: {LINKS['pro']}. "
        "That's the only link I give for membership — no raw Stripe URLs.",
    ),
    (
        "github",
        ("github", "source", "code", "repo", "opensource"),
        f"Public org: {LINKS['github']}. I don't dump secrets or private media from chat.",
    ),
]


def _norm(text: str) -> str:
    t = text.lower().strip()
    t = t.replace("/login", "login").replace("/status", "status")
    t = re.sub(r"[^\w\s./-]+", " ", t, flags=re.UNICODE)
    return re.sub(r"\s+", " ", t).strip()


def match_public_reply(message: str) -> dict | None:
    raw = (message or "").strip()
    if raw.startswith("__generic:"):
        key = raw.split(":", 1)[-1].strip().lower()
        alias = {
            "rootmc": "rootmc",
            "solar": "solar",
            "kilauea": "kilauea",
            "host": "solar",
        }
        want = alias.get(key, key)
        for tid, _keys, reply in TOPICS:
            if tid == want:
                return {"reply": reply, "brain": "canned", "topic": tid, "generic": True}
        fallback = next(r for tid, _k, r in TOPICS if tid == "solar")
        return {"reply": fallback, "brain": "canned", "topic": "solar", "generic": True}

    q = _norm(raw)
    if not q:
        return {"reply": GREETING, "brain": "canned", "topic": "greet"}
    if q in _GREET_ONLY:
        return {"reply": GREETING, "brain": "canned", "topic": "greet"}

    best: tuple[int, str, str] | None = None
    for tid, keys, reply in TOPICS:
        score = 0
        for k in keys:
            if k == q or f" {k} " in f" {q} " or q.startswith(k + " ") or q.endswith(" " + k):
                score += 3 if len(k) > 4 else 2
            elif k in q:
                score += 2 if len(k) > 3 else 1
        if score > 0 and (best is None or score > best[0]):
            best = (score, tid, reply)

    if best and best[0] >= 2:
        return {"reply": best[2], "brain": "canned", "topic": best[1]}
    return None


def directory_reply() -> str:
    return (
        "Ask about solar, the host, Kīlauea, or weather. RootMC if you want the game. "
        f"Live board: {LINKS['record']}."
    )

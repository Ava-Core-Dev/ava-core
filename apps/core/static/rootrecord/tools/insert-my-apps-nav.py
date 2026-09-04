import pathlib

root = pathlib.Path(__file__).resolve().parents[1]
old = '<a href="/billing.html" role="menuitem"'
new = (
    '<a href="/my-apps.html" role="menuitem">My Apps</a>\n'
    '                <a href="/billing.html" role="menuitem"'
)
for p in sorted(root.glob("*.html")):
    t = p.read_text(encoding="utf-8")
    if 'id="nav-account-panel"' not in t or "/my-apps.html" in t:
        continue
    if old not in t:
        print("skip", p.name)
        continue
    t2 = t.replace(old, new, 1)
    if t2 != t:
        p.write_text(t2, encoding="utf-8")
        print("nav", p.name)

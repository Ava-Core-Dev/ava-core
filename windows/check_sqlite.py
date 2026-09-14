import sqlite3
from pathlib import Path

for p in (
    Path.home() / "RootRecord Core Ops" / "Ecoflow" / "ecoflow-10s.db",
    Path(r"C:\Users\rootr\Ava\Data\system\system.db"),
):
    print(p, p.exists(), p.stat().st_size if p.exists() else 0)
    if p.exists():
        c = sqlite3.connect(str(p))
        print([r[0] for r in c.execute("select name from sqlite_master where type='table'")])
        c.close()

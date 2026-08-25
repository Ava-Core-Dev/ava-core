from pathlib import Path
from datetime import datetime, timezone
import json, sqlite3, re

SAFE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")

class SessionStore:
    def __init__(self, root="/home/ava-core/data/context/users"):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _db(self, user_id):
        if not SAFE.fullmatch(user_id):
            raise ValueError("invalid user_id")
        return self.root / f"{user_id}.db"

    def init_user(self, user_id):
        db = self._db(user_id)
        with sqlite3.connect(db) as c:
            c.execute("""CREATE TABLE IF NOT EXISTS sessions(
                session_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                provider TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                title TEXT
            )""")
            c.execute("""CREATE TABLE IF NOT EXISTS events(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                ts TEXT NOT NULL,
                role TEXT NOT NULL,
                event_type TEXT NOT NULL,
                content TEXT,
                metadata TEXT
            )""")
        return db

    def create_session(self, user_id, session_id, provider="", title=""):
        self.init_user(user_id)
        now = datetime.now(timezone.utc).isoformat()
        with sqlite3.connect(self._db(user_id)) as c:
            c.execute("INSERT INTO sessions VALUES(?,?,?,?,?,?)",
                      (session_id,user_id,provider,now,now,title))
        self.append_event(user_id, session_id, "system", "session_created",
                          "Session created", {"provider": provider, "title": title})

    def append_event(self, user_id, session_id, role, event_type, content, metadata=None):
        self.init_user(user_id)
        now = datetime.now(timezone.utc).isoformat()
        with sqlite3.connect(self._db(user_id)) as c:
            c.execute("""INSERT INTO events(session_id,ts,role,event_type,content,metadata)
                         VALUES(?,?,?,?,?,?)""",
                      (session_id,now,role,event_type,content,
                       json.dumps(metadata or {}, ensure_ascii=False)))
            c.execute("UPDATE sessions SET updated_at=? WHERE session_id=?",
                      (now,session_id))
        return self.current(user_id, session_id)

    def current(self, user_id, session_id):
        self.init_user(user_id)
        with sqlite3.connect(self._db(user_id)) as c:
            rows = c.execute("""SELECT ts,role,event_type,content,metadata
                                FROM events WHERE session_id=? ORDER BY id""",
                             (session_id,)).fetchall()
        events = [{"ts":r[0],"role":r[1],"event_type":r[2],
                   "content":r[3],"metadata":json.loads(r[4] or "{}")} for r in rows]
        return {"user_id":user_id,"session_id":session_id,"events":events,
                "event_count":len(events),
                "latest": events[-1] if events else None}

    def list_sessions(self, user_id):
        self.init_user(user_id)
        with sqlite3.connect(self._db(user_id)) as c:
            rows = c.execute("""SELECT session_id,provider,created_at,updated_at,title
                                FROM sessions ORDER BY updated_at DESC""").fetchall()
        return [{"session_id":r[0],"provider":r[1],"created_at":r[2],
                 "updated_at":r[3],"title":r[4]} for r in rows]

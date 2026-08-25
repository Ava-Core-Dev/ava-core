from .store import SessionStore

def create_app(root="/home/ava-core/data/context/users"):
    try:
        from fastapi import FastAPI, HTTPException
    except ImportError as e:
        raise RuntimeError("FastAPI is required by the optional API adapter") from e

    app = FastAPI(title="Ava Ivy Context Session API")
    store = SessionStore(root)

    @app.get("/health")
    def health():
        return {"ok": True, "service": "context-session-builder"}

    @app.post("/users/{user_id}/sessions/{session_id}")
    def create(user_id, session_id, provider="", title=""):
        store.create_session(user_id, session_id, provider, title)
        return store.current(user_id, session_id)

    @app.post("/users/{user_id}/sessions/{session_id}/events")
    def event(user_id, session_id, role, event_type, content, metadata=None):
        try:
            return store.append_event(user_id, session_id, role, event_type, content, metadata)
        except ValueError as e:
            raise HTTPException(400, str(e))

    @app.get("/users/{user_id}/sessions")
    def sessions(user_id):
        return {"user_id":user_id,"sessions":store.list_sessions(user_id)}

    @app.get("/users/{user_id}/sessions/{session_id}")
    def current(user_id, session_id):
        return store.current(user_id, session_id)

    return app

from fastapi import FastAPI

app = FastAPI()


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "rootrecord-static-site"}

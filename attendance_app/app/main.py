"""FastAPI app: API + WebSocket + the static web pages."""
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .api import classes, sessions, system
from .db import init_db
from .services import storage

WEB_DIR = Path(__file__).resolve().parent.parent / "web"

app = FastAPI(title="ระบบเช็คชื่อด้วยใบหน้า", docs_url="/api/docs")


@app.on_event("startup")
def startup():
    init_db()
    from .vision.pipeline import get_pipeline
    get_pipeline()                      # load the models once at start, not on the first request


app.include_router(classes.router)
app.include_router(sessions.router)
app.include_router(system.router)
app.mount("/media", StaticFiles(directory=storage.MEDIA), name="media")
app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")

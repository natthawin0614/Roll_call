"""Settings page, model status, data deletion and the anti-spoof feedback dataset."""
import shutil
import zipfile

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session as DB

from ..config import EDITABLE, config
from ..db import Attendance, EventLog, Section, get_db
from ..services import matcher, storage

router = APIRouter(prefix="/api")


@router.get("/settings")
def get_settings():
    from ..vision.pipeline import get_pipeline
    providers = get_pipeline().providers
    return {"values": config.editable(),
            "defaults": {s: {k: config.defaults[s][k] for k in keys} for s, keys in EDITABLE.items()},
            "device": "GPU" if providers[0] != "CPUExecutionProvider" else "CPU", "providers": providers,
            "models": {k: v["path"] for k, v in config["models"].items() if isinstance(v, dict)},
            "camera": config["camera"]}


@router.put("/settings")
def save_settings(body: dict):
    try:
        config.save_overrides(body)
    except (TypeError, ValueError) as e:
        raise HTTPException(400, f"ค่าไม่ถูกต้อง: {e}")
    matcher._cache.clear()
    return get_settings()


@router.post("/settings/reset")
def reset_settings():
    config.reset_overrides()
    matcher._cache.clear()
    return get_settings()


class WipeIn(BaseModel):
    confirm: str


@router.post("/data/wipe")
def wipe_all(body: WipeIn, db: DB = Depends(get_db)):
    """Delete every class, student, photo, session and evidence image."""
    if body.confirm != "ลบทั้งหมด":
        raise HTTPException(400, "พิมพ์คำว่า ลบทั้งหมด เพื่อยืนยัน")
    for s in db.query(Section).all():
        db.delete(s)
    db.commit()
    for sub in ("students", "sessions"):
        storage.delete_folder(sub)
    shutil.rmtree(storage.EXPORTS, ignore_errors=True)
    storage.EXPORTS.mkdir(exist_ok=True)
    matcher._cache.clear()
    return {"ok": True}


@router.get("/feedback/export")
def export_feedback(db: DB = Depends(get_db)):
    """Zip of live / spoof face crops collected in class, in the folder layout of notebook 2
    (my_test/live, my_test/spoof/<type>) -> use it to test or fine-tune the anti-spoof model."""
    out = storage.EXPORTS / "antispoof_feedback.zip"
    count = {"live": 0, "spoof": 0}
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:
        for r in db.query(Attendance).filter(Attendance.snapshot_path.isnot(None)):
            if r.method in ("auto", "confirmed") and (storage.MEDIA / r.snapshot_path).exists():
                z.write(storage.MEDIA / r.snapshot_path, f"my_test/live/s{r.session_id}_{r.id}.jpg")
                count["live"] += 1
        for e in db.query(EventLog).filter_by(kind="spoof"):
            if e.image_path and (storage.MEDIA / e.image_path).exists() and e.reviewed:
                folder = "live" if e.reviewed == "live" else "spoof/class"
                z.write(storage.MEDIA / e.image_path, f"my_test/{folder}/e{e.id}.jpg")
                count["live" if e.reviewed == "live" else "spoof"] += 1
    if not count["live"] and not count["spoof"]:
        raise HTTPException(404, "ยังไม่มีภาพที่เก็บจากการเช็คชื่อ")
    return FileResponse(out, filename=out.name, media_type="application/zip")

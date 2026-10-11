"""Class sessions: start, live camera (WebSocket), manual check-in, close, Excel, history."""
import asyncio
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session as DB
from starlette.concurrency import run_in_threadpool

from ..db import Attendance, ClassSession, EventLog, Section, Student, get_db
from ..services import attendance, live, report, storage
from .classes import get_or_404

router = APIRouter()

EVENT_TH = report.EVENT_TH


class StartIn(BaseModel):
    start: str | None = None          # "HH:MM" (today) – default: the section's usual start time
    late_minutes: int | None = None


def session_json(db, s):
    rows = attendance.roster(db, s)
    return {"id": s.id, "section_id": s.section_id,
            "section": {"course_code": s.section_obj.course_code, "course_name": s.section_obj.course_name,
                        "section": s.section_obj.section, "term": s.section_obj.term},
            "scheduled_start": s.scheduled_start.strftime("%Y-%m-%d %H:%M"),
            "date": s.scheduled_start.strftime("%d/%m/%Y"), "start": s.scheduled_start.strftime("%H:%M"),
            "late_minutes": s.late_minutes,
            "opened_at": s.opened_at.strftime("%H:%M"), "closed_at": s.closed_at.strftime("%H:%M") if s.closed_at else None,
            "roster": rows, "summary": attendance.summary(rows),
            "events": db.query(EventLog).filter_by(session_id=s.id).count()}


@router.post("/api/sections/{section_id}/sessions")
def start_session(section_id: int, body: StartIn, db: DB = Depends(get_db)):
    section = get_or_404(db, Section, section_id)
    start = None
    if body.start:
        hh, mm = body.start.split(":")
        start = datetime.now().replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
    s = attendance.open_session(db, section, start, body.late_minutes)
    return session_json(db, s)


@router.get("/api/sections/{section_id}/sessions")
def history(section_id: int, db: DB = Depends(get_db)):
    get_or_404(db, Section, section_id)
    sessions = (db.query(ClassSession).filter_by(section_id=section_id)
                .order_by(ClassSession.scheduled_start.desc()).all())
    out = []
    for s in sessions:
        rows = attendance.roster(db, s)
        out.append({"id": s.id, "date": s.scheduled_start.strftime("%d/%m/%Y"),
                    "start": s.scheduled_start.strftime("%H:%M"), "closed": s.closed_at is not None,
                    "closed_at": s.closed_at.strftime("%H:%M") if s.closed_at else None,
                    "summary": attendance.summary(rows),
                    "spoof": db.query(EventLog).filter_by(session_id=s.id, kind="spoof").count(),
                    "confirm": db.query(EventLog).filter_by(session_id=s.id, kind="confirm").count()})
    return out


@router.get("/api/sessions/{session_id}")
def get_session(session_id: int, db: DB = Depends(get_db)):
    return session_json(db, get_or_404(db, ClassSession, session_id))


class TimeIn(BaseModel):
    start: str
    late_minutes: int


@router.put("/api/sessions/{session_id}")
def update_session_time(session_id: int, body: TimeIn, db: DB = Depends(get_db)):
    s = get_or_404(db, ClassSession, session_id)
    hh, mm = body.start.split(":")
    s.scheduled_start = s.scheduled_start.replace(hour=int(hh), minute=int(mm))
    s.late_minutes = body.late_minutes
    db.commit()
    return session_json(db, s)


class ManualIn(BaseModel):
    student_id: int
    action: str            # add | remove


@router.post("/api/sessions/{session_id}/manual")
def manual(session_id: int, body: ManualIn, db: DB = Depends(get_db)):
    s = get_or_404(db, ClassSession, session_id)
    get_or_404(db, Student, body.student_id)
    if body.action == "add":
        attendance.check_in(db, s, body.student_id, method="manual")
        attendance.log_event(db, s.id, "manual_add", body.student_id)
    else:
        record = attendance.find_record(db, s.id, body.student_id)
        if record:
            db.delete(record)
            db.commit()
            attendance.log_event(db, s.id, "manual_remove", body.student_id)
    return session_json(db, s)


@router.post("/api/sessions/{session_id}/close")
def close(session_id: int, db: DB = Depends(get_db)):
    s = get_or_404(db, ClassSession, session_id)
    attendance.close_session(db, s)
    live.drop_live(s.id)
    path = report.build_excel(db, s)
    return {**session_json(db, s), "excel": f"/api/sessions/{s.id}/excel", "file": path.name}


@router.get("/api/sessions/{session_id}/excel")
def excel(session_id: int, db: DB = Depends(get_db)):
    s = get_or_404(db, ClassSession, session_id)
    path = report.build_excel(db, s)
    return FileResponse(path, filename=path.name,
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@router.delete("/api/sessions/{session_id}")
def delete_session(session_id: int, db: DB = Depends(get_db)):
    s = get_or_404(db, ClassSession, session_id)
    storage.delete_folder(f"sessions/{s.id}")
    live.drop_live(s.id)
    db.delete(s)
    db.commit()
    return {"ok": True}


@router.get("/api/sessions/{session_id}/events")
def events(session_id: int, db: DB = Depends(get_db)):
    get_or_404(db, ClassSession, session_id)
    out = []
    for e in db.query(EventLog).filter_by(session_id=session_id).order_by(EventLog.at.desc()):
        detail = json.loads(e.detail or "{}")
        full = e.image_path.replace(".jpg", "_full.jpg") if e.kind == "spoof" and e.image_path else None
        out.append({"id": e.id, "at": e.at.strftime("%H:%M:%S"), "kind": e.kind, "kind_th": EVENT_TH.get(e.kind, e.kind),
                    "student": e.student.name if e.student else None, "detail": detail,
                    "image": storage.media_url(e.image_path), "full": storage.media_url(full), "reviewed": e.reviewed})
    return out


class ReviewIn(BaseModel):
    verdict: str           # live (false alarm) | spoof


@router.post("/api/events/{event_id}/review")
def review(event_id: int, body: ReviewIn, db: DB = Depends(get_db)):
    e = get_or_404(db, EventLog, event_id)
    e.reviewed = body.verdict
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- live camera
@router.websocket("/ws/live/{session_id}")
async def live_ws(ws: WebSocket, session_id: int):
    await ws.accept()
    state = live.get_live(session_id)
    try:
        while True:
            message = await ws.receive()
            if message.get("type") == "websocket.disconnect":
                break
            if message.get("bytes"):
                frame = live.decode_frame(message["bytes"])
                if frame is None:
                    await ws.send_json({"type": "error", "message": "ภาพจากกล้องเสีย"})
                    continue
                result = await run_in_threadpool(state.process, frame)
                await ws.send_json(result)
            elif message.get("text"):
                data = json.loads(message["text"])
                if data.get("type") == "verify":
                    result = await run_in_threadpool(state.answer, data["request_id"], data.get("student_id"),
                                                     bool(data.get("add_reference")))
                    await ws.send_json({"type": "verified", **result})
    except (WebSocketDisconnect, RuntimeError, asyncio.CancelledError):
        pass

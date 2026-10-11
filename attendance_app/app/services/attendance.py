"""Class sessions: open / close, check-in records, roster and status (มา / สาย / ขาด)."""
import json
from datetime import datetime, timedelta

from ..db import Attendance, ClassSession, EventLog, Student, now
from . import storage

STATUS_TH = {"present": "มา", "late": "สาย", "absent": "ขาด"}
METHOD_TH = {"auto": "อัตโนมัติ", "manual": "อาจารย์เช็คเอง", "confirmed": "อาจารย์ยืนยันตัวตน"}


def open_session(db, section, scheduled_start=None, late_minutes=None):
    if scheduled_start is None:
        hh, mm = (section.start_time or "09:00").split(":")
        scheduled_start = datetime.now().replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
    session = ClassSession(section_id=section.id, scheduled_start=scheduled_start,
                           late_minutes=section.late_minutes if late_minutes is None else late_minutes)
    db.add(session)
    db.commit()
    return session


def find_record(db, session_id, student_id):
    return db.query(Attendance).filter_by(session_id=session_id, student_id=student_id).first()


def check_in(db, session, student_id, method="auto", similarity=None, spoof_score=None, flagged=False,
             snapshot=None):
    """Create the record once; a second check-in of the same student returns the existing one."""
    record = find_record(db, session.id, student_id)
    if record:
        return record, False
    record = Attendance(session_id=session.id, student_id=student_id, method=method, similarity=similarity,
                        spoof_score=spoof_score, flagged=flagged, snapshot_path=snapshot)
    db.add(record)
    db.commit()
    return record, True


def log_event(db, session_id, kind, student_id=None, detail=None, image_path=None):
    db.add(EventLog(session_id=session_id, kind=kind, student_id=student_id,
                    detail=json.dumps(detail or {}, ensure_ascii=False), image_path=image_path))
    db.commit()


def status_of(session, record):
    if record is None:
        return "absent"
    deadline = session.scheduled_start + timedelta(minutes=session.late_minutes)
    return "late" if record.checked_at > deadline else "present"


def roster(db, session):
    """Every student of the class with their check-in state, sorted by code then name."""
    records = {r.student_id: r for r in db.query(Attendance).filter_by(session_id=session.id)}
    students = db.query(Student).filter_by(section_id=session.section_id).all()
    students.sort(key=lambda s: (s.student_code or "~", s.name))
    rows = []
    for s in students:
        r = records.get(s.id)
        status = status_of(session, r)
        rows.append({
            "student_id": s.id, "code": s.student_code, "name": s.name, "risk": s.risk_group,
            "photo": storage.media_url(s.photos[0].face_path) if s.photos else None,
            "status": status, "status_th": STATUS_TH[status],
            "checked_at": r.checked_at.strftime("%H:%M:%S") if r else None,
            "method": r.method if r else None, "method_th": METHOD_TH.get(r.method) if r else None,
            "similarity": round(r.similarity, 3) if r and r.similarity is not None else None,
            "flagged": bool(r and r.flagged),
            "snapshot": storage.media_url(r.snapshot_path) if r else None,
        })
    return rows


def summary(rows):
    counts = {"present": 0, "late": 0, "absent": 0}
    for r in rows:
        counts[r["status"]] += 1
    counts["total"] = len(rows)
    return counts


def close_session(db, session):
    if session.closed_at is None:
        session.closed_at = now()
        db.commit()
    return session

"""Sections (classes), students, photos, folder import and look-alike tools."""
import json
from pathlib import Path

import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session as DB

from ..config import config
from ..db import ClassSession, FacePhoto, Section, Student, get_db, now
from ..services import enroll, matcher, storage

router = APIRouter(prefix="/api")


def get_or_404(db, model, item_id):
    item = db.get(model, item_id)
    if item is None:
        raise HTTPException(404, "ไม่พบข้อมูล")
    return item


# ---------------------------------------------------------------- sections
class SectionIn(BaseModel):
    course_code: str = ""
    course_name: str
    section: str = ""
    term: str = ""
    start_time: str = "09:00"
    late_minutes: int | None = None


def section_json(s, db):
    sessions = db.query(ClassSession).filter_by(section_id=s.id).order_by(ClassSession.opened_at.desc()).all()
    open_session = next((x for x in sessions if x.closed_at is None), None)
    return {"id": s.id, "course_code": s.course_code, "course_name": s.course_name, "section": s.section,
            "term": s.term, "start_time": s.start_time, "late_minutes": s.late_minutes,
            "students": len(s.students), "photos": sum(len(st.photos) for st in s.students),
            "risk": sum(st.risk_group for st in s.students),
            "missing_photos": sum(not st.photos for st in s.students),
            "sessions": len(sessions),
            "last_session": sessions[0].scheduled_start.strftime("%d/%m/%Y %H:%M") if sessions else None,
            "open_session": open_session.id if open_session else None}


@router.get("/sections")
def list_sections(db: DB = Depends(get_db)):
    return [section_json(s, db) for s in db.query(Section).order_by(Section.created_at.desc()).all()]


@router.post("/sections")
def create_section(body: SectionIn, db: DB = Depends(get_db)):
    data = body.model_dump()
    if data["late_minutes"] is None:
        data["late_minutes"] = config["attendance"]["late_minutes"]
    s = Section(**data)
    db.add(s)
    db.commit()
    return section_json(s, db)


@router.get("/sections/{section_id}")
def get_section(section_id: int, db: DB = Depends(get_db)):
    return section_json(get_or_404(db, Section, section_id), db)


@router.put("/sections/{section_id}")
def update_section(section_id: int, body: SectionIn, db: DB = Depends(get_db)):
    s = get_or_404(db, Section, section_id)
    for key, value in body.model_dump().items():
        if value is not None:
            setattr(s, key, value)
    db.commit()
    return section_json(s, db)


@router.delete("/sections/{section_id}")
def delete_section(section_id: int, db: DB = Depends(get_db)):
    s = get_or_404(db, Section, section_id)
    storage.delete_folder(f"students/{s.id}")
    for session in s.sessions:
        storage.delete_folder(f"sessions/{session.id}")
    db.delete(s)
    db.commit()
    matcher.invalidate(section_id)
    return {"ok": True}


# ---------------------------------------------------------------- students
class StudentIn(BaseModel):
    student_code: str = ""
    name: str
    risk_group: bool | None = None


def student_json(st, lookalikes=None, names=None):
    return {"id": st.id, "student_code": st.student_code, "name": st.name, "risk_group": st.risk_group,
            "risk_manual": st.risk_manual,
            "consent_at": st.consent_at.strftime("%d/%m/%Y %H:%M") if st.consent_at else None,
            "photos": [{"id": p.id, "url": storage.media_url(p.face_path), "full": storage.media_url(p.image_path),
                        "warnings": json.loads(p.warnings or "[]"), "source": p.source} for p in st.photos],
            "lookalikes": [{"id": i, "name": names.get(i, "?"), "similarity": round(sim, 3)}
                           for i, sim in (lookalikes or [])]}


@router.get("/sections/{section_id}/students")
def list_students(section_id: int, db: DB = Depends(get_db)):
    s = get_or_404(db, Section, section_id)
    names = {st.id: st.name for st in s.students}
    threshold = config["enroll"]["similar_warn"]
    look = {}
    for a, b, sim in matcher.similar_pairs(section_id):
        if sim >= threshold:
            look.setdefault(a, []).append((b, sim))
            look.setdefault(b, []).append((a, sim))
    students = sorted(s.students, key=lambda st: (st.student_code or "~", st.name))
    return [student_json(st, look.get(st.id), names) for st in students]


@router.post("/sections/{section_id}/students")
def create_student(section_id: int, body: StudentIn, db: DB = Depends(get_db)):
    get_or_404(db, Section, section_id)
    st = Student(section_id=section_id, student_code=body.student_code.strip(), name=body.name.strip())
    db.add(st)
    db.commit()
    return student_json(st)


@router.put("/students/{student_id}")
def update_student(student_id: int, body: StudentIn, db: DB = Depends(get_db)):
    st = get_or_404(db, Student, student_id)
    st.student_code, st.name = body.student_code.strip(), body.name.strip()
    if body.risk_group is not None and body.risk_group != st.risk_group:
        st.risk_group, st.risk_manual = body.risk_group, True
    db.commit()
    matcher.invalidate(st.section_id)
    return student_json(st)


@router.delete("/students/{student_id}")
def delete_student(student_id: int, db: DB = Depends(get_db)):
    st = get_or_404(db, Student, student_id)
    section_id = st.section_id
    enroll.delete_student(db, st)
    enroll.refresh_risk_groups(db, section_id)
    return {"ok": True}


@router.post("/students/{student_id}/photos")
async def upload_photos(student_id: int, consent: bool = Form(False), files: list[UploadFile] = File(...),
                        db: DB = Depends(get_db)):
    st = get_or_404(db, Student, student_id)
    if not consent:
        raise HTTPException(400, "ต้องยืนยันว่าได้รับความยินยอมจากนักศึกษาก่อน")
    results = []
    for f in files:
        result = enroll.add_photo(db, st, await f.read())
        results.append({"file": f.filename, **result})
    pairs = enroll.refresh_risk_groups(db, st.section_id)
    names = {x.id: x.name for x in db.query(Student).filter_by(section_id=st.section_id)}
    lookalikes = [{"name": names[b if a == st.id else a], "similarity": round(sim, 3)}
                  for a, b, sim in pairs if st.id in (a, b)]
    return {"results": results, "lookalikes": lookalikes}


@router.post("/photos/check")
async def check_photo(consent: bool = Form(False), file: UploadFile = File(...)):
    """Preview only: detect the face and check quality without saving anything."""
    if not consent:
        raise HTTPException(400, "ต้องยืนยันว่าได้รับความยินยอมจากนักศึกษาก่อน")
    return enroll.check_photo(await file.read())


@router.delete("/photos/{photo_id}")
def delete_photo(photo_id: int, db: DB = Depends(get_db)):
    photo = get_or_404(db, FacePhoto, photo_id)
    section_id = photo.student.section_id
    enroll.delete_photo(db, photo)
    enroll.refresh_risk_groups(db, section_id)
    return {"ok": True}


@router.post("/sections/{section_id}/bulk")
async def bulk_upload(section_id: int, consent: bool = Form(False), files: list[UploadFile] = File(...),
                      db: DB = Depends(get_db)):
    """Drag & drop many photos at once: the file name is the student (same rules as folder import)."""
    s = get_or_404(db, Section, section_id)
    if not consent:
        raise HTTPException(400, "ต้องยืนยันว่าได้รับความยินยอมจากนักศึกษาก่อน")
    existing = {st.name: st for st in s.students}
    created = []
    report = {"students": [], "problems": []}
    for f in files:
        code, name = enroll.parse_name(Path(f.filename).stem)
        st = existing.get(name)
        if st is None:
            st = Student(section_id=s.id, name=name, student_code=code)
            db.add(st)
            db.commit()
            existing[name] = st
            created.append(st)
        result = enroll.add_photo(db, st, await f.read(), source="upload")
        if not result["ok"] or result["warnings"]:
            report["problems"].append({"file": f.filename,
                                       "message": result["message"] if not result["ok"] else " · ".join(result["warnings"])})
        if result["ok"]:
            report["students"].append({"name": name, "file": f.filename})
    for st in created:                 # new students whose photos all failed
        db.refresh(st)
        if not st.photos:
            db.delete(st)
    db.commit()
    report["lookalikes"] = len(enroll.refresh_risk_groups(db, s.id))
    return report


# ---------------------------------------------------------------- folder import
class ImportIn(BaseModel):
    folder: str = ""
    skip: list[str] = []
    consent: bool = False


@router.get("/import/preview")
def import_preview(folder: str = ""):
    path = Path(folder) if folder else config.path(config["paths"]["import_dir"])
    if not path.is_dir():
        raise HTTPException(400, f"ไม่พบโฟลเดอร์: {path}")
    layout, groups = enroll.scan_folder(path)
    ignored = [d.name for d in path.iterdir() if d.is_dir()] if layout == "files" else []
    return {"folder": str(path), "layout": layout, "ignored_folders": ignored,
            "layout_th": "แยกโฟลเดอร์ย่อยต่อคน (ชื่อโฟลเดอร์ = ชื่อนักศึกษา)" if layout == "subfolders"
            else "ไฟล์รวมในโฟลเดอร์เดียว (ชื่อไฟล์ = ชื่อนักศึกษา, 'ชื่อ(1).jpg' = รูปเพิ่มของคนเดิม)",
            "students": [{"code": c, "name": n, "files": [p.name for p in ps]} for (c, n), ps in groups.items()]}


@router.post("/sections/{section_id}/import")
def import_folder(section_id: int, body: ImportIn, db: DB = Depends(get_db)):
    s = get_or_404(db, Section, section_id)
    if not body.consent:
        raise HTTPException(400, "ต้องยืนยันว่าได้รับความยินยอมจากนักศึกษาก่อน")
    path = Path(body.folder) if body.folder else config.path(config["paths"]["import_dir"])
    if not path.is_dir():
        raise HTTPException(400, f"ไม่พบโฟลเดอร์: {path}")
    return enroll.import_folder(db, s, path, skip_names=set(body.skip))


# ---------------------------------------------------------------- look-alike tools
@router.get("/sections/{section_id}/similarity")
def similarity(section_id: int, db: DB = Depends(get_db)):
    s = get_or_404(db, Section, section_id)
    gallery = matcher.get_gallery(section_id)
    people = [p for p in gallery.people if len(p.vectors)]
    people.sort(key=lambda p: (p.code or "~", p.name))
    n = len(people)
    matrix = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            matrix[i, j] = 1.0 if i == j else float((people[i].vectors @ people[j].vectors.T).max())
    photos = {st.id: [storage.media_url(p.face_path) for p in st.photos] for st in s.students}
    pairs = matcher.similar_pairs(section_id, limit=15)
    by_id = {p.id: p for p in people}
    return {
        "threshold": config["enroll"]["similar_warn"],
        "people": [{"id": p.id, "name": p.name, "risk": p.risk, "photo": p.photo_url, "count": len(p.vectors)}
                   for p in people],
        "matrix": np.round(matrix, 3).tolist(),
        "pairs": [{"a": {"id": a, "name": by_id[a].name, "risk": by_id[a].risk, "photos": photos.get(a, [])[:5]},
                   "b": {"id": b, "name": by_id[b].name, "risk": by_id[b].risk, "photos": photos.get(b, [])[:5]},
                   "similarity": round(sim, 3)} for a, b, sim in pairs],
    }


@router.post("/sections/{section_id}/risk/refresh")
def refresh_risk(section_id: int, db: DB = Depends(get_db)):
    get_or_404(db, Section, section_id)
    pairs = enroll.refresh_risk_groups(db, section_id)
    return {"pairs": len(pairs)}


@router.post("/sections/{section_id}/reembed")
def reembed(section_id: int, db: DB = Depends(get_db)):
    """Recompute every embedding from the stored photos (after changing the embedding model)."""
    from ..vision.pipeline import get_pipeline
    s = get_or_404(db, Section, section_id)
    redone, failed = 0, 0
    for st in s.students:
        for photo in st.photos:
            image = storage.read_jpg(photo.image_path)
            faces = get_pipeline().analyze(image) if image is not None else []
            if faces:
                photo.embedding = faces[0].embedding.astype(np.float32).tobytes()
                redone += 1
            else:
                failed += 1
    db.commit()
    matcher.invalidate(section_id)
    enroll.refresh_risk_groups(db, section_id)
    return {"redone": redone, "failed": failed, "at": now().isoformat()}

"""Add students and their reference photos (same pipeline as the live camera)."""
import json
import re
from pathlib import Path

import numpy as np

from ..config import config
from ..db import FacePhoto, Student, now
from ..vision.pipeline import get_pipeline, quality_warnings, read_image
from . import matcher, storage

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def add_photo(db, student, image_bytes, source="upload"):
    """Detect the face, check quality, store the photo + embedding.
    Returns {"ok": bool, "message": str, "warnings": [...], "photo_id": int}."""
    image = read_image(image_bytes)
    if image is None:
        return {"ok": False, "message": "เปิดไฟล์รูปไม่ได้", "warnings": []}
    if len(student.photos) >= config["enroll"]["max_photos"]:
        return {"ok": False, "message": f"มีรูปครบ {config['enroll']['max_photos']} รูปแล้ว", "warnings": []}

    faces = get_pipeline().analyze(image)
    if not faces:
        return {"ok": False, "message": "หาหน้าในรูปไม่เจอ", "warnings": []}
    face = faces[0]                       # largest face
    warnings = quality_warnings(face.quality)
    if len(faces) > 1:
        warnings.append(f"เจอ {len(faces)} หน้า ใช้หน้าที่ใหญ่ที่สุด")

    folder = f"students/{student.section_id}/{student.id}"
    photo = FacePhoto(student_id=student.id, source=source,
                      image_path=storage.save_jpg(image, folder, max_side=1280),
                      face_path=storage.save_jpg(face.aligned, folder, quality=95),
                      embedding=face.embedding.astype(np.float32).tobytes(),
                      quality=json.dumps(face.quality), warnings=json.dumps(warnings, ensure_ascii=False))
    db.add(photo)
    if student.consent_at is None:
        student.consent_at = now()
    db.commit()
    matcher.invalidate(student.section_id)
    return {"ok": True, "message": "เพิ่มรูปแล้ว", "warnings": warnings, "photo_id": photo.id,
            "url": storage.media_url(photo.face_path)}


def check_photo(image_bytes):
    """Same checks as add_photo, but nothing is stored: lets the page show the result before the teacher saves.
    Returns {"ok", "message", "warnings", "face": data-URL of the aligned face}."""
    import base64
    import cv2
    image = read_image(image_bytes)
    if image is None:
        return {"ok": False, "message": "เปิดไฟล์รูปไม่ได้", "warnings": []}
    faces = get_pipeline().analyze(image)
    if not faces:
        return {"ok": False, "message": "หาหน้าในรูปไม่เจอ", "warnings": []}
    warnings = quality_warnings(faces[0].quality)
    if len(faces) > 1:
        warnings.append(f"เจอ {len(faces)} หน้า ใช้หน้าที่ใหญ่ที่สุด")
    ok, buf = cv2.imencode(".jpg", faces[0].aligned, [cv2.IMWRITE_JPEG_QUALITY, 85])
    face = "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode() if ok else None
    return {"ok": True, "message": "ผ่าน", "warnings": warnings, "face": face}


def add_face_from_live(db, student, aligned_face, crop_bgr):
    """Teacher confirmed this live face -> keep it as an extra reference (better twin separation)."""
    vector = get_pipeline().embedder.embed([aligned_face])[0]
    folder = f"students/{student.section_id}/{student.id}"
    db.add(FacePhoto(student_id=student.id, source="confirmed",
                     image_path=storage.save_jpg(crop_bgr, folder),
                     face_path=storage.save_jpg(aligned_face, folder, quality=95),
                     embedding=vector.astype(np.float32).tobytes(), quality="{}", warnings="[]"))
    db.commit()
    matcher.invalidate(student.section_id)


def delete_photo(db, photo):
    section_id = photo.student.section_id
    storage.delete_file(photo.image_path)
    storage.delete_file(photo.face_path)
    db.delete(photo)
    db.commit()
    matcher.invalidate(section_id)


def delete_student(db, student):
    section_id = student.section_id
    storage.delete_folder(f"students/{section_id}/{student.id}")
    db.delete(student)
    db.commit()
    matcher.invalidate(section_id)


def refresh_risk_groups(db, section_id):
    """Put every pair above enroll.similar_warn in the risk group (teacher's manual choices are kept).
    Returns the list of look-alike pairs."""
    threshold = config["enroll"]["similar_warn"]
    pairs = [p for p in matcher.similar_pairs(section_id) if p[2] >= threshold]
    flagged = {i for a, b, _ in pairs for i in (a, b)}
    for s in db.query(Student).filter_by(section_id=section_id).all():
        if not s.risk_manual:
            s.risk_group = s.id in flagged
    db.commit()
    matcher.invalidate(section_id)
    return pairs


def lookalikes_of(section_id, student_id):
    threshold = config["enroll"]["similar_warn"]
    return [(b if a == student_id else a, sim) for a, b, sim in matcher.similar_pairs(section_id)
            if student_id in (a, b) and sim >= threshold]


# ---------------------------------------------------------------- folder import
def parse_name(stem):
    """'6501234_สมชาย' -> ('6501234', 'สมชาย');  'อะตอม(1)' -> ('', 'อะตอม')."""
    stem = re.sub(r"\s*[\(\[]\d+[\)\]]$|[_\- ]\d{1,2}$", "", stem.strip())
    match = re.match(r"^(\d{5,})[\s_\-]+(.+)$", stem)
    if match:
        return match.group(1), match.group(2).strip()
    return "", stem


def scan_folder(folder):
    """Group images by student.
    - sub-folders: folder name = student, every image inside = that student's photos
    - flat folder: file name = student; 'name(1).jpg' / 'name_2.jpg' are extra photos of 'name'
    Loose photos win: if the folder has any, sub-folders (e.g. "test set") are ignored.
    Returns (layout, {(code, name): [paths]})."""
    folder = Path(folder)
    subdirs = [d for d in folder.iterdir() if d.is_dir()]
    loose = [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXT]
    groups = {}
    if subdirs and not loose:
        layout = "subfolders"
        for d in sorted(subdirs):
            files = sorted(p for p in d.iterdir() if p.suffix.lower() in IMAGE_EXT)
            if files:
                groups.setdefault(parse_name(d.name), []).extend(files)
    else:
        layout = "files"
        for p in sorted(folder.iterdir()):
            if p.suffix.lower() in IMAGE_EXT:
                groups.setdefault(parse_name(p.stem), []).append(p)
    return layout, groups


def import_folder(db, section, folder, skip_names=()):
    """Create students from a folder; returns a report for the teacher."""
    layout, groups = scan_folder(folder)
    existing = {s.name: s for s in section.students}
    report = {"layout": layout, "students": [], "problems": []}
    for (code, name), paths in groups.items():
        if name in skip_names:
            report["problems"].append({"file": ", ".join(p.name for p in paths), "message": "ข้ามตามที่เลือก"})
            continue
        student = existing.get(name)
        if student is None:
            student = Student(section_id=section.id, name=name, student_code=code)
            db.add(student)
            db.commit()
        added = 0
        for p in paths:
            result = add_photo(db, student, p.read_bytes(), source="import")
            if result["ok"]:
                added += 1
                if result["warnings"]:
                    report["problems"].append({"file": p.name, "message": " · ".join(result["warnings"])})
            else:
                report["problems"].append({"file": p.name, "message": result["message"]})
        if added == 0 and not student.photos:
            db.delete(student)
            db.commit()
            continue
        report["students"].append({"name": name, "code": code, "photos": added,
                                   "files": [p.name for p in paths]})
    report["lookalikes"] = len(refresh_risk_groups(db, section.id))
    return report

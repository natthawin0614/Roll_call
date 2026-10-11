"""Real-time check-in from camera frames.

Each face is followed across frames (a "track", matched by box overlap + same-looking face).
Liveness (is it a real person?) is decided once per track, in 3 layers:
  1. device   YOLO26n finds a phone / screen / printed photo around the face -> spoof
  2. texture  P(spoof) from ConvNeXt, averaged over `average_frames` good frames:
              <= live_below -> live, >= spoof_above -> spoof, in between -> layer 3
  3. challenge "turn your head left / right" (random); a flat photo or screen cannot do it.
              Done within the time limit -> live; failed `challenge_tries` times -> spoof
Only faces that look at the camera are judged ("quality gate"); otherwise the person is told what to fix.
A live track is checked in when it matches the SAME student for `confirm_frames` good frames in a row.
Undecided identity (twins / look-alikes) for `ambiguous_frames` frames -> the teacher is asked in a popup.
"""
import base64
import itertools
import random
import time
import uuid
from collections import Counter, deque

import cv2
import numpy as np

from ..config import config
from ..db import ClassSession, SessionLocal, Student
from ..vision.pipeline import get_pipeline, live_quality_issue
from . import attendance, enroll, matcher, storage

TRACK_TIMEOUT_SEC = 2.0
_track_ids = itertools.count(1)

SPOOF_REASON_TH = {"device": "พบมือถือ/จอ/รูปพิมพ์รอบใบหน้า", "texture": "ภาพมีลักษณะของภาพถ่าย/หน้าจอ",
                   "challenge": "หันหน้าตามคำสั่งไม่ได้"}


def iou(a, b):
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def to_jpg_b64(image_bgr, quality=85):
    ok, buffer = cv2.imencode(".jpg", image_bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return "data:image/jpeg;base64," + base64.b64encode(buffer).decode()


class Track:
    def __init__(self, box):
        self.id = next(_track_ids)
        self.box = box
        self.embedding = None                 # last face embedding (to notice a different person)
        self.last_seen = time.time()
        self.history = deque(maxlen=30)       # (status, student_id) of good frames
        self.spoof_scores = deque(maxlen=30)  # P(spoof) of good frames
        self.device_streak = 0
        self.liveness = None                  # None (deciding) | "live" | "spoof"
        self.spoof_reason = None
        self.challenge = None                 # {"dir", "start", "base", "turned", "progress"}
        self.challenge_fails = 0
        self.checked_student = None           # student checked in (or recognised as already checked)
        self.asked = False                    # verification popup already sent
        self.last_evidence = 0.0


class LiveSession:
    """State of one open class session (shared by every browser tab showing it)."""

    def __init__(self, session_id):
        self.session_id = session_id
        self.tracks = []
        self.pending = {}           # request_id -> data kept until the teacher answers the popup

    # ------------------------------------------------------------ frame processing
    def process(self, frame_bgr):
        cfg_a, cfg_s = config["attendance"], config["antispoof"]
        mode = cfg_s["mode"]
        db = SessionLocal()
        try:
            session = db.get(ClassSession, self.session_id)
            if session is None or session.closed_at is not None:
                return {"type": "closed"}
            gallery = matcher.get_gallery(session.section_id)
            faces = get_pipeline().analyze(frame_bgr, min_face_px=cfg_a["min_face_px"],
                                           devices=mode != "off" and cfg_s["device_check"])
            tracks = self._assign(faces)

            results, events, roster_changed = [], [], False
            for face, track in zip(faces, tracks):
                issue = live_quality_issue(face, frame_bgr.shape)
                decision = gallery.identify(face.embedding)
                if not issue and track.challenge is None:
                    track.history.append((decision.status, decision.student_id))
                    track.spoof_scores.append(face.spoof_score)
                self._update_liveness(track, face, issue, mode)
                person = gallery.by_id.get(decision.student_id) if decision.student_id else None

                out = {"box": [round(v) for v in face.box], "track": track.id,
                       "similarity": round(decision.similarity, 3), "spoof": round(face.spoof_score, 3),
                       "device": round(face.device_score, 3), "name": person.name if person else None, "progress": 0}
                if face.device_box and face.device_score >= cfg_s["device_conf"]:
                    out["device_box"] = [round(v) for v in face.device_box]
                n = cfg_a["confirm_frames"]
                recent = list(track.history)[-n:]
                same_person = (len(recent) == n and all(s == "match" for s, _ in recent)
                               and len({sid for _, sid in recent}) == 1)
                already = (decision.student_id is not None and decision.status == "match"
                           and attendance.find_record(db, session.id, decision.student_id) is not None)

                if track.liveness == "spoof" and mode == "block":
                    out["status"], out["reason"] = "spoof", SPOOF_REASON_TH.get(track.spoof_reason, "")
                    if time.time() - track.last_evidence > cfg_a["evidence_cooldown_sec"]:
                        track.last_evidence = time.time()
                        self._save_spoof(db, session, frame_bgr, face, decision, track.spoof_reason)
                        events.append({"kind": "spoof", "name": out["name"], "reason": out["reason"]})
                elif already:
                    out["status"] = "already"
                    track.checked_student = decision.student_id
                elif track.checked_student is not None and track.checked_student in gallery.by_id:
                    # this face was already resolved (e.g. the teacher confirmed it in the popup)
                    out["status"] = "already"
                    out["name"] = gallery.by_id[track.checked_student].name
                elif track.challenge is not None:
                    c = track.challenge
                    out["status"] = "challenge"
                    out["challenge"] = {"dir": c["dir"], "progress": round(c["progress"], 2), "turned": c["turned"],
                                        "remaining": round(max(0.0, cfg_s["challenge_timeout_sec"] - (time.time() - c["start"])), 1),
                                        "try": track.challenge_fails + 1}
                elif issue:
                    out["status"], out["hint"] = "adjust", issue
                elif track.liveness is None:
                    out["status"] = "checking"
                    out["progress"] = round(0.5 * len(track.spoof_scores) / cfg_s["average_frames"], 2)
                elif same_person:
                    record, created = attendance.check_in(
                        db, session, decision.student_id, "auto", decision.similarity, self._mean_spoof(track),
                        flagged=track.liveness == "spoof" or track.challenge_fails > 0,
                        snapshot=self._snapshot(frame_bgr, face, session.id))
                    out["status"] = "success" if created else "already"
                    track.checked_student = decision.student_id
                    if created:
                        roster_changed = True
                        events.append({"kind": "checked", "name": out["name"],
                                       "late": attendance.status_of(session, record) == "late"})
                elif decision.status == "ambiguous":
                    out["status"] = "ambiguous"
                    window = list(track.history)[-cfg_a["ambiguous_frames"]:]
                    undecided = sum(s == "ambiguous" for s, _ in window)
                    if (not track.asked and track.checked_student is None
                            and len(window) == cfg_a["ambiguous_frames"] and undecided >= 0.6 * len(window)):
                        track.asked = True
                        events.append(self._ask_teacher(db, session, frame_bgr, face, track, gallery))
                elif decision.status in ("unknown", "empty"):
                    out["status"] = "unknown"
                else:
                    out["status"] = "checking"
                    agree = Counter(sid for s, sid in recent if s == "match").get(decision.student_id, 0)
                    out["progress"] = round(0.5 + 0.5 * agree / n, 2)
                if out["status"] in ("ambiguous", "unknown"):
                    out["name"] = None if out["status"] == "unknown" else out["name"]
                results.append(out)
            return {"type": "result", "faces": results, "events": events, "roster_changed": roster_changed}
        finally:
            db.close()

    # ------------------------------------------------------------ liveness (3 layers)
    @staticmethod
    def _mean_spoof(track):
        n = config["antispoof"]["average_frames"]
        scores = list(track.spoof_scores)[-n:]
        return float(np.mean(scores)) if scores else None

    def _update_liveness(self, track, face, issue, mode):
        s = config["antispoof"]
        if mode == "off":
            track.liveness = "live"
            return
        # layer 1: phone / screen / print around the face (checked every frame, even after "live")
        if s["device_check"] and face.device_score >= s["device_conf"]:
            track.device_streak += 1
            if track.device_streak >= config["attendance"]["spoof_frames"]:
                track.liveness, track.spoof_reason, track.challenge = "spoof", "device", None
                return
        else:
            track.device_streak = 0
        if track.liveness is not None:
            return
        # layer 3 in progress
        if track.challenge is not None:
            self._update_challenge(track, face)
            return
        # layer 2: averaged P(spoof) over good frames
        if issue or len(track.spoof_scores) < s["average_frames"]:
            return
        mean = self._mean_spoof(track)
        if mean <= s["live_below"]:
            track.liveness = "live"
        elif mean >= s["spoof_above"]:
            track.liveness, track.spoof_reason = "spoof", "texture"
        elif s["challenge"]:
            self._start_challenge(track, face)
        else:
            track.liveness = "live" if mean < (s["live_below"] + s["spoof_above"]) / 2 else "spoof"
            track.spoof_reason = "texture"

    @staticmethod
    def _start_challenge(track, face, direction=None):
        """Ask for a head turn. 'left' = the student's own left = the nose moves to the right of the raw
        (un-mirrored) camera image = yaw grows."""
        direction = direction or random.choice(["left", "right"])
        track.challenge = {"dir": direction, "start": time.time(), "base": face.quality.get("yaw", 0.0),
                           "turned": False, "progress": 0.0}

    def _update_challenge(self, track, face):
        s, c = config["antispoof"], track.challenge
        yaw = face.quality.get("yaw")
        if yaw is not None:
            moved = (yaw - c["base"]) * (1 if c["dir"] == "left" else -1)
            c["progress"] = float(np.clip(moved / s["challenge_yaw"], 0, 1))
            if moved >= s["challenge_yaw"]:
                c["turned"] = True
            elif c["turned"] and abs(yaw) <= config["attendance"]["max_yaw"]:
                # turned and came back to the camera -> a real 3-D head
                track.liveness, track.challenge = "live", None
                track.history.clear()            # identify again on fresh frontal frames
                return
        if time.time() - c["start"] > s["challenge_timeout_sec"]:
            track.challenge_fails += 1
            if track.challenge_fails >= s["challenge_tries"]:
                track.liveness, track.spoof_reason, track.challenge = "spoof", "challenge", None
            else:
                self._start_challenge(track, face, "right" if c["dir"] == "left" else "left")

    def _assign(self, faces):
        """Match faces to existing tracks by box overlap AND same-looking face (so the next
        student standing at the same spot starts a new track); create tracks for new faces."""
        now_t = time.time()
        self.tracks = [t for t in self.tracks if now_t - t.last_seen < TRACK_TIMEOUT_SEC]
        free = list(self.tracks)
        assigned = []
        for face in faces:
            best = max(free, key=lambda t: iou(t.box, face.box), default=None)
            same_person = best is not None and (best.embedding is None or float(best.embedding @ face.embedding) > 0.3)
            if best is not None and iou(best.box, face.box) > 0.3 and same_person:
                free.remove(best)
            else:
                best = Track(face.box)
                self.tracks.append(best)
            best.box, best.last_seen, best.embedding = face.box, now_t, face.embedding
            assigned.append(best)
        return assigned

    # ------------------------------------------------------------ evidence / snapshots
    def _crop(self, frame_bgr, face):
        return get_pipeline().antispoof.crop(frame_bgr, face.box)

    def _snapshot(self, frame_bgr, face, session_id):
        return storage.save_jpg(self._crop(frame_bgr, face), f"sessions/{session_id}/checkin")

    def _save_spoof(self, db, session, frame_bgr, face, decision, reason):
        path = storage.save_jpg(self._crop(frame_bgr, face), f"sessions/{session.id}/spoof")
        full = frame_bgr.copy()
        if face.device_box:
            x1, y1, x2, y2 = (int(v) for v in face.device_box)
            cv2.rectangle(full, (x1, y1), (x2, y2), (60, 60, 230), 3)
        storage.save_jpg(full, f"sessions/{session.id}/spoof", name=path.split("/")[-1].replace(".jpg", "_full.jpg"),
                         max_side=1280, quality=80)
        attendance.log_event(db, session.id, "spoof", decision.student_id,
                             {"spoof_score": round(face.spoof_score, 3), "similarity": round(decision.similarity, 3),
                              "device_score": round(face.device_score, 3), "reason": reason,
                              "reason_th": SPOOF_REASON_TH.get(reason, "")},
                             image_path=path)

    def _ask_teacher(self, db, session, frame_bgr, face, track, gallery):
        request_id = uuid.uuid4().hex[:10]
        crop = self._crop(frame_bgr, face)
        self.pending[request_id] = {"aligned": face.aligned.copy(), "crop": crop, "track": track.id,
                                    "candidates": [], "spoof": face.spoof_score}
        candidates = []
        for sid, sim in gallery.identify(face.embedding).candidates:
            p = gallery.by_id[sid]
            student = db.get(Student, sid)
            candidates.append({"student_id": sid, "name": p.name, "code": p.code, "similarity": round(sim, 3),
                               "risk": p.risk, "photos": [storage.media_url(ph.face_path) for ph in student.photos[:4]],
                               "already": attendance.find_record(db, session.id, sid) is not None})
        self.pending[request_id]["candidates"] = candidates
        return {"kind": "verify", "request_id": request_id, "live": to_jpg_b64(crop),
                "candidates": candidates}

    # ------------------------------------------------------------ teacher answers the popup
    def answer(self, request_id, student_id, add_reference=False):
        data = self.pending.pop(request_id, None)
        if data is None:
            return {"ok": False}
        db = SessionLocal()
        try:
            session = db.get(ClassSession, self.session_id)
            snapshot = storage.save_jpg(data["crop"], f"sessions/{session.id}/verify")
            detail = {"candidates": [{"name": c["name"], "similarity": c["similarity"]} for c in data["candidates"]]}
            if student_id is None:
                attendance.log_event(db, session.id, "reject", None, detail, snapshot)
                return {"ok": True, "roster_changed": False}
            sim = next((c["similarity"] for c in data["candidates"] if c["student_id"] == student_id), None)
            attendance.check_in(db, session, student_id, "confirmed", sim, data["spoof"], snapshot=snapshot)
            attendance.log_event(db, session.id, "confirm", student_id, detail, snapshot)
            if add_reference:
                student = db.get(Student, student_id)
                if len(student.photos) < config["enroll"]["max_photos"]:
                    enroll.add_face_from_live(db, student, data["aligned"], data["crop"])
            for t in self.tracks:
                if t.id == data["track"]:
                    t.checked_student = student_id
            return {"ok": True, "roster_changed": True}
        finally:
            db.close()


_live = {}


def get_live(session_id):
    if session_id not in _live:
        _live[session_id] = LiveSession(session_id)
    return _live[session_id]


def drop_live(session_id):
    _live.pop(session_id, None)


def decode_frame(data):
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)

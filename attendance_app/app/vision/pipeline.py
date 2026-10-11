"""One place that runs the whole face pipeline:
YOLO face -> crop x1.5 -> anti-spoof -> 5 landmarks -> aligned 112x112 -> ArcFace embedding
(+ optionally YOLO26n: is the face inside a phone / screen / printed photo?).
The same code is used for enrolment photos and for live camera frames.
"""
import threading
from dataclasses import dataclass, field

import cv2
import numpy as np

from ..config import config
from .antispoof import AntiSpoof
from .detector import DeviceDetector, FaceDetector
from .embedder import Embedder, LandmarkFinder, align_face, center_face
from .onnx_runtime import load_session, pick_providers


@dataclass
class Face:
    box: list                    # [x1, y1, x2, y2] in image pixels
    det_score: float
    spoof_score: float           # P(spoof)
    embedding: np.ndarray        # (512,) L2-normalised
    aligned: np.ndarray          # 112x112 BGR face used for the embedding
    landmarks: np.ndarray | None
    quality: dict = field(default_factory=dict)
    device_score: float = 0.0    # YOLO26n confidence that the face is inside a phone / screen / print
    device_box: list | None = None

    @property
    def size(self):
        return min(self.box[2] - self.box[0], self.box[3] - self.box[1])


def head_pose(landmarks):
    """Rough yaw / pitch from the 5 points (0 = looking straight at the camera)."""
    left_eye, right_eye, nose, mouth_l, mouth_r = landmarks
    eye_mid, mouth_mid = (left_eye + right_eye) / 2, (mouth_l + mouth_r) / 2
    eye_dist = max(np.linalg.norm(right_eye - left_eye), 1e-6)
    yaw = float((nose[0] - eye_mid[0]) / eye_dist)
    face_h = max(mouth_mid[1] - eye_mid[1], 1e-6)
    pitch = float((nose[1] - eye_mid[1]) / face_h - 0.55)
    return yaw, pitch


def measure_quality(face):
    gray = cv2.cvtColor(face.aligned, cv2.COLOR_BGR2GRAY)
    q = {"face_px": int(face.size),
         "sharpness": float(cv2.Laplacian(gray[16:96, 16:96], cv2.CV_64F).var()),
         "brightness": float(gray.mean()),
         "aligned": face.landmarks is not None}
    if face.landmarks is not None:
        q["yaw"], q["pitch"] = head_pose(face.landmarks)
    return q


def quality_warnings(q):
    """Thai warnings shown to the teacher when an enrolment photo is weak."""
    e = config["enroll"]
    warnings = []
    if q["face_px"] < e["min_face_px"]:
        warnings.append(f"หน้าเล็กเกินไป ({q['face_px']} px)")
    if q["sharpness"] < e["min_sharpness"]:
        warnings.append("ภาพเบลอ")
    if q["brightness"] < 50:
        warnings.append("ภาพมืดเกินไป")
    elif q["brightness"] > 210:
        warnings.append("ภาพสว่างเกินไป")
    if not q["aligned"]:
        warnings.append("หาตำแหน่งตา/จมูก/ปากไม่เจอ")
    else:
        if abs(q["yaw"]) > e["max_yaw"]:
            warnings.append("หน้าหันข้างมากเกินไป")
        if abs(q["pitch"]) > e["max_pitch"]:
            warnings.append("หน้าก้มหรือเงยมากเกินไป")
    return warnings


def live_quality_issue(face, frame_shape):
    """Live camera gate: only judge faces that look at the camera. Returns a Thai hint, or None if OK."""
    a, q = config["attendance"], face.quality
    h, w = frame_shape[:2]
    x1, y1, x2, y2 = face.box
    if x1 <= 2 or y1 <= 2 or x2 >= w - 2 or y2 >= h - 2:
        return "ขยับหน้าเข้ามากลางกล้อง"
    if not q.get("aligned"):
        return "มองตรงที่กล้อง"
    if q["brightness"] < 45:
        return "แสงน้อยเกินไป"
    if abs(q["yaw"]) > a["max_yaw"]:
        return "มองตรงที่กล้อง"
    if abs(q["pitch"]) > a["max_pitch"]:
        return "อย่าก้มหรือเงยหน้า"
    return None


class Pipeline:
    def __init__(self):
        m = config["models"]
        device = m["device"]
        d, a, l, e = m["detector"], m["antispoof"], m["landmarks"], m["embedding"]
        self.detector = FaceDetector(load_session(config.path(d["path"]), device), d["imgsz"], d["conf"], d["iou"])
        self.antispoof = AntiSpoof(load_session(config.path(a["path"]), device),
                                   a["img_size"], a["crop_scale"], a["mean"], a["std"])
        # SCRFD has dynamic input shapes that DirectML cannot run; it is tiny, so the CPU is fine
        self.landmarks = LandmarkFinder(load_session(config.path(l["path"]), "cpu"), l["input_size"], l["conf"])
        self.embedder = Embedder(load_session(config.path(e["path"]), device))
        sd = m.get("spoof_detector")
        self.device_detector = None
        if sd and config.path(sd["path"]).exists():
            self.device_detector = DeviceDetector(load_session(config.path(sd["path"]), device), sd["imgsz"],
                                                  fake_class=sd["fake_class"], ioa_min=sd["ioa_min"])
        self.providers = pick_providers(device)
        self.lock = threading.Lock()        # one frame at a time on the GPU

    def analyze(self, image_bgr, max_faces=20, min_face_px=0, devices=False):
        """Return a list of Face, largest first. devices=True also runs the phone / screen / print detector."""
        with self.lock:
            detections = [(b, s) for b, s in self.detector.detect(image_bgr)
                          if min(b[2] - b[0], b[3] - b[1]) >= min_face_px]
            detections.sort(key=lambda d: -(d[0][2] - d[0][0]) * (d[0][3] - d[0][1]))
            detections = detections[:max_faces]
            if not detections:
                return []

            spoof = self.antispoof.spoof_scores([self.antispoof.crop(image_bgr, b) for b, _ in detections])
            aligned, landmarks = [], []
            for box, _ in detections:
                points, _ = self.landmarks.find(image_bgr, box)
                landmarks.append(points)
                aligned.append(align_face(image_bgr, points) if points is not None else center_face(image_bgr, box))
            vectors = self.embedder.embed(aligned)
            fakes = self.device_detector.fake_boxes(image_bgr) if devices and self.device_detector else []

        faces = []
        for i, (box, score) in enumerate(detections):
            face = Face([float(v) for v in box], score, float(spoof[i]), vectors[i], aligned[i], landmarks[i])
            face.quality = measure_quality(face)
            if fakes:
                score, box = self.device_detector.face_score(face.box, fakes)
                face.device_score, face.device_box = score, ([float(v) for v in box] if box is not None else None)
            faces.append(face)
        return faces


_pipeline = None


def get_pipeline():
    global _pipeline
    if _pipeline is None:
        _pipeline = Pipeline()
    return _pipeline


def read_image(data):
    """Decode image bytes (any path / unicode safe) to BGR, or None."""
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    return image

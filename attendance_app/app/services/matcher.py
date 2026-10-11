"""Who is this face? Cosine similarity against every reference photo of the class,
plus extra rules for the "risk group" (twins / look-alikes).

Rules (all thresholds in config.yaml -> matching):
1. score(student) = best cosine similarity over that student's photos
2. top-1 below sim_threshold                     -> unknown
3. top-1 in the risk group: needs risk_sim_threshold and risk_margin, otherwise -> ambiguous
4. everyone else: needs min_margin over the next student, otherwise -> ambiguous
5. twin check: if top-1 and top-2 are both in the risk group and both have enough photos,
   project the face on the Fisher direction that best separates the two of them.
   It must agree with top-1 and be at least pair_min_confidence standard deviations away
   from the midpoint, otherwise -> ambiguous (the teacher decides in a popup).
"""
import threading
from dataclasses import dataclass, field

import numpy as np

from ..config import config
from ..db import SessionLocal, Student


@dataclass
class Person:
    id: int
    name: str
    code: str
    risk: bool
    vectors: np.ndarray            # (n_photos, 512)
    photo_url: str | None


@dataclass
class Decision:
    status: str                     # match | ambiguous | unknown | empty
    student_id: int | None = None
    similarity: float = 0.0
    margin: float = 0.0
    reason: str = ""
    candidates: list = field(default_factory=list)   # [(student_id, similarity)] best first


class PairModel:
    """Fisher discriminant between two people (with shrinkage because we have few photos)."""

    def __init__(self, a, b):
        mean_a, mean_b = a.mean(0), b.mean(0)
        centered = np.concatenate([a - mean_a, b - mean_b])
        scatter = centered.T @ centered / max(len(centered) - 2, 1)
        shrink = np.trace(scatter) / scatter.shape[0] + 1e-3
        self.w = np.linalg.solve(scatter + shrink * np.eye(scatter.shape[0]), mean_a - mean_b)
        self.mid = float(self.w @ (mean_a + mean_b) / 2)
        proj = np.concatenate([a @ self.w - self.w @ mean_a, b @ self.w - self.w @ mean_b])
        gap = abs(float(self.w @ (mean_a - mean_b))) / 2
        self.spread = max(float(proj.std()), gap / 3, 1e-6)

    def z(self, vector):
        """> 0 means the first person, < 0 the second, in units of within-person spread."""
        return float(vector @ self.w - self.mid) / self.spread


class Gallery:
    def __init__(self, people):
        self.people = people
        self.by_id = {p.id: p for p in people}
        self.pairs = {}

    def scores(self, vector):
        return sorted(((p.id, float((p.vectors @ vector).max())) for p in self.people if len(p.vectors)),
                      key=lambda s: -s[1])

    def pair_model(self, id_a, id_b):
        key = (id_a, id_b)
        if key not in self.pairs:
            a, b = self.by_id[id_a].vectors, self.by_id[id_b].vectors
            n = config["matching"]["pair_min_photos"]
            self.pairs[key] = PairModel(a, b) if len(a) >= n and len(b) >= n else None
        return self.pairs[key]

    def identify(self, vector):
        m = config["matching"]
        scores = self.scores(vector)
        if not scores:
            return Decision("empty", reason="ยังไม่มีรูปนักศึกษาในห้องนี้")
        candidates = scores[:3]
        (top_id, top_sim) = scores[0]
        second_id, second_sim = scores[1] if len(scores) > 1 else (None, -1.0)
        margin = top_sim - second_sim
        d = Decision("match", top_id, top_sim, margin, candidates=candidates)

        if top_sim < m["sim_threshold"]:
            d.status, d.student_id, d.reason = "unknown", None, "ไม่ตรงกับใครในห้อง"
            return d

        top = self.by_id[top_id]
        risky = top.risk
        need_sim = m["risk_sim_threshold"] if risky else m["sim_threshold"]
        need_margin = m["risk_margin"] if risky else m["min_margin"]
        if top_sim < need_sim:
            d.status, d.reason = "ambiguous", "กลุ่มเสี่ยง: ความเหมือนยังไม่สูงพอ"
            return d

        # twin pair (both in the risk group, enough photos): the pair model decides instead of the margin
        pair = None
        if m["pair_check"] and risky and second_id is not None and self.by_id[second_id].risk:
            pair = self.pair_model(top_id, second_id)
        if pair is not None:
            z = pair.z(vector)                       # > 0 = top-1, < 0 = top-2
            winner_id, winner_sim = (top_id, top_sim) if z > 0 else (second_id, second_sim)
            if abs(z) < m["pair_min_confidence"]:
                d.status, d.reason = "ambiguous", f"ตัวแยกแฝดยังไม่มั่นใจ (z={z:+.2f})"
            elif winner_sim < need_sim:
                d.status, d.reason = "ambiguous", "ตัวแยกแฝดเลือกคนที่ความเหมือนไม่ถึงเกณฑ์"
            else:
                d.student_id, d.similarity = winner_id, winner_sim
                d.reason = f"ตัวแยกแฝด z={z:+.2f}"
        elif margin < need_margin:
            d.status, d.reason = "ambiguous", "คะแนนอันดับ 1 กับ 2 ใกล้กันเกินไป"
        return d


_cache = {}
_lock = threading.Lock()


def get_gallery(section_id):
    with _lock:
        if section_id not in _cache:
            _cache[section_id] = _build(section_id)
        return _cache[section_id]


def invalidate(section_id):
    with _lock:
        _cache.pop(section_id, None)


def _build(section_id):
    from .storage import media_url
    db = SessionLocal()
    try:
        people = []
        for s in db.query(Student).filter_by(section_id=section_id).all():
            vectors = np.array([p.vector for p in s.photos], np.float32).reshape(-1, 512)
            photo = media_url(s.photos[0].face_path) if s.photos else None
            people.append(Person(s.id, s.name, s.student_code, s.risk_group, vectors, photo))
        return Gallery(people)
    finally:
        db.close()


def centroid(vectors):
    c = vectors.mean(0)
    return c / (np.linalg.norm(c) + 1e-9)


def similar_pairs(section_id, limit=None):
    """Most similar pairs of different students: (id_a, id_b, best photo-to-photo similarity)."""
    people = [p for p in get_gallery(section_id).people if len(p.vectors)]
    pairs = []
    for i in range(len(people)):
        for j in range(i + 1, len(people)):
            sim = float((people[i].vectors @ people[j].vectors.T).max())
            pairs.append((people[i].id, people[j].id, sim))
    pairs.sort(key=lambda p: -p[2])
    return pairs[:limit] if limit else pairs

"""YOLO26 detectors (ONNX). The exported head is raw (1, 4 + classes, N): cx, cy, w, h, class scores -> we run NMS.
FaceDetector: 1 class (face, notebook 1). DeviceDetector: fake / real (phone, screen or print around a face, notebook 3).
"""
import cv2
import numpy as np


class YoloDetector:
    def __init__(self, session, imgsz=640, conf=0.35, iou=0.5):
        self.session = session
        self.input_name = session.get_inputs()[0].name
        self.imgsz, self.conf, self.iou = imgsz, conf, iou

    def letterbox(self, image):
        """Resize keeping the aspect ratio and pad to a square (same as Ultralytics)."""
        h, w = image.shape[:2]
        ratio = min(self.imgsz / h, self.imgsz / w)
        new_h, new_w = round(h * ratio), round(w * ratio)
        top, left = (self.imgsz - new_h) // 2, (self.imgsz - new_w) // 2
        canvas = np.full((self.imgsz, self.imgsz, 3), 114, np.uint8)
        canvas[top:top + new_h, left:left + new_w] = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
        return canvas, ratio, left, top

    def detect_all(self, image_bgr, conf=None):
        """Return a list of (box [x1, y1, x2, y2], score, class_id) in image pixels, best first."""
        conf = self.conf if conf is None else conf
        canvas, ratio, left, top = self.letterbox(image_bgr)
        blob = canvas[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255.0
        out = self.session.run(None, {self.input_name: blob})[0][0].T     # (N, 4 + classes)
        class_scores = out[:, 4:]
        classes, scores = class_scores.argmax(1), class_scores.max(1)
        keep = scores >= conf
        out, classes, scores = out[keep], classes[keep], scores[keep]
        if len(out) == 0:
            return []

        cx, cy, bw, bh = out[:, :4].T
        boxes = np.stack([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], axis=1)
        boxes[:, [0, 2]] = (boxes[:, [0, 2]] - left) / ratio
        boxes[:, [1, 3]] = (boxes[:, [1, 3]] - top) / ratio
        h, w = image_bgr.shape[:2]
        boxes[:, [0, 2]] = boxes[:, [0, 2]].clip(0, w)
        boxes[:, [1, 3]] = boxes[:, [1, 3]].clip(0, h)

        tlwh = np.concatenate([boxes[:, :2], boxes[:, 2:] - boxes[:, :2]], axis=1)
        keep = np.array(cv2.dnn.NMSBoxesBatched(tlwh.tolist(), scores.tolist(), classes.tolist(), conf, self.iou)).reshape(-1)
        keep = keep[np.argsort(-scores[keep])]
        return [(boxes[i], float(scores[i]), int(classes[i])) for i in keep]


class FaceDetector(YoloDetector):
    def detect(self, image_bgr):
        """Return a list of (box, score), best first."""
        return [(b, s) for b, s, _ in self.detect_all(image_bgr)]


def ioa(inner, outer):
    """Share of `inner`'s area that lies inside `outer`."""
    ix = max(0.0, min(inner[2], outer[2]) - max(inner[0], outer[0]))
    iy = max(0.0, min(inner[3], outer[3]) - max(inner[1], outer[1]))
    area = max((inner[2] - inner[0]) * (inner[3] - inner[1]), 1e-6)
    return ix * iy / area


class DeviceDetector(YoloDetector):
    """Finds phones / screens / printed photos ("fake" boxes) and real faces."""

    def __init__(self, session, imgsz=640, conf=0.75, iou=0.5, fake_class=0, ioa_min=0.6):
        super().__init__(session, imgsz, conf, iou)
        self.fake_class, self.ioa_min = fake_class, ioa_min

    def fake_boxes(self, image_bgr, min_conf=0.25):
        """All "fake" boxes down to min_conf (the decision threshold is applied per face later)."""
        return [(b, s) for b, s, c in self.detect_all(image_bgr, conf=min_conf) if c == self.fake_class]

    def face_score(self, face_box, fake_boxes):
        """Device confidence for one face: best "fake" box that contains most of the face (0 = none)."""
        best, best_box = 0.0, None
        for box, score in fake_boxes:
            if score > best and ioa(face_box, box) >= self.ioa_min:
                best, best_box = score, box
        return best, best_box

"""Face alignment (SCRFD 5 landmarks) + ArcFace embedding (InsightFace buffalo_l)."""
import cv2
import numpy as np

# Where the 5 landmarks (eyes, nose, mouth corners) sit in the standard 112x112 ArcFace face
ARCFACE_POINTS = np.array([[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
                           [41.5493, 92.3655], [70.7299, 92.2041]], np.float32)


class LandmarkFinder:
    """Runs SCRFD on a crop around the YOLO box and returns the 5 points of the main face."""

    def __init__(self, session, input_size=192, conf=0.3):
        self.session = session
        self.input_name = session.get_inputs()[0].name
        self.size, self.conf = input_size, conf
        self.strides = [8, 16, 32]
        self.anchor_centers = {}
        for stride in self.strides:
            n = self.size // stride
            grid = np.stack(np.mgrid[:n, :n][::-1], axis=-1).reshape(-1, 2).astype(np.float32) * stride
            self.anchor_centers[stride] = np.repeat(grid, 2, axis=0)   # 2 anchors per cell

    def find(self, image_bgr, box):
        """Return (5x2 landmark array in image pixels, score) or (None, 0)."""
        x1, y1, x2, y2 = box
        side = max(x2 - x1, y2 - y1) * 1.6
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        scale = self.size / side
        # affine: image -> crop of size x size centred on the face
        M = np.array([[scale, 0, self.size / 2 - cx * scale], [0, scale, self.size / 2 - cy * scale]], np.float32)
        crop = cv2.warpAffine(image_bgr, M, (self.size, self.size), borderValue=(0, 0, 0))
        blob = cv2.dnn.blobFromImage(crop, 1 / 128, (self.size, self.size), (127.5, 127.5, 127.5), swapRB=True)
        outs = self.session.run(None, {self.input_name: blob})

        best, best_score = None, 0.0
        for i, stride in enumerate(self.strides):
            scores = outs[i].reshape(-1)
            kps = outs[i + 6].reshape(-1, 10) * stride
            centers = self.anchor_centers[stride]
            for j in np.where(scores >= self.conf)[0]:
                points = centers[j] + kps[j].reshape(5, 2)
                # prefer the face nearest the crop centre (the YOLO face), then the score
                dist = np.linalg.norm(points.mean(0) - self.size / 2) / self.size
                score = float(scores[j]) - dist
                if score > best_score:
                    best, best_score = points, score
        if best is None:
            return None, 0.0
        # crop pixels -> image pixels
        best = (best - M[:, 2]) / scale
        return best.astype(np.float32), best_score


def align_face(image_bgr, landmarks):
    M, _ = cv2.estimateAffinePartial2D(landmarks, ARCFACE_POINTS, method=cv2.LMEDS)
    return cv2.warpAffine(image_bgr, M, (112, 112), borderValue=(0, 0, 0))


def center_face(image_bgr, box):
    """Fallback when no landmarks are found: a plain square crop of the face."""
    x1, y1, x2, y2 = box
    side = max(x2 - x1, y2 - y1)
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    scale = 112 / side
    M = np.array([[scale, 0, 56 - cx * scale], [0, scale, 56 - cy * scale]], np.float32)
    return cv2.warpAffine(image_bgr, M, (112, 112), borderValue=(0, 0, 0))


class Embedder:
    def __init__(self, session):
        self.session = session
        self.input_name = session.get_inputs()[0].name

    def embed(self, faces_112):
        """L2-normalised 512-d embedding for each aligned 112x112 BGR face."""
        if not faces_112:
            return np.zeros((0, 512), np.float32)
        blob = cv2.dnn.blobFromImages(faces_112, 1 / 127.5, (112, 112), (127.5, 127.5, 127.5), swapRB=True)
        vectors = np.concatenate([self.session.run(None, {self.input_name: blob[i:i + 1]})[0]
                                  for i in range(len(blob))])
        return vectors / np.linalg.norm(vectors, axis=1, keepdims=True)

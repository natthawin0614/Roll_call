"""Live vs spoof classifier (ONNX, softmax included). Crop rule must match notebook 2."""
import cv2
import numpy as np


def square_box(x1, y1, x2, y2, img_w, img_h, scale):
    """Square box around the face, enlarged by `scale`, shifted (not clipped) to stay inside the image."""
    side = max(x2 - x1, y2 - y1) * scale
    side = min(side, img_w, img_h)
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    left = min(max(cx - side / 2, 0), img_w - side)
    top = min(max(cy - side / 2, 0), img_h - side)
    return int(round(left)), int(round(top)), int(round(left + side)), int(round(top + side))


class AntiSpoof:
    def __init__(self, session, img_size=224, crop_scale=1.5, mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225)):
        self.session = session
        self.input_name = session.get_inputs()[0].name
        self.img_size, self.crop_scale = img_size, crop_scale
        self.mean = np.array(mean, np.float32)
        self.std = np.array(std, np.float32)

    def crop(self, image_bgr, box):
        h, w = image_bgr.shape[:2]
        x1, y1, x2, y2 = square_box(*box, w, h, self.crop_scale)
        face = image_bgr[y1:y2, x1:x2]
        return cv2.resize(face, (self.img_size, self.img_size), interpolation=cv2.INTER_AREA)

    def spoof_scores(self, crops_bgr):
        """P(spoof) for each 224x224 crop."""
        if not crops_bgr:
            return np.zeros(0, np.float32)
        x = np.stack([c[:, :, ::-1] for c in crops_bgr]).astype(np.float32) / 255.0
        x = ((x - self.mean) / self.std).transpose(0, 3, 1, 2)
        probs = self.session.run(None, {self.input_name: np.ascontiguousarray(x)})[0]
        return probs[:, 1]

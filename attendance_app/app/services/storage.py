"""Files on disk. Everything lives under data/media and is served at /media."""
import shutil
import uuid
from pathlib import Path

import cv2
import numpy as np

from ..config import config

MEDIA = config.data_dir / "media"
EXPORTS = config.data_dir / "exports"
for d in (MEDIA, EXPORTS):
    d.mkdir(parents=True, exist_ok=True)


def save_jpg(image_bgr, folder, name=None, max_side=None, quality=90):
    """Save under data/media/<folder>/ and return the path relative to data/media (posix)."""
    if max_side and max(image_bgr.shape[:2]) > max_side:
        scale = max_side / max(image_bgr.shape[:2])
        image_bgr = cv2.resize(image_bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    out_dir = MEDIA / folder
    out_dir.mkdir(parents=True, exist_ok=True)
    name = name or f"{uuid.uuid4().hex[:12]}.jpg"
    ok, buffer = cv2.imencode(".jpg", image_bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    buffer.tofile(str(out_dir / name))          # tofile works with Thai paths on Windows
    return f"{folder}/{name}"


def read_jpg(relative):
    return cv2.imdecode(np.fromfile(str(MEDIA / relative), np.uint8), cv2.IMREAD_COLOR)


def media_url(relative):
    return f"/media/{relative}" if relative else None


def delete_file(relative):
    if relative:
        (MEDIA / relative).unlink(missing_ok=True)


def delete_folder(relative):
    shutil.rmtree(MEDIA / relative, ignore_errors=True)


def safe_name(text):
    return "".join(c for c in text if c.isalnum() or c in "-_") or "x"


Path(MEDIA / "faces").mkdir(exist_ok=True)

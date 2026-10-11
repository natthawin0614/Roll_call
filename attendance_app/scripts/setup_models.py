"""Put every model file in models/ (run once).

    python scripts/setup_models.py

- YOLO face + anti-spoof + YOLO26n: copied from the notebook outputs in ../roll_call
  = the Google Drive folder (download it and put it next to attendance_app/):
  https://drive.google.com/drive/folders/1ASkYBfjdvK459_E2b0ZL_uukRwH8Xd9i
- InsightFace buffalo_l (ArcFace R50 + SCRFD for landmarks): downloaded from the official GitHub release
  (non-commercial / research licence)
"""
import io
import shutil
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models"
NOTEBOOKS = ROOT.parent / "roll_call"
DRIVE_URL = "https://drive.google.com/drive/folders/1ASkYBfjdvK459_E2b0ZL_uukRwH8Xd9i"
BUFFALO_URL = "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip"

COPY = {
    "yolo26s_face_640.onnx": NOTEBOOKS / "yolo_face/yolo26s_widerface_960/export/yolo26s_widerface_960_best_640.onnx",
    "antispoof_convnext.onnx": NOTEBOOKS / "antispoof/export/antispoof_convnext_aug_ema.onnx",
    "antispoof_config.json": NOTEBOOKS / "antispoof/export/antispoof_config.json",
    "antispoof_convnext_ft.onnx": NOTEBOOKS / "spoof_yolo/export/antispoof_convnext_ft.onnx",
    "spoof_yolo26n_640.onnx": NOTEBOOKS / "spoof_yolo/export/spoof_yolo26n_640.onnx",
    "spoof_config.json": NOTEBOOKS / "spoof_yolo/export/spoof_config.json",
}

MODELS.mkdir(exist_ok=True)
for name, src in COPY.items():
    if (MODELS / name).exists():
        print(f"ok        {name}")
    elif src.exists():
        shutil.copy(src, MODELS / name)
        print(f"copied    {name}")
    else:
        print(f"MISSING   {name}: download the 'export' folders from {DRIVE_URL}")
        print(f"          and keep the same layout: {src.relative_to(ROOT.parent)}")

needed = ["det_10g.onnx", "w600k_r50.onnx"]
if all((MODELS / n).exists() for n in needed):
    print("ok        buffalo_l (det_10g.onnx, w600k_r50.onnx)")
else:
    print("download  buffalo_l.zip (~290 MB) ...")
    data = urllib.request.urlopen(BUFFALO_URL).read()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for n in needed:
            (MODELS / n).write_bytes(z.read(n))
    print("saved     det_10g.onnx, w600k_r50.onnx")


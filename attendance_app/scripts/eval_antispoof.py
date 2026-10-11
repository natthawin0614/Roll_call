"""Evaluate the anti-spoof model on your own photos (with F1 as well as ACER).

Step 1 - make an answer-key template (one row per detected face) and a picture showing which face is which:
    python scripts\\eval_antispoof.py "..\\image_pyiot\\test set" --template
    -> <folder>\\labels.csv and <folder>\\labels_faces.jpg

Step 2 - fill the `label` column with live or spoof (leave a row empty to skip that face), then:
    python scripts\\eval_antispoof.py "..\\image_pyiot\\test set"

labels.csv may also have just `file,label` (no `face` column): the label then applies to every face in that photo.
spoof = positive class for precision / recall / F1.
"""
import argparse
import csv
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.config import config  # noqa: E402
from app.vision.pipeline import get_pipeline, read_image  # noqa: E402

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def detect_all(folder, min_face_px):
    pipeline = get_pipeline()
    rows, tiles = [], []
    for path in sorted(p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXT and not p.stem.startswith("labels_")):
        image = read_image(path.read_bytes())
        for i, face in enumerate(pipeline.analyze(image, min_face_px=min_face_px)):
            size = int(max(face.box[2] - face.box[0], face.box[3] - face.box[1]))
            rows.append({"file": path.name, "face": i, "size_px": size, "det": round(face.det_score, 3),
                         "p_spoof": round(face.spoof_score, 4), "box": [int(v) for v in face.box]})
            tile = cv2.resize(pipeline.antispoof.crop(image, face.box), (160, 160))
            cv2.putText(tile, f"{path.stem}#{i}", (4, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 2)
            tiles.append(tile)
    return rows, tiles


def save_grid(tiles, path, cols=8):
    if not tiles:
        return
    tiles = tiles + [np.zeros_like(tiles[0])] * (-len(tiles) % cols)
    grid = np.vstack([np.hstack(tiles[i:i + cols]) for i in range(0, len(tiles), cols)])
    cv2.imencode(".jpg", grid)[1].tofile(str(path))


def load_labels(path):
    with open(path, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    labels = {}
    for r in rows:
        label = (r.get("label") or "").strip().lower()
        if label not in ("live", "spoof"):
            continue
        face = (r.get("face") or "").strip()
        labels[(r["file"].strip(), int(face) if face else None)] = label
    return labels


def auc(y, s):
    pos, neg = s[y == 1], s[y == 0]
    if len(pos) == 0 or len(neg) == 0:
        return None
    ranks = np.argsort(np.argsort(np.concatenate([pos, neg]))) + 1
    return float((ranks[:len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def metrics(y, s, threshold):
    pred = (s >= threshold).astype(int)
    tp = int(((pred == 1) & (y == 1)).sum()); fn = int(((pred == 0) & (y == 1)).sum())
    fp = int(((pred == 1) & (y == 0)).sum()); tn = int(((pred == 0) & (y == 0)).sum())
    div = lambda a, b: a / b if b else float("nan")
    precision, recall = div(tp, tp + fp), div(tp, tp + fn)
    f1_spoof = div(2 * tp, 2 * tp + fp + fn)
    f1_live = div(2 * tn, 2 * tn + fn + fp)
    apcer, bpcer = div(fn, tp + fn), div(fp, fp + tn)
    return {"TP": tp, "FN": fn, "FP": fp, "TN": tn, "APCER": apcer, "BPCER": bpcer,
            "ACER": np.nanmean([apcer, bpcer]), "ACC": div(tp + tn, len(y)), "Precision": precision,
            "Recall": recall, "F1_spoof": f1_spoof, "F1_live": f1_live, "F1_macro": np.nanmean([f1_spoof, f1_live])}


def fmt(v):
    return "  -  " if v is None or (isinstance(v, float) and np.isnan(v)) else f"{v:.3f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", type=Path)
    ap.add_argument("--labels", type=Path, help="default: <folder>/labels.csv")
    ap.add_argument("--template", action="store_true", help="write labels.csv template + labels_faces.jpg")
    ap.add_argument("--min-face", type=int, default=40, help="ignore faces smaller than this (px)")
    ap.add_argument("--threshold", type=float, default=0.443)   # EER of the fine-tuned model (notebook 3)
    args = ap.parse_args()

    rows, tiles = detect_all(args.folder, args.min_face)
    labels_path = args.labels or args.folder / "labels.csv"

    if args.template:
        if labels_path.exists():
            sys.exit(f"{labels_path} already exists - not overwriting")
        with open(labels_path, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(["file", "face", "size_px", "det", "p_spoof", "model_says", "label"])
            for r in rows:
                w.writerow([r["file"], r["face"], r["size_px"], r["det"], r["p_spoof"],
                            "spoof" if r["p_spoof"] >= args.threshold else "live", ""])
        save_grid(tiles, args.folder / "labels_faces.jpg")
        print(f"wrote {labels_path} ({len(rows)} faces) and labels_faces.jpg - fill the `label` column")
        return

    if not labels_path.exists():
        sys.exit(f"no {labels_path} - run with --template first")
    labels = load_labels(labels_path)
    y, s, small = [], [], []
    for r in rows:
        label = labels.get((r["file"], r["face"]), labels.get((r["file"], None)))
        if label:
            y.append(int(label == "spoof")); s.append(r["p_spoof"]); small.append(r["size_px"] < 80)
    if not y:
        sys.exit("no labelled faces found")
    y, s, small = np.array(y), np.array(s), np.array(small)
    print(f"faces: {len(y)}  (live {int((y == 0).sum())}, spoof {int(y.sum())})   AUC: {fmt(auc(y, s))}")
    print("APCER = spoof accepted as live | BPCER = live rejected | positive class for F1 = spoof\n")

    keys = ["TP", "FN", "FP", "TN", "APCER", "BPCER", "ACER", "ACC", "Precision", "Recall", "F1_spoof", "F1_live", "F1_macro"]
    print("threshold " + " ".join(f"{k:>9}" for k in keys))
    for t in sorted({args.threshold, 0.3, 0.5, 0.7, 0.9}):
        m = metrics(y, s, t)
        mark = " <- config" if t == args.threshold else ""
        print(f"{t:9.3f} " + " ".join(f"{m[k]:>9}" if isinstance(m[k], int) else f"{fmt(m[k]):>9}" for k in keys) + mark)

    print("\nby face size (threshold from config):")
    for name, mask in (("< 80 px", small), (">= 80 px", ~small)):
        if mask.any():
            m = metrics(y[mask], s[mask], args.threshold)
            print(f"  {name:9s} n={int(mask.sum()):3d}  APCER {fmt(m['APCER'])}  BPCER {fmt(m['BPCER'])}  F1_macro {fmt(m['F1_macro'])}")


if __name__ == "__main__":
    main()

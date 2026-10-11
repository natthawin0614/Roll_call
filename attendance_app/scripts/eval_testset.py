"""Evaluate the whole system on still photos (for the report / slides).

    python scripts\\eval_testset.py

1. Recognition: enrol one face per photo in ../image_pyiot, find everyone in ../image_pyiot/test set,
   compare with the answer key "test set.xlsx" (image_No, Member1..N; English nicknames).
2. Anti-spoof on the class photos (all real people): 5 setups
   A old ConvNeXt | B fine-tuned ConvNeXt | C YOLO26n device | D YOLO26n + old | E YOLO26n + fine-tuned
   + the 3-zone rule used by the app (live / head-turn challenge / spoof).
3. The same 5 setups on notebook 3's scores.csv (Roboflow test, Axon unseen device, CelebA val),
   and how the 3-zone thresholds were chosen.
Writes annotated photos to ../test_results/eval and a summary to data/eval/summary.json.
"""
import argparse
import csv
import json
import sys
from collections import Counter
from pathlib import Path

import cv2
import numpy as np
import openpyxl
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.config import config  # noqa: E402
from app.services.enroll import parse_name  # noqa: E402
from app.services.matcher import Gallery, Person  # noqa: E402
from app.vision.antispoof import AntiSpoof  # noqa: E402
from app.vision.onnx_runtime import load_session  # noqa: E402
from app.vision.pipeline import get_pipeline, live_quality_issue, read_image  # noqa: E402

# nickname in the answer key -> file name in image_pyiot (people not listed here are not enrolled)
EN2TH = {"Bus": "บัส", "Tan": "แทน", "Ploy": "พลอย", "Aon": "อ้อน", "Numpu": "น้ำพู่", "Ken": "เคน", "Atom": "อะตอม",
         "Tem": "เต็ม", "Us": "อัส", "Shokun": "โชวกุน", "Palm": "ปาล์ม", "Mean": "มีน", "Ozone": "โอโซน",
         "Focus": "โฟกัส", "Pitch/Wuth": "พิช/วุต", "Pat": "พัฒ", "Q": "คิว", "Team": "ทีม", "Gm": "gm",
         "Modon": "โมดอน", "Spite": "สไปด์", "Nicha": "Nicha", "Mail": "เมล"}
SKIP_ENROL = {"พิชหรือวุฒิแยกโครตยาก"}      # both twins in one photo
IMAGE_EXT = {".jpg", ".jpeg", ".png"}
OLD_ANTISPOOF = ROOT / "models/antispoof_convnext.onnx"
OLD_THRESHOLD, NEW_EER = 0.198, 0.443


def rates(live_flags, spoof_flags):
    """live_flags: rejected? for every live face; spoof_flags: rejected? for every spoof face."""
    bpcer = float(np.mean(live_flags)) if len(live_flags) else None
    apcer = float(1 - np.mean(spoof_flags)) if len(spoof_flags) else None
    return {"APCER": apcer, "BPCER": bpcer}


def setups(old, new, dev):
    """Decision (True = spoof) of the 5 setups for arrays of scores."""
    dc = config["antispoof"]["device_conf"]
    return {"A old ConvNeXt": old >= OLD_THRESHOLD,
            "B fine-tuned ConvNeXt": new >= NEW_EER,
            "C YOLO26n device": dev >= dc,
            "D YOLO26n + old": (dev >= dc) | (old >= OLD_THRESHOLD),
            "E YOLO26n + fine-tuned": (dev >= dc) | (new >= 0.5)}


def zones(new, dev):
    """App rule: 'spoof' / 'challenge' / 'live' for each face."""
    a = config["antispoof"]
    out = np.full(len(new), "challenge", dtype=object)
    out[new <= a["live_below"]] = "live"
    out[new >= a["spoof_above"]] = "spoof"
    out[dev >= a["device_conf"]] = "spoof"
    return out


def build_gallery(folder, pipeline):
    vectors = {}
    for f in sorted(folder.iterdir()):
        if f.suffix.lower() not in IMAGE_EXT or f.stem in SKIP_ENROL:
            continue
        faces = pipeline.analyze(read_image(f.read_bytes()))
        if faces:
            vectors.setdefault(parse_name(f.stem)[1], []).append(faces[0].embedding)
    people = [Person(i, n, "", False, np.array(v, np.float32), None) for i, (n, v) in enumerate(vectors.items())]
    for i, a in enumerate(people):                       # automatic risk group, as in the app
        for b in people[i + 1:]:
            if float((a.vectors @ b.vectors.T).max()) >= config["enroll"]["similar_warn"]:
                a.risk = b.risk = True
    return Gallery(people)


def read_answers(path):
    ws = openpyxl.load_workbook(path).active
    answers = {}
    for row in list(ws.iter_rows(values_only=True))[1:]:
        if row[0]:
            answers[int(str(row[0]).replace("image", ""))] = [m for m in row[1:] if m]
    return answers


def draw(image, rows, out_path, font):
    scale = 1600 / max(image.shape[:2])
    canvas = Image.fromarray(cv2.cvtColor(cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA),
                                          cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(canvas)
    colors = {"live": (40, 190, 80), "challenge": (240, 170, 20), "spoof": (230, 40, 40), "skip": (150, 150, 150)}
    for r in rows:
        if r["device_box"]:
            d.rectangle([v * scale for v in r["device_box"]], outline=(230, 40, 40), width=3)
        x1, y1, x2, y2 = [v * scale for v in r["box"]]
        zone = r["zone"] if not r["quality"] else "skip"
        d.rectangle([x1, y1, x2, y2], outline=colors[zone], width=4)
        label = f"{r['name']} {r['sim']:.2f} | {zone if not r['quality'] else r['quality']} P={r['new']:.2f}"
        tb = d.textbbox((x1, y1 - 30), label, font=font)
        d.rectangle(tb, fill=colors[zone])
        d.text((x1, y1 - 30), label, font=font, fill=(255, 255, 255))
    canvas.save(out_path, quality=88)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gallery", type=Path, default=ROOT.parent / "image_pyiot")
    ap.add_argument("--test", type=Path, default=ROOT.parent / "image_pyiot" / "test set")
    ap.add_argument("--scores", type=Path, default=ROOT.parent / "roll_call/spoof_yolo/export/scores.csv")
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()
    out_dir = args.out or ROOT.parent / "test_results" / "eval"
    out_dir.mkdir(parents=True, exist_ok=True)

    pipeline = get_pipeline()
    old_as = AntiSpoof(load_session(OLD_ANTISPOOF, config["models"]["device"]))
    gallery = build_gallery(args.gallery, pipeline)
    answers = read_answers(next(args.test.glob("*.xlsx")))
    font = ImageFont.truetype(r"C:\Windows\Fonts\LeelaUIb.ttf", 24) if Path(r"C:\Windows\Fonts\LeelaUIb.ttf").exists() \
        else ImageFont.load_default()
    print(f"gallery: {len(gallery.people)} people, risk group: {[p.name for p in gallery.people if p.risk]}")

    # ---------------- 1. recognition + scores on the class photos ----------------
    rec = Counter()
    faces_all, per_image = [], []
    for f in sorted(p for p in args.test.iterdir() if p.suffix.lower() in IMAGE_EXT):
        image = read_image(f.read_bytes())
        faces = pipeline.analyze(image, min_face_px=40, devices=True)
        old = old_as.spoof_scores([old_as.crop(image, fc.box) for fc in faces])
        truth = [EN2TH.get(m) for m in answers.get(int(f.stem), [])]
        enrolled = {t for t in truth if t}
        found, rows = [], []
        for i, fc in enumerate(faces):
            d = gallery.identify(fc.embedding)
            name = gallery.by_id[d.student_id].name if d.student_id is not None else None
            if d.status == "match":
                ok = any(name in t.split("/") for t in enrolled) and name not in found
                rec["correct" if ok else "wrong"] += 1
                found.append(name)
                shown = name if ok else f"{name} (ผิด)"
            elif d.status == "ambiguous":
                rec["ambiguous"] += 1
                shown = f"?{name}"
            else:
                shown = "ไม่รู้จัก"
            row = {"image": f.name, "face": i, "box": fc.box, "size": int(fc.size), "name": shown, "sim": d.similarity,
                   "old": float(old[i]), "new": fc.spoof_score, "device": fc.device_score, "device_box": fc.device_box,
                   "quality": live_quality_issue(fc, image.shape)}
            rows.append(row)
        missed = [t for t in enrolled if not any(n in t.split("/") for n in found)]
        rec["missed"] += len(missed)
        rec["truth_enrolled"] += len(enrolled)
        for r in rows:
            r["zone"] = zones(np.array([r["new"]]), np.array([r["device"]]))[0]
        draw(image, rows, out_dir / (f.stem + ".jpg"), font)
        faces_all += rows
        per_image.append({"image": f.name, "truth": answers.get(int(f.stem), []),
                          "found": found, "missed": missed, "faces": len(faces)})
        print(f"{f.name:7s} truth={','.join(answers.get(int(f.stem), []))}\n        found={','.join(found) or '-'}"
              + (f" | missed={','.join(missed)}" if missed else ""))

    print("\n== recognition (match = auto check-in) ==")
    print(f"  enrolled people in the photos: {rec['truth_enrolled']} | found correctly: {rec['correct']} | "
          f"wrong person: {rec['wrong']} | sent to teacher (ambiguous): {rec['ambiguous']} | not found: {rec['missed']}")

    # ---------------- 2. anti-spoof on the class photos (all live) ----------------
    good = [r for r in faces_all if not r["quality"]]
    summary = {"recognition": dict(rec), "per_image": per_image, "class_photos": {}}
    print(f"\n== anti-spoof on class photos (all real): {len(faces_all)} faces, {len(good)} pass the quality gate ==")
    for name, subset in (("all faces", faces_all), ("quality OK", good)):
        old, new, dev = (np.array([r[k] for r in subset]) for k in ("old", "new", "device"))
        res = {k: rates(v, [])["BPCER"] for k, v in setups(old, new, dev).items()}
        z = Counter(zones(new, dev))
        res["3-zone"] = {k: z[k] / len(subset) for k in ("live", "challenge", "spoof")}
        summary["class_photos"][name] = res
        print(f"  [{name}] real people rejected (BPCER): " + " | ".join(f"{k} {v:.1%}" for k, v in res.items() if k != "3-zone"))
        print(f"  [{name}] app 3-zone: " + " | ".join(f"{k} {v:.1%}" for k, v in res["3-zone"].items()))

    # ---------------- 3. notebook 3 scores ----------------
    if args.scores.exists():
        data = list(csv.DictReader(open(args.scores, encoding="utf-8")))
        summary["datasets"] = {}
        print("\n== notebook 3 test sets (APCER = spoof accepted, BPCER = real rejected) ==")
        for set_name in sorted({r["set"] for r in data}):
            rows = [r for r in data if r["set"] == set_name]
            y = np.array([int(r["label"]) for r in rows])
            old, new = (np.array([float(r[k]) for r in rows]) for k in ("old", "new"))
            dev = np.array([float(r["device"]) if r["device"] not in ("", "nan") else np.nan for r in rows])
            has_dev = not np.isnan(dev).all()           # CelebA rows are face crops: no full image for YOLO26n
            dev = np.nan_to_num(dev)
            res = {k: rates(v[y == 0], v[y == 1]) for k, v in setups(old, new, dev).items() if has_dev or "YOLO" not in k}
            z = zones(new, dev)
            res["3-zone"] = {"live: real passed straight": float(np.mean(z[y == 0] == "live")) if (y == 0).any() else None,
                             "live: real asked to turn": float(np.mean(z[y == 0] == "challenge")) if (y == 0).any() else None,
                             "real rejected": float(np.mean(z[y == 0] == "spoof")) if (y == 0).any() else None,
                             "spoof passed straight": float(np.mean(z[y == 1] == "live")) if (y == 1).any() else None,
                             "spoof asked to turn": float(np.mean(z[y == 1] == "challenge")) if (y == 1).any() else None}
            summary["datasets"][set_name] = res
            print(f"  {set_name}  (real {(y == 0).sum()}, spoof {(y == 1).sum()})")
            for k, v in res.items():
                print(f"     {k:24s} " + " | ".join(f"{m} {'-' if x is None else f'{x:.1%}'}" for m, x in v.items()))

    (config.data_dir / "eval").mkdir(exist_ok=True)
    json.dump({**summary, "faces": [{k: v for k, v in r.items() if k != "box"} for r in faces_all]},
              open(config.data_dir / "eval" / "summary.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1,
              default=float)
    print(f"\nannotated photos -> {out_dir}\nsummary -> {config.data_dir / 'eval' / 'summary.json'}")


if __name__ == "__main__":
    main()

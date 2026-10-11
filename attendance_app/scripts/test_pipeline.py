"""M1 check: run the face pipeline on still photos.

usage:  python scripts/test_pipeline.py [folder] [--cpu]
Prints faces / P(spoof) / quality per photo, the most similar pairs, timings,
and saves data/test_aligned.jpg (every aligned face) for a visual check.
"""
import sys
import time
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.config import config  # noqa: E402

if "--cpu" in sys.argv:
    config.values["models"]["device"] = "cpu"
from app.vision.pipeline import get_pipeline, quality_warnings, read_image  # noqa: E402

args = [a for a in sys.argv[1:] if not a.startswith("--")]
folder = Path(args[0]) if args else config.path(config["paths"]["import_dir"])
paths = sorted(p for p in folder.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"))

t0 = time.time()
pipe = get_pipeline()
print(f"models loaded in {time.time() - t0:.1f}s, providers: {pipe.providers}")
pipe.analyze(read_image(paths[0].read_bytes()))          # warm-up

names, vectors, tiles, times = [], [], [], []
for p in paths:
    image = read_image(p.read_bytes())
    t = time.time()
    faces = pipe.analyze(image)
    times.append(time.time() - t)
    if not faces:
        print(f"{p.name:30s} NO FACE")
        continue
    f = faces[0]
    q = f.quality
    print(f"{p.name:30s} faces={len(faces)} P(spoof)={f.spoof_score:.3f} px={q['face_px']:4d} "
          f"sharp={q['sharpness']:6.0f} bright={q['brightness']:4.0f} yaw={q.get('yaw', 0):+.2f} "
          f"pitch={q.get('pitch', 0):+.2f} {quality_warnings(q)} {times[-1] * 1000:.0f}ms")
    names.append(p.stem)
    vectors.append(f.embedding)
    tile = f.aligned.copy()
    cv2.putText(tile, str(len(names) - 1), (3, 14), 0, 0.5, (0, 255, 255), 1)
    tiles.append(tile)

print(f"\nmean time per photo: {np.mean(times) * 1000:.0f} ms")
sims = np.array(vectors) @ np.array(vectors).T
pairs = sorted(((sims[i, j], names[i], names[j]) for i in range(len(names)) for j in range(i + 1, len(names))),
               reverse=True)
print("most similar pairs:")
for s, a, b in pairs[:8]:
    print(f"  {s:.3f}  {a} <-> {b}")
off = sims[~np.eye(len(names), dtype=bool)]
print(f"different-file similarity: mean {off.mean():.3f}, max {off.max():.3f}")

while len(tiles) % 8:
    tiles.append(np.zeros((112, 112, 3), np.uint8))
grid = np.vstack([np.hstack(tiles[i:i + 8]) for i in range(0, len(tiles), 8)])
out = config.data_dir / "test_aligned.jpg"
cv2.imwrite(str(out), grid)
print("saved", out)

#!/usr/bin/env python3
"""Attach renders made by render_shuttles.py to shuttles.json (shuttles/img/<sha>.webp).

Usage: python scripts/attach_renders.py <render-cache-dir> [out-dir]
Missing renders are fine: those shuttles just have no full render yet.
"""
import json, shutil, sys
from pathlib import Path

cache = Path(sys.argv[1]).resolve()
out = Path(sys.argv[2] if len(sys.argv) > 2 else ".").resolve()
data = json.loads((out / "shuttles.json").read_text(encoding="utf-8"))

img_out = out / "shuttles" / "img"
if img_out.exists():
    shutil.rmtree(img_out)
img_out.mkdir(parents=True)

n = 0
for s in data["shuttles"]:
    src = cache / f"{s.get('mapSha')}.webp"
    if "mapSha" in s and src.exists():
        shutil.copy(src, img_out / src.name)
        s["image"] = f"shuttles/img/{src.name}"
        n += 1
(out / "shuttles.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{n}/{len(data['shuttles'])} shuttles have full renders")

#!/usr/bin/env python3
"""Add shuttle renders to the zoomable map viewer's maps.json (<site-dir>/viewer/maps.json).

Usage: python scripts/viewer_shuttles.py <site-dir>
Needs <site-dir>/shuttles.json with `image` filled in (attach_renders.py). Each shuttle with a full render
becomes a map `ship-<id>`, grouped by shop group, openable as viewer/?map=ship-<id>.
"""
import json, sys
from pathlib import Path

site = Path(sys.argv[1])
conf_path = site / "viewer" / "maps.json"
conf = json.loads(conf_path.read_text(encoding="utf-8"))
shuttles = json.loads((site / "shuttles.json").read_text(encoding="utf-8"))["shuttles"]

conf["maps"] = {}  # the viewer lists shuttles only; rebuilt on every run
n = 0
for s in shuttles:
    if not s.get("image"):
        continue
    conf["maps"].setdefault(f"Шаттлы: {s['group']}", {})[f"ship-{s['id']}"] = {
        "name": s["name"],
        "url": "../" + s["image"],
    }
    conf.setdefault("main", f"ship-{s['id']}")
    if not conf["main"]:
        conf["main"] = f"ship-{s['id']}"
    n += 1
conf_path.write_text(json.dumps(conf, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"{n} shuttles added to viewer maps.json")

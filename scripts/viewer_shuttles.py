#!/usr/bin/env python3
"""Add shuttle and POI renders to the zoomable map viewer's maps.json (<site-dir>/viewer/maps.json).

Usage: python scripts/viewer_shuttles.py <site-dir>
Needs <site-dir>/shuttles.json with `image`/`minimap` filled in. Each shuttle with a render or a mini map
becomes a map `ship-<id>`, grouped by shop group, openable as viewer/?map=ship-<id>. POI become `poi-<id>` in the group "POI".
"""
import json, sys
from pathlib import Path

site = Path(sys.argv[1])
conf_path = site / "viewer" / "maps.json"
conf = json.loads(conf_path.read_text(encoding="utf-8"))
data = json.loads((site / "shuttles.json").read_text(encoding="utf-8"))
entries = [("ship", f"Верфь: {s['group']}", s) for s in data["shuttles"]] + [("poi", "POI", s) for s in data.get("pois", [])]

conf["maps"] = {}  # the viewer lists shuttles only; rebuilt on every run
n = 0
conf["main"] = ""
for kind, group, s in entries:
    if not (s.get("image") or s.get("minimap")):
        continue
    conf["maps"].setdefault(group, {})[f"{kind}-{s['id']}"] = {
        "name": s["name"],
        "url": "../" + s["image"] if s.get("image") else None,
        "mini": "../" + s["minimap"] if s.get("minimap") else None,
    }
    if not conf["main"]:
        conf["main"] = f"{kind}-{s['id']}"
    n += 1
conf_path.write_text(json.dumps(conf, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"{n} shuttles and POI added to viewer maps.json")

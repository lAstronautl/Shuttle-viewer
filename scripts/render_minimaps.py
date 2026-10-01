#!/usr/bin/env python3
"""Render shuttle and POI mini maps with starhorizon-map-render and attach them to shuttles.json.

Usage: python scripts/render_minimaps.py <path-to-StarHorizon> <path-to-starhorizon-map-render> [out-dir]

Needs the map renderer built first: `npm ci && npm run build --workspace=renderer`.
"""
import json, shutil, subprocess, sys, tempfile
from pathlib import Path

sh = Path(sys.argv[1]).resolve()
tool = Path(sys.argv[2]).resolve()
out = Path(sys.argv[3] if len(sys.argv) > 3 else ".").resolve()
cli = tool / "renderer" / "dist" / "cli.js"

data = json.loads((out / "shuttles.json").read_text(encoding="utf-8"))
mini_out = out / "shuttles" / "mini"
if mini_out.exists():
    shutil.rmtree(mini_out)
mini_out.mkdir(parents=True)

def png_area(f):
    with open(f, "rb") as fh:
        head = fh.read(24)
    return int.from_bytes(head[16:20], "big") * int.from_bytes(head[20:24], "big")


items = data["shuttles"] + data.get("pois", [])
done = {}  # sha -> relative path (shuttles often share a map file)
tmp = Path(tempfile.mkdtemp())
for s in items:
    sha = s.get("mapSha")
    if not sha:
        continue
    if sha not in done:
        target = tmp / f"{sha}.png"
        r = subprocess.run(["node", str(cli), "-i", str(sh / "Resources" / s["mapFile"].lstrip("/")), "-o", str(target)],
                           capture_output=True, text=True)
        # multi-grid maps are written as <sha>-grid(<uid>).png; use the biggest grid
        grids = [target] if target.exists() else sorted(tmp.glob(f"{sha}-grid*.png"), key=png_area, reverse=True)
        produced = grids[0] if grids else None
        if r.returncode != 0 or produced is None:
            print(f"minimap failed for {s['id']}: {r.stderr.strip()[:200]}", file=sys.stderr)
            continue
        shutil.copy(produced, mini_out / f"{sha}.png")
        done[sha] = f"shuttles/mini/{sha}.png"
    s["minimap"] = done[sha]

(out / "shuttles.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{sum(1 for s in items if s.get('minimap'))}/{len(items)} shuttles and POI have mini maps")

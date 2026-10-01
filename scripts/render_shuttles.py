#!/usr/bin/env python3
"""Render shuttle maps with StarHorizon's Content.MapRenderer and attach them to shuttles.json.

Usage: python scripts/render_shuttles.py <path-to-StarHorizon> <cache-dir> [out-dir]

Renders are content-addressed (<sha1 of map file>.webp in <cache-dir>), so only new or changed
shuttle maps are rendered. Requires a built Content.MapRenderer (`dotnet build Content.MapRenderer -c Release`).
"""
import json, os, shutil, subprocess, sys, tempfile
from pathlib import Path

root = Path(sys.argv[1]).resolve()
cache = Path(sys.argv[2]).resolve()
out = Path(sys.argv[3] if len(sys.argv) > 3 else ".").resolve()
cache.mkdir(parents=True, exist_ok=True)
dotnet = os.environ.get("DOTNET", "dotnet")

data = json.loads((out / "shuttles.json").read_text(encoding="utf-8"))
todo = {}  # sha -> map file
for s in data["shuttles"]:
    if "mapSha" in s and not (cache / f"{s['mapSha']}.webp").exists():
        todo[s["mapSha"]] = root / "Resources" / s["mapFile"].lstrip("/")

if os.environ.get("RENDER_LIMIT"):  # for quick local tests
    todo = dict(list(todo.items())[:int(os.environ["RENDER_LIMIT"])])
print(f"{len(todo)} maps to render ({len(data['shuttles'])} shuttles)", flush=True)
if todo:
    stage = Path(tempfile.mkdtemp())
    renders = stage / "out"
    files = []
    for sha, src in todo.items():  # unique file names: some shuttles share a file name
        dst = stage / f"{sha}.yml"
        shutil.copy(src, dst)
        files.append(str(dst))
    # Render in batches so one crash doesn't lose everything; finished renders are moved to the cache immediately.
    BATCH = int(os.environ.get("RENDER_BATCH", "10"))
    for i in range(0, len(files), BATCH):
        batch = files[i:i + BATCH]
        r = subprocess.run([dotnet, "run", "--project", "Content.MapRenderer", "-c", "Release", "--no-build", "--",
                            "--format", "webp", "-o", str(renders), "-f", *batch], cwd=root)
        if r.returncode != 0:
            print(f"renderer exited with {r.returncode} for batch {i // BATCH}", file=sys.stderr)
        for f in batch:
            sha = Path(f).stem
            png = renders / sha / f"{sha}-0.webp"
            if png.exists():
                shutil.move(png, cache / f"{sha}.webp")
        print(f"batch {i // BATCH + 1}/{-(-len(files) // BATCH)} done", flush=True)

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
print(f"{n}/{len(data['shuttles'])} shuttles have renders")

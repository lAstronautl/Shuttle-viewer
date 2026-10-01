#!/usr/bin/env python3
"""Render shuttle and POI maps with StarHorizon's Content.MapRenderer into a content-addressed cache directory.

Usage: python scripts/render_shuttles.py <path-to-StarHorizon> <cache-dir> [dir-with-shuttles.json]

The site build attaches the result with scripts/attach_renders.py.

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
items = data["shuttles"] + data.get("pois", [])
# RENDER_ONLY: comma-separated shuttle/POI ids or names (case-insensitive, name may be partial); empty = all
# RENDER_FORCE=true: re-render even if a cached render exists
only = [x.strip().lower() for x in os.environ.get("RENDER_ONLY", "").split(",") if x.strip()]
force = os.environ.get("RENDER_FORCE", "").lower() in ("1", "true", "yes")


def selected(s):
    if not only:
        return True
    return any(o == s["id"].lower() or o in s["name"].lower() for o in only)


matched = [s for s in items if selected(s)]
if only:
    print(f"RENDER_ONLY={only}: matched {[s['id'] for s in matched]}", flush=True)
    if not matched:
        sys.exit("nothing matches RENDER_ONLY")

todo = {}  # sha -> map file
for s in matched:
    if "mapSha" in s and (force or not (cache / f"{s['mapSha']}.webp").exists()):
        todo[s["mapSha"]] = root / "Resources" / s["mapFile"].lstrip("/")

if os.environ.get("RENDER_LIMIT"):  # for quick local tests
    todo = dict(list(todo.items())[:int(os.environ["RENDER_LIMIT"])])
print(f"{len(todo)} maps to render ({len(data['shuttles'])} shuttles, {len(data.get('pois', []))} POI)", flush=True)
if todo:
    stage = Path(tempfile.mkdtemp())
    renders = stage / "out"
    files = []
    for sha, src in todo.items():  # unique file names: some shuttles share a file name
        dst = stage / f"{sha}.yml"
        shutil.copy(src, dst)
        files.append(str(dst))
    BATCH = int(os.environ.get("RENDER_BATCH", "10"))

    def run(batch):
        r = subprocess.run([dotnet, "run", "--project", "Content.MapRenderer", "-c", "Release", "--no-build", "--",
                            "--format", "webp", "-o", str(renders), "-f", *batch], cwd=root)
        if r.returncode != 0:
            print(f"renderer exited with {r.returncode} for {len(batch)} map(s)", file=sys.stderr)

    def collect(batch):
        """Move finished renders to the cache; return the files that produced nothing."""
        missing = []
        for f in batch:
            sha = Path(f).stem
            # a map may hold several grids (e.g. a POI with docked ships): keep the biggest one
            grids = sorted((renders / sha).glob(f"{sha}-*.webp"), key=lambda g: g.stat().st_size, reverse=True)
            if grids:
                shutil.move(grids[0], cache / f"{sha}.webp")
            else:
                missing.append(f)
        return missing

    # Render in batches (one process start is slow). A crash of the renderer on one map kills the whole batch,
    # so every map left without a result is retried alone: only a really broken map is reported as failed.
    for i in range(0, len(files), BATCH):
        batch = files[i:i + BATCH]
        run(batch)
        missing = collect(batch)
        if len(batch) > 1:
            for f in missing:
                run([f])
                for bad in collect([f]):
                    print(f"::warning::render failed for {Path(bad).stem} ({todo[Path(bad).stem].name})", file=sys.stderr)
        else:
            for bad in missing:
                print(f"::warning::render failed for {Path(bad).stem} ({todo[Path(bad).stem].name})", file=sys.stderr)
        print(f"batch {i // BATCH + 1}/{-(-len(files) // BATCH)} done", flush=True)

# keep only renders that current shuttles/POI still reference, so the cache/artifact doesn't grow forever
used = {f"{s['mapSha']}.webp" for s in items if "mapSha" in s}
for f in cache.glob("*.webp"):
    if f.name not in used:
        f.unlink()
print(f"{sum(1 for f in used if (cache / f).exists())}/{len(used)} maps have renders in {cache}")

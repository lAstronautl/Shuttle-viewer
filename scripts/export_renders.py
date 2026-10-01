#!/usr/bin/env python3
"""Export shuttle renders under human-readable names.

Usage: python scripts/export_renders.py <render-cache-dir> <out> [--only id_or_name,...] [--minimaps <dir-with-shuttles/mini>]

<out> ending in .zip -> a zip archive, otherwise a directory. Files are named after the shuttle
(`NT Vagabond.webp`); if two shuttles share a name the id is appended. Reads ./shuttles.json.
"""
import argparse, json, re, shutil, sys, zipfile
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("cache")
ap.add_argument("out")
ap.add_argument("--only", default="")
ap.add_argument("--data", default="shuttles.json")
ap.add_argument("--minimaps", default="", help="also export mini maps from <dir>/shuttles/mini as '<name> (mini).png'")
a = ap.parse_args()

cache = Path(a.cache)
only = [x.strip().lower() for x in a.only.split(",") if x.strip()]
shuttles = json.loads(Path(a.data).read_text(encoding="utf-8"))["shuttles"]


def safe(name):
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(". ") or "shuttle"


entries = []  # (file name, source path)
used = set()
for s in shuttles:
    if only and not any(o == s["id"].lower() or o in s["name"].lower() for o in only):
        continue
    sha = s.get("mapSha")
    sources = []
    if sha and (cache / f"{sha}.webp").exists():
        sources.append(("", cache / f"{sha}.webp", ".webp"))
    if a.minimaps and s.get("minimap") and (Path(a.minimaps) / s["minimap"]).exists():
        sources.append((" (mini)", Path(a.minimaps) / s["minimap"], ".png"))
    if not sources:
        continue
    base = safe(s["name"])
    if f"{base.lower()}" in used:
        base = f"{base} [{safe(s['id'])}]"
    used.add(base.lower())
    for suffix, src, ext in sources:
        entries.append((f"{base}{suffix}{ext}", src))

if not entries:
    sys.exit("nothing to export (no matching renders)")

if a.out.endswith(".zip"):
    with zipfile.ZipFile(a.out, "w", zipfile.ZIP_STORED) as z:  # webp/png are already compressed
        for name, src in entries:
            z.write(src, name)
else:
    Path(a.out).mkdir(parents=True, exist_ok=True)
    for name, src in entries:
        shutil.copy(src, Path(a.out) / name)
print(f"exported {len(entries)} files to {a.out}")

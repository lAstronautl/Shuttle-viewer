#!/usr/bin/env python3
"""Build shuttles.json (vessel + pointOfInterest prototypes) from a StarHorizon checkout.

Usage: python scripts/build_shuttles.py <path-to-StarHorizon> [out-dir]
"""
import datetime, hashlib, json, re, sys
from pathlib import Path

import yaml


BaseLoader = getattr(yaml, 'CSafeLoader', yaml.SafeLoader)


class Loader(BaseLoader):
    pass


# prototypes use custom tags (!type:Foo); treat them as plain data
Loader.add_multi_constructor("!", lambda l, s, n: l.construct_mapping(n) if isinstance(n, yaml.MappingNode)
                             else l.construct_sequence(n) if isinstance(n, yaml.SequenceNode)
                             else l.construct_scalar(n))



def load_yaml(p):
    try:
        return yaml.load(p.read_text(encoding="utf-8"), Loader) or []
    except Exception as e:
        print(f"skip {p}: {e}", file=sys.stderr)
        return []


def protos(root, kind):
    for p in sorted((root / "Resources/Prototypes").rglob("*.yml")):
        if f"type: {kind}" not in p.read_text(encoding="utf-8", errors="ignore"):
            continue
        data = load_yaml(p)
        if not isinstance(data, list):
            continue
        for d in data:
            if isinstance(d, dict) and d.get("type") == kind:
                yield p, d


def main():
    root = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2] if len(sys.argv) > 2 else ".").resolve()

    vessels = {d["id"]: (p, d) for p, d in protos(root, "vessel")}

    def resolve(vid, seen=()):
        _, d = vessels[vid]
        merged = {}
        parents = d.get("parent") or []
        if isinstance(parents, str):
            parents = [parents]
        for par in parents:
            if par in vessels and par not in seen:
                merged.update(resolve(par, seen + (vid,)))
        merged.update({k: v for k, v in d.items() if k not in ("abstract",)})
        return merged

    guides = {d["id"]: d.get("text") for _, d in protos(root, "guideEntry")}
    cyrillic = re.compile("[А-Яа-яЁё]")
    quote = re.compile(r'^\s*"(.{10,})"\s*$')

    def guide_description(page):
        """The localized (Russian) shuttle description: the quoted line in the shuttle's guidebook page."""
        path = guides.get(page) if page else None
        xml = root / "Resources" / path.lstrip("/") if path else None
        if not xml or not xml.exists():
            return None
        for line in xml.read_text(encoding="utf-8").splitlines():
            m = quote.match(line)
            if m and cyrillic.search(m.group(1)):
                return m.group(1).strip()
        return None

    # manual Russian descriptions for shuttles that have no localization in StarHorizon: {"<vessel id>": "text"}
    overrides_file = Path(__file__).with_name("descriptions_ru.json")
    overrides = json.loads(overrides_file.read_text(encoding="utf-8")) if overrides_file.exists() else {}

    shuttles = []
    for vid, (path, raw) in vessels.items():
        if raw.get("abstract"):
            continue
        d = resolve(vid)
        if "price" not in d or not d.get("shuttlePath"):
            continue
        s = {
            "id": vid,
            "name": d.get("name", vid),
            "description": d.get("description", ""),
            "price": d["price"],
            "category": d.get("category"),
            "group": d.get("group"),
            "class": d.get("class") or [],
            "engine": d.get("engine") or [],
            "access": d.get("access") or None,
            "image": None,  # filled in by render_shuttles.py
        }
        ru = overrides.get(vid) or (None if cyrillic.search(s["description"]) else guide_description(d.get("guidebookPage")))
        if ru:
            s["descriptionRu"] = ru
        map_file = root / "Resources" / str(d["shuttlePath"]).lstrip("/")
        if map_file.exists():
            s["mapFile"] = str(d["shuttlePath"])
            s["mapSha"] = hashlib.sha1(map_file.read_bytes()).hexdigest()[:16]
        shuttles.append(s)

    shuttles.sort(key=lambda x: (str(x["group"]), x["price"]))

    # points of interest: the name is literal text or a localization key (poi-*-name) from Resources/Locale
    ftl = {}
    for lang in ("en-US", "ru-RU"):  # ru-RU last so it wins
        for f in (root / "Resources" / "Locale" / lang).rglob("*.ftl"):
            for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
                m = re.match(r"^(poi-[\w-]+)\s*=\s*(.+?)\s*$", line)
                if m:
                    ftl[m.group(1)] = m.group(2)

    pois = []
    for path, d in protos(root, "pointOfInterest"):
        if d.get("abstract") or not d.get("gridPath"):
            continue
        name = str(d.get("name") or d["id"])
        poi = {
            "id": d["id"],
            "name": ftl.get(name, name),
            "group": "POI",
            "spawnGroup": d.get("spawnGroup") or None,
            "image": None,
        }
        map_file = root / "Resources" / str(d["gridPath"]).lstrip("/")
        if not map_file.exists():
            print(f"skip POI {d['id']}: {d['gridPath']} not found", file=sys.stderr)
            continue
        poi["mapFile"] = str(d["gridPath"])
        poi["mapSha"] = hashlib.sha1(map_file.read_bytes()).hexdigest()[:16]
        pois.append(poi)
    pois.sort(key=lambda x: x["name"].lower())

    (out / "shuttles.json").write_text(json.dumps({"generated": datetime.date.today().isoformat(), "shuttles": shuttles, "pois": pois}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(shuttles)} shuttles, {len(pois)} POI")


main()

# /// script
# requires-python = ">=3.11"
# dependencies = ["osmium>=4", "shapely>=2"]
# ///
"""Read an OSM extract and write the features of the game as static cell files.

    uv run scripts/build-cells.py [build/data/sweden-latest.osm.pbf]

Output: public/cells/{cx}_{cy}.json and public/cells/meta.json.
A cell is 0.1 degrees of longitude by 0.05 degrees of latitude (about 5.5 km).
A feature is [id, lat, lon, type index, name or 0, wikidata id or 0, radius in m or 0].
"""
import json
import math
import shutil
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import osmium
import shapely

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'build/data/sweden-latest.osm.pbf'
OUT = ROOT / 'public/cells'
CELL_LON, CELL_LAT = 0.1, 0.05
BASE_RADIUS, MAX_RADIUS = 30, 500

types = json.loads((ROOT / 'src/types.json').read_text())
type_index = {(t['k'], t['v']): i for i, t in enumerate(types)}
keys = sorted({t['k'] for t in types})


def matches(tags):
    if tags.get('access') in ('private', 'no'):
        return []
    return [type_index[(k, tags[k])] for k in keys if k in tags and (k, tags[k]) in type_index]


def area_radius(geom, lat):
    """Collect radius of an area: 30 m plus half the radius of a circle of the same size."""
    m2 = geom.area * 111_320 ** 2 * math.cos(math.radians(lat))
    return min(MAX_RADIUS, round(BASE_RADIUS + 0.5 * math.sqrt(m2 / math.pi)))


wkb = osmium.geom.WKBFactory()
features = []  # (id, lat, lon, [type indexes], name, wikidata, radius)
t0 = time.time()
fp = (osmium.FileProcessor(str(SRC))
      .with_locations()
      .with_areas()
      .with_filter(osmium.filter.TagFilter(*type_index.keys())))
for o in fp:
    found = matches(o.tags)
    if not found:
        continue
    radius = 0
    if o.is_node():
        oid, lat, lon = f'n{o.id}', o.location.lat, o.location.lon
    elif o.is_way():
        if o.is_closed():
            continue  # arrives again as an area
        nodes = [n for n in o.nodes if n.location.valid()]
        if not nodes:
            continue
        mid = nodes[len(nodes) // 2].location
        oid, lat, lon = f'w{o.id}', mid.lat, mid.lon
    elif o.is_area():
        try:
            geom = shapely.from_wkb(wkb.create_multipolygon(o), on_invalid='ignore')
        except RuntimeError:
            continue
        if geom is None or geom.is_empty:
            continue
        p = geom.representative_point()
        oid = f"{'w' if o.from_way() else 'r'}{o.orig_id()}"
        lat, lon = p.y, p.x
        radius = area_radius(geom, lat)
    else:
        continue
    features.append((oid, round(lat, 5), round(lon, 5), found,
                     o.tags.get('name', '') or 0, o.tags.get('wikidata', '') or 0, radius))

# A feature with two matching tags becomes one card, of the type with the lower count.
counts = Counter(i for f in features for i in f[3])
cells = defaultdict(list)
final = Counter()
for oid, lat, lon, found, name, wd, radius in features:
    t = min(found, key=lambda i: counts[i])
    final[t] += 1
    row = [oid, lat, lon, t, name, wd, radius if radius > BASE_RADIUS else 0]
    while len(row) > 4 and row[-1] == 0:
        row.pop()
    cells[(math.floor(lon / CELL_LON), math.floor(lat / CELL_LAT))].append(row)

shutil.rmtree(OUT, ignore_errors=True)
OUT.mkdir(parents=True)
for (cx, cy), rows in cells.items():
    (OUT / f'{cx}_{cy}.json').write_text(
        json.dumps(rows, ensure_ascii=False, separators=(',', ':')))
(OUT / 'meta.json').write_text(json.dumps({
    'built': time.strftime('%Y-%m-%d'),
    'cellLon': CELL_LON,
    'cellLat': CELL_LAT,
    'counts': [final[i] for i in range(len(types))],
}))
size = sum(f.stat().st_size for f in OUT.iterdir())
print(f'{len(features)} features, {len(cells)} cells, {size / 1e6:.1f} MB, {time.time() - t0:.0f} s')

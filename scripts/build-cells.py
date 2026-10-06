# /// script
# requires-python = ">=3.11"
# dependencies = ["osmium>=4", "shapely>=2"]
# ///
"""Read an OSM extract and write the features of the game as static cell files.

    uv run scripts/build-cells.py [build/data/sweden-latest.osm.pbf]

Output: public/cells/{cx}_{cy}.json and public/cells/meta.json.
A cell is 0.1 degrees of longitude by 0.05 degrees of latitude (about 5.5 km).
A feature is [id, lat, lon, type index, name or 0, wikidata id or 0, radius in m or 0].
meta.json holds the count of each type in the extract, before the removal of close epic cards.
"""
import json
import math
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

import osmium
import shapely

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'build/data/sweden-latest.osm.pbf'
OUT = ROOT / 'public/cells'
CELL_LON, CELL_LAT = 0.1, 0.05
BASE_RADIUS, MAX_RADIUS = 30, 500
EPIC_BELOW, EPIC_SPACING = 300, 2000

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
final = Counter()
cards = []
for oid, lat, lon, found, name, wd, radius in features:
    t = min(found, key=lambda i: counts[i])
    final[t] += 1
    cards.append((oid, lat, lon, t, name, wd, radius))

# A legendary place is not also a normal card.
legendary = {p['id'][1:] for p in json.loads((ROOT / 'src/legendary.json').read_text())}
cards = [c for c in cards if c[0] not in legendary]

# Epic cards lie at least EPIC_SPACING apart, so that one walk does not give two of them.
# In a group, the card with a Wikipedia article stays, then the card with a name, then the lowest id.
# EPIC_BELOW is the same limit as in `levelOf` in src/main.js.
def metres(a, b):
    return math.hypot((b[2] - a[2]) * math.cos(math.radians(a[1])), b[1] - a[1]) * 111_320


def with_article(ids):
    """The Wikidata ids that have a page on Swedish or English Wikipedia.

    The answers of Wikidata are kept in build/data/sitelinks.json. Remove the file to ask again.
    """
    cache_file = SRC.parent / 'sitelinks.json'
    cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    todo = sorted(i for i in ids if i not in cache and re.fullmatch(r'Q\d+', i))
    for n in range(0, len(todo), 50):
        batch = todo[n:n + 50]
        url = 'https://www.wikidata.org/w/api.php?' + urllib.parse.urlencode({
            'action': 'wbgetentities', 'ids': '|'.join(batch), 'props': 'sitelinks', 'sitefilter': 'svwiki|enwiki', 'format': 'json'})
        for attempt in range(8):
            try:
                request = urllib.request.Request(url, headers={'User-Agent': 'landmark-cards cell build'})
                entities = json.load(urllib.request.urlopen(request, timeout=60)).get('entities', {})
                break
            except urllib.error.HTTPError as err:  # 429: Wikidata wants a slower rate
                time.sleep(min(int(err.headers.get('Retry-After') or 0) or 5 * (attempt + 1), 60))
        else:
            raise SystemExit('Wikidata refuses the requests')
        found = {}
        for entity in entities.values():  # an id that is a redirect comes back under the new id
            for q in (entity.get('id'), entity.get('redirects', {}).get('from')):
                if q:
                    found[q] = bool(entity.get('sitelinks'))
        cache.update({q: found.get(q, False) for q in batch})
        cache_file.write_text(json.dumps(cache))
        time.sleep(1)
    return {i for i in ids if cache.get(i)}


epic = [c for c in cards if final[c[3]] < EPIC_BELOW]
article = with_article({c[5] for c in epic if c[5]})
grid = defaultdict(list)
removed = set()
for c in sorted(epic, key=lambda c: (c[5] not in article, not c[4], c[0])):
    gx, gy = int(c[2] * 111_320 * math.cos(math.radians(c[1])) // EPIC_SPACING), int(c[1] * 111_320 // EPIC_SPACING)
    if any(metres(c, k) < EPIC_SPACING for dx in (-2, -1, 0, 1, 2) for dy in (-1, 0, 1) for k in grid[(gx + dx, gy + dy)]):
        removed.add(c[0])
    else:
        grid[(gx, gy)].append(c)

cells = defaultdict(list)
for oid, lat, lon, t, name, wd, radius in cards:
    if oid in removed:
        continue
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
print(f'{len(features)} features, {len(removed)} epic cards removed for spacing, {len(cells)} cells, {size / 1e6:.1f} MB, {time.time() - t0:.0f} s')

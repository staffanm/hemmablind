# /// script
# requires-python = ">=3.11"
# dependencies = ["osmium>=4", "shapely>=2"]
# ///
"""Read an OSM extract and write the features of the game as static cell files.

    uv run scripts/build-cells.py [build/data/sweden-latest.osm.pbf]

Output: public/cells/{cx}_{cy}.json and public/cells/meta.json.
A cell is 0.1 degrees of longitude by 0.05 degrees of latitude (about 5.5 km).
A feature is [id, lat, lon, type index, name or 0, wikidata id or 0, radius in m or 0, link or 0, variant or 0].
The id is the OSM id (n, w or r and a number), or the id of a source in src/sources.json, a dot and the id in that source.
meta.json holds the count of each type in the extract, before the density rule removes cards.
"""
import json
import math
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

import osmium
import shapely
import shapely.geometry

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'build/data/sweden-latest.osm.pbf'
OUT = ROOT / 'public/cells'
CELL_LON, CELL_LAT = 0.1, 0.05
BASE_RADIUS, MAX_RADIUS = 30, 500
LEVEL_LIMITS = (10001, 2000, 300)  # the lowest count of a common, an uncommon and a rare type
# level -> (most cards, metres apart) for the density rule
DENSITY = {0: (3, 300), 1: (2, 500), 2: (1, 1000), 3: (1, 2000)}

types = json.loads((ROOT / 'src/types.json').read_text())
type_index = {(t['k'], t['v']): i for i, t in enumerate(types)}
keys = sorted({t['k'] for t in types})
# A type can have variants: the value of one more tag gives the card a more exact name.
variant_tags = sorted({t['variants']['tag'] for t in types if 'variants' in t})


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
                     o.tags.get('name', '') or 0, o.tags.get('wikidata', '') or 0, radius,
                     {tag: o.tags[tag] for tag in variant_tags if tag in o.tags}))

# A feature with two matching tags becomes one card, of the type with the lower count.
counts = Counter(i for f in features for i in f[3])
final = Counter()
cards = []
for oid, lat, lon, found, name, wd, radius, tags in features:
    t = min(found, key=lambda i: counts[i])
    final[t] += 1
    # The variant is 1 for the first value in the `variants` list of the type, and 0 for no variant.
    variants = types[t].get('variants')
    variant = variants and next((n for n, v in enumerate(variants['values'], 1) if v[0] == tags.get(variants['tag'])), 0)
    cards.append((oid, lat, lon, t, name, wd, radius, 0, variant or 0))

# A legendary place is not also a normal card.
legendary = {p['id'][1:] for p in json.loads((ROOT / 'src/legendary.json').read_text())}
cards = [c for c in cards if c[0] not in legendary]

# The density rule: a card has at most `most` cards of its group within `apart` metres, itself included.
# A group is one type. For the epic level, a group is all epic types together.
# LEVEL_LIMITS are the same limits as in `levelOf` in src/main.js.
def level(t):
    return next((lv for lv, limit in enumerate(LEVEL_LIMITS) if final[t] >= limit), 3)


def metres(a, b):
    return math.hypot((b[2] - a[2]) * math.cos(math.radians(a[1])), b[1] - a[1]) * 111_320


def with_article(ids):
    """The Wikidata ids that have a page on Swedish or English Wikipedia.

    The answers of the Wikidata query service are kept in build/data/sitelinks.json. Remove the file to ask again.
    """
    cache_file = SRC.parent / 'sitelinks.json'
    cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    todo = sorted(i for i in ids if i not in cache and re.fullmatch(r'Q\d+', i))
    for n in range(0, len(todo), 500):
        batch = todo[n:n + 500]
        query = ('SELECT DISTINCT ?item WHERE { VALUES ?item { %s } ?page schema:about ?item ; schema:isPartOf ?site . '
                 'FILTER(?site IN (<https://sv.wikipedia.org/>, <https://en.wikipedia.org/>)) }' % ' '.join('wd:' + i for i in batch))
        request = urllib.request.Request(
            'https://query.wikidata.org/sparql', data=urllib.parse.urlencode({'query': query}).encode(),
            headers={'Accept': 'application/sparql-results+json', 'User-Agent': 'landmark-cards cell build'})
        rows = json.load(urllib.request.urlopen(request, timeout=120))['results']['bindings']
        found = {row['item']['value'].rsplit('/', 1)[1] for row in rows}
        cache.update({q: q in found for q in batch})
        cache_file.write_text(json.dumps(cache))
        time.sleep(1)
    return {i for i in ids if cache.get(i)}


def too_dense(group, most, apart):
    """The ids to remove from a group. In a crowd, a card in src/specials.json stays,
    then the card with a Wikipedia article, then the card with a name, then the lowest id."""
    grid = defaultdict(list)
    near = {}  # id -> the number of kept cards within `apart`
    gone = set()
    for c in sorted(group, key=lambda c: (c[0] not in specials, c[5] not in article, not c[4], c[0])):
        # A grid square is `apart` wide at 62 degrees north, and narrower in the north: look two squares to each side.
        gx, gy = int(c[2] * 111_320 * math.cos(math.radians(62)) // apart), int(c[1] * 111_320 // apart)
        close = [k for dx in (-2, -1, 0, 1, 2) for dy in (-1, 0, 1) for k in grid[(gx + dx, gy + dy)] if metres(c, k) < apart]
        if len(close) >= most or any(near[k[0]] >= most - 1 for k in close):
            gone.add(c[0])
            continue
        for k in close:
            near[k[0]] += 1
        near[c[0]] = len(close)
        grid[(gx, gy)].append(c)
    return gone


# The sources in src/sources.json are open data of a municipality or an agency, as GeoJSON.
# A source place within `match` metres of an OSM card of the same type gives its name and link to that card.
# A source place without an OSM card becomes a new card. build/data/sources/ keeps the downloads.
def source_places(source):
    cache_file = SRC.parent / 'sources' / f"{source['id']}.json"
    if not cache_file.exists():
        cache_file.parent.mkdir(exist_ok=True)
        request = urllib.request.Request(source['url'], headers={'User-Agent': 'landmark-cards cell build'})
        cache_file.write_bytes(urllib.request.urlopen(request, timeout=120).read())
    fields = source['fields']
    for f in json.loads(cache_file.read_text())['features']:
        point = shapely.geometry.shape(f['geometry']).representative_point()
        if not (55 < point.y < 70 and 10 < point.x < 25):
            raise SystemExit(f"{source['id']}: a position is outside Sweden. The source must give EPSG:4326.")
        link = f['properties'].get(fields.get('link')) or ''
        yield (re.sub(r'[^A-Za-z0-9_-]', '', str(f['properties'][fields['id']])), round(point.y, 5), round(point.x, 5),
               f['properties'].get(fields.get('name')) or 0, link if link.startswith('https://') else 0)


for source in json.loads((ROOT / 'src/sources.json').read_text()):
    t = type_index[tuple(source['type'].split('='))]
    grid = defaultdict(list)  # squares of 0.01 degrees -> indexes in `cards`
    for i, c in enumerate(cards):
        if c[3] == t:
            grid[(int(c[2] * 100), int(c[1] * 100))].append(i)
    named = added = 0
    for sid, lat, lon, name, link in source_places(source):
        here = (0, lat, lon)
        close = [i for dx in (-1, 0, 1) for dy in (-1, 0, 1) for i in grid[(int(lon * 100) + dx, int(lat * 100) + dy)]]
        i = min(close, key=lambda i: metres(here, cards[i]), default=None)
        if i is not None and metres(here, cards[i]) <= source['match']:
            c = cards[i]
            named += bool(name and not c[4])
            cards[i] = (*c[:4], c[4] or name, c[5], c[6], link, c[8])
        else:
            cards.append((f"{source['id']}.{sid}", lat, lon, t, name, 0, 0, link, 0))
            final[t] += 1
            added += 1
    print(f"{source['id']}: {named} OSM cards got a name, {added} new cards")

article = with_article({c[5] for c in cards if c[5]})
specials = set(json.loads((ROOT / 'src/specials.json').read_text()))
groups = defaultdict(list)
for c in cards:
    groups['epic' if level(c[3]) == 3 else c[3]].append(c)
removed = set()
for key, group in groups.items():
    removed |= too_dense(group, *DENSITY[3 if key == 'epic' else level(key)])

cells = defaultdict(list)
for oid, lat, lon, t, name, wd, radius, link, variant in cards:
    if oid in removed:
        continue
    row = [oid, lat, lon, t, name, wd, radius if radius > BASE_RADIUS else 0, link, variant]
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
print(f'{len(features)} features, {len(removed)} removed by the density rule, {len(cards) - len(removed)} cards, {len(cells)} cells, {size / 1e6:.1f} MB, {time.time() - t0:.0f} s')

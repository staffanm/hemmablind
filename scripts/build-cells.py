# /// script
# requires-python = ">=3.11"
# dependencies = ["osmium>=4", "shapely>=2", "pyproj>=3"]
# ///
"""Read an OSM extract and write the features of the game as static cell files.

    uv run scripts/build-cells.py [build/data/sweden-latest.osm.pbf]

Output: public/cells/{cx}_{cy}.json and public/cells/meta.json.
A cell is 0.1 degrees of longitude by 0.05 degrees of latitude (about 5.5 km).
A feature is [id, lat, lon, type index, name, wikidata id or 0, radius in m or 0, link or 0, variant or 0, image or 0].
The name is a string, or a number when the feature has no name: the number of the card among the cards of its type.
The id is the OSM id (n, w or r and a number), or the id of a source in src/sources.json, a dot and the id in that source.
meta.json holds the count of each type in the extract, before the density rule removes cards.
"""
import csv
import hashlib
import io
import json
import math
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import osmium
import pyproj
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
NAME_APART = 2000  # cards of one type with the same name within this distance get a number each

types = json.loads((ROOT / 'src/types.json').read_text())
# A type matches one tag value, several values with `|` between them, or any value with `*`.
type_index = {(t['k'], v): i for i, t in enumerate(types) for v in t['v'].split('|') if v != '*'}
any_value = {t['k']: i for i, t in enumerate(types) if t['v'] == '*'}
keys = sorted({t['k'] for t in types})
# A notable type (shops, food and drink) leaves out chains: a brand tag, a name used NAME_CHAIN times or more,
# a shopping mall, and a place without a name.
notable = {i for i, t in enumerate(types) if t.get('notable')}
NAME_CHAIN = 5
# A type can have variants: the value of one more tag gives the card a more exact name.
variant_tags = sorted({t['variants']['tag'] for t in types if 'variants' in t})


def matches(tags):
    if tags.get('access') in ('private', 'no'):
        return []
    found = [type_index[(k, tags[k])] for k in keys if k in tags and (k, tags[k]) in type_index]
    found += [i for k, i in any_value.items() if k in tags and i not in found]
    if any(i in notable for i in found) and (tags.get('brand') or tags.get('brand:wikidata') or not tags.get('name') or tags.get('shop') == 'mall'):
        found = [i for i in found if i not in notable]
    return found


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
      .with_filter(osmium.filter.KeyFilter(*keys)))
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

# A chain is a name that NAME_CHAIN notable places or more share.
chain_names = Counter(f[4] for f in features if any(i in notable for i in f[3]))
chains = {n for n, k in chain_names.items() if k >= NAME_CHAIN}
print(f'{len(chains)} chain names left out of the notable types, for example {sorted(chains, key=chain_names.get, reverse=True)[:8]}')

# A feature with two matching tags becomes one card, of the type with the lower count.
counts = Counter(i for f in features for i in f[3])
final = Counter()
cards = []
for oid, lat, lon, found, name, wd, radius, tags in features:
    if name in chains:
        found = [i for i in found if i not in notable]
        if not found:
            continue
    t = min(found, key=lambda i: counts[i])
    final[t] += 1
    # The variant is 1 for the first value in the `variants` list of the type, and 0 for no variant.
    variants = types[t].get('variants')
    variant = variants and next((n for n, v in enumerate(variants['values'], 1) if v[0] == tags.get(variants['tag'])), 0)
    cards.append((oid, lat, lon, t, name, wd, radius, 0, variant or 0, 0))

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
            headers={'Accept': 'application/sparql-results+json', 'User-Agent': 'hemmablind cell build'})
        rows = json.load(urllib.request.urlopen(request, timeout=120))['results']['bindings']
        found = {row['item']['value'].rsplit('/', 1)[1] for row in rows}
        cache.update({q: q in found for q in batch})
        cache_file.write_text(json.dumps(cache))
        time.sleep(1)
    return {i for i in ids if cache.get(i)}


def too_dense(group, most, apart):
    """The ids to remove from a group. In a crowd, a card in src/specials.json stays,
    then the card with a Wikipedia article, then the card with an image, then the card with a name, then the lowest id."""
    grid = defaultdict(list)
    near = {}  # id -> the number of kept cards within `apart`
    gone = set()
    for c in sorted(group, key=lambda c: (c[0] not in specials, c[5] not in article, not c[9], not c[4], c[0])):
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


# The sources in src/sources.json are open data of municipalities and agencies. README.md describes the fields.
# A source place within `match` metres of an OSM card of the same type gives its name, link and image to that card.
# A source place without an OSM card becomes a new card. build/data/sources/ keeps the downloads.
def download(source):
    cache_file = SRC.parent / 'sources' / f"{source['id']}.bin"
    if not cache_file.exists():
        cache_file.parent.mkdir(exist_ok=True)
        request = urllib.request.Request(source['url'], headers={'User-Agent': 'hemmablind cell build', 'Accept': '*/*'})
        cache_file.write_bytes(urllib.request.urlopen(request, timeout=120).read())
    return cache_file.read_bytes()


def source_rows(source, data):
    """The rows of a source as dicts. A GeoJSON feature gets its geometry under 'geometry'."""
    fmt = source.get('format', 'geojson')
    if fmt == 'zip':
        archive = zipfile.ZipFile(io.BytesIO(data))
        name = next(n for n in archive.namelist() if n.endswith(('.json', '.geojson')))
        data, fmt = archive.read(name), 'geojson'
    try:
        text = data.decode('utf-8-sig')
    except UnicodeDecodeError:
        text = data.decode('cp1252', 'replace')
    if fmt == 'geojson':
        d = json.loads(text)
        named_crs = re.search(r'EPSG:+(\d+)', str(d.get('crs', {}).get('properties', {}).get('name', '')))
        if named_crs and 'crs' not in source:
            source['crs'] = int(named_crs.group(1))
        if d.get('spatialReference'):  # ArcGIS JSON: attributes and a geometry with x and y
            if 'crs' not in source and d['spatialReference'].get('wkid'):
                source['crs'] = d['spatialReference']['wkid']
            return [{**(f.get('attributes') or {}), 'x': (f.get('geometry') or {}).get('x'), 'y': (f.get('geometry') or {}).get('y')} for f in d['features']]
        return [{**(f.get('properties') or {}), 'geometry': f.get('geometry')} for f in d['features']]
    if fmt == 'rowstore':
        d = json.loads(text)
        if d.get('resultCount', 0) > len(d['results']):
            print(f"{source['id']}: the rowstore gave {len(d['results'])} of {d['resultCount']} rows")
        return d['results']
    if fmt == 'json':
        d = json.loads(text)
        return d if isinstance(d, list) else next(v for v in d.values() if isinstance(v, list))
    if fmt == 'stockholm':  # the Hitta Service API of Stockholms stad: JSON API with SWEREF99 18 00 positions
        return [{**u['attributes'], 'id': u['id'], 'east': u['attributes']['location']['east'], 'north': u['attributes']['location']['north']}
                for u in json.loads(text)['data'] if u['attributes'].get('location')]
    if fmt == 'csv':
        try:
            dialect = csv.Sniffer().sniff(text[:5000], delimiters=',;\t|')
        except csv.Error:
            dialect = csv.excel
        return list(csv.DictReader(io.StringIO(text), dialect=dialect))
    raise SystemExit(f"{source['id']}: unknown format {fmt}")


def fetch_text(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'hemmablind cell build'})
    return urllib.request.urlopen(request, timeout=60).read().decode('utf-8', 'replace')


def jsonld_rows(source):
    """Web pages with schema.org JSON-LD, as on goteborg.se. The list page `url` has `{page}` for the page number from 1,
    and `link` is a regular expression for the links to the pages of the places. Each place page gives the name,
    the image and the position in its JSON-LD. build/data/sources/<id>-pages.json keeps what the pages gave."""
    cache_file = SRC.parent / 'sources' / f"{source['id']}-pages.json"
    cache_file.parent.mkdir(exist_ok=True)
    cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    links = []
    for page in range(1, 100):
        found = [urllib.parse.urljoin(source['url'], link) for link in re.findall(source['link'], fetch_text(source['url'].replace('{page}', str(page))))]
        if not [link for link in found if link not in links]:
            break
        links += [link for link in found if link not in links]
    rows = []
    for link in links:
        if link not in cache:
            cache[link] = None
            for m in re.finditer(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', fetch_text(link), re.S):
                try:
                    d = json.loads(m.group(1))
                except ValueError:
                    continue
                if isinstance(d, dict) and isinstance(d.get('geo'), dict):
                    cache[link] = {'name': d.get('name', ''), 'image': d.get('image', ''),
                                   'latitude': d['geo'].get('latitude'), 'longitude': d['geo'].get('longitude')}
            cache_file.write_text(json.dumps(cache, ensure_ascii=False))
            time.sleep(0.3)
        if cache[link]:
            number = re.findall(r'\d+', link)
            rows.append({**cache[link], 'link': link, 'id': number[-1] if number else ''})
    return rows


transformers = {}


def to_wgs84(crs, x, y):
    if crs == 4326:
        return x, y
    if crs not in transformers:
        transformers[crs] = pyproj.Transformer.from_crs(crs, 4326, always_xy=True)
    return transformers[crs].transform(x, y)


def number(value):
    try:
        return float(str(value).replace(',', '.'))
    except ValueError:
        return None


def source_position(source, row):
    """(lat, lon) of a row, or None. Named latitude and longitude fields come first, then a GeoJSON geometry,
    then x and y fields in the `crs` of the source, then a WKB geometry with its own SRID."""
    f = source.get('fields', {})
    crs = source.get('crs', 4326)
    la, lo = number(row.get(f.get('lat', 'latitude'))), number(row.get(f.get('lon', 'longitude')))
    if la and lo:
        if 10 < la < 25 and 55 < lo < 70:  # the two fields are swapped
            la, lo = lo, la
        lo, la = to_wgs84(crs if la > 90 else 4326, lo, la)
    elif row.get('geometry'):
        try:
            g = row['geometry']
            # A point can carry extra values after x and y.
            point = shapely.Point(g['coordinates'][:2]) if g.get('type') == 'Point' else shapely.geometry.shape(g).representative_point()
        except (TypeError, ValueError, AttributeError, KeyError):  # a geometry without coordinates
            return None
        lo, la = to_wgs84(crs, point.x, point.y)
    elif f.get('x') and number(row.get(f['x'])) and number(row.get(f['y'])):
        lo, la = to_wgs84(crs, number(row[f['x']]), number(row[f['y']]))
    elif f.get('geom') and row.get(f['geom']):
        geom = shapely.from_wkb(bytes.fromhex(row[f['geom']]))
        point = geom.representative_point()
        lo, la = to_wgs84(shapely.get_srid(geom) or crs, point.x, point.y)
    else:
        return None
    if not (55 < la < 70 and 10 < lo < 25):
        return None
    return round(la, 5), round(lo, 5)


def source_places(source):
    f = source.get('fields', {})
    rows = jsonld_rows(source) if source.get('format') == 'jsonld' else source_rows(source, download(source))
    outside = 0
    for row in rows:
        row = {str(k).strip('\ufeff '): v for k, v in row.items()}
        if any(str(row.get(k, '')).strip() != v for k, v in source.get('filter', {}).items()):
            continue
        pos = source_position(source, row)
        if not pos:
            outside += 1
            continue
        lat, lon = pos
        text = lambda key, default: str(row.get(f.get(key, default)) or '').strip()
        name = text('name', 'name')
        name = 0 if name.lower() in ('', 'none', 'null') else name
        link = text('link', 'visit_url')
        link = link if link.startswith('https://') else 0
        image = text('image', '')
        image = image if image.startswith('https://') else (page_image(source, link) if link else 0)
        sid = text('id', 'id') or text('id', 'place_id')
        if not sid:  # a stable id from the name and the position
            sid = hashlib.md5(f'{name}|{lat}|{lon}'.encode()).hexdigest()[:10]
        yield re.sub(r'[^A-Za-z0-9_-]', '', sid), lat, lon, name, link, image
    if outside:
        print(f"{source['id']}: {outside} of {len(rows)} rows have no position in Sweden")


def page_image(source, link):
    """The image URL in the meta tag named by `image` in the source, on the page `link`. 0 when there is none."""
    if not source.get('image'):
        return 0
    cache_file = SRC.parent / 'sources' / f"{source['id']}-images.json"
    cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    if link not in cache:
        try:
            request = urllib.request.Request(link, headers={'User-Agent': 'hemmablind cell build'})
            page = urllib.request.urlopen(request, timeout=60).read().decode('utf-8', 'replace')
            found = re.search(r'<meta[^>]+(?:property|name)="%s"[^>]+content="([^"]+)"' % re.escape(source['image']), page)
            cache[link] = found.group(1) if found and found.group(1).startswith('https://') else 0
        except (urllib.error.URLError, TimeoutError):
            cache[link] = 0
        cache_file.write_text(json.dumps(cache))
        time.sleep(0.5)
    return cache[link]


for source in json.loads((ROOT / 'src/sources.json').read_text()):
    t = type_index[tuple(source['type'].split('='))]
    grid = defaultdict(list)  # squares of 0.01 degrees -> indexes in `cards`
    for i, c in enumerate(cards):
        if c[3] == t:
            grid[(int(c[2] * 100), int(c[1] * 100))].append(i)
    named = added = 0
    for sid, lat, lon, name, link, image in source_places(source):
        here = (0, lat, lon)
        close = [i for dx in (-1, 0, 1) for dy in (-1, 0, 1) for i in grid[(int(lon * 100) + dx, int(lat * 100) + dy)]]
        i = min(close, key=lambda i: metres(here, cards[i]), default=None)
        if i is not None and metres(here, cards[i]) <= source['match']:
            c = cards[i]
            named += bool(name and not c[4])
            cards[i] = (*c[:4], c[4] or name, c[5], c[6], link, c[8], image)
        else:
            cards.append((f"{source['id']}.{sid}", lat, lon, t, name, 0, 0, link, 0, image))
            final[t] += 1
            added += 1
    print(f"{source['id']}: {named} OSM cards got a name, {added} new cards")

WIKI_WORDS = re.compile(r'butik|affär|handel|restaurang|krog|kafé|café|cafe|konditori|bageri|\bpub\b|\bbar\b|skivbutik|skivaffär|skivbolag|musikbolag|bokhandel|varuhus|bryggeri|glass|servering|matställe', re.I)
WIKI_CHAIN = re.compile(r'kedja|franchise|koncern|organisation', re.I)  # a page about a chain, not a place
WIKI_NEAR = 3000


def wiki_by_name(indexes):
    """A notable card without a wikidata id gets the id of the Swedish Wikipedia page with the same title,
    when the page is about the place: not a disambiguation page, and within WIKI_NEAR metres when the page
    has coordinates, otherwise with a word for a shop or a restaurant in its first paragraph.
    A page about a chain (kedja, franchise, koncern, organisation) gives nothing.
    build/data/svwiki-names.json keeps the answers. Remove the file to ask again."""
    cache_file = SRC.parent / 'svwiki-names.json'
    cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    names = sorted({cards[i][4] for i in indexes if isinstance(cards[i][4], str) and '|' not in cards[i][4] and cards[i][4] not in cache})
    for n in range(0, len(names), 20):
        batch = names[n:n + 20]
        query = urllib.parse.urlencode({'action': 'query', 'format': 'json', 'formatversion': 2, 'redirects': 1, 'titles': '|'.join(batch),
                                        'prop': 'pageprops|extracts|coordinates', 'ppprop': 'wikibase_item|disambiguation',
                                        'exintro': 1, 'explaintext': 1, 'exlimit': 20, 'colimit': 20})
        request = urllib.request.Request('https://sv.wikipedia.org/w/api.php?' + query, headers={'User-Agent': 'hemmablind cell build (staffan.malmgren@kahnpedersen.se)'})
        try:
            d = json.load(urllib.request.urlopen(request, timeout=60))['query']
        except (urllib.error.URLError, TimeoutError, KeyError, ValueError) as e:
            print(f'svwiki: {e}')
            time.sleep(5)
            continue
        forward = {row['from']: row['to'] for row in d.get('normalized', []) + d.get('redirects', [])}
        pages = {}
        for page in d.get('pages', []):
            if page.get('missing') or 'disambiguation' in page.get('pageprops', {}) or not page.get('pageprops', {}).get('wikibase_item'):
                continue
            co = (page.get('coordinates') or [{}])[0]
            pages[page['title']] = {'wd': page['pageprops']['wikibase_item'], 'lat': co.get('lat'), 'lon': co.get('lon'),
                                    'words': bool(WIKI_WORDS.search(page.get('extract', ''))), 'chain': bool(WIKI_CHAIN.search(page.get('extract', '')))}
        for name in batch:
            title, hops = name, 0
            while title in forward and hops < 5:  # a normalization and then a redirect
                title, hops = forward[title], hops + 1
            cache[name] = pages.get(title)
        cache_file.write_text(json.dumps(cache, ensure_ascii=False))
        time.sleep(0.2)
    found = 0
    for i in indexes:
        c = cards[i]
        page = cache.get(c[4]) if isinstance(c[4], str) else None
        if not page or page.get('chain'):
            continue
        if page['lat'] is not None:
            ok = metres((0, page['lat'], page['lon']), c) <= WIKI_NEAR
        else:
            ok = page['words']
        if ok:
            cards[i] = (*c[:5], page['wd'], *c[6:])
            found += 1
    print(f'svwiki: {found} of {len(indexes)} notable cards got a Wikipedia page by name')


wiki_by_name([i for i, c in enumerate(cards) if c[3] in notable and not c[5]])
article = with_article({c[5] for c in cards if c[5]})
specials = set(json.loads((ROOT / 'src/specials.json').read_text()))
groups = defaultdict(list)
for c in cards:
    groups['epic' if level(c[3]) == 3 else c[3]].append(c)
removed = set()
for key, group in groups.items():
    removed |= too_dense(group, *DENSITY[3 if key == 'epic' else level(key)])

# A card without a name gets its number among the kept cards of its type, by id: "Bänk #4711".
# Cards of one type with the same name within NAME_APART metres get "#1", "#2", ... by id,
# so that the two bus stops of one street differ.
kept = [c for c in cards if c[0] not in removed]
nameless = defaultdict(list)
same = defaultdict(list)
for c in kept:
    (same[(c[3], c[4])] if c[4] else nameless[c[3]]).append(c)
names = {}
for group in nameless.values():
    for n, c in enumerate(sorted(group, key=lambda c: c[0]), 1):
        names[c[0]] = n
for group in same.values():
    if len(group) < 2:
        continue
    parent = list(range(len(group)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(group)):
        for j in range(i + 1, len(group)):
            if metres(group[i], group[j]) < NAME_APART:
                parent[find(i)] = find(j)
    clusters = defaultdict(list)
    for i, c in enumerate(group):
        clusters[find(i)].append(c)
    for members in clusters.values():
        if len(members) > 1:
            for n, c in enumerate(sorted(members, key=lambda c: c[0]), 1):
                names[c[0]] = f'{c[4]} #{n}'

cells = defaultdict(list)
for oid, lat, lon, t, name, wd, radius, link, variant, image in kept:
    row = [oid, lat, lon, t, names.get(oid, name), wd, radius if radius > BASE_RADIUS else 0, link, variant, image]
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
    'kept': [sum(1 for c in kept if c[3] == i) for i in range(len(types))],  # cards in the game, after the density rule
}))
size = sum(f.stat().st_size for f in OUT.iterdir())
print(f'{len(features)} features, {len(removed)} removed by the density rule, {len(kept)} cards, '
      f'{sum(1 for c in kept if c[0] in names and isinstance(names[c[0]], str))} same-name cards numbered, '
      f'{sum(1 for c in kept if c[9])} cards with an image, {len(cells)} cells, {size / 1e6:.1f} MB, {time.time() - t0:.0f} s')

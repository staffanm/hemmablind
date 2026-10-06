# Hemmablind

A location game. Each bench, viewpoint, runestone and lighthouse in OpenStreetMap is a card. Walk within 30 m of the real place and photograph it to collect the card.
Common places show on the map. Rare places stay hidden until you buy a hint with common cards, or find them by chance.
The game needs no server code: the host serves static files, and the album and the photos are in IndexedDB on the phone.
The UI is in Swedish. The card text comes from Swedish Wikipedia, or from English Wikipedia when no Swedish article exists.

## Rules

- 88 card types in four levels, from the count of the tag in Sweden: common (more than 10,000), uncommon (2,000 to 10,000), rare (300 to 2,000), epic (fewer than 300).
- 25 legendary places, one in each province (`src/legendary.json`). The collect radius is 100 m.
- Common and uncommon places show within 300 m. A hint for a rare card costs 5 common cards. A hint for an epic card costs 15.
- No collection above 25 km/h. A card counts double when the last 500 m of the track are below 25 km/h.
- A set is three card types. A complete set unlocks a perk. The deck holds three perks.
- A card with a `wikidata` tag shows the text and photo from Wikipedia.
- A place in reach gives a vibration, a sound and a prompt. The camera opens in the page (`getUserMedia`). Without a camera in the page, a file input opens the camera app.
- A photo is a JPEG of at most 1024 pixels. A card turns over to show its photo.
- A place to collect is a marker in the colour of its level. A collected card is a grey icon. A tap on the grey icon opens the card.
- A player can discard a card and collect it again at the same place. The second time gives no cards to spend. A perk goes away when its set is no longer complete.
- The title screen shows at the first visit only. The About tab of the album has the same text.
- A legendary place is not also a normal card. The cell build leaves out the feature with the same OSM id.
- The density rule: a card has at most N cards of its type within a distance, itself included. Common: 3 within 300 m. Uncommon: 2 within 500 m. Rare: 1 within 1,000 m. Epic: 1 of all epic types within 2,000 m. In a crowd, the build keeps the card with a Wikipedia article, then the card with a name.
- The map uses the game's own style (`src/map-style.json`) on the vector tiles of OpenFreeMap. The view is tilted and the buildings have height. The 2D button gives a flat view from above.
- The album export is a ZIP file without compression: `album.json` and one JPEG for each photo in `photos/`. The import replaces the album and the photos.

## Development

    npm install
    npm run dev       # dev server
    npm run build     # build to dist/
    npm run preview   # serve dist/

`npm run dev` runs with a simulated position. It does not ask for location access. The dev tools are not in the build.

- Tap the map to move the player there: Walk, Bike and Car move at a speed, Jump moves at once. One real second is ten simulated seconds.
- The Reveal buttons show each place of a level in the map view.
- The camera screen has the button "Use a test photo".
- The position survives a reload. `?sim=59.3314,18.0716` sets a start position.

## Cell files

`npm run cells` reads `build/data/sweden-latest.osm.pbf` and writes `public/cells/` (needs `uv`). It takes about 3 minutes.
Get the extract first:

    curl -L -o build/data/sweden-latest.osm.pbf https://download.geofabrik.de/europe/sweden-latest.osm.pbf

A cell is 0.1 degrees of longitude by 0.05 degrees of latitude, about 5.5 km. The game loads the cell of the player and its 8 neighbours.
`public/cells/meta.json` holds the count of each type in the extract. The game computes the levels from these counts.
The build asks Wikidata which cards have a Wikipedia article. It keeps the answers in `build/data/sitelinks.json`.

## Deploy

A push to `main` deploys the site. The GitHub Action (`.github/workflows/deploy.yml`) builds it and pushes `dist/` to the `deploy` branch.
The push to `deploy` fires the repository webhook. The hook `update-hemmablind` on ludo.tomtebo.org then runs `deploy/update-site.sh`,
which copies the branch to `/home/staffan/sites/hemmablind.tomtebo.org`. The update log is `/var/log/webhook-updates.log`.

`npm run deploy` builds locally and copies `dist/` with rsync, without GitHub.

One-time server setup: `deploy/setup.sh` makes the nginx site, requests the Let's Encrypt certificate, installs the hook and copies the site.

The cell files in `public/cells/` are in the repository, because the GitHub Action does not build them.

The game had the name Landmark Cards at first. The album database in the browser keeps the name `landmark-cards`.
An album belongs to one web address, so an album from `landmarkcards.tomtebo.org` moves to the new address with the export and import buttons.

## Card images

A card shows an illustration of its type, and the map shows the icon. `art/BRIEF.md` is the brief for the 93 illustrations, and `art/README.md` says how they were made.
`npm run art` copies the masters in `art/cards/` to `public/cards/` as 512 pixel WebP files (needs Pillow). A card without an image shows its icon.

The logo is `art/logo/logo-7-mirror.png`: a hand of three cards, with the hill and its path on the front card. It is proposal 7 from codex, mirrored and rotated by hand. `art/logo/` holds all proposals and the two briefs. `npm run art` also makes the app icons in `public/` from it.

## Extra sources

`src/sources.json` lists open data of municipalities and agencies. The cell build downloads each source as GeoJSON and merges it with the OSM cards.
A source place within `match` metres of an OSM card of the same type gives its name and link to that card. A source place without an OSM card becomes a new card.

A source has these fields:

- `id`: the prefix of the card ids, and the file name in `build/data/sources/`
- `label` and `about`: the name and the page of the publisher, for the card and the About tab
- `url`: a request that returns GeoJSON in EPSG:4326, for example a WFS `GetFeature` request
- `type`: the OSM tag of the card type
- `fields`: the properties that hold the id, the name and the link of a place
- `match`: the largest distance in metres to an OSM card of the same place

Remove a file in `build/data/sources/` to download that source again.

## Files

- `index.html`: page markup
- `src/main.js`: game logic, map and screens
- `src/style.css`: styles
- `src/types.json`: the 88 card types (OSM tag, Swedish name, definite form, icon). Add a new type at the end, because an album stores the index of the type. A type can have `variants`: the value of one more tag gives the card a more exact name, as `religion` does for a place of worship. Add a new variant at the end of its list.
- `src/legendary.json`: the 25 legendary places
- `src/map-style.json`: the MapLibre style of the map
- `src/sources.json`: the extra sources of the cell build
- `src/specials.json`: cards with their own link, by OSM id. A name and an image are optional. The cell build never removes these cards.
- `art/`: the card illustrations: brief, references, masters and scripts
- `scripts/export-art.py`: copies the card illustrations to `public/cards/` and makes the app icons from the logo
- `scripts/build-cells.py`: writes the cell files from an OSM extract
- `public/icons/`: one SVG icon for each type
- `public/manifest.webmanifest`: PWA manifest
- `deploy/`: server setup and the deploy hook

## Credits

- Map data and card data: © OpenStreetMap contributors, ODbL.
- Map tiles: OpenFreeMap. Map library: MapLibre GL JS.
- Icons: Maki (Mapbox) and Temaki (Rapid editor), both CC0. Twelve icons are drawn for this game.

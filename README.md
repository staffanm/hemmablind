# Landmark Cards

A location game. Each bench, viewpoint, runestone and lighthouse in OpenStreetMap is a card. Walk within 30 m of the real place to collect it.
Common places show on the map. Rare places stay hidden until you buy a hint with common cards, or find them by chance.
The game needs no server code: the host serves static files, and the album is in IndexedDB on the phone.

## Rules

- 86 card types in four levels, from the count of the tag in Sweden: common (more than 10,000), uncommon (2,000 to 10,000), rare (300 to 2,000), epic (fewer than 300).
- 25 legendary places, one in each province (`src/legendary.json`). The collect radius is 100 m.
- Common and uncommon places show within 300 m. A hint for a rare card costs 5 common cards. A hint for an epic card costs 15.
- No collection above 25 km/h. A card counts double when the last 500 m of the track are below 25 km/h.
- A set is three card types. A complete set unlocks a perk. The deck holds three perks.
- A card with a `wikidata` tag shows the text and photo from Wikipedia.

## Development

    npm install
    npm run dev       # dev server
    npm run build     # build to dist/
    npm run preview   # serve dist/

Open `http://localhost:5173/?sim=59.3314,18.0716` to play without GPS. Tap the map and the simulated player walks there.
One real second is ten simulated seconds.

## Cell files

`npm run cells` reads `build/data/sweden-latest.osm.pbf` and writes `public/cells/` (needs `uv`). It takes about 3 minutes.
Get the extract first:

    curl -L -o build/data/sweden-latest.osm.pbf https://download.geofabrik.de/europe/sweden-latest.osm.pbf

A cell is 0.1 degrees of longitude by 0.05 degrees of latitude, about 5.5 km. The game loads the cell of the player and its 8 neighbours.
`public/cells/meta.json` holds the count of each type. The game computes the levels from these counts.

## Deploy

A push to `main` deploys the site. The GitHub Action (`.github/workflows/deploy.yml`) builds it and pushes `dist/` to the `deploy` branch.
The push to `deploy` fires the repository webhook. The hook `update-landmark-cards` on ludo.tomtebo.org then runs `deploy/update-site.sh`,
which copies the branch to `/home/staffan/sites/landmarkcards.tomtebo.org`. The update log is `/var/log/webhook-updates.log`.

`npm run deploy` builds locally and copies `dist/` with rsync, without GitHub.

One-time server setup: `deploy/setup-server.sh` (nginx site and TLS certificate) and `deploy/setup-webhook.sh` (the hook).

The cell files in `public/cells/` are in the repository, because the GitHub Action does not build them.

## Files

- `index.html`: page markup
- `src/main.js`: game logic, map and screens
- `src/style.css`: styles
- `src/types.json`: the 86 card types (OSM tag, name, icon)
- `src/legendary.json`: the 25 legendary places
- `scripts/build-cells.py`: writes the cell files from an OSM extract
- `public/icons/`: one SVG icon for each type
- `public/manifest.webmanifest`: PWA manifest
- `deploy/`: server setup and the deploy hook

## Credits

- Map data and card data: © OpenStreetMap contributors, ODbL.
- Map tiles: OpenFreeMap. Map library: MapLibre GL JS.
- Icons: Maki (Mapbox) and Temaki (Rapid editor), both CC0. Twelve icons are drawn for this game.

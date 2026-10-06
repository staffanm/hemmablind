import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import TYPES from './types.json';
import LEGENDARY from './legendary.json';
import MAP_STYLE from './map-style.json';
import SOURCES from './sources.json';
import SPECIALS from './specials.json';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// `npm run dev` runs with a simulated position and the dev tools. The build has neither.
const DEV = import.meta.env.DEV;

const LEVELS = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const LEVEL_NAME = ['Vanligt', 'Ovanligt', 'Sällsynt', 'Episkt', 'Legendariskt'];  // "ett vanligt kort"
const LEVEL_PLURAL = ['Vanliga', 'Ovanliga', 'Sällsynta', 'Episka'];
const LEVEL_COLOR = ['#64748b', '#3fa35c', '#3b82f6', '#a855f7', '#e8b021'];
const LEGEND = 4;
const MAX_KMH = 25;          // no collection above this speed
const BASE_RADIUS = 30;      // collect radius in metres
const LEGENDARY_RADIUS = 100;
const VIEW_RANGE = 300;      // common and uncommon features show inside this range
const FOOT_DISTANCE = 500;   // track length for the "on foot or bike" mark
const TRACK_STEP = 8;        // metres between two track samples
const TRACK_GAP = 30000;     // ms without a position that breaks the track
const PHOTO_SIZE = 1024;     // longest side of a saved photo in pixels
const REACH_BUZZ = [70, 50, 70, 50, 220];  // vibration when a card is in reach: short, short, long
// The map is tilted and the buildings have height. The player is below the middle of the screen,
// because a tilted map shows more ground ahead than behind.
const VIEW_3D = { zoom: 15.6, pitch: 55, padding: { top: 260 } };
// The flat view looks straight down. Tall buildings cannot cover a place there.
const VIEW_2D = { zoom: 15, pitch: 0, padding: { top: 0 } };

const ABOUT = `
  <p>Varje bänk, utsiktsplats, runsten och fyr på kartan är ett kort. Gå inom 30 m från den verkliga platsen och fotografera den för att få kortet.</p>
  <p>På kartan ser du bara de kort som finns inom 300 m från dig. De sällsynta korten är dolda på kartan och syns när du är inom 30 m ifrån. Men du kan använda dina vanliga kort för att köpa en ledtråd till var de närmaste finns.</p>
  <p>Du kan inte fotografera eller få ett kort medan du åker bil. Om du istället promenerar eller cyklar hela vägen till kortet räknas det som två när du köper ledtrådar.</p>
  <p>Dina bilder stannar på den här telefonen. Tryck på ett kort för att se bilden.</p>`;

const PERKS = {
  farsight: ['Fjärrsyn', 'Vanliga och ovanliga platser syns inom 500 m i stället för 300 m.'],
  windfall: ['Bonus', 'Varje ovanligt kort ger också ett vanligt kort att spendera.'],
  pinpoint: ['Precision', 'En ledtråd visar den dolda platsen på kartan.'],
  sixthsense: ['Sjätte sinne', 'Sällsynta platser syns på kartan inom 100 m.'],
  dowser: ['Slagruta', 'Episka platser syns på kartan inom 60 m.'],
  bargain: ['Rabatt', 'En sällsynt ledtråd kostar 4 kort i stället för 5. En episk kostar 12 i stället för 15.'],
  headstart: ['Försprång', 'Märket ”Till fots eller cykel” kräver 250 m i stället för 500 m.'],
  longreach: ['Lång räckvidd', 'Du kan samla kort på 15 m längre avstånd.'],
};
// A set is complete when the album holds one card of each type. A complete set unlocks its perk.
const SETS = [
  ['Utkik', ['natural=peak', 'tourism=viewpoint', 'man_made=tower'], 'farsight'],
  ['Picknick', ['amenity=bench', 'leisure=picnic_table', 'leisure=firepit'], 'windfall'],
  ['Kust', ['natural=beach', 'natural=cape', 'man_made=lighthouse'], 'pinpoint'],
  ['Gamla stenar', ['historic=rune_stone', 'historic=archaeological_site', 'historic=ruins'], 'sixthsense'],
  ['Vilt vatten', ['waterway=waterfall', 'natural=spring', 'waterway=rapids'], 'dowser'],
  ['Handelsväg', ['historic=milestone', 'man_made=bridge', 'amenity=post_box'], 'bargain'],
  ['Vandrare', ['amenity=shelter', 'tourism=wilderness_hut', 'man_made=cairn'], 'headstart'],
  ['Träning', ['leisure=playground', 'leisure=fitness_station', 'leisure=park'], 'longreach'],
].map(([name, tags, perk]) => ({ name, perk, types: tags.map((tag) => TYPES.findIndex((t) => `${t.k}=${t.v}` === tag)) }));
const DECK_SIZE = 3;

// cards: id -> {t: type index or -1 for legendary, n: name, la, lo, at: ms, foot, nohint, wd}
// discarded: id -> {hinted}. A card that you collect again gives no cards to spend.
let state = { cards: {}, coins: 0, hints: [], deck: [], discarded: {}, seen: false, flat: false };
let meta = null;
let levelOf = [];
let map = null;
let me = null;       // last position {la, lo, t, kmh}
let track = [];      // samples at least TRACK_STEP apart: {la, lo, kmh, d: metres from the start}
let reach = [];      // places inside their collect radius, nearest first
let follow = true;
let turning = false;  // the map moves to another view; the move that follows the player waits
const cells = new Map();
const loading = new Set();  // keys of the cells that are on their way
let noticed = false;        // the notice about an empty map shows one time
const markers = new Map();
const buzzed = new Set();  // ids that already gave the "in reach" vibration

// ---------- storage ----------

// The database keeps the first name of the game, Landmark Cards, so that no player loses an album.
const db = new Promise((resolve, reject) => {
  const req = indexedDB.open('landmark-cards', 2);
  req.onupgradeneeded = () => {
    for (const name of ['kv', 'photos']) {
      if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
    }
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
// Runs one request on a store. The result is undefined when the database is not available.
const idb = (store, mode, run) => db.then((d) => new Promise((resolve) => {
  const req = run(d.transaction(store, mode).objectStore(store));
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => resolve(undefined);
}), () => undefined);
const save = () => idb('kv', 'readwrite', (s) => s.put(state, 'state'));

// ---------- geometry ----------

function dist(la1, lo1, la2, lo2) {
  const x = (lo2 - lo1) * Math.cos((la1 + la2) * Math.PI / 360);
  return Math.hypot(x, la2 - la1) * 111320;
}
function bearing(la1, lo1, la2, lo2) {
  return Math.atan2((lo2 - lo1) * Math.cos(la1 * Math.PI / 180), la2 - la1) * 180 / Math.PI;
}
function circle(la, lo, r) {
  const ring = [];
  for (let i = 0; i <= 48; i++) {
    const a = i / 48 * 2 * Math.PI;
    ring.push([lo + r * Math.sin(a) / (111320 * Math.cos(la * Math.PI / 180)), la + r * Math.cos(a) / 111320]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } };
}
const metres = (d) => (d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(d < 10000 ? 1 : 0).replace('.', ',')} km`);
const day = (ms) => new Date(ms).toLocaleDateString('sv-SE');
const points = (features) => ({ type: 'FeatureCollection', features });
const point = (f, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [f.lo, f.la] }, properties });

// ---------- rules ----------

const perk = (id) => state.deck.includes(id);
const ownedTypes = () => new Set(Object.values(state.cards).map((c) => c.t));
const setDone = (set, owned) => set.types.every((t) => owned.has(t));
const hintPrice = (lv) => (lv === 2 ? (perk('bargain') ? 4 : 5) : (perk('bargain') ? 12 : 15));
const cardLevel = (c) => (c.t < 0 ? LEGEND : levelOf[c.t]);
// A variant gives a card a more exact name than its type: a place of worship is a church, a mosque or a synagogue.
// c.v is the position in the `variants` list of the type, from 1. A variant is [tag value, name, definite form, image key].
const variant = (c) => (c.v ? TYPES[c.t].variants.values[c.v - 1] : null);
const typeName = (c) => (c.t < 0 ? 'Legendarisk plats' : variant(c)?.[1] || TYPES[c.t].name);
// The card image: public/cards/<key>.webp. A variant can have its own image.
const artKey = (c) => (c.t < 0 ? 'legendary' : variant(c)?.[3] || TYPES[c.t].icon);
const cardName = (c) => c.n || (c.t < 0 ? '' : `${typeName(c)} utan namn`);
const thing = (f) => (f.t < 0 ? f.n : `${variant(f)?.[2] || TYPES[f.t].def}${f.n ? ` ${f.n}` : ''}`);
const iconUrl = (t) => `./icons/${t < 0 ? 'legendary' : TYPES[t].icon}.svg`;
const iconStyle = (t) => `-webkit-mask-image:url(${iconUrl(t)});mask-image:url(${iconUrl(t)})`;

// The last FOOT_DISTANCE metres of the track must exist, and 90 percent of the samples must be slow.
function onFoot() {
  const need = perk('headstart') ? FOOT_DISTANCE / 2 : FOOT_DISTANCE;
  const end = track.at(-1);
  let i = track.length - 1;
  while (i > 0 && end.d - track[i].d < need) i--;
  if (!end || end.d - track[i].d < need) return false;
  const part = track.slice(i);
  return part.filter((p) => p.kmh <= MAX_KMH).length >= 0.9 * part.length;
}

// f is a place from `reach`. The photo is the proof that the player was there.
async function collect(f, photo) {
  const again = state.discarded[f.id];
  const before = ownedTypes();
  const card = { t: f.t, n: f.n || '', la: f.la, lo: f.lo, wd: f.wd || '', at: Date.now(), foot: onFoot() };
  if (f.url) card.url = f.url;
  if (f.v) card.v = f.v;
  if (f.t < 0) card.land = f.land;
  if (f.lv === 2 || f.lv === 3) card.nohint = !again?.hinted && !state.hints.some((h) => h.id === f.id);
  let gain = 0;
  if (!again && f.lv === 0) gain = card.foot ? 2 : 1;
  if (!again && f.lv === 1 && perk('windfall')) gain = 1;
  state.coins += gain;
  state.cards[f.id] = card;
  state.hints = state.hints.filter((h) => h.id !== f.id);
  save();
  await idb('photos', 'readwrite', (s) => s.put(photo, f.id));
  chime([0, 4, 7, 12, 16].slice(0, f.lv + 2));
  navigator.vibrate?.([60, 40, 120]);
  const owned = ownedTypes();
  for (const set of SETS) {
    if (!setDone(set, before) && setDone(set, owned)) {
      if (state.deck.length < DECK_SIZE) state.deck.push(set.perk);
      toast(`<b>Set komplett: ${esc(set.name)}</b> Förmåga: ${esc(PERKS[set.perk][0])}`, 6000);
      save();
    }
  }
  drawCollected();
  refresh();
  showCard(f.id, gain);
}

function discard(id) {
  const card = state.cards[id];
  state.discarded[id] = { hinted: card.nohint === false || !!state.discarded[id]?.hinted };
  delete state.cards[id];
  idb('photos', 'readwrite', (s) => s.delete(id));
  const owned = ownedTypes();
  for (const p of state.deck) {
    if (!setDone(SETS.find((set) => set.perk === p), owned)) toast(`Förmågan försvann: ${esc(PERKS[p][0])}`, 5000);
  }
  state.deck = state.deck.filter((p) => setDone(SETS.find((set) => set.perk === p), owned));
  buzzed.delete(id);
  save();
  drawCollected();
  refresh();
}

// ---------- cells ----------

function cellAt(cx, cy) {
  const key = `${cx}_${cy}`;
  if (!cells.has(key)) {
    cells.set(key, []);
    loading.add(key);
    // A missing file is an empty cell. A failed request is tried again at the next position.
    fetch(`./cells/${key}.json`).then((r) => (r.ok ? r.json().catch(() => []) : []), () => null).then((rows) => {
      loading.delete(key);
      if (!rows) return cells.delete(key);
      // A card in specials.json has its own link, and no Wikipedia text. It can also have its own name and image.
      cells.set(key, rows.map(([id, la, lo, t, n, wd, r, url, v]) => ({
        id, la, lo, t, n: SPECIALS[id]?.name || n || '', wd: SPECIALS[id] ? '' : wd || '', r: r || 0, url: url || '', v: v || 0,
      })));
      // A card from before the variants gets its variant here.
      for (const f of cells.get(key)) {
        if (f.v && state.cards[f.id] && !state.cards[f.id].v) { state.cards[f.id].v = f.v; save(); }
      }
      refresh();
      drawDev();
    });
  }
  return cells.get(key);
}

// The cell of the player and its 8 neighbours.
function nearCells() {
  const cx = Math.floor(me.lo / meta.cellLon), cy = Math.floor(me.la / meta.cellLat);
  const near = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) near.push(cellAt(cx + dx, cy + dy));
  return near;
}

// ---------- position ----------

let speedRef = null;
let kmh = 0;

function onFix(la, lo, t, speed) {
  if (speed != null && !Number.isNaN(speed)) kmh = speed * 3.6;
  else if (!speedRef) speedRef = { la, lo, t };
  else if (t - speedRef.t >= 2000) {
    kmh = dist(speedRef.la, speedRef.lo, la, lo) / (t - speedRef.t) * 3600;
    speedRef = { la, lo, t };
  }
  if (me && t - me.t > TRACK_GAP) track = [];
  const last = track.at(-1);
  if (!last) track.push({ la, lo, kmh, d: 0 });
  else {
    const step = dist(last.la, last.lo, la, lo);
    if (step >= TRACK_STEP) {
      track.push({ la, lo, kmh, d: last.d + step });
      while (track.at(-1).d - track[1].d >= FOOT_DISTANCE) track.shift();
    }
  }
  me = { la, lo, t, kmh };
  refresh();
}

function refresh() {
  if (!me || !meta || !map) return;
  const fast = me.kmh > MAX_KMH;
  const extra = perk('longreach') ? 15 : 0;
  const view = perk('farsight') ? 500 : VIEW_RANGE;
  const show = new Map();
  reach = [];
  const look = (f, lv, radius) => {
    if (state.cards[f.id]) return;
    const d = dist(me.la, me.lo, f.la, f.lo);
    const item = { ...f, lv, d, near: !fast && d <= radius + extra };
    if (item.near) reach.push(item);
    if (item.near || lv === LEGEND || (lv < 2 ? d <= view : lv === 2 ? perk('sixthsense') && d <= 100 : perk('dowser') && d <= 60)) show.set(f.id, item);
  };
  for (const cell of nearCells()) for (const f of cell) look(f, levelOf[f.t], f.r || BASE_RADIUS);
  for (const p of LEGENDARY) look({ ...p, t: -1, n: p.name }, LEGEND, LEGENDARY_RADIUS);
  if (perk('pinpoint')) {
    for (const h of state.hints) if (!show.has(h.id)) show.set(h.id, { ...h, t: -2, d: dist(me.la, me.lo, h.la, h.lo) });
  }
  reach.sort((a, b) => a.d - b.d);
  // At the start, tell the player when the map has no card to walk to.
  if (!noticed && !loading.size) {
    noticed = true;
    if (![...show.values()].some((f) => f.lv < LEGEND)) toast(`Det finns inga kort inom ${view} m avstånd – promenera en bit för att få syn på några`, 10000);
  }
  drawMarkers(show);
  drawPlayer(view);
  drawReach();
  drawHud();
}

// ---------- map ----------

function initMap(la, lo) {
  map = new maplibregl.Map({
    container: 'map',
    style: MAP_STYLE,
    center: [lo, la],
    ...(state.flat ? VIEW_2D : VIEW_3D),
    dragRotate: false,
    pitchWithRotate: false,
    attributionControl: false,
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-right');
  map.touchZoomRotate.disableRotation();
  map.on('dragstart', () => { follow = false; $('#btn-center').classList.add('show'); });
  map.on('moveend', (e) => { if (e.turn) turning = false; });
  map.on('load', () => {
    // The attribution starts closed, because the open text covers the HUD.
    $('.maplibregl-ctrl-attrib').classList.remove('maplibregl-compact-show');
    $('.maplibregl-ctrl-attrib').removeAttribute('open');
    map.addSource('view', { type: 'geojson', data: points([]) });
    map.addLayer({ id: 'view-fill', type: 'fill', source: 'view', paint: { 'fill-color': '#16302b', 'fill-opacity': 0.06 } });
    map.addLayer({ id: 'view-line', type: 'line', source: 'view', paint: { 'line-color': '#16302b', 'line-opacity': 0.5, 'line-width': 1.5, 'line-dasharray': [3, 3] } });
    map.addSource('dev', { type: 'geojson', data: points([]) });
    map.addLayer({ id: 'dev', type: 'circle', source: 'dev', paint: {
      'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
    } });
    map.addSource('collected', { type: 'geojson', data: points([]) });
    map.addLayer({ id: 'collected', type: 'symbol', source: 'collected', layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true } });
    drawView();
    drawCollected();
    refresh();
  });
  map.on('click', 'collected', (e) => showCard(e.features[0].properties.id));
  map.on('mouseenter', 'collected', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'collected', () => { map.getCanvas().style.cursor = ''; });
}

// An animated move to a view. The move that follows the player would stop the animation halfway, so it waits.
// The `turn` mark comes back in the `moveend` event of this animation only, not in that of an earlier move.
function turnTo(view) {
  turning = true;
  map.easeTo({ ...view, duration: 900 }, { turn: true });
}

// The 2D view has flat buildings at all zoom levels. The button shows the view that a tap gives.
function drawView() {
  $('#btn-view').textContent = state.flat ? '3D' : '2D';
  map.setLayoutProperty('building', 'visibility', state.flat ? 'none' : 'visible');
  map.setLayerZoomRange('building-flat', 12, state.flat ? 24 : 14);
  map.touchPitch[state.flat ? 'disable' : 'enable']();
}

let playerMarker = null;
function drawPlayer(view) {
  if (!playerMarker) {
    const el = document.createElement('div');
    el.className = 'player';
    playerMarker = new maplibregl.Marker({ element: el }).setLngLat([me.lo, me.la]).addTo(map);
  }
  playerMarker.setLngLat([me.lo, me.la]);
  map.getSource('view')?.setData(circle(me.la, me.lo, view));
  if (follow && !turning) map.easeTo({ center: [me.lo, me.la], duration: 500 });
}

// A place that the player can still collect: a marker in the colour of its level.
function drawMarkers(show) {
  for (const [id, m] of markers) {
    if (!show.has(id)) { m.remove(); markers.delete(id); }
  }
  for (const [id, f] of show) {
    let m = markers.get(id);
    if (!m) {
      const el = document.createElement('div');
      el.className = `mk lv-${LEVELS[f.lv]}`;
      el.innerHTML = f.t === -2 ? '?' : `<i class="ic" style="${iconStyle(f.t)}"></i>`;
      m = new maplibregl.Marker({ element: el }).setLngLat([f.lo, f.la]).addTo(map);
      markers.set(id, m);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const cur = m.info;
        if (cur.near) openCamera(cur);
        else toast(`<b>${cur.t === -2 ? `Dolt ${LEVEL_NAME[cur.lv].toLowerCase()} kort` : esc(typeName(cur))}</b> ${esc(cur.n || '')} ${metres(cur.d)}`);
      });
    }
    m.info = f;
    m.getElement().classList.toggle('reach', !!f.near);
  }
}

// A collected card: a grey icon in a map layer. The icon image is the SVG of the type on a grey disc.
const doneIcons = new Map();
function doneIcon(t) {
  if (!doneIcons.has(t)) {
    doneIcons.set(t, fetch(iconUrl(t)).then((r) => r.text()).then((svg) => new Promise((resolve) => {
      // An SVG without a width and a height does not draw on a canvas in all browsers.
      const sized = svg.replace(/<svg\b[^>]*>/, (tag) => tag.replace(/\s(width|height)="[^"]*"/g, '').replace('<svg', '<svg width="52" height="52"'));
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 52;
        const g = canvas.getContext('2d');
        g.drawImage(img, 14, 14, 24, 24);
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = '#9097a1';
        g.fillRect(0, 0, 52, 52);
        g.globalCompositeOperation = 'destination-over';
        g.beginPath();
        g.arc(26, 26, 22, 0, 2 * Math.PI);
        g.fillStyle = '#e9ebee';
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = '#b9bec6';
        g.stroke();
        if (!map.hasImage(`done${t}`)) map.addImage(`done${t}`, g.getImageData(0, 0, 52, 52), { pixelRatio: 2 });
        resolve();
      };
      img.onerror = resolve;
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
    })).catch(() => {}));
  }
  return doneIcons.get(t);
}

async function drawCollected() {
  if (!map?.getSource('collected')) return;
  const cards = Object.entries(state.cards);
  await Promise.all([...new Set(cards.map(([, c]) => c.t))].map(doneIcon));
  map.getSource('collected').setData(points(cards.map(([id, c]) => point(c, { id, icon: `done${c.t}` }))));
}

// ---------- HUD ----------

function drawHud() {
  $('#hud-coins').innerHTML = `<b>${state.coins}</b> att spendera`;
  $('#hud-cards').innerHTML = `<b>${Object.keys(state.cards).length}</b> kort`;
  const chip = $('#hud-speed');
  if (!me) {
    chip.textContent = 'Spelet väntar på din position';
    chip.className = 'chip';
    return;
  }
  const fast = me.kmh > MAX_KMH, foot = onFoot();
  chip.textContent = fast ? `För fort för att samla kort (${Math.round(me.kmh)} km/h)` : foot ? 'Till fots eller cykel: korten räknas dubbelt' : `${Math.round(me.kmh)} km/h`;
  chip.className = `chip ${fast ? 'bad' : foot ? 'good' : ''}`;
  $('#hud-hints').innerHTML = state.hints.map((h) => `<div class="hintchip lv-${LEVELS[h.lv]}">
    <span class="arrow" style="transform:rotate(${Math.round(bearing(me.la, me.lo, h.la, h.lo))}deg)">↑</span>
    ${LEVEL_NAME[h.lv]} kort ${metres(dist(me.la, me.lo, h.la, h.lo))}</div>`).join('');
}

// The prompt for the nearest place in reach. A new place in reach gives one vibration and one sound.
function drawReach() {
  const f = reach[0];
  $('#reach').classList.toggle('hidden', !f);
  if (!f) return;
  if (reach.some((r) => !buzzed.has(r.id))) {
    for (const r of reach) buzzed.add(r.id);
    navigator.vibrate?.(REACH_BUZZ);
    chime([12, 19]);
  }
  $('#reach').className = `lv-${LEVELS[f.lv]}`;
  $('#reach .ic').style.cssText = iconStyle(f.t);
  $('#reach-text').textContent = `Fotografera ${thing(f)} för att få kortet.`;
  $('#btn-more').classList.toggle('hidden', reach.length < 2);
  $('#btn-more').textContent = `${reach.length - 1} till här`;
}

function toast(html, ms = 3500) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = html;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

// Semitones above C5, one note each 90 ms.
let audio = null;
function chime(semitones) {
  if (!audio) return;
  semitones.forEach((semi, i) => {
    const osc = audio.createOscillator(), gain = audio.createGain();
    const at = audio.currentTime + i * 0.09;
    osc.type = 'triangle';
    osc.frequency.value = 523.25 * 2 ** (semi / 12);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.2, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
    osc.connect(gain).connect(audio.destination);
    osc.start(at);
    osc.stop(at + 0.55);
  });
}

// ---------- camera ----------

let camTarget = null;
let camStream = null;

async function openCamera(f) {
  camTarget = f;
  $('#cam-title').textContent = `Fotografera ${thing(f)}`;
  $('#camera').classList.remove('nocam');
  $('#camera').classList.add('show');
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    $('#cam-video').srcObject = camStream;
  } catch {
    // No camera, no permission, or a page without HTTPS. The file input opens the camera app.
    $('#camera').classList.add('nocam');
  }
}

function closeCamera() {
  camStream?.getTracks().forEach((t) => t.stop());
  camStream = null;
  $('#cam-video').srcObject = null;
  $('#camera').classList.remove('show');
}

// Scales the picture to PHOTO_SIZE and saves it as the photo of the card.
function takePhoto(source, width, height) {
  const scale = Math.min(1, PHOTO_SIZE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  canvas.toBlob((photo) => {
    const f = camTarget;
    closeCamera();
    if (photo) collect(f, photo);
  }, 'image/jpeg', 0.8);
}

$('#btn-photo').addEventListener('click', () => reach[0] && openCamera(reach[0]));
// The chooser lists all places in reach. A tap on a place opens the camera for it.
let choices = [];
$('#btn-more').addEventListener('click', () => {
  choices = reach;
  $('#choose-list').innerHTML = choices.map((f, i) => `<button class="line lv-${LEVELS[f.lv]}" data-choice="${i}">
    <span><i class="ic" style="${iconStyle(f.t)}"></i> <b>${esc(typeName(f))}</b> ${esc(f.n || '')}</span><span class="dim">${Math.round(f.d)} m</span></button>`).join('');
  $('#choose').classList.add('show');
});
$('#choose-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-choice]');
  if (!b) return;
  $('#choose').classList.remove('show');
  openCamera(choices[+b.dataset.choice]);
});
$('#btn-cam-cancel').addEventListener('click', closeCamera);
$('#btn-shutter').addEventListener('click', () => {
  const video = $('#cam-video');
  if (video.videoWidth) takePhoto(video, video.videoWidth, video.videoHeight);
});
$('#cam-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const bitmap = await createImageBitmap(file);
    takePhoto(bitmap, bitmap.width, bitmap.height);
  } catch { toast('Spelet kan inte läsa bilden.'); }
});

// ---------- cards ----------

// gain is the number of cards to spend that a new card gave. It is undefined for a card from the album.
function cardHtml(id, gain) {
  const c = state.cards[id];
  const lv = cardLevel(c);
  // The id is an OSM id, or the id of a source in sources.json, a dot and the id in that source.
  const oid = id.replace(/^L/, '');
  const source = SOURCES.find((src) => id.startsWith(`${src.id}.`));
  const origin = source
    ? `<a href="${esc(source.about)}" target="_blank" rel="noopener">${esc(source.label)}</a>`
    : `<a href="https://www.openstreetmap.org/${{ n: 'node', w: 'way', r: 'relation' }[oid[0]]}/${oid.slice(1)}" target="_blank" rel="noopener">OpenStreetMap</a>`;
  const special = SPECIALS[id];
  const link = special ? [special.link, special.label] : [c.url || '', 'Om platsen'];
  const more = /^https:\/\//.test(link[0]) ? ` · <a href="${esc(link[0])}" target="_blank" rel="noopener">${esc(link[1])}</a>` : '';
  const name = special?.name || cardName(c);
  const date = day(c.at);
  return `<div class="card lv-${LEVELS[lv]}${gain === undefined ? '' : ' flipped noanim'}"><div class="card-inner">
    <div class="card-face card-front">
      <div class="card-level">${LEVEL_NAME[lv]}</div>
      <div class="card-art${special?.image ? ' photo' : ''}"><span class="card-badge"><i class="ic" style="${iconStyle(c.t)}"></i></span>
        <img src="./cards/${special?.image ? esc(special.image) : `${artKey(c)}.webp`}" alt="" onload="this.parentNode.classList.add('has-img')" onerror="this.remove()"></div>
      <div class="card-type">${esc(c.t < 0 ? c.land : typeName(c))}</div>
      <div class="card-name">${esc(name)}</div>
      <div class="card-marks">${c.foot ? '<span>Till fots eller cykel</span>' : ''}${c.nohint ? '<span>Hittat utan ledtråd</span>' : ''}${gain ? `<span class="gain">+${gain} att spendera</span>` : ''}</div>
      <div class="card-journal"></div>
      <div class="card-foot">${date} · ${origin}${more}</div>
      <div class="card-tip">Tryck på kortet för att se din bild</div>
    </div>
    <div class="card-face card-back"><img alt="Din bild"><div class="card-caption">${esc(name)}<br>${date}</div></div>
  </div></div>`;
}

// The journal text and photo come from Wikipedia, found through the wikidata tag of the feature.
async function journal(el, wd) {
  if (!/^Q\d+$/.test(wd)) return;
  try {
    const langs = ['sv', 'en'];
    const ent = await (await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wd}&props=sitelinks&sitefilter=svwiki|enwiki&format=json&origin=*`)).json();
    const links = ent.entities[wd].sitelinks || {};
    const lang = langs.find((l) => links[`${l}wiki`]);
    if (!lang) return;
    const sum = await (await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(links[`${lang}wiki`].title)}`)).json();
    el.innerHTML = `${sum.thumbnail ? `<img src="${esc(sum.thumbnail.source)}" alt="">` : ''}<p>${esc(sum.extract || '')}</p>
      <a href="${esc(sum.content_urls.desktop.page)}" target="_blank" rel="noopener">Wikipedia</a>`;
  } catch { /* the card stays without journal text */ }
}

// A new card shows the photo first and then turns to the front.
let photoUrl = null;
async function showCard(id, gain) {
  const el = $('#reveal');
  const fresh = gain !== undefined;
  el.innerHTML = `${fresh ? '<div class="reveal-title">Nytt kort</div>' : ''}${cardHtml(id, gain)}
    <div class="row"><button class="primary close">${fresh ? 'Behåll' : 'Stäng'}</button><button data-discard="${esc(id)}">Släng</button></div>`;
  el.classList.add('show');
  const card = el.querySelector('.card');
  journal(card.querySelector('.card-journal'), SPECIALS[id] ? '' : state.cards[id].wd);
  const photo = await idb('photos', 'readonly', (s) => s.get(id));
  if (!card.isConnected) return;
  if (photo) {
    URL.revokeObjectURL(photoUrl);
    photoUrl = URL.createObjectURL(photo);
    card.querySelector('.card-back img').src = photoUrl;
    card.classList.add('has-photo');
  }
  if (fresh) setTimeout(() => card.classList.remove('noanim', 'flipped'), 1100);
}

$('#reveal').addEventListener('click', (e) => {
  const id = e.target.dataset.discard;
  if (id) {
    if (!confirm('Vill du slänga kortet och bilden? Du kan samla kortet igen på samma plats. Andra gången ger det inga kort att spendera.')) return;
    discard(id);
    $('#reveal').classList.remove('show');
    if ($('#album').classList.contains('show')) drawAlbum();
  } else if (!e.target.closest('a, button')) e.target.closest('.card.has-photo')?.classList.toggle('flipped');
});

// ---------- hints ----------

function drawHintPanel() {
  $('#hint-balance').innerHTML = `Du har <b>${state.coins}</b> vanliga kort att spendera.`;
  $('#btn-hint-rare').textContent = `Sällsynt kort: ${hintPrice(2)} kort`;
  $('#btn-hint-epic').textContent = `Episkt kort: ${hintPrice(3)} kort`;
}

function buyHint(lv) {
  if (!me) return;
  const price = hintPrice(lv);
  if (state.coins < price) return toast(`Du behöver ${price} vanliga kort. Du har ${state.coins}.`);
  let best = null;
  for (const cell of nearCells()) {
    for (const f of cell) {
      if (levelOf[f.t] !== lv || state.cards[f.id] || state.hints.some((h) => h.id === f.id)) continue;
      const d = dist(me.la, me.lo, f.la, f.lo);
      if (!best || d < best.d) best = { id: f.id, la: f.la, lo: f.lo, lv, d };
    }
  }
  if (!best) return toast(`Inget dolt ${LEVEL_NAME[lv].toLowerCase()} kort finns i närheten. Du behåller dina kort.`);
  state.coins -= price;
  state.hints.push({ id: best.id, la: best.la, lo: best.lo, lv });
  save();
  $('#hint').classList.remove('show');
  toast(`<b>Ledtråd:</b> ett ${LEVEL_NAME[lv].toLowerCase()} kort finns ${metres(best.d)} bort.`, 5000);
  refresh();
}

// ---------- album ----------

let tab = 'cards';
let openType = null;

function drawAlbum() {
  document.querySelectorAll('#album .tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const body = $('#album-body');
  const cards = Object.entries(state.cards);
  if (tab === 'cards' && openType !== null) {
    const list = cards.filter(([, c]) => c.t === openType).sort((a, b) => b[1].at - a[1].at);
    body.innerHTML = `<button class="back">‹ Alla typer</button>
      <h2>${esc(TYPES[openType].name)}</h2>
      <p class="dim">${LEVEL_NAME[levelOf[openType]]} · ${meta.counts[openType].toLocaleString('sv-SE')} i Sverige · du har ${list.length}</p>
      <div class="list">${list.map(([id, c]) => `<button class="line" data-card="${esc(id)}">
        <span>${esc(SPECIALS[id]?.name || cardName(c))}</span>
        <span class="dim">${c.foot ? '👣 ' : ''}${c.nohint ? '★ ' : ''}${day(c.at)}</span></button>`).join('')}</div>`;
  } else if (tab === 'cards') {
    const have = new Map();
    for (const [, c] of cards) have.set(c.t, (have.get(c.t) || 0) + 1);
    body.innerHTML = `<p class="dim">${cards.length} kort · ${[...have.keys()].filter((t) => t >= 0).length} av ${TYPES.length} typer · ${state.coins} vanliga kort att spendera</p>` +
      [0, 1, 2, 3].map((lv) => `<h3 class="lv-${LEVELS[lv]}">${LEVEL_PLURAL[lv]}</h3><div class="grid">${
        TYPES.map((t, i) => i).filter((i) => levelOf[i] === lv).sort((a, b) => meta.counts[b] - meta.counts[a]).map((i) => `
          <button class="tile lv-${LEVELS[lv]} ${have.has(i) ? '' : 'none'}" data-type="${i}">
            <i class="ic" style="${iconStyle(i)}"></i><span>${esc(TYPES[i].name)}</span><b>${have.get(i) || ''}</b></button>`).join('')}</div>`).join('');
  } else if (tab === 'sets') {
    const owned = ownedTypes();
    body.innerHTML = `<p class="dim">Samla ett kort av varje typ för att göra ett set komplett. Ett komplett set ger en förmåga. Din kortlek rymmer ${DECK_SIZE} förmågor. Kortlek: ${state.deck.length} av ${DECK_SIZE}.</p>` +
      SETS.map((set) => {
        const done = setDone(set, owned), on = perk(set.perk);
        return `<div class="set ${done ? 'done' : ''}">
          <div class="set-head"><b>${esc(set.name)}</b>${done ? `<button data-perk="${set.perk}" class="${on ? 'on' : ''}">${on ? 'I kortleken' : 'Lägg i kortleken'}</button>` : ''}</div>
          <div class="set-types">${set.types.map((t) => `<span class="lv-${LEVELS[levelOf[t]]} ${owned.has(t) ? '' : 'none'}"><i class="ic" style="${iconStyle(t)}"></i>${esc(TYPES[t].name)}</span>`).join('')}</div>
          <div class="set-perk"><b>${esc(PERKS[set.perk][0])}.</b> ${esc(PERKS[set.perk][1])}</div></div>`;
      }).join('');
  } else if (tab === 'legendary') {
    const rows = LEGENDARY.map((p) => ({ ...p, d: me ? dist(me.la, me.lo, p.la, p.lo) : null })).sort((a, b) => a.d - b.d);
    body.innerHTML = `<p class="dim">En plats i vart och ett av de 25 landskapen. Gå inom ${LEGENDARY_RADIUS} m och fotografera platsen. Du har ${rows.filter((p) => state.cards[p.id]).length} av 25.</p>
      <div class="list">${rows.map((p) => `<button class="line lv-legendary ${state.cards[p.id] ? '' : 'none'}" ${state.cards[p.id] ? `data-card="${esc(p.id)}"` : ''}>
        <span><b>${esc(p.name)}</b> ${esc(p.land)}</span>
        <span class="dim">${state.cards[p.id] ? day(state.cards[p.id].at) : p.d === null ? '' : metres(p.d)}</span></button>`).join('')}</div>`;
  } else {
    body.innerHTML = `<img class="logo" src="./icon-192.png" alt=""><h2>Hemmablind</h2>${ABOUT}
      <p class="dim" id="about-storage"></p>
      <p class="dim">Kortdata: © OpenStreetMaps bidragsgivare, hämtad ${esc(meta.built)}. Fler platser och namn: ${SOURCES.map((src) => esc(src.label)).join(', ')}.</p>
      <div class="row"><button id="btn-export">Exportera album</button><button id="btn-import">Importera album</button></div>
      <p class="dim">Exportfilen är en ZIP-fil med korten och bilderna.</p>`;
    Promise.all([idb('photos', 'readonly', (s) => s.count()), navigator.storage?.estimate?.()]).then(([n, est]) => {
      const mb = (bytes) => (bytes > 1e9 ? `${(bytes / 1e9).toFixed(1).replace('.', ',')} GB` : `${Math.round(bytes / 1e6)} MB`);
      const el = $('#about-storage');
      if (el) el.textContent = `${n || 0} bilder på den här telefonen.${est ? ` Spelet använder ${mb(est.usage)} av de ${mb(est.quota)} som webbläsaren tillåter.` : ''}`;
    });
  }
}

function openAlbum(t) {
  tab = t;
  openType = null;
  drawAlbum();
  $('#album').classList.add('show');
}

$('#album').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.tab) { tab = b.dataset.tab; openType = null; }
  else if (b.dataset.type) openType = +b.dataset.type;
  else if (b.classList.contains('back')) openType = null;
  else if (b.dataset.card) return showCard(b.dataset.card);
  else if (b.dataset.perk) {
    if (perk(b.dataset.perk)) state.deck = state.deck.filter((p) => p !== b.dataset.perk);
    else if (state.deck.length < DECK_SIZE) state.deck.push(b.dataset.perk);
    else return toast(`Kortleken rymmer ${DECK_SIZE} förmågor. Ta bort en först.`);
    save();
    refresh();
  } else if (b.id === 'btn-export') return exportAlbum();
  else if (b.id === 'btn-import') {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,.json,application/zip,application/json';
    input.onchange = () => importAlbum(input.files[0]);
    input.click();
    return;
  } else return;
  drawAlbum();
});

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('close')) e.target.closest('.screen').classList.remove('show');
});
$('#btn-hint').addEventListener('click', () => { drawHintPanel(); $('#hint').classList.add('show'); });
$('#btn-hint-rare').addEventListener('click', () => buyHint(2));
$('#btn-hint-epic').addEventListener('click', () => buyHint(3));
$('#btn-album').addEventListener('click', () => openAlbum('cards'));
$('#btn-sets').addEventListener('click', () => openAlbum('sets'));
$('#btn-center').addEventListener('click', () => {
  follow = true;
  $('#btn-center').classList.remove('show');
  if (me) turnTo({ center: [me.lo, me.la], ...(state.flat ? VIEW_2D : VIEW_3D) });
});
$('#btn-view').addEventListener('click', () => {
  state.flat = !state.flat;
  save();
  drawView();
  turnTo({ ...(follow && me ? { center: [me.lo, me.la] } : {}), ...(state.flat ? VIEW_2D : VIEW_3D) });
});

// ---------- album file ----------
// The export is a ZIP file without compression: album.json and one JPEG for each photo.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = ~0;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;
}

async function exportAlbum() {
  toast('Spelet packar albumet.');
  const files = [['album.json', new Blob([JSON.stringify(state)])]];
  for (const id of Object.keys(state.cards)) {
    const photo = await idb('photos', 'readonly', (s) => s.get(id));
    if (photo) files.push([`photos/${id}.jpg`, photo]);
  }
  const parts = [], directory = [];
  let offset = 0;
  for (const [name, blob] of files) {
    const nameBytes = new TextEncoder().encode(name);
    // The 26 bytes that the local header and the directory entry share.
    const fields = new DataView(new ArrayBuffer(26));
    fields.setUint16(0, 20, true);         // ZIP version 2.0
    fields.setUint16(2, 0x0800, true);     // names are UTF-8
    fields.setUint16(8, 0x0021, true);     // date 1980-01-01; method and time stay 0
    fields.setUint32(10, crc32(new Uint8Array(await blob.arrayBuffer())), true);
    fields.setUint32(14, blob.size, true);
    fields.setUint32(18, blob.size, true);
    fields.setUint16(22, nameBytes.length, true);
    const local = new DataView(new ArrayBuffer(4));
    local.setUint32(0, 0x04034b50, true);
    parts.push(local, fields, nameBytes, blob);
    const head = new DataView(new ArrayBuffer(6));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(4, 20, true);
    const tail = new DataView(new ArrayBuffer(14));
    tail.setUint32(10, offset, true);
    directory.push(head, fields, tail, nameBytes);
    offset += 30 + nameBytes.length + blob.size;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directory.reduce((n, part) => n + part.byteLength, 0), true);
  end.setUint32(16, offset, true);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([...parts, ...directory, end], { type: 'application/zip' }));
  a.download = 'hemmablind-album.zip';
  a.click();
}

// Returns the files of a ZIP as name -> Blob. It reads the directory at the end and takes slices
// of the file, so that a large album does not fill the memory.
async function readZip(file) {
  const view = async (from, to) => new DataView(await file.slice(from, to).arrayBuffer());
  const tail = await view(Math.max(0, file.size - 65557), file.size);
  let at = tail.byteLength - 22;
  while (at >= 0 && tail.getUint32(at, true) !== 0x06054b50) at--;
  if (at < 0) throw new Error('not a ZIP file');
  const dirStart = tail.getUint32(at + 16, true);
  const dir = await view(dirStart, dirStart + tail.getUint32(at + 12, true));
  const files = new Map();
  for (let i = 0, p = 0; i < tail.getUint16(at + 10, true); i++) {
    const method = dir.getUint16(p + 10, true), size = dir.getUint32(p + 20, true), nameLength = dir.getUint16(p + 28, true);
    const local = dir.getUint32(p + 42, true);
    const head = await view(local, local + 30);
    const start = local + 30 + head.getUint16(26, true) + head.getUint16(28, true);
    let blob = file.slice(start, start + size);
    // Another program can save the file again with compression.
    if (method === 8) blob = await new Response(blob.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
    else if (method !== 0) throw new Error('unknown compression');
    files.set(new TextDecoder().decode(new Uint8Array(dir.buffer, p + 46, nameLength)), blob);
    p += 46 + nameLength + dir.getUint16(p + 30, true) + dir.getUint16(p + 32, true);
  }
  return files;
}

// Replaces the album and the photos. An export of the first version is a JSON file without photos.
async function importAlbum(file) {
  try {
    const magic = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    const zip = magic[0] === 0x50 && magic[1] === 0x4b ? await readZip(file) : null;
    const next = JSON.parse(await (zip ? zip.get('album.json') : file).text());
    if (typeof next.cards !== 'object' || !Array.isArray(next.hints) || !Array.isArray(next.deck)) throw new Error('not an album');
    const photos = zip ? [...zip].filter(([name]) => /^photos\/.+\.jpg$/.test(name)) : [];
    if (!confirm(`Vill du ersätta ditt album med ${Object.keys(state.cards).length} kort med filens ${Object.keys(next.cards).length} kort och ${photos.length} bilder?`)) return;
    state = { ...state, ...next };
    await save();
    await idb('photos', 'readwrite', (s) => s.clear());
    for (const [name, blob] of photos) {
      const photo = new Blob([await blob.arrayBuffer()], { type: 'image/jpeg' });
      await idb('photos', 'readwrite', (s) => s.put(photo, name.slice(7, -4)));
    }
    drawAlbum();
    drawCollected();
    refresh();
    toast(`Albumet är importerat: ${Object.keys(state.cards).length} kort och ${photos.length} bilder.`, 5000);
  } catch { toast('Filen är inte en albumexport.'); }
}

// ---------- dev tools (npm run dev) ----------
// The position is simulated. A tap on the map moves the player there, at a speed or in one jump.
// One real second is ten simulated seconds. The reveal buttons show each place of a level in the map view.

let simPos = null;
let simTarget = null;
let simKmh = 5;
let simClock = 0;
const devLevels = new Set();

function simTick() {
  simClock += 2500;
  let speed = 0;
  if (simTarget) {
    const d = dist(simPos.la, simPos.lo, simTarget.la, simTarget.lo), step = simKmh / 3.6 * 2.5;
    const part = Math.min(1, step / d);
    simPos.la += (simTarget.la - simPos.la) * part;
    simPos.lo += (simTarget.lo - simPos.lo) * part;
    speed = simKmh / 3.6;
    if (part === 1) simTarget = null;
    localStorage.setItem('dev-position', `${simPos.la},${simPos.lo}`);
  }
  onFix(simPos.la, simPos.lo, simClock, speed);
}

// A jump adds one minute to the clock, so that the track starts again at the new place.
function simJump(la, lo) {
  simPos = { la, lo };
  simTarget = null;
  simClock += 60000;
  follow = true;
  localStorage.setItem('dev-position', `${la},${lo}`);
  simTick();
}

function drawDev() {
  const source = DEV && map?.getSource('dev');
  if (!source) return;
  const features = [];
  const b = map.getBounds();
  const x0 = Math.floor(b.getWest() / meta.cellLon), x1 = Math.floor(b.getEast() / meta.cellLon);
  const y0 = Math.floor(b.getSouth() / meta.cellLat), y1 = Math.floor(b.getNorth() / meta.cellLat);
  const wide = (x1 - x0 + 1) * (y1 - y0 + 1) > 40;
  $('#dev-note').textContent = devLevels.size && wide ? 'Zooma in för att visa' : 'Visa';
  if (devLevels.size && !wide) {
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (const f of cellAt(x, y)) {
          const lv = levelOf[f.t];
          if (devLevels.has(lv) && !state.cards[f.id]) features.push(point(f, { color: LEVEL_COLOR[lv], label: `${LEVEL_NAME[lv]}: ${typeName(f)} ${f.n}` }));
        }
      }
    }
  }
  source.setData(points(features));
}

function startDev() {
  const [la, lo] = (new URLSearchParams(location.search).get('sim') || localStorage.getItem('dev-position') || '59.3314,18.0716').split(',').map(Number);
  simPos = { la, lo };
  simClock = Date.now();
  initMap(la, lo);
  $('#dev').classList.remove('hidden');
  $('#btn-test-photo').classList.remove('hidden');
  $('#dev').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b?.dataset.move) {
      simKmh = +b.dataset.move;
      document.querySelectorAll('#dev [data-move]').forEach((o) => o.classList.toggle('on', o === b));
    } else if (b?.dataset.reveal) {
      const lv = +b.dataset.reveal;
      if (!devLevels.delete(lv)) devLevels.add(lv);
      b.classList.toggle('on', devLevels.has(lv));
      drawDev();
    }
  });
  $('#btn-test-photo').addEventListener('click', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 1024;
    const g = canvas.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 1024);
    sky.addColorStop(0, '#7db7e8');
    sky.addColorStop(0.6, '#d9ecf7');
    sky.addColorStop(0.6, '#5f8f4e');
    sky.addColorStop(1, '#35602f');
    g.fillStyle = sky;
    g.fillRect(0, 0, 768, 1024);
    g.fillStyle = '#fff';
    g.font = 'bold 44px sans-serif';
    g.textAlign = 'center';
    g.fillText('Testbild', 384, 300);
    g.font = '30px sans-serif';
    g.fillText(thing(camTarget), 384, 350, 720);
    takePhoto(canvas, 768, 1024);
  });
  map.on('moveend', drawDev);
  map.on('click', (e) => {
    if (map.queryRenderedFeatures(e.point, { layers: ['collected'] }).length) return;
    const label = map.queryRenderedFeatures(e.point, { layers: ['dev'] })[0]?.properties.label;
    if (label) toast(esc(label));
    if (simKmh) simTarget = { la: e.lngLat.lat, lo: e.lngLat.lng };
    else simJump(e.lngLat.lat, e.lngLat.lng);
  });
  setInterval(simTick, 250);
  window.game = {
    get state() { return state; },
    get reach() { return reach; },
    get map() { return map; },
    tick: simTick,
    jump: simJump,
    goto: (la2, lo2, speed = 5) => { simKmh = speed; simTarget = { la: la2, lo: lo2 }; },
  };
}

// ---------- start ----------

let watch = null;
function startGps() {
  if (watch !== null) navigator.geolocation.clearWatch(watch);
  watch = navigator.geolocation.watchPosition((p) => {
    if (!map) initMap(p.coords.latitude, p.coords.longitude);
    $('#title').classList.remove('show');
    onFix(p.coords.latitude, p.coords.longitude, p.timestamp, p.coords.speed);
  }, (err) => {
    if (me) return;
    $('#title-error').textContent = `Spelet kan inte läsa din position: ${err.message}. Tillåt platsåtkomst för sidan och försök igen.`;
    $('#btn-start').textContent = 'Försök igen';
    $('#title').classList.add('show');
  }, { enableHighAccuracy: true, maximumAge: 1000 });
}

const wakeLock = () => navigator.wakeLock?.request('screen').catch(() => {});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.seen) wakeLock(); });
// A browser starts sound only after a tap.
document.addEventListener('pointerdown', () => {
  audio ||= new (window.AudioContext || window.webkitAudioContext)();
  audio.resume();
  wakeLock();
}, { once: true });

function start() {
  $('#title').classList.remove('show');
  $('#title-error').textContent = '';
  $('#hud').classList.remove('hidden');
  navigator.storage?.persist?.();
  wakeLock();
  drawHud();
  if (DEV) { if (!simPos) startDev(); } else startGps();
}

$('#title-about').innerHTML = ABOUT;
$('#btn-start').addEventListener('click', () => {
  state.seen = true;
  save();
  start();
});

// The title screen shows only at the first visit. After that, the About tab of the album has the same text.
Promise.all([idb('kv', 'readonly', (s) => s.get('state')), fetch('./cells/meta.json').then((r) => r.json())]).then(([saved, m]) => {
  if (saved) state = { ...state, ...saved };
  meta = m;
  levelOf = meta.counts.map((n) => (n > 10000 ? 0 : n >= 2000 ? 1 : n >= 300 ? 2 : 3));
  if (state.seen) start();
  else $('#title').classList.add('show');
});

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import TYPES from './types.json';
import LEGENDARY from './legendary.json';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const LEVELS = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const LEVEL_NAME = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
const LEVEL_COLOR = ['#8a94a3', '#3fa35c', '#3b82f6', '#a855f7', '#e8b021'];
const LEGEND = 4;
const MAX_KMH = 25;          // no collection above this speed
const BASE_RADIUS = 30;      // collect radius in metres
const LEGENDARY_RADIUS = 100;
const VIEW_RANGE = 300;      // common and uncommon features show inside this range
const FOOT_DISTANCE = 500;   // track length for the "on foot or bike" mark
const TRACK_STEP = 8;        // metres between two track samples
const TRACK_GAP = 30000;     // ms without a position that breaks the track

const PERKS = {
  farsight: ['Far sight', 'Common and uncommon places show within 500 m, not 300 m.'],
  windfall: ['Windfall', 'Each uncommon card also gives one common card to spend.'],
  pinpoint: ['Pinpoint', 'A hint shows the hidden place on the map.'],
  sixthsense: ['Sixth sense', 'Rare places show on the map within 100 m.'],
  dowser: ['Dowser', 'Epic places show on the map within 60 m.'],
  bargain: ['Bargain', 'A rare hint costs 4 cards, not 5. An epic hint costs 12, not 15.'],
  headstart: ['Head start', 'The "on foot or bike" mark needs 250 m, not 500 m.'],
  longreach: ['Long reach', 'The collect radius is 15 m larger.'],
};
// A set is complete when the album holds one card of each type. A complete set unlocks its perk.
const SETS = [
  ['Lookout', ['natural=peak', 'tourism=viewpoint', 'man_made=tower'], 'farsight'],
  ['Picnic', ['amenity=bench', 'leisure=picnic_table', 'leisure=firepit'], 'windfall'],
  ['Coast', ['natural=beach', 'natural=cape', 'man_made=lighthouse'], 'pinpoint'],
  ['Old stones', ['historic=rune_stone', 'historic=archaeological_site', 'historic=ruins'], 'sixthsense'],
  ['Wild water', ['waterway=waterfall', 'natural=spring', 'waterway=rapids'], 'dowser'],
  ['Trade route', ['historic=milestone', 'man_made=bridge', 'amenity=post_box'], 'bargain'],
  ['Wayfarer', ['amenity=shelter', 'tourism=wilderness_hut', 'man_made=cairn'], 'headstart'],
  ['Workout', ['leisure=playground', 'leisure=fitness_station', 'leisure=park'], 'longreach'],
].map(([name, tags, perk]) => ({ name, perk, types: tags.map((tag) => TYPES.findIndex((t) => `${t.k}=${t.v}` === tag)) }));
const DECK_SIZE = 3;

// cards: id -> {t: type index or -1 for legendary, n: name, la, lo, at: ms, foot, nohint, wd}
let state = { cards: {}, coins: 0, hints: [], deck: [] };
let meta = null;
let levelOf = [];
let map = null;
let me = null;       // last position {la, lo, t, kmh}
let track = [];      // samples at least TRACK_STEP apart: {la, lo, kmh, d: metres from the start}
let follow = true;
const cells = new Map();
const markers = new Map();
const sim = new URLSearchParams(location.search).get('sim');

// ---------- storage ----------

const db = new Promise((resolve, reject) => {
  const req = indexedDB.open('landmark-cards', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('kv');
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const loadState = () => db.then((d) => new Promise((resolve) => {
  const req = d.transaction('kv').objectStore('kv').get('state');
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => resolve(undefined);
}), () => undefined);
const save = () => db.then((d) => d.transaction('kv', 'readwrite').objectStore('kv').put(state, 'state'), () => {});

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
const metres = (d) => (d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(d < 10000 ? 1 : 0)} km`);

// ---------- rules ----------

const perk = (id) => state.deck.includes(id);
const ownedTypes = () => new Set(Object.values(state.cards).map((c) => c.t));
const setDone = (set, owned) => set.types.every((t) => owned.has(t));
const hintPrice = (lv) => (lv === 2 ? (perk('bargain') ? 4 : 5) : (perk('bargain') ? 12 : 15));
const cardLevel = (c) => (c.t < 0 ? LEGEND : levelOf[c.t]);
const typeName = (c) => (c.t < 0 ? 'Legendary place' : TYPES[c.t].name);
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

function collect(id, card) {
  const lv = cardLevel(card);
  const before = ownedTypes();
  card.at = Date.now();
  card.foot = onFoot();
  if (lv === 2 || lv === 3) card.nohint = !state.hints.some((h) => h.id === id);
  state.cards[id] = card;
  state.hints = state.hints.filter((h) => h.id !== id);
  if (lv === 0) state.coins += card.foot ? 2 : 1;
  if (lv === 1 && perk('windfall')) state.coins += 1;
  save();
  chime(lv);
  navigator.vibrate?.(lv >= 2 ? [60, 40, 120] : 40);
  if (lv >= 2) revealQueue.push(id);
  else toast(`<i class="ic lv-${LEVELS[lv]}" style="${iconStyle(card.t)}"></i><b>${esc(typeName(card))}</b>${card.n ? ' ' + esc(card.n) : ''}${lv === 0 ? ` <em>+${card.foot ? 2 : 1}</em>` : ''}`);
  const owned = ownedTypes();
  for (const set of SETS) {
    if (!setDone(set, before) && setDone(set, owned)) {
      if (state.deck.length < DECK_SIZE) state.deck.push(set.perk);
      toast(`<b>Set complete: ${esc(set.name)}</b> Perk: ${esc(PERKS[set.perk][0])}`, 6000);
      save();
    }
  }
  showReveal();
  drawCollected();
}

// ---------- cells ----------

function loadCells() {
  const cx = Math.floor(me.lo / meta.cellLon), cy = Math.floor(me.la / meta.cellLat);
  const near = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const key = `${cx + dx}_${cy + dy}`;
      if (!cells.has(key)) {
        cells.set(key, []);
        // A missing file is an empty cell. A failed request is tried again at the next position.
        fetch(`./cells/${key}.json`).then((r) => (r.ok ? r.json().catch(() => []) : []), () => null).then((rows) => {
          if (!rows) return cells.delete(key);
          cells.set(key, rows.map(([id, la, lo, t, n, wd, r]) => ({ id, la, lo, t, n: n || '', wd: wd || '', r: r || 0 })));
          refresh();
        });
      }
      near.push(cells.get(key));
    }
  }
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
  const reach = perk('longreach') ? 15 : 0;
  const view = perk('farsight') ? 500 : VIEW_RANGE;
  const show = new Map();
  for (const cell of loadCells()) {
    for (const f of cell) {
      if (state.cards[f.id]) continue;
      const d = dist(me.la, me.lo, f.la, f.lo);
      const lv = levelOf[f.t];
      if (!fast && d <= (f.r || BASE_RADIUS) + reach) collect(f.id, { t: f.t, n: f.n, la: f.la, lo: f.lo, wd: f.wd });
      else if (lv < 2 ? d <= view : lv === 2 ? perk('sixthsense') && d <= 100 : perk('dowser') && d <= 60) show.set(f.id, { ...f, lv, d });
    }
  }
  for (const p of LEGENDARY) {
    if (state.cards[p.id]) continue;
    const d = dist(me.la, me.lo, p.la, p.lo);
    if (!fast && d <= LEGENDARY_RADIUS + reach) collect(p.id, { t: -1, n: p.name, la: p.la, lo: p.lo, wd: p.wd, land: p.land });
    else show.set(p.id, { ...p, t: -1, n: p.name, lv: LEGEND, d });
  }
  if (perk('pinpoint')) for (const h of state.hints) show.set(h.id, { ...h, t: -2, d: dist(me.la, me.lo, h.la, h.lo) });
  drawMarkers(show);
  drawPlayer(view);
  drawHud();
}

// ---------- map ----------

function initMap(la, lo) {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: [lo, la],
    zoom: 15,
    dragRotate: false,
    pitchWithRotate: false,
    attributionControl: false,
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-right');
  map.touchZoomRotate.disableRotation();
  map.on('dragstart', () => { follow = false; $('#btn-center').classList.add('show'); });
  map.on('load', () => {
    // The attribution starts closed, because the open text covers the HUD.
    $('.maplibregl-ctrl-attrib').classList.remove('maplibregl-compact-show');
    $('.maplibregl-ctrl-attrib').removeAttribute('open');
    map.addSource('view', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'view-fill', type: 'fill', source: 'view', paint: { 'fill-color': '#16302b', 'fill-opacity': 0.06 } });
    map.addLayer({ id: 'view-line', type: 'line', source: 'view', paint: { 'line-color': '#16302b', 'line-opacity': 0.5, 'line-width': 1.5, 'line-dasharray': [3, 3] } });
    map.addSource('collected', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'collected', type: 'circle', source: 'collected', paint: {
      'circle-radius': 4, 'circle-color': ['get', 'color'], 'circle-opacity': 0.55, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1,
    } });
    drawCollected();
    refresh();
  });
  if (sim) map.on('click', (e) => { simTarget = { la: e.lngLat.lat, lo: e.lngLat.lng }; });
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
  if (follow) map.easeTo({ center: [me.lo, me.la], duration: 500 });
}

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
        toast(`<b>${cur.t === -2 ? `Hidden ${LEVELS[cur.lv]} card` : cur.t === -1 ? 'Legendary place' : esc(TYPES[cur.t].name)}</b> ${esc(cur.n || '')} ${metres(cur.d)}`);
      });
    }
    m.info = f;
  }
}

function drawCollected() {
  map?.getSource('collected')?.setData({
    type: 'FeatureCollection',
    features: Object.values(state.cards).map((c) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [c.lo, c.la] }, properties: { color: LEVEL_COLOR[cardLevel(c)] },
    })),
  });
}

// ---------- HUD ----------

function drawHud() {
  $('#hud-coins').innerHTML = `<b>${state.coins}</b> to spend`;
  $('#hud-cards').innerHTML = `<b>${Object.keys(state.cards).length}</b> cards`;
  const fast = me.kmh > MAX_KMH;
  $('#hud-speed').textContent = fast ? `Too fast to collect (${Math.round(me.kmh)} km/h)` : onFoot() ? 'On foot or bike: cards count double' : `${Math.round(me.kmh)} km/h`;
  $('#hud-speed').className = `chip ${fast ? 'bad' : onFoot() ? 'good' : ''}`;
  $('#hud-hints').innerHTML = state.hints.map((h) => `<div class="hintchip lv-${LEVELS[h.lv]}">
    <span class="arrow" style="transform:rotate(${Math.round(bearing(me.la, me.lo, h.la, h.lo))}deg)">↑</span>
    ${LEVEL_NAME[h.lv]} card ${metres(dist(me.la, me.lo, h.la, h.lo))}</div>`).join('');
}

function toast(html, ms = 3500) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = html;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

let audio = null;
function chime(lv) {
  if (!audio) return;
  [0, 4, 7, 12, 16].slice(0, lv + 2).forEach((semi, i) => {
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

// ---------- cards ----------

function cardHtml(id) {
  const c = state.cards[id];
  const lv = cardLevel(c);
  const oid = id.replace(/^L/, '');
  const osm = { n: 'node', w: 'way', r: 'relation' }[oid[0]];
  return `<div class="card lv-${LEVELS[lv]}" data-id="${esc(id)}">
    <div class="card-level">${LEVEL_NAME[lv]}</div>
    <div class="card-art"><i class="ic" style="${iconStyle(c.t)}"></i></div>
    <div class="card-type">${esc(c.t < 0 ? c.land : typeName(c))}</div>
    <div class="card-name">${esc(c.n || (c.t < 0 ? '' : `Unnamed ${typeName(c).toLowerCase()}`))}</div>
    <div class="card-marks">${c.foot ? '<span>On foot or bike</span>' : ''}${c.nohint ? '<span>Found without hint</span>' : ''}</div>
    <div class="card-journal"></div>
    <div class="card-foot">${new Date(c.at).toLocaleDateString()} · <a href="https://www.openstreetmap.org/${osm}/${oid.slice(1)}" target="_blank" rel="noopener">OpenStreetMap</a></div>
  </div>`;
}

// The journal text and photo come from Wikipedia, found through the wikidata tag of the feature.
async function journal(el, wd) {
  if (!/^Q\d+$/.test(wd)) return;
  try {
    const langs = navigator.language.startsWith('sv') ? ['sv', 'en'] : ['en', 'sv'];
    const ent = await (await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wd}&props=sitelinks&sitefilter=svwiki|enwiki&format=json&origin=*`)).json();
    const links = ent.entities[wd].sitelinks || {};
    const lang = langs.find((l) => links[`${l}wiki`]);
    if (!lang) return;
    const sum = await (await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(links[`${lang}wiki`].title)}`)).json();
    el.innerHTML = `${sum.thumbnail ? `<img src="${esc(sum.thumbnail.source)}" alt="">` : ''}<p>${esc(sum.extract || '')}</p>
      <a href="${esc(sum.content_urls.desktop.page)}" target="_blank" rel="noopener">Wikipedia</a>`;
  } catch { /* the card stays without journal text */ }
}

const revealQueue = [];
function showCard(id, fresh) {
  const el = $('#reveal');
  el.innerHTML = `${fresh ? '<div class="reveal-title">New card</div>' : ''}${cardHtml(id)}<div class="row"><button class="primary close">${fresh ? 'Keep' : 'Close'}</button></div>`;
  el.classList.add('show');
  el.classList.toggle('fresh', fresh);
  journal(el.querySelector('.card-journal'), state.cards[id].wd);
}
function showReveal() {
  if (!$('#reveal').classList.contains('show') && revealQueue.length) showCard(revealQueue.shift(), true);
}

// ---------- hints ----------

function drawHintPanel() {
  $('#hint-balance').innerHTML = `You have <b>${state.coins}</b> common cards to spend.`;
  $('#btn-hint-rare').textContent = `Rare card: ${hintPrice(2)} cards`;
  $('#btn-hint-epic').textContent = `Epic card: ${hintPrice(3)} cards`;
}

function buyHint(lv) {
  const price = hintPrice(lv);
  if (state.coins < price) return toast(`You need ${price} common cards. You have ${state.coins}.`);
  let best = null;
  for (const cell of loadCells()) {
    for (const f of cell) {
      if (levelOf[f.t] !== lv || state.cards[f.id] || state.hints.some((h) => h.id === f.id)) continue;
      const d = dist(me.la, me.lo, f.la, f.lo);
      if (!best || d < best.d) best = { id: f.id, la: f.la, lo: f.lo, lv, d };
    }
  }
  if (!best) return toast(`No hidden ${LEVELS[lv]} card is near. You keep your cards.`);
  state.coins -= price;
  state.hints.push({ id: best.id, la: best.la, lo: best.lo, lv });
  save();
  $('#hint').classList.remove('show');
  toast(`<b>Hint:</b> a ${LEVELS[lv]} card is ${metres(best.d)} away.`, 5000);
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
    body.innerHTML = `<button class="back">‹ All types</button>
      <h2>${esc(TYPES[openType].name)}</h2>
      <p class="dim">${LEVEL_NAME[levelOf[openType]]} · ${meta.counts[openType].toLocaleString()} in Sweden · you have ${list.length}</p>
      <div class="list">${list.map(([id, c]) => `<button class="line" data-card="${esc(id)}">
        <span>${esc(c.n || `Unnamed ${TYPES[c.t].name.toLowerCase()}`)}</span>
        <span class="dim">${c.foot ? '👣 ' : ''}${c.nohint ? '★ ' : ''}${new Date(c.at).toLocaleDateString()}</span></button>`).join('')}</div>`;
  } else if (tab === 'cards') {
    const have = new Map();
    for (const [, c] of cards) have.set(c.t, (have.get(c.t) || 0) + 1);
    body.innerHTML = `<p class="dim">${cards.length} cards · ${[...have.keys()].filter((t) => t >= 0).length} of ${TYPES.length} types · ${state.coins} common cards to spend</p>` +
      [0, 1, 2, 3].map((lv) => `<h3 class="lv-${LEVELS[lv]}">${LEVEL_NAME[lv]}</h3><div class="grid">${
        TYPES.map((t, i) => i).filter((i) => levelOf[i] === lv).sort((a, b) => meta.counts[b] - meta.counts[a]).map((i) => `
          <button class="tile lv-${LEVELS[lv]} ${have.has(i) ? '' : 'none'}" data-type="${i}">
            <i class="ic" style="${iconStyle(i)}"></i><span>${esc(TYPES[i].name)}</span><b>${have.get(i) || ''}</b></button>`).join('')}</div>`).join('') +
      `<div class="row"><button id="btn-export">Export album</button><button id="btn-import">Import album</button></div>`;
  } else if (tab === 'sets') {
    const owned = ownedTypes();
    body.innerHTML = `<p class="dim">Collect one card of each type to complete a set. A complete set unlocks a perk. Your deck holds ${DECK_SIZE} perks. Deck: ${state.deck.length} of ${DECK_SIZE}.</p>` +
      SETS.map((set) => {
        const done = setDone(set, owned), on = perk(set.perk);
        return `<div class="set ${done ? 'done' : ''}">
          <div class="set-head"><b>${esc(set.name)}</b>${done ? `<button data-perk="${set.perk}" class="${on ? 'on' : ''}">${on ? 'In deck' : 'Add to deck'}</button>` : ''}</div>
          <div class="set-types">${set.types.map((t) => `<span class="lv-${LEVELS[levelOf[t]]} ${owned.has(t) ? '' : 'none'}"><i class="ic" style="${iconStyle(t)}"></i>${esc(TYPES[t].name)}</span>`).join('')}</div>
          <div class="set-perk"><b>${esc(PERKS[set.perk][0])}.</b> ${esc(PERKS[set.perk][1])}</div></div>`;
      }).join('');
  } else {
    const rows = LEGENDARY.map((p) => ({ ...p, d: me ? dist(me.la, me.lo, p.la, p.lo) : null })).sort((a, b) => a.d - b.d);
    body.innerHTML = `<p class="dim">One place in each of the 25 provinces. Walk within ${LEGENDARY_RADIUS} m to collect it. You have ${rows.filter((p) => state.cards[p.id]).length} of 25.</p>
      <div class="list">${rows.map((p) => `<button class="line lv-legendary ${state.cards[p.id] ? '' : 'none'}" ${state.cards[p.id] ? `data-card="${esc(p.id)}"` : ''}>
        <span><b>${esc(p.name)}</b> ${esc(p.land)}</span>
        <span class="dim">${state.cards[p.id] ? new Date(state.cards[p.id].at).toLocaleDateString() : p.d === null ? '' : metres(p.d)}</span></button>`).join('')}</div>`;
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
  else if (b.dataset.card) return showCard(b.dataset.card, false);
  else if (b.dataset.perk) {
    if (perk(b.dataset.perk)) state.deck = state.deck.filter((p) => p !== b.dataset.perk);
    else if (state.deck.length < DECK_SIZE) state.deck.push(b.dataset.perk);
    else return toast(`The deck holds ${DECK_SIZE} perks. Remove one first.`);
    save();
    refresh();
  } else if (b.id === 'btn-export') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state)], { type: 'application/json' }));
    a.download = 'landmark-cards-album.json';
    a.click();
    return;
  } else if (b.id === 'btn-import') {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      try {
        const next = JSON.parse(await input.files[0].text());
        if (typeof next.cards !== 'object' || !Array.isArray(next.hints) || !Array.isArray(next.deck)) throw new Error();
        if (!confirm(`Replace your album of ${Object.keys(state.cards).length} cards with the file of ${Object.keys(next.cards).length} cards?`)) return;
        state = next;
        save();
        drawAlbum();
        drawCollected();
        refresh();
      } catch { toast('That file is not an album export.'); }
    };
    input.click();
    return;
  } else return;
  drawAlbum();
});

document.addEventListener('click', (e) => {
  if (!e.target.classList.contains('close')) return;
  e.target.closest('.screen').classList.remove('show');
  showReveal();
});
$('#btn-hint').addEventListener('click', () => { drawHintPanel(); $('#hint').classList.add('show'); });
$('#btn-hint-rare').addEventListener('click', () => buyHint(2));
$('#btn-hint-epic').addEventListener('click', () => buyHint(3));
$('#btn-album').addEventListener('click', () => openAlbum('cards'));
$('#btn-sets').addEventListener('click', () => openAlbum('sets'));
$('#btn-center').addEventListener('click', () => {
  follow = true;
  $('#btn-center').classList.remove('show');
  if (me) map.easeTo({ center: [me.lo, me.la], zoom: 15 });
});

// ---------- simulation (?sim=lat,lon) ----------
// The simulated player walks to the tapped point. One real second is ten simulated seconds.

let simTarget = null;
let simKmh = 5;
function startSim() {
  const [la0, lo0] = sim.split(',').map(Number);
  const pos = { la: la0 || 59.3251, lo: lo0 || 18.0711 };
  let clock = Date.now();
  $('#sim').classList.remove('hidden');
  $('#sim').addEventListener('click', (e) => {
    if (!e.target.dataset.kmh) return;
    simKmh = +e.target.dataset.kmh;
    document.querySelectorAll('#sim button').forEach((b) => b.classList.toggle('on', b === e.target));
  });
  initMap(pos.la, pos.lo);
  const tick = () => {
    clock += 2500;
    let speed = 0;
    if (simTarget) {
      const d = dist(pos.la, pos.lo, simTarget.la, simTarget.lo), step = simKmh / 3.6 * 2.5;
      const f = Math.min(1, step / d);
      pos.la += (simTarget.la - pos.la) * f;
      pos.lo += (simTarget.lo - pos.lo) * f;
      speed = simKmh / 3.6;
      if (f === 1) simTarget = null;
    }
    onFix(pos.la, pos.lo, clock, speed);
  };
  setInterval(tick, 250);
  window.game = { get state() { return state; }, goto: (la, lo, k = simKmh) => { simKmh = k; simTarget = { la, lo }; }, tick };
}

// ---------- start ----------

function startGps() {
  navigator.geolocation.watchPosition((p) => {
    if (!map) initMap(p.coords.latitude, p.coords.longitude);
    $('#title').classList.remove('show');
    $('#hud').classList.remove('hidden');
    onFix(p.coords.latitude, p.coords.longitude, p.timestamp, p.coords.speed);
  }, (err) => {
    if (!me) $('#title-error').textContent = `The game cannot read your position: ${err.message}. Permit location access for this page and press Start again.`;
  }, { enableHighAccuracy: true, maximumAge: 1000 });
}

const wakeLock = () => navigator.wakeLock?.request('screen').catch(() => {});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && me) wakeLock(); });

$('#btn-start').addEventListener('click', () => {
  audio ||= new (window.AudioContext || window.webkitAudioContext)();
  navigator.storage?.persist?.();
  wakeLock();
  $('#title-error').textContent = '';
  if (sim) {
    $('#title').classList.remove('show');
    $('#hud').classList.remove('hidden');
    startSim();
  } else startGps();
});

Promise.all([loadState(), fetch('./cells/meta.json').then((r) => r.json())]).then(([saved, m]) => {
  if (saved) state = saved;
  meta = m;
  levelOf = meta.counts.map((n) => (n > 10000 ? 0 : n >= 2000 ? 1 : n >= 300 ? 2 : 3));
  refresh();
});

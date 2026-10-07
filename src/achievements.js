// Achievements and the level of the player. Everything is computed from the saved state, so nothing
// here is stored except the tiers that the player has reached (state.ach) and the level (state.level).

// The title of the player and the plural of the type, for the achievement of each card type, by icon key.
const TYPE_TITLES = {
  bench: ['Bänknötare', 'bänkar'], shelter: ['Skyddssökare', 'vindskydd'], post_box: ['Brevbärare', 'brevlådor'],
  place_of_worship: ['Pilgrim', 'helgedomar'], bbq: ['Grillmästare', 'grillplatser'], fountain: ['Fontänfantast', 'fontäner'],
  drinking_water: ['Törstsläckare', 'dricksvattenkranar'], clock: ['Tidtagare', 'klockor'], information: ['Välinformerad', 'informationstavlor'],
  artwork: ['Konstkännare', 'konstverk'], picnic_site: ['Rastare', 'rastplatser'], viewpoint: ['Utsiktsjägare', 'utsiktsplatser'],
  attraction: ['Turist', 'sevärdheter'], museum: ['Museibesökare', 'museer'], wilderness_hut: ['Stugvärd', 'raststugor'],
  alpine_hut: ['Fjällräv', 'fjällstugor'], lean_to: ['Slogbodsgäst', 'slogbodar'], archaeological_site: ['Arkeolog', 'fornlämningar'],
  ruins: ['Ruinromantiker', 'ruiner'], memorial: ['Minnesgod', 'minnesmärken'], boundary_stone: ['Gränsgångare', 'gränsstenar'],
  rune_stone: ['Runristare', 'runstenar'], castle: ['Slottsgäst', 'slott'], mine: ['Gruvarbetare', 'gamla gruvor'],
  manor: ['Godsägare', 'herrgårdar'], shieling: ['Fäbodvandrare', 'fäbodar'], tomb: ['Gravvandrare', 'gravar'],
  monument: ['Monumental', 'monument'], milestone: ['Milräknare', 'milstenar'], historic_stone: ['Stenletare', 'historiska stenar'],
  fort: ['Fästningstagare', 'fort'], aircraft: ['Flygnörd', 'historiska flygplan'], cannon: ['Kanonjär', 'kanoner'],
  mine_shaft: ['Schaktsökare', 'gruvschakt'], charcoal_pile: ['Kolare', 'kolmilor'], ship: ['Sjöfarare', 'historiska fartyg'],
  city_gate: ['Portvakt', 'stadsportar'], peak: ['Toppbestigare', 'bergstoppar'], rock: ['Klippklättrare', 'klippor'],
  beach: ['Strandsamlare', 'stränder'], cliff: ['Stupmodig', 'stup'], boulder: ['Blockletare', 'stenblock'], cape: ['Uddsökare', 'uddar'],
  hill: ['Kullklättrare', 'kullar'], spring: ['Källsökare', 'källor'], cave_entrance: ['Grottutforskare', 'grottöppningar'],
  saddle: ['Passvandrare', 'bergspass'], tower: ['Tornväktare', 'torn'], bridge: ['Brobyggare', 'broar'], chimney: ['Sotare', 'skorstenar'],
  survey_point: ['Lantmätare', 'mätpunkter'], cairn: ['Rösebyggare', 'rösen'], water_tower: ['Vattentornsvän', 'vattentorn'],
  lighthouse: ['Fyrvaktare', 'fyrar'], water_tap: ['Kranskötare', 'vattenkranar'], windmill: ['Mjölnare', 'väderkvarnar'],
  water_well: ['Brunnsgrävare', 'brunnar'], beacon: ['Båkspanare', 'båkar'], watermill: ['Kvarnvandrare', 'vattenkvarnar'],
  maypole: ['Midsommarfirare', 'midsommarstänger'], cross: ['Korsfarare', 'kors'], tar_kiln: ['Tjärbrännare', 'tjärdalar'],
  telescope: ['Stjärnkikare', 'teleskop'], insect_hotel: ['Insektsvän', 'insektshotell'], playground: ['Lekkamrat', 'lekplatser'],
  picnic_table: ['Picknickare', 'picknickbord'], firepit: ['Eldsjäl', 'eldplatser'], bathing_place: ['Badkruka', 'badplatser'],
  slipway: ['Sjösättare', 'båtramper'], bird_hide: ['Fågelskådare', 'fågelgömslen'], sauna: ['Bastubadare', 'bastur'],
  fitness_station: ['Utegymmare', 'utegym'], bandstand: ['Paviljongpublik', 'musikpaviljonger'], disc_golf_course: ['Discgolfare', 'discgolfbanor'],
  swimming_area: ['Simmare', 'badområden'], park: ['Parkflanör', 'parker'], nature_reserve: ['Naturvän', 'naturreservat'],
  dog_park: ['Hundvakt', 'hundrastgårdar'], waterfall: ['Fallsökare', 'vattenfall'], dam: ['Dammvaktare', 'dammar'],
  weir: ['Dämmesspanare', 'dämmen'], lock_gate: ['Slussvaktare', 'slussportar'], rapids: ['Forsrännare', 'forsar'],
  fish_pass: ['Laxspanare', 'fisktrappor'], giants_kettle: ['Grytletare', 'jättegrytor'], glacial_erratic: ['Istidsspanare', 'flyttblock'],
  bus_stop: ['Pendlare', 'busshållplatser'], pitch: ['Bollspelare', 'bollplaner'], skateboard: ['Skejtare', 'skateparker'],
  shop: ['Stamkund', 'butiker'], restaurant: ['Finsmakare', 'matställen'],
};

// The first three tiers of a card type, by level. The fourth tier is half of all cards of the type in Sweden.
const TYPE_TIERS = [[5, 25, 100], [3, 10, 50], [1, 5, 25], [1, 3, 10]];
export const TIER_NAME = ['', 'Brons', 'Silver', 'Guld', 'Platina'];
export const XP_CARD = [10, 25, 60, 150, 500];   // by level of the card
export const XP_TIER = [50, 150, 400, 1500];     // by tier of an achievement
export const XP_SET = 200;
export const XP_DAY = 20;                        // a day with a card
export const XP_METRES = 100;                    // metres on foot or bike for one point
export const TITLES = [[1, 'Nybörjare'], [3, 'Flanör'], [5, 'Strövare'], [8, 'Stigfinnare'], [12, 'Upptäckare'], [17, 'Kartläsare'],
  [23, 'Vägvisare'], [30, 'Ortskännare'], [40, 'Hembygdskännare'], [50, 'Hemmablind']];

const km = (m) => `${Math.round(m / 1000)} km`;
const dist = (la1, lo1, la2, lo2) => Math.hypot((lo2 - lo1) * Math.cos((la1 + la2) * Math.PI / 360), la2 - la1) * 111320;
const dayKey = (ms) => new Date(ms).toLocaleDateString('sv-SE');

// The days with a card in a row, up to today or yesterday.
export function streak(days) {
  let n = 0;
  const d = new Date();
  if (!days[dayKey(d)]?.cards) d.setDate(d.getDate() - 1);
  while (days[dayKey(d)]?.cards) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

export function longestStreak(days) {
  const keys = Object.keys(days).filter((k) => days[k].cards).sort();
  let best = 0, run = 0, prev = null;
  for (const k of keys) {
    const t = new Date(k).getTime();
    run = prev !== null && t - prev <= 86400000 * 1.5 ? run + 1 : 1;
    prev = t;
    best = Math.max(best, run);
  }
  return best;
}

// game: { TYPES, levelOf, kept, LEGEND, SETS, cardLevel, setDone, ownedTypes }
export function buildAchievements(game) {
  const { TYPES, levelOf, kept, LEGEND, SETS, cardLevel, setDone, ownedTypes } = game;
  const cards = (s) => Object.values(s.cards);
  const countIf = (test) => (s) => cards(s).filter(test).length;
  const sum = (s, key) => Object.values(s.days).reduce((n, d) => n + d[key], 0);
  const max = (s, key) => Math.max(0, ...Object.values(s.days).map((d) => d[key]));
  const totalCards = kept.reduce((a, b) => a + b, 0);
  const hour = (c) => new Date(c.at).getHours();
  const month = (c) => new Date(c.at).getMonth();
  const weekend = (c) => [0, 6].includes(new Date(c.at).getDay());
  const farFromFirst = (s) => {
    const all = cards(s);
    if (!all.length) return 0;
    const first = all.reduce((a, b) => (a.at < b.at ? a : b));
    return all.filter((c) => dist(first.la, first.lo, c.la, c.lo) > 100000).length;
  };
  const general = [
    { id: 'cards', name: 'Samlare', tiers: [10, 100, 1000, Math.ceil(totalCards / 2)], count: (s) => cards(s).length, what: (n) => `Du har ${n} kort` },
    { id: 'walk', name: 'Vandrare', tiers: [10000, 100000, 1000000, 10000000], count: (s) => sum(s, 'm'), what: (n) => `Du har gått eller cyklat ${km(n)}`, fmt: km },
    { id: 'dayWalk', name: 'Dagsetapp', tiers: [5000, 15000, 30000, 60000], count: (s) => max(s, 'm'), what: (n) => `Din längsta dag är ${km(n)}`, fmt: km },
    { id: 'dayCards', name: 'Skördedag', tiers: [5, 20, 50, 200], count: (s) => max(s, 'cards'), what: (n) => `Din bästa dag gav ${n} kort` },
    { id: 'streak', name: 'Uthållig', tiers: [3, 7, 30, 365], count: (s) => longestStreak(s.days), what: (n) => `Din längsta svit är ${n} dagar i rad med kort` },
    { id: 'days', name: 'Stamgäst', tiers: [5, 30, 100, 1000], count: (s) => Object.values(s.days).filter((d) => d.cards).length, what: (n) => `Du har samlat kort ${n} olika dagar` },
    { id: 'sets', name: 'Setsamlare', tiers: [1, 3, 6, SETS.length], count: (s) => { const o = ownedTypes(s); return SETS.filter((set) => setDone(set, o)).length; }, what: (n) => `Du har ${n} kompletta set` },
    { id: 'legendary', name: 'Legend', tiers: [1, 5, 13, 25], count: countIf((c) => c.t < 0), what: (n) => `Du har ${n} legendariska kort` },
    { id: 'epic', name: 'Episk', tiers: [1, 10, 50, Math.ceil(kept.filter((n, i) => levelOf[i] === 3).reduce((a, b) => a + b, 0) / 2)], count: countIf((c) => cardLevel(c) === 3), what: (n) => `Du har ${n} episka kort` },
    { id: 'rare', name: 'Sällsynt', tiers: [1, 25, 100, Math.ceil(kept.filter((n, i) => levelOf[i] === 2).reduce((a, b) => a + b, 0) / 2)], count: countIf((c) => cardLevel(c) === 2), what: (n) => `Du har ${n} sällsynta kort` },
    { id: 'types', name: 'Mångsidig', tiers: [10, 30, 60, TYPES.length], count: (s) => ownedTypes(s).size, what: (n) => `Du har ${n} olika korttyper` },
    { id: 'foot', name: 'Fotgängare', tiers: [10, 100, 1000, 10000], count: countIf((c) => c.foot), what: (n) => `Du har ${n} kort till fots eller cykel` },
    { id: 'nohint', name: 'Spårhund', tiers: [1, 10, 50, 500], count: countIf((c) => c.nohint), what: (n) => `Du har hittat ${n} dolda kort utan ledtråd` },
    { id: 'hint', name: 'Ledtrådsköpare', tiers: [1, 10, 50, 500], count: countIf((c) => c.hint), what: (n) => `Du har hittat ${n} kort med ledtråd` },
    { id: 'sources', name: 'Kommunkännare', tiers: [1, 10, 100, 1000], count: (s) => Object.keys(s.cards).filter((id) => id.includes('.')).length, what: (n) => `Du har ${n} kort från kommunernas egna data` },
    { id: 'early', name: 'Morgonpigg', tiers: [1, 10, 50, 500], count: countIf((c) => hour(c) < 7), what: (n) => `Du har ${n} kort tagna före klockan 7` },
    { id: 'late', name: 'Nattuggla', tiers: [1, 10, 50, 500], count: countIf((c) => hour(c) >= 22), what: (n) => `Du har ${n} kort tagna efter klockan 22` },
    { id: 'winter', name: 'Vinterbadare', tiers: [1, 10, 100, 1000], count: countIf((c) => [11, 0, 1].includes(month(c))), what: (n) => `Du har ${n} kort tagna i december, januari eller februari` },
    { id: 'weekend', name: 'Helgfirare', tiers: [10, 100, 1000, 10000], count: countIf(weekend), what: (n) => `Du har ${n} kort tagna på en helg` },
    { id: 'far', name: 'Långväga', tiers: [1, 10, 100, 1000], count: farFromFirst, what: (n) => `Du har ${n} kort mer än 100 km från ditt första kort` },
  ];
  const types = TYPES.map((t, i) => {
    const [name, plural] = TYPE_TITLES[t.icon] || [t.name, `kort av typen ${t.name}`];
    const first = TYPE_TIERS[levelOf[i]];
    return { id: `t${i}`, type: i, name, tiers: [...first, Math.max(first[2] + 1, Math.ceil(kept[i] / 2))], count: countIf((c) => c.t === i), what: (n) => `Du har ${n} ${plural}` };
  });
  return [...general, ...types];
}

export const tierOf = (a, n) => a.tiers.filter((t) => n >= t).length;

// The points of the player, by source.
export function xpParts(s, achievements, game) {
  const cards = Object.values(s.cards);
  const owned = game.ownedTypes(s);
  const days = Object.values(s.days);
  return [
    ['Kort', cards.reduce((n, c) => n + XP_CARD[game.cardLevel(c)], 0)],
    ['Promenader och cykelturer', Math.floor(days.reduce((n, d) => n + d.m, 0) / XP_METRES)],
    ['Kompletta set', game.SETS.filter((set) => game.setDone(set, owned)).length * XP_SET],
    ['Bedrifter', achievements.reduce((n, a) => n + XP_TIER.slice(0, tierOf(a, a.count(s))).reduce((x, y) => x + y, 0), 0)],
    ['Dagar med kort', days.filter((d) => d.cards).length * XP_DAY + longestStreak(s.days) * 10],
  ];
}

// Level n needs 100 * (n - 1) ^ 1.5 points: level 2 at 100, level 10 at 2,700, level 50 at 34,300.
export const levelAt = (xp) => Math.floor((xp / 100) ** (2 / 3)) + 1;
export const xpFor = (level) => Math.round(100 * (level - 1) ** 1.5);
export const titleAt = (level) => TITLES.filter(([at]) => level >= at).at(-1)[1];

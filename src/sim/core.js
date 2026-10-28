// Shared simulation context: state, data, seeded RNG and read-only queries.
// Nothing in src/sim touches the DOM. All game state lives in one plain JSON object (S).

export let S = null;          // current game state
export let D = null;          // static game data loaded from src/data
export let emit = () => {};   // event hook for the UI (sounds, toasts, medals)
export let MONTH = 30, YEAR = 360, UPKEEP = 2.5e-5;

export function setState(s) { S = s; }
export function setEmitter(f) { emit = f || (() => {}); }
export function setData(d) {
  D = d;
  const byKey = arr => Object.fromEntries(arr.map(x => [x.k, x]));
  D.govMap = byKey(d.governments);
  D.traitMap = byKey(d.traits);
  D.leaderMap = byKey(d.leaders);
  D.techMap = byKey(d.techs);
  MONTH = d.balance.month; YEAR = d.balance.year; UPKEEP = d.balance.upkeep;
}

// Deterministic RNG (mulberry32). Its state is saved with the game.
export function R() {
  const s = S.rng = (S.rng + 0x6D2B79F5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const pick = a => a[Math.floor(R() * a.length)];
export const rnd = (a, b) => a + R() * (b - a);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// Log messages carry tokens the UI turns into coloured names.
export const N = n => `{{n:${n.id}}}`;
export const PN = p => `{{p:${p.id}}}`;
export function log(m, cls, score) {
  const e = { d: S.day, m, c: cls || '', s: score || 0 };
  S.log.unshift(e); if (S.log.length > 250) S.log.length = 250;
  emit('log', e);
}
export const yearOf = d => Math.floor(d / YEAR) + 1;
// A tribe name from a culture's list; falls back to any culture, then numbered names.
export function newTribeName(culture) {
  const own = (D.cultures[culture] || {}).tribes || [], free = own.filter(x => !S.usedNames.includes(x));
  if (free.length) return pick(free);
  const any = Object.values(D.cultures).flatMap(c => c.tribes).filter(x => !S.usedNames.includes(x));
  if (any.length) return pick(any);
  return `Tribe ${S.nations.length + 1}`;
}
export const newNationName = () => newTribeName(pick(Object.keys(D.cultures)));
// Tiles have no name until a tribe settles them; then they take a place name from that tribe's culture.
const ROMAN = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export function nameProvince(p, n) {
  if (p.named) return;
  const used = new Set(S.usedPlaces || (S.usedPlaces = [])), places = (D.cultures[n.culture] || {}).places || [];
  const free = places.filter(x => !used.has(x));
  let name = free.length ? pick(free) : null;
  // real places first, then names built from the culture's own naming elements
  const gen = (D.cultures[n.culture] || {}).gen;
  for (let i = 0; !name && gen && i < 80; i++) { const x = genPlace(gen); if (!used.has(x)) name = x; }
  for (let r = 0; !name && r < ROMAN.length; r++) name = places.map(x => `${x} ${ROMAN[r]}`).find(x => !used.has(x));
  if (!name) name = `${n.name} ${p.id}`;
  p.name = name; p.named = true; S.usedPlaces.push(name);
}
export function genPlace(g) {
  const a = pick(g.pre), b = pick(g.suf), sep = g.sep || '';
  if (sep) return `${a}${sep}${b}`;
  if (a.endsWith('-')) return a + b.charAt(0).toUpperCase() + b.slice(1);
  if (a.slice(-1) === b.charAt(0)) return a + b.slice(1);   // Kil + lough → Killough, not Killlough
  return a + b;
}
export const MIN_ARMY = () => D.balance.minArmy || 5;
export function addDecision(d) { d.id = S.nextDecId++; S.decisions.push(d); emit('decision', d); return d; }
export function unlockMedal(k) { if (!S.st.medals) S.st.medals = []; if (!S.st.medals.includes(k)) { S.st.medals.push(k); emit('medal', k); } }

// ---- per-day cache ----
// Expensive whole-map sums are cached until the day or the map changes. Saves are taken between
// days, so a loaded game recomputes exactly what a continuing game would: determinism is kept.
let cS = null, cDay = -1, cVer = -1; const cache = new Map();
export function memo(key, f) {
  if (cS !== S || cDay !== S.day || cVer !== S.mapVersion) { cache.clear(); cS = S; cDay = S.day; cVer = S.mapVersion; }
  let v = cache.get(key); if (v === undefined) { v = f(); cache.set(key, v); } return v;
}

// ---- queries ----
export const gov = n => D.govMap[n.gov];
export const trait = n => D.traitMap[n.trait];
export const leader = n => D.leaderMap[n.leader];
export const player = () => S.nations.find(n => n.you);
export const provsOf = n => S.P.filter(p => p.owner === n.id);
export const popOf = n => memo('pop' + n.id, () => { let s = 0; for (const p of S.P) if (p.owner === n.id) s += p.pop; return s; });
export const gdpOf = n => memo('gdp' + n.id, () => { let s = 0; for (const p of S.P) if (p.owner === n.id) s += p.gdp; return s; });
export const armiesOf = n => S.armies.filter(a => a.nat === n.id);
export function troopsOf(n) { let s = 0; for (const a of S.armies) if (a.nat === n.id) s += a.troops; return s; }
export const has = (n, k) => n.techs.includes(k);
export const devastated = p => p.devUntil > S.day;
export const stab = n => gov(n).stab + leader(n).stab + (has(n, 'propaganda') ? .2 : 0) - Math.max(0, n.tax - .2) * 2;
export const hasNuke = n => n.trait === 'nuke' || has(n, 'nukes');
export const forceLimit = n => popOf(n) * 1e6 * n.milPct / 100;
export const techCost = n => 10 + n.techs.length * 6;
export const techExtra = (n, t) => t.extra || 0;
export const techAvail = n => D.techs.filter(t => !has(n, t.k) && !(t.k === 'nukes' && hasNuke(n)));
export const researchPerMonth = n => (2 + Math.log10(Math.max(1, gdpOf(n))) * 1.5) / 12;
export const warBetween = (x, y) => S.wars.find(w => (w.a === x && w.b === y) || (w.a === y && w.b === x));
export const atWar = (x, y) => x != null && y != null && x !== y && !!warBetween(x, y);
export const warsOf = id => S.wars.filter(w => w.a === id || w.b === id);
export const enemyIn = (w, id) => w.a === id ? w.b : w.a;
export const allied = (x, y) => S.nations[x].allies.includes(y);
export const truceWith = (x, y) => (S.nations[x].truce[y] || -1) > S.day;
export const isPort = p => p.res === 'port' || p.b.harbour > 0;
export const garrison = p => Math.max(MIN_ARMY(), Math.round(p.pop * 1e6 * (p.owner == null ? .05 : .03))) * (1 + .5 * p.b.fort);
export const upkeepMult = n => (has(n, 'logistics') ? .5 : 1) * n.maint;
export function monthlyIncome(n) {
  let inc = 0; for (const p of S.P) if (p.owner === n.id && p.ctrl === n.id) inc += p.gdp * n.tax / 12;
  const up = troopsOf(n) * UPKEEP / 12 * upkeepMult(n);
  return { inc, up, net: inc - up };
}
export const quality = n => memo('q' + n.id, () => qualityRaw(n));
function qualityRaw(n) {
  let q = 1 + leader(n).q + (has(n, 'artillery') ? .12 : 0) + .03 * Math.log10(Math.max(1, gdpOf(n)));
  if (n.you) q *= D.difficulties[S.diff].q;
  return q * (.6 + .4 * n.maint);
}
export function neighbours(n) {
  const s = new Set();
  for (const p of S.P) if (p.owner === n.id) for (const q of p.landN) { const o = S.P[q].owner; if (o != null && o !== n.id) s.add(o); }
  return [...s].map(i => S.nations[i]).filter(x => x.alive);
}

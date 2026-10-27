// Public API of the simulation. The UI reads state through these exports and changes it only through commands.
import { S, D, setState, setData, R, pick, rnd, newNationName, clamp, MONTH, YEAR, UPKEEP, N, PN, log, emit, yearOf, unlockMedal,
  player, provsOf, popOf, gdpOf, armiesOf, troopsOf, forceLimit, techCost, techExtra, techAvail, warBetween, atWar, warsOf, allied, truceWith, hasNuke, buildCost, monthlyIncome } from './core.js';
import { genWorld } from './world.js';
import { createNation } from './nation.js';
import { makeArmy, orderMove, dailyMilitary, nuke, nukeReady } from './military.js';
import { declareWar, makePeace, checkFallen, warMonthly, aiDiplomacy, aiAccepts, allianceChance } from './diplomacy.js';
import { monthlyNation } from './economy.js';
import { aiArmies } from './ai.js';
import { triggerEvent, resolveDecision } from './events.js';

export * from './core.js';
export { findPath, inBattle, nukeReady, siegeTarget } from './military.js';
export { provValue, warScore, occupiedBy, demandCost, aiAccepts, allianceChance } from './diplomacy.js';

export const SAVE_VERSION = 1;
export function init(data) { setData(data); }

export function newGame({ seed = (Math.random() * 2 ** 31) | 0, mapSize = 'small', nations, goal = 'hegemon', diff = 'normal' }) {
  const s = {
    v: SAVE_VERSION, seed, rng: seed | 0, day: 0, phase: 'setup', goal, diff, nn: nations || D.balance.mapSizes[mapSize].defNations, mapSize,
    W: 0, H: 0, CS: 8, land: [], reg: [], P: [], slots: [], nations: [], armies: [], wars: [], battles: [], decisions: [], log: [],
    usedNames: [], techOffers: [], nextArmyId: 1, nextWarId: 1, nextDecId: 1, mapVersion: 1, st: {}, result: null, over: false
  };
  setState(s);
  genWorld(mapSize, nations || D.balance.mapSizes[mapSize].defNations);
  return s;
}
export function randomDraft() {
  const name = newNationName();
  return { name, gov: pick(D.governments).k, popM: pick(D.setup.pops).v * rnd(.85, 1.15), milPct: pick(D.setup.mils).v, gdp: pick(D.setup.ecos).v * rnd(.85, 1.15), trait: pick(D.traits).k, leader: pick(D.leaders).k };
}
export function foundNation(draft, slotIdx, you) { return createNation(draft, S.slots[slotIdx], you); }
export function startGame() {
  S.phase = 'game'; S.day = 0;
  log(`The wheel has spoken. ${S.nations.length} nations and ${S.P.filter(q => q.owner == null).length} free provinces.`, 'big', 0);
}

// ---------- time ----------
export function tick() {
  if (S.phase !== 'game' || S.over) return;
  S.day++;
  dailyMilitary();
  if (S.day % MONTH === 0) monthlyTick();
  aiArmies();
}
function monthlyTick() {
  for (const n of S.nations) if (n.alive) monthlyNation(n);
  for (const w of S.wars.slice()) warMonthly(w);
  aiDiplomacy();
  const p = player();
  if (p && p.alive) {
    if (provsOf(p).length === 1) S.st.lowPoint = true;
    if (p.allies.length >= 3) unlockMedal('friends');
    if (gdpOf(p) >= 5000) unlockMedal('trillion');
    if (p.techs.length >= 6) unlockMedal('scholar');
    if (!S.result && !S.st.autoPlayer && R() < 1 / 16) triggerEvent();
  }
  checkEnd();
  S.mapVersion++;
}

// ---------- goals ----------
const provShare = n => provsOf(n).length / S.P.length;
export function goalProgress(p) {
  const rivals = S.nations.filter(n => n.alive && !n.you);
  if (S.goal === 'conquest') return { pct: rivals.length ? 1 - rivals.length / Math.max(1, S.nations.length - 1) : 1, txt: `${rivals.length} rival nation${rivals.length === 1 ? '' : 's'} left` };
  if (S.goal === 'hegemon') return { pct: Math.min(1, provShare(p) / .6), txt: `${provsOf(p).length} of ${Math.ceil(S.P.length * .6)} provinces needed` };
  if (S.goal === 'economy') { const x = gdpOf(p) / p.startGdp, top = rivals.every(n => gdpOf(n) <= gdpOf(p)); return { pct: Math.min(1, x / 3) * (top ? 1 : .95), txt: `${x.toFixed(1)}× of 3× starting GDP · ${top ? 'richest nation' : 'not yet the richest'}` }; }
  return { pct: Math.min(1, S.day / (60 * YEAR)), txt: `Year ${yearOf(S.day)} of 60` };
}
function goalMet(p) {
  if (S.goal === 'conquest') return S.nations.filter(n => n.alive && !n.you).length === 0;
  if (S.goal === 'hegemon') return provShare(p) >= .6;
  if (S.goal === 'economy') return gdpOf(p) >= p.startGdp * 3 && S.nations.every(n => !n.alive || n.you || gdpOf(n) <= gdpOf(p));
  return S.day >= 60 * YEAR;
}
export function scoreFor(p, won) {
  const base = (p.alive ? provsOf(p).length * 60 : 0) + Math.round(Math.log10(Math.max(1, gdpOf(p))) * 150) + Math.min(yearOf(S.day), 120) * 4 + p.techs.length * 40;
  return Math.round((base + (won ? Math.max(300, 1500 - yearOf(S.day) * 12) : 0)) * D.difficulties[S.diff].mult);
}
function checkEnd() {
  checkFallen();
  const p = player(), alive = S.nations.filter(n => n.alive);
  if (!S.result && p) {
    if (!p.alive) endGame(false, `${p.name} fell in year ${yearOf(S.day)}`);
    else if (goalMet(p)) endGame(true, `${D.goals[S.goal].n} achieved in year ${yearOf(S.day)}`);
    else if (alive.length === 1) endGame(true, `Last nation standing in year ${yearOf(S.day)}`);
    else if (S.day >= D.balance.maxYears * YEAR) endGame(false, `Time ran out. ${D.goals[S.goal].n} not achieved`);
  }
  if (alive.length <= 1) S.over = true;
}
function endGame(won, why) {
  const p = player();
  S.result = { won, why, score: scoreFor(p, won) };
  if (won) {
    unlockMedal('first'); unlockMedal(S.goal); if (S.diff === 'hard') unlockMedal('hard');
    if (S.nations.filter(n => !n.rebel).every(n => n.startPop >= p.startPop)) unlockMedal('underdog');
    if (S.st.lowPoint) unlockMedal('comeback');
    if (!S.st.declared) unlockMedal('pacifist');
  }
  log(won ? `${N(p)} wins. ${why}.` : `Game over. ${why}.`, won ? 'big' : 'bad', 12);
  emit('end', S.result);
}

// ---------- commands (player actions) ----------
const fail = msg => ({ ok: false, msg });
const mine = a => a && S.nations[a.nat].you;
const army = id => S.armies.find(a => a.id === id);
const canAct = () => { const p = player(); return p && p.alive && S.phase === 'game'; };

export function cmdMove(armyIds, provId) {
  if (!canAct()) return fail('You cannot give orders now.');
  let moved = 0; for (const id of armyIds) { const a = army(id); if (mine(a) && orderMove(a, provId)) moved++; }
  return moved ? { ok: true, moved } : fail('No route there. You need to be at war with the owner, or a port or navy to cross the sea.');
}
export function cmdStop(id) { const a = army(id); if (!mine(a) || a.retreat) return fail('Cannot stop this army.'); a.path = []; a.prog = 0; return { ok: true }; }
export function cmdSplit(id) {
  const a = army(id); if (!mine(a) || a.path.length || a.troops < 2000) return fail('Only an idle army of 2,000+ can split.');
  const b = makeArmy(S.nations[a.nat], a.prov, a.troops / 2); a.troops /= 2; return { ok: true, army: b.id };
}
export function cmdMerge(ids) {
  const list = ids.map(army).filter(a => mine(a) && !a.path.length && a.prog === 0);
  if (list.length < 2 || !list.every(a => a.prov === list[0].prov)) return fail('Armies must be idle in the same province to merge.');
  const keep = list[0]; for (const o of list.slice(1)) keep.troops += o.troops;
  S.armies = S.armies.filter(a => !list.slice(1).includes(a)); return { ok: true, army: keep.id };
}
export function cmdDischarge(id, frac) {
  const a = army(id); if (!mine(a)) return fail('Not your army.');
  const n = S.nations[a.nat], l = a.troops * clamp(frac, 0, 1);
  n.manpower = Math.min(forceLimit(n) * .5, n.manpower + l * .5);
  a.troops -= l; if (a.troops < 300) S.armies = S.armies.filter(x => x !== a);
  return { ok: true };
}
export function recruitLimits() {
  const p = player(), fl = forceLimit(p), room = Math.max(0, fl - troopsOf(p));
  return { fl, room, max: Math.floor(Math.min(p.manpower, room)), costPer: UPKEEP * 1.5, upkeepPer: UPKEEP / 12 * (p.techs.includes('logistics') ? .5 : 1) * p.maint };
}
export function cmdRecruit(provId, troops) {
  if (!canAct()) return fail('You cannot recruit now.');
  const p = player(), pr = S.P[provId], lim = recruitLimits();
  if (!pr || pr.owner !== p.id || pr.ctrl !== p.id) return fail('You can only recruit in provinces you own and control.');
  troops = Math.floor(Math.min(troops, lim.max));
  if (troops < 1000) return fail('Not enough manpower or room under your force limit.');
  const cost = troops * lim.costPer; if (p.treasury < cost) return fail('Not enough money.');
  p.manpower -= troops; p.treasury -= cost;
  const a = makeArmy(p, provId, troops);
  log(`${N(p)} raises ${troops.toLocaleString('en-IE')} soldiers in ${PN(pr)}.`, null, 1);
  return { ok: true, army: a.id };
}
export function cmdBuild(provId, k) {
  if (!canAct()) return fail('You cannot build now.');
  const p = player(), pr = S.P[provId], B = D.buildings[k];
  if (!pr || !B || pr.owner !== p.id || pr.ctrl !== p.id) return fail('You can only build in provinces you own and control.');
  if (pr.build) return fail('This province is already building something.');
  if (pr.b[k] >= B.max) return fail('Already at the maximum level.');
  if (B.coast && !pr.coastal) return fail('Needs a coastal province.');
  const c = buildCost(pr, k); if (p.treasury < c) return fail('Not enough money.');
  p.treasury -= c; pr.build = { k, nat: p.id, done: S.day + D.balance.buildDays }; S.mapVersion++;
  log(`${N(p)} starts building ${B.n.toLowerCase()} in ${PN(pr)}.`, null, 1);
  return { ok: true };
}
export function cmdPolicy({ tax, milPct, maint }) {
  const p = player(); if (!p) return fail('No nation.');
  if (tax != null) p.tax = clamp(tax, .05, .3);
  if (milPct != null) p.milPct = clamp(milPct, .5, 12);
  if (maint != null) p.maint = clamp(maint, .5, 1);
  return { ok: true };
}
export function cmdDeclareWar(targetId) {
  if (!canAct()) return fail('You cannot declare war now.');
  const p = player(), t = S.nations[targetId];
  if (!t || !t.alive || t.you) return fail('Invalid target.');
  if (atWar(p.id, t.id)) return fail('Already at war.');
  if (allied(p.id, t.id)) return fail('Break the alliance first.');
  if (truceWith(p.id, t.id)) return fail('You have a truce with them.');
  declareWar(p, t); return { ok: true };
}
export function cmdProposeAlliance(targetId) {
  const p = player(), t = S.nations[targetId];
  if (!canAct() || !t || !t.alive || t.you || allied(p.id, t.id) || atWar(p.id, t.id)) return fail('Not possible.');
  const ch = allianceChance(p, t);
  if (R() < ch) { p.allies.push(t.id); t.allies.push(p.id); log(`${N(t)} accepts your alliance.`, null, 4); return { ok: true, accepted: true }; }
  t.lastAsk = S.day; log(`${N(t)} turns down your alliance.`, null, 2); return { ok: true, accepted: false };
}
export function cmdBreakAlliance(targetId) {
  const p = player(), t = S.nations[targetId]; if (!t || !allied(p.id, t.id)) return fail('Not allied.');
  p.allies = p.allies.filter(x => x !== t.id); t.allies = t.allies.filter(x => x !== p.id);
  log(`${N(p)} ends its alliance with ${N(t)}.`, null, 3); return { ok: true };
}
export function cmdNuke(provId) {
  const p = player(), pr = S.P[provId]; if (!canAct() || !pr) return fail('Not possible.');
  const tgt = pr.ctrl != null ? pr.ctrl : pr.owner;
  if (tgt == null || tgt === p.id || !atWar(p.id, tgt)) return fail('You can only strike nations you are at war with.');
  if (!hasNuke(p)) return fail('You have no nuclear weapons.');
  if (!nukeReady(p)) return fail('Your nuclear arsenal is rearming.');
  nuke(p, pr); return { ok: true };
}
export function cmdPeace(warId, provIds) {
  const p = player(), w = S.wars.find(x => x.id === warId); if (!w || (w.a !== p.id && w.b !== p.id)) return fail('No such war.');
  if (!aiAccepts(w, p.id, provIds)) return fail('They refuse these terms.');
  makePeace(w, p.id, provIds, ''); return { ok: true };
}
export function cmdResearch(k) {
  const p = player(), t = D.techMap[k]; if (!p || !t || !S.techOffers.includes(k)) return fail('Not available.');
  const c = techCost(p) + techExtra(p, t); if (p.rp < c) return fail('Not enough research points.');
  p.rp -= c; p.techs.push(k); S.techOffers = [];
  log(`${N(p)} develops ${t.n.toLowerCase()}.`, null, 3);
  if (p.techs.length >= 6) unlockMedal('scholar');
  return { ok: true };
}
export function chooseDecision(id, idx) { const out = resolveDecision(id, idx); return out == null ? fail('Decision expired.') : { ok: true, text: out }; }
export function setAutoPlayer(on) { S.st.autoPlayer = !!on; }

// ---------- save / load ----------
export function serialize() { return JSON.parse(JSON.stringify(S)); }
export function load(state) {
  if (!state || state.v !== SAVE_VERSION) throw new Error('This save is from an incompatible version.');
  setState(state); return S;
}

// Public API of the simulation. The UI reads state through these exports and changes it only through commands.
import { S, D, setState, setData, R, pick, rnd, newTribeName, MIN_ARMY, shuffle, clamp, MONTH, YEAR, UPKEEP, N, PN, log, emit, yearOf, unlockMedal,
  player, provsOf, popOf, gdpOf, armiesOf, troopsOf, forceLimit, techCost, techExtra, techAvail, warBetween, atWar, warsOf, allied, truceWith, hasNuke, monthlyIncome } from './core.js';
import { genWorld } from './world.js';
import { createNation } from './nation.js';
import { makeArmy, orderMove, dailyMilitary, dailyAttrition, nuke, nukeReady, reinforce, mor, mixOf, MORALE } from './military.js';
import { orderBuild, ECON, provincesByOwner, weeklyProduction, spend, bestProvinceFor } from './industry.js';
import { declareWar, makePeace, checkFallen, warMonthly, aiDiplomacy, aiAccepts, allianceChance, normDeal } from './diplomacy.js';
import { monthlyNation, weeklyNation, dailyNation, ERA_TRAITS } from './economy.js';
import { aiArmies } from './ai.js';
import { triggerEvent, resolveDecision } from './events.js';

export * from './core.js';
export { findPath, inBattle, nukeReady, siegeTarget, canColonise, mor, MORALE, mixOf, mixEff, formation, battleView, BATTLE, armyName, hopDays } from './military.js';
export { GOODS, ECON, workforce, setting, biome, yieldOf, outputsOf, canPlace, buildCost, canAfford, buildersNeeded, freeWorkers, bestProvinceFor } from './industry.js';
export { provValue, provCost, isCrushed, CRUSH_MULT, warScore, occupiedBy, demandCost, aiAccepts, allianceChance, surrenderStatus, dealCost, requiredOffer, goldAmount, normDeal, isWhite, TERMS } from './diplomacy.js';

export const SAVE_VERSION = 3;
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
// A starting tribe: a few hundred farmers on one tile.
export function tribeDraft(culture, name) {
  if (!culture || !D.cultures[culture]) { const used = new Set(S.nations.map(n => n.culture)), free = Object.keys(D.cultures).filter(k => !used.has(k)); culture = pick(free.length ? free : Object.keys(D.cultures)); }
  const [lo, hi] = D.balance.startPop, popM = Math.round(rnd(lo, hi)) / 1e6;
  return { name: (name && name.trim()) || newTribeName(culture), culture, gov: 'tribal', popM, milPct: D.balance.startMil, gdp: popM * rnd(3, 5), trait: pick(ERA_TRAITS()).k, leader: pick(D.leaders).k };
}
export const randomDraft = () => tribeDraft();
// Place every tribe: the player on a random starting tile, the rest of the cultures chosen at random.
export function setupTribes({ name, culture } = {}) {
  const order = shuffle(S.slots.map((_, i) => i)), you = order[0];
  createNation(tribeDraft(culture, name), S.slots[you], true);
  for (const i of order.slice(1)) createNation(tribeDraft(), S.slots[i], false);
}
export function foundNation(draft, slotIdx, you) { return createNation(draft, S.slots[slotIdx], you); }
export function startGame() {
  S.phase = 'game'; S.day = 0;
  const byOwner = provincesByOwner(); for (const n of S.nations) weeklyProduction(n, byOwner.get(n.id) || []);   // first week's figures are ready at once
  log(`${S.nations.length} tribes settle the land. ${S.P.filter(q => q.owner == null).length} tiles lie unclaimed.`, 'big', 0);
}

// ---------- time ----------
export function tick() {
  if (S.phase !== 'game' || S.over) return;
  S.day++;
  dailyMilitary(); dailyAttrition();
  for (const n of S.nations) if (n.alive) dailyNation(n);
  if (S.day % 7 === 0) { const byOwner = provincesByOwner(); for (const n of S.nations) if (n.alive) weeklyNation(n, byOwner.get(n.id) || []); }
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
  const a = army(id); if (!mine(a) || a.path.length || a.troops < MIN_ARMY() * 2) return fail(`Only an idle army of ${MIN_ARMY() * 2}+ can split.`);
  const b = makeArmy(S.nations[a.nat], a.prov, a.troops / 2, mixOf(a)); a.troops /= 2; b.mor = mor(a); return { ok: true, army: b.id };
}
export function cmdMerge(ids) {
  const list = ids.map(army).filter(a => mine(a) && !a.path.length && a.prog === 0);
  if (list.length < 2 || !list.every(a => a.prov === list[0].prov)) return fail('Armies must be idle in the same province to merge.');
  const keep = list[0]; for (const o of list.slice(1)) reinforce(keep, o.troops, mor(o), mixOf(o));
  S.armies = S.armies.filter(a => !list.slice(1).includes(a)); return { ok: true, army: keep.id };
}
export function cmdDischarge(id, frac) {
  const a = army(id); if (!mine(a)) return fail('Not your army.');
  const n = S.nations[a.nat], l = a.troops * clamp(frac, 0, 1);
  n.manpower = Math.min(forceLimit(n) * .5, n.manpower + l * .5);
  n.stock.swords += l * mixOf(a); n.stock.spears += l * (1 - mixOf(a));   // weapons go back into store
  a.troops -= l; if (a.troops < MIN_ARMY()) S.armies = S.armies.filter(x => x !== a);
  return { ok: true };
}
export function recruitLimits() {
  const p = player(), fl = forceLimit(p), room = Math.max(0, fl - troopsOf(p));
  return { fl, room, max: Math.floor(Math.min(p.manpower, room, p.stock.swords + p.stock.spears)), swords: Math.floor(p.stock.swords), spears: Math.floor(p.stock.spears), costPer: UPKEEP * 1.5, upkeepPer: UPKEEP / 12 * (p.techs.includes('logistics') ? .5 : 1) * p.maint };
}
// Raise swordsmen and spearmen: each needs a sword or a spear from the stockpile.
export function cmdRecruit(provId, sw, sp) {
  if (!canAct()) return fail('You cannot recruit now.');
  const p = player(), pr = S.P[provId], lim = recruitLimits();
  if (!pr || pr.owner !== p.id || pr.ctrl !== p.id) return fail('You can only recruit in provinces you own and control.');
  sw = Math.floor(Math.max(0, Math.min(sw, p.stock.swords))); sp = Math.floor(Math.max(0, Math.min(sp, p.stock.spears)));
  const room = Math.floor(Math.min(p.manpower, lim.room));
  if (sw + sp > room) { const k = room / (sw + sp); sw = Math.floor(sw * k); sp = Math.floor(sp * k); }
  const troops = sw + sp;
  if (troops < MIN_ARMY()) return fail('Not enough manpower, weapons or room under your force limit.');
  const cost = troops * lim.costPer; if (p.treasury < cost) return fail('Not enough money.');
  p.manpower -= troops; p.treasury -= cost; p.stock.swords -= sw; p.stock.spears -= sp; spend(p, 'army', { swords: sw, spears: sp });
  const a = makeArmy(p, provId, troops, sw / troops);
  log(`${N(p)} raises ${sw.toLocaleString('en-IE')} swordsmen and ${sp.toLocaleString('en-IE')} spearmen in ${PN(pr)}.`, null, 1);
  return { ok: true, army: a.id };
}
export function cmdBuild(provId, k, lv = 1) {
  if (!canAct()) return fail('You cannot build now.');
  const p = player(), pr = S.P[provId]; if (!pr || !D.buildings[k]) return fail('Not possible.');
  const r = orderBuild(p, pr, k, Math.max(1, Math.floor(lv)));
  if (!r.ok) return fail(r.why);
  log(`${N(p)} starts building ${D.buildings[k].n.toLowerCase()}${pr.build.lv > 1 ? ` ×${pr.build.lv}` : ''} in ${PN(pr)}.`, null, 1);
  return { ok: true };
}
export function cmdCancelBuild(provId) {
  const p = player(), pr = S.P[provId]; if (!pr || !pr.build || pr.build.nat !== p.id) return fail('Nothing to cancel.');
  const c = D.buildings[pr.build.k].cost || {}; for (const g in c) p.stock[g] += c[g] * pr.build.lv * .5;   // half the materials come back
  pr.build = null; S.mapVersion++; return { ok: true };
}
// How hard a building works in this province (0 to 1): lowering it frees workers for other jobs or for builders.
export function cmdSetProduction(provId, k, v) {
  const p = player(), pr = S.P[provId]; if (!pr || pr.owner !== p.id || !ECON().includes(k)) return fail('Not possible.');
  (pr.set || (pr.set = {}))[k] = clamp(v, 0, 1); return { ok: true };
}
// Set a building's work rate in every province at once.
export function cmdSetProductionAll(k, v) {
  const p = player(); if (!p || !ECON().includes(k)) return fail('Not possible.');
  for (const pr of S.P) if (pr.owner === p.id && pr.b[k]) (pr.set || (pr.set = {}))[k] = clamp(v, 0, 1);
  return { ok: true };
}
// Build in whichever province has the most free workers (and the best land for farms, forestry and quarries).
export function cmdBuildBest(k, lv = 1) {
  if (!canAct()) return fail('You cannot build now.');
  const p = player(), pr = bestProvinceFor(p, k);
  if (!pr) return fail('No province can take this right now: each province builds one thing at a time.');
  const r = cmdBuild(pr.id, k, lv); return r.ok ? { ok: true, prov: pr.id } : r;
}
export function cmdRename(armyId, name) {
  const a = army(armyId); if (!mine(a)) return fail('Not your army.');
  a.name = String(name || '').trim().slice(0, 32) || a.name; return { ok: true };
}
export function cmdSetCrop(provId, crop) {
  const p = player(), pr = S.P[provId]; if (!pr || pr.owner !== p.id || !D.buildings.farm.methods.some(m => m.k === crop)) return fail('Not possible.');
  pr.crop = crop; return { ok: true };
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
// deal.to is who receives the terms: the player when demanding, the enemy when offering. Empty deal = white peace.
export function cmdPeace(warId, deal) {
  const p = player(), w = S.wars.find(x => x.id === warId); if (!w || (w.a !== p.id && w.b !== p.id)) return fail('No such war.');
  deal = normDeal(deal, p.id); if (deal.to !== w.a && deal.to !== w.b) return fail('Invalid treaty.');
  const loserId = deal.to === w.a ? w.b : w.a;
  deal.provs = deal.provs.filter(id => S.P[id] && S.P[id].owner === loserId && S.P[id].ctrl === deal.to);
  if (!aiAccepts(w, p.id, deal)) return fail('They refuse these terms.');
  makePeace(w, deal.to, deal, ''); return { ok: true };
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

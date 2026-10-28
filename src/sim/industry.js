// Production economy: goods, workforce, buildings, weekly production, construction.
// Goods sit in one national stockpile. Every province employs its own workforce in its own buildings;
// raw industries (farm, forestry, quarry) need stone tools to work at full speed; workshops turn inputs
// into outputs; people eat bread. Construction costs wood and stone and needs free workers as builders.
import { S, D, R, N, PN, log, emit, has, devastated, forceLimit, warsOf } from './core.js';

export const GOODS = () => Object.keys(D.goods);
const SPOIL = { bread: .03, wheat: .01 };   // weekly share of food stocks that goes off
export const ECON = () => Object.keys(D.buildings).filter(k => D.buildings[k].kind !== 'mil');
const E = () => D.balance.econ;

export const workforce = p => p.pop * 1e6 * E().workShare;
export const setting = (p, k) => (p.set && p.set[k] != null ? p.set[k] : 1);
export const biome = p => D.biomes[p.biome] || D.biomes.plains;
export const yieldOf = (p, k) => { const y = biome(p).y[k]; return y == null ? 1 : y; };
export function emptyStock() { return Object.fromEntries(GOODS().map(g => [g, 0])); }
export function outputsOf(p, k) {
  const B = D.buildings[k];
  if (B.methods) { const m = B.methods.find(x => x.k === p.crop) || B.methods[0]; return m.out; }
  return B.out || {};
}

// Can this building go in this province at all?
export function canPlace(p, k) {
  const B = D.buildings[k]; if (!B) return { ok: false, why: 'Unknown building.' };
  if (B.coast && !p.coastal) return { ok: false, why: 'Needs a coastal province.' };
  if (B.kind === 'raw' && yieldOf(p, k) <= 0) return { ok: false, why: `Not possible in ${biome(p).n.toLowerCase()}.` };
  if (B.max && p.b[k] >= B.max) return { ok: false, why: 'Already at the maximum level.' };
  return { ok: true };
}
const mult = (n, p, k) => {
  const B = D.buildings[k];
  let m = B.kind === 'raw' ? yieldOf(p, k) : 1;
  if (k === 'farm') { if (has(n, 'green')) m *= 1.25; if (n.trait === 'famine') m *= .8; }
  if (B.kind === 'proc' && has(n, 'industry')) m *= 1.2;
  if (devastated(p)) m *= .5;
  return m;
};

// ---------- weekly production ----------
// Group provinces by owner once a week; occupied provinces produce nothing for anyone.
export function provincesByOwner() {
  const m = new Map();
  for (const p of S.P) {
    if (p.owner == null) continue;
    if (p.ctrl !== p.owner) { p.staff = {}; p.work = 0; p.emp = 0; p.out = {}; continue; }
    let l = m.get(p.owner); if (!l) m.set(p.owner, l = []); l.push(p);
  }
  return m;
}
export function weeklyProduction(n, ps = S.P.filter(p => p.owner === n.id && p.ctrl === n.id)) {
  const st = n.stock || (n.stock = emptyStock());
  const prod = emptyStock(), use = emptyStock(), dem = emptyStock();
  const econ = ECON();
  // 1. staffing: each province fills its buildings' jobs from its own workforce, scaled down evenly if short.
  for (const p of ps) {
    const wf = workforce(p); let want = 0;
    for (const k of econ) if (p.b[k]) want += p.b[k] * D.buildings[k].jobs * setting(p, k);
    const r = want > 0 ? Math.min(1, wf / want) : 0;
    const staff = p.staff || (p.staff = {}); for (const k of econ) staff[k] = p.b[k] ? p.b[k] * setting(p, k) * r : 0;
    p.work = Math.min(wf, want); p.emp = wf > 0 ? p.work / wf : 0; p.out = {};
  }
  // 2. tools wear out in raw industries; without them output falls to half.
  let toolNeed = 0;
  for (const p of ps) for (const k of E().rawOrder) toolNeed += (p.staff[k] || 0) * D.buildings[k].tools;
  dem.tools += toolNeed;
  const toolSat = toolNeed > 0 ? Math.min(1, st.tools / toolNeed) : 1;
  st.tools -= toolNeed * toolSat; use.tools += toolNeed * toolSat;
  const toolF = E().toolMinOutput + (1 - E().toolMinOutput) * toolSat;
  n.toolSat = toolSat;
  // 3. raw goods
  for (const p of ps) for (const k of E().rawOrder) {
    const eff = p.staff[k]; if (!eff) continue;
    const out = outputsOf(p, k), m = mult(n, p, k) * toolF;
    for (const g in out) { const a = eff * out[g] * m; st[g] += a; prod[g] += a; p.out[k] = (p.out[k] || 0) + a; }
  }
  // 4. workshops, in priority order (bread first): inputs shared across the nation
  for (const k of E().procOrder) {
    const B = D.buildings[k]; let lv = 0;
    for (const p of ps) lv += p.staff[k] || 0;
    if (!lv) continue;
    let sat = 1;
    for (const g in B.in) { const need = lv * B.in[g]; dem[g] += need; sat = Math.min(sat, need > 0 ? st[g] / need : 1); }
    sat = Math.max(0, Math.min(1, sat));
    for (const g in B.in) { const u = lv * B.in[g] * sat; st[g] -= u; use[g] += u; }
    for (const p of ps) { const eff = p.staff[k]; if (!eff) continue;
      for (const g in B.out) { const a = eff * B.out[g] * sat * mult(n, p, k); st[g] += a; prod[g] += a; p.out[k] = (p.out[k] || 0) + a; } }
    (n.procSat || (n.procSat = {}))[k] = sat;
  }
  // 5. people eat bread and burn firewood, shared evenly across controlled provinces
  let people = 0; for (const p of ps) people += p.pop * 1e6;
  const need = people * E().breadPerPerson; dem.bread += need;
  const eat = Math.min(st.bread, need); st.bread -= eat; use.bread += eat;
  n.fed = need > 0 ? eat / need : 1;
  const fuel = people * (E().woodPerPerson || 0); dem.wood += fuel;
  const burn = Math.min(st.wood, fuel); st.wood -= burn; use.wood += burn;
  n.warm = fuel > 0 ? burn / fuel : 1;
  for (const g in SPOIL) st[g] *= 1 - SPOIL[g];
  for (const g of GOODS()) if (st[g] < 1e-6) st[g] = 0;
  n.flow = { prod, use, dem };
}

// ---------- construction ----------
export function buildCost(k, lv = 1) { const c = D.buildings[k].cost || {}; return Object.fromEntries(Object.entries(c).map(([g, v]) => [g, v * lv])); }
export const canAfford = (n, cost) => Object.entries(cost).every(([g, v]) => (n.stock[g] || 0) >= v);
export function orderBuild(n, p, k, lv = 1) {
  const B = D.buildings[k], pl = canPlace(p, k);
  if (!pl.ok) return pl;
  if (p.owner !== n.id || p.ctrl !== n.id) return { ok: false, why: 'You can only build in provinces you own and control.' };
  if (p.build) return { ok: false, why: 'This province is already building something.' };
  if (B.max) lv = Math.min(lv, B.max - p.b[k]);
  const cost = buildCost(k, lv);
  if (!canAfford(n, cost)) return { ok: false, why: 'Not enough materials.' };
  for (const g in cost) n.stock[g] -= cost[g];
  p.build = { k, lv, nat: n.id, prog: 0, staffed: 0 }; S.mapVersion++;
  return { ok: true };
}
export const buildersNeeded = p => p.build ? p.build.lv * D.buildings[p.build.k].builders : 0;
export const freeWorkers = p => Math.max(0, workforce(p) - (p.work || 0));
export function weeklyConstruction(n, ps = S.P) {
  for (const p of ps) {
    if (!p.build || p.build.nat !== n.id) continue;
    const B = D.buildings[p.build.k];
    if (p.owner !== n.id || p.ctrl !== n.id) { if (n.you) log(`Construction of ${B.n.toLowerCase()} in ${PN(p)} is abandoned.`, 'bad', 2); p.build = null; S.mapVersion++; continue; }
    const staff = Math.min(1, freeWorkers(p) / Math.max(1, buildersNeeded(p)));
    p.build.staffed = staff; p.build.prog += staff / B.weeks;
    if (p.build.prog >= 1) {
      const { k, lv } = p.build; p.b[k] += lv; p.build = null; S.mapVersion++;
      if (n.you) { log(`${B.n}${lv > 1 ? ` ×${lv}` : ''} completed in ${PN(p)}.`, null, 3); emit('toast', { lab: 'Construction complete', title: `${B.n}${lv > 1 ? ` ×${lv}` : ''} · ${p.name}`, sub: B.d }); }
    }
  }
}

// ---------- starting economy ----------
// A farming tribe: enough fields, ovens, timber and stone to feed and warm everyone, with a little to spare.
export function startingEconomy(n, provIds) {
  const ps = provIds.map(i => S.P[i]), cap = ps[0], people = ps.reduce((s, p) => s + p.pop * 1e6, 0), B = D.buildings;
  for (const p of ps) for (const k of ECON()) p.b[k] = 0;
  const best = k => ps.filter(p => canPlace(p, k).ok).sort((a, b) => yieldOf(b, k) - yieldOf(a, k))[0] || cap;
  const fp = best('farm'), bp = best('forestry'), qp = best('quarry');
  const bread = people * E().breadPerPerson * 1.05;
  fp.b.farm = Math.max(1, Math.ceil(bread / (B.farm.methods[0].out.wheat * Math.max(.1, yieldOf(fp, 'farm')))));
  cap.b.bakery = Math.max(1, Math.ceil(bread / B.bakery.out.bread));
  cap.b.toolsmith = 1; cap.b.swordsmith = 1; cap.b.spearsmith = 1; qp.b.quarry = 1;
  const wood = cap.b.bakery * B.bakery.in.wood + people * E().woodPerPerson + B.toolsmith.in.wood + B.swordsmith.in.wood + B.spearsmith.in.wood;
  bp.b.forestry = Math.max(1, Math.ceil(wood * 1.15 / (B.forestry.out.wood * Math.max(.1, yieldOf(bp, 'forestry')))));
  n.stock = emptyStock();
  Object.assign(n.stock, { bread: people * 3, wheat: B.bakery.in.wheat, wood: 60, stone: 60, tools: 10 });
}

// ---------- AI economy ----------
// Once a month: find the most pressing shortage and build to fix it where there are free workers and good land.
const levelsOf = (n, k) => S.P.reduce((s, p) => s + (p.owner === n.id ? p.b[k] + (p.build && p.build.k === k ? p.build.lv : 0) : 0), 0);
export function aiPlanEconomy(n) {
  const f = n.flow, st = n.stock; if (!f) return;
  const ps = S.P.filter(p => p.owner === n.id && p.ctrl === n.id); if (!ps.length) return;
  const B = D.buildings, fl = forceLimit(n), need = [];
  const wheat = B.farm.methods[0].out.wheat, avgY = k => { const c = ps.filter(p => yieldOf(p, k) > 0); return c.length ? c.reduce((s, p) => s + yieldOf(p, k), 0) / c.length : 1; };
  // bread: enough bakeries for everyone, and enough wheat for the bakeries
  const fed = k => (n.procSat?.[k] ?? 1) >= .9;   // is this workshop getting its inputs?
  const breadCap = levelsOf(n, 'bakery') * B.bakery.out.bread, breadNeed = f.dem.bread * 1.05;
  if (breadCap < breadNeed && st.bread < f.dem.bread * 8 && (fed('bakery') || st.wheat > f.dem.wheat * 4)) need.push(['bakery', Math.ceil((breadNeed - breadCap) / B.bakery.out.bread)]);
  const wheatNeed = Math.max(breadCap, breadNeed) * B.bakery.in.wheat / B.bakery.out.bread, wheatCap = levelsOf(n, 'farm') * wheat * avgY('farm') * .9;
  if (wheatCap < wheatNeed && st.wheat < f.dem.wheat * 8) need.push(['farm', Math.ceil((wheatNeed - wheatCap) / (wheat * avgY('farm') * .9))]);
  // tools for every raw industry
  const toolCap = levelsOf(n, 'toolsmith') * B.toolsmith.out.tools, toolNeed = f.dem.tools * 1.15 + .5;
  if (toolCap < toolNeed && fed('toolsmith')) need.push(['toolsmith', Math.ceil((toolNeed - toolCap) / B.toolsmith.out.tools)]);
  // weapons: keep a reserve that grows in wartime
  const war = warsOf(n.id).length > 0, target = fl * (war ? .3 : .15), cap = 1 + Math.floor(fl / 150);
  for (const k of ['swordsmith', 'spearsmith']) {
    const g = k === 'swordsmith' ? 'swords' : 'spears', have = levelsOf(n, k);
    if (st[g] < target && have < cap && fed(k)) need.push([k, Math.min(cap - have, Math.ceil((target - st[g]) / (B[k].out[g] * 26)))]);
  }
  // wood and stone for workshops and building, with a buffer
  const wood = f.dem.wood * 1.1 + 5 - levelsOf(n, 'forestry') * B.forestry.out.wood * avgY('forestry') * .9;
  if ((wood > 0 || st.wood < 30 + f.dem.wood * 2) && st.wood < f.dem.wood * 26 + 150) need.push(['forestry', Math.max(1, Math.ceil(wood / (B.forestry.out.wood * avgY('forestry') * .9)))]);
  const stone = f.dem.stone * 1.1 + 3 - levelsOf(n, 'quarry') * B.quarry.out.stone * avgY('quarry') * .9;
  if ((stone > 0 || st.stone < 30 + f.dem.stone * 2) && st.stone < f.dem.stone * 26 + 150) need.push(['quarry', Math.max(1, Math.ceil(stone / (B.quarry.out.stone * avgY('quarry') * .9)))]);
  let orders = 0; const maxOrders = 3 + Math.floor(ps.length / 2);
  for (let [k, want] of need) {
    const Bk = B[k];
    const cands = ps.filter(p => !p.build && canPlace(p, k).ok && freeWorkers(p) >= Bk.jobs * .6)
      .sort((a, b) => freeWorkers(b) * (Bk.kind === 'raw' ? yieldOf(b, k) : 1) - freeWorkers(a) * (Bk.kind === 'raw' ? yieldOf(a, k) : 1));
    for (const p of cands) {
      if (want <= 0 || orders >= maxOrders) break;
      let lv = Math.max(1, Math.min(want, Math.floor(freeWorkers(p) / (Bk.jobs + Bk.builders))));
      while (lv > 1 && !canAfford(n, buildCost(k, lv))) lv = Math.floor(lv / 2);
      if (orderBuild(n, p, k, lv).ok) { orders++; want -= lv; }
    }
  }
  // now and then: a fort on the capital, or a harbour if the nation has no port
  if (!orders && st.stone > 200 && R() < .03) { const p = S.P[n.cap]; if (p.ctrl === n.id && !p.build) orderBuild(n, p, 'fort', 1); }
  if (!orders && st.wood > 200 && R() < .03 && !ps.some(p => p.res === 'port' || p.b.harbour)) { const p = ps.find(q => q.coastal && !q.build); if (p) orderBuild(n, p, 'harbour', 1); }
}

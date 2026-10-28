// Production economy: goods, workforce, buildings, weekly production, construction.
// Goods sit in one national stockpile. Every province employs its own workforce in its own buildings;
// raw industries (farm, forestry, quarry) need stone tools to work at full speed; workshops turn inputs
// into outputs; people eat bread. Construction costs wood and stone and needs free workers as builders.
import { S, D, R, N, PN, log, emit, has, devastated, forceLimit, warsOf, memo } from './core.js';

export const GOODS = () => Object.keys(D.goods);
const SPOIL = { bread: .03, wheat: .01 };   // weekly share of food stocks that goes off
export const ECON = () => Object.keys(D.buildings).filter(k => D.buildings[k].kind !== 'mil');
const E = () => D.balance.econ;

// Working-age people in a province, before and after soldiers are taken out.
export const rawWorkforce = p => p.pop * 1e6 * E().workShare;
// Soldiers come out of the working population, spread evenly over the nation's provinces.
export const draftShare = n => memo('draft' + n.id, () => {
  let wf = 0; for (const p of S.P) if (p.owner === n.id && p.ctrl === n.id) wf += rawWorkforce(p);
  let t = 0; for (const a of S.armies) if (a.nat === n.id) t += a.troops;
  return wf > 0 ? Math.min(.95, t / wf) : 0;
});
export const workforce = p => p.owner == null ? rawWorkforce(p) : rawWorkforce(p) * (1 - draftShare(S.nations[p.owner]));
export const setting = (p, k) => (p.set && p.set[k] != null ? p.set[k] : 1);
export const biome = p => D.biomes[p.biome] || D.biomes.plains;
// Subsistence: land that no building works still feeds people who farm it for themselves. They earn little,
// but they are not idle: they stay put unless much better pay is on offer elsewhere.
export const subsistenceCap = p => (p.cells ? p.cells.length : 60) * biome(p).sub * E().subPerCell;
export const subsistenceWage = p => E().subsistenceWage * (.5 + 2 * biome(p).sub);
export const isCon = k => D.buildings[k].kind === 'con';
export const CON = () => Object.keys(D.buildings).filter(isCon);
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
    if (p.ctrl !== p.owner) { p.staff = {}; p.work = 0; p.emp = 0; p.out = {}; p.va = 0; p.gdp *= .7; continue; }
    let l = m.get(p.owner); if (!l) m.set(p.owner, l = []); l.push(p);
  }
  return m;
}
// Record goods spent outside the weekly cycle (construction, recruiting, reinforcing) for the flow breakdown.
export function spend(n, why, goods) {
  const s = n.spent || (n.spent = {}), w = s[why] || (s[why] = {});
  for (const g in goods) if (goods[g]) w[g] = (w[g] || 0) + goods[g];
}
const HIST = 26;   // weeks of stock history kept for the trend lines
export function weeklyProduction(n, ps = S.P.filter(p => p.owner === n.id && p.ctrl === n.id)) {
  const st = n.stock || (n.stock = emptyStock());
  const prod = emptyStock(), use = emptyStock(), dem = emptyStock(), prodBy = {}, useBy = {};
  const add = (by, g, k, a) => { if (!a) return; const o = by[g] || (by[g] = {}); o[k] = (o[k] || 0) + a; };
  const econ = ECON();
  // 1. staffing: each province fills its buildings' jobs from its own workforce, scaled down evenly if short.
  for (const p of ps) {
    const wf = workforce(p); let want = 0;
    for (const k of econ) if (p.b[k]) want += p.b[k] * D.buildings[k].jobs * setting(p, k);
    const r = want > 0 ? Math.min(1, wf / want) : 0;
    const staff = p.staff || (p.staff = {}); for (const k of econ) staff[k] = p.b[k] ? p.b[k] * setting(p, k) * r : 0;
    p.work = Math.min(wf, want); p.emp = wf > 0 ? p.work / wf : 0; p.out = {}; p.va = 0; p.vaBy = {};
  }
  const price = g => D.goods[g].price || 0, vaBy = {};
  const addVa = (p, k, v) => { p.va += v; p.vaBy[k] = (p.vaBy[k] || 0) + v; vaBy[k] = (vaBy[k] || 0) + v; };
  // 2. tools wear out in raw industries; without them output falls to half.
  let toolNeed = 0;
  for (const p of ps) for (const k of E().rawOrder) toolNeed += (p.staff[k] || 0) * D.buildings[k].tools;
  dem.tools += toolNeed;
  const toolSat = toolNeed > 0 ? Math.min(1, st.tools / toolNeed) : 1;
  st.tools -= toolNeed * toolSat; use.tools += toolNeed * toolSat;
  for (const k of E().rawOrder) { let t = 0; for (const p of ps) t += (p.staff[k] || 0) * D.buildings[k].tools; add(useBy, 'tools', k, t * toolSat); }
  const toolF = E().toolMinOutput + (1 - E().toolMinOutput) * toolSat;
  n.toolSat = toolSat;
  // 3. raw goods
  for (const p of ps) for (const k of E().rawOrder) {
    const eff = p.staff[k]; if (!eff) continue;
    const out = outputsOf(p, k), m = mult(n, p, k) * toolF;
    for (const g in out) { const a = eff * out[g] * m; st[g] += a; prod[g] += a; p.out[k] = (p.out[k] || 0) + a; add(prodBy, g, k, a); addVa(p, k, a * price(g)); }
  }
  // 4. workshops, in priority order (bread first): inputs shared across the nation
  for (const k of E().procOrder) {
    const B = D.buildings[k]; let lv = 0;
    for (const p of ps) lv += p.staff[k] || 0;
    if (!lv) continue;
    let sat = 1, lim = null;
    for (const g in B.in) { const need = lv * B.in[g]; dem[g] += need; const r = need > 0 ? st[g] / need : 1; if (r < sat) { sat = r; lim = g; } }
    (n.procLimit || (n.procLimit = {}))[k] = sat < .999 ? lim : null;
    sat = Math.max(0, Math.min(1, sat));
    for (const g in B.in) { const u = lv * B.in[g] * sat; st[g] -= u; use[g] += u; add(useBy, g, k, u); }
    for (const p of ps) { const eff = p.staff[k]; if (!eff) continue;
      let v = 0;
      for (const g in B.out) { const a = eff * B.out[g] * sat * mult(n, p, k); st[g] += a; prod[g] += a; p.out[k] = (p.out[k] || 0) + a; add(prodBy, g, k, a); v += a * price(g); }
      for (const g in B.in) v -= eff * B.in[g] * sat * price(g);   // value added: what it makes, less what it uses up
      addVa(p, k, v); }
    (n.procSat || (n.procSat = {}))[k] = sat;
  }
  // 5. wages: workers take a share of the value their building adds (never less than the land would give them);
  // builders in construction centres are paid the tribe's average wage out of the treasury.
  let paid = 0, paidN = 0;
  for (const p of ps) {
    const sw = subsistenceWage(p); p.wageBy = {}; p.wages = 0;
    for (const k of econ) {
      const w = (p.staff[k] || 0) * D.buildings[k].jobs; if (!w || isCon(k)) continue;
      const wg = Math.max(sw, E().wageShare * (p.vaBy[k] || 0) / w);
      p.wageBy[k] = wg; p.wages += wg * w; paid += wg * w; paidN += w;
    }
  }
  const natWage = paidN > 0 ? paid / paidN : E().refWage; n.avgWage = natWage;
  let conPay = 0, conCap = 0;
  for (const p of ps) {
    for (const k of CON()) { const w = (p.staff[k] || 0) * D.buildings[k].jobs; if (!w) continue; p.wageBy[k] = natWage; p.wages += natWage * w; conPay += natWage * w; conCap += w * (D.buildings[k].cp || 1); }
    const wf = workforce(p); p.subs = Math.max(0, Math.min(subsistenceCap(p), wf - p.work));
    p.inc = wf > 0 ? (p.wages + p.subs * subsistenceWage(p)) / wf : 0;   // average weekly income per worker
  }
  n.conPay = conPay; n.conCap = conCap;
  // 6. people eat bread and burn firewood, shared evenly across controlled provinces
  let people = 0; for (const p of ps) people += p.pop * 1e6;
  const needB = people * E().breadPerPerson; dem.bread += needB;
  const eat = Math.min(st.bread, needB); st.bread -= eat; use.bread += eat; add(useBy, 'bread', 'people', eat);
  n.fed = needB > 0 ? eat / needB : 1;
  const fuel = people * (E().woodPerPerson || 0); dem.wood += fuel;
  const burn = Math.min(st.wood, fuel); st.wood -= burn; use.wood += burn; add(useBy, 'wood', 'people', burn);
  n.warm = fuel > 0 ? burn / fuel : 1;
  for (const g in SPOIL) { const l = st[g] * SPOIL[g]; st[g] -= l; use[g] += l; add(useBy, g, 'spoilage', l); }
  // goods spent since last week on building and on soldiers
  const need = {}; for (const g of GOODS()) need[g] = dem[g];
  for (const why in n.spent || {}) for (const g in n.spent[why]) { use[g] += n.spent[why][g]; need[g] += n.spent[why][g]; add(useBy, g, why, n.spent[why][g]); }
  n.spent = {};
  // GDP: the yearly value added by every province's buildings, smoothed over a few weeks
  for (const p of ps) { const y = p.va * 52 / 1e9; p.gdp = p.gdpLive ? p.gdp * .7 + y * .3 : y; p.gdpLive = true; }
  n.vaBy = vaBy;
  // rolling averages of what is made and what is needed (including building and soldiers), for the outlook
  const av = n.avg || (n.avg = { prod: {}, need: {} }), k1 = n.avg.w ? .3 : 1; av.w = (av.w || 0) + 1;
  for (const g of GOODS()) { av.prod[g] = (av.prod[g] || 0) * (1 - k1) + prod[g] * k1; av.need[g] = (av.need[g] || 0) * (1 - k1) + need[g] * k1; }
  for (const g of GOODS()) if (st[g] < 1e-6) st[g] = 0;
  n.flow = { prod, use, dem, prodBy, useBy };
  const h = n.hist || (n.hist = {});
  for (const g of GOODS()) { const a = h[g] || (h[g] = []); a.push(Math.round(st[g] * 10) / 10); if (a.length > HIST) a.shift(); }
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
  spend(n, 'construction', cost);
  p.build = { k, lv, nat: n.id, prog: 0, staffed: 0, t: S.day }; S.mapVersion++;
  return { ok: true };
}
// The best place for a new building: free workers to staff it, good land for raw industries.
export function bestProvinceFor(n, k) {
  const B = D.buildings[k];
  const c = S.P.filter(p => p.owner === n.id && p.ctrl === n.id && !p.build && canPlace(p, k).ok);
  const score = p => (freeWorkers(p) + 1) * (B.kind === 'raw' ? yieldOf(p, k) : 1) * (B.kind === 'mil' ? (p.id === n.cap ? 2 : 1) : 1);
  return c.sort((a, b) => score(b) - score(a))[0] || null;
}
export const buildersNeeded = p => p.build ? p.build.lv * D.buildings[p.build.k].builders : 0;
// Free workers: not in a building and not out volunteering. Subsistence farmers count: they can take up new jobs.
export const freeWorkers = p => Math.max(0, workforce(p) - (p.work || 0) - (p.busy || 0));
// Construction: the paid builders of the tribe's construction centres go to projects in the order they were
// started, wherever they are. Anything they can't cover is helped along by unpaid volunteers from free workers
// (locals first, then the nearest provinces), who only manage a quarter of a builder's pace.
export function weeklyConstruction(n, ps = S.P) {
  const mine = S.P.filter(p => p.owner === n.id && p.ctrl === n.id);
  for (const p of mine) p.busy = 0;
  let cap = n.conCap || 0; const vr = E().volunteerRate;
  const list = ps.filter(p => p.build && p.build.nat === n.id).sort((a, b) => (a.build.t ?? 0) - (b.build.t ?? 0) || a.id - b.id);
  for (const p of list) {
    const B = D.buildings[p.build.k];
    if (p.owner !== n.id || p.ctrl !== n.id) { if (n.you) log(`Construction of ${B.n.toLowerCase()} in ${PN(p)} is abandoned.`, 'bad', 2); p.build = null; S.mapVersion++; continue; }
    const need = Math.max(1, buildersNeeded(p)), pro = Math.min(need, cap); cap -= pro;
    let vol = 0;
    if (pro < need) {
      const want = (need - pro) / vr;
      const near = [p, ...mine.filter(q => q !== p && freeWorkers(q) > 0).sort((a, b) => Math.hypot(a.cx - p.cx, a.cy - p.cy) - Math.hypot(b.cx - p.cx, b.cy - p.cy))];
      for (const q of near) { if (vol >= want) break; const t = Math.min(want - vol, freeWorkers(q)); if (t > 0) { q.busy += t; vol += t; } }
    }
    const staff = Math.min(1, (pro + vol * vr) / need);
    p.build.staffed = staff; p.build.pro = pro; p.build.vol = vol; p.build.prog += staff / B.weeks;
    delete p.build.local; delete p.build.remote;
    if (p.build.prog >= 1) {
      const { k, lv } = p.build; p.b[k] += lv; p.build = null; S.mapVersion++;
      if (n.you) { log(`${B.n}${lv > 1 ? ` ×${lv}` : ''} completed in ${PN(p)}.`, null, 3); emit('toast', { lab: 'Construction complete', title: `${B.n}${lv > 1 ? ` ×${lv}` : ''} · ${p.name}`, sub: B.d }); }
    }
  }
  n.conUsed = (n.conCap || 0) - cap;
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
  cap.b.toolsmith = 1; cap.b.swordsmith = 1; cap.b.spearsmith = 1; qp.b.quarry = 1; for (const k of CON()) cap.b[k] = 1;
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
  // builders: enough construction centres for what is being built, while the treasury can pay them
  const queued = S.P.reduce((s, p) => s + (p.build && p.build.nat === n.id ? buildersNeeded(p) : 0), 0);
  const conLv = levelsOf(n, 'construction'), conJobs = B.construction.jobs * (B.construction.cp || 1);
  for (const p of ps) if (p.b.construction) (p.set || (p.set = {})).construction = n.treasury < 0 ? .25 : 1;
  if (n.treasury > 0 && queued > conLv * conJobs * 1.2 && conLv < 2 + Math.floor(ps.length / 3)) need.push(['construction', 1]);
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
    const tribeIdle = ps.reduce((s, p) => s + freeWorkers(p), 0);
    const cands = ps.filter(p => !p.build && canPlace(p, k).ok && (freeWorkers(p) >= Bk.jobs * .6 || tribeIdle >= Bk.jobs * 2))
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

// ---------- outlook: what will we need, and when ----------
// For each good: average made and needed per week, what buildings under construction will add or demand,
// extra food and firewood for a growing population, how long the stock lasts, and what to build about it.
export const producerOf = g => Object.keys(D.buildings).find(k => { const B = D.buildings[k]; return B.kind !== 'mil' && (B.methods ? B.methods.some(m => m.out[g]) : B.out && B.out[g]); });
export function goodsOutlook(n) {
  const f = n.flow, av = n.avg; if (!f || !av) return {};
  const st = n.stock, ps = S.P.filter(p => p.owner === n.id && p.ctrl === n.id), toolF = E().toolMinOutput + (1 - E().toolMinOutput) * (n.toolSat ?? 1);
  const pendOut = {}, pendIn = {};
  for (const p of S.P) {
    if (!p.build || p.build.nat !== n.id) continue;
    const k = p.build.k, B = D.buildings[k], lv = p.build.lv; if (B.kind === 'mil') continue;
    const outs = outputsOf(p, k), m = mult(n, p, k) * (B.kind === 'raw' ? toolF : 1);
    for (const g in outs) pendOut[g] = (pendOut[g] || 0) + lv * outs[g] * m;
    for (const g in B.in || {}) pendIn[g] = (pendIn[g] || 0) + lv * B.in[g];
    if (B.kind === 'raw') pendIn.tools = (pendIn.tools || 0) + lv * B.tools;
  }
  // population growth over the next half year adds bread and firewood demand
  const sat = Math.min(n.fed ?? 1, n.warm ?? 1), gm = .006 * (Math.max(.7, sat) - .7), people = ps.reduce((s, p) => s + p.pop * 1e6, 0);
  const grow = people * (Math.pow(1 + gm, 6) - 1), growNeed = { bread: grow * E().breadPerPerson, wood: grow * (E().woodPerPerson || 0) };
  const out = {};
  for (const g of GOODS()) {
    const prod = av.prod[g] || 0, need = av.need[g] || 0, net = prod - need;
    const future = net + (pendOut[g] || 0) - (pendIn[g] || 0) - (growNeed[g] || 0);
    const unmet = (f.dem[g] || 0) - (f.use[g] || 0) > Math.max(.05, (f.dem[g] || 0) * .01) && st[g] < (f.dem[g] || 0);
    const weeks = net < -1e-6 ? st[g] / -net : null;
    const used = need > 1e-6 || (f.dem[g] || 0) > 0;
    const status = !used && !prod ? 'idle' : !used ? 'unused' : unmet ? 'short' : weeks != null && weeks < 26 ? 'falling' : future < -1e-6 ? 'tight' : net > need * .2 + .5 ? 'surplus' : 'ok';
    out[g] = { stock: st[g], prod, need, net, future, pendOut: pendOut[g] || 0, pendIn: pendIn[g] || 0, grow: growNeed[g] || 0, weeks, status };
  }
  // what to build: enough to cover the coming gap plus four weeks of stock, following the chain to the input that is really missing
  const recs = [];
  const perLevel = (k, g) => {
    const B = D.buildings[k], lv = ps.reduce((s, p) => s + (p.staff?.[k] || 0), 0), made = (f.prodBy?.[g] || {})[k] || 0;
    if (lv > .1 && made > 0) return made / lv;
    const cand = ps.filter(p => canPlace(p, k).ok), y = cand.length ? Math.max(...cand.map(p => yieldOf(p, k))) : 0;
    const base = B.methods ? (B.methods.find(m => m.out[g]) || B.methods[0]).out[g] : B.out[g];
    return base * (B.kind === 'raw' ? y * toolF : 1);
  };
  for (const g of GOODS()) {
    const o = out[g]; if (!['short', 'falling', 'tight'].includes(o.status) && o.stock >= o.need * 4) continue;
    if (o.status === 'unused' || o.status === 'idle' || o.status === 'surplus') continue;
    let k = producerOf(g); if (!k) continue;
    let why = g, reason = o.status;
    const lim = n.procLimit?.[k]; if (lim && out[lim] && out[lim].stock < (f.dem[lim] || 0)) { why = lim; k = producerOf(lim); reason = 'input'; }
    const og = out[why], gap = Math.max(0, -og.future) + Math.max(0, (og.need * 4 - og.stock) / 13) + (reason === 'input' ? Math.max(0, (f.dem[why] || 0) - (f.use[why] || 0)) : 0);
    const pl = perLevel(k, why); if (!(pl > 0)) { recs.push({ g, k, lv: 0, reason, why, impossible: true }); continue; }
    const lv = Math.max(1, Math.ceil(gap / pl));
    if (!recs.some(r => r.k === k)) recs.push({ g, k, lv, reason, why, weeks: o.weeks, jobs: lv * D.buildings[k].jobs });
  }
  const rank = { short: 0, input: 1, falling: 2, tight: 3, ok: 4 };
  recs.sort((a, b) => (rank[a.reason] ?? 5) - (rank[b.reason] ?? 5));
  return { goods: out, recs };
}

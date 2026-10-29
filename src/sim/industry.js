// Production economy: goods, workforce, buildings, production methods, prices, weekly production, construction.
// Goods sit in one national stockpile. Every province employs its own workforce in its own buildings.
// Raw industries (farms, forestry, quarries, mines, hunting, fishing...) need tools to work at full speed: stone tools,
// or bronze tools that last longer and raise output. Workshops turn inputs into outputs by one of their production
// methods. People need food, fuel, clothing and pots. Every good has a price in each tribe, set by supply and demand:
// value added at those prices is GDP, which pays wages and taxes, so money comes from making what people need.
import { S, D, R, N, PN, log, emit, has, devastated, forceLimit, warsOf, memo } from './core.js';

export const GOODS = () => Object.keys(D.goods);
export const ECON = () => Object.keys(D.buildings).filter(k => D.buildings[k].kind !== 'mil');
const E = () => D.balance.econ;
const RAW = () => E().rawOrder.filter(k => D.buildings[k]);
const PROC = () => { const o = E().procOrder.filter(k => D.buildings[k]); return o.concat(Object.keys(D.buildings).filter(k => D.buildings[k].kind === 'proc' && !o.includes(k))); };

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
// Land yield for a raw building; some share another's (flax grows like wheat, mines dig like quarries).
export const yieldOf = (p, k) => { const B = D.buildings[k], y = biome(p).y[(B && B.y) || k]; return y == null ? 1 : y; };
export const deposits = p => p.dep || [];
// Wild game and fish run out: how many levels a province's land or coast can carry.
export const maxLevels = (p, k) => { const B = D.buildings[k]; return B.perCell ? Math.max(1, Math.round((p.cells ? p.cells.length : 60) * B.perCell * Math.max(.3, yieldOf(p, k)))) : Infinity; };
export function emptyStock() { return Object.fromEntries(GOODS().map(g => [g, 0])); }

// ---------- technology and production methods ----------
export const techOk = (n, t) => !t || (n && n.techs.includes(t));
export const unlocked = (n, k) => techOk(n, D.buildings[k].tech);
const BASE = k => { const B = D.buildings[k]; return { k: 'base', n: B.n, in: B.in || {}, out: B.out || {} }; };
export const methodsOf = k => D.buildings[k].methods || [BASE(k)];
export const methodsFor = (n, k) => methodsOf(k).filter(m => techOk(n, m.tech));
// Can the tribe actually supply a method's inputs: is each one being made, or in store?
const supplied = (n, m) => !n || Object.keys(m.in || {}).every(g => (n.avg?.prod[g] || 0) > 1e-3 || (n.stock?.[g] || 0) > m.in[g] * 4);
// The method a province uses: its own choice if still allowed, otherwise the newest one the tribe knows and can supply.
export function methodOf(p, k, n = p.owner != null ? S.nations[p.owner] : null) {
  const ms = methodsOf(k); if (ms.length === 1) return ms[0];
  const ok = ms.filter(m => techOk(n, m.tech)), pick = p.pm && p.pm[k];
  const own = ok.find(m => m.k === pick); if (own) return own;
  for (let i = ok.length - 1; i > 0; i--) if (supplied(n, ok[i])) return ok[i];
  return ok[0] || ms[0];
}
// The newest method the tribe knows, supplied or not: what it is working towards.
export const bestMethod = (n, k) => methodsFor(n, k).slice(-1)[0] || methodsOf(k)[0];
export const outputsOf = (p, k) => methodOf(p, k).out;
export const inputsOf = (p, k) => methodOf(p, k).in || {};

// ---------- prices ----------
// Each tribe has its own market: a good's price rises when people want more than is made and stocked, and falls
// to a quarter of its worth when nobody needs it. Prices update weekly and are what GDP, wages and taxes use.
export const priceOf = (n, g) => (n && n.price && n.price[g] != null ? n.price[g] : D.goods[g].price || 0);
function updatePrices(n) {
  const P = E().price, av = n.avg, pr = n.price || (n.price = {});
  for (const g of GOODS()) {
    const base = D.goods[g].price || 0, sup = (av.prod[g] || 0) + (n.stock[g] || 0) / P.stockWeeks, dem = av.need[g] || 0;
    const r = Math.pow((dem + 1e-3) / (sup + 1e-3), P.curve), target = base * Math.max(P.min, Math.min(P.max, r));
    pr[g] = pr[g] == null ? target : pr[g] * .7 + target * .3;
  }
}

// Can this building go in this province at all, and does the tribe know how to build it?
export function canPlace(p, k, n = p.owner != null ? S.nations[p.owner] : null) {
  const B = D.buildings[k]; if (!B) return { ok: false, why: 'Unknown building.' };
  if (B.tech && n && !n.techs.includes(B.tech)) return { ok: false, why: `Research ${D.techMap[B.tech].n.toLowerCase()} first.`, tech: B.tech };
  if (B.coast && !p.coastal) return { ok: false, why: 'Needs a coastal province.' };
  if (B.dep && !deposits(p).includes(B.dep)) return { ok: false, why: `Needs a ${B.dep} deposit.` };
  if (B.kind === 'raw' && yieldOf(p, k) <= 0) return { ok: false, why: `Not possible in ${biome(p).n.toLowerCase()}.` };
  if (B.max && p.b[k] >= B.max) return { ok: false, why: 'Already at the maximum level.' };
  if (B.perCell && p.b[k] >= maxLevels(p, k)) return { ok: false, why: `The land only supports ${maxLevels(p, k)} here.` };
  return { ok: true };
}
const mult = (n, p, k) => {
  const B = D.buildings[k];
  let m = B.kind === 'raw' ? yieldOf(p, k) : 1;
  if (k === 'farm') { if (has(n, 'green')) m *= 1.25; if (has(n, 'plough')) m *= 1.3; if (n.trait === 'famine') m *= .8; }
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
  for (const g of GOODS()) if (st[g] == null) st[g] = 0;
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
  const price = g => priceOf(n, g), vaBy = {};
  const addVa = (p, k, v) => { p.va += v; p.vaBy[k] = (p.vaBy[k] || 0) + v; vaBy[k] = (vaBy[k] || 0) + v; };
  // 2. tools wear out in raw industries. Bronze tools go first: they wear slower and raise output.
  //    Without any tools, output falls to half.
  let toolNeed = 0; const raw = RAW();
  for (const p of ps) for (const k of raw) toolNeed += (p.staff[k] || 0) * D.buildings[k].tools;
  const bRate = .6, bUse = Math.min(st.btools || 0, toolNeed * bRate), bCover = toolNeed > 0 ? bUse / bRate / toolNeed : 0;
  const sNeed = toolNeed * (1 - bCover), sUse = Math.min(st.tools, sNeed);
  dem.tools += sNeed; dem.btools += bUse;
  st.btools -= bUse; use.btools += bUse; st.tools -= sUse; use.tools += sUse;
  const toolSat = toolNeed > 0 ? bCover + sUse / toolNeed : 1;
  for (const k of raw) { let t = 0; for (const p of ps) t += (p.staff[k] || 0) * D.buildings[k].tools; const sh = toolNeed > 0 ? t / toolNeed : 0; add(useBy, 'tools', k, sUse * sh); add(useBy, 'btools', k, bUse * sh); }
  const toolF = (E().toolMinOutput + (1 - E().toolMinOutput) * toolSat) * (1 + (E().bronzeToolBoost || 0) * bCover);
  n.toolSat = toolSat; n.bronzeTools = bCover;
  // 3. raw goods
  for (const p of ps) for (const k of raw) {
    const eff = p.staff[k]; if (!eff) continue;
    const out = outputsOf(p, k), m = mult(n, p, k) * toolF;
    for (const g in out) { const a = eff * out[g] * m; st[g] += a; prod[g] += a; p.out[k] = (p.out[k] || 0) + a; add(prodBy, g, k, a); addVa(p, k, a * price(g)); }
  }
  // 4. workshops, in priority order (food first): inputs shared across the nation, each province by its own method
  let armsAll = 0, armsBronze = 0;
  for (const k of PROC()) {
    const rows = []; for (const p of ps) { const eff = p.staff[k]; if (eff) rows.push({ p, eff, m: methodOf(p, k, n) }); }
    if (!rows.length) continue;
    const need = {}; for (const r of rows) for (const g in r.m.in) need[g] = (need[g] || 0) + r.eff * r.m.in[g];
    let sat = 1, lim = null;
    for (const g in need) { dem[g] += need[g]; const q = need[g] > 0 ? st[g] / need[g] : 1; if (q < sat) { sat = q; lim = g; } }
    (n.procLimit || (n.procLimit = {}))[k] = sat < .999 ? lim : null;
    sat = Math.max(0, Math.min(1, sat));
    for (const g in need) { const u = need[g] * sat; st[g] -= u; use[g] += u; add(useBy, g, k, u); }
    for (const { p, eff, m } of rows) {
      let v = 0;
      for (const g in m.out) {
        const a = eff * m.out[g] * sat * mult(n, p, k); st[g] += a; prod[g] += a; p.out[k] = (p.out[k] || 0) + a; add(prodBy, g, k, a); v += a * price(g);
        if (g === 'swords' || g === 'spears') { armsAll += a; if (m.arms === 'bronze') armsBronze += a; }
      }
      for (const g in m.in) v -= eff * m.in[g] * sat * price(g);   // value added: what it makes, less what it uses up
      addVa(p, k, v);
    }
    (n.procSat || (n.procSat = {}))[k] = sat;
  }
  // how much of the army's equipment is bronze: follows what the smiths have been making
  if (armsAll > 0) n.armsQ = (n.armsQ || 0) * .96 + (armsBronze / armsAll) * .04;
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
    p.inc = wf > 0 ? (p.wages * (1 - (n.tax ?? .15)) + p.subs * subsistenceWage(p)) / wf : 0;   // average weekly income per worker, after tax
  }
  n.conPay = conPay; n.conCap = conCap;
  // 6. people's needs, shared evenly across controlled provinces: food and fuel keep them alive and warm,
  // clothing and pots raise their living standard. Each need can be met by several goods, freshest first.
  let people = 0; for (const p of ps) people += p.pop * 1e6;
  const sat = n.needSat || (n.needSat = {}); let comfort = 0, comforts = 0;
  for (const nd of E().needs) {
    const want = people * nd.per; let left = want;
    for (const g in nd.goods) {
      if (!D.goods[g]) continue;
      const v = nd.goods[g], take = Math.min(st[g], left / v);
      st[g] -= take; use[g] += take; dem[g] += take; add(useBy, g, 'people', take); left -= take * v;
    }
    const main = nd.main && D.goods[nd.main] ? nd.main : Object.keys(nd.goods).find(g => D.goods[g]);
    if (left > 1e-9) dem[main] += left / nd.goods[main];   // what is still wanted shows up as demand for the main good
    sat[nd.k] = want > 0 ? 1 - left / want : 1;
    if (!nd.basic) { comfort += sat[nd.k]; comforts++; }
  }
  n.fed = sat.food ?? 1; n.warm = sat.fuel ?? 1; n.comfort = comforts ? comfort / comforts : 1;
  const SPOIL = E().spoil || {};
  for (const g in SPOIL) { if (!st[g]) continue; const l = st[g] * SPOIL[g]; st[g] -= l; use[g] += l; add(useBy, g, 'spoilage', l); }
  // goods spent since last week on building and on soldiers
  const need = {}; for (const g of GOODS()) need[g] = dem[g];
  for (const why in n.spent || {}) for (const g in n.spent[why]) { use[g] += n.spent[why][g]; need[g] += n.spent[why][g]; add(useBy, g, why, n.spent[why][g]); }
  n.spent = {};
  // GDP: the yearly value added by every province's buildings, smoothed over a few weeks
  for (const p of ps) { const y = p.va * 52 / 1e9; p.gdp = p.gdpLive ? p.gdp * .7 + y * .3 : y; p.gdpLive = true; }
  n.vaBy = vaBy;
  // rolling averages of what is made and what is needed (including building and soldiers), for the outlook and prices
  const av = n.avg || (n.avg = { prod: {}, need: {} }), k1 = n.avg.w ? .3 : 1; av.w = (av.w || 0) + 1;
  for (const g of GOODS()) { av.prod[g] = (av.prod[g] || 0) * (1 - k1) + prod[g] * k1; av.need[g] = (av.need[g] || 0) * (1 - k1) + need[g] * k1; }
  for (const g of GOODS()) if (st[g] < 1e-6) st[g] = 0;
  updatePrices(n);
  n.flow = { prod, use, dem, prodBy, useBy };
  const h = n.hist || (n.hist = {});
  for (const g of GOODS()) { const a = h[g] || (h[g] = []); a.push(Math.round(st[g] * 10) / 10); if (a.length > HIST) a.shift(); }
}

// ---------- construction ----------
export function buildCost(k, lv = 1) { const c = D.buildings[k].cost || {}; return Object.fromEntries(Object.entries(c).map(([g, v]) => [g, v * lv])); }
export const canAfford = (n, cost) => Object.entries(cost).every(([g, v]) => (n.stock[g] || 0) >= v);
export function orderBuild(n, p, k, lv = 1) {
  const B = D.buildings[k], pl = canPlace(p, k, n);
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
  const c = S.P.filter(p => p.owner === n.id && p.ctrl === n.id && !p.build && canPlace(p, k, n).ok);
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
    if (p.build.prog >= 1) {
      const { k, lv } = p.build; p.b[k] = (p.b[k] || 0) + lv; p.build = null; S.mapVersion++;
      if (n.you) { log(`${B.n}${lv > 1 ? ` ×${lv}` : ''} completed in ${PN(p)}.`, null, 3); emit('toast', { lab: 'Construction complete', title: `${B.n}${lv > 1 ? ` ×${lv}` : ''} · ${p.name}`, sub: B.d }); }
    }
  }
  n.conUsed = (n.conCap || 0) - cap;
}

// ---------- starting economy ----------
// A farming tribe: enough fields, ovens, timber and stone to feed and warm everyone, a hunting lodge, a little to spare.
export function startingEconomy(n, provIds) {
  const ps = provIds.map(i => S.P[i]), cap = ps[0], people = ps.reduce((s, p) => s + p.pop * 1e6, 0), B = D.buildings;
  for (const p of ps) for (const k of ECON()) p.b[k] = 0;
  const best = k => ps.filter(p => canPlace(p, k, n).ok).sort((a, b) => yieldOf(b, k) - yieldOf(a, k))[0] || cap;
  const fp = best('farm'), bp = best('forestry'), qp = best('quarry'), hp = best('hunter');
  const hearth = B.bakery.methods ? B.bakery.methods[0] : B.bakery, food = E().needs.find(x => x.k === 'food').per, fuel = E().needs.find(x => x.k === 'fuel').per;
  hp.b.hunter = 1;
  const meat = B.hunter.out.meat * Math.max(.1, yieldOf(hp, 'hunter'));
  const bread = Math.max(0, people * food * 1.05 - meat);
  fp.b.farm = Math.max(1, Math.ceil(bread * hearth.in.wheat / hearth.out.bread / (B.farm.out.wheat * Math.max(.1, yieldOf(fp, 'farm')))));
  cap.b.bakery = Math.max(1, Math.ceil(bread / hearth.out.bread));
  cap.b.toolsmith = 1; cap.b.swordsmith = 1; cap.b.spearsmith = 1; qp.b.quarry = 1; for (const k of CON()) cap.b[k] = 1;
  const wIn = k => methodsOf(k)[0].in.wood || 0;
  const wood = cap.b.bakery * hearth.in.wood + people * fuel + wIn('toolsmith') + wIn('swordsmith') + wIn('spearsmith');
  bp.b.forestry = Math.max(1, Math.ceil(wood * 1.15 / (B.forestry.out.wood * Math.max(.1, yieldOf(bp, 'forestry')))));
  n.stock = emptyStock();
  Object.assign(n.stock, { bread: people * 3, wheat: hearth.in.wheat, wood: 60, stone: 60, tools: 10 });
}

// ---------- AI economy ----------
// Once a month: follow the outlook's list of what to build (it traces shortages down the production chain),
// keep enough builders and weapons, ease off industries whose goods are piling up, and pick the best methods.
// Levels of each building a tribe has or is building, counted once per planning pass.
let lvCache = null;
const levelsOf = (n, k) => {
  if (!lvCache || lvCache.n !== n.id || lvCache.day !== S.day || lvCache.ver !== S.mapVersion) {
    const c = {}; for (const p of S.P) if (p.owner === n.id) { for (const b in p.b) if (p.b[b]) c[b] = (c[b] || 0) + p.b[b]; if (p.build) c[p.build.k] = (c[p.build.k] || 0) + p.build.lv; }
    lvCache = { n: n.id, day: S.day, ver: S.mapVersion, c };
  }
  return lvCache.c[k] || 0;
};
export function aiPlanEconomy(n) {
  const f = n.flow, st = n.stock; if (!f) return;
  const ps = S.P.filter(p => p.owner === n.id && p.ctrl === n.id); if (!ps.length) return;
  const B = D.buildings, fl = forceLimit(n), need = [];
  for (const p of ps) if (p.pm) p.pm = {};   // the AI always works with the newest methods it knows
  // spare hands in a province: its workforce less every job at its current rate and anything being built there
  const spare = p => Math.max(0, workforce(p) - ECON().reduce((t, k) => t + (p.b[k] || 0) * D.buildings[k].jobs * setting(p, k), 0)
    - (p.build && D.buildings[p.build.k].jobs ? p.build.lv * D.buildings[p.build.k].jobs : 0));
  // goods piling up far beyond need: work their producers at half rate, and pull down a tenth of the levels when it
  // is a lasting glut, freeing people for other work; back to full rate when stocks run low and there are hands for it
  const av = n.avg || { need: {} };
  for (const k of ECON()) {
    if (isCon(k)) continue;
    const g = Object.keys(bestMethod(n, k).out)[0], nd = av.need[g] || 0, s0 = st[g] || 0, has = ps.filter(p => p.b[k]);
    if (!has.length) continue;
    if (s0 > nd * 30 + 400) {
      const total = has.reduce((t, p) => t + p.b[k], 0); let cut = total > 1 ? Math.max(1, Math.floor(total * .1)) : 0;
      for (const p of has.sort((a, b) => b.b[k] - a.b[k])) { if (cut <= 0) break; const c = Math.min(cut, p.b[k] - (p === has[has.length - 1] ? 1 : 0)); if (c > 0) { p.b[k] -= c; cut -= c; S.mapVersion++; } }
      for (const p of has) (p.set || (p.set = {}))[k] = .5;
    } else if (s0 > nd * 16 + 200) for (const p of has) (p.set || (p.set = {}))[k] = .5;
    else if (s0 < nd * 6 + 60) for (const p of has) { const cur = setting(p, k); if (cur < 1) { const extra = p.b[k] * D.buildings[k].jobs * (1 - cur); (p.set || (p.set = {}))[k] = cur + (1 - cur) * Math.min(1, spare(p) / Math.max(1, extra)); } }
  }
  // builders: enough construction centres for what is being built, while the treasury can pay them
  const queued = S.P.reduce((s, p) => s + (p.build && p.build.nat === n.id ? buildersNeeded(p) : 0), 0);
  const conLv = levelsOf(n, 'construction'), conJobs = B.construction.jobs * (B.construction.cp || 1);
  for (const p of ps) if (p.b.construction) (p.set || (p.set = {})).construction = n.treasury < 0 ? .25 : 1;
  // what the outlook says is short, following the chain to the missing input
  const O = goodsOutlook(n);
  for (const r of O.recs || []) if (!r.impossible && !r.locked) need.push([r.k, Math.min(r.lv, 4)]);
  if (n.treasury > 0 && queued > conLv * conJobs * 1.2 && conLv < 2 + Math.floor(ps.length / 3)) need.push(['construction', 1]);
  // weapons: keep a reserve that grows in wartime
  const war = warsOf(n.id).length > 0, target = fl * (war ? .3 : .15), cap = 1 + Math.floor(fl / 150);
  for (const [k, g] of [['swordsmith', 'swords'], ['spearsmith', 'spears']]) {
    const have = levelsOf(n, k), m = methodsFor(n, k)[0];
    if (st[g] < target && have < cap && (n.procSat?.[k] ?? 1) >= .9) need.push([k, Math.min(cap - have, Math.ceil((target - st[g]) / (m.out[g] * 26)))]);
  }
  // wood and stone for workshops and building, with a buffer
  const wood = f.dem.wood * 1.1 + 5 - (f.prod.wood || 0);
  if ((wood > 0 || st.wood < 30 + f.dem.wood * 2) && st.wood < f.dem.wood * 26 + 150) need.push(['forestry', Math.max(1, Math.ceil(wood / (B.forestry.out.wood * .9)))]);
  const stone = f.dem.stone * 1.1 + 3 - (f.prod.stone || 0);
  if ((stone > 0 || st.stone < 30 + f.dem.stone * 2) && st.stone < f.dem.stone * 26 + 150) need.push(['quarry', Math.max(1, Math.ceil(stone / (B.quarry.out.stone * .9)))]);
  // working towards better methods: if the newest method known needs a good nobody makes yet (bronze for smiths),
  // start making it; bronze tools are always worth having once known
  for (const k of ECON()) {
    if (!levelsOf(n, k) && !(k === 'bronzesmith' && unlocked(n, k))) continue;
    const m = bestMethod(n, k);
    if (k === 'bronzesmith' && !levelsOf(n, k) && ps.some(p => canPlace(p, k, n).ok)) need.push([k, 1]);
    for (const g in m.in || {}) if (!(n.avg?.prod[g] > 1e-3)) { const mk = producerOf(g, n); if (mk && unlocked(n, mk) && !levelsOf(n, mk)) need.push([mk, 1]); }
  }
  // buildings that cost a material nobody makes (bricks for smelters): build the maker first
  for (const [k] of need.slice()) for (const g in buildCost(k)) if ((st[g] || 0) < buildCost(k)[g] && !(n.avg?.prod[g] > 0)) { const mk = producerOf(g, n); if (mk && unlocked(n, mk)) need.unshift([mk, 1]); }
  let orders = 0; const maxOrders = 3 + Math.floor(ps.length / 2), done = new Set();
  for (let [k, want] of need) {
    if (done.has(k)) continue; done.add(k);
    const Bk = B[k];
    if (Bk.kind !== 'mil' && !isCon(k)) { const g = Object.keys(bestMethod(n, k).out)[0], nd = av.need[g] || 0; if ((st[g] || 0) > nd * 16 + 200) continue; }   // plenty in store already
    const jobs = Bk.jobs || 0, tribeSpare = ps.reduce((s, p) => s + spare(p), 0);
    if (jobs && tribeSpare < jobs * .8) continue;   // nobody to work it
    const cands = ps.filter(p => !p.build && canPlace(p, k, n).ok && (!jobs || spare(p) >= jobs * .6 || tribeSpare >= jobs * 2))
      .sort((a, b) => spare(b) * (Bk.kind === 'raw' ? yieldOf(b, k) : 1) - spare(a) * (Bk.kind === 'raw' ? yieldOf(a, k) : 1));
    for (const p of cands) {
      if (want <= 0 || orders >= maxOrders) break;
      let lv = Math.max(1, Math.min(want, jobs ? Math.floor(spare(p) / jobs) : 1));
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
const makes = (k, g) => { const B = D.buildings[k]; return B.kind !== 'mil' && B.kind !== 'con' && methodsOf(k).some(m => m.out[g]); };
// The building that makes a good: one the tribe can already build if there is one.
export const producerOf = (g, n) => { const ks = Object.keys(D.buildings).filter(k => makes(k, g)); return (n && ks.find(k => unlocked(n, k) && methodsFor(n, k).some(m => m.out[g]))) || ks[0]; };
export const producersOf = g => Object.keys(D.buildings).filter(k => makes(k, g));
export function goodsOutlook(n) {
  const f = n.flow, av = n.avg; if (!f || !av) return {};
  const st = n.stock, ps = S.P.filter(p => p.owner === n.id && p.ctrl === n.id), toolF = E().toolMinOutput + (1 - E().toolMinOutput) * (n.toolSat ?? 1);
  const pendOut = {}, pendIn = {};
  for (const p of S.P) {
    if (!p.build || p.build.nat !== n.id) continue;
    const k = p.build.k, B = D.buildings[k], lv = p.build.lv; if (B.kind === 'mil' || B.kind === 'con') continue;
    const m = methodOf(p, k, n), x = mult(n, p, k) * (B.kind === 'raw' ? toolF : 1);
    for (const g in m.out) pendOut[g] = (pendOut[g] || 0) + lv * m.out[g] * x;
    for (const g in m.in || {}) pendIn[g] = (pendIn[g] || 0) + lv * m.in[g];
    if (B.kind === 'raw') pendIn.tools = (pendIn.tools || 0) + lv * B.tools;
  }
  // population growth over the next half year adds demand for everything people use
  const sat = Math.min(n.fed ?? 1, n.warm ?? 1), gm = .006 * (Math.max(.7, sat) - .7), people = ps.reduce((s, p) => s + p.pop * 1e6, 0);
  const grow = people * (Math.pow(1 + gm, 6) - 1), growNeed = {};
  for (const nd of E().needs) { const g = nd.main || Object.keys(nd.goods)[0]; growNeed[g] = (growNeed[g] || 0) + grow * nd.per; }
  const out = {};
  for (const g of GOODS()) {
    const prod = av.prod[g] || 0, need = av.need[g] || 0, net = prod - need;
    const future = net + (pendOut[g] || 0) - (pendIn[g] || 0) - (growNeed[g] || 0);
    const unmet = (f.dem[g] || 0) - (f.use[g] || 0) > Math.max(.05, (f.dem[g] || 0) * .01) && st[g] < (f.dem[g] || 0);
    const weeks = net < -1e-6 ? st[g] / -net : null;
    const used = need > 1e-6 || (f.dem[g] || 0) > 0;
    const status = !used && !prod ? 'idle' : !used ? 'unused' : unmet ? 'short' : weeks != null && weeks < 26 ? 'falling' : future < -1e-6 ? 'tight' : net > need * .2 + .5 ? 'surplus' : 'ok';
    out[g] = { stock: st[g], prod, need, net, future, pendOut: pendOut[g] || 0, pendIn: pendIn[g] || 0, grow: growNeed[g] || 0, weeks, status, price: priceOf(n, g) };
  }
  // what to build: enough to cover the coming gap plus four weeks of stock, following the chain to the input that is really missing
  const recs = [];
  const perLevel = (k, g) => {
    const B = D.buildings[k], lv = ps.reduce((s, p) => s + (p.staff?.[k] || 0), 0), made = (f.prodBy?.[g] || {})[k] || 0;
    if (lv > .1 && made > 0) return made / lv;
    const cand = ps.filter(p => canPlace(p, k, n).ok), y = cand.length ? Math.max(...cand.map(p => yieldOf(p, k))) : 0;
    const m = methodsFor(n, k).filter(x => x.out[g]).slice(-1)[0] || methodsOf(k).find(x => x.out[g]);   // what a new level would make
    return m.out[g] * (B.kind === 'raw' ? y * toolF : 1);
  };
  const subs = new Set(E().needs.flatMap(nd => Object.keys(nd.goods).filter(g => g !== (nd.main || Object.keys(nd.goods)[0]))));
  for (const g of GOODS()) {
    const o = out[g]; if (!['short', 'falling', 'tight'].includes(o.status) && o.stock >= o.need * 4) continue;
    if (subs.has(g) && o.status !== 'short') continue;   // fresh meat and fish get eaten as they come: the shortage shows up in bread
    if (o.status === 'unused' || o.status === 'idle' || o.status === 'surplus') continue;
    if (g === 'tools' && (n.bronzeTools || 0) > .95) continue;   // bronze tools cover it
    let k = producerOf(g, n); if (!k) continue;
    let why = g, reason = o.status;
    const lim = n.procLimit?.[k]; if (lim && out[lim] && out[lim].stock < (f.dem[lim] || 0)) { why = lim; k = producerOf(lim, n); reason = 'input'; }
    if (!k) continue;
    if (!unlocked(n, k)) { if (!recs.some(r => r.k === k)) recs.push({ g, k, lv: 0, reason, why, locked: D.buildings[k].tech }); continue; }
    const og = out[why], gap = Math.max(0, -og.future) + Math.max(0, (og.need * 4 - og.stock) / 13) + (reason === 'input' ? Math.max(0, (f.dem[why] || 0) - (f.use[why] || 0)) : 0);
    const pl = perLevel(k, why); if (!(pl > 0)) { if (!recs.some(r => r.k === k)) recs.push({ g, k, lv: 0, reason, why, impossible: true, whyNot: D.buildings[k].dep ? `No ${D.buildings[k].dep} deposit in your land.` : null }); continue; }
    const lv = Math.max(1, Math.ceil(gap / pl));
    if (!recs.some(r => r.k === k)) recs.push({ g, k, lv, reason, why, weeks: o.weeks, jobs: lv * D.buildings[k].jobs });
  }
  const rank = { short: 0, input: 1, falling: 2, tight: 3, ok: 4 };
  recs.sort((a, b) => (!!a.locked - !!b.locked) || (!!a.impossible - !!b.impossible) || (rank[a.reason] ?? 5) - (rank[b.reason] ?? 5));
  return { goods: out, recs };
}

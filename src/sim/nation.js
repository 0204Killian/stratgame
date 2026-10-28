import { S, D, popOf, gdpOf, forceLimit } from './core.js';
import { makeArmy } from './military.js';
import { startingEconomy, emptyStock } from './industry.js';

function hslHex(h, s, l) {
  const k = x => (x + h / 30) % 12, a = s * Math.min(l, 1 - l), f = x => l - a * Math.max(-1, Math.min(k(x) - 3, 9 - k(x), 1));
  return '#' + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}
export function nextColor() { const i = S.nations.length; return D.names.colors[i] || hslHex((i * 137.5) % 360, .55, .6); }

// d: {name, gov, popM, milPct, gdp, trait, leader} using data keys
export function createNation(d, provIds, you, opts = {}) {
  const n = {
    id: S.nations.length, name: d.name, gov: d.gov, milPct: d.milPct, trait: d.trait, leader: d.leader,
    color: nextColor(), cap: provIds[0], allies: [], truce: {}, alive: true, you: !!you,
    tax: D.balance.startTax, maint: 1, techs: [], rp: 0, lastNuke: -99999, grudge: null, grudgeUntil: -1,
    rebel: !!opts.rebel, lastAsk: -99999, treasury: 0, manpower: 0, stock: emptyStock(), fed: 1
  };
  S.nations.push(n); S.usedNames.push(n.name);
  if (opts.keepPop) {
    for (const id of provIds) { const p = S.P[id]; p.owner = n.id; p.ctrl = n.id; p.siege = null; }
  } else {
    const w = provIds.map((id, i) => i === 0 ? 2 : 1), ws = w.reduce((a, b) => a + b, 0);
    provIds.forEach((id, i) => { const p = S.P[id]; p.owner = n.id; p.ctrl = n.id; p.pop = d.popM * w[i] / ws; p.gdp = d.gdp * w[i] / ws; p.siege = null; });
  }
  if (!opts.keepPop) startingEconomy(n, provIds);
  n.startGdp = gdpOf(n); n.startPop = popOf(n);
  const fl = forceLimit(n);
  n.stock.swords += fl * .1; n.stock.spears += fl * .1;
  if (opts.keepPop) { n.stock.bread = popOf(n) * 1e6 * 2; n.stock.wood = n.stock.stone = 50000; }
  n.treasury = opts.treasury ?? gdpOf(n) * .15;
  n.manpower = fl * .25;
  // Start with an army the economy can actually pay for (at most 60% of the force limit).
  const affordable = gdpOf(n) * n.tax / D.balance.upkeep * .7;
  const a0 = makeArmy(n, provIds[0], opts.troops ?? Math.min(fl * .6, Math.max(5000, affordable)));
  if (!opts.keepPop) a0.mor = 1;   // a trained standing army
  S.mapVersion++;
  return n;
}

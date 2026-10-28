// Monthly economy, growth, construction, recruitment, research and internal politics.
import { S, D, R, pick, rnd, newTribeName, MIN_ARMY, MONTH, YEAR, UPKEEP, N, PN, log, emit, gov, has, devastated, stab, hasNuke, forceLimit, techCost, techExtra, techAvail, researchPerMonth, provsOf, gdpOf, armiesOf, troopsOf, monthlyIncome, warsOf, enemyIn, neighbours, atWar } from './core.js';
import { makeArmy, nuke, nukeReady, orderMove, reinforce, mixOf, MORALE } from './military.js';
import { weeklyProduction, weeklyConstruction, biome, aiPlanEconomy, spend } from './industry.js';
import { declareWar, warScore, payReparations } from './diplomacy.js';
import { createNation } from './nation.js';

export const ERA_GOVS = ['tribal', 'monarchy', 'theocracy', 'anarchy'];   // governments that fit an early age
export function revolt(n) {
  const old = gov(n); n.gov = pick(ERA_GOVS.filter(k => k !== n.gov)); n.leader = pick(D.leaders).k;
  for (const x of n.allies) S.nations[x].allies = S.nations[x].allies.filter(y => y !== n.id); n.allies = [];
  provsOf(n).forEach(p => p.gdp *= .9);
  log(`Revolution in ${N(n)}. The ${old.n.toLowerCase()} falls and a ${gov(n).n.toLowerCase()} takes over.`, 'big', 6);
}
function breakaway(n) {
  const ps = provsOf(n).filter(p => p.id !== n.cap && p.ctrl === n.id); if (!ps.length) return;
  const p = pick(ps);
  const others = p.landN.map(i => S.P[i]).filter(q => q.owner === n.id && q.id !== n.cap && q.ctrl === n.id && R() < .5);
  const ids = [p.id, ...others.slice(0, 1).map(q => q.id)];
  S.armies.filter(a => ids.includes(a.prov) && a.nat === n.id).forEach(a => orderMove(a, n.cap));
  const name = newTribeName(n.culture);
  const d = { name, culture: n.culture, gov: pick(ERA_GOVS.filter(k => k !== n.gov)), milPct: n.milPct, trait: pick(ERA_TRAITS()).k, leader: pick(D.leaders).k };
  const pop = ids.reduce((s, i) => s + S.P[i].pop, 0);
  const reb = createNation(d, ids, false, { keepPop: true, rebel: true, troops: pop * 1e6 * n.milPct / 100 * .6, treasury: 2 });
  declareWar(n, reb, true);
  log(`Civil war in ${N(n)}! ${ids.map(i => PN(S.P[i])).join(' and ')} break away as ${N(reb)}.`, 'big', 7);
}
const auto = n => !n.you || S.st.autoPlayer;
export const ERA_TRAITS = () => D.traits.filter(t => t.k !== 'nuke' && t.k !== 'oil');

// Weekly: income, upkeep, reparations; desertion while in debt. Rates are monthly, paid in weekly slices.
export function weeklyNation(n, ps) {
  weeklyProduction(n, ps); weeklyConstruction(n, S.P.filter(p => p.build && p.build.nat === n.id));
  const f = 7 / MONTH, m = monthlyIncome(n);
  n.treasury += m.net * f; payReparations(n, m.inc * f);
  if (n.treasury < 0) { armiesOf(n).forEach(a => a.troops *= 1 - .03 * f); if (n.you && R() < .3 * f * 4) log(`${N(n)} cannot pay its armies. Soldiers are deserting.`, 'bad', 3); }
}
// Split a number of new soldiers into swordsmen and spearmen, steering the army towards 1:1 and limited by weapons in stock.
export function armTroops(n, want, curSw = 0, curTotal = 0) {
  const st = n.stock;
  let sw = Math.max(0, Math.min(want, .5 * (curTotal + want) - curSw)), sp = want - sw;
  sw = Math.min(sw, st.swords); sp = Math.min(sp, st.spears);
  let rest = want - sw - sp;
  if (rest > 0) { const x = Math.min(rest, st.swords - sw); sw += x; rest -= x; sp += Math.min(rest, st.spears - sp); }
  return { sw: Math.max(0, sw), sp: Math.max(0, sp) };
}
// Daily: manpower regrows and idle armies in friendly land refill, at the same monthly rates spread over the days.
// Every new soldier needs a sword or a spear from the stockpile.
export function dailyNation(n) {
  const f = 1 / MONTH, fl = forceLimit(n);
  n.manpower = Math.min(fl * .5, n.manpower + fl * .025 * f);
  if (n.treasury <= 0 || n.manpower <= 0) return;
  const rr = .1 * n.maint * f;
  let room = Math.max(0, fl - troopsOf(n));
  for (const a of S.armies) {
    if (a.nat !== n.id || room <= 0 || n.manpower <= 0) continue;
    const p = S.P[a.prov]; if (p.ctrl !== n.id || a.path.length) continue;
    const add = Math.min(n.manpower, a.troops * rr, room); if (add <= 0) continue;
    const { sw, sp } = armTroops(n, add, a.troops * mixOf(a), a.troops); if (sw + sp <= 0) continue;
    n.stock.swords -= sw; n.stock.spears -= sp; spend(n, 'army', { swords: sw, spears: sp });
    reinforce(a, sw + sp, MORALE.recruit, sw / (sw + sp)); n.manpower -= sw + sp; room -= sw + sp; n.recruited = (n.recruited || 0) + sw + sp;
  }
}
export function monthlyNation(n) {
  // Population follows food: bread from the stockpile, topped up by subsistence farming that depends on the land.
  for (const p of provsOf(n)) {
    if (devastated(p)) continue;
    // people need bread and firewood; subsistence covers part of a shortfall
    const occ = p.ctrl !== n.id, got = occ ? 0 : Math.min(n.fed ?? 1, n.warm ?? 1), sat = got + (1 - got) * biome(p).sub;
    const g = .006 * (sat - .7) - Math.max(0, n.milPct - 12) * .00008;
    const before = p.pop; p.pop *= 1 + g;
    // settlers drift into near-empty land of a well-fed tribe
    if (!occ && sat > .95 && p.pop * 1e6 < 40) p.pop += rnd(1, 4) / 1e6;
    p.gdp = Math.max(p.gdp, p.pop * 2);
    p.gdp *= (before > 0 ? p.pop / before : 1) + (occ ? -.002 : .0012 + ((p.emp || 0) - .45) * .004 + (has(n, 'industry') ? .0015 : 0) + (n.trait === 'oil' ? .0008 : 0) + (!n.you && S.diff === 'hard' ? .0008 : 0) + rnd(-.002, .002) + p.b.harbour * .0004 - (n.tax - .15) * .012 - Math.max(0, n.milPct - 3) * .0002);
  }
  if (n.you && n.fed < .6 && R() < .5) log(`${N(n)} is short of bread: only ${Math.round(n.fed * 100)}% of the people are fed. Build farms and bakeries.`, 'bad', 4);
  if (n.you && (n.warm ?? 1) < .6 && R() < .5) log(`${N(n)} is short of firewood: only ${Math.round(n.warm * 100)}% of homes have fuel. Build forestry.`, 'bad', 4);
  if (auto(n)) aiEconomy(n, forceLimit(n));
  // research
  n.rp += researchPerMonth(n);
  if (auto(n) && n.rp >= techCost(n)) { const av = techAvail(n); if (av.length) { const t = pick(av), c = techCost(n) + techExtra(n, t); if (n.rp >= c) { n.rp -= c; n.techs.push(t.k); log(`${N(n)} develops ${t.n.toLowerCase()}.`, null, t.k === 'nukes' ? 7 : 1); } } }
  if (n.you && !S.st.autoPlayer && n.rp >= techCost(n) && !S.techOffers.length) S.techOffers = shuffle3(techAvail(n).map(t => t.k));
  internalEvents(n);
}
function shuffle3(keys) { const a = keys.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, 3); }

function aiEconomy(n, fl) {
  if (n.treasury < 0) n.maint = .7; else if (n.treasury > gdpOf(n) * .3) n.maint = 1;
  aiPlanEconomy(n);
  const t = troopsOf(n);
  // Armies can only be raised in land you hold: the capital if you control it, otherwise your most populous controlled province.
  const held = S.P[n.cap].ctrl === n.id ? S.P[n.cap] : provsOf(n).filter(p => p.ctrl === n.id).sort((x, y) => y.pop - x.pop)[0];
  const spawn = held ? held.id : null;
  if (spawn != null && (t < fl * .5 || !armiesOf(n).length) && n.manpower > Math.max(MIN_ARMY(), fl * .08) && n.treasury > 0) {
    const { sw, sp } = armTroops(n, Math.min(n.manpower, fl * .3)), tr = sw + sp, c = tr * UPKEEP * 1.5;
    if (tr >= MIN_ARMY() && (n.treasury >= c || !armiesOf(n).length)) {
      n.manpower -= tr; n.treasury -= c; n.stock.swords -= sw; n.stock.spears -= sp; spend(n, 'army', { swords: sw, spears: sp }); n.recruited = (n.recruited || 0) + tr;
      const home = armiesOf(n).find(a => a.prov === spawn && !a.path.length && a.prog === 0);
      if (home) reinforce(home, tr, MORALE.recruit, sw / tr); else makeArmy(n, spawn, tr, sw / tr);
    }
  }
  if (hasNuke(n) && nukeReady(n)) {
    for (const w of warsOf(n.id)) {
      if (warScore(w, n.id) <= -30 && R() < .08) {
        const e = S.nations[enemyIn(w, n.id)];
        const weight = p => S.armies.filter(a => a.prov === p.id && a.nat === e.id).reduce((s, a) => s + a.troops, 0);
        const tg = S.P.filter(p => (p.owner === n.id && p.ctrl === e.id) || p.owner === e.id).sort((x, y) => weight(y) - weight(x) || y.pop - x.pop)[0];
        if (tg) nuke(n, tg); break;
      }
    }
  }
}

function internalEvents(n) {
  if (!n.alive) return;
  if (R() < (1 - stab(n)) * .004) revolt(n);
  if (R() < .004) { provsOf(n).forEach(p => p.gdp *= 1.06); log(`${N(n)}'s economy booms.`, null, 2); }
  if (n.leader === 'paranoid' && R() < .008) { armiesOf(n).forEach(a => a.troops *= .88); log(`${N(n)}'s paranoid leader purges the army.`, null, 2); }
  if (R() < (n.leader === 'senile' ? .01 : .0035)) { const old = D.leaderMap[n.leader]; n.leader = pick(D.leaders).k; log(`${N(n)}'s ${old.n.toLowerCase()} leader dies. The new leader is ${D.leaderMap[n.leader].n.toLowerCase()}.`, null, 3); }
  if (provsOf(n).length >= 4 && R() < (n.trait === 'unrest' ? .006 : 0) + (1 - stab(n)) * .002) breakaway(n);
  if ((n.trait === 'spy' || has(n, 'intel')) && R() < .15) {
    const ws = warsOf(n.id);
    if (ws.length) { const e = S.nations[enemyIn(pick(ws), n.id)], ea = armiesOf(e); if (ea.length) { const t = pick(ea), l = t.troops * .08; t.troops -= l; if (n.you || e.you) log(`${N(n)}'s spies sabotage a ${N(e)} army. [[${Math.round(l)} troops lost]]`, null, 2); } }
  }
  for (const a of n.allies.slice()) if (a > n.id && R() < .002) { n.allies = n.allies.filter(x => x !== a); S.nations[a].allies = S.nations[a].allies.filter(x => x !== n.id); log(`The alliance between ${N(n)} and ${N(S.nations[a])} ends.`, null, 2); }
  if (!n.you && R() < (n.trait === 'diplo' ? .02 : .005)) {
    const nb = neighbours(n).filter(t => !t.you && !n.allies.includes(t.id) && !atWar(n.id, t.id));
    if (nb.length) { const t = pick(nb); n.allies.push(t.id); t.allies.push(n.id); log(`${N(n)} and ${N(t)} sign an alliance.`, null, 2); }
  }
}

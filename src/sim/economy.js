// Monthly economy, growth, construction, recruitment, research and internal politics.
import { S, D, R, pick, rnd, newTribeName, MIN_ARMY, MONTH, YEAR, N, soldierPay, PN, log, emit, gov, has, devastated, stab, hasNuke, forceLimit, techCost, techExtra, techAvail, researchPerMonth, provsOf, gdpOf, armiesOf, troopsOf, monthlyIncome, warsOf, enemyIn, neighbours, atWar } from './core.js';
import { makeArmy, nuke, nukeReady, orderMove, reinforce, mixOf, MORALE } from './military.js';
import { weeklyProduction, weeklyConstruction, biome, aiPlanEconomy, spend } from './industry.js';
import { livingStandard } from './population.js';
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
  wearWeapons(n);
}
// Weapons wear out and break, far faster in war. Replacements come from the stockpile; soldiers with broken
// weapons fight worse until the smiths catch up.
function wearWeapons(n) {
  const A = D.balance.army, war = warsOf(n.id).length > 0, t = troopsOf(n); if (t <= 0) { n.armed = 1; return; }
  let sw = 0; for (const a of armiesOf(n)) sw += a.troops * mixOf(a);
  const rate = war ? A.wearWar : A.wearPeace, needSw = sw * rate, needSp = (t - sw) * rate;
  const gotSw = Math.min(n.stock.swords, needSw), gotSp = Math.min(n.stock.spears, needSp);
  n.stock.swords -= gotSw; n.stock.spears -= gotSp; spend(n, 'army', { swords: gotSw, spears: gotSp });
  const cover = needSw + needSp > 0 ? (gotSw + gotSp) / (needSw + needSp) : 1;
  n.armed = Math.max(0, Math.min(1, (n.armed ?? 1) + (cover - .9) * .1));
}
// What the treasury can keep under arms: tax income after builders' wages, plus savings spread over five years.
export function armyBudget(n) {
  const A = D.balance.army, m = monthlyIncome(n), war = warsOf(n.id).length > 0;
  const spare = Math.max(0, m.inc * (war ? A.aiWarBudget : A.aiBudget) - (m.wages || 0) + Math.max(0, n.treasury) / 60);
  return Math.min(forceLimit(n), spare / Math.max(1e-15, soldierPay(n)));
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
    const add = Math.min(n.manpower, a.troops * rr, room, (a.full ?? a.troops) - a.troops); if (add <= .01) continue;
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
    // growth follows the standard of living: food, firewood and work
    const occ = p.ctrl !== n.id, got = occ ? 0 : Math.min(n.fed ?? 1, n.warm ?? 1), sat = got + (1 - got) * biome(p).sub;
    const g = .006 * (livingStandard(n, p) - .7) - Math.max(0, n.milPct - 12) * .00008;
    const before = p.pop; p.pop *= 1 + g;
    // settlers drift into near-empty land of a well-fed tribe
    if (!occ && sat > .95 && p.pop * 1e6 < 40) p.pop += rnd(1, 4) / 1e6;
  }
  if (n.you && n.fed < .6 && R() < .5) log(`${N(n)} is short of bread: only ${Math.round(n.fed * 100)}% of the people are fed. Build farms and bakeries.`, 'bad', 4);
  if (n.you && (n.warm ?? 1) < .6 && R() < .5) log(`${N(n)} is short of firewood: only ${Math.round(n.warm * 100)}% of homes have fuel. Build forestry.`, 'bad', 4);
  if (auto(n)) aiEconomy(n, forceLimit(n));
  // research
  n.rp += researchPerMonth(n);
  if (auto(n) && n.rp >= techCost(n)) { const av = techAvail(n); if (av.length) { const t = aiPickTech(n, av), c = techCost(n) + techExtra(n, t); if (n.rp >= c) { n.rp -= c; n.techs.push(t.k); log(`${N(n)} develops ${t.n.toLowerCase()}.`, null, t.k === 'nukes' ? 7 : 1); } } }
  if (n.you && !S.st.autoPlayer && n.rp >= techCost(n) && !S.techOffers.length) S.techOffers = shuffle3(techAvail(n).map(t => t.k));
  internalEvents(n);
}
// What the AI researches: technologies that open buildings for needs its people go without come first,
// then the next age, then anything, with some chance thrown in.
function aiPickTech(n, av) {
  const short = new Set(D.balance.econ.needs.filter(nd => (n.needSat?.[nd.k] ?? 1) < .8).flatMap(nd => Object.keys(nd.goods)));
  const opens = t => Object.values(D.buildings).filter(B => B.tech === t.k);
  const score = t => R() + (opens(t).some(B => Object.keys((B.methods ? B.methods[0].out : B.out) || {}).some(g => short.has(g))) ? 1.5 : 0)
    + (opens(t).length ? .6 : 0) + (t.age === 'bronze' ? .4 : 0) + (D.techs.some(x => x.req && x.req.includes(t.k)) ? .4 : 0);
  return av.slice().sort((a, b) => score(b) - score(a))[0];
}
function shuffle3(keys) { const a = keys.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, 3); }

function aiEconomy(n, fl) {
  if (n.treasury < 0) n.maint = .7; else if (n.treasury > gdpOf(n) * .3) n.maint = 1;
  // taxes: the AI decides the army it wants (a share of its force limit, all of it in war) and sets taxes to pay
  // for that army and the builders, a little over. Savings piling up beyond two years of spending let it cut taxes,
  // which leaves more in people's pockets: better living, faster growth.
  const mi = monthlyIncome(n), war = warsOf(n.id).length > 0, gm = gdpOf(n) / 12;
  const wantArmy = forceLimit(n) * (war ? 1 : .6), spendM = wantArmy * soldierPay(n) + (mi.wages || 0);
  let wantTax = gm > 0 ? spendM * 1.1 / gm : .15;
  if (n.treasury > spendM * 24) wantTax -= .04; else if (n.treasury < spendM * 3) wantTax += .02;
  wantTax = Math.max(.05, Math.min(war ? .28 : .22, wantTax));
  if (Math.abs(wantTax - n.tax) >= .005) n.tax = Math.round((n.tax + Math.sign(wantTax - n.tax) * .01) * 100) / 100;
  n.armyWant = wantArmy;
  aiPlanEconomy(n);
  const t = troopsOf(n), want = Math.min(n.armyWant ?? fl, armyBudget(n));
  n.armyTarget = want;
  // Too many soldiers for the treasury in peacetime: send some home to work.
  if (!warsOf(n.id).length && t > want * 1.2 && t > MIN_ARMY() * 2) {
    let cut = t - want * 1.05;
    for (const a of armiesOf(n).filter(a => !a.path.length && S.P[a.prov].ctrl === n.id).sort((x, y) => x.troops - y.troops)) {
      if (cut <= 0) break; const take = Math.min(cut, a.troops); n.stock.swords += take * mixOf(a); n.stock.spears += take * (1 - mixOf(a));
      a.troops -= take; a.full = a.troops; n.discharged = (n.discharged || 0) + take; cut -= take;
    }
    S.armies = S.armies.filter(a => a.nat !== n.id || a.troops >= MIN_ARMY() || (n.discharged += a.troops, false));
  }
  // Armies can only be raised in land you hold: the capital if you control it, otherwise your most populous controlled province.
  const held = S.P[n.cap].ctrl === n.id ? S.P[n.cap] : provsOf(n).filter(p => p.ctrl === n.id).sort((x, y) => y.pop - x.pop)[0];
  const spawn = held ? held.id : null;
  if (spawn != null && (t < want * .85 || !armiesOf(n).length) && n.manpower > MIN_ARMY() && n.treasury > 0) {
    const { sw, sp } = armTroops(n, Math.min(n.manpower, Math.max(MIN_ARMY(), want - t), fl * .3)), tr = sw + sp, c = tr * soldierPay(n) * D.balance.army.signWeeks * 7 / MONTH;
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

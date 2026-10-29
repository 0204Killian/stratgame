// Wars, war score, peace deals, alliances, AI war declarations.
import { S, D, R, clamp, MONTH, YEAR, N, PN, log, emit, gov, leader, popOf, troopsOf, monthlyIncome, provsOf, neighbours, warBetween, atWar, warsOf, enemyIn, allied, truceWith, player, addDecision, unlockMedal, trait, soldierPay } from './core.js';
import { orderMove } from './military.js';
import { workforce, subsistenceCap } from './industry.js';
import { idleWorkers } from './population.js';

export function provValue(p) {
  const o = p.owner != null ? S.nations[p.owner] : null; if (!o) return 0;
  const tp = popOf(o) || 1;
  return clamp(Math.round(8 + 70 * p.pop / tp) + (p.id === o.cap ? 10 : 0), 8, 60);
}
export function warScore(w, side) {
  let s = 0; const a = w.a, b = w.b;
  for (const p of S.P) { if (p.owner === b && p.ctrl === a) s += provValue(p); if (p.owner === a && p.ctrl === b) s -= provValue(p); }
  s += w.bs.a - w.bs.b;
  const bAll = S.P.filter(p => p.owner === b), aAll = S.P.filter(p => p.owner === a);
  if (bAll.length && bAll.every(p => p.ctrl === a)) s = 100;
  if (aAll.length && aAll.every(p => p.ctrl === b)) s = -100;
  s = clamp(s, -100, 100);
  return side === a ? s : -s;
}
// Track each side's largest army during the war, so "troops lost" is measured against what they fielded.
export function trackPeak(w) {
  if (!w.peak) w.peak = { a: 0, b: 0 };
  w.peak.a = Math.max(w.peak.a, troopsOf(S.nations[w.a]));
  w.peak.b = Math.max(w.peak.b, troopsOf(S.nations[w.b]));
}
// Forced settlement: loser has 100% of its territory occupied AND has lost at least 70% of its peak troops.
export function surrenderStatus(w, winnerId) {
  trackPeak(w);
  const loserId = enemyIn(w, winnerId), loser = S.nations[loserId];
  const all = provsOf(loser), occ = all.filter(p => p.ctrl === winnerId).length;
  const peak = loserId === w.a ? w.peak.a : w.peak.b, now = troopsOf(loser);
  const lost = peak > 0 ? 1 - now / peak : 1;
  const landPct = all.length ? occ / all.length : 1;
  return { landPct, lost, forced: landPct >= 1 && lost >= .7 };
}
export const occupiedBy = (w, winnerId) => { const loser = enemyIn(w, winnerId); return S.P.filter(p => p.owner === loser && p.ctrl === winnerId); };
// A crushed nation (all land occupied, 70% of its army gone) has its provinces taken at a steep discount.
export const CRUSH_MULT = .25;
export const isCrushed = (w, loserId) => w && w.crushed === loserId;
export function provCost(w, id) {
  const p = S.P[id], v = provValue(p);
  return isCrushed(w, p.owner) ? Math.max(1, Math.round(v * CRUSH_MULT)) : v;
}
export const demandCost = (ids, w) => ids.reduce((s, i) => s + provCost(w, i), 0);

// ---------- Peace treaties ----------
// A deal is always paid by the loser to the winner (deal.to):
//   provs: occupied provinces ceded · gold: 0-3 lumps of 6 months' income · reps: reparations · allies: loser breaks its alliances
export const TERMS = { goldStep: 8, goldMonths: 6, goldMax: 3, reps: 15, repsPct: .2, repsYears: 5, allies: 10, whiteBand: 10 };
export function normDeal(d, to) {
  if (Array.isArray(d)) d = { provs: d };
  return { to: d.to ?? to, provs: (d.provs || []).slice(), gold: clamp(d.gold | 0, 0, TERMS.goldMax), reps: !!d.reps, allies: !!d.allies };
}
export const goldAmount = (loser, steps) => steps * TERMS.goldMonths * Math.max(0, monthlyIncome(loser).inc);
export function dealCost(deal, w) {
  return demandCost(deal.provs, w) + deal.gold * TERMS.goldStep + (deal.reps ? TERMS.reps : 0) + (deal.allies ? TERMS.allies : 0);
}
export const isWhite = d => !d.provs.length && !d.gold && !d.reps && !d.allies;
// What the AI needs to agree to a treaty proposed by the player.
export function aiAccepts(w, playerId, deal) {
  deal = normDeal(deal, playerId);
  const ai = enemyIn(w, playerId), aiSc = warScore(w, ai), cost = dealCost(deal, w);
  if (isWhite(deal)) return aiSc <= TERMS.whiteBand;
  if (deal.to === playerId) return cost <= Math.max(0, -aiSc) && cost <= 100;   // player demands
  return cost >= requiredOffer(w, ai);                                                // player concedes
}
export function requiredOffer(w, aiId) {
  const s = warScore(w, aiId); if (s <= TERMS.whiteBand) return 0;
  return Math.round(s * (S.day - w.start > 4 * YEAR ? .5 : .8));
}
// AI-built treaty: provinces first, then reparations, gold, alliances, up to the budget.
export function bestDeal(w, winnerId, budget) {
  const loser = S.nations[enemyIn(w, winnerId)];
  const d = normDeal({ provs: bestDemand(w, winnerId, budget) }, winnerId);
  let left = budget - demandCost(d.provs, w);
  if (left >= TERMS.reps) { d.reps = true; left -= TERMS.reps; }
  while (left >= TERMS.goldStep && d.gold < TERMS.goldMax && goldAmount(loser, 1) > 0) { d.gold++; left -= TERMS.goldStep; }
  if (left >= TERMS.allies && loser.allies.length) { d.allies = true; left -= TERMS.allies; }
  return d;
}
export function describeDeal(d, w, mark) {
  const loser = S.nations[enemyIn(w, d.to)], parts = [];
  if (d.provs.length) parts.push((mark ? d.provs.map(i => PN(S.P[i])) : d.provs.map(i => S.P[i].name)).join(', '));
  if (d.gold) parts.push(`${d.gold * TERMS.goldMonths} months of income in gold`);
  if (d.reps) parts.push(`war reparations for ${TERMS.repsYears} years`);
  if (d.allies) parts.push(`${mark ? N(loser) : loser.name} breaks its alliances`);
  return parts.join('; ');
}
export function bestDemand(w, winnerId, budget) {
  const cost = p => provCost(w, p.id);   // discounted when the loser is crushed
  const opts = occupiedBy(w, winnerId).sort((x, y) => provValue(y) - provValue(x));
  const out = []; let c = 0;
  opts.forEach(p => { const v = cost(p); if (c + v <= budget) { out.push(p.id); c += v; } });
  if (!out.length && opts.length && budget >= 100) out.push(...opts.map(p => p.id));
  return out;
}

export function declareWar(att, def, silent) {
  if (atWar(att.id, def.id)) return warBetween(att.id, def.id);
  if (att.allies.includes(def.id)) { att.allies = att.allies.filter(x => x !== def.id); def.allies = def.allies.filter(x => x !== att.id); }
  const w = { id: S.nextWarId++, a: att.id, b: def.id, start: S.day, bs: { a: 0, b: 0 }, lastOffer: S.day };
  S.wars.push(w); trackPeak(w);
  if (!silent) log(`${N(att)} declares war on ${N(def)}.`, 'big', att.you || def.you ? 7 : 5);
  if (def.you) emit('warOnYou', { war: w.id, att: att.id });
  if (att.you && !silent) S.st.declared = true;
  for (const x of def.allies.slice()) {
    const al = S.nations[x];
    if (!al.alive || al.id === att.id || atWar(al.id, att.id) || truceWith(al.id, att.id)) continue;
    if (al.you) addDecision({ kind: 'callToArms', title: 'Call to arms', text: `${def.name}, your ally, has been attacked by ${att.name}. Will you honour the alliance?`, choices: [{ l: 'Join the war', s: 'Fight alongside your ally' }, { l: 'Stay out', s: 'The alliance ends' }], data: { ally: al.id, def: def.id, att: att.id } });
    else if (R() < .85) { declareWar(al, att, true); log(`${N(al)} honours its alliance and joins the war against ${N(att)}.`, null, 4); }
  }
  S.mapVersion++;
  return w;
}
function atWarAfter(nid, p, w) { return S.wars.some(x => x !== w && ((x.a === nid && (x.b === p.owner || x.b === p.ctrl)) || (x.b === nid && (x.a === p.owner || x.a === p.ctrl)))); }
export function makePeace(w, winnerId, deal, note, forced) {
  if (!S.wars.includes(w)) return;
  deal = normDeal(deal, winnerId);
  const loserId = enemyIn(w, winnerId), win = S.nations[winnerId], lose = S.nations[loserId];
  deal.provs = deal.provs.filter(id => S.P[id].owner === loserId);
  deal.provs.forEach(id => { const p = S.P[id]; p.owner = winnerId; p.ctrl = winnerId; p.siege = null; if (p.build) p.build = null; });
  if (deal.gold) { const g = goldAmount(lose, deal.gold); lose.treasury -= g; win.treasury += g; }
  if (deal.reps) (lose.reps || (lose.reps = [])).push({ to: winnerId, until: S.day + TERMS.repsYears * YEAR });
  if (deal.allies) { for (const x of lose.allies) S.nations[x].allies = S.nations[x].allies.filter(y => y !== loserId); lose.allies = []; }
  for (const p of S.P) if ((p.owner === w.a && p.ctrl === w.b) || (p.owner === w.b && p.ctrl === w.a)) { p.ctrl = p.owner; p.siege = null; }
  S.wars = S.wars.filter(x => x !== w);
  for (const a of S.armies) {
    const p = S.P[a.prov];
    if (p.owner != null && p.owner !== a.nat && !allied(a.nat, p.owner) && !atWarAfter(a.nat, p, w)) { a.path = []; a.prog = 0; if (!orderMove(a, S.nations[a.nat].cap)) a.prov = S.nations[a.nat].cap; }
  }
  const tr = S.day + D.balance.truceYears * YEAR;
  win.truce[loserId] = tr; lose.truce[winnerId] = tr;
  if (forced) log(`${N(lose)} has collapsed, its land overrun and its army broken. ${N(win)} dictates the peace.`, 'big', win.you || lose.you ? 8 : 5);
  if (win.you || lose.you) emit('peace', { win: win.id, lose: lose.id, terms: isWhite(deal) ? '' : describeDeal(deal, w), forced: !!forced, white: isWhite(deal), provs: deal.provs.slice() });
  if (!isWhite(deal)) log(`Peace: ${N(lose)} yields to ${N(win)}: ${describeDeal(deal, w, true)}.`, 'big', win.you || lose.you ? 7 : 5);
  else log(`White peace between ${N(win)} and ${N(lose)}. ${note || ''}`, null, 4);
  if (win.you && deal.provs.length && S.day - w.start <= YEAR) unlockMedal('blitz');
  checkFallen(); S.mapVersion++;
}
// Monthly reparation payments: a share of the payer's income goes to the winner.
export function payReparations(n, income) {
  if (!n.reps || !n.reps.length) return;
  n.reps = n.reps.filter(r => r.until > S.day && S.nations[r.to].alive);
  for (const r of n.reps) { const amt = Math.max(0, income) * TERMS.repsPct; n.treasury -= amt; S.nations[r.to].treasury += amt; }
}
export function checkFallen() {
  for (const n of S.nations) {
    if (!n.alive) continue;
    const ps = provsOf(n);
    if (!ps.length) {
      n.alive = false; S.armies = S.armies.filter(a => a.nat !== n.id); S.wars = S.wars.filter(w => w.a !== n.id && w.b !== n.id);
      for (const p of S.P) if (p.ctrl === n.id) p.ctrl = p.owner;
      for (const x of n.allies) S.nations[x].allies = S.nations[x].allies.filter(y => y !== n.id); n.allies = [];
      log(n.you ? `${N(n)} has fallen. Your nation is gone.` : `${N(n)} has been wiped off the map.`, 'bad', 9);
      S.mapVersion++;
    } else if (S.P[n.cap].owner !== n.id) n.cap = ps.sort((x, y) => y.pop - x.pop)[0].id;
  }
}
export function warMonthly(w) {
  if (!S.wars.includes(w)) return;
  const A = S.nations[w.a], B = S.nations[w.b];
  if (!A.alive || !B.alive) { S.wars = S.wars.filter(x => x !== w); return; }
  const age = S.day - w.start, sa = warScore(w, w.a);
  const winner = sa >= 0 ? A : B, loser = sa >= 0 ? B : A, sc = Math.abs(sa);
  const crushed = surrenderStatus(w, winner.id).forced;
  w.crushed = crushed ? loser.id : null;
  if (crushed) {
    if (winner.you && !S.st.autoPlayer) {
      if (!w.crushTold) { w.crushTold = true; log(`${N(loser)} is crushed: its land is overrun and its army broken. Dictate the peace.`, 'big', 8); emit('peaceTable', { war: w.id }); }
      return;   // the player draws up the treaty themselves
    }
    makePeace(w, winner.id, bestDeal(w, winner.id, 100), '', true); return;
  }
  if (winner.you || loser.you) {
    if (S.day - w.lastOffer < 6 * MONTH || age < 6 * MONTH) return;
    if (S.decisions.some(d => d.kind === 'peace' && d.data.war === w.id)) return;
    if (!winner.you && sc >= 30 && R() < .3) {
      w.lastOffer = S.day; const deal = bestDeal(w, winner.id, sc); if (isWhite(deal)) return;
      addDecision({ kind: 'peace', title: `${winner.name} offers peace`, text: `War score ${sc}% in their favour. Their terms: ${describeDeal(deal, w)}.`, choices: [{ l: 'Accept', s: 'Sign the treaty' }, { l: 'Fight on', s: 'Refuse the terms' }], data: { war: w.id, winner: winner.id, deal, refuse: 'The war continues.' } });
    } else if (winner.you && sc >= 50 && age >= YEAR && R() < .25) {
      w.lastOffer = S.day; const deal = bestDeal(w, winner.id, Math.round(sc * .8)); if (isWhite(deal)) return;
      addDecision({ kind: 'peace', title: `${loser.name} sues for peace`, text: `They are losing (${sc}% war score) and offer: ${describeDeal(deal, w)}.`, choices: [{ l: 'Accept', s: 'Sign the treaty' }, { l: 'Fight on', s: 'Hold out for more' }], data: { war: w.id, winner: winner.id, deal, refuse: 'Your generals press on.' } });
    }
    return;
  }
  if ((sc >= 25 && age >= 8 * MONTH && R() < .35) || (sc >= TERMS.whiteBand && age >= 3 * YEAR && R() < .2)) { const deal = bestDeal(w, winner.id, sc); if (!isWhite(deal)) { makePeace(w, winner.id, deal); return; } }
  if (age >= 3 * YEAR && sc < TERMS.whiteBand && R() < .2) { makePeace(w, winner.id, [], 'Both sides are exhausted.'); return; }
  // war costs money: an AI side that can no longer pay its soldiers looks for a way out
  const broke = x => !x.you && x.treasury < 0;
  if (age >= YEAR && (broke(A) || broke(B)) && R() < .15) {
    const deal = sc >= 10 ? bestDeal(w, winner.id, sc) : [];
    if (broke(winner) && !winner.you && !loser.you) makePeace(w, winner.id, [], `${winner.name} can no longer pay for the war.`);
    else if (broke(loser) && !loser.you && (!winner.you || S.st.autoPlayer)) makePeace(w, winner.id, deal, `${loser.name} can no longer pay for the war.`);
  }
}
export function allianceChance(p, t) {
  if (S.day - t.lastAsk < YEAR) return 0;
  let c = (p.trait === 'diplo' ? .6 : .3) + (t.trait === 'diplo' ? .15 : 0);
  if (t.grudge === p.id && t.grudgeUntil > S.day) c -= .3;
  if (troopsOf(p) > troopsOf(t)) c += .1;
  return clamp(c, 0, .95);
}
// AI tribes go to war for a reason and only when they can afford it: they need land (idle people, land full of
// subsistence farmers), want an ore deposit they lack, or hold a grudge. They pick a target they clearly outmatch,
// counting its allies, and only with money in the treasury to keep the army paid through a long war.
export function aiDiplomacy() {
  const p = player();
  for (const n of S.nations) {
    if (!n.alive || n.you || warsOf(n.id).length) continue;
    let agg = gov(n).agg + leader(n).agg; if (n.leader === 'senile') agg += (R() - .33) * .6;
    const grudge = n.grudge != null && n.grudgeUntil > S.day;
    if (grudge) agg += .4;
    if (R() > agg * .02) continue;
    const my = troopsOf(n), m = monthlyIncome(n);
    if (my < 10 || n.treasury < my * soldierPay(n) * 6 || m.net < 0) continue;   // can't pay for half a year of war
    // motives
    const ps = provsOf(n).filter(q => q.ctrl === n.id), wf = ps.reduce((s, q) => s + workforce(q), 0);
    const crowded = ps.reduce((s, q) => s + idleWorkers(q), 0) / Math.max(1, wf) > .04 || ps.every(q => (q.subs || 0) >= subsistenceCap(q) * .9);
    const have = new Set(ps.flatMap(q => q.dep || []));
    const wantsOre = t => (n.techs.includes('copper') && !have.has('copper') && provsOf(t).some(q => (q.dep || []).includes('copper')))
      || (n.techs.includes('bronze') && !have.has('tin') && provsOf(t).some(q => (q.dep || []).includes('tin')));
    let cands = neighbours(n).filter(t => !n.allies.includes(t.id) && !truceWith(n.id, t.id) && !atWar(n.id, t.id));
    if (p && S.day < D.difficulties[S.diff].grace * YEAR) cands = cands.filter(t => !t.you);
    if (!grudge && !crowded) { cands = cands.filter(wantsOre); if (!cands.length) continue; }
    // defensive strength: soldiers, plus what the target could raise from its own manpower, plus allies
    const def = t => troopsOf(t) + Math.min(t.manpower || 0, troopsOf(t)) * .5 + t.allies.reduce((s, x) => s + troopsOf(S.nations[x]) * .6, 0);
    let weak = cands.filter(t => def(t) < my * .65);
    if (grudge) { const g = cands.find(t => t.id === n.grudge); if (g && def(g) < my * .9) weak = [g]; }
    if (!weak.length) continue;
    const pl = weak.filter(t => t.you), bias = D.difficulties[S.diff].bias;
    let t;
    if (pl.length && bias > 0 && R() < bias) t = pl[0];
    else { let pool = weak; if (pl.length && bias <= 0 && weak.length > 1 && R() < .5 - bias) pool = weak.filter(x => !x.you); t = pool.sort((x, y) => (wantsOre(y) - wantsOre(x)) || def(x) - def(y))[0]; }
    if (t) declareWar(n, t);
  }
}

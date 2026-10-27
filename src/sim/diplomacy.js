// Wars, war score, peace deals, alliances, AI war declarations.
import { S, D, R, clamp, MONTH, YEAR, N, PN, log, emit, gov, leader, popOf, troopsOf, provsOf, neighbours, warBetween, atWar, warsOf, enemyIn, allied, truceWith, player, addDecision, unlockMedal, trait } from './core.js';
import { orderMove } from './military.js';

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
export const demandCost = ids => ids.reduce((s, i) => s + provValue(S.P[i]), 0);
export function aiAccepts(w, demanderId, ids) {
  const sc = warScore(w, demanderId);
  if (!ids.length) return sc >= -15 || S.day - w.start > 4 * YEAR;
  return demandCost(ids) <= Math.max(0, sc);
}
export function bestDemand(w, winnerId, budget) {
  const opts = occupiedBy(w, winnerId).sort((x, y) => provValue(y) - provValue(x));
  const out = []; let c = 0;
  opts.forEach(p => { const v = provValue(p); if (c + v <= budget) { out.push(p.id); c += v; } });
  if (!out.length && opts.length && budget >= 100) out.push(...opts.map(p => p.id));
  return out;
}

export function declareWar(att, def, silent) {
  if (atWar(att.id, def.id)) return warBetween(att.id, def.id);
  if (att.allies.includes(def.id)) { att.allies = att.allies.filter(x => x !== def.id); def.allies = def.allies.filter(x => x !== att.id); }
  const w = { id: S.nextWarId++, a: att.id, b: def.id, start: S.day, bs: { a: 0, b: 0 }, lastOffer: S.day };
  S.wars.push(w); trackPeak(w);
  if (!silent) log(`${N(att)} declares war on ${N(def)}.`, 'big', att.you || def.you ? 7 : 5);
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
export function makePeace(w, winnerId, provIds, note, forced) {
  if (!S.wars.includes(w)) return;
  const loserId = enemyIn(w, winnerId), win = S.nations[winnerId], lose = S.nations[loserId];
  provIds = provIds.filter(id => S.P[id].owner === loserId);
  provIds.forEach(id => { const p = S.P[id]; p.owner = winnerId; p.ctrl = winnerId; p.siege = null; if (p.build) p.build = null; });
  for (const p of S.P) if ((p.owner === w.a && p.ctrl === w.b) || (p.owner === w.b && p.ctrl === w.a)) { p.ctrl = p.owner; p.siege = null; }
  S.wars = S.wars.filter(x => x !== w);
  for (const a of S.armies) {
    const p = S.P[a.prov];
    if (p.owner != null && p.owner !== a.nat && !allied(a.nat, p.owner) && !atWarAfter(a.nat, p, w)) { a.path = []; a.prog = 0; if (!orderMove(a, S.nations[a.nat].cap)) a.prov = S.nations[a.nat].cap; }
  }
  const tr = S.day + D.balance.truceYears * YEAR;
  win.truce[loserId] = tr; lose.truce[winnerId] = tr;
  if (forced) log(`${N(lose)} has collapsed, its land overrun and its army broken. ${N(win)} dictates the peace.`, 'big', win.you || lose.you ? 8 : 5);
  if (provIds.length) log(`Peace: ${N(lose)} cedes ${provIds.map(i => PN(S.P[i])).join(', ')} to ${N(win)}.`, 'big', win.you || lose.you ? 7 : 5);
  else log(`White peace between ${N(win)} and ${N(lose)}. ${note || ''}`, null, 4);
  if (win.you && provIds.length && S.day - w.start <= YEAR) unlockMedal('blitz');
  checkFallen(); S.mapVersion++;
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
  if (surrenderStatus(w, winner.id).forced) { makePeace(w, winner.id, occupiedBy(w, winner.id).map(p => p.id), '', true); return; }
  if (winner.you || loser.you) {
    if (S.day - w.lastOffer < 6 * MONTH || age < 6 * MONTH) return;
    if (S.decisions.some(d => d.kind === 'peace' && d.data.war === w.id)) return;
    if (!winner.you && sc >= 30 && R() < .3) {
      w.lastOffer = S.day; const ids = bestDemand(w, winner.id, sc); if (!ids.length) return;
      addDecision({ kind: 'peace', title: `${winner.name} offers peace`, text: `War score ${sc}% in their favour. They demand ${ids.map(i => S.P[i].name).join(', ')}.`, choices: [{ l: 'Accept', s: `Cede ${ids.length} province${ids.length > 1 ? 's' : ''}` }, { l: 'Fight on', s: 'Refuse the terms' }], data: { war: w.id, winner: winner.id, ids, refuse: 'The war continues.' } });
    } else if (winner.you && sc >= 50 && age >= YEAR && R() < .25) {
      w.lastOffer = S.day; const ids = bestDemand(w, winner.id, Math.round(sc * .8)); if (!ids.length) return;
      addDecision({ kind: 'peace', title: `${loser.name} sues for peace`, text: `They are losing (${sc}% war score) and offer you ${ids.map(i => S.P[i].name).join(', ')}.`, choices: [{ l: 'Accept', s: `Gain ${ids.length} province${ids.length > 1 ? 's' : ''}` }, { l: 'Fight on', s: 'Hold out for more' }], data: { war: w.id, winner: winner.id, ids, refuse: 'Your generals press on.' } });
    }
    return;
  }
  if (sc >= 25 && age >= 8 * MONTH && R() < .35) { const ids = bestDemand(w, winner.id, sc); if (ids.length) { makePeace(w, winner.id, ids); return; } }
  if (age >= 3 * YEAR && sc < 25 && R() < .2) makePeace(w, winner.id, [], 'Both sides are exhausted.');
}
export function allianceChance(p, t) {
  if (S.day - t.lastAsk < YEAR) return 0;
  let c = (p.trait === 'diplo' ? .6 : .3) + (t.trait === 'diplo' ? .15 : 0);
  if (t.grudge === p.id && t.grudgeUntil > S.day) c -= .3;
  if (troopsOf(p) > troopsOf(t)) c += .1;
  return clamp(c, 0, .95);
}
export function aiDiplomacy() {
  const p = player();
  for (const n of S.nations) {
    if (!n.alive || n.you || warsOf(n.id).length) continue;
    let agg = gov(n).agg + leader(n).agg; if (n.leader === 'senile') agg += (R() - .33) * .6;
    if (n.grudge != null && n.grudgeUntil > S.day) agg += .4;
    if (R() > agg * .05) continue;
    const my = troopsOf(n);
    let cands = neighbours(n).filter(t => !n.allies.includes(t.id) && !truceWith(n.id, t.id) && !atWar(n.id, t.id));
    if (p && S.day < D.difficulties[S.diff].grace * YEAR) cands = cands.filter(t => !t.you);
    const allyPow = t => troopsOf(t) + t.allies.reduce((s, x) => s + troopsOf(S.nations[x]) * .6, 0);
    let weak = cands.filter(t => allyPow(t) < my * .85);
    if (n.grudge != null && n.grudgeUntil > S.day) { const g = cands.find(t => t.id === n.grudge); if (g) weak = [g]; }
    if (!weak.length) continue;
    const pl = weak.filter(t => t.you), bias = D.difficulties[S.diff].bias;
    let t;
    if (pl.length && bias > 0 && R() < bias) t = pl[0];
    else { let pool = weak; if (pl.length && bias < 0 && weak.length > 1 && R() < -bias) pool = weak.filter(x => !x.you); t = pool.sort((x, y) => allyPow(x) - allyPow(y))[0]; }
    if (t) declareWar(n, t);
  }
}

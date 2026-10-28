// Armies, movement, battles, sieges, nuclear strikes.
import { S, D, R, rnd, clamp, memo, YEAR, N, PN, log, emit, has, atWar, allied, warBetween, quality, garrison, isPort, unlockMedal, MIN_ARMY, nameProvince } from './core.js';

// An army is a number of troops and a mix: the share that are swordsmen (front row); the rest are spearmen (back row).
export function makeArmy(n, provId, troops, mix = .5) {
  const a = { id: S.nextArmyId++, nat: n.id, troops: Math.max(0, troops), mix, prov: provId, path: [], prog: 0, hop: 6, retreat: false, mor: MORALE.recruit };
  S.armies.push(a); return a;
}
export const mixOf = a => a.mix ?? .5;
const bio = p => D.biomes[p.biome] || D.biomes.plains;
// ---------- Morale (EU4-style) ----------
export const MORALE = { recruit: .5, siegeMin: .5, broken: .25, regenHome: .25, regenAway: .10, winLoss: [.15, .35], loseTo: [0, .1] };
export const mor = a => a.mor ?? 1;
// Add troops to an army: fresh recruits dilute its morale.
export function reinforce(a, troops, m = MORALE.recruit, mx = .5) {
  const t = a.troops + troops; if (t > 0) { a.mor = (mor(a) * a.troops + m * troops) / t; a.mix = (mixOf(a) * a.troops + mx * troops) / t; } a.troops = t;
}
export function canEnter(nid, p) {
  if (p.owner == null) return true;
  if (p.owner === nid || p.ctrl === nid) return true;
  if (allied(nid, p.owner)) return true;
  return atWar(nid, p.owner) || atWar(nid, p.ctrl);
}
// Supply: armies standing in land controlled by an enemy wither; a nation with no land of its own withers fast.
export function dailyAttrition() {
  const has1 = new Set(); for (const p of S.P) if (p.ctrl != null) has1.add(p.ctrl);
  for (const a of S.armies) {
    const home = S.P[a.prov].ctrl === a.nat || (S.P[a.prov].ctrl != null && allied(a.nat, S.P[a.prov].ctrl));
    if (!inBattle(a.prov) || a.prog > 0) a.mor = Math.min(1, mor(a) + (home ? MORALE.regenHome : MORALE.regenAway) / 30);
    if (a.prog > 0) continue;
    const p = S.P[a.prov];
    if (!has1.has(a.nat)) a.troops *= 1 - .10 / 30;
    else if (p.ctrl != null && p.ctrl !== a.nat && atWar(a.nat, p.ctrl)) a.troops *= 1 - .02 / 30;
  }
  S.armies = S.armies.filter(a => a.troops >= MIN_ARMY());
}
export const seaOK = n => n.trait === 'navy' || has(n, 'carriers');
const hasPort = n => memo('port' + n.id, () => S.P.some(q => q.owner === n.id && q.ctrl === n.id && isPort(q)));
// ---------- Oceans ----------
// Water bodies are worked out once per map from the grid: which coastal provinces share each connected body of water.
let oceanCache = null;
function oceans() {
  if (oceanCache && oceanCache.P === S.P) return oceanCache;
  const W = S.W, H = S.H, N = W * H, body = new Int32Array(N).fill(-1), byBody = [];
  let nb = 0;
  for (let i = 0; i < N; i++) {
    if (S.land[i] || body[i] >= 0) continue;
    const q = [i]; body[i] = nb;
    for (let h = 0; h < q.length; h++) { const c = q[h], x = c % W;
      for (const j of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) if (j >= 0 && j < N && !S.land[j] && body[j] < 0) { body[j] = nb; q.push(j); } }
    byBody.push(new Set()); nb++;
  }
  const bodiesOf = S.P.map(() => new Set());
  for (let i = 0; i < N; i++) {
    if (!S.land[i]) continue; const r = S.reg[i]; if (r < 0) continue; const x = i % W;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < N && !S.land[j]) { bodiesOf[r].add(body[j]); byBody[body[j]].add(r); }
  }
  oceanCache = { P: S.P, bodiesOf: bodiesOf.map(s => [...s]), coasts: byBody.map(s => [...s]), reach: [] };
  return oceanCache;
}
// Ocean-going: Carrier Fleet tech or the Huge Navy trait.
export const oceanOK = n => n.trait === 'navy' || has(n, 'carriers');
// Can this nation set sail across open ocean from province p? Needs a port, or the Huge Navy trait.
const oceanFrom = (n, p) => p.coastal && oceanOK(n) && p.ctrl === n.id && (n.trait === 'navy' || isPort(p) || (p.owner === n.id && hasPort(n)));
// Every coastal province sharing a body of water with p.
export function oceanReach(p) {
  const o = oceans(); if (o.reach[p.id]) return o.reach[p.id];
  const out = new Set();
  for (const b of o.bodiesOf[p.id]) for (const q of o.coasts[b]) if (q !== p.id) out.add(q);
  return (o.reach[p.id] = [...out]);
}
// Bodies of water this nation can launch an ocean crossing into today.
const launchBodies = n => memo('ob' + n.id, () => {
  const o = oceans(), out = new Set();
  for (const q of S.P) if (q.ctrl === n.id && oceanFrom(n, q)) for (const b of o.bodiesOf[q.id]) out.add(b);
  return out;
});
export function edges(n, p, ocean = true) {
  const out = p.landN.slice();
  if (ocean && oceanFrom(n, p)) { const seen = new Set(out); for (const q of oceanReach(p)) if (!seen.has(q)) out.push(q); return out; }
  if (seaOK(n) || (isPort(p) && p.ctrl === n.id) || (p.coastal && p.owner === n.id && hasPort(n))) for (const q of p.seaN) out.push(q);
  return out;
}
export function findPath(n, from, to) {
  if (from === to) return [];
  const prev = new Map([[from, -1]]), q = [from];
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    for (const nx of edges(n, S.P[c])) {
      if (prev.has(nx)) continue;
      if (!canEnter(n.id, S.P[nx])) { if (nx === to) return null; continue; }
      prev.set(nx, c);
      if (nx === to) { const path = []; let k = to; while (k !== from) { path.unshift(k); k = prev.get(k); } return path; }
      q.push(nx);
    }
  }
  return null;
}
export function hopDays(n, a, to) {
  const from = S.P[a.prov], dest = S.P[to];
  let d = 6 + bio(dest).move;
  if (!from.landN.includes(to)) { const cells = Math.hypot(from.cx - dest.cx, from.cy - dest.cy) / (S.CS || 8); d = Math.max(d * 1.6, 4 + cells / 4); }
  if (has(n, 'logistics')) d *= .8; if (has(n, 'blitz')) d *= .5;
  return Math.max(1.5, d);
}
export function orderMove(a, to) {
  const n = S.nations[a.nat], path = findPath(n, a.prov, to);
  if (path == null) return false;
  a.path = path; a.prog = 0; a.retreat = false; if (path.length) a.hop = hopDays(n, a, path[0]);
  return true;
}
export const inBattle = pid => S.battles.some(b => b.prov === pid);

export function dailyMilitary() {
  for (const a of S.armies) {
    if (!a.path.length || (inBattle(a.prov) && !a.retreat)) continue;
    a.prog += 1 / a.hop;
    if (a.prog >= 1) {
      const nx = a.path[0];
      if (!canEnter(a.nat, S.P[nx])) { a.path = []; a.prog = 0; continue; }
      a.prov = a.path.shift(); a.prog = 0;
      if (a.path.length) a.hop = hopDays(S.nations[a.nat], a, a.path[0]); else a.retreat = false;
    }
  }
  const byProv = new Map();
  for (const a of S.armies) { if (a.prog > 0) continue; if (!byProv.has(a.prov)) byProv.set(a.prov, []); byProv.get(a.prov).push(a); }
  byProv.forEach((list, pid) => {
    if (inBattle(pid)) return;
    const nats = [...new Set(list.filter(a => !a.retreat).map(a => a.nat))];
    for (let i = 0; i < nats.length; i++) for (let j = i + 1; j < nats.length; j++) if (atWar(nats[i], nats[j])) {
      const p = S.P[pid], def = (p.ctrl === nats[j] || p.owner === nats[j]) ? nats[j] : nats[i], att = def === nats[i] ? nats[j] : nats[i];
      S.battles.push(newBattle(pid, att, def)); return;
    }
  });
  for (const b of S.battles.slice()) battleDay(b);
  byProv.forEach((list, pid) => {
    const p = S.P[pid]; if (inBattle(pid)) return;
    const ok = list.filter(a => !a.path.length && !a.retreat && mor(a) >= MORALE.siegeMin && siegeTarget(a.nat, p) && S.armies.includes(a));
    if (!ok.length) { if (p.siege && !list.some(a => a.nat === p.siege.nat)) p.siege = null; return; }
    const nat = ok[0].nat, tr = ok.filter(a => a.nat === nat).reduce((s, a) => s + a.troops, 0);
    if (tr < garrison(p)) { if (p.siege && p.siege.nat === nat) p.siege = null; return; }   // too small to besiege
    if (!p.siege || p.siege.nat !== nat) p.siege = { nat, prog: 0 };
    const n = S.nations[nat], defender = p.ctrl != null ? S.nations[p.ctrl] : null;
    let days = (p.owner == null ? D.balance.coloniseDays || 120 : 26) * (bio(p).siege || 1) * (has(n, 'artillery') ? .6 : 1) * (1 + .35 * p.b.fort);
    if (defender && defender.trait === 'mount') days *= 1.3;
    if (defender && has(defender, 'radar')) days *= 1.4;
    p.siege.prog += Math.min(1.4, tr / (garrison(p) * 3)) / days;
    ok.forEach(a => { if (a.nat === nat) a.troops *= .9993; });
    if (p.siege.prog >= 1) completeSiege(p, nat);
  });
}
// Free land can only be colonised if it touches your own territory: a land border, or a sea route from one of your coastal provinces.
export function canColonise(nid, p) {
  if (p.owner != null) return false;
  for (const q of p.landN) if (S.P[q].owner === nid) return true;
  for (const q of p.seaN) if (S.P[q].owner === nid) return true;
  const n = S.nations[nid];
  if (p.coastal && oceanOK(n)) { const lb = launchBodies(n); for (const b of oceans().bodiesOf[p.id]) if (lb.has(b)) return true; }
  return false;
}
export function siegeTarget(nid, p) {
  if (p.owner == null) return canColonise(nid, p);
  if (p.owner === nid) return p.ctrl !== nid && p.ctrl != null && atWar(nid, p.ctrl);
  return atWar(nid, p.ctrl);
}
function completeSiege(p, nid) {
  const n = S.nations[nid]; p.siege = null; S.mapVersion++;
  if (p.owner == null) {
    p.owner = nid; p.ctrl = nid; nameProvince(p, n);
    log(`${N(n)} annexes the free province of ${PN(p)}.`, null, 2);
    if (n.you) { S.st.settled = (S.st.settled || 0) + 1; if (S.st.settled >= 5) unlockMedal('settler'); }
    return;
  }
  if (p.owner === nid) { p.ctrl = nid; log(`${N(n)} liberates ${PN(p)}.`, null, 3); return; }
  p.ctrl = nid;
  const owner = S.nations[p.owner], isCap = p.id === owner.cap;
  log(`${N(n)} occupies ${PN(p)}${isCap ? `, the capital of ${N(owner)}` : ''}.`, null, isCap ? 6 : 3);
}
// ---------- Battles ----------
// Battles run day by day. Each side forms a front row and a back row of equal size; the front row is half the army,
// capped by the battlefield width: the bigger army can overlap the smaller one two to one, less in forests, hills and
// mountains. Anyone left over waits in reserve. Swordsmen take the front, spearmen the back; whoever is left over fills the other row badly.
// 1 swordsman : 1 spearman fills both rows with the right troops. Damage hits the front row hardest.
export const BATTLE = { pow: { fSw: 1, fSp: .6, bSp: .8, bSw: .2 }, cas: .03, frontShare: .75, spearFrontHit: 1.3, morPerCas: 4, morDaily: .01, beaten: .05, maxDays: 20, pursuit: .1 };
export function formation(N, mix, width) {
  const sw = N * mix, sp = N - sw, F = Math.min(N / 2, width ?? N / 2);
  const fSw = Math.min(sw, F), fSp = Math.min(sp, F - fSw), bSp = Math.min(sp - fSp, F), bSw = Math.min(sw - fSw, F - bSp);
  return { F, fSw, fSp, bSp, bSw, res: Math.max(0, N - fSw - fSp - bSp - bSw) };
}
export const formPower = f => f.fSw * BATTLE.pow.fSw + f.fSp * BATTLE.pow.fSp + f.bSp * BATTLE.pow.bSp + f.bSw * BATTLE.pow.bSw;
// How well a mix fights compared with the ideal 1:1 (1 = ideal).
export const mixEff = mix => formPower(formation(1, mix)) / formPower(formation(1, .5));
const sideOf = (pid, nat) => S.armies.filter(a => a.prov === pid && a.nat === nat && a.prog === 0 && !a.retreat);
function sideStats(L) {
  const N = L.reduce((s, a) => s + a.troops, 0);
  return { L, N, mix: N ? L.reduce((s, a) => s + a.troops * mixOf(a), 0) / N : .5, mor: N ? L.reduce((s, a) => s + a.troops * mor(a), 0) / N : 0 };
}
function newBattle(pid, att, def) {
  const A = sideStats(sideOf(pid, att)), Dd = sideStats(sideOf(pid, def));
  return { prov: pid, a: att, b: def, day: 0, start: S.day, cas: { a: 0, b: 0 }, m0: { a: A.mor, b: Dd.mor }, n0: { a: A.N, b: Dd.N } };
}
// Live view of a battle for the UI: both sides' rows, morale and losses so far.
export function battleView(b) {
  const p = S.P[b.prov], A = sideStats(sideOf(b.prov, b.a)), Dd = sideStats(sideOf(b.prov, b.b)), width = Math.min(A.N, Dd.N) * bio(p).width;
  return { b, width, a: { ...A, f: formation(A.N, A.mix, width) }, d: { ...Dd, f: formation(Dd.N, Dd.mix, width) } };
}
// Take casualties: most land on the front row (spearmen in front suffer more), the rest on the back row.
function takeLosses(side, f, cas) {
  const front = f.fSw + f.fSp, back = f.bSp + f.bSw;
  const fc = front > 0 ? cas * (back > 0 ? BATTLE.frontShare : 1) : 0, bc = cas - fc;
  const wF = f.fSw + f.fSp * BATTLE.spearFrontHit;
  let swL = wF > 0 ? fc * f.fSw / wF : 0, spL = wF > 0 ? fc * f.fSp * BATTLE.spearFrontHit / wF : 0;
  if (back > 0) { swL += bc * f.bSw / back; spL += bc * f.bSp / back; }
  const SW = side.N * side.mix, SP = side.N - SW;
  swL = Math.min(swL, SW); spL = Math.min(spL, SP);
  for (const a of side.L) {
    const aSw = a.troops * mixOf(a), aSp = a.troops - aSw;
    const nSw = aSw - (SW > 0 ? swL * aSw / SW : 0), nSp = aSp - (SP > 0 ? spL * aSp / SP : 0);
    a.troops = Math.max(0, nSw + nSp); a.mix = a.troops > 0 ? nSw / a.troops : .5;
  }
  return swL + spL;
}
function battleDay(b) {
  const p = S.P[b.prov], at = S.nations[b.a], de = S.nations[b.b];
  const A = sideStats(sideOf(b.prov, b.a)), Dd = sideStats(sideOf(b.prov, b.b));
  if (!A.N || !Dd.N) { S.battles = S.battles.filter(x => x !== b); return; }
  b.day++;
  const width = Math.min(A.N, Dd.N) * bio(p).width, fa = formation(A.N, A.mix, width), fd = formation(Dd.N, Dd.mix, width);
  const mf = m => .25 + .75 * m;   // a broken army fights at a quarter strength
  const defB = bio(p).def * (p.owner === b.b ? (1 + .08 * p.b.fort) * (has(de, 'radar') ? 1.2 : 1) : 1);
  const powA = formPower(fa) * quality(at) * mf(A.mor) * rnd(.85, 1.15);
  const powD = formPower(fd) * quality(de) * mf(Dd.mor) * rnd(.85, 1.15) * defB;
  const casA = takeLosses(A, fa, powD * BATTLE.cas), casD = takeLosses(Dd, fd, powA * BATTLE.cas);
  b.cas.a += casA; b.cas.b += casD;
  const hit = (side, cas) => { const loss = cas / Math.max(1, side.N) * BATTLE.morPerCas + BATTLE.morDaily; for (const a of side.L) a.mor = Math.max(0, mor(a) - loss); return Math.max(0, side.mor - loss); };
  const mA = hit(A, casA), mD = hit(Dd, casD);
  const aOut = mA <= BATTLE.beaten || A.N - casA < MIN_ARMY(), dOut = mD <= BATTLE.beaten || Dd.N - casD < MIN_ARMY();
  if (!aOut && !dOut && b.day < BATTLE.maxDays) return;
  const attWins = aOut === dOut ? mA > mD : dOut;
  endBattle(b, attWins ? at : de, attWins ? de : at, attWins ? Dd : A);
}
function endBattle(b, Wn, Ln, LS) {
  const p = S.P[b.prov]; S.battles = S.battles.filter(x => x !== b);
  const loserBroken = (Ln.id === b.a ? b.m0.a : b.m0.b) < MORALE.broken;
  let pursuit = 0;
  for (const a of LS.L) { const l = a.troops * BATTLE.pursuit; a.troops -= l; pursuit += l; a.mor = Math.min(mor(a), rnd(...MORALE.loseTo)); }
  const lLoss = (Ln.id === b.a ? b.cas.a : b.cas.b) + pursuit, wLoss = Wn.id === b.a ? b.cas.a : b.cas.b;
  const w = warBetween(b.a, b.b);
  if (w) { const side = w.a === Wn.id ? 'a' : 'b'; w.bs[side] = Math.min(40, w.bs[side] + clamp(Math.round(lLoss / (lLoss + wLoss) * 12), 3, 12)); }
  emit('battle', { prov: b.prov, you: Wn.you || Ln.you, b, winner: Wn.id });
  log(`Battle of ${PN(p)} (${b.day} day${b.day > 1 ? 's' : ''}): ${N(Wn)} defeats ${N(Ln)}. [[${Math.round(wLoss)} vs ${Math.round(lLoss)} dead]]`, null, (Wn.you || Ln.you) ? 5 : 3);
  if (loserBroken) { LS.L.forEach(a => { a.troops = 0; }); log(`${N(Ln)}'s army at ${PN(p)} was already broken and is destroyed.`, null, (Wn.you || Ln.you) ? 4 : 2); }
  else LS.L.forEach(a => retreat(a));
  S.armies = S.armies.filter(a => a.troops >= MIN_ARMY());
}
function retreat(a) {
  const n = S.nations[a.nat], q = [a.prov], prev = new Map([[a.prov, -1]]); let dest = null;
  for (let i = 0; i < q.length && dest == null; i++) for (const nx of edges(n, S.P[q[i]])) {
    if (prev.has(nx)) continue; const p = S.P[nx]; if (!canEnter(n.id, p)) continue; prev.set(nx, q[i]);
    if (p.ctrl === n.id && !S.armies.some(o => o.prov === nx && atWar(o.nat, n.id))) { dest = nx; break; }
    q.push(nx);
  }
  if (dest == null) { a.troops = 0; if (n.you) log(`With nowhere to retreat, your army at ${PN(S.P[a.prov])} surrenders.`, 'bad', 4); return; }
  orderMove(a, dest); a.retreat = true;
}
export function nukeReady(n) { return S.day - n.lastNuke > D.balance.nukeCooldownYears * YEAR; }
export function nuke(n, p) {
  n.lastNuke = S.day; p.devUntil = S.day + 8 * YEAR;
  const killed = p.pop * .6; p.pop -= killed; p.gdp *= .4; p.siege = null;
  S.armies.forEach(a => { if (a.prov === p.id && a.prog === 0) a.troops *= .3; }); S.armies = S.armies.filter(a => a.troops >= MIN_ARMY());
  const owner = p.owner != null ? S.nations[p.owner] : null;
  log(`${N(n)} launches a nuclear strike on ${PN(p)}${owner ? ` in ${N(owner)}` : ''}. ${fmtM(killed)} killed.`, 'bad', 10);
  if (owner) { const w = warBetween(n.id, owner.id); if (w) { const side = w.a === n.id ? 'a' : 'b'; w.bs[side] = Math.min(40, w.bs[side] + 15); } }
  emit('nuke', { prov: p.id });
  S.mapVersion++;
  if (n.you) unlockMedal('glass');
  if (owner && owner.alive && !owner.you && (owner.trait === 'nuke' || has(owner, 'nukes')) && S.day - owner.lastNuke > YEAR) nuke(owner, S.P[n.cap]);
}
const fmtM = m => Math.round(m * 1e6).toLocaleString('en-IE');

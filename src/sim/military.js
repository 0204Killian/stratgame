// Armies, movement, battles, sieges, nuclear strikes.
import { S, D, R, rnd, clamp, memo, YEAR, N, PN, log, emit, has, atWar, allied, warBetween, quality, garrison, isPort, unlockMedal } from './core.js';

export function makeArmy(n, provId, troops) {
  const a = { id: S.nextArmyId++, nat: n.id, troops: Math.max(0, troops), prov: provId, path: [], prog: 0, hop: 6, retreat: false, mor: MORALE.recruit };
  S.armies.push(a); return a;
}
// ---------- Morale (EU4-style) ----------
export const MORALE = { recruit: .5, siegeMin: .5, broken: .25, regenHome: .25, regenAway: .10, winLoss: [.15, .35], loseTo: [0, .1] };
export const mor = a => a.mor ?? 1;
// Add troops to an army: fresh recruits dilute its morale.
export function reinforce(a, troops, m = MORALE.recruit) {
  const t = a.troops + troops; if (t > 0) a.mor = (mor(a) * a.troops + m * troops) / t; a.troops = t;
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
  S.armies = S.armies.filter(a => a.troops >= 300);
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
  let d = 6; if (dest.res === 'mount') d += 4;
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
      S.battles.push({ prov: pid, a: att, b: def, days: 4 }); return;
    }
  });
  for (const b of S.battles.slice()) if (--b.days <= 0) { S.battles = S.battles.filter(x => x !== b); resolveBattle(b.prov, b.a, b.b); }
  byProv.forEach((list, pid) => {
    const p = S.P[pid]; if (inBattle(pid)) return;
    const ok = list.filter(a => !a.path.length && !a.retreat && mor(a) >= MORALE.siegeMin && siegeTarget(a.nat, p) && S.armies.includes(a));
    if (!ok.length) { if (p.siege && !list.some(a => a.nat === p.siege.nat)) p.siege = null; return; }
    const nat = ok[0].nat, tr = ok.filter(a => a.nat === nat).reduce((s, a) => s + a.troops, 0);
    if (tr < garrison(p)) { if (p.siege && p.siege.nat === nat) p.siege = null; return; }   // too small to besiege
    if (!p.siege || p.siege.nat !== nat) p.siege = { nat, prog: 0 };
    const n = S.nations[nat], defender = p.ctrl != null ? S.nations[p.ctrl] : null;
    let days = 26 * (p.res === 'mount' ? 1.6 : 1) * (has(n, 'artillery') ? .6 : 1) * (1 + .35 * p.b.fort);
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
    p.owner = nid; p.ctrl = nid;
    log(`${N(n)} annexes the free province of ${PN(p)}.`, null, 2);
    if (n.you) { S.st.settled = (S.st.settled || 0) + 1; if (S.st.settled >= 5) unlockMedal('settler'); }
    return;
  }
  if (p.owner === nid) { p.ctrl = nid; log(`${N(n)} liberates ${PN(p)}.`, null, 3); return; }
  p.ctrl = nid;
  const owner = S.nations[p.owner], isCap = p.id === owner.cap;
  log(`${N(n)} occupies ${PN(p)}${isCap ? `, the capital of ${N(owner)}` : ''}.`, null, isCap ? 6 : 3);
}
function resolveBattle(pid, attId, defId) {
  const p = S.P[pid];
  const A = S.armies.filter(a => a.prov === pid && a.nat === attId && a.prog === 0), Dd = S.armies.filter(a => a.prov === pid && a.nat === defId && a.prog === 0);
  if (!A.length || !Dd.length) return;
  const at = S.nations[attId], de = S.nations[defId];
  const ta = A.reduce((s, a) => s + a.troops, 0), td = Dd.reduce((s, a) => s + a.troops, 0);
  const avgMor = L => L.reduce((s, a) => s + mor(a) * a.troops, 0) / Math.max(1, L.reduce((s, a) => s + a.troops, 0));
  const ma = avgMor(A), md = avgMor(Dd), mf = m => .25 + .75 * m;   // a broken army fights at a quarter strength
  const sa = ta * quality(at) * mf(ma) * rnd(.8, 1.2);
  const sd = td * quality(de) * mf(md) * rnd(.8, 1.2) * (p.res === 'mount' ? 1.25 : 1) * (has(de, 'radar') && p.owner === defId ? 1.2 : 1) * (p.owner === defId ? 1 + .08 * p.b.fort : 1);
  const aWin = sa > sd, Wn = aWin ? at : de, Ln = aWin ? de : at, WA = aWin ? A : Dd, LA = aWin ? Dd : A, ratio = Math.min(sa, sd) / Math.max(sa, sd);
  const wl = rnd(.06, .14) * (.4 + ratio), ll = rnd(.3, .45);
  let wLoss = 0, lLoss = 0;
  WA.forEach(a => { const l = a.troops * wl; a.troops -= l; wLoss += l; a.mor = Math.max(0, mor(a) - rnd(...MORALE.winLoss) * (.5 + ratio)); });
  LA.forEach(a => { const l = a.troops * ll; a.troops -= l; lLoss += l; });
  const loserBroken = (aWin ? md : ma) < MORALE.broken;
  LA.forEach(a => { a.mor = rnd(...MORALE.loseTo); });
  const w = warBetween(attId, defId);
  if (w) { const side = w.a === Wn.id ? 'a' : 'b'; w.bs[side] = Math.min(40, w.bs[side] + clamp(Math.round(lLoss / (lLoss + wLoss) * 12), 3, 12)); }
  emit('battle', { prov: pid, you: Wn.you || Ln.you });
  log(`Battle of ${PN(p)}: ${N(Wn)} defeats ${N(Ln)}. [[${Math.round(wLoss + lLoss)} dead]]`, null, (Wn.you || Ln.you) ? 5 : 3);
  if (loserBroken) { LA.forEach(a => { a.troops = 0; }); log(`${N(Ln)}'s army at ${PN(p)} was already broken and is destroyed.`, null, (Wn.you || Ln.you) ? 4 : 2); }
  else LA.forEach(a => retreat(a));
  S.armies = S.armies.filter(a => a.troops >= 300);
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
  S.armies.forEach(a => { if (a.prov === p.id && a.prog === 0) a.troops *= .3; }); S.armies = S.armies.filter(a => a.troops >= 300);
  const owner = p.owner != null ? S.nations[p.owner] : null;
  log(`${N(n)} launches a nuclear strike on ${PN(p)}${owner ? ` in ${N(owner)}` : ''}. ${fmtM(killed)} killed.`, 'bad', 10);
  if (owner) { const w = warBetween(n.id, owner.id); if (w) { const side = w.a === n.id ? 'a' : 'b'; w.bs[side] = Math.min(40, w.bs[side] + 15); } }
  emit('nuke', { prov: p.id });
  S.mapVersion++;
  if (n.you) unlockMedal('glass');
  if (owner && owner.alive && !owner.you && (owner.trait === 'nuke' || has(owner, 'nukes')) && S.day - owner.lastNuke > YEAR) nuke(owner, S.P[n.cap]);
}
const fmtM = m => Math.round(m * 1e6).toLocaleString('en-IE');

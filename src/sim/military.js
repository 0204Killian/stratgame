// Armies, movement, battles, sieges, nuclear strikes.
import { S, D, R, rnd, clamp, memo, YEAR, N, PN, log, emit, has, atWar, allied, warBetween, quality, garrison, isPort, unlockMedal } from './core.js';

export function makeArmy(n, provId, troops) {
  const a = { id: S.nextArmyId++, nat: n.id, troops: Math.max(0, troops), prov: provId, path: [], prog: 0, hop: 6, retreat: false };
  S.armies.push(a); return a;
}
export function canEnter(nid, p) {
  if (p.owner == null) return true;
  if (p.owner === nid || p.ctrl === nid) return true;
  if (allied(nid, p.owner)) return true;
  return atWar(nid, p.owner) || atWar(nid, p.ctrl);
}
export const OVERRUN = 5;   // strength ratio at which the weaker side is wiped out in a day
// Supply: armies standing in land controlled by an enemy wither; a nation with no land of its own withers fast.
export function dailyAttrition() {
  const has1 = new Set(); for (const p of S.P) if (p.ctrl != null) has1.add(p.ctrl);
  for (const a of S.armies) {
    if (a.prog > 0) continue;
    const p = S.P[a.prov];
    if (!has1.has(a.nat)) a.troops *= 1 - .10 / 30;
    else if (p.ctrl != null && p.ctrl !== a.nat && atWar(a.nat, p.ctrl)) a.troops *= 1 - .02 / 30;
  }
  S.armies = S.armies.filter(a => a.troops >= 300);
}
export const seaOK = n => n.trait === 'navy' || has(n, 'carriers');
const hasPort = n => memo('port' + n.id, () => S.P.some(q => q.owner === n.id && q.ctrl === n.id && isPort(q)));
export function edges(n, p) {
  const out = p.landN.slice();
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
  let d = 6; if (S.P[to].res === 'mount') d += 4; if (!S.P[a.prov].landN.includes(to)) d *= 1.6;
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
      const str = id => list.filter(a => a.nat === id).reduce((s, a) => s + a.troops * quality(S.nations[id]), 0);
      const r = str(att) / Math.max(1, str(def));
      S.battles.push({ prov: pid, a: att, b: def, days: r >= OVERRUN || r <= 1 / OVERRUN ? 1 : 4 }); return;
    }
  });
  for (const b of S.battles.slice()) if (--b.days <= 0) { S.battles = S.battles.filter(x => x !== b); resolveBattle(b.prov, b.a, b.b); }
  byProv.forEach((list, pid) => {
    const p = S.P[pid]; if (inBattle(pid)) return;
    const ok = list.filter(a => !a.path.length && !a.retreat && siegeTarget(a.nat, p) && S.armies.includes(a));
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
  const sa = ta * quality(at) * rnd(.8, 1.2);
  const sd = td * quality(de) * rnd(.8, 1.2) * (p.res === 'mount' ? 1.25 : 1) * (has(de, 'radar') && p.owner === defId ? 1.2 : 1) * (p.owner === defId ? 1 + .08 * p.b.fort : 1);
  const aWin = sa > sd, Wn = aWin ? at : de, Ln = aWin ? de : at, WA = aWin ? A : Dd, LA = aWin ? Dd : A, ratio = Math.min(sa, sd) / Math.max(sa, sd);
  const wl = rnd(.06, .14) * (.4 + ratio), ll = rnd(.3, .45);
  let wLoss = 0, lLoss = 0;
  WA.forEach(a => { const l = a.troops * wl; a.troops -= l; wLoss += l; });
  LA.forEach(a => { const l = a.troops * ll; a.troops -= l; lLoss += l; });
  const w = warBetween(attId, defId);
  if (w) { const side = w.a === Wn.id ? 'a' : 'b'; w.bs[side] = Math.min(40, w.bs[side] + clamp(Math.round(lLoss / (lLoss + wLoss) * 12), 3, 12)); }
  emit('battle', { prov: pid, you: Wn.you || Ln.you });
  log(`Battle of ${PN(p)}: ${N(Wn)} defeats ${N(Ln)}. [[${Math.round(wLoss + lLoss)} dead]]`, null, (Wn.you || Ln.you) ? 5 : 3);
  if (ratio <= 1 / OVERRUN) { LA.forEach(a => { lLoss += a.troops; a.troops = 0; }); log(`${N(Ln)}'s army at ${PN(p)} is overrun and destroyed.`, null, (Wn.you || Ln.you) ? 4 : 2); }
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

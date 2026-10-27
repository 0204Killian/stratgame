// AI army orders. Each army re-plans once a week, staggered across the days so big maps don't stutter.
// Searches are limited to nearby provinces; armies with nothing in range head home.
import { S, quality, garrison, warsOf, enemyIn } from './core.js';
import { edges, canEnter, orderMove, siegeTarget } from './military.js';
import { provValue } from './diplomacy.js';

const MAX_DEPTH = 12;
function bfsDist(n, from) {
  const dist = new Map([[from, 0]]), q = [from];
  for (let i = 0; i < q.length; i++) {
    const c = q[i], d = dist.get(c); if (d >= MAX_DEPTH) continue;
    for (const nx of edges(n, S.P[c])) { if (dist.has(nx) || !canEnter(n.id, S.P[nx])) continue; dist.set(nx, d + 1); q.push(nx); }
  }
  return dist;
}

export function aiArmies() {
  const today = S.day % 7, bfsCache = new Map(), strength = new Map();
  for (const a of S.armies) {
    if ((a.id + today) % 7) continue;
    const n = S.nations[a.nat];
    if (n.you && !S.st.autoPlayer) continue;
    if (a.retreat || a.path.length) continue;
    const here = S.P[a.prov], ws = warsOf(n.id);
    const enemies = new Set(ws.map(w => enemyIn(w, n.id)));
    if (here.siege && here.siege.nat === a.nat && siegeTarget(a.nat, here)) {
      if (!S.armies.some(e => enemies.has(e.nat) && e.prov === a.prov)) continue;
    }
    const key = n.id + ':' + a.prov;
    let dist = bfsCache.get(key); if (!dist) { dist = bfsDist(n, a.prov); bfsCache.set(key, dist); }
    let best = null, bv = -1e9;
    if (ws.length) {
      const myStr = a.troops * quality(n);
      // enemy strength per province, computed once per nation this day
      let es = strength.get(n.id);
      if (!es) { es = new Map(); for (const e of S.armies) if (enemies.has(e.nat) && e.prog === 0) es.set(e.prov, (es.get(e.prov) || 0) + e.troops * quality(S.nations[e.nat])); strength.set(n.id, es); }
      for (const [pid, d] of dist) {
        const p = S.P[pid], danger = es.get(pid) || 0;
        let v = -1e9;
        if (danger > 0) { const ratio = myStr / (danger + 1); if (ratio >= 1.15 && d <= 5) v = 60 - d * 8 + Math.min(30, ratio * 5); }
        if (p.owner === n.id && p.ctrl !== n.id && enemies.has(p.ctrl)) v = Math.max(v, 70 - d * 7);
        else if (enemies.has(p.ctrl) && enemies.has(p.owner)) v = Math.max(v, 40 + provValue(p) - d * 7);
        if (v > -1e9 && danger > myStr * .9) v -= 200;
        if (v > bv) { bv = v; best = pid; }
      }
    } else {
      for (const [pid, d] of dist) {
        const p = S.P[pid];
        if (p.owner != null || d > 6 || a.troops < garrison(p) * 1.5) continue;
        const v = 30 - d * 5 + p.pop * 3; if (v > bv) { bv = v; best = pid; }
      }
    }
    if (best == null && a.prov !== n.cap && S.P[a.prov].owner !== n.id) best = n.cap;
    if (best != null && best !== a.prov) orderMove(a, best);
  }
}

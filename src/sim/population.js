// Dynamic population, Victoria 3 style: every province has a standard of living from food, firewood and work,
// and once a month people move. Inside a tribe, idle workers and their families leave provinces without work for
// provinces with open jobs, nearer ones first. Between tribes, people leave a hungry, cold or jobless tribe for a
// better-off neighbour that has work for them.
import { S, D, N, PN, log, emit, provsOf, atWar, clamp } from './core.js';
import { workforce, biome, ECON, setting } from './industry.js';

const family = () => 1 / D.balance.econ.workShare;   // a worker who moves brings their household
export const jobsWanted = p => ECON().reduce((s, k) => s + (p.b[k] ? p.b[k] * D.buildings[k].jobs * setting(p, k) : 0), 0);
export const vacancies = p => Math.max(0, jobsWanted(p) - workforce(p));
export const idleWorkers = p => Math.max(0, workforce(p) - jobsWanted(p));

// Standard of living 0..1: how well fed and warm people are (with what the land gives), and whether they have work.
export function livingStandard(n, p) {
  if (p.ctrl !== n.id) return .25;
  const food = Math.min(n.fed ?? 1, n.warm ?? 1), sat = food + (1 - food) * biome(p).sub;
  const wf = workforce(p), emp = wf > 0 ? Math.min(1, (p.work || 0) / wf) : 1;
  return sat * (.6 + .4 * emp);
}
export function tribeStandard(n) {
  let s = 0, w = 0; for (const p of provsOf(n)) { s += livingStandard(n, p) * p.pop; w += p.pop; }
  return w > 0 ? s / w : 0;
}

// ---------- inside a tribe ----------
export function migrateWithin(n) {
  const ps = provsOf(n).filter(p => p.ctrl === n.id);
  for (const p of ps) { p.migIn = 0; p.migOut = 0; }
  const src = ps.map(p => ({ p, idle: idleWorkers(p) })).filter(x => x.idle >= 1);
  const dst = ps.map(p => ({ p, vac: vacancies(p), sol: livingStandard(n, p) })).filter(x => x.vac >= 1);
  if (!src.length || !dst.length) return;
  const totalVac = dst.reduce((s, x) => s + x.vac, 0), want = src.reduce((s, x) => s + x.idle * .3, 0);
  const scale = Math.min(1, totalVac / Math.max(1e-9, want));
  const hop = Math.max(8, Math.sqrt(S.W * S.H / S.P.length)) * (S.CS || 8);   // about one province apart
  let moved = 0;
  for (const s of src) {
    const workers = s.idle * .3 * scale; if (workers < .5) continue;
    const ws = dst.filter(d => d.p !== s.p).map(d => ({ d, w: d.vac * (.5 + d.sol) / (1 + Math.hypot(d.p.cx - s.p.cx, d.p.cy - s.p.cy) / hop) }));
    const tw = ws.reduce((t, x) => t + x.w, 0); if (tw <= 0) continue;
    for (const { d, w } of ws) {
      const go = Math.min(workers * w / tw, d.vac); if (go < .05) continue;
      const people = Math.min(go * family(), s.p.pop * 1e6 * .3);
      s.p.pop -= people / 1e6; d.p.pop += people / 1e6; d.vac -= go;
      s.p.migOut += people; d.p.migIn += people; moved += people;
    }
  }
  n.migMoved = moved;
}

// ---------- between tribes ----------
const neighbourTribes = n => {
  const s = new Set();
  for (const p of S.P) if (p.owner === n.id) for (const q of p.landN) { const o = S.P[q].owner; if (o != null && o !== n.id) s.add(o); }
  return [...s].map(i => S.nations[i]).filter(x => x.alive);
};
export function migrateBetween() {
  const sol = new Map(); for (const n of S.nations) if (n.alive) { sol.set(n.id, tribeStandard(n)); n.emig = 0; n.immig = 0; }
  for (const n of S.nations) {
    if (!n.alive) continue;
    const my = sol.get(n.id), ps = provsOf(n).filter(p => p.ctrl === n.id);
    const people = ps.reduce((s, p) => s + p.pop * 1e6, 0); if (people < 50) continue;
    const idle = ps.reduce((s, p) => s + idleWorkers(p), 0), wf = ps.reduce((s, p) => s + workforce(p), 0);
    const push = clamp((.9 - my) * .04, 0, .02) + clamp((idle / Math.max(1, wf) - .3) * .02, 0, .005);
    if (push <= 0) continue;
    // better-off neighbours with work to offer, not at war with us
    const opts = neighbourTribes(n).filter(m => !atWar(m.id, n.id) && sol.get(m.id) > my + .08)
      .map(m => { const best = provsOf(m).filter(p => p.ctrl === m.id).map(p => ({ p, v: vacancies(p) })).sort((a, b) => b.v - a.v)[0]; return { m, best, gain: sol.get(m.id) - my }; })
      .filter(o => o.best && o.best.v >= 1).sort((a, b) => b.gain * b.best.v - a.gain * a.best.v);
    if (!opts.length) continue;
    const o = opts[0], leave = Math.min(people * push, o.best.v * family());
    if (leave < 1) continue;
    for (const p of ps) { const share = leave * p.pop * 1e6 / people; p.pop -= share / 1e6; p.migOut = (p.migOut || 0) + share; }
    o.best.p.pop += leave / 1e6; o.best.p.migIn = (o.best.p.migIn || 0) + leave;
    n.emig += leave; o.m.immig += leave;
    if (n.you && leave >= 5) log(`${Math.round(leave)} people leave ${N(n)} for a better life in ${N(o.m)}.`, 'bad', 3);
    if (o.m.you && leave >= 5) log(`${Math.round(leave)} people arrive in ${PN(o.best.p)} from ${N(n)}, looking for work.`, null, 2);
  }
}

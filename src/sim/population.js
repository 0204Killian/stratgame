// Dynamic population, Victoria 3 style: every province has a standard of living from food, firewood and income,
// and once a month people move. Workers are employed in buildings (on wages), farm the land for themselves
// (subsistence, a low income), or are idle. Idle workers and their families leave for provinces with open jobs,
// nearer and better paid ones first. Subsistence farmers stay on their land: only a trickle leaves, and only for jobs
// paying well above what the land gives them. That is why newly taken, undeveloped land keeps its people.
// Between tribes, people leave a hungry, cold or jobless tribe for a better-off neighbour that has work for them.
import { S, D, N, PN, log, emit, provsOf, atWar, clamp } from './core.js';
import { workforce, biome, ECON, setting, subsistenceCap, subsistenceWage } from './industry.js';

const E = () => D.balance.econ;
const family = () => 1 / E().workShare;   // a worker who moves brings their household
export const jobsWanted = p => ECON().reduce((s, k) => s + (p.b[k] ? p.b[k] * D.buildings[k].jobs * setting(p, k) : 0), 0);
export const vacancies = p => Math.max(0, jobsWanted(p) - workforce(p));
const unjobbed = p => Math.max(0, workforce(p) - jobsWanted(p));
export const subsistenceWorkers = p => Math.min(subsistenceCap(p), unjobbed(p));
export const idleWorkers = p => Math.max(0, unjobbed(p) - subsistenceCap(p));
// What a job in this province pays: its buildings' average wage, or the tribe's average where nobody works yet.
export const jobWage = (n, p) => p.work > 0 && p.wages > 0 ? p.wages / p.work : (n.avgWage || E().refWage);

// Standard of living 0..1: how well fed and warm people are (with what the land gives), and what they earn.
export function livingStandard(n, p) {
  if (p.ctrl !== n.id) return .25;
  const food = Math.min(n.fed ?? 1, n.warm ?? 1), sat = food + (1 - food) * biome(p).sub;
  const income = p.inc == null ? 1 : Math.min(1, p.inc / E().refWage);
  return sat * (.55 + .3 * income + .15 * (n.comfort ?? 0));
}
export function tribeStandard(n) {
  let s = 0, w = 0; for (const p of provsOf(n)) { s += livingStandard(n, p) * p.pop; w += p.pop; }
  return w > 0 ? s / w : 0;
}

// ---------- inside a tribe ----------
export function migrateWithin(n) {
  const ps = provsOf(n).filter(p => p.ctrl === n.id);
  for (const p of ps) { p.migIn = 0; p.migOut = 0; }
  const dst = ps.map(p => ({ p, vac: vacancies(p), wage: jobWage(n, p) })).filter(x => x.vac >= 1);
  if (!dst.length) { n.migMoved = 0; return; }
  const hop = Math.max(8, Math.sqrt(S.W * S.H / S.P.length)) * (S.CS || 8);   // about one province apart
  // who wants to go: the idle, and a few subsistence farmers lured by much better pay
  const src = [];
  for (const p of ps) {
    const sw = subsistenceWage(p), idle = idleWorkers(p) * E().idleMoveRate;
    const best = dst.filter(d => d.p !== p).reduce((m, d) => Math.max(m, d.wage), 0) / sw;
    let subs = 0;
    if (best >= E().subMoveGap) subs = Math.min(subsistenceWorkers(p) * E().subMoveRate * clamp((best - E().subMoveGap) / 2 + .25, 0, 1), p.pop * 1e6 * E().subMoveCap / family());
    if (idle >= .5) src.push({ p, workers: idle, minWage: 0 });
    if (subs >= .5) src.push({ p, workers: subs, minWage: sw * E().subMoveGap });
  }
  if (!src.length) { n.migMoved = 0; return; }
  const totalVac = dst.reduce((s, x) => s + x.vac, 0), want = src.reduce((s, x) => s + x.workers, 0);
  const scale = Math.min(1, totalVac / Math.max(1e-9, want));
  let moved = 0;
  for (const s of src) {
    const workers = s.workers * scale; if (workers < .5) continue;
    const ws = dst.filter(d => d.p !== s.p && d.vac >= 1 && d.wage >= s.minWage)
      .map(d => ({ d, w: d.vac * (d.wage / E().refWage) / (1 + Math.hypot(d.p.cx - s.p.cx, d.p.cy - s.p.cy) / hop) }));
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
    // what drives people abroad is hunger, cold and having nothing to do, not a modest living off the land
    const food = Math.min(n.fed ?? 1, n.warm ?? 1);
    const push = clamp((.95 - food) * .04, 0, .02) + clamp((idle / Math.max(1, wf) - .15) * .03, 0, .006);
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

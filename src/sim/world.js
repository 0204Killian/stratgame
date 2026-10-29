// Procedural world: a grid of land cells grouped into provinces. Scales from 48 to ~1,000 provinces.
import { S, D, R, pick, rnd, shuffle } from './core.js';

export const CS = 8; // world units per grid cell

function noiseField(W, H) {
  const f = new Float32Array(W * H);
  // continent-scale octave grows slowly with map size; finer octaves add coastline detail
  let gx = Math.max(6, Math.round(6 * Math.sqrt(W / 100))), amp = 1;
  while (gx <= W / 3) {
    const gy = Math.max(3, Math.round(gx * H / W));
    const g = new Float32Array((gx + 1) * (gy + 1)); for (let i = 0; i < g.length; i++) g[i] = R();
    for (let y = 0; y < H; y++) {
      const fy = y / (H - 1) * gy, iy = Math.min(gy - 1, Math.floor(fy)); let ty = fy - iy; ty = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < W; x++) {
        const fx = x / (W - 1) * gx, ix = Math.min(gx - 1, Math.floor(fx)); let tx = fx - ix; tx = tx * tx * (3 - 2 * tx);
        const a = g[iy * (gx + 1) + ix], b = g[iy * (gx + 1) + ix + 1], c = g[(iy + 1) * (gx + 1) + ix], d = g[(iy + 1) * (gx + 1) + ix + 1];
        f[y * W + x] += amp * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty);
      }
    }
    gx *= 2; amp *= .48;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const dx = (x / W - .5) * 2, dy = (y / H - .5) * 2; f[y * W + x] -= .6 * Math.max(0, Math.hypot(dx, dy) - .4); }
  return f;
}

export function genWorld(size, nationCount) {
  const cfg = D.balance.mapSizes[size] || D.balance.mapSizes.small;
  const [W, H] = cfg.grid, k = cfg.provinces;
  const nb4 = i => { const x = i % W, y = (i / W) | 0, o = []; if (x > 0) o.push(i - 1); if (x < W - 1) o.push(i + 1); if (y > 0) o.push(i - W); if (y < H - 1) o.push(i + W); return o; };
  let L, keep, elev;
  for (let attempt = 0; attempt < 6; attempt++) {
    const f = elev = noiseField(W, H), sorted = Array.from(f).sort((a, b) => a - b), th = sorted[Math.floor(sorted.length * .55)];
    L = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) { const x = i % W, y = (i / W) | 0; L[i] = (f[i] > th && x > 1 && y > 1 && x < W - 2 && y < H - 2) ? 1 : 0; }
    const comp = new Int32Array(W * H).fill(-1), comps = [];
    for (let i = 0; i < W * H; i++) if (L[i] && comp[i] < 0) { const cells = [i]; comp[i] = comps.length; for (let q = 0; q < cells.length; q++) for (const j of nb4(cells[q])) if (L[j] && comp[j] < 0) { comp[j] = comps.length; cells.push(j); } comps.push(cells); }
    comps.sort((a, b) => b.length - a.length);
    keep = comps.filter(c => c.length >= 45).slice(0, 6 + Math.floor(k / 40));
    if (keep.length) break;
  }
  L.fill(0); keep.forEach(c => c.forEach(i => L[i] = 1));
  const all = keep.flat(), per = all.length / k;
  // Seeds: one per landmass, then spread out over the land using a minimum spacing (bucketed for speed).
  const seeds = [];
  const B = Math.max(4, Math.round(Math.sqrt(per))), bw = Math.ceil(W / B), bh = Math.ceil(H / B), buckets = Array.from({ length: bw * bh }, () => []);
  const addSeed = s => { seeds.push(s); buckets[Math.floor((s / W | 0) / B) * bw + Math.floor((s % W) / B)].push(s); };
  keep.forEach(c => addSeed(c[Math.floor(R() * c.length)]));
  const near = (s, r) => {
    const x = s % W, y = (s / W) | 0, bx = Math.floor(x / B), by = Math.floor(y / B), rb = Math.ceil(r / B);
    for (let yy = Math.max(0, by - rb); yy <= Math.min(bh - 1, by + rb); yy++) for (let xx = Math.max(0, bx - rb); xx <= Math.min(bw - 1, bx + rb); xx++)
      for (const t of buckets[yy * bw + xx]) if ((t % W - x) ** 2 + (((t / W) | 0) - y) ** 2 < r * r) return true;
    return false;
  };
  let r = Math.sqrt(per) * .95;
  const order = shuffle(all);
  while (seeds.length < k && r > 1) { for (const c of order) { if (seeds.length >= k) break; if (!near(c, r)) addSeed(c); } r *= .85; }
  const n = seeds.length;
  const G = new Int16Array(W * H).fill(-1), fronts = seeds.map((s, i) => { G[s] = i; return [s]; });
  let active = true;
  while (active) {
    active = false;
    for (let i = 0; i < n; i++) {
      const F = fronts[i]; let got = false;
      while (F.length && !got) {
        const idx = Math.floor(R() * F.length), c = F[idx], opts = nb4(c).filter(j => L[j] && G[j] < 0);
        if (!opts.length) { F[idx] = F[F.length - 1]; F.pop(); continue; }
        const j = pick(opts); G[j] = i; F.push(j); got = true; active = true;
      }
    }
  }
  S.W = W; S.H = H; S.CS = CS; S.mapSize = size;
  S.land = Array.from(L); S.reg = Array.from(G);
  const P = [];
  const b0 = () => Object.fromEntries(Object.keys(D.buildings).map(k => [k, 0]));
  for (let i = 0; i < n; i++) P.push({ id: i, name: '', named: false, cells: [], owner: null, ctrl: null, landN: [], seaN: [], pop: 0, gdp: 0, devUntil: -1, siege: null, b: b0(), set: {}, pm: {}, dep: [], build: null, biome: 'plains', res: null });
  const coastal = new Uint8Array(n), landSets = P.map(() => new Set());
  for (let i = 0; i < W * H; i++) {
    const p = S.reg[i]; if (p < 0) continue; P[p].cells.push(i);
    for (const j of nb4(i)) { const q = S.reg[j]; if (q >= 0 && q !== p) landSets[p].add(q); if (!S.land[j]) coastal[p] = 1; }
  }
  // Biomes: elevation from the landmass noise, moisture from a second field. Each province takes its cells' majority.
  const landIdx = []; for (let i = 0; i < W * H; i++) if (L[i] && G[i] >= 0) landIdx.push(i);
  const rankOf = vals => { const o = landIdx.slice().sort((a, b) => vals[a] - vals[b]), r = new Float32Array(W * H); o.forEach((c, k) => r[c] = k / o.length); return r; };
  const eR = rankOf(elev), mR = rankOf(noiseField(W, H)), votes = P.map(() => ({}));
  for (const i of landIdx) {
    const e = eR[i], m = mR[i];
    const b = e >= .9 ? 'mountains' : m < .17 ? 'desert' : e >= .72 ? 'hills' : m > .6 ? 'forest' : 'plains';
    const v = votes[G[i]]; v[b] = (v[b] || 0) + 1;
  }
  P.forEach((p, i) => {
    p.landN = [...landSets[i]]; p.coastal = !!coastal[i];
    p.biome = Object.entries(votes[i]).sort((a, b) => b[1] - a[1])[0]?.[0] || 'plains';
    p.res = p.coastal && R() < .3 ? 'port' : null;   // natural harbour
    // ore deposits: copper is common in hills and mountains, tin is rare everywhere
    const rough = p.biome === 'hills' || p.biome === 'mountains', r1 = R(), r2 = R();
    p.dep = []; if (r1 < (rough ? .35 : .05)) p.dep.push('copper'); if (r2 < (rough ? .1 : .025)) p.dep.push('tin');
    p.name = `Uncharted ${D.biomes[p.biome].n.toLowerCase()}`;
    let sx = 0, sy = 0; p.cells.forEach(c => { sx += c % W; sy += (c / W) | 0; }); sx /= p.cells.length; sy /= p.cells.length;
    let bc = p.cells[0], bd = 1e9; p.cells.forEach(c => { const d = (c % W - sx) ** 2 + (((c / W) | 0) - sy) ** 2; if (d < bd) { bd = d; bc = c; } });
    p.cx = bc % W * CS + CS / 2; p.cy = ((bc / W) | 0) * CS + CS / 2;
    // free land: some tiles empty, others home to a small group (fewer in desert and mountains)
    const [lo, hi] = D.balance.freePop, harsh = D.biomes[p.biome].y.farm > 0 ? 1 : .4;
    p.pop = R() < .3 ? 0 : Math.round(rnd(lo + 10, hi) * harsh) / 1e6; p.gdp = p.pop * rnd(2, 7);
  });
  // Sea routes: from each coastal province, flood the sea up to 12 cells and link any other coast reached.
  const MAXD = 12, dist = new Int16Array(W * H).fill(-1);
  for (const p of P) {
    if (!p.coastal) continue;
    const q = [], touched = [], found = new Set();
    for (const c of p.cells) for (const j of nb4(c)) if (!S.land[j] && dist[j] < 0) { dist[j] = 1; q.push(j); touched.push(j); }
    for (let h = 0; h < q.length; h++) {
      const c = q[h], d = dist[c];
      for (const j of nb4(c)) {
        if (S.land[j]) { const o = S.reg[j]; if (o >= 0 && o !== p.id) found.add(o); continue; }
        if (dist[j] >= 0 || d >= MAXD) continue;
        dist[j] = d + 1; q.push(j); touched.push(j);
      }
    }
    for (const t of touched) dist[t] = -1;
    for (const o of found) if (!p.landN.includes(o) && !p.seaN.includes(o)) { p.seaN.push(o); P[o].seaN.push(p.id); }
  }
  S.P = P;
  // Starting tiles: one per tribe, spread far apart, on land where farming, forestry and quarrying are all possible.
  const ok = p => D.biomes[p.biome].y.farm > 0 && D.biomes[p.biome].y.forestry > 0;
  const cand = P.filter(p => ok(p) && p.landN.length >= 1), pool = cand.length >= nationCount ? cand : P.filter(ok);
  const caps = [], cd = new Float64Array(n).fill(1e18);
  const updC = c => { for (const p of P) { const d = (p.cx - P[c].cx) ** 2 + (p.cy - P[c].cy) ** 2; if (d < cd[p.id]) cd[p.id] = d; } };
  const first = pick(pool.length ? pool : P); caps.push(first.id); updC(first.id);
  while (caps.length < nationCount) {
    let bi = -1, bv = -1;
    for (const p of pool) { if (caps.includes(p.id)) continue; const v = cd[p.id] * rnd(.85, 1); if (v > bv) { bv = v; bi = p.id; } }
    if (bi < 0) break; caps.push(bi); updC(bi);
  }
  S.slots = caps.map(c => [c]);
  S.mapVersion++;
}

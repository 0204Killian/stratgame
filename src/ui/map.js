// Political map renderer with a zoom/pan camera. Built in layers so it scales to ~1,000 provinces:
//   terrain  - sea, shallows, sea routes: drawn once per world
//   base     - province colours (via a 1-pixel-per-cell image), occupation, borders, icons: rebuilt when the map changes
//   overlay  - selection, sieges, battles, routes, armies, labels: drawn every frame
import { S, D, devastated, inBattle, mor, MORALE } from '../sim/game.js';
import { kfmt } from './format.js';

const SEA = '#15344a', INK = '#0b1620', FREE = [143, 136, 115], FREE2 = [133, 126, 106];
export const BUILD_COL = { fort: '#d6cfb8', harbour: '#5dd6e0' };

const rgbCache = new Map();
function hexRgb(h) { let c = rgbCache.get(h); if (!c) { const v = parseInt(h.slice(1), 16); c = [v >> 16 & 255, v >> 8 & 255, v & 255]; rgbCache.set(h, c); } return c; }
const shadeRgb = (c, f) => c.map(x => Math.round(f >= 0 ? x + (255 - x) * f : x * (1 + f)));

// Terrain badge: a ring in the biome's colour with a small glyph.
export function drawBiome(c, k, x, y, r, dim) {
  const col = (D.biomes[k] || D.biomes.plains).c;
  c.save(); c.globalAlpha = dim ? .45 : 1;
  c.beginPath(); c.arc(x, y, r, 0, 7); c.fillStyle = INK; c.fill(); c.lineWidth = r / 7; c.strokeStyle = col; c.stroke();
  const s = r / 12; c.fillStyle = col; c.strokeStyle = col; c.lineWidth = 2 * s; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath();
  if (k === 'plains') { for (const dx of [-4, 0, 4]) { c.moveTo(x + dx * s, y + 6 * s); c.lineTo(x + dx * s, y - 2 * s); } c.stroke(); c.beginPath(); for (const dx of [-4, 0, 4]) c.ellipse(x + dx * s, y - 4 * s, 1.6 * s, 3 * s, 0, 0, 7); c.fill(); }
  else if (k === 'forest') { c.moveTo(x, y - 8 * s); c.lineTo(x + 6 * s, y + 3 * s); c.lineTo(x - 6 * s, y + 3 * s); c.closePath(); c.fill(); c.beginPath(); c.moveTo(x, y + 3 * s); c.lineTo(x, y + 7 * s); c.stroke(); }
  else if (k === 'hills') { c.moveTo(x - 8 * s, y + 5 * s); c.quadraticCurveTo(x - 4 * s, y - 6 * s, x, y + 2 * s); c.quadraticCurveTo(x + 4 * s, y - 4 * s, x + 8 * s, y + 5 * s); c.closePath(); c.fill(); }
  else if (k === 'mountains') { c.moveTo(x - 7 * s, y + 5 * s); c.lineTo(x - 1 * s, y - 6 * s); c.lineTo(x + 2 * s, y - 1 * s); c.lineTo(x + 4 * s, y - 4 * s); c.lineTo(x + 8 * s, y + 5 * s); c.closePath(); c.fill(); }
  else if (k === 'desert') { c.lineWidth = 2.6 * s; c.moveTo(x, y - 7 * s); c.lineTo(x, y + 7 * s); c.moveTo(x, y + 1 * s); c.lineTo(x - 4 * s, y + 1 * s); c.lineTo(x - 4 * s, y - 3 * s); c.moveTo(x, y - 1 * s); c.lineTo(x + 4 * s, y - 1 * s); c.lineTo(x + 4 * s, y - 5 * s); c.stroke(); }   // cactus
  c.restore();
}
function drawAnchor(c, x, y, r) {
  const s = r / 12; c.save(); c.beginPath(); c.arc(x, y, r, 0, 7); c.fillStyle = INK; c.fill();
  c.strokeStyle = '#5dd6e0'; c.lineWidth = 2 * s; c.lineCap = 'round'; c.beginPath();
  c.moveTo(x, y - 6 * s); c.lineTo(x, y + 6 * s); c.moveTo(x - 4 * s, y - 3 * s); c.lineTo(x + 4 * s, y - 3 * s); c.moveTo(x - 6 * s, y + 1 * s); c.quadraticCurveTo(x, y + 10 * s, x + 6 * s, y + 1 * s); c.stroke(); c.restore();
}
const mixRgb = (a, b, t) => a.map((x, i) => Math.round(x * (1 - t) + b[i] * t));

export class MapView {
  constructor(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d');
    this.base = document.createElement('canvas'); this.bg = this.base.getContext('2d');
    this.terrain = document.createElement('canvas'); this.tg = this.terrain.getContext('2d');
    this.fill = document.createElement('canvas'); this.fg = this.fill.getContext('2d');
    this.zoom = 1; this.cx = 400; this.cy = 280; this.dpr = 1; this.cw = 1; this.ch = 1; this.WW = 800; this.WH = 560;
    this.ver = -1; this.worldKey = ''; this.flashes = []; this.hits = []; this.patterns = {}; this.outlines = new Map(); this.lastBase = 0;
  }
  // ---------- camera ----------
  resize() {
    const r = this.c.getBoundingClientRect(); this.dpr = window.devicePixelRatio || 1;
    this.cw = Math.max(1, r.width); this.ch = Math.max(1, r.height);
    this.c.width = Math.round(this.cw * this.dpr); this.c.height = Math.round(this.ch * this.dpr);
    this.limits(); this.clampCam();
  }
  limits() { const fit = Math.min(this.cw / this.WW, this.ch / this.WH); this.minZoom = fit * .85; this.maxZoom = Math.max(fit * 8, 6); }
  fit() { this.zoom = Math.min(this.cw / this.WW, this.ch / this.WH) * .97; this.cx = this.WW / 2; this.cy = this.WH / 2; this.clampCam(); }
  fitRect(x0, y0, w, h) { this.zoom = Math.min(w / this.WW, h / this.WH) * .95; this.clampCam(); this.cx = this.WW / 2 - (x0 + w / 2 - this.cw / 2) / this.zoom; this.cy = this.WH / 2 - (y0 + h / 2 - this.ch / 2) / this.zoom; this.clampCam(); }
  clampCam() {
    this.zoom = Math.max(this.minZoom || .05, Math.min(this.maxZoom || 20, this.zoom));
    const hw = this.cw / 2 / this.zoom, hh = this.ch / 2 / this.zoom, WW = this.WW, WH = this.WH;
    this.cx = hw * 2 >= WW ? Math.max(WW - hw, Math.min(hw, this.cx)) : Math.max(hw, Math.min(WW - hw, this.cx));
    this.cy = hh * 2 >= WH ? Math.max(WH - hh, Math.min(hh, this.cy)) : Math.max(hh, Math.min(WH - hh, this.cy));
  }
  toWorld(sx, sy) { return [(sx - this.cw / 2) / this.zoom + this.cx, (sy - this.ch / 2) / this.zoom + this.cy]; }
  toScreen(wx, wy) { return [(wx - this.cx) * this.zoom + this.cw / 2, (wy - this.cy) * this.zoom + this.ch / 2]; }
  zoomAt(sx, sy, f) { const [wx, wy] = this.toWorld(sx, sy); this.zoom *= f; this.clampCam(); this.cx = wx - (sx - this.cw / 2) / this.zoom; this.cy = wy - (sy - this.ch / 2) / this.zoom; this.clampCam(); }
  pan(dx, dy) { this.cx -= dx / this.zoom; this.cy -= dy / this.zoom; this.clampCam(); }
  centerOn(wx, wy, zoomTo) { if (zoomTo) this.zoom = Math.max(this.zoom, zoomTo); this.cx = wx; this.cy = wy; this.clampCam(); }
  provAt(sx, sy) {
    const [wx, wy] = this.toWorld(sx, sy), x = Math.floor(wx / S.CS), y = Math.floor(wy / S.CS);
    if (x < 0 || y < 0 || x >= S.W || y >= S.H) return -1; return S.reg[y * S.W + x];
  }
  // returns the counter under the cursor: { a: first army, ids: every army in that stack }
  armyAt(sx, sy) { for (let i = this.hits.length - 1; i >= 0; i--) { const h = this.hits[i]; if (sx >= h.x0 && sx <= h.x1 && sy >= h.y0 && sy <= h.y1) return h; } return null; }
  flash(prov, kind) { this.flashes.push({ prov, kind, t0: performance.now() }); }

  // ---------- static world data (once per world) ----------
  prepareWorld() {
    const W = S.W, H = S.H, CS = S.CS;
    this.WW = W * CS; this.WH = H * CS;
    this.cellPx = Math.max(8, Math.min(24, Math.floor(5200 / W)));
    this.BS = this.cellPx / CS;
    const s = this.cellPx;
    this.base.width = this.terrain.width = W * s; this.base.height = this.terrain.height = H * s;
    this.fill.width = W; this.fill.height = H;
    this.img = this.fg.createImageData(W, H);
    // terrain: sea, shallows, grid, sea routes
    const g = this.tg; g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = SEA; g.fillRect(0, 0, this.terrain.width, this.terrain.height);
    g.strokeStyle = 'rgba(255,255,255,.035)'; g.lineWidth = 1; g.beginPath();
    const step = 5 * s; for (let y = 0; y <= H * s; y += step) { g.moveTo(0, y + .5); g.lineTo(W * s, y + .5); } for (let x = 0; x <= W * s; x += step) { g.moveTo(x + .5, 0); g.lineTo(x + .5, H * s); } g.stroke();
    // distance-to-land for shallows (two passes of a cheap chamfer)
    const dist = new Uint8Array(W * H).fill(9);
    for (let i = 0; i < W * H; i++) if (S.land[i]) dist[i] = 0;
    for (let pass = 0; pass < 2; pass++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1); if (y > 0) d = Math.min(d, dist[i - W] + 1); if (x < W - 1) d = Math.min(d, dist[i + 1] + 1); if (y < H - 1) d = Math.min(d, dist[i + W] + 1);
      dist[i] = d;
    }
    for (let i = 0; i < W * H; i++) { const d = dist[i]; if (d > 0 && d <= 3) { g.fillStyle = d <= 1 ? '#1f4e6b' : d === 2 ? '#1c4862' : '#1a425b'; g.fillRect((i % W) * s, ((i / W) | 0) * s, s, s); } }
    g.setLineDash([3 * this.BS, 5 * this.BS]); g.strokeStyle = 'rgba(232,236,228,.22)'; g.lineWidth = Math.max(1, .8 * this.BS); g.beginPath();
    for (const p of S.P) for (const q of p.seaN) if (q > p.id) { g.moveTo(p.cx * this.BS, p.cy * this.BS); g.lineTo(S.P[q].cx * this.BS, S.P[q].cy * this.BS); }
    g.stroke(); g.setLineDash([]);
    // border segments between cells, in base pixels: [x1,y1,x2,y2,provA,provB]; provB = -1 for coast
    const segs = [], coast = new Path2D();
    for (let i = 0; i < W * H; i++) {
      const r = S.reg[i]; if (r < 0) continue; const x = i % W, y = (i / W) | 0;
      const right = x < W - 1 ? S.reg[i + 1] : -1, down = y < H - 1 ? S.reg[i + W] : -1;
      if (right !== r) { if (right < 0) { coast.moveTo((x + 1) * s, y * s); coast.lineTo((x + 1) * s, (y + 1) * s); } else segs.push((x + 1) * s, y * s, (x + 1) * s, (y + 1) * s, r, right); }
      if (down !== r) { if (down < 0) { coast.moveTo(x * s, (y + 1) * s); coast.lineTo((x + 1) * s, (y + 1) * s); } else segs.push(x * s, (y + 1) * s, (x + 1) * s, (y + 1) * s, r, down); }
      if (x === 0 || S.reg[i - 1] < 0) { coast.moveTo(x * s, y * s); coast.lineTo(x * s, (y + 1) * s); }
      if (y === 0 || S.reg[i - W] < 0) { coast.moveTo(x * s, y * s); coast.lineTo((x + 1) * s, y * s); }
    }
    this.segs = Float32Array.from(segs); this.coastPath = coast;
    this.cellPaths = new Map(); this.outlines.clear(); this.patterns = {};
    this.limits();
  }
  cellPath(pid) {
    let p = this.cellPaths.get(pid); if (p) return p;
    p = new Path2D(); const W = S.W, s = this.cellPx; for (const i of S.P[pid].cells) p.rect((i % W) * s, ((i / W) | 0) * s, s, s);
    this.cellPaths.set(pid, p); return p;
  }
  pattern(col) {
    if (this.patterns[col]) return this.patterns[col];
    const n = Math.max(8, Math.round(this.cellPx * .6)), pc = document.createElement('canvas'); pc.width = pc.height = n; const g = pc.getContext('2d');
    g.strokeStyle = col; g.lineWidth = n / 3; g.beginPath(); for (const o of [-n, 0, n]) { g.moveTo(o - 1, n + 1); g.lineTo(o + n + 1, -1); } g.stroke();
    return this.patterns[col] = this.bg.createPattern(pc, 'repeat');
  }

  // ---------- base layer ----------
  ensureWorld() { const key = `${S.seed}:${S.W}:${S.H}:${S.P.length}`; if (key !== this.worldKey || !this.segs) { this.worldKey = key; this.prepareWorld(); return true; } return false; }
  renderBase(setup, mode) {
    this.ensureWorld(); this.mode = mode;
    const g = this.bg, s = this.cellPx, BS = this.BS, W = S.W, H = S.H;
    g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = false;
    g.drawImage(this.terrain, 0, 0);
    // province colours via one pixel per cell, scaled up
    const slotOf = new Map();
    if (setup) S.slots.forEach((sl, i) => { if (i >= S.nations.length) sl.forEach(id => slotOf.set(id, true)); });
    const biomeCol = p => hexRgb((D.biomes[p.biome] || D.biomes.plains).c);
    const cols = S.P.map(p => {
      const shade = ((p.id * 37) % 7 - 3) * .025;
      if (mode === 'terrain') return shadeRgb(biomeCol(p), shade);
      if (p.owner != null) return shadeRgb(hexRgb(S.nations[p.owner].color), shade);
      if (slotOf.has(p.id)) return slotOf.get(p.id) ? [228, 180, 90] : [163, 155, 130];
      return shadeRgb(mixRgb(FREE, biomeCol(p), .35), shade);   // free land hints at its terrain
    });
    const d = this.img.data;
    for (let i = 0, o = 0; i < W * H; i++, o += 4) { const r = S.reg[i]; if (r < 0) { d[o + 3] = 0; continue; } const c = cols[r]; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; }
    this.fg.putImageData(this.img, 0, 0);
    g.drawImage(this.fill, 0, 0, W * s, H * s);
    g.imageSmoothingEnabled = true;
    // occupation stripes and devastation
    for (const p of S.P) {
      const occ = p.ctrl != null && p.ctrl !== p.owner, dev = devastated(p);
      if (!occ && !dev) continue;
      g.save(); g.clip(this.cellPath(p.id));
      if (occ) { g.fillStyle = this.pattern(S.nations[p.ctrl].color); g.fillRect(0, 0, this.base.width, this.base.height); }
      if (dev) {
        const left = (p.devUntil - S.day) / (8 * 360); g.fillStyle = `rgba(20,10,6,${.3 + .45 * left})`; g.fillRect(0, 0, this.base.width, this.base.height);
        g.fillStyle = `rgba(239,116,87,${.3 + .5 * left})`; for (const i of p.cells) if (((i % W) * 3 + ((i / W) | 0) * 5) % 11 === 0) g.fillRect((i % W) * s + s * .3, ((i / W) | 0) * s + s * .3, s * .4, s * .4);
      }
      g.restore();
    }
    // borders: heavy between different owners, light inside a nation
    const heavy = new Path2D(), light = new Path2D(), sg = this.segs, own = S.P.map(p => p.owner == null ? -1 - p.id : p.owner);
    for (let i = 0; i < sg.length; i += 6) { const path = own[sg[i + 4]] !== own[sg[i + 5]] ? heavy : light; path.moveTo(sg[i], sg[i + 1]); path.lineTo(sg[i + 2], sg[i + 3]); }
    g.lineCap = 'square';
    g.strokeStyle = 'rgba(11,22,32,.35)'; g.lineWidth = Math.max(1, .5 * BS); g.stroke(light);
    g.strokeStyle = INK; g.lineWidth = Math.max(2, 1.5 * BS); g.stroke(heavy);
    g.lineWidth = Math.max(2, 1.2 * BS); g.stroke(this.coastPath);
    // resources, buildings, capitals
    for (const p of S.P) {
      drawBiome(g, p.biome, p.cx * BS, (p.cy + 13) * BS, 7 * BS, devastated(p));
      if (p.res === 'port') drawAnchor(g, (p.cx - 13) * BS, (p.cy + 13) * BS, 5 * BS);
      let x = (p.cx + 10) * BS; const y = (p.cy + 8) * BS;
      for (const k of Object.keys(BUILD_COL)) for (let i = 0; i < p.b[k]; i++) { g.fillStyle = INK; g.fillRect(x - BS, y - BS, 7 * BS, 12 * BS); g.fillStyle = BUILD_COL[k]; g.fillRect(x, y, 5 * BS, 10 * BS); x += 6 * BS; }
      if (p.build) { g.strokeStyle = '#f2b134'; g.lineWidth = BS; g.setLineDash([BS * 1.5, BS * 1.5]); g.strokeRect(x, y, 5 * BS, 10 * BS); g.setLineDash([]); }
    }
    this.labels = [];
    const acc = new Map();
    for (const p of S.P) { if (p.owner == null) continue; let a = acc.get(p.owner); if (!a) acc.set(p.owner, a = [0, 0, 0]); a[0] += p.cx * p.cells.length; a[1] += p.cy * p.cells.length; a[2] += p.cells.length; }
    for (const n of S.nations) {
      const a = acc.get(n.id); if (!n.alive || !a) continue;
      this.labels.push({ t: n.name.toUpperCase(), x: a[0] / a[2], y: a[1] / a[2] - 2, size: 6 + Math.sqrt(a[2]) * .9, you: n.you, cells: a[2] });
      const cp = S.P[n.cap]; this.star(g, cp.cx * BS, (cp.cy - 5) * BS, 4.2 * BS, n.you ? '#ffd27a' : '#f4f6f1');
    }
    this.labels.sort((a, b) => b.cells - a.cells);
    if (setup) for (const sl of S.slots) { const p = S.P[sl[0]]; this.star(g, p.cx * BS, (p.cy - 5) * BS, 4.2 * BS, '#ffd27a'); }   // possible starting tiles
    this.ver = S.mapVersion; this.lastBase = performance.now();
  }
  star(g, x, y, r, col) {
    g.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * .45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath();
    g.fillStyle = col; g.fill(); g.lineWidth = r * .3; g.strokeStyle = INK; g.stroke();
  }
  outline(pid) {
    if (this.outlines.has(pid)) return this.outlines.get(pid);
    const path = new Path2D(), W = S.W, H = S.H, c = S.CS;
    for (const i of S.P[pid].cells) {
      const x = i % W, y = (i / W) | 0;
      if (x >= W - 1 || S.reg[i + 1] !== pid) { path.moveTo((x + 1) * c, y * c); path.lineTo((x + 1) * c, (y + 1) * c); }
      if (x <= 0 || S.reg[i - 1] !== pid) { path.moveTo(x * c, y * c); path.lineTo(x * c, (y + 1) * c); }
      if (y >= H - 1 || S.reg[i + W] !== pid) { path.moveTo(x * c, (y + 1) * c); path.lineTo((x + 1) * c, (y + 1) * c); }
      if (y <= 0 || S.reg[i - W] !== pid) { path.moveTo(x * c, y * c); path.lineTo((x + 1) * c, y * c); }
    }
    this.outlines.set(pid, path); return path;
  }
  armyPos(a) {
    const p = S.P[a.prov]; if (!a.path.length || a.prog <= 0) return [p.cx, p.cy];
    const q = S.P[a.path[0]], t = Math.min(1, a.prog); return [p.cx + (q.cx - p.cx) * t, p.cy + (q.cy - p.cy) * t];
  }

  // ---------- per frame ----------
  draw(now, ui) {
    if (!S || !S.P.length) return;
    const stale = this.ver !== S.mapVersion;
    if (ui.forceBase || this.mode !== ui.mapMode || (stale && now - this.lastBase > 150) || this.worldKey !== `${S.seed}:${S.W}:${S.H}:${S.P.length}`) { this.renderBase(ui.setup, ui.mapMode); ui.forceBase = false; }
    const g = this.g, dpr = this.dpr, z = this.zoom * dpr, lw = 1 / this.zoom;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = SEA; g.fillRect(0, 0, this.c.width, this.c.height);
    g.setTransform(z, 0, 0, z, dpr * (this.cw / 2 - this.cx * this.zoom), dpr * (this.ch / 2 - this.cy * this.zoom));
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(this.base, 0, 0, this.WW, this.WH);
    // world bounds for culling
    const [vx0, vy0] = this.toWorld(-40, -40), [vx1, vy1] = this.toWorld(this.cw + 40, this.ch + 40);
    const vis = p => p.cx >= vx0 && p.cx <= vx1 && p.cy >= vy0 && p.cy <= vy1;
    if (ui.hoverProv >= 0 && ui.hoverProv !== ui.selProv) { g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2 * lw; g.stroke(this.outline(ui.hoverProv)); }
    if (ui.selProv != null && ui.selProv >= 0) { g.strokeStyle = '#ffd27a'; g.lineWidth = 3.5 * lw; g.stroke(this.outline(ui.selProv)); }
    const ringW = Math.max(1, 1 / this.zoom);
    for (const p of S.P) {
      if (!p.siege || !vis(p)) continue; const n = S.nations[p.siege.nat];
      g.beginPath(); g.arc(p.cx, p.cy + 13, 10, 0, 7); g.strokeStyle = 'rgba(11,22,32,.85)'; g.lineWidth = Math.max(4.5, 6 * ringW); g.stroke();
      g.beginPath(); g.arc(p.cx, p.cy + 13, 10, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * Math.min(1, p.siege.prog)); g.strokeStyle = n.color; g.lineWidth = Math.max(3.2, 4 * ringW); g.stroke();
    }
    const pulse = .5 + .5 * Math.sin(now / 120), bs = Math.max(1, .9 / this.zoom);
    for (const b of S.battles) {
      const p = S.P[b.prov]; if (!vis(p)) continue; g.save(); g.translate(p.cx, p.cy - 4); g.scale(bs, bs);
      g.strokeStyle = `rgba(239,116,87,${.6 + .4 * pulse})`; g.lineWidth = 3.5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-8, -8); g.lineTo(8, 8); g.moveTo(8, -8); g.lineTo(-8, 8); g.stroke();
      g.beginPath(); g.arc(0, 0, 14 + pulse * 3, 0, 7); g.lineWidth = 1.5; g.stroke(); g.restore();
    }
    this.flashes = this.flashes.filter(f => now - f.t0 < (f.kind === 'nuke' ? 2500 : 900));
    for (const f of this.flashes) {
      const p = S.P[f.prov], t = (now - f.t0) / (f.kind === 'nuke' ? 2500 : 900);
      g.beginPath(); g.arc(p.cx, p.cy, f.kind === 'nuke' ? 20 + t * 70 : 10 + t * 18, 0, 7);
      g.strokeStyle = f.kind === 'nuke' ? `rgba(255,240,200,${1 - t})` : `rgba(239,116,87,${1 - t})`; g.lineWidth = f.kind === 'nuke' ? 6 : 3; g.stroke();
      if (f.kind === 'nuke' && t < .25) { g.fillStyle = `rgba(255,250,230,${.8 - t * 3})`; g.beginPath(); g.arc(p.cx, p.cy, 30, 0, 7); g.fill(); }
    }
    const selSet = ui.selArmies || new Set();
    for (const a of S.armies) {
      if (!a.path.length) continue; const n = S.nations[a.nat]; if (!n.you && !selSet.has(a.id)) continue;
      const sel = selSet.has(a.id), [sx, sy] = this.armyPos(a);
      g.setLineDash([6 * lw, 5 * lw]); g.strokeStyle = sel ? '#ffd27a' : 'rgba(255,210,122,.55)'; g.lineWidth = (sel ? 3 : 2) * lw;
      g.beginPath(); g.moveTo(sx, sy); for (const id of a.path) g.lineTo(S.P[id].cx, S.P[id].cy); g.stroke(); g.setLineDash([]);
      if (sel) { const e = S.P[a.path[a.path.length - 1]]; g.beginPath(); g.arc(e.cx, e.cy, 7 * lw, 0, 7); g.fillStyle = '#ffd27a'; g.fill(); }
    }
    // screen-space: nation names, province names, armies
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    const zr = this.zoom / (this.minZoom || 1), placed = [];
    for (const L of this.labels || []) {
      const [x, y] = this.toScreen(L.x, L.y); if (x < -200 || y < -50 || x > this.cw + 200 || y > this.ch + 50) continue;
      const px = Math.max(13, Math.min(44, L.size * this.zoom * .9));
      g.font = `700 ${px}px "Bahnschrift Condensed", "Bahnschrift", "Arial Narrow", Impact, sans-serif`;
      const w = g.measureText(L.t).width, box = [x - w / 2, y - px / 2, x + w / 2, y + px / 2];
      if (!L.you && placed.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      placed.push(box);
      g.globalAlpha = zr > 3 ? .5 : zr > 2.2 ? .75 : 1;
      g.lineWidth = Math.max(3, px * .16); g.strokeStyle = 'rgba(11,22,32,.85)'; g.strokeText(L.t, x, y);
      g.fillStyle = L.you ? '#ffd27a' : '#f4f6f1'; g.fillText(L.t, x, y);
    }
    g.globalAlpha = 1;
    if (this.zoom >= 1.6) {
      g.font = '600 12px "Segoe UI", system-ui, sans-serif';
      for (const p of S.P) {
        if (!vis(p) || !p.named) continue; let [x, y] = this.toScreen(p.cx, p.cy + 20); y += 9;
        g.lineWidth = 3; g.strokeStyle = 'rgba(11,22,32,.8)'; g.strokeText(p.name, x, y); g.fillStyle = 'rgba(244,246,241,.9)'; g.fillText(p.name, x, y);
      }
    }
    // armies: one counter per nation per province (with a count badge), moving armies drawn individually
    this.hits = [];
    const compact = this.zoom < 1.1, w = compact ? 40 : 58, h = compact ? 15 : 20, gap = compact ? 18 : 24;
    const groups = new Map(), singles = [];
    for (const a of S.armies) {
      if (a.path.length && a.prog > 0) { singles.push([a]); continue; }
      const k = a.nat + ':' + a.prov; let g0 = groups.get(k); if (!g0) groups.set(k, g0 = []); g0.push(a);
    }
    const list = [...groups.values(), ...singles].sort((x, y) => (S.nations[x[0].nat].you ? 1 : 0) - (S.nations[y[0].nat].you ? 1 : 0));
    const stack = new Map();
    g.font = `600 ${compact ? 10 : 13}px "Cascadia Mono", Consolas, "IBM Plex Mono", monospace`;
    for (const grp of list) {
      const a = grp[0], n = S.nations[a.nat], [wx, wy] = this.armyPos(a); let [x, y] = this.toScreen(wx, wy);
      const moving = a.path.length && a.prog > 0;
      if (!moving) { const k = stack.get(a.prov) || 0; stack.set(a.prov, k + 1); y -= (compact ? 11 : 16) + k * gap; } else y -= compact ? 11 : 16;
      if (x < -60 || y < -30 || x > this.cw + 60 || y > this.ch + 30) continue;
      const troops = grp.reduce((s, b) => s + b.troops, 0), sel = grp.some(b => selSet.has(b.id)), retreat = grp.every(b => b.retreat);
      g.globalAlpha = retreat ? .55 : 1;
      if (sel) { g.fillStyle = 'rgba(255,210,122,.35)'; g.fillRect(x - w / 2 - 5, y - h / 2 - 5, w + 10, h + 10); }
      g.fillStyle = INK; g.fillRect(x - w / 2 - 2, y - h / 2 - 2, w + 4, h + 4);
      g.fillStyle = n.color; g.fillRect(x - w / 2, y - h / 2, w, h);
      g.fillStyle = INK; g.fillRect(x - w / 2, y - h / 2, compact ? 4 : 7, h);
      { const m = grp.reduce((s, b) => s + mor(b) * b.troops, 0) / Math.max(1, troops), mh = h * m;   // morale bar
        g.fillStyle = m < MORALE.broken ? '#e05a47' : m < MORALE.siegeMin ? '#e8b14a' : '#7fd17a'; g.fillRect(x - w / 2 + 1, y + h / 2 - mh, (compact ? 4 : 7) - 2, mh); }
      if (n.you) { g.strokeStyle = '#ffd27a'; g.lineWidth = sel ? 3 : 2; g.strokeRect(x - w / 2 - 2, y - h / 2 - 2, w + 4, h + 4); }
      g.fillStyle = INK; g.fillText(kfmt(troops), x + (compact ? 2 : 3), y + 1);
      if (grp.length > 1) {
        const t = '×' + grp.length, bw = compact ? 18 : 22, bh = compact ? 12 : 14, bx = x + w / 2 - 2, by = y - h / 2 - bh / 2 - 2;
        g.fillStyle = INK; g.fillRect(bx - bw / 2, by - bh / 2, bw, bh); g.fillStyle = '#f4f6f1';
        g.font = `600 ${compact ? 9 : 11}px "Cascadia Mono", Consolas, monospace`; g.fillText(t, bx, by + 1);
        g.font = `600 ${compact ? 10 : 13}px "Cascadia Mono", Consolas, "IBM Plex Mono", monospace`;
      }
      if (inBattle(a.prov) && !moving) { g.fillStyle = '#ef7457'; g.fillRect(x - w / 2 - 4, y - h / 2 - 4, 8, 8); }
      g.globalAlpha = 1;
      this.hits.push({ a, ids: grp.map(b => b.id), x0: x - w / 2 - 3, x1: x + w / 2 + 3, y0: y - h / 2 - 3, y1: y + h / 2 + 3 });
    }
  }
}

// The nation wheel: the player spins their own nation, then the rivals are spun automatically.
import * as G from '../sim/game.js';
import { S, D } from '../sim/game.js';
import { num, fmtPop, fmtGdp, fmtPct, esc, chip } from './format.js';
import { sfx, unlockAudio } from './audio.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (a, b) => a + Math.random() * (b - a);
const pickM = a => a[Math.floor(Math.random() * a.length)];
const shuffleM = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const WCOL = ['#e8ece4', '#b9c6c4', '#f2b134', '#8fa1ad'];

export class Setup {
  constructor(app) {
    this.app = app; this.$ = id => document.getElementById(id);
    this.c = this.$('wheel'); this.c.width = 440; this.c.height = 440; this.g = this.c.getContext('2d');
    this.items = []; this.rot = 0; this.flick = 0; this.win = -1; this.glow = 0; this.animating = false; this.spinning = false;
    this.c.addEventListener('click', () => { if (!this.spinning && !this.ai) this.onSpin(); });
    this.$('spin').onclick = () => this.onSpin();
    this.$('respin').onclick = () => this.respin();
    this.$('spinRest').onclick = () => this.spinMine();
    this.$('skip').onclick = () => this.skip();
    this.$('newMap').onclick = () => { if (!this.spinning) this.begin(); };
    for (const id of ['goal', 'diff', 'size', 'mapSize']) this.$(id).onchange = () => {
      if (id === 'mapSize') this.nationOptions();
      this.describe();
      if ((id === 'size' || id === 'mapSize') && !S.nations.length && !this.spinning) this.begin();
    };
    this.nationOptions();
  }
  cats() {
    return [{ key: 'name', label: 'Name' }, { key: 'gov', label: 'Government', items: D.governments }, { key: 'pop', label: 'Population', items: D.setup.pops },
      { key: 'mil', label: 'Military', items: D.setup.mils }, { key: 'eco', label: 'Economy', items: D.setup.ecos }, { key: 'trait', label: 'Special trait', items: D.traits }, { key: 'leader', label: 'Leader', items: D.leaders }];
  }
  nationOptions() {
    const cfg = D.balance.mapSizes[this.$('mapSize').value];
    this.$('size').innerHTML = cfg.nations.map(v => `<option value="${v}" ${v === cfg.defNations ? 'selected' : ''}>${v}</option>`).join('');
  }
  describe() {
    const cfg = D.balance.mapSizes[this.$('mapSize').value];
    this.$('goalDesc').textContent = `${D.goals[this.$('goal').value].d} ${cfg.n} map: about ${cfg.provinces.toLocaleString('en-IE')} provinces.`;
  }
  begin() {
    this.describe();
    G.newGame({ mapSize: this.$('mapSize').value, nations: +this.$('size').value, goal: this.$('goal').value, diff: this.$('diff').value });
    this.slot = 0; this.cat = 0; this.draft = {}; this.ai = false; this.skipReq = false; this.respins = 2; this.lastCat = -1; this.ready = false;
    this.$('flavor').textContent = ''; this.hideStamp();
    for (const id of ['goal', 'diff', 'size', 'mapSize']) this.$(id).disabled = false;
    this.app.onWorld(); this.load(); this.btns();
  }
  load() {
    if (this.cat >= this.cats().length) { this.render(); return; }
    const c = this.cats()[this.cat];
    this.items = c.key === 'name' ? shuffleM(D.names.nations.filter(x => !S.usedNames.includes(x))).slice(0, 8).map(n => ({ n })) : c.items;
    this.win = -1; this.draw(); this.render();
  }
  apply(key, it) {
    const d = this.draft;
    if (key === 'name') d.name = it.n; else if (key === 'pop') d.popM = it.v * rand(.85, 1.15); else if (key === 'mil') d.milPct = it.v;
    else if (key === 'eco') d.gdp = it.v * rand(.85, 1.15); else d[key] = it.k;
  }
  stampText(key, it) { const d = this.draft; if (key === 'pop') return fmtPop(d.popM); if (key === 'mil') return fmtPct(d.milPct) + ' armed'; if (key === 'eco') return fmtGdp(d.gdp); return it.n; }
  flavor(key, idx) {
    const c = this.cats().find(x => x.key === key);
    if (key === 'name') return `Long live ${this.draft.name}.`;
    if (c.items[idx].f) return c.items[idx].f;
    return pickM(D.setup.tiers[Math.min(3, Math.floor(idx / (c.items.length - 1) * 3.999))]);
  }
  async spinOne(fast) {
    const cats = this.cats();
    if (this.spinning || S.phase !== 'setup' || this.cat >= cats.length) return true;
    unlockAudio(); this.spinning = true; this.hideStamp(); this.btns();
    for (const id of ['goal', 'diff', 'size', 'mapSize']) this.$(id).disabled = true;
    const c = cats[this.cat], idx = Math.floor(Math.random() * this.items.length);
    await this.spinTo(idx, fast ? 380 : 3000, this.ai);
    this.apply(c.key, this.items[idx]);
    if (!this.ai) { sfx.ding(); this.stamp(this.stampText(c.key, this.items[idx])); this.$('flavor').textContent = this.flavor(c.key, idx); this.settle(); }
    this.lastCat = this.cat; this.cat++;
    if (this.cat >= cats.length) {
      if (!this.ai) { this.spinning = false; this.ready = true; this.render(); this.btns(); return true; }
      G.foundNation(this.draft, this.slot, false); this.slot++; this.app.onWorld();
      if (this.slot >= S.nn) { this.spinning = false; this.finish(); return true; }
      this.draft = {}; this.cat = 0; this.render(true);
      await new Promise(r => setTimeout(r, reduced ? 60 : 380));
    }
    this.spinning = false;
    if (this.skipReq) { this.skipReq = false; this.skip(); return true; }
    this.load(); this.btns(); return false;
  }
  async respin() {
    if (this.spinning || this.ai || this.respins <= 0 || this.lastCat < 0) return;
    this.respins--; this.ready = false;
    const key = this.cats()[this.lastCat].key, field = { pop: 'popM', mil: 'milPct', eco: 'gdp' }[key] || key;
    delete this.draft[field]; this.cat = this.lastCat; this.lastCat = -1;
    this.load(); this.btns(); await this.spinOne(false);
  }
  async found() {
    if (!this.ready) return;
    this.ready = false; unlockAudio(); sfx.found();
    G.foundNation(this.draft, this.slot, true); this.slot++; this.app.onWorld();
    this.draft = {}; this.cat = 0; this.lastCat = -1;
    this.render(true); this.btns(); this.stamp('Founded');
    await new Promise(r => setTimeout(r, reduced ? 100 : 1300));
    if (S.phase !== 'setup') return;
    this.hideStamp(); this.ai = true; this.load(); this.btns();
    while (S.phase === 'setup' && this.ai) await this.spinOne(true);
  }
  async spinMine() { while (S.phase === 'setup' && !this.ai && this.cat < this.cats().length) await this.spinOne(true); if (this.ready) this.found(); }
  onSpin() { if (this.ready) this.found(); else this.spinOne(false); }
  skip() {
    if (S.phase !== 'setup') return;
    if (this.spinning) { this.skipReq = true; return; }
    this.ai = false; this.ready = false;
    const base = G.randomDraft(); for (const k in base) if (this.draft[k] == null) this.draft[k] = base[k];
    G.foundNation(this.draft, this.slot, this.slot === 0); this.slot++;
    while (this.slot < S.nn) { G.foundNation(G.randomDraft(), this.slot, false); this.slot++; }
    this.finish();
  }
  finish() { this.ai = false; this.app.onSetupDone(); }

  rows(d, cur) {
    const troops = d.popM != null && d.milPct != null ? ' · ' + num(d.popM * 1e6 * d.milPct / 100) + ' troops' : '';
    return [['Government', d.gov && D.govMap[d.gov].n, 'gov'], ['Population', d.popM != null && fmtPop(d.popM), 'pop'], ['Military', d.milPct != null && fmtPct(d.milPct) + troops, 'mil'],
      ['Economy', d.gdp != null && fmtGdp(d.gdp) + ' GDP', 'eco'], ['Trait', d.trait && D.traitMap[d.trait].n, 'trait'], ['Leader', d.leader && D.leaderMap[d.leader].n, 'leader']]
      .map(([k, v, key]) => `<dt>${k}</dt><dd class="${key === cur ? 'now' : ''}">${v || '—'}</dd>`).join('');
  }
  render(justFounded) {
    const cats = this.cats(); let lab;
    if (justFounded) { const n = S.nations[S.nations.length - 1]; lab = n.you ? 'Your nation is founded. Rivals spin next.' : `Nation ${this.slot} of ${S.nn} founded`; }
    else if (this.ai) lab = `Rivals · nation ${this.slot + 1} of ${S.nn} · ${cats[this.cat].label.toLowerCase()}`;
    else if (this.ready) lab = 'Your nation is ready to found';
    else lab = `Your nation · spin for ${cats[this.cat].label.toLowerCase()}`;
    this.$('setupLabel').textContent = lab;
    let d = this.draft, title;
    if (justFounded) { const n = S.nations[S.nations.length - 1]; d = { name: n.name, gov: n.gov, popM: G.popOf(n), milPct: n.milPct, gdp: G.gdpOf(n), trait: n.trait, leader: n.leader }; title = chip(n) + esc(n.name); }
    else title = d.name ? esc(d.name) : (this.ai ? 'Rival' : 'Your nation');
    this.$('draftName').innerHTML = title;
    if (this.ai || justFounded) this.$('flavor').textContent = '';
    const sl = justFounded ? null : S.slots[this.slot];
    const land = sl ? `<dt>Land</dt><dd>${sl.length} provinces · ${sl.map(id => `<span class="rdot" style="background:${D.biomes[S.P[id].biome].c}"></span>${D.biomes[S.P[id].biome].n}`).join(', ')}</dd>` : '';
    this.$('draftStats').innerHTML = land + this.rows(d, justFounded || this.ready || this.cat >= cats.length ? null : cats[this.cat].key);
    this.app.onWorld();
  }
  btns() {
    const $ = this.$;
    $('spin').textContent = this.ready ? 'Found nation' : 'Spin'; $('spin').disabled = this.spinning || this.ai;
    $('respin').textContent = `Respin (${this.respins} left)`; $('respin').disabled = this.spinning || this.ai || this.respins <= 0 || this.lastCat < 0; $('respin').hidden = this.ai;
    $('spinRest').disabled = this.spinning || this.ai || this.ready; $('spinRest').hidden = this.ai;
    $('skip').textContent = this.ai ? 'Skip rival spins' : 'Skip to the game';
    $('newMap').disabled = this.spinning || S.nations.length > 0;
  }
  stamp(t) { const s = this.$('stamp'); s.textContent = t; s.classList.remove('show'); void s.offsetWidth; s.classList.add('show'); }
  hideStamp() { this.$('stamp').classList.remove('show'); }

  draw() {
    const g = this.g, n = this.items.length, a = 2 * Math.PI / n, cx = 220, cy = 230, rad = 200;
    g.clearRect(0, 0, 440, 440);
    g.beginPath(); g.arc(cx, cy, rad + 8, 0, 7); g.fillStyle = '#0b1620'; g.fill();
    for (let i = 0; i < 24; i++) { const t = i / 24 * 2 * Math.PI; g.beginPath(); g.arc(cx + Math.cos(t) * (rad + 4), cy + Math.sin(t) * (rad + 4), 2.2, 0, 7); g.fillStyle = (this.spinning && ((i + Math.floor(performance.now() / 90)) % 2)) ? '#f2b134' : '#3a4c5c'; g.fill(); }
    for (let i = 0; i < n; i++) {
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, rad, this.rot + i * a, this.rot + (i + 1) * a); g.closePath();
      let fc = WCOL[i % WCOL.length]; if (n % WCOL.length === 1 && i === n - 1) fc = WCOL[1];
      g.fillStyle = fc; g.fill();
      if (i === this.win && this.glow > 0) { g.fillStyle = `rgba(255,255,255,${.55 * this.glow})`; g.fill(); }
      g.strokeStyle = '#0b1620'; g.lineWidth = 3; g.stroke();
      g.save(); g.translate(cx, cy); g.rotate(this.rot + (i + .5) * a); g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillStyle = '#1d1404'; g.font = '600 20px "Bahnschrift SemiCondensed", "Bahnschrift", "Segoe UI", sans-serif';
      let t = this.items[i].n; if (t.length > 17) t = t.slice(0, 16) + '…'; g.fillText(t, rad - 12, 1); g.restore();
    }
    if (this.win >= 0 && this.glow > 0) { g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, rad, this.rot + this.win * a, this.rot + (this.win + 1) * a); g.closePath(); g.strokeStyle = '#f2b134'; g.lineWidth = 6; g.stroke(); }
    g.beginPath(); g.arc(cx, cy, 26, 0, 7); g.fillStyle = '#0b1620'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#f2b134'; g.stroke();
    g.fillStyle = '#f2b134'; g.font = '700 14px "Bahnschrift Condensed", "Bahnschrift", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(this.spinning ? '' : 'SPIN', cx, cy + 1);
    g.save(); g.translate(cx, 6); g.rotate(-this.flick * .6);
    g.beginPath(); g.moveTo(-15, 0); g.lineTo(15, 0); g.lineTo(0, 34); g.closePath(); g.fillStyle = '#f2b134'; g.fill(); g.strokeStyle = '#0b1620'; g.lineWidth = 2.5; g.stroke(); g.restore();
  }
  settle() {
    if (this.animating) return; this.animating = true; const t0 = performance.now();
    const f = t => { this.flick *= .8; this.glow = this.win >= 0 ? Math.max(0, 1 - (t - t0) / 1600) * (.6 + .4 * Math.abs(Math.sin((t - t0) / 140))) : 0; this.draw(); if (this.flick > .01 || this.glow > 0) requestAnimationFrame(f); else { this.animating = false; this.glow = 0; this.draw(); } };
    requestAnimationFrame(f);
  }
  seg() { const n = this.items.length, a = 2 * Math.PI / n; let ang = (-Math.PI / 2 - this.rot) % (2 * Math.PI); if (ang < 0) ang += 2 * Math.PI; return Math.floor(ang / a) % n; }
  spinTo(idx, dur, quiet) {
    return new Promise(res => {
      const n = this.items.length, a = 2 * Math.PI / n; let target = -Math.PI / 2 - (idx + .5) * a + rand(-.44, .44) * a; const base = this.rot;
      const turns = dur > 800 ? 6 : 2; while (target < base + turns * 2 * Math.PI) target += 2 * Math.PI;
      if (reduced) dur = Math.min(dur, 200);
      this.win = -1; this.glow = 0; let last = this.seg(); const t0 = performance.now();
      const f = t => {
        const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 4); this.rot = base + (target - base) * e;
        const s = this.seg(); if (s !== last) { last = s; this.flick = 1; if (!quiet) sfx.tick(); }
        this.flick *= .82; this.draw();
        if (p < 1) requestAnimationFrame(f); else { this.rot = target % (2 * Math.PI); this.win = idx; res(); }
      };
      requestAnimationFrame(f);
    });
  }
}

// Entry point: loads data, runs the game clock, connects input, map, panels and dialogs.
import * as G from '../sim/game.js';
import { S, D, YEAR } from '../sim/game.js';
import { MapView } from './map.js';
import { Setup } from './setup.js';
import { TABS, renderTab, buildEcon, updateEcon, recruitInfo } from './panels.js';
import { showModal, closeModal, modalOpen, initModalLayer, toast } from './dialogs.js';
import { platform } from './platform.js';
import { sound, sfx, unlockAudio } from './audio.js';
import { num, kfmt, fmtGdp, dateStr, esc, chip, fmtMsg, plainMsg } from './format.js';

const DATA_FILES = ['balance', 'governments', 'setup', 'traits', 'leaders', 'biomes', 'goods', 'buildings', 'cultures', 'techs', 'goals', 'difficulties', 'medals', 'names'];
const SPEED_MS = [0, 500, 240, 110, 45, 12];
const $ = id => document.getElementById(id);

const ui = { mapMode: 'political', tab: 'sel', sel: null, confirm: null, peaceSel: {}, recProv: null, hoverProv: -1, paused: true, speed: 2, hold: false, forceBase: true, setup: null, lastHtml: '', econBuilt: false, keys: new Set() };
let map, setup, profile, acc = 0, lastT = 0, lastPanel = 0, lastYear = 0;

const defaultProfile = () => ({ settings: { sound: true, volume: .7, autosave: 'yearly', uiScale: 1, confirmWar: true, edgePan: false }, records: { games: 0, wins: 0, best: 0, medals: {} } });
const saveProfile = () => platform.writeProfile(profile);

// ---------- boot ----------
async function boot() {
  const data = {};
  await Promise.all(DATA_FILES.map(async f => { data[f] = await (await fetch(`data/${f}.json`)).json(); }));
  G.init(data);
  G.setEmitter(onSimEvent);
  profile = Object.assign(defaultProfile(), await platform.readProfile() || {});
  profile.settings = Object.assign(defaultProfile().settings, profile.settings);
  profile.records = Object.assign(defaultProfile().records, profile.records);
  applySettings();
  initModalLayer();
  map = new MapView($('map'));
  setup = new Setup(app);
  window.__wn = { G, map, ui }; // handy for poking at the game from DevTools (Ctrl+Shift+I)
  buildTabs();
  bindInput();
  new ResizeObserver(() => { map.resize(); }).observe($('mapwrap'));
  map.resize();
  newGameScreen();
  requestAnimationFrame(loop);
}
function applySettings() {
  sound.on = profile.settings.sound; sound.volume = profile.settings.volume;
  document.documentElement.style.zoom = profile.settings.uiScale;
}

// ---------- callbacks used by Setup ----------
const app = {
  onWorld() {
    ui.forceBase = true; ui.setup = S.phase === 'setup' ? {} : null;
    if (map && S.phase === 'setup' && map.ensureWorld()) { map.limits(); const cw = $('setup').offsetWidth + 32; map.fitRect(0, 0, Math.max(300, map.cw - cw), map.ch); }
  },
  onSetupDone() { G.startGame(); enterGame(); },
};
function newGameScreen() {
  closeModal(); ui.paused = true; ui.sel = null; ui.peaceSel = {}; ui.confirm = null;
  document.body.classList.add('setup-mode'); $('setup').hidden = false; $('ribbon').hidden = true;
  setup.begin(); requestAnimationFrame(() => { map.resize(); map.ensureWorld(); map.limits(); const cw = $('setup').offsetWidth + 32; map.fitRect(0, 0, Math.max(300, map.cw - cw), map.ch); }); renderTopbar(); renderSpeed();
}
function enterGame() {
  document.body.classList.remove('setup-mode'); $('setup').hidden = true;
  ui.setup = null; ui.forceBase = true; ui.sel = null; ui.tab = 'sel'; ui.econBuilt = false; ui.paused = true; ui.peaceSel = {}; ui.recProv = null;
  lastYear = G.yearOf(S.day);
  map.ensureWorld(); map.limits();
  const p = G.player(); if (p) { const c = S.P[p.cap]; map.centerOn(c.cx, c.cy, Math.max(map.minZoom * 2, 1.8)); }
  showRibbon('Your tribe is settled. Press Play or Space to start the clock. Click your home tile to see its fields and workshops. Feed your people bread and keep them in firewood; send your war band to settle unclaimed land nearby.', 10000);
  renderSpeed(); renderTabs(); refreshPanel(true); renderTopbar();
}

// ---------- sim events ----------
function onSimEvent(type, d) {
  if (type === 'log') { if (S.phase === 'game' && (d.s >= 6 || (d.s >= 4 && d.m.includes(`{{n:${G.player()?.id}}}`)))) showRibbon(fmtMsg(d.m), 6000, true); }
  else if (type === 'battle') { map.flash(d.prov, 'battle'); if (d.you) sfx.boom(); }
  else if (type === 'nuke') { map.flash(d.prov, 'nuke'); sfx.boom(); }
  else if (type === 'toast') toast(d.lab, d.title, d.sub);
  else if (type === 'decision') sfx.ding();
  else if (type === 'peaceTable') {   // enemy crushed: stop the clock and open the treaty
    ui.paused = true; renderSpeed(); delete ui.peaceSel[d.war]; setTab('wars'); sfx.ding();
    const w = S.wars.find(x => x.id === d.war), e = w && S.nations[G.enemyIn(w, G.player().id)];
    if (e) toast('Enemy crushed', e.name, `Their provinces cost ${Math.round(G.CRUSH_MULT * 100)}% of normal. Draw up the peace.`);
  }
  else if (type === 'medal') {
    if (!profile.records.medals[d]) { profile.records.medals[d] = Date.now(); saveProfile(); const m = D.medals.find(x => x.k === d); if (m) toast('Medal unlocked', m.n, m.d); }
  } else if (type === 'end') {
    const r = profile.records; r.games++; if (d.won) r.wins++; const best = d.score > r.best; if (best) r.best = d.score; saveProfile();
    ui.paused = true; renderSpeed(); (d.won ? sfx.found : sfx.boom)();
    setTimeout(() => endDialog(d, best), 400);
  }
}
let ribbonT = 0;
function showRibbon(html, ms, isHtml) { const r = $('ribbon'); r.innerHTML = isHtml ? html : esc(html); r.hidden = false; clearTimeout(ribbonT); ribbonT = setTimeout(() => r.hidden = true, ms || 6000); }

// ---------- loop ----------
function loop(t) {
  const dt = lastT ? Math.min(250, t - lastT) : 16; lastT = t;
  if (S && S.phase === 'game') {
    if (!modalOpen() && S.decisions.length) showDecision();
    const running = !ui.paused && !modalOpen() && !S.decisions.length && !S.over;
    if (running) {
      acc += dt / SPEED_MS[ui.speed]; let n = Math.min(Math.floor(acc), 40); acc -= n; if (acc > 4) acc = 0;
      while (n-- > 0 && !S.decisions.length && !S.over && !ui.paused) { G.tick(); if (S.result && !ui.resultSeen) { ui.resultSeen = true; break; } }
      const y = G.yearOf(S.day); if (y !== lastYear) { lastYear = y; autosave(); }
      if (S.over) { ui.paused = true; renderSpeed(); }
    } else acc = 0;
    keyPan(dt);
    if (t - lastPanel > 300) { lastPanel = t; renderTopbar(); if (!ui.hold) refreshPanel(); }
  } else keyPan(dt);
  map.draw(t, { selProv: ui.sel && ui.sel.kind === 'prov' ? ui.sel.id : null, selArmies: ui.sel && ui.sel.kind === 'armies' ? new Set(ui.sel.ids) : null, hoverProv: ui.hoverProv, setup: ui.setup, mapMode: ui.mapMode, get forceBase() { return ui.forceBase; }, set forceBase(v) { ui.forceBase = v; } });
  requestAnimationFrame(loop);
}
function keyPan(dt) {
  const k = ui.keys, sp = dt * .9; let dx = 0, dy = 0;
  if (k.has('ArrowLeft') || k.has('KeyA')) dx += sp; if (k.has('ArrowRight') || k.has('KeyD')) dx -= sp;
  if (k.has('ArrowUp') || k.has('KeyW')) dy += sp; if (k.has('ArrowDown') || k.has('KeyS')) dy -= sp;
  if (dx || dy) map.pan(dx, dy);
}

function toggleTerrain() { ui.mapMode = ui.mapMode === 'terrain' ? 'political' : 'terrain'; $('zTerrain').classList.toggle('primary', ui.mapMode === 'terrain'); }

// ---------- top bar ----------
function renderSpeed() {
  $('pause').textContent = ui.paused ? 'Play' : 'Pause';
  $('pause').classList.toggle('primary', ui.paused);
  document.querySelectorAll('[data-sp]').forEach(b => b.classList.toggle('on', +b.dataset.sp === ui.speed));
}
function renderTopbar() {
  if (!S) return;
  const p = G.player();
  if (S.phase !== 'game' || !p) { $('tbNation').innerHTML = ''; return; }
  $('tbNation').innerHTML = `${chip(p)}${esc(p.name)}`;
  $('date').textContent = dateStr(S.day);
  const m = G.monthlyIncome(p), fl = G.forceLimit(p), tr = G.troopsOf(p);
  const set = (id, t, bad) => { const e = $(id); e.textContent = t; e.classList.toggle('neg', !!bad); };
  set('tTreasury', fmtGdp(p.treasury), p.treasury < 0);
  set('tIncome', (m.net >= 0 ? '+' : '') + fmtGdp(m.net), m.net < 0);
  set('tArmy', `${kfmt(tr)} / ${kfmt(fl)}`, tr > fl);
  set('tManpower', kfmt(p.manpower));
  const food = Math.min(p.fed ?? 1, p.warm ?? 1); set('tFood', Math.round(food * 100) + '%', food < .95);
  set('tPop', G.popOf(p) * 1e6 >= 1e4 ? kfmt(G.popOf(p) * 1e6) : num(G.popOf(p) * 1e6));
  const ready = S.techOffers.length && p.rp >= G.techCost(p);
  set('tResearch', ready ? 'Ready!' : `${Math.floor(p.rp / G.techCost(p) * 100)}%`);
  $('tResearch').classList.toggle('pos', !!ready);
}

// ---------- side panel ----------
function buildTabs() {
  $('tabs').innerHTML = TABS.map((t, i) => `<button data-tabbtn="${t.k}"><span>${t.n}</span><small>F${i + 1}</small></button>`).join('');
  $('tabs').addEventListener('click', e => { const b = e.target.closest('[data-tabbtn]'); if (b) setTab(b.dataset.tabbtn); });
  const side = $('side');
  side.addEventListener('pointerdown', () => { ui.hold = true; });
  document.addEventListener('pointerup', () => setTimeout(() => { ui.hold = false; }, 250));
  $('tabbody').addEventListener('click', onPanelClick);
  $('tabbody').addEventListener('input', onPanelInput);
  $('tabbody').addEventListener('change', onPanelInput);
  document.querySelectorAll('.stat[data-tab]').forEach(el => el.onclick = () => setTab(el.dataset.tab));
}
function setTab(k) { ui.tab = k; ui.confirm = null; ui.econBuilt = false; renderTabs(); refreshPanel(true); }
function renderTabs() {
  const p = G.player();
  document.querySelectorAll('[data-tabbtn]').forEach(b => {
    b.classList.toggle('on', b.dataset.tabbtn === ui.tab);
    const alert = p && ((b.dataset.tabbtn === 'tech' && S.techOffers.length && p.rp >= G.techCost(p)) || (b.dataset.tabbtn === 'wars' && G.warsOf(p.id).length));
    const span = b.querySelector('span'); span.innerHTML = TABS.find(t => t.k === b.dataset.tabbtn).n + (alert ? '<i class="dot"></i>' : '');
  });
}
function refreshPanel(force) {
  if (!S || S.phase !== 'game') return;
  renderTabs();
  const body = $('tabbody');
  if (ui.tab === 'econ') {
    if (!ui.econBuilt || force) { body.innerHTML = buildEcon(); ui.econBuilt = true; ui.lastHtml = ''; }
    updateEcon(ui); return;
  }
  const html = renderTab(ui);
  if (force || html !== ui.lastHtml) { const st = body.scrollTop; body.innerHTML = html; body.scrollTop = st; ui.lastHtml = html; }
}
function select(sel, center) {
  ui.sel = sel; ui.confirm = null;
  if (ui.tab !== 'sel') { ui.tab = 'sel'; ui.econBuilt = false; }
  if (center && sel) {
    if (sel.kind === 'prov') { const p = S.P[sel.id]; map.centerOn(p.cx, p.cy); }
    else { const a = S.armies.find(x => x.id === sel.ids[0]); if (a) { const [x, y] = map.armyPos(a); map.centerOn(x, y); } }
  }
  refreshPanel(true);
}
function result(r, okTitle) {
  if (!r.ok) { toast('Not possible', r.msg, '', 'bad'); sfx.error(); }
  else { sfx.click(); if (okTitle) toast(okTitle[0], okTitle[1], okTitle[2]); }
  refreshPanel(true); renderTopbar();
  return r;
}
function onPanelClick(e) {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled || b.type === 'checkbox') return;
  const act = b.dataset.act, arg = b.dataset.arg, p = G.player();
  const confirm2 = key => { if (ui.confirm === key) { ui.confirm = null; return true; } ui.confirm = key; refreshPanel(true); return false; };
  switch (act) {
    case 'selArmy': select({ kind: 'armies', ids: [+arg] }, true); break;
    case 'selProv': select({ kind: 'prov', id: +arg }, true); break;
    case 'selNation': { const n = S.nations[+arg]; if (n.alive) select({ kind: 'prov', id: n.cap }, true); break; }
    case 'deselect': select(null); break;
    case 'stop': result(G.cmdStop(+arg)); break;
    case 'stopAll': ui.sel.ids.forEach(id => G.cmdStop(id)); refreshPanel(true); break;
    case 'split': { const r = result(G.cmdSplit(+arg)); if (r.ok) select({ kind: 'armies', ids: [r.army] }); break; }
    case 'merge': { const r = result(G.cmdMerge(arg.split(',').map(Number))); if (r.ok) select({ kind: 'armies', ids: [r.army] }); break; }
    case 'dis25': result(G.cmdDischarge(+arg, .25)); break;
    case 'disband': if (confirm2('disband:' + arg)) { result(G.cmdDischarge(+arg, 1)); select(null); } break;
    case 'build': { const [pid, k, lv] = arg.split(':'); result(G.cmdBuild(+pid, k, +lv || 1), ['Construction started', `${D.buildings[k].n}${+lv > 1 ? ' ×' + lv : ''} · ${S.P[+pid].name}`, `About ${D.buildings[k].weeks} weeks with enough builders`]); break; }
    case 'cancelBuild': result(G.cmdCancelBuild(+arg)); break;
    case 'crop': { const [pid, c] = arg.split(':'); result(G.cmdSetCrop(+pid, c)); break; }
    case 'recHere': ui.recProv = +arg; setTab('econ'); setTimeout(() => $('rTroops')?.scrollIntoView({ block: 'center' }), 0); break;
    case 'recruit': { const r = recruitInfo(ui); if (!r.ok) return; const res = result(G.cmdRecruit(r.prov, r.sw, r.sp), ['Army raised', `${num(r.sw)} swordsmen · ${num(r.sp)} spearmen`, `In ${S.P[r.prov].name}`]); if (res.ok) { select({ kind: 'armies', ids: [res.army] }, true); } break; }
    case 'dow': if (!profile.settings.confirmWar || confirm2('dow:' + arg)) result(G.cmdDeclareWar(+arg)); break;
    case 'ally': { const r = G.cmdProposeAlliance(+arg); if (r.ok) toast(r.accepted ? 'Alliance signed' : 'Refused', S.nations[+arg].name, r.accepted ? 'They will defend you, and call you to their wars.' : 'They turned you down. Try again in a year.', r.accepted ? '' : 'bad'); else result(r); refreshPanel(true); break; }
    case 'unally': result(G.cmdBreakAlliance(+arg)); break;
    case 'nuke': if (confirm2('nuke:' + arg)) result(G.cmdNuke(+arg)); break;
    case 'peace': {
      const w = S.wars.find(x => x.id === +arg), p = G.player(), sel = ui.peaceSel[+arg]; if (!w || !sel) break;
      const e = G.enemyIn(w, p.id), mode = sel.mode || (G.warScore(w, p.id) >= 0 ? 'demand' : 'offer');
      const r = result(G.cmdPeace(+arg, { to: mode === 'demand' ? p.id : e, provs: sel.provs, gold: sel.gold, reps: sel.reps, allies: sel.allies }));
      if (r.ok) { sfx.found(); delete ui.peaceSel[+arg]; } break;
    }
    case 'pall': { const w = S.wars.find(x => x.id === +arg); if (!w) break; ui.peaceSel[+arg] = { mode: 'demand', provs: G.occupiedBy(w, G.player().id).map(q => q.id), gold: 0, reps: false, allies: false }; refreshPanel(true); break; }
    case 'pmode': { const [w, m] = arg.split(':'); ui.peaceSel[+w] = { mode: m, provs: [], gold: 0, reps: false, allies: false }; refreshPanel(true); break; }
    case 'white': result(G.cmdPeace(+arg, [])); break;
    case 'research': { const r = result(G.cmdResearch(arg), ['Technology', D.techMap[arg].n, D.techMap[arg].d]); if (r.ok) sfx.ding(); break; }
  }
}
function onPanelInput(e) {
  const t = e.target, p = G.player(); if (!p) return;
  if (t.id === 'sTax') G.cmdPolicy({ tax: +t.value / 100 });
  else if (t.id === 'sCon') G.cmdPolicy({ milPct: +t.value });
  else if (t.id === 'sMnt') G.cmdPolicy({ maint: +t.value / 100 });
  else if (t.id === 'rProv') ui.recProv = +t.value;
  else if (t.id === 'rMix' || t.id === 'rTroops') { /* read live by recruitInfo */ }
  else if (t.dataset.act === 'pset' && e.type === 'change') { const [pid, k] = t.dataset.arg.split(':'); result(G.cmdSetProduction(+pid, k, +t.value)); return; }
  else if (t.dataset.act === 'pterm' && e.type === 'change') {
    const [w, k, v] = t.dataset.arg.split(':'), sel = ui.peaceSel[+w]; if (!sel) return;
    if (k === 'prov') { const pid = +v; if (t.checked) { if (!sel.provs.includes(pid)) sel.provs.push(pid); } else sel.provs = sel.provs.filter(x => x !== pid); }
    else if (k === 'gold') sel.gold = +t.value;
    else sel[k] = t.checked;
    refreshPanel(true); return;
  } else return;
  if (ui.tab === 'econ') updateEcon(ui);
  renderTopbar();
}

// ---------- map input ----------
function bindInput() {
  const c = $('map');
  let down = null;
  c.addEventListener('mousedown', e => { unlockAudio(); down = { b: e.button, x: e.clientX, y: e.clientY, moved: false }; if (e.button === 1) e.preventDefault(); });
  window.addEventListener('mousemove', e => {
    const r = c.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (down) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!down.moved && Math.hypot(dx, dy) > 5) { down.moved = true; c.classList.add('panning'); }
      if (down.moved) { map.pan(e.movementX, e.movementY); }
      return;
    }
    if (e.target !== c) { ui.hoverProv = -1; $('tooltip').hidden = true; return; }
    hover(sx, sy);
  });
  window.addEventListener('mouseup', e => {
    if (!down) return; const d = down; down = null; c.classList.remove('panning');
    if (d.moved || e.target !== c) return;
    const r = c.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (d.b === 0) leftClick(sx, sy, e.shiftKey);
    else if (d.b === 2) rightClick(sx, sy);
  });
  c.addEventListener('contextmenu', e => e.preventDefault());
  c.addEventListener('wheel', e => { e.preventDefault(); const r = c.getBoundingClientRect(); map.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * .0016)); }, { passive: false });
  c.addEventListener('dblclick', e => { if (S.phase !== 'game') return; const r = c.getBoundingClientRect(); map.zoomAt(e.clientX - r.left, e.clientY - r.top, 1.8); });
  c.addEventListener('mouseleave', () => { ui.hoverProv = -1; $('tooltip').hidden = true; });
  $('zIn').onclick = () => map.zoomAt(map.cw / 2, map.ch / 2, 1.4);
  $('zOut').onclick = () => map.zoomAt(map.cw / 2, map.ch / 2, 1 / 1.4);
  $('zFit').onclick = () => map.fit();
  $('zTerrain').onclick = toggleTerrain;
  $('pause').onclick = togglePause;
  document.querySelectorAll('[data-sp]').forEach(b => b.onclick = () => { ui.speed = +b.dataset.sp; if (ui.paused && S.phase === 'game' && !S.over) ui.paused = false; unlockAudio(); renderSpeed(); });
  $('btnSave').onclick = saveDialog; $('btnLoad').onclick = loadDialog; $('btnMenu').onclick = menuDialog;
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', e => ui.keys.delete(e.code));
  window.addEventListener('blur', () => ui.keys.clear());
}
function hover(sx, sy) {
  if (!S) return;
  const tip = $('tooltip'), hit = map.armyAt(sx, sy), a = hit && hit.a, pid = map.provAt(sx, sy);
  ui.hoverProv = a ? -1 : pid;
  let html = '';
  if (a) { const n = S.nations[a.nat], tr = hit.ids.reduce((s, id) => s + (S.armies.find(x => x.id === id)?.troops || 0), 0); html = `${chip(n)}<b>${esc(n.name)}</b><br>${num(tr)} troops${hit.ids.length > 1 ? ` in ${hit.ids.length} armies` : ''}`; }
  else if (pid >= 0) {
    const p = S.P[pid], o = p.owner != null ? S.nations[p.owner] : null;
    html = `<b>${esc(p.name)}</b><br>${o ? chip(o) + esc(o.name) : 'Free province'}${p.ctrl != null && p.ctrl !== p.owner ? ` · occupied by ${esc(S.nations[p.ctrl].name)}` : ''}<br><span class="sub">${D.biomes[p.biome].n}${p.res === 'port' ? ' · harbour' : ''} · ${kfmt(p.pop * 1e6)} people</span>${S.battles.some(b => b.prov === pid) ? '<br><span class="neg">Battle here · click for details</span>' : ''}`;
    if (ui.sel && ui.sel.kind === 'armies' && S.phase === 'game') { const own = ui.sel.ids.map(id => S.armies.find(x => x.id === id)).filter(x => x && S.nations[x.nat].you); if (own.length) { const path = G.findPath(S.nations[own[0].nat], own[0].prov, pid); html += `<br><span class="${path ? 'pos' : 'neg'}">${path ? `Right-click to march · ${path.length} province${path.length === 1 ? '' : 's'}` : 'No route'}</span>`; } }
  }
  if (!html) { tip.hidden = true; return; }
  tip.innerHTML = html; tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(sx + 16, map.cw - w - 8) + 'px'; tip.style.top = Math.min(sy + 16, map.ch - h - 8) + 'px';
}
function leftClick(sx, sy, shift) {
  if (!S || S.phase !== 'game') return;
  const hit = map.armyAt(sx, sy);
  if (hit) {
    const a = hit.a;
    if (shift && ui.sel && ui.sel.kind === 'armies' && S.nations[a.nat].you) {
      const all = hit.ids.every(id => ui.sel.ids.includes(id));
      const ids = all ? ui.sel.ids.filter(x => !hit.ids.includes(x)) : [...new Set([...ui.sel.ids, ...hit.ids])];
      select(ids.length ? { kind: 'armies', ids: ids.filter(id => S.armies.find(x => x.id === id && x.nat === a.nat)) } : null);
    } else select({ kind: 'armies', ids: hit.ids });
    sfx.click(); return;
  }
  const pid = map.provAt(sx, sy);
  select(pid >= 0 ? { kind: 'prov', id: pid } : null);
}
function rightClick(sx, sy) {
  if (!S || S.phase !== 'game' || !ui.sel || ui.sel.kind !== 'armies') return;
  const pid = map.provAt(sx, sy); if (pid < 0) return;
  const own = ui.sel.ids.filter(id => { const a = S.armies.find(x => x.id === id); return a && S.nations[a.nat].you; });
  if (!own.length) return;
  const r = G.cmdMove(own, pid);
  if (r.ok) { sfx.click(); refreshPanel(true); } else { toast('Cannot march there', S.P[pid].name, r.msg, 'bad'); sfx.error(); }
}
function togglePause() { if (!S || S.phase !== 'game' || S.over) return; unlockAudio(); ui.paused = !ui.paused; renderSpeed(); }
function onKey(e) {
  if (e.target.closest && e.target.closest('input[type=text],select,textarea')) return;
  if (e.code === 'Escape') { if (modalOpen()) closeModal(); else if (ui.sel) select(null); else if (S.phase === 'game') menuDialog(); return; }
  if (e.code === 'F11') { e.preventDefault(); platform.toggleFullscreen(); return; }
  if (modalOpen()) return;
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); saveDialog(); return; }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyO') { e.preventDefault(); loadDialog(); return; }
  if (e.code === 'F5') { e.preventDefault(); quickSave(); return; }
  if (e.code === 'F9') { e.preventDefault(); loadSave('Quicksave'); return; }
  const fi = /^F([1-6])$/.exec(e.code); if (fi && S.phase === 'game') { e.preventDefault(); setTab(TABS[+fi[1] - 1].k); return; }
  if (e.code === 'Space') { e.preventDefault(); togglePause(); return; }
  const d = /^(Digit|Numpad)([1-5])$/.exec(e.code); if (d && S.phase === 'game') { ui.speed = +d[2]; renderSpeed(); return; }
  if (e.code === 'Equal' || e.code === 'NumpadAdd') { map.zoomAt(map.cw / 2, map.ch / 2, 1.25); return; }
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') { map.zoomAt(map.cw / 2, map.ch / 2, .8); return; }
  if (e.code === 'KeyT' && !e.ctrlKey && !e.metaKey) { toggleTerrain(); return; }
  if (e.code === 'Home') { const p = G.player(); if (p && S.phase === 'game') { const c = S.P[p.cap]; map.centerOn(c.cx, c.cy); } else map.fit(); return; }
  if (/^(Arrow|Key[WASD])/.test(e.code)) ui.keys.add(e.code);
}

// ---------- decisions ----------
function showDecision() {
  const d = S.decisions[0];
  showModal({
    eyebrow: dateStr(S.day), title: d.title, html: `<p>${esc(d.text)}</p>`, dismissable: false,
    buttons: d.choices.map((c, i) => ({ label: c.l, sub: c.s, primary: i === 0, onClick: () => {
      const r = G.chooseDecision(d.id, i);
      showModal({ eyebrow: dateStr(S.day), title: d.title, html: `<p>${esc(r.text || '')}</p>`, buttons: [{ label: 'Continue', primary: true }] });
      ui.forceBase = true; refreshPanel(true); return true;
    } }))
  });
}

// ---------- end of game ----------
function endDialog(r, best) {
  const p = G.player();
  showModal({ eyebrow: `${dateStr(S.day)} · ${D.difficulties[S.diff].n}`, title: r.won ? 'Victory' : 'Defeat',
    html: `<p>${esc(r.why)}.</p><p><b style="font:700 28px var(--display)">${num(r.score)} points</b>${best ? ' <span class="pos">New best</span>' : ''}</p>${p && p.alive ? `<p class="hint">${esc(p.name)} holds ${G.provsOf(p).length} provinces and ${fmtGdp(G.gdpOf(p))} of GDP.</p>` : ''}`,
    buttons: [{ label: 'Keep playing', sub: 'Watch the world carry on' }, { label: 'New game', primary: true, onClick: () => { newGameScreen(); } }] });
}

// ---------- save / load ----------
function saveObj(name) {
  const p = G.player();
  return { meta: { name, nation: p ? p.name : '', color: p ? p.color : '', date: dateStr(S.day), day: S.day, goal: D.goals[S.goal].n, diff: D.difficulties[S.diff].n, savedAt: Date.now(), version: G.SAVE_VERSION },
    camera: { cx: map.cx, cy: map.cy, zoom: map.zoom }, state: G.serialize() };
}
async function doSave(name) {
  try { await platform.saveGame(name, saveObj(name)); toast('Game saved', name, dateStr(S.day)); return true; }
  catch (err) { toast('Save failed', name, String(err.message || err), 'bad'); return false; }
}
async function quickSave() { if (S.phase === 'game') await doSave('Quicksave'); }
async function autosave() {
  const a = profile.settings.autosave; if (a === 'off' || S.phase !== 'game' || S.result) return;
  if (a === '5y' && G.yearOf(S.day) % 5 !== 1) return;
  try { await platform.saveGame('Autosave', saveObj('Autosave')); } catch (e) {}
}
async function loadSave(name) {
  const obj = await platform.loadGame(name).catch(() => null);
  if (!obj) { toast('Load failed', name, 'The save could not be read.', 'bad'); return false; }
  try { G.load(obj.state); } catch (err) { toast('Load failed', name, String(err.message || err), 'bad'); return false; }
  closeModal(); enterGame(); ui.resultSeen = !!S.result;
  if (obj.camera) { map.zoom = obj.camera.zoom; map.cx = obj.camera.cx; map.cy = obj.camera.cy; map.clampCam(); }
  toast('Game loaded', name, dateStr(S.day));
  return true;
}
function saveRow(s, actions) {
  const m = s.meta || {};
  return `<div class="saverow" data-name="${esc(s.name)}"><div data-pick="${esc(s.name)}"><b>${esc(s.name)}</b><div class="sub">${m.color ? `<span class="sw" style="background:${esc(m.color)}"></span>` : ''}${esc(m.nation || '')} · ${esc(m.date || '')} · ${esc(m.goal || '')} ${esc(m.diff || '')}<br>Saved ${new Date(s.mtime || m.savedAt).toLocaleString()}</div></div><div class="btns">${actions}</div></div>`;
}
async function saveDialog() {
  if (!S || S.phase !== 'game') return;
  const wasPaused = ui.paused; ui.paused = true; renderSpeed();
  const saves = await platform.listSaves();
  const p = G.player(), def = `${p ? p.name : 'Game'} Year ${G.yearOf(S.day)}`;
  const box = showModal({ title: 'Save game', wide: true, onClose: () => { ui.paused = wasPaused; renderSpeed(); },
    html: `<label class="sl"><span class="eyebrow">Save name</span><input type="text" id="saveName" maxlength="60" value="${esc(def)}"></label>
      ${saves.length ? `<div class="eyebrow">Existing saves · click one to overwrite it</div><div class="saves">${saves.map(s => saveRow(s, '')).join('')}</div>` : ''}
      ${platform.isDesktop ? '<p class="hint">Saves are stored in your user folder. <button id="openFolder">Open saves folder</button></p>' : ''}`,
    buttons: [{ label: 'Save', primary: true, onClick: () => { const n = $('saveName').value.trim().replace(/[\\/:*?"<>|]/g, '') || def; doSave(n); } }, { label: 'Cancel' }] });
  box.querySelectorAll('[data-pick]').forEach(el => el.onclick = () => { $('saveName').value = el.dataset.pick; box.querySelectorAll('.saverow').forEach(r => r.classList.toggle('sel', r.dataset.name === el.dataset.pick)); });
  const of = $('openFolder'); if (of) of.onclick = () => platform.openSavesFolder();
  $('saveName').addEventListener('keydown', e => { if (e.key === 'Enter') { box.querySelector('[data-mb="0"]').click(); } });
}
async function loadDialog() {
  const wasPaused = ui.paused; ui.paused = true; renderSpeed();
  const saves = await platform.listSaves();
  const box = showModal({ title: 'Load game', wide: true, onClose: () => { if (S.phase === 'game') { ui.paused = wasPaused; renderSpeed(); } },
    html: saves.length ? `<div class="saves">${saves.map(s => saveRow(s, `<button class="primary" data-load="${esc(s.name)}">Load</button><button class="danger" data-del="${esc(s.name)}">Delete</button>`)).join('')}</div>` : '<p class="hint">No saved games yet. Press Ctrl+S or F5 while playing.</p>',
    buttons: [{ label: 'Close' }] });
  box.querySelectorAll('[data-load]').forEach(b => b.onclick = () => loadSave(b.dataset.load));
  box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (b.dataset.armed) { await platform.deleteSave(b.dataset.del); b.closest('.saverow').remove(); }
    else { b.dataset.armed = '1'; b.textContent = 'Confirm delete'; }
  });
}

// ---------- menu, settings, records, help ----------
function menuDialog() {
  const wasPaused = ui.paused; ui.paused = true; renderSpeed();
  const inGame = S && S.phase === 'game';
  showModal({ title: 'Menu', onClose: () => { if (inGame) { ui.paused = wasPaused; renderSpeed(); } },
    buttons: [
      ...(inGame ? [{ label: 'Resume', primary: true }] : []),
      { label: 'New game', sub: inGame ? 'Unsaved progress is lost' : '', onClick: () => { if (!inGame) return; confirmDialog('Start a new game?', 'Your current game will be lost unless you saved it.', 'New game', () => newGameScreen()); return true; } },
      ...(inGame ? [{ label: 'Save game', onClick: () => { setTimeout(saveDialog, 0); } }] : []),
      { label: 'Load game', onClick: () => { setTimeout(loadDialog, 0); } },
      { label: 'Settings', onClick: () => { setTimeout(settingsDialog, 0); } },
      { label: 'Records and medals', onClick: () => { setTimeout(recordsDialog, 0); } },
      { label: 'Controls', onClick: () => { setTimeout(helpDialog, 0); } },
      ...(platform.isDesktop ? [{ label: 'Quit to desktop', danger: true, onClick: () => { confirmDialog('Quit the game?', 'Unsaved progress is lost.', 'Quit', () => platform.quit()); return true; } }] : []),
    ] });
}
function confirmDialog(title, text, okLabel, onOk) {
  showModal({ title, html: `<p>${esc(text)}</p>`, buttons: [{ label: okLabel, danger: true, onClick: () => { onOk(); } }, { label: 'Cancel', primary: true }] });
}
function settingsDialog() {
  const s = profile.settings;
  const box = showModal({ title: 'Settings', onClose: () => { saveProfile(); },
    html: `<label class="dm"><input type="checkbox" id="setSound" ${s.sound ? 'checked' : ''}> Sound effects</label>
      <label class="sl"><span class="slh"><span>Volume</span><b id="vVol">${Math.round(s.volume * 100)}%</b></span><input type="range" id="setVol" min="0" max="100" value="${Math.round(s.volume * 100)}"></label>
      <label class="sl"><span class="eyebrow">Autosave</span><select id="setAuto"><option value="off">Off</option><option value="yearly">Every year</option><option value="5y">Every 5 years</option></select></label>
      <label class="sl"><span class="eyebrow">Interface size</span><select id="setScale"><option value="0.9">90%</option><option value="1">100%</option><option value="1.15">115%</option><option value="1.3">130%</option></select></label>
      <label class="dm"><input type="checkbox" id="setWar" ${s.confirmWar ? 'checked' : ''}> Ask before declaring war</label>
      <div class="btns"><button id="setFull">Toggle fullscreen (F11)</button></div>`,
    buttons: [{ label: 'Done', primary: true }] });
  $('setAuto').value = s.autosave; $('setScale').value = String(s.uiScale);
  $('setSound').onchange = e => { s.sound = e.target.checked; applySettings(); };
  $('setVol').oninput = e => { s.volume = +e.target.value / 100; $('vVol').textContent = e.target.value + '%'; applySettings(); };
  $('setVol').onchange = () => { unlockAudio(); sfx.ding(); };
  $('setAuto').onchange = e => { s.autosave = e.target.value; };
  $('setScale').onchange = e => { s.uiScale = +e.target.value; applySettings(); map.resize(); };
  $('setWar').onchange = e => { s.confirmWar = e.target.checked; };
  $('setFull').onclick = () => platform.toggleFullscreen();
}
function recordsDialog() {
  const r = profile.records, got = D.medals.filter(m => r.medals[m.k]).length;
  showModal({ title: 'Records and medals', wide: true,
    html: `<div class="keys"><span class="sub">Games</span><b>${r.games}</b><span class="sub">Wins</span><b>${r.wins}</b><span class="sub">Best score</span><b>${num(r.best)}</b><span class="sub">Medals</span><b>${got} of ${D.medals.length}</b></div>
      <div class="medals">${D.medals.map(m => `<div class="medal ${r.medals[m.k] ? 'got' : ''}"><strong>${m.n}</strong><span>${m.d}</span></div>`).join('')}</div>`,
    buttons: [{ label: 'Close', primary: true }] });
}
function helpDialog() {
  const k = [['Left-click', 'Select a province or army'], ['Shift + left-click', 'Add or remove an army from the selection'], ['Right-click', 'March selected armies to a province'], ['Drag', 'Pan the map'], ['Mouse wheel', 'Zoom'], ['Double-click', 'Zoom in on a spot'], ['W A S D / arrows', 'Pan'], ['+ / −', 'Zoom'], ['Home', 'Jump to your capital'], ['Space', 'Pause or play'], ['1–5', 'Game speed'], ['F1–F6', 'Selection, Economy, Wars, Research, Nations, Log'], ['Ctrl+S / Ctrl+O', 'Save / load'], ['F5 / F9', 'Quicksave / quickload'], ['F11', 'Fullscreen'], ['Esc', 'Deselect, close a window, or open the menu']];
  showModal({ title: 'Controls', html: `<div class="keys">${k.map(([a, b]) => `<kbd>${a}</kbd><span>${b}</span>`).join('')}</div>`, buttons: [{ label: 'Close', primary: true }] });
}

boot().catch(err => { document.body.innerHTML = `<pre style="padding:20px;color:#ef7457;white-space:pre-wrap">Failed to start:\n${esc(err.stack || err)}</pre>`; });

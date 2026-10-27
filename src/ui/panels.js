// Side panel tabs. Rendering is plain HTML strings; clicks are handled by one delegated listener
// using data-act / data-arg attributes, so re-rendering never loses event handlers.
import * as G from '../sim/game.js';
import { S, D } from '../sim/game.js';
import { num, kfmt, fmtPop, fmtGdp, fmtPct, dateStr, esc, chip, natName, fmtMsg } from './format.js';

export const TABS = [
  { k: 'sel', n: 'Selection', key: 'Q' }, { k: 'econ', n: 'Economy', key: 'E' }, { k: 'wars', n: 'Wars', key: 'W' },
  { k: 'tech', n: 'Research', key: 'R' }, { k: 'nations', n: 'Nations', key: 'N' }, { k: 'log', n: 'Log', key: 'L' }];

const btn = (act, arg, label, opts = {}) => `<button data-act="${act}" data-arg="${arg ?? ''}" class="${opts.cls || ''}" ${opts.dis ? 'disabled' : ''} ${opts.title ? `title="${esc(opts.title)}"` : ''}>${label}</button>`;
const row = (k, v, cls) => `<dt>${k}</dt><dd class="${cls || ''}">${v}</dd>`;

export function armyStatus(a) {
  const here = S.P[a.prov];
  if (G.inBattle(a.prov) && a.prog === 0) return 'In battle';
  if (a.retreat) return 'Retreating';
  if (a.path.length) { const dest = S.P[a.path[a.path.length - 1]]; const days = Math.round((1 - a.prog) * a.hop + (a.path.length - 1) * 6); return `Marching to ${esc(dest.name)} · ~${days} days`; }
  if (here.siege && here.siege.nat === a.nat) return `Besieging ${esc(here.name)} · ${Math.round(here.siege.prog * 100)}%`;
  return `Idle in ${esc(here.name)}`;
}

// ---------- Selection ----------
function tabSel(ui) {
  const p = G.player();
  if (!ui.sel) {
    let h = `<h2>Command</h2><p class="hint">Left-click a province to inspect it. Left-click your army counter (gold outline) to select it, shift-click to add more, then right-click a province to march there.</p>`;
    if (p && p.alive) {
      const ar = G.armiesOf(p);
      h += `<h3>Your armies</h3>` + (ar.length ? `<div class="list">${ar.map(a => `<button class="li" data-act="selArmy" data-arg="${a.id}"><span><b>${num(a.troops)}</b> troops</span><span class="sub">${armyStatus(a)}</span></button>`).join('')}</div>` : `<p class="hint">You have no armies. Recruit one on the Economy tab.</p>`);
    }
    return h;
  }
  if (ui.sel.kind === 'armies') return tabArmies(ui);
  return tabProvince(ui);
}
function tabArmies(ui) {
  const list = ui.sel.ids.map(id => S.armies.find(a => a.id === id)).filter(Boolean);
  if (!list.length) { ui.sel = null; return tabSel(ui); }
  const n = S.nations[list[0].nat], mine = n.you;
  if (list.length === 1) {
    const a = list[0], others = mine ? S.armies.filter(o => o !== a && o.nat === a.nat && o.prov === a.prov && o.prog === 0 && !o.path.length) : [];
    const lim = mine ? G.recruitLimits() : null;
    return `<div class="eyebrow">${mine ? 'Your army' : 'Army of ' + esc(n.name)}</div><h2>${chip(n)}${num(a.troops)} troops</h2>
      <dl>${row('Status', armyStatus(a))}${row('Fighting strength', `×${G.quality(n).toFixed(2)} per soldier`)}${mine ? row('Upkeep', fmtGdp(a.troops * lim.upkeepPer) + ' a month') : ''}</dl>
      ${mine ? `<p class="hint">Right-click a province to march there. Discharged soldiers return half to your manpower pool.</p>
      <div class="btns">${btn('stop', a.id, 'Stop', { dis: !a.path.length || a.retreat })}${btn('split', a.id, 'Split in half', { dis: a.troops < 2000 || a.path.length > 0 })}
      ${others.length ? btn('merge', [a.id, ...others.map(o => o.id)].join(','), `Merge ${others.length} here`) : ''}
      ${btn('dis25', a.id, 'Discharge 25%', { dis: a.troops < 2000 })}${btn('disband', a.id, ui.confirm === 'disband:' + a.id ? 'Confirm disband' : 'Disband', { cls: 'danger' })}</div>` : ''}
      <div class="btns">${btn('selProv', a.prov, 'Open province')}${btn('deselect', '', 'Deselect')}</div>`;
  }
  const total = list.reduce((s, a) => s + a.troops, 0), sameProv = list.every(a => a.prov === list[0].prov && !a.path.length);
  return `<div class="eyebrow">${list.length} armies selected</div><h2>${chip(n)}${num(total)} troops</h2>
    <div class="list">${list.map(a => `<button class="li" data-act="selArmy" data-arg="${a.id}"><span><b>${num(a.troops)}</b></span><span class="sub">${armyStatus(a)}</span></button>`).join('')}</div>
    ${mine ? `<p class="hint">Right-click a province to send them all there.</p><div class="btns">${btn('stopAll', '', 'Stop all')}${sameProv ? btn('merge', list.map(a => a.id).join(','), 'Merge into one') : ''}${btn('deselect', '', 'Deselect')}</div>` : ''}`;
}
function tabProvince(ui) {
  const p = G.player(), pr = S.P[ui.sel.id], owner = pr.owner != null ? S.nations[pr.owner] : null, ctrl = pr.ctrl != null ? S.nations[pr.ctrl] : null;
  let h = `<div class="eyebrow">Province</div><h2>${esc(pr.name)}</h2><dl>
    ${row('Owner', owner ? chip(owner) + natName(owner) + (owner.cap === pr.id ? ' · capital' : '') : 'Free province')}
    ${ctrl && ctrl !== owner ? row('Occupied by', chip(ctrl) + natName(ctrl)) : ''}
    ${row('Resource', `<span class="rdot" style="background:${D.resources[pr.res].c}"></span>${D.resources[pr.res].n} <span class="sub">· ${D.resources[pr.res].d}</span>`)}
    ${row('Population', fmtPop(pr.pop))}${row('GDP', fmtGdp(pr.gdp))}${row('Garrison', num(G.garrison(pr)))}
    ${pr.siege ? row('Siege', chip(S.nations[pr.siege.nat]) + Math.round(pr.siege.prog * 100) + '%') : ''}
    ${G.devastated(pr) ? row('Status', 'Devastated until ' + dateStr(pr.devUntil), 'neg') : ''}
    ${pr.coastal ? row('Coast', pr.seaN.length ? `Sea routes to ${pr.seaN.map(i => esc(S.P[i].name)).join(', ')}` : 'Coastal') : ''}</dl>`;
  if (!p || !p.alive || S.phase !== 'game') return h;
  if (!owner) h += `<p class="hint">Free land. March an army here to annex it. About ${kfmt(G.garrison(pr) * 3)} troops siege at full speed.</p>`;
  if (owner && owner.you && pr.ctrl === p.id) {
    h += `<h3>Buildings</h3><div class="blds">${Object.keys(D.buildings).map(k => {
      const B = D.buildings[k], lv = pr.b[k]; if (B.coast && !pr.coastal) return '';
      let act;
      if (pr.build && pr.build.k === k) act = `<span class="sub">Building · done ${dateStr(pr.build.done)}</span>`;
      else if (lv >= B.max) act = `<span class="sub">Max level</span>`;
      else { const c = G.buildCost(pr, k), poor = p.treasury < c; act = btn('build', `${pr.id}:${k}`, poor ? 'Need ' + fmtGdp(c) : 'Build · ' + fmtGdp(c), { dis: !!pr.build || poor }); }
      return `<div class="bld"><div><b>${B.n}</b> <span class="lv">${'■'.repeat(lv)}${'□'.repeat(B.max - lv)}</span><div class="sub">${B.d}</div></div>${act}</div>`;
    }).join('')}</div><p class="hint">One project at a time per province. Construction takes ${Math.round(D.balance.buildDays / 30)} months and is paid up front.</p>
    <div class="btns">${btn('recHere', pr.id, 'Recruit here')}</div>`;
  }
  if (owner && !owner.you && owner.alive) {
    const w = G.warBetween(p.id, owner.id), tr = G.truceWith(p.id, owner.id), al = G.allied(p.id, owner.id);
    h += `<h3>${chip(owner)}${esc(owner.name)}</h3><dl>${row('Government', D.govMap[owner.gov].n)}${row('Leader', D.leaderMap[owner.leader].n)}${row('Trait', D.traitMap[owner.trait].n)}
      ${row('Army', num(G.troopsOf(owner)))}${row('Provinces', G.provsOf(owner).length)}${owner.allies.length ? row('Allies', owner.allies.map(i => natName(S.nations[i])).join(', ')) : ''}
      ${row('Relation', w ? `At war · score ${G.warScore(w, p.id)}%` : al ? 'Your ally' : tr ? `Truce until ${dateStr(p.truce[owner.id])}` : 'At peace', w ? 'neg' : al ? 'pos' : '')}</dl><div class="btns">`;
    if (!w && !al) h += btn('dow', owner.id, ui.confirm === 'dow:' + owner.id ? 'Confirm: declare war' : 'Declare war', { cls: 'danger', dis: tr });
    if (!w && !al) h += btn('ally', owner.id, `Propose alliance · ${Math.round(G.allianceChance(p, owner) * 100)}%`);
    if (al) h += btn('unally', owner.id, 'Break alliance');
    h += `</div>`;
  }
  const tgt = ctrl || owner;
  if (tgt && !tgt.you && G.atWar(p.id, tgt.id) && G.hasNuke(p)) {
    const ready = G.nukeReady(p);
    h += `<div class="btns">${btn('nuke', pr.id, ready ? (ui.confirm === 'nuke:' + pr.id ? 'Confirm nuclear strike' : 'Nuclear strike') : 'Nukes rearming until ' + dateStr(p.lastNuke + D.balance.nukeCooldownYears * 360), { cls: 'danger', dis: !ready })}</div>`;
  }
  return h;
}

// ---------- Economy (built once, then updated in place so sliders keep working while dragging) ----------
export function buildEcon() {
  return `<h2>Economy and army</h2>
  <div class="budget">
    <div class="brow"><span>Treasury</span><b id="eTreas"></b></div>
    <div class="brow"><span>Taxes</span><b id="eInc" class="pos"></b></div>
    <div class="brow"><span>Army upkeep</span><b id="eUp" class="neg"></b></div>
    <div class="brow total"><span>Net per month</span><b id="eNet"></b></div>
    <div class="brow"><span>Treasury in 12 months</span><b id="eFc"></b></div>
  </div>
  <div class="budget">
    <div class="brow"><span>Force limit</span><b id="eFL"></b></div>
    <div class="brow"><span>Soldiers in arms</span><b id="eArms"></b></div>
    <div class="brow"><span>Manpower pool</span><b id="eMP"></b></div>
  </div>
  <h3>Policy</h3>
  <label class="sl"><span class="slh"><span>Tax rate</span><b id="vTax"></b></span><input type="range" id="sTax" min="5" max="30" step="1"><span class="hint" id="hTax"></span></label>
  <label class="sl"><span class="slh"><span>Conscription</span><b id="vCon"></b></span><input type="range" id="sCon" min="0.5" max="12" step="0.5"><span class="hint" id="hCon"></span></label>
  <label class="sl"><span class="slh"><span>Army maintenance</span><b id="vMnt"></b></span><input type="range" id="sMnt" min="50" max="100" step="5"><span class="hint" id="hMnt"></span></label>
  <h3>Recruit an army</h3>
  <div class="recruit">
    <label class="sl"><span class="sub">Province</span><select id="rProv"></select></label>
    <label class="sl"><span class="slh"><span>Soldiers</span><b id="vTroops"></b></span><input type="range" id="rTroops" min="0" max="1000" step="1" value="250"></label>
    <span class="hint" id="rInfo"></span>
    <button class="primary" data-act="recruit" id="rGo">Raise army</button>
  </div>
  <h3>Provinces</h3>
  <div id="provList" class="ptable"></div>`;
}
export function recruitInfo(ui) {
  const p = G.player(), lim = G.recruitLimits();
  const ps = G.provsOf(p).filter(q => q.ctrl === p.id);
  if (ui.recProv == null || !ps.some(q => q.id === ui.recProv)) ui.recProv = ps.some(q => q.id === p.cap) ? p.cap : (ps[0] ? ps[0].id : null);
  const el = document.getElementById('rTroops'), frac = el ? +el.value / 1000 : .25;
  const tr = Math.min(lim.max, Math.max(1000, Math.round(lim.max * frac / 100) * 100));
  const cost = tr * lim.costPer, up = tr * lim.upkeepPer;
  return { ...lim, tr, cost, up, ps, prov: ui.recProv, ok: lim.max >= 1000 && p.treasury >= cost && ui.recProv != null && !S.result };
}
export function updateEcon(ui) {
  const p = G.player(); if (!p || !document.getElementById('eTreas')) return;
  const m = G.monthlyIncome(p), fl = G.forceLimit(p), $ = id => document.getElementById(id);
  const set = (id, t, cls) => { const e = $(id); if (!e) return; if (e.textContent !== t) e.textContent = t; if (cls !== undefined) e.className = cls; };
  set('eTreas', fmtGdp(p.treasury), p.treasury < 0 ? 'neg' : '');
  set('eInc', '+' + fmtGdp(m.inc)); set('eUp', '−' + fmtGdp(m.up));
  set('eNet', (m.net >= 0 ? '+' : '') + fmtGdp(m.net), m.net < 0 ? 'neg' : 'pos');
  const fc = p.treasury + m.net * 12; set('eFc', fmtGdp(fc), fc < 0 ? 'neg' : '');
  set('eFL', num(fl)); set('eArms', num(G.troopsOf(p)), G.troopsOf(p) > fl ? 'neg' : ''); set('eMP', `${num(p.manpower)} · +${kfmt(fl * .025)}/mo`);
  const growth = -(p.tax - .15) * .012 * 12 * 100;
  set('vTax', Math.round(p.tax * 100) + '%');
  set('hTax', `${fmtGdp(m.inc)} a month. GDP growth ${growth >= 0 ? '+' : ''}${growth.toFixed(1)} pts a year${p.tax > .2 ? '. Above 20% causes unrest and revolutions' : ''}.`);
  set('vCon', fmtPct(p.milPct));
  set('hCon', `Force limit ${kfmt(fl)}, manpower +${kfmt(fl * .025)} a month${p.milPct > 3 ? `. Costs ${(Math.max(0, p.milPct - 3) * .0002 * 12 * 100).toFixed(1)} pts of GDP growth a year` : ''}.`);
  set('vMnt', Math.round(p.maint * 100) + '%');
  set('hMnt', `Upkeep ${fmtGdp(m.up)} a month. Fighting strength ×${(.6 + .4 * p.maint).toFixed(2)}, reinforcement at ${Math.round(p.maint * 100)}% speed.`);
  for (const [id, v] of [['sTax', Math.round(p.tax * 100)], ['sCon', p.milPct], ['sMnt', Math.round(p.maint * 100)]]) if (document.activeElement !== $(id) && +$(id).value !== v) $(id).value = v;
  const r = recruitInfo(ui), sig = r.ps.map(q => q.id).join(',');
  if ($('rProv').dataset.sig !== sig) { $('rProv').innerHTML = r.ps.map(q => `<option value="${q.id}">${esc(q.name)}${q.id === p.cap ? ' (capital)' : ''}</option>`).join(''); $('rProv').dataset.sig = sig; }
  if (r.prov != null && document.activeElement !== $('rProv') && +$('rProv').value !== r.prov) $('rProv').value = r.prov;
  set('vTroops', r.max >= 1000 ? num(r.tr) : '—');
  set('rInfo', r.max < 1000 ? (G.troopsOf(p) >= fl ? 'You are at your force limit. Raise conscription or discharge troops.' : 'Not enough manpower yet. It refills every month.') : `Costs ${fmtGdp(r.cost)} now and ${fmtGdp(r.up)} a month. Up to ${num(r.max)} available.${p.treasury < r.cost ? ' Not enough money.' : ''}`);
  $('rGo').disabled = !r.ok; $('rTroops').disabled = r.max < 1000;
  const html = `<div class="pth"><span>Province</span><span>Pop</span><span>GDP</span><span>Buildings</span></div>` + G.provsOf(p).sort((a, b) => b.gdp - a.gdp).map(q => {
    const bl = Object.keys(D.buildings).map(k => q.b[k] ? `<span class="bp" style="background:${D.buildings[k].c}" title="${D.buildings[k].n} ${q.b[k]}">${q.b[k]}</span>` : '').join('') + (q.build ? `<span class="sub"> +${D.buildings[q.build.k].n}</span>` : '');
    return `<button class="ptr" data-act="selProv" data-arg="${q.id}"><span><span class="rdot" style="background:${D.resources[q.res].c}"></span>${esc(q.name)}${q.ctrl !== p.id ? ' <span class="neg">occupied</span>' : ''}</span><span>${kfmt(q.pop * 1e6)}</span><span>${fmtGdp(q.gdp)}</span><span>${bl || '<span class="sub">—</span>'}</span></button>`;
  }).join('');
  const pl = $('provList'); if (pl.dataset.h !== html) { pl.innerHTML = html; pl.dataset.h = html; }
}

// ---------- Wars ----------
function tabWars(ui) {
  const p = G.player(), mine = p ? G.warsOf(p.id) : [];
  let h = `<h2>Wars</h2>`;
  if (!mine.length) h += `<p class="hint">${p && p.alive ? 'At peace. Select a rival province to declare war, or march into free land to grow.' : '—'}</p>`;
  for (const w of mine) {
    const e = S.nations[G.enemyIn(w, p.id)], sc = G.warScore(w, p.id), occ = G.occupiedBy(w, p.id);
    const chosen = ui.peaceSel[w.id] || (ui.peaceSel[w.id] = []);
    for (const id of chosen.slice()) if (!occ.some(q => q.id === id)) chosen.splice(chosen.indexOf(id), 1);
    const cost = G.demandCost(chosen), okD = chosen.length && G.aiAccepts(w, p.id, chosen), okW = G.aiAccepts(w, p.id, []);
    const them = G.surrenderStatus(w, p.id), us = G.surrenderStatus(w, e.id), pc = x => Math.round(Math.max(0, x) * 100);
    const coll = (s, who) => `${who}: land occupied ${pc(s.landPct)}% / 100% · army lost ${pc(s.lost)}% / 70%`;
    h += `<div class="war"><div class="warhead">${chip(e)}${natName(e)}<span class="sub">since ${dateStr(w.start)}</span></div>
      <div class="score"><span class="mid"></span><span class="fill ${sc >= 0 ? 'pos' : 'neg'}" style="${sc >= 0 ? `left:50%;width:${sc / 2}%` : `right:50%;width:${-sc / 2}%`}"></span></div>
      <div class="hint">War score ${sc > 0 ? '+' : ''}${sc}% · you occupy ${occ.length} of their provinces · battles ${w.a === p.id ? w.bs.a : w.bs.b}% vs ${w.a === p.id ? w.bs.b : w.bs.a}%</div>
      <div class="hint">Forced surrender when both are met. ${coll(them, 'Them')}. ${coll(us, 'You')}.</div>
      ${occ.length ? `<div class="demands">${occ.map(q => `<label class="dm"><input type="checkbox" data-act="demand" data-arg="${w.id}:${q.id}" ${chosen.includes(q.id) ? 'checked' : ''}> ${esc(q.name)}<span class="sub"> · ${D.resources[q.res].n} · costs ${G.provValue(q)}%</span></label>`).join('')}</div>` : ''}
      <div class="btns">${occ.length ? btn('peace', w.id, `Demand ${chosen.length ? `${chosen.length} · ${cost}%` : 'provinces'}${chosen.length && !okD ? ' · they refuse' : ''}`, { cls: okD ? 'primary' : '', dis: !okD }) : ''}
      ${btn('white', w.id, 'White peace' + (okW ? '' : ' · they refuse'), { dis: !okW })}</div></div>`;
  }
  const others = S.wars.filter(w => !p || (w.a !== p.id && w.b !== p.id));
  if (others.length) h += `<h3>Other wars</h3><div class="otherwars">${others.map(w => { const A = S.nations[w.a], B = S.nations[w.b], s = G.warScore(w, w.a); return `<div>${chip(A)}${esc(A.name)} vs ${chip(B)}${esc(B.name)} <span class="sub">${s > 0 ? '+' : ''}${s}%</span></div>`; }).join('')}</div>`;
  return h;
}

// ---------- Research ----------
function tabTech() {
  const p = G.player(); if (!p) return '';
  const cost = G.techCost(p), av = G.techAvail(p);
  let h = `<h2>Research</h2><div class="hint">${Math.floor(p.rp)} of ${cost} points · +${(G.researchPerMonth(p) * 12).toFixed(1)} a year (grows with GDP)</div><div class="bar"><span style="width:${Math.min(100, p.rp / cost * 100)}%"></span></div>`;
  if (S.techOffers.length && p.rp >= cost) {
    h += `<h3>Breakthrough ready · pick one</h3><div class="techs">${S.techOffers.map(k => { const t = D.techMap[k], c = cost + G.techExtra(p, t); return `<button class="tech" data-act="research" data-arg="${k}" ${p.rp >= c ? '' : 'disabled'}><strong>${t.n}</strong><small>${t.d}${c > cost ? ` · needs ${Math.ceil(c)} pts` : ''}</small></button>`; }).join('')}</div>`;
  } else if (!av.length) h += `<p class="hint">Every technology is researched.</p>`;
  else h += `<p class="hint">When the bar fills you choose one of three random technologies.</p>`;
  h += `<h3>Researched</h3>` + (p.techs.length ? `<div class="tags">${p.techs.map(k => `<span class="tag on" title="${esc(D.techMap[k].d)}">${D.techMap[k].n}</span>`).join('')}</div>` : '<p class="hint">Nothing yet.</p>');
  h += `<h3>Still to discover</h3><div class="techlist">${av.map(t => `<div><b>${t.n}</b><span class="sub">${t.d}</span></div>`).join('')}</div>`;
  return h;
}

// ---------- Nations ----------
function tabNations() {
  const p = G.player();
  let h = '';
  if (p) { const g = G.goalProgress(p); h += `<div class="goal"><div class="eyebrow">Goal · ${D.goals[S.goal].n} · ${D.difficulties[S.diff].n}</div><div class="bar"><span style="width:${Math.round(g.pct * 100)}%"></span></div><div class="hint">${S.result ? (S.result.won ? 'Achieved.' : 'Failed.') : g.txt}</div></div>`; }
  const list = S.nations.slice().sort((a, b) => (b.you - a.you) || (b.alive - a.alive) || (G.provsOf(b).length - G.provsOf(a).length));
  h += `<h2>Nations</h2><div class="ntable"><div class="nth"><span>Nation</span><span>Prov</span><span>Army</span><span>GDP</span></div>` + list.map(n => {
    let rel = '';
    if (p && n !== p) rel = G.atWar(n.id, p.id) ? '<span class="rel neg">war</span>' : G.allied(n.id, p.id) ? '<span class="rel pos">ally</span>' : G.truceWith(p.id, n.id) ? '<span class="rel">truce</span>' : '';
    return `<button class="ntr ${n.alive ? '' : 'dead'}" data-act="selNation" data-arg="${n.id}"><span>${chip(n)}${esc(n.name)}${n.you ? ' <span class="youtag">You</span>' : ''} ${rel}<span class="sub">${D.govMap[n.gov].n}</span></span><span>${n.alive ? G.provsOf(n).length : '—'}</span><span>${n.alive ? kfmt(G.troopsOf(n)) : '—'}</span><span>${n.alive ? fmtGdp(G.gdpOf(n)) : 'fallen'}</span></button>`;
  }).join('') + `</div>`;
  return h;
}

// ---------- Log ----------
function tabLog() {
  return `<h2>Dispatches</h2><div class="log">${S.log.slice(0, 150).map(e => `<div class="${e.c}"><span class="y">${dateStr(e.d)}</span><span>${fmtMsg(e.m)}</span></div>`).join('')}</div>`;
}

export function renderTab(ui) {
  switch (ui.tab) {
    case 'sel': return tabSel(ui);
    case 'wars': return tabWars(ui);
    case 'tech': return tabTech(ui);
    case 'nations': return tabNations(ui);
    case 'log': return tabLog(ui);
  }
  return '';
}

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
      <dl>${row('Status', armyStatus(a))}${row('Troops', `${kfmt(a.troops * G.mixOf(a))} swordsmen · ${kfmt(a.troops * (1 - G.mixOf(a)))} spearmen`)}${row('Formation', `${Math.round(G.mixEff(G.mixOf(a)) * 100)}% of ideal <span class="sub">· 1:1 fills both rows</span>`, G.mixEff(G.mixOf(a)) < .9 ? 'neg' : '')}${row('Morale', `${Math.round(G.mor(a) * 100)}%${G.mor(a) < G.MORALE.broken ? ' · broken, will be destroyed if caught' : G.mor(a) < G.MORALE.siegeMin ? ' · too low to siege' : ''}`, G.mor(a) < G.MORALE.siegeMin ? 'neg' : '')}${row('Fighting strength', `×${G.quality(n).toFixed(2)} per soldier`)}${mine ? row('Upkeep', fmtGdp(a.troops * lim.upkeepPer) + ' a month') : ''}</dl>
      ${mine ? `<p class="hint">Right-click a province to march there. Discharged soldiers return half to your manpower pool.</p>
      <div class="btns">${btn('stop', a.id, 'Stop', { dis: !a.path.length || a.retreat })}${btn('split', a.id, 'Split in half', { dis: a.troops < G.MIN_ARMY() * 2 || a.path.length > 0 })}
      ${others.length ? btn('merge', [a.id, ...others.map(o => o.id)].join(','), `Merge ${others.length} here`) : ''}
      ${btn('dis25', a.id, 'Discharge 25%', { dis: a.troops < G.MIN_ARMY() * 2 })}${btn('disband', a.id, ui.confirm === 'disband:' + a.id ? 'Confirm disband' : 'Disband', { cls: 'danger' })}</div>` : ''}
      <div class="btns">${btn('selProv', a.prov, 'Open province')}${btn('deselect', '', 'Deselect')}</div>`;
  }
  const total = list.reduce((s, a) => s + a.troops, 0), sameProv = list.every(a => a.prov === list[0].prov && !a.path.length);
  return `<div class="eyebrow">${list.length} armies selected</div><h2>${chip(n)}${num(total)} troops</h2>
    <div class="list">${list.map(a => `<button class="li" data-act="selArmy" data-arg="${a.id}"><span><b>${num(a.troops)}</b></span><span class="sub">${armyStatus(a)}</span></button>`).join('')}</div>
    ${mine ? `<p class="hint">Right-click a province to send them all there.</p><div class="btns">${btn('stopAll', '', 'Stop all')}${sameProv ? btn('merge', list.map(a => a.id).join(','), 'Merge into one') : ''}${btn('deselect', '', 'Deselect')}</div>` : ''}`;
}
function terrainText(pr) {
  const B = D.biomes[pr.biome], y = k => B.y[k] === 0 ? 'none' : `×${B.y[k]}`;
  return `<span class="rdot" style="background:${B.c}"></span>${B.n} <span class="sub">· farms ${y('farm')}, wood ${y('forestry')}, stone ${y('quarry')}</span>`;
}
const costText = c => Object.entries(c).map(([g, v]) => `${kfmt(v)} ${D.goods[g].n.toLowerCase()}`).join(' + ') || 'labour only';
function industrySummary(pr) {
  const ks = Object.keys(D.buildings).filter(k => pr.b[k]);
  return ks.length ? `<h3>Industry</h3><div class="tags">${ks.map(k => `<span class="tag">${D.buildings[k].n} ${pr.b[k]}</span>`).join('')}</div>` : '';
}
// Buildings in one of your provinces: output, how hard each works, the farm crop, and construction.
function industryPanel(pr, p) {
  const fw = G.freeWorkers(pr);
  let h = `<h3>Industry</h3><div class="inds">`;
  for (const k of Object.keys(D.buildings)) {
    const B = D.buildings[k], lv = pr.b[k], pl = G.canPlace(pr, k);
    if (!lv && !pl.ok) continue;
    const eco = B.kind !== 'mil', set = G.setting(pr, k), out = (pr.out && pr.out[k]) || 0, staffed = lv && eco ? (pr.staff?.[k] || 0) / (lv * Math.max(set, 1e-9)) : 0;
    const outG = eco ? Object.keys(B.methods ? G.outputsOf(pr, k) : B.out)[0] : null;
    let info = eco ? (lv ? `${kfmt(out)} ${D.goods[outG].n.toLowerCase()}/wk · ${kfmt(lv * B.jobs * set)} jobs · ${Math.round(Math.min(1, staffed) * 100)}% staffed` : `${kfmt(B.jobs)} jobs a level`) : B.d;
    if (eco && B.in && lv) { const sat = p.procSat?.[k]; if (sat != null && sat < .99) info += ` · <span class="neg">inputs ${Math.round(sat * 100)}%</span>`; }
    if (eco && B.kind === 'raw' && lv && (p.toolSat ?? 1) < .99) info += ` · <span class="neg">tools ${Math.round(p.toolSat * 100)}%</span>`;
    const c1 = G.buildCost(k, 1), c5 = G.buildCost(k, 5);
    const canB = pl.ok && !pr.build, ok1 = canB && G.canAfford(p, c1), ok5 = canB && !B.max && G.canAfford(p, c5);
    h += `<div class="ind"><div class="indh"><b>${B.n}</b>${lv ? `<span class="lvn">${lv}${B.max ? '/' + B.max : ''}</span>` : ''}</div>
      <div class="indc">${eco && lv ? `<select data-act="pset" data-arg="${pr.id}:${k}" title="How hard it works">${[1, .75, .5, .25, 0].map(v => `<option value="${v}" ${Math.abs(set - v) < .01 ? 'selected' : ''}>${v ? Math.round(v * 100) + '%' : 'Off'}</option>`).join('')}</select>` : ''}
      ${btn('build', `${pr.id}:${k}:1`, '+1', { dis: !ok1, title: `${costText(c1)} · ${kfmt(B.builders)} builders · ${B.weeks} weeks` })}${B.max ? '' : btn('build', `${pr.id}:${k}:5`, '+5', { dis: !ok5, title: `${costText(c5)} · ${kfmt(B.builders * 5)} builders · ${B.weeks} weeks` })}</div>
      <div class="sub indi">${info}${!pl.ok && lv ? ` · ${pl.why}` : ''}</div>
      ${k === 'farm' && lv ? `<div class="btns crop">${D.buildings.farm.methods.map(m => btn('crop', `${pr.id}:${m.k}`, m.n, { cls: (pr.crop || 'wheat') === m.k ? 'primary' : '' })).join('')}</div>` : ''}</div>`;
  }
  h += `</div>`;
  if (pr.build) {
    const B = D.buildings[pr.build.k], need = G.buildersNeeded(pr), st = pr.build.staffed || 0;
    h += `<div class="cons"><div><b>Building ${B.n}${pr.build.lv > 1 ? ' ×' + pr.build.lv : ''}</b> · ${Math.round(pr.build.prog * 100)}%</div><div class="bar"><span style="width:${Math.round(pr.build.prog * 100)}%"></span></div>
      <div class="sub">${kfmt(need)} builders needed · ${Math.round(st * 100)}% staffed${st < .99 ? ' · <span class="neg">not enough free workers here: lower a building\'s output to free some</span>' : ''}</div>
      <div class="btns">${btn('cancelBuild', pr.id, 'Cancel · half the materials back', { cls: 'danger' })}</div></div>`;
  } else h += `<p class="hint">${kfmt(fw)} free workers here. Builders come from free workers; hover +1 for the cost. One project at a time per province.</p>`;
  return h;
}
// Live battle: both sides' rows, morale and losses.
function battleBox(b) {
  const v = G.battleView(b), side = (s, nid, loss) => {
    const n = S.nations[nid], f = s.f;
    return `<div class="bside"><div>${chip(n)}<b>${esc(n.name)}</b></div><div class="sub">${kfmt(s.N)} troops · lost ${kfmt(loss)}</div>
      <div class="bar mor"><span style="width:${Math.round(s.mor * 100)}%"></span></div><div class="sub">Morale ${Math.round(s.mor * 100)}%</div>
      <div class="brows"><span></span><span>Sword</span><span>Spear</span><span>Front</span><b>${kfmt(f.fSw)}</b><b>${kfmt(f.fSp)}</b><span>Back</span><b>${kfmt(f.bSw)}</b><b>${kfmt(f.bSp)}</b><span>Reserve</span><b class="span2">${kfmt(f.res)}</b></div></div>`;
  };
  return `<div class="battle"><div class="eyebrow">Battle · day ${b.day} · ${D.biomes[S.P[b.prov].biome].n.toLowerCase()}, width ${kfmt(v.width)}</div>
    <div class="bsides">${side(v.a, b.a, b.cas.a)}${side(v.d, b.b, b.cas.b)}</div></div>`;
}
function tabProvince(ui) {
  const p = G.player(), pr = S.P[ui.sel.id], owner = pr.owner != null ? S.nations[pr.owner] : null, ctrl = pr.ctrl != null ? S.nations[pr.ctrl] : null;
  let h = `<div class="eyebrow">Province</div><h2>${esc(pr.name)}</h2><dl>
    ${row('Owner', owner ? chip(owner) + natName(owner) + (owner.cap === pr.id ? ' · capital' : '') : 'Free province')}
    ${ctrl && ctrl !== owner ? row('Occupied by', chip(ctrl) + natName(ctrl)) : ''}
    ${row('Terrain', terrainText(pr))}${pr.res === 'port' ? row('Harbour', 'Natural harbour: armies can cross sea routes') : ''}
    ${row('Population', `${fmtPop(pr.pop)} <span class="sub">· ${kfmt(G.workforce(pr))} can work</span>`)}
    ${owner && pr.ctrl === pr.owner ? row('Employed', `${Math.round((pr.emp || 0) * 100)}% <span class="sub">· ${kfmt(G.freeWorkers(pr))} free</span>`) : ''}
    ${row('GDP', fmtGdp(pr.gdp))}${row('Garrison', `${num(G.garrison(pr))} <span class="sub">· smallest army that can siege it</span>`)}
    ${pr.siege ? row('Siege', chip(S.nations[pr.siege.nat]) + Math.round(pr.siege.prog * 100) + '%') : ''}
    ${G.devastated(pr) ? row('Status', 'Devastated until ' + dateStr(pr.devUntil), 'neg') : ''}
    ${pr.coastal ? row('Coast', pr.seaN.length ? `Sea routes to ${pr.seaN.map(i => esc(S.P[i].name)).join(', ')}` : 'Coastal') : ''}</dl>`;
  const bt = S.battles.find(b => b.prov === pr.id); if (bt) h += battleBox(bt);
  if (!p || !p.alive || S.phase !== 'game') return h + industrySummary(pr);
  if (!owner) h += G.canColonise(p.id, pr)
    ? `<p class="hint">Free land. March an army of at least ${kfmt(G.garrison(pr))} here to annex it; about ${kfmt(G.garrison(pr) * 3)} sieges at full speed.</p>`
    : `<p class="hint">Free land, but out of reach. You can only annex land that borders your territory or has a sea route to one of your coastal provinces.</p>`;
  if (owner && owner.you && pr.ctrl === p.id) h += industryPanel(pr, p) + `<div class="btns">${btn('recHere', pr.id, 'Recruit here')}</div>`;
  else h += industrySummary(pr);
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
  return `<h2>Tribe and war band</h2>
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
  <h3>Food and industry</h3>
  <div class="budget">
    <div class="brow"><span>People fed with bread</span><b id="eFed"></b></div>
    <div class="brow"><span>Homes with firewood</span><b id="eWarm"></b></div>
    <div class="brow"><span>Stone tools supplied</span><b id="eTools"></b></div>
    <div class="brow"><span>Workers employed</span><b id="eEmp"></b></div>
  </div>
  <div id="stockTbl" class="stock"></div>
  <h3>Policy</h3>
  <label class="sl"><span class="slh"><span>Tax rate</span><b id="vTax"></b></span><input type="range" id="sTax" min="5" max="30" step="1"><span class="hint" id="hTax"></span></label>
  <label class="sl"><span class="slh"><span>Conscription</span><b id="vCon"></b></span><input type="range" id="sCon" min="0.5" max="12" step="0.5"><span class="hint" id="hCon"></span></label>
  <label class="sl"><span class="slh"><span>Army maintenance</span><b id="vMnt"></b></span><input type="range" id="sMnt" min="50" max="100" step="5"><span class="hint" id="hMnt"></span></label>
  <h3>Recruit an army</h3>
  <div class="recruit">
    <label class="sl"><span class="sub">Province</span><select id="rProv"></select></label>
    <label class="sl"><span class="slh"><span>Soldiers</span><b id="vTroops"></b></span><input type="range" id="rTroops" min="0" max="1000" step="1" value="250"></label>
    <label class="sl"><span class="slh"><span>Swordsmen share</span><b id="vMix"></b></span><input type="range" id="rMix" min="0" max="100" step="5" value="50"><span class="hint">Swordsmen hold the front row, spearmen the back. 50% is ideal.</span></label>
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
  const el = document.getElementById('rTroops'), frac = el ? +el.value / 1000 : .25, mx = document.getElementById('rMix'), mix = mx ? +mx.value / 100 : .5;
  let tr = Math.min(lim.max, Math.max(G.MIN_ARMY(), Math.round(lim.max * frac)));
  let sw = Math.min(Math.round(tr * mix), lim.swords), sp = Math.min(tr - Math.round(tr * mix), lim.spears);
  tr = sw + sp;
  const cost = tr * lim.costPer, up = tr * lim.upkeepPer;
  return { ...lim, tr, sw, sp, mix, cost, up, ps, prov: ui.recProv, ok: tr >= G.MIN_ARMY() && p.treasury >= cost && ui.recProv != null && !S.result };
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
  set('vTroops', r.max >= G.MIN_ARMY() ? num(r.tr) : '—'); set('vMix', Math.round(r.mix * 100) + '%');
  const why = G.troopsOf(p) >= fl ? 'You are at your force limit. Raise conscription or discharge troops.' : p.manpower < G.MIN_ARMY() ? 'Not enough manpower yet. It refills a little every day.' : 'Not enough swords or spears. Build swordsmiths and spearsmiths.';
  set('rInfo', r.max < G.MIN_ARMY() ? why : `${num(r.sw)} swordsmen and ${num(r.sp)} spearmen. In store: ${num(r.swords)} swords, ${num(r.spears)} spears. Costs ${fmtGdp(r.cost)} now and ${fmtGdp(r.up)} a month.${p.treasury < r.cost ? ' Not enough money.' : ''}`);
  $('rGo').disabled = !r.ok; $('rTroops').disabled = r.max < G.MIN_ARMY();
  const ps = G.provsOf(p).filter(q => q.ctrl === p.id), wf = ps.reduce((s, q) => s + G.workforce(q), 0), wk = ps.reduce((s, q) => s + (q.work || 0), 0);
  set('eFed', Math.round((p.fed ?? 1) * 100) + '%', (p.fed ?? 1) < .95 ? 'neg' : 'pos'); set('eWarm', Math.round((p.warm ?? 1) * 100) + '%', (p.warm ?? 1) < .95 ? 'neg' : 'pos'); set('eTools', Math.round((p.toolSat ?? 1) * 100) + '%', (p.toolSat ?? 1) < .95 ? 'neg' : '');
  set('eEmp', `${kfmt(wk)} of ${kfmt(wf)} · ${Math.round(wk / Math.max(1, wf) * 100)}%`);
  const f = p.flow || { prod: {}, use: {} };
  const st = `<div class="sth"><span>Goods</span><span>Stock</span><span>Made/wk</span><span>Used/wk</span></div>` + G.GOODS().map(g => {
    const net = (f.prod[g] || 0) - (f.use[g] || 0);
    return `<div class="str"><span><span class="rdot" style="background:${D.goods[g].c}"></span>${D.goods[g].n}</span><span>${kfmt(p.stock[g])}</span><span class="pos">${f.prod[g] ? '+' + kfmt(f.prod[g]) : '—'}</span><span class="${net < 0 ? 'neg' : ''}">${f.use[g] ? '−' + kfmt(f.use[g]) : '—'}</span></div>`;
  }).join('');
  const se = $('stockTbl'); if (se.dataset.h !== st) { se.innerHTML = st; se.dataset.h = st; }
  const html = `<div class="pth"><span>Province</span><span>Pop</span><span>Employed</span><span>Buildings</span></div>` + G.provsOf(p).sort((a, b) => b.pop - a.pop).map(q => {
    const bl = Object.keys(D.buildings).map(k => q.b[k] ? `<span class="bp" style="background:${D.buildings[k].c}" title="${D.buildings[k].n} ${q.b[k]}">${q.b[k]}</span>` : '').join('') + (q.build ? `<span class="sub"> +${D.buildings[q.build.k].n}</span>` : '');
    return `<button class="ptr" data-act="selProv" data-arg="${q.id}"><span><span class="rdot" style="background:${D.biomes[q.biome].c}"></span>${esc(q.name)}${q.ctrl !== p.id ? ' <span class="neg">occupied</span>' : ''}</span><span>${kfmt(q.pop * 1e6)}</span><span>${q.ctrl === p.id ? Math.round((q.emp || 0) * 100) + '%' : '—'}</span><span>${bl || '<span class="sub">—</span>'}</span></button>`;
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
    const T = G.TERMS, sel = ui.peaceSel[w.id] || (ui.peaceSel[w.id] = { provs: [], gold: 0, reps: false, allies: false });
    const mode = sel.mode || (sc >= 0 ? 'demand' : 'offer'), demand = mode === 'demand';
    const pool = demand ? occ : G.occupiedBy(w, e.id), payer = demand ? e : p;
    sel.provs = sel.provs.filter(id => pool.some(q => q.id === id));
    if (!payer.allies.length) sel.allies = false;
    const deal = { to: demand ? p.id : e.id, provs: sel.provs, gold: sel.gold, reps: sel.reps, allies: sel.allies };
    const cost = G.dealCost(G.normDeal(deal), w), empty = G.isWhite(G.normDeal(deal));
    const ok = !empty && G.aiAccepts(w, p.id, deal), okW = G.aiAccepts(w, p.id, []);
    const limit = demand ? `Your war score allows up to ${Math.max(0, sc)}%` : `They want at least ${G.requiredOffer(w, e.id)}%`;
    const them = G.surrenderStatus(w, p.id), us = G.surrenderStatus(w, e.id), pc = x => Math.round(Math.max(0, x) * 100);
    const coll = (s, who) => `${who}: land occupied ${pc(s.landPct)}% / 100% · army lost ${pc(s.lost)}% / 70%`;
    const term = (k, label, cst, on, dis) => `<label class="dm"><input type="checkbox" data-act="pterm" data-arg="${w.id}:${k}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}> ${label}<span class="sub"> · ${cst}%</span></label>`;
    const goldOpts = [0, 1, 2, 3].map(i => `<option value="${i}" ${sel.gold === i ? 'selected' : ''}>${i ? `${i * T.goldMonths} months of income · ${fmtGdp(G.goldAmount(payer, i))} · ${i * T.goldStep}%` : 'No gold'}</option>`).join('');
    h += `<div class="war"><div class="warhead">${chip(e)}${natName(e)}<span class="sub">since ${dateStr(w.start)}</span></div>
      <div class="score"><span class="mid"></span><span class="fill ${sc >= 0 ? 'pos' : 'neg'}" style="${sc >= 0 ? `left:50%;width:${sc / 2}%` : `right:50%;width:${-sc / 2}%`}"></span></div>
      <div class="hint">War score ${sc > 0 ? '+' : ''}${sc}% · you occupy ${occ.length} of their provinces · battles ${w.a === p.id ? w.bs.a : w.bs.b}% vs ${w.a === p.id ? w.bs.b : w.bs.a}%</div>
      <div class="hint">Forced surrender when both are met. ${coll(them, 'Them')}. ${coll(us, 'You')}.</div>
      ${G.isCrushed(w, e.id) ? `<div class="hint"><b>${esc(e.name)} is crushed.</b> Dictate the peace: their provinces cost ${Math.round(G.CRUSH_MULT * 100)}% of normal.${occ.length ? ' ' + btn('pall', w.id, 'Select all provinces') : ''}</div>` : ''}${G.isCrushed(w, p.id) ? `<div class="hint neg"><b>You are crushed.</b> ${esc(e.name)} will dictate terms.</div>` : ''}
      <div class="btns">${btn('pmode', w.id + ':demand', 'Demand terms', { cls: demand ? 'primary' : '' })}${btn('pmode', w.id + ':offer', 'Offer terms', { cls: demand ? '' : 'primary' })}</div>
      <div class="demands">
        ${pool.length ? pool.map(q => term('prov:' + q.id, `${demand ? 'Take' : 'Cede'} ${esc(q.name)} <span class="sub">${D.biomes[q.biome].n}</span>`, G.provCost(w, q.id), sel.provs.includes(q.id))).join('') : `<div class="hint">${demand ? 'You occupy none of their provinces.' : 'They occupy none of your provinces.'}</div>`}
        <label class="dm">${demand ? 'They pay' : 'You pay'} <select data-act="pterm" data-arg="${w.id}:gold">${goldOpts}</select></label>
        ${term('reps', `War reparations: ${Math.round(T.repsPct * 100)}% of ${demand ? 'their' : 'your'} income for ${T.repsYears} years`, T.reps, sel.reps)}
        ${term('allies', `${demand ? 'They break' : 'You break'} all alliances${payer.allies.length ? '' : ' (none)'}`, T.allies, sel.allies, !payer.allies.length)}
      </div>
      <div class="hint">Treaty cost ${cost}% · ${limit}.</div>
      <div class="btns">${btn('peace', w.id, `${demand ? 'Demand' : 'Offer'} treaty${empty ? '' : ` · ${cost}%`}${!empty && !ok ? ' · they refuse' : ''}`, { cls: ok ? 'primary' : '', dis: !ok })}
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

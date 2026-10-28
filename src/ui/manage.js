// Full management screens that open over the map: Resources, Buildings and Army.
// Same pattern as the side panel: plain HTML strings with data-act / data-arg, handled by one delegated listener.
import * as G from '../sim/game.js';
import { S, D } from '../sim/game.js';
import { num, kfmt, esc, chip, fmtGdp } from './format.js';
import { armyStatus, renderTab } from './panels.js';

export const SCREENS = [{ k: 'econ', n: 'Tribe', key: 'E' }, { k: 'res', n: 'Resources', key: 'G' }, { k: 'bld', n: 'Buildings', key: 'B' }, { k: 'army', n: 'Army', key: 'M' },
  { k: 'wars', n: 'Wars', key: 'V' }, { k: 'tech', n: 'Research', key: 'R' }, { k: 'nations', n: 'Nations', key: 'N' }, { k: 'log', n: 'Log', key: 'L' }];
const btn = (act, arg, label, o = {}) => `<button data-act="${act}" data-arg="${arg ?? ''}" class="${o.cls || ''}" ${o.dis ? 'disabled' : ''} ${o.title ? `title="${esc(o.title)}"` : ''}>${label}</button>`;
const card = (lab, val, sub, cls) => `<div class="mcard"><span class="eyebrow">${lab}</span><b class="${cls || ''}">${val}</b>${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;
const pct = x => Math.round((x ?? 1) * 100) + '%';
const q = x => (x > 0 && x < 10 ? (Math.round(x * 10) / 10).toString() : kfmt(x));   // small amounts keep a decimal
const dot = c => `<span class="rdot" style="background:${c}"></span>`;
const SHORT = { farm: 'Farm', forestry: 'Wood', quarry: 'Stone', toolsmith: 'Tools', bakery: 'Bakery', swordsmith: 'Sword', spearsmith: 'Spear', fort: 'Fort', harbour: 'Harbr' };
const USE_NAME = { people: 'People', construction: 'Construction', army: 'Recruiting and reinforcing', spoilage: 'Spoilage' };

// Small trend line for the last 26 weeks of a stock.
function spark(arr, col) {
  if (!arr || arr.length < 2) return '<span class="sub">—</span>';
  const w = 96, h = 22, mx = Math.max(...arr), mn = Math.min(...arr), r = mx - mn || 1;
  const pts = arr.map((v, i) => `${(i / (arr.length - 1) * w).toFixed(1)},${(h - 2 - (v - mn) / r * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6"/></svg>`;
}
const myProvs = p => G.provsOf(p).filter(x => x.ctrl === p.id);
// Where the people are: one bar split into employed, idle, soldiers and dependants (children and elderly).
function popStrip(p) {
  const b = G.popBreakdown(p), tot = Math.max(1, b.people), w = v => (v / tot * 100).toFixed(1) + '%';
  const seg = (v, c, lab) => v > 0 ? `<span style="width:${w(v)};background:${c}" title="${lab}: ${num(v)}"></span>` : '';
  const key = (c, lab, v, sub) => `<span class="pk"><i style="background:${c}"></i><b>${num(v)}</b> ${lab}${sub ? ` <span class="sub">${sub}</span>` : ''}</span>`;
  return `<div class="popstrip"><div class="pbar">${seg(b.employed, '#9ccc54', 'Employed')}${seg(b.free, '#f2b134', 'Idle workers')}${seg(b.soldiers, '#ef7457', 'In the army')}${seg(b.dependants, '#4b6478', 'Children and elderly')}</div>
    <div class="pkeys">${key('#9ccc54', 'employed', b.employed)}${key('#f2b134', 'idle', b.free, b.building ? `(${num(b.building)} building)` : 'can staff new buildings')}${key('#ef7457', 'in the army', b.soldiers, `${Math.round(b.soldiers / Math.max(1, b.raw) * 100)}% of workers`)}${key('#4b6478', 'children and elderly', b.dependants)}
    <span class="pk sub">${num(b.people)} people${b.occupiedPeople ? ` · ${num(b.occupiedPeople)} in occupied land` : ''}${b.deaths ? ` · ${num(b.deaths)} lost to war` : ''}</span></div></div>`;
}

export const manageHead = ui => { const s = SCREENS.find(x => x.k === ui.mg.tab) || SCREENS[0]; return `<div class="mhead"><nav class="mtabs"><button class="on">${s.n}<small>${s.key}</small></button></nav><button data-act="mgClose" class="mclose" title="Close (Esc)">Close</button></div>`; };
export function renderManage(ui) {
  const p = G.player(); if (!p) return '';
  const k = ui.mg.tab;
  const body = k === 'bld' ? buildings(p, ui) : k === 'army' ? army(p, ui) : k === 'res' ? resources(p, ui) : `<div class="wbody">${renderTab({ ...ui, tab: k })}</div>`;
  return `${manageHead(ui)}<div class="mscroll">${body}</div>`;
}

// ---------- Resources ----------
// Built to answer "what will we run short of, and when": a list of what to build next, then every good with
// what it is worth, what we make, what we need, and where it is heading once current construction finishes.
const STATUS = {
  short: ['neg', 'Short now'], falling: ['warn', 'Running down'], tight: ['warn', 'Will go short'], ok: ['', 'Balanced'],
  surplus: ['pos', 'Surplus'], unused: ['sub', 'Not used yet'], idle: ['sub', 'Not made'] };
const money = v => fmtGdp(v / 1e9);
function outlookText(o, g) {
  if (o.status === 'short') return `short by ${q(Math.max(0, o.need - o.prod))}/wk`;
  if (o.status === 'falling') return `runs out in ${Math.max(1, Math.floor(o.weeks))} wk`;
  if (o.status === 'tight') return o.pendIn > 0 ? 'short once new buildings open' : o.grow > 0 ? 'short as people grow' : 'short soon';
  if (o.status === 'surplus') return `+${q(o.net)}/wk spare${g === 'bread' || g === 'wheat' ? ' (spoils)' : ''}`;
  if (o.status === 'unused') return 'stockpiling';
  if (o.status === 'idle') return '—';
  return o.pendOut > 0 ? `more coming (+${q(o.pendOut)})` : 'steady';
}
function recLine(p, r) {
  const B = D.buildings[r.k], g = D.goods[r.g], w = D.goods[r.why], pb = G.popBreakdown(p);
  const why = r.reason === 'input' ? `${g.n} is held back: ${D.buildings[G.producerOf(r.g)].n.toLowerCase()} is short of ${w.n.toLowerCase()}.`
    : r.reason === 'short' ? `${g.n} is short right now.` : r.reason === 'falling' ? `${g.n} runs out in about ${Math.max(1, Math.floor(r.weeks))} weeks.`
    : r.reason === 'tight' ? `${g.n} will go short once growth and new buildings kick in.` : `${g.n} stock is low.`;
  if (r.impossible) return `<div class="rec bad">${dot(g.c)}<div><b>${why}</b><span class="sub">None of your land can hold a ${B.n.toLowerCase()}. Settle or take land where it can.</span></div></div>`;
  const best = G.bestProvinceFor(p, r.k), cost = G.buildCost(r.k, r.lv), ok = best && G.canAfford(p, cost), staff = pb.free >= r.jobs;
  return `<div class="rec ${r.reason === 'short' || r.reason === 'input' ? 'bad' : 'warn'}">${dot(w.c)}<div><b>${why}</b>
    <span class="sub">Build about <b>${r.lv} ${B.n.toLowerCase()}${r.lv > 1 ? ' levels' : ''}</b>: needs ${num(r.jobs)} workers (${num(pb.free)} idle${staff ? '' : ` · <span class="neg">free some by lowering other work or growing</span>`})${best ? ` · best in ${esc(best.name)}` : ' · no province free to build'}.</span></div>
    ${btn('mgBuildBest', `${r.k}:${Math.min(r.lv, 5)}`, `Build ${Math.min(r.lv, 5)}`, { cls: 'primary', dis: !ok, title: Object.entries(cost).map(([k, v]) => `${q(v)} ${D.goods[k].n.toLowerCase()}`).join(', ') || 'labour only' })}</div>`;
}
function resources(p, ui) {
  const O = G.goodsOutlook(p), go = O.goods || {}, people = G.popOf(p) * 1e6, gdp = G.gdpOf(p);
  let h = popStrip(p) + `<div class="mcards">${card('GDP', fmtGdp(gdp) + '/yr', `${money(gdp * 1e9 / Math.max(1, people))} per person · taxes ${pct(p.tax)}`)}
    ${card('Fed with bread', pct(p.fed), 'one bread per person a week', (p.fed ?? 1) < .95 ? 'neg' : 'pos')}
    ${card('Homes with firewood', pct(p.warm), `${q(people * (D.balance.econ.woodPerPerson || 0))} wood a week`, (p.warm ?? 1) < .95 ? 'neg' : 'pos')}
    ${card('Stone tools', pct(p.toolSat), 'farms, forestry and quarries need them', (p.toolSat ?? 1) < .95 ? 'neg' : '')}</div>`;
  h += `<h3>What to build next</h3>` + ((O.recs || []).length ? `<div class="recs">${O.recs.map(r => recLine(p, r)).join('')}</div>` : `<p class="hint pos">Nothing is running short, even counting what is being built and a growing population.</p>`);
  const sel = ui.mg.good || 'bread';
  h += `<h3>Goods</h3><div class="gtable"><div class="gth"><span>Good</span><span>Worth</span><span>Stock</span><span>Made/wk</span><span>Needed/wk</span><span>Outlook</span><span>Last 26 weeks</span></div>`;
  for (const g of G.GOODS()) {
    const o = go[g] || { stock: p.stock[g], prod: 0, need: 0, status: 'idle' }, [cls, lab] = STATUS[o.status] || STATUS.ok;
    h += `<button class="gtr ${sel === g ? 'on' : ''}" data-act="mgGood" data-arg="${g}"><span>${dot(D.goods[g].c)}${D.goods[g].n}<i class="tierb">T${D.goods[g].tier}</i></span><span>$${num(D.goods[g].price)}</span><span>${q(o.stock)}</span><span class="pos">${o.prod ? q(o.prod) : '—'}</span><span>${o.need ? q(o.need) : '—'}</span>
      <span class="olk ${cls}"><b>${lab}</b> ${outlookText(o, g)}</span><span>${spark((p.hist || {})[g], D.goods[g].c)}</span></button>`;
    if (sel === g) h += `<div class="gexp">${goodDetail(p, g, p.flow || {}, o)}</div>`;
  }
  h += `</div><p class="hint">Click a good to open or close its details. Made and needed are averages over the last few weeks. Needed includes workshops, people, construction and soldiers. "Will go short" counts buildings under construction and population growth over the next half year. T1 goods are raw, T2 are made from them and worth more.</p>`;
  return h;
}
function goodDetail(p, g, f, o) {
  const G1 = D.goods[g], by = (f.prodBy || {})[g] || {}, uby = (f.useBy || {})[g] || {};
  const list = (obj, nm) => { const e = Object.entries(obj).filter(([, v]) => v > 1e-6).sort((a, b) => b[1] - a[1]); const t = e.reduce((s, [, v]) => s + v, 0);
    return e.length ? e.map(([k, v]) => `<div class="brk"><span>${nm(k)}</span><span>${q(v)}</span><span class="bar"><span style="width:${(v / t * 100).toFixed(0)}%;background:${G1.c}"></span></span></div>`).join('') : '<p class="hint">Nothing last week.</p>'; };
  const bName = k => D.buildings[k] ? D.buildings[k].n : (USE_NAME[k] || k);
  const uName = k => k === 'people' ? (g === 'wood' ? 'Households (firewood)' : 'People (eating)') : bName(k);
  const maker = G.producerOf(g), makers = Object.keys(D.buildings).filter(k => { const B = D.buildings[k]; return B.kind !== 'mil' && (B.methods ? B.methods.some(m => m.out[g]) : B.out && B.out[g]); });
  const provs = myProvs(p).map(x => ({ x, v: makers.reduce((s, k) => s + ((x.out && x.out[k] && Object.keys(G.outputsOf(x, k))[0] === g) ? x.out[k] : 0), 0) })).filter(r => r.v > 0).sort((a, b) => b.v - a.v).slice(0, 6);
  const tips = { wheat: 'Only bakeries use wheat: people eat bread.', bread: 'Each person eats one bread a week.', wood: 'Bakeries burn it, workshops shape it, and every home needs firewood.', tools: 'Farms, forestry and quarries work at half speed without them.', fiber: 'Nothing uses fiber yet. It is for later tiers.', swords: 'One sword per swordsman, for recruiting and refilling losses.', spears: 'One spear per spearman.', stone: 'Workshops, construction and forts use it.' };
  const B = maker && D.buildings[maker], va = maker && p.vaBy ? p.vaBy[maker] : 0, lv = maker ? myProvs(p).reduce((s, x) => s + x.b[maker], 0) : 0;
  const recipe = B ? (B.in ? `${Object.entries(B.in).map(([k, v]) => `${q(v)} ${D.goods[k].n.toLowerCase()}`).join(' + ')} → ${q(B.out[g])} ${G1.n.toLowerCase()}` : `${B.jobs} workers → ${q(B.methods ? B.methods.find(m => m.out[g]).out[g] : B.out[g])} ${G1.n.toLowerCase()} (before land and tools)`) : '';
  const forecast = o ? `<div class="fcast"><span>Now</span><b class="${o.net < 0 ? 'neg' : 'pos'}">${o.net >= 0 ? '+' : '−'}${q(Math.abs(o.net))}/wk</b>
    ${o.pendOut ? `<span>New buildings</span><b class="pos">+${q(o.pendOut)}/wk</b>` : ''}${o.pendIn ? `<span>New demand</span><b class="neg">−${q(o.pendIn)}/wk</b>` : ''}${o.grow ? `<span>Growth (6 months)</span><b class="neg">−${q(o.grow)}/wk</b>` : ''}
    <span>Then</span><b class="${o.future < 0 ? 'neg' : 'pos'}">${o.future >= 0 ? '+' : '−'}${q(Math.abs(o.future))}/wk</b></div>` : '';
  return `<div><p class="hint">${tips[g] || ''}</p>
    ${B ? `<p class="hint"><b>${B.n}</b>: ${recipe}.${lv ? ` You have ${lv}, adding ${money(va || 0)} a week to GDP.` : ''}</p>` : ''}
    <h4>Outlook</h4>${forecast}</div>
    <div><h4>Made by</h4>${list(by, bName)}<h4>Used by</h4>${list(uby, uName)}</div>
    <div><h4>Top provinces</h4>${provs.length ? provs.map(r => `<button class="brk link" data-act="mgProv" data-arg="${r.x.id}"><span>${esc(r.x.name)}</span><span>${q(r.v)}</span><span class="sub">${D.biomes[r.x.biome].n}</span></button>`).join('') : '<p class="hint">None of your provinces makes it.</p>'}
    ${makers.length ? `<div class="btns">${makers.map(k => btn('mgBuildBest', `${k}:1`, `Build ${D.buildings[k].n.toLowerCase()} +1`, { title: 'In the province with the most free workers and the best land' })).join('')}</div>` : ''}</div>`;
}

// ---------- Buildings ----------
const econKeys = x => Object.keys(D.buildings).reduce((s, k) => s + (D.buildings[k].jobs ? x.b[k] * D.buildings[k].jobs * G.setting(x, k) : 0), 0);
function buildings(p, ui) {
  const ps = myProvs(p), keys = Object.keys(D.buildings);
  let h = popStrip(p) + `<h3>By building</h3><div class="btable"><div class="bth"><span>Building</span><span>Levels</span><span>Workers</span><span>Output/wk</span><span>Value/wk</span><span>Inputs</span><span>Work rate</span><span>Build where best</span></div>`;
  for (const k of keys) {
    const B = D.buildings[k], eco = B.kind !== 'mil';
    const lv = ps.reduce((s, x) => s + x.b[k], 0), building = S.P.filter(x => x.build && x.build.nat === p.id && x.build.k === k).reduce((s, x) => s + x.build.lv, 0);
    const want = ps.reduce((s, x) => s + x.b[k] * G.setting(x, k), 0), got = ps.reduce((s, x) => s + ((x.staff && x.staff[k]) || 0), 0);
    const out = ps.reduce((s, x) => s + ((x.out && x.out[k]) || 0), 0), og = eco ? Object.keys(B.methods ? B.methods[0].out : B.out)[0] : null;
    const rates = [...new Set(ps.filter(x => x.b[k]).map(x => G.setting(x, k)))], rate = rates.length === 1 ? rates[0] : null;
    const lim = (p.procLimit || {})[k];
    const inp = !eco || !lv ? '' : B.kind === 'raw' ? `tools ${pct(p.toolSat)}` : lim ? `${pct((p.procSat || {})[k])} · short of ${D.goods[lim].n.toLowerCase()}` : `${Object.keys(B.in).map(g => D.goods[g].n.toLowerCase()).join(', ')} 100%`;
    const inSat = B.kind === 'raw' ? p.toolSat ?? 1 : (p.procSat || {})[k] ?? 1;
    const best = G.bestProvinceFor(p, k), c1 = G.buildCost(k, 1), c5 = G.buildCost(k, 5);
    const ok1 = best && G.canAfford(p, c1), ok5 = best && !B.max && G.canAfford(p, c5);
    h += `<div class="btr"><span>${dot(B.c)}<b>${B.n}</b></span><span>${lv}${building ? ` <span class="sub">+${building}</span>` : ''}</span>
      <span title="People working here / jobs open at the current work rate">${eco && lv ? `${num(got * B.jobs)} / ${num(want * B.jobs)}${got < want * .95 ? ` <span class="neg">${pct(got / want)}</span>` : ''}` : '—'}</span><span>${eco && lv ? q(out) + ' ' + D.goods[k === 'farm' ? 'wheat' : og].n.toLowerCase() : '—'}</span><span title="Value added: what it makes, less what it uses up">${eco && lv ? money((p.vaBy || {})[k] || 0) : '—'}</span>
      <span class="${eco && lv && inSat < .95 ? 'neg' : ''}">${inp || '—'}</span>
      <span>${eco && lv ? `<select data-act="mgRate" data-arg="${k}">${rate == null ? '<option selected>Mixed</option>' : ''}${[1, .75, .5, .25, 0].map(v => `<option value="${v}" ${rate === v ? 'selected' : ''}>${v ? v * 100 + '%' : 'Off'}</option>`).join('')}</select>` : ''}</span>
      <span class="bbtn">${btn('mgBuildBest', `${k}:1`, '+1', { dis: !ok1, title: best ? `In ${best.name}` : 'No province free to build' })}${B.max ? '' : btn('mgBuildBest', `${k}:5`, '+5', { dis: !ok5, title: best ? `In ${best.name}` : 'No province free to build' })}<span class="sub">${best ? esc(best.name) : 'none free'}</span></span></div>`;
  }
  const jobsF = ps.reduce((s, x) => s + Math.min(G.workforce(x), x.work || 0), 0), jobsT = ps.reduce((s, x) => s + econKeys(x), 0);
  h += `<div class="btr total"><span><b>All buildings</b></span><span>${ps.reduce((s, x) => s + keys.reduce((t, k) => t + x.b[k], 0), 0)}</span><span>${num(jobsF)} / ${num(jobsT)}</span><span></span><span>${money(Object.values(p.vaBy || {}).reduce((s, v) => s + v, 0))}</span><span></span><span></span><span></span></div>`;
  h += `</div><p class="hint">Workers: people working there and jobs open at the current work rate. Farm output counts wheat and fiber together. "Build where best" picks the province with the most free workers, and the best land for farms, forestry and quarries.</p>`;
  // construction queue
  const cons = S.P.filter(x => x.build && x.build.nat === p.id);
  h += `<h3>Under construction</h3>`;
  h += cons.length ? `<div class="ctable">${cons.map(x => { const B = D.buildings[x.build.k], st = x.build.staffed || 0;
    return `<div class="ctr"><button class="link" data-act="mgProv" data-arg="${x.id}">${esc(x.name)}</button><span>${B.n}${x.build.lv > 1 ? ' ×' + x.build.lv : ''}</span><span class="bar"><span style="width:${Math.round(x.build.prog * 100)}%"></span></span><span class="${st < .99 && x.build.prog > 0 ? 'neg' : ''}">${x.build.prog > 0 || st > 0 ? pct(st) + ' builders' : 'starting'}</span>${btn('mgCancel', x.id, 'Cancel', { cls: 'danger', title: 'Half the materials come back' })}</div>`; }).join('')}</div>`
    : `<p class="hint">Nothing is being built.</p>`;
  // province grid
  const s = ui.mg.sort || { k: 'pop', d: -1 }, val = (x, k) => k === 'name' ? x.name : k === 'pop' ? x.pop : k === 'free' ? G.freeWorkers(x) : k === 'emp' ? x.emp || 0 : x.b[k];
  const rows = ps.slice().sort((a, b) => { const A = val(a, s.k), B2 = val(b, s.k); return (typeof A === 'string' ? A.localeCompare(B2) : A - B2) * s.d; });
  const hd = (k, lab, cls) => `<button data-act="mgSort" data-arg="${k}" class="${cls || ''} ${s.k === k ? 'on' : ''}">${lab}${s.k === k ? (s.d > 0 ? ' ▲' : ' ▼') : ''}</button>`;
  h += `<h3>By province</h3><div class="ptgrid" style="--cols:${keys.length}"><div class="pgh">${hd('name', 'Province')}${hd('pop', 'People')}${hd('emp', 'Working')}${hd('free', 'Idle')}${keys.map(k => hd(k, SHORT[k] || D.buildings[k].n, 'bc')).join('')}</div>`;
  for (const x of rows) {
    h += `<div class="pgr"><button class="link" data-act="mgProv" data-arg="${x.id}">${dot(D.biomes[x.biome].c)}${esc(x.name)}${x.id === p.cap ? ' ★' : ''}</button><span>${num(x.pop * 1e6)}</span><span title="${pct(x.emp || 0)} of ${num(G.workforce(x))} workers">${num(Math.min(G.workforce(x), x.work || 0))}</span><span class="${G.freeWorkers(x) > 5 ? 'pos' : ''}">${num(G.freeWorkers(x))}</span>`;
    for (const k of keys) {
      const lv = x.b[k], bl = x.build && x.build.k === k, okp = G.canPlace(x, k).ok || lv;
      h += `<span class="bc ${lv ? '' : 'zero'} ${bl ? 'blding' : ''}" title="${esc(D.buildings[k].n)}">${!okp ? '·' : lv || (bl ? '' : '–')}${bl ? `<i>+${x.build.lv}</i>` : ''}</span>`;
    }
    h += `</div>`;
  }
  h += `</div><p class="hint">Click a column to sort, or a province to open it in the side panel. · means the building can't go there (terrain or coast).</p>`;
  return h;
}

// ---------- Army ----------
function army(p, ui) {
  const lim = G.recruitLimits(), f = p.flow || { prod: {} }, ar = G.armiesOf(p), tr = G.troopsOf(p);
  const up = tr * lim.upkeepPer, rec = ui.mg.rec || (ui.mg.rec = { sw: 0, sp: 0 });
  const ps = myProvs(p); if (rec.prov == null || !ps.some(x => x.id === rec.prov)) rec.prov = ps.some(x => x.id === p.cap) ? p.cap : ps[0]?.id;
  const room = Math.floor(Math.min(p.manpower, lim.room));
  rec.sw = Math.max(0, Math.min(rec.sw, lim.swords, room)); rec.sp = Math.max(0, Math.min(rec.sp, lim.spears, room - rec.sw));
  const tot = rec.sw + rec.sp, cost = tot * lim.costPer, ok = tot >= G.MIN_ARMY() && p.treasury >= cost && rec.prov != null;
  let h = popStrip(p) + `<div class="mcards">${card('Soldiers', `${num(tr)} / ${num(lim.fl)}`, 'force limit from conscription', tr > lim.fl ? 'neg' : '')}
    ${card('Manpower', num(p.manpower), `+${q(lim.fl * .025)} a month`)}
    ${card('Swords', num(p.stock.swords), `+${q(f.prod.swords || 0)} a week`)}${card('Spears', num(p.stock.spears), `+${q(f.prod.spears || 0)} a week`)}
    ${card('Upkeep', fmtGdp(up), 'a month')}</div>`;
  h += `<div class="mgrid army"><div><h3>War bands</h3>`;
  if (!ar.length) h += `<p class="hint">You have no war bands. Raise one on the right.</p>`;
  else {
    h += `<div class="atable"><div class="ath"><span>Band</span><span>Where</span><span>Troops</span><span>Swords · spears</span><span>Formation</span><span>Morale</span><span></span></div>`;
    for (const a of ar.slice().sort((x, y) => y.troops - x.troops)) {
      const mx = G.mixOf(a), eff = G.mixEff(mx), mo = G.mor(a), others = ar.filter(o => o !== a && o.prov === a.prov && !o.path.length && o.prog === 0 && !a.path.length && a.prog === 0);
      h += `<div class="atr"><button class="link" data-act="mgArmy" data-arg="${a.id}"><b>${esc(G.armyName(a))}</b></button><span>${esc(S.P[a.prov].name)}<span class="sub">${armyStatus(a)}</span></span><span>${num(a.troops)}</span>
        <span>${num(a.troops * mx)} · ${num(a.troops * (1 - mx))}</span><span class="${eff < .9 ? 'neg' : ''}">${pct(eff)}</span>
        <span><span class="bar mor"><span style="width:${pct(mo)};${mo < G.MORALE.broken ? 'background:var(--danger)' : mo < G.MORALE.siegeMin ? 'background:var(--accent)' : ''}"></span></span><span class="sub">${pct(mo)}</span></span>
        <span class="bbtn">${btn('mgArmy', a.id, 'Locate')}${others.length ? btn('merge', [a.id, ...others.map(o => o.id)].join(','), 'Merge') : ''}${btn('split', a.id, 'Split', { dis: a.troops < G.MIN_ARMY() * 2 || a.path.length > 0 })}</span></div>`;
    }
    h += `</div><p class="hint">Formation is how well the mix fills the front row (swordsmen) and back row (spearmen); 1:1 is ideal. Under 50% morale a band cannot siege; under 25% it is destroyed if caught.</p>`;
  }
  h += `</div><div class="recbox"><h3>Raise a war band</h3>
    <label class="sl"><span class="sub">Muster at</span><select data-act="mgRecProv">${ps.map(x => `<option value="${x.id}" ${x.id === rec.prov ? 'selected' : ''}>${esc(x.name)}${x.id === p.cap ? ' (capital)' : ''}</option>`).join('')}</select></label>
    <label class="sl"><span class="slh"><span>Swordsmen</span><b id="mSwV">${num(rec.sw)}</b></span><input type="range" data-act="mgRecSw" min="0" max="${Math.max(0, Math.min(lim.swords, room))}" step="1" value="${rec.sw}"><span class="hint">${num(lim.swords)} swords in store</span></label>
    <label class="sl"><span class="slh"><span>Spearmen</span><b id="mSpV">${num(rec.sp)}</b></span><input type="range" data-act="mgRecSp" min="0" max="${Math.max(0, Math.min(lim.spears, room))}" step="1" value="${rec.sp}"><span class="hint">${num(lim.spears)} spears in store</span></label>
    <div class="btns">${btn('mgRecEven', '', 'Even 1:1, as many as possible')}${btn('mgRecClear', '', 'Clear')}</div>
    <p class="hint">${room < G.MIN_ARMY() ? (lim.room < G.MIN_ARMY() ? 'You are at your force limit. Raise conscription in the Tribe tab.' : 'Not enough manpower yet. It refills a little every day.') : `Room for ${num(room)} more. Formation ${pct(G.mixEff(tot ? rec.sw / tot : .5))}. Costs ${fmtGdp(cost)} now.`}</p>
    ${btn('mgRecruit', '', `Raise ${num(tot)} warriors`, { cls: 'primary', dis: !ok })}</div></div>`;
  return h;
}

// Player decision events, plus resolving any queued decision (events, calls to arms, peace offers).
import { S, R, pick, YEAR, N, log, addDecision, has, player, provsOf, gdpOf, armiesOf, neighbours, atWar } from './core.js';
import * as G from './core.js';
import { makeArmy } from './military.js';
import { declareWar, makePeace } from './diplomacy.js';
import { revolt } from './economy.js';

const scalePop = (n, f) => provsOf(n).forEach(p => p.pop *= f);
const scaleGdp = (n, f) => provsOf(n).forEach(p => p.gdp *= f);
const bigArmy = n => armiesOf(n).sort((x, y) => y.troops - x.troops)[0];
const fmt = v => Math.round(v).toLocaleString('en-IE');

export const EVENTS = {
  harvest: { title: 'Harvest failure', when: p => !has(p, 'green'), text: p => `Blight has struck the fields of ${p.name}. The granaries will not last the winter.`,
    ch: [{ l: 'Buy grain from traders', s: 'Costs 30% of your treasury', f: p => { p.treasury *= .7; p.stock.wheat += Math.max(50, G.popOf(p) * 1e6 * .5); return 'Traders bring grain upriver. The worst is avoided.'; } },
         { l: 'Tighten belts', s: 'Free, but people will starve', f: p => { p.stock.wheat *= .4; p.stock.bread *= .6; scalePop(p, .95); if (R() < .2) { revolt(p); return 'Hunger turns into revolt.'; } return 'Many go hungry. The tribe holds together, barely.'; } }] },
  defector: { title: 'A war chief defects', when: () => S.nations.some(n => n.alive && !n.you && armiesOf(n).length), pickC: () => pick(S.nations.filter(n => n.alive && !n.you && armiesOf(n).length)),
    text: (p, c) => `A war chief of ${c.name} offers to bring his warriors over to you.`,
    ch: [{ l: 'Welcome him', s: 'More warriors, small risk', f: (p, c) => { const e = bigArmy(c), me = bigArmy(p); if (!e) return 'He never shows up.'; const t = e.troops * .08; e.troops -= t; c.recruited = (c.recruited || 0) - t; p.recruited = (p.recruited || 0) + t; if (me) me.troops += t; else makeArmy(p, p.cap, t); if (R() < .25) { p.treasury *= .6; return `${fmt(t)} warriors join you. Then the chief vanishes with 40% of your treasury.`; } return `${fmt(t)} warriors cross the border to join you.`; } },
         { l: 'Send him back', s: 'Nothing changes', f: () => 'The war chief is sent home. His fate is not your problem.' }] },
  borderOil: { title: 'Copper on the border', when: p => neighbours(p).length > 0 && borderProv(p), pickC: p => pick(neighbours(p)), text: (p, c) => `Prospectors find a rich copper seam right on the border with ${c.name}.`,
    ch: [{ l: 'Claim it', s: 'A copper deposit, angers them', f: (p, c) => { const q = borderProv(p, c) || borderProv(p); if (q && !q.dep.includes('copper')) q.dep.push('copper'); c.grudge = p.id; c.grudgeUntil = S.day + 2 * YEAR; return `The seam is yours${q ? ` in ${q.name}` : ''}. ${c.name} calls it theft.`; } },
         { l: 'Leave it', s: 'Keep the peace', f: () => 'The seam is left alone. For now.' }] },
  coup: { title: 'The elders plot', when: () => true, text: p => `Elders of ${p.name} are plotting against the chief, and some warriors listen to them.`,
    ch: [{ l: 'Exile the plotters', s: 'Lose 12% of warriors', f: p => { armiesOf(p).forEach(a => a.troops *= .88); return 'The plotters and their followers are driven out.'; } },
         { l: 'Ignore it', s: 'Risky', f: p => { if (R() < .35) { revolt(p); return 'The elders strike at the next gathering.'; } return 'Nothing happens. This time.'; } }] },
  arms: { title: 'A travelling smith', when: p => p.treasury > 0, text: () => 'A travelling smith offers a cartload of spears and blades, for a price.',
    ch: [{ l: 'Buy them', s: 'Half your treasury, weapons in store', f: p => { p.treasury *= .5; const t = Math.max(20, G.troopsOf(p) * .3); p.stock.spears += t * .6; p.stock.swords += t * .4; return `${fmt(t)} weapons go into your stores.`; } },
         { l: 'Decline', s: 'Keep the money', f: () => 'He moves on to the next tribe.' }] },
  refugees: { title: 'Refugees at the border', when: () => true, text: () => 'Families fleeing a war-torn neighbour gather at your border.',
    ch: [{ l: 'Let them in', s: '+4% population, costs treasury', f: p => { scalePop(p, 1.04); p.treasury -= gdpOf(p) * .01; return 'In time they will work and fight for you.'; } },
         { l: 'Turn them away', s: 'No cost', f: () => 'They move on.' }] },
  allianceOffer: { title: 'Alliance offer', when: p => neighbours(p).some(t => !p.allies.includes(t.id) && !atWar(p.id, t.id)), pickC: p => pick(neighbours(p).filter(t => !p.allies.includes(t.id) && !atWar(p.id, t.id))),
    text: (p, c) => `${c.name} proposes an alliance.`,
    ch: [{ l: 'Accept', s: 'You defend each other', f: (p, c) => { p.allies.push(c.id); c.allies.push(p.id); log(`${N(p)} and ${N(c)} sign an alliance.`, null, 3); return `You and ${c.name} are now allies.`; } },
         { l: 'Refuse', s: 'They may take it badly', f: (p, c) => { if (R() < .4) { c.grudge = p.id; c.grudgeUntil = S.day + 2 * YEAR; return `${c.name} takes it personally.`; } return `${c.name} shrugs it off.`; } }] },
  goldRush: { title: 'Amber traders', when: () => true, text: p => `Traders arrive in ${pick(provsOf(p)).name} with amber, shells and salt to exchange.`,
    ch: [{ l: 'Tax the market', s: '+treasury, they may not return', f: p => { p.treasury += gdpOf(p) * .1; return 'The chief takes his share of every deal.'; } },
         { l: 'Let them trade freely', s: '+5% GDP', f: p => { scaleGdp(p, 1.05); return 'The market grows busier every season.'; } }] },
};
const borderProv = (p, c) => provsOf(p).find(q => q.ctrl === p.id && q.landN.some(i => { const o = S.P[i].owner; return o != null && o !== p.id && (!c || o === c.id); }));

export function triggerEvent() {
  const p = player(); if (!p || !p.alive) return;
  const keys = Object.keys(EVENTS).filter(k => EVENTS[k].when(p)); if (!keys.length) return;
  const key = pick(keys), ev = EVENTS[key], c = ev.pickC ? ev.pickC(p) : null;
  if (ev.pickC && !c) return;
  addDecision({ kind: 'event', key, c: c ? c.id : null, title: ev.title, text: ev.text(p, c), choices: ev.ch.map(x => ({ l: x.l, s: x.s })) });
}

export function resolveDecision(id, idx) {
  const d = S.decisions.find(x => x.id === id); if (!d) return null;
  S.decisions = S.decisions.filter(x => x !== d);
  const p = player(); let out = '';
  if (d.kind === 'event') {
    const ev = EVENTS[d.key]; const c = d.c != null ? S.nations[d.c] : null;
    out = (c && !c.alive) ? 'The moment has passed.' : ev.ch[idx].f(p, c);
  } else if (d.kind === 'callToArms') {
    const al = S.nations[d.data.ally], def = S.nations[d.data.def], att = S.nations[d.data.att];
    if (idx === 0) { if (att.alive && !atWar(al.id, att.id)) { declareWar(al, att, true); log(`${N(al)} joins the war against ${N(att)}.`, null, 5); } out = `You are now at war with ${att.name}.`; }
    else { al.allies = al.allies.filter(x => x !== def.id); def.allies = def.allies.filter(x => x !== al.id); out = `${def.name} will not forget this. The alliance is over.`; }
  } else if (d.kind === 'peace') {
    const w = S.wars.find(x => x.id === d.data.war);
    if (idx === 0) { if (w) makePeace(w, d.data.winner, d.data.deal || d.data.ids); out = w ? 'The treaty is signed.' : 'The war has already ended.'; }
    else out = d.data.refuse;
  }
  log(`${d.title}: ${out}`, null, 1);
  S.mapVersion++;
  return out;
}

// Player decision events, plus resolving any queued decision (events, calls to arms, peace offers).
import { S, R, pick, YEAR, N, log, addDecision, has, player, provsOf, gdpOf, armiesOf, neighbours, atWar } from './core.js';
import { makeArmy } from './military.js';
import { declareWar, makePeace } from './diplomacy.js';
import { revolt } from './economy.js';

const scalePop = (n, f) => provsOf(n).forEach(p => p.pop *= f);
const scaleGdp = (n, f) => provsOf(n).forEach(p => p.gdp *= f);
const bigArmy = n => armiesOf(n).sort((x, y) => y.troops - x.troops)[0];
const fmt = v => Math.round(v).toLocaleString('en-IE');

export const EVENTS = {
  harvest: { title: 'Harvest failure', when: p => !has(p, 'green'), text: p => `The crops have failed across ${p.name}. The cities are getting hungry.`,
    ch: [{ l: 'Send aid', s: 'Costs 30% of your treasury', f: p => { p.treasury *= .7; return 'Aid convoys roll out. The crisis passes quietly.'; } },
         { l: 'Let it run', s: 'Free, but people will starve', f: p => { scalePop(p, .9); if (R() < .3) { revolt(p); return 'Bread riots turn into a revolution.'; } return 'Many die. The regime survives, barely.'; } }] },
  defector: { title: 'A general defects', when: () => S.nations.some(n => n.alive && !n.you && armiesOf(n).length), pickC: () => pick(S.nations.filter(n => n.alive && !n.you && armiesOf(n).length)),
    text: (p, c) => `A senior general from ${c.name} offers to bring his division over to you.`,
    ch: [{ l: 'Welcome him', s: 'More troops, small spy risk', f: (p, c) => { const e = bigArmy(c), me = bigArmy(p); if (!e) return 'He never shows up.'; const t = e.troops * .08; e.troops -= t; if (me) me.troops += t; else makeArmy(p, p.cap, t); if (R() < .25) { p.treasury *= .6; return `${fmt(t)} soldiers join you. Then the general vanishes with 40% of your treasury.`; } return `${fmt(t)} soldiers march across the border to join you.`; } },
         { l: 'Send him back', s: 'Nothing changes', f: () => 'The general is returned. His fate is not your problem.' }] },
  borderOil: { title: 'Oil on the border', when: p => neighbours(p).length > 0, pickC: p => pick(neighbours(p)), text: (p, c) => `Engineers find a huge oil field right on the border with ${c.name}.`,
    ch: [{ l: 'Drill it', s: '+10% GDP, angers them', f: (p, c) => { scaleGdp(p, 1.1); c.grudge = p.id; c.grudgeUntil = S.day + 2 * YEAR; return `The wells start pumping. ${c.name} calls it theft.`; } },
         { l: 'Leave it', s: 'Keep the peace', f: () => 'The field stays sealed. For now.' }] },
  coup: { title: 'Coup plot', when: () => true, text: p => `Intelligence reports colonels plotting against the government of ${p.name}.`,
    ch: [{ l: 'Purge the army', s: 'Lose 12% of troops', f: p => { armiesOf(p).forEach(a => a.troops *= .88); return 'The plot dies with the plotters.'; } },
         { l: 'Ignore it', s: 'Risky', f: p => { if (R() < .35) { revolt(p); return 'The colonels strike at dawn.'; } return 'Nothing happens. This time.'; } }] },
  arms: { title: 'Arms dealer', when: p => p.treasury > 0, text: () => 'A well-dressed arms dealer offers surplus rifles, tanks and no questions.',
    ch: [{ l: 'Buy', s: 'Half your treasury, +15% troops', f: p => { p.treasury *= .5; armiesOf(p).forEach(a => a.troops *= 1.15); return 'Crates arrive overnight. Your armies are stronger.'; } },
         { l: 'Decline', s: 'Keep the money', f: () => 'He leaves a business card.' }] },
  refugees: { title: 'Refugees at the border', when: () => true, text: () => 'Refugees from a war-torn neighbour crowd at your border.',
    ch: [{ l: 'Let them in', s: '+4% population, costs treasury', f: p => { scalePop(p, 1.04); p.treasury -= gdpOf(p) * .01; return 'In time they will work and fight for you.'; } },
         { l: 'Close the border', s: 'No cost', f: () => 'The gates stay shut.' }] },
  allianceOffer: { title: 'Alliance offer', when: p => neighbours(p).some(t => !p.allies.includes(t.id) && !atWar(p.id, t.id)), pickC: p => pick(neighbours(p).filter(t => !p.allies.includes(t.id) && !atWar(p.id, t.id))),
    text: (p, c) => `${c.name} proposes an alliance.`,
    ch: [{ l: 'Accept', s: 'You defend each other', f: (p, c) => { p.allies.push(c.id); c.allies.push(p.id); log(`${N(p)} and ${N(c)} sign an alliance.`, null, 3); return `You and ${c.name} are now allies.`; } },
         { l: 'Refuse', s: 'They may take it badly', f: (p, c) => { if (R() < .4) { c.grudge = p.id; c.grudgeUntil = S.day + 2 * YEAR; return `${c.name} takes it personally.`; } return `${c.name} shrugs it off.`; } }] },
  goldRush: { title: 'Gold rush', when: () => true, text: p => `Prospectors strike gold in ${pick(provsOf(p)).name}.`,
    ch: [{ l: 'Nationalise it', s: '+treasury, unrest risk', f: p => { p.treasury += gdpOf(p) * .15; if (R() < .2) { revolt(p); return 'The miners revolt and topple the government.'; } return 'The state coffers fill up.'; } },
         { l: 'Let it boom', s: '+5% GDP', f: p => { scaleGdp(p, 1.05); return 'Boomtowns spring up overnight.'; } }] },
};

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
    if (idx === 0) { if (w) makePeace(w, d.data.winner, d.data.ids); out = w ? 'The treaty is signed.' : 'The war has already ended.'; }
    else out = d.data.refuse;
  }
  log(`${d.title}: ${out}`, null, 1);
  S.mapVersion++;
  return out;
}

// New game screen: name your tribe and pick its culture. Every tribe starts on a random tile where
// farming, forestry and quarrying are all possible.
import * as G from '../sim/game.js';
import { S, D } from '../sim/game.js';
import { esc } from './format.js';
import { unlockAudio } from './audio.js';

const pickM = a => a[Math.floor(Math.random() * a.length)];

export class Setup {
  constructor(app) {
    this.app = app; this.$ = id => document.getElementById(id);
    const cs = Object.entries(D.cultures).sort((a, b) => a[1].n.localeCompare(b[1].n));
    this.$('culture').innerHTML = `<option value="">Random culture</option>` + cs.map(([k, c]) => `<option value="${k}">${esc(c.n)}</option>`).join('');
    this.$('culture').onchange = () => { this.suggest(); this.describe(); };
    this.$('nameIdea').onclick = () => this.suggest(true);
    this.$('startGame').onclick = () => this.start();
    this.$('newMap').onclick = () => this.begin();
    this.$('tribeName').addEventListener('keydown', e => { if (e.key === 'Enter') this.start(); });
    for (const id of ['goal', 'diff', 'size', 'mapSize']) this.$(id).onchange = () => {
      if (id === 'mapSize') this.nationOptions();
      if (id === 'size' || id === 'mapSize') this.begin(); else this.describe();
    };
    this.nationOptions();
  }
  nationOptions() {
    const cfg = D.balance.mapSizes[this.$('mapSize').value];
    this.$('size').innerHTML = cfg.nations.map(v => `<option value="${v}" ${v === cfg.defNations ? 'selected' : ''}>${v}</option>`).join('');
  }
  culture() { return this.$('culture').value || this.rolled || (this.rolled = pickM(Object.keys(D.cultures))); }
  // Offer a historical people of the chosen culture, unless the player typed their own name.
  suggest(force) {
    const el = this.$('tribeName');
    if (!force && el.value && el.value !== this.lastIdea) return;
    if (!this.$('culture').value) this.rolled = pickM(Object.keys(D.cultures));
    el.value = this.lastIdea = pickM(D.cultures[this.culture()].tribes);
  }
  describe() {
    const cfg = D.balance.mapSizes[this.$('mapSize').value], c = D.cultures[this.culture()];
    this.$('goalDesc').textContent = `${D.goals[this.$('goal').value].d} ${cfg.n} map: about ${cfg.provinces.toLocaleString('en-IE')} tiles, ${this.$('size').value} tribes.`;
    this.$('cultureDesc').innerHTML = `<b>${esc(c.n)}${this.$('culture').value ? '' : ' (random)'}</b> · your settlements will be named like ${c.places.slice(0, 4).map(esc).join(', ')}…`;
  }
  begin() {
    G.newGame({ mapSize: this.$('mapSize').value, nations: +this.$('size').value, goal: this.$('goal').value, diff: this.$('diff').value });
    if (!this.$('tribeName').value) this.suggest(true);
    this.describe(); this.app.onWorld();
  }
  start() {
    unlockAudio();
    if (!S || S.phase !== 'setup' || S.nations.length) this.begin();
    G.setupTribes({ name: this.$('tribeName').value.trim(), culture: this.culture() });
    this.rolled = null; this.app.onSetupDone();
  }
}

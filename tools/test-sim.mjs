// Headless simulation tests: long games, and save/load determinism.
// Run: node tools/test-sim.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const G = await import(path.join(root, 'sim', 'game.js'));
const dataDir = path.join(root, 'data');
const data = {};
for (const f of fs.readdirSync(dataDir)) data[f.replace('.json', '')] = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
G.init(data);

const hash = o => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 12);
function setupGame(seed, nations, goal, diff, mapSize = 'small') {
  G.newGame({ seed, nations, goal, diff, mapSize });
  G.setupTribes({ name: 'Test tribe', culture: 'irish' });
  G.startGame(); G.setAutoPlayer(true);
}
function run(days) {
  for (let d = 0; d < days && !G.S.over; d++) {
    while (G.S.decisions.length) G.chooseDecision(G.S.decisions[0].id, 0);
    G.tick();
  }
}

let failures = 0;
const t0 = Date.now();
for (const [seed, n, goal, diff] of [[1, 8, 'hegemon', 'normal'], [2, 6, 'conquest', 'hard'], [3, 10, 'economy', 'easy'], [4, 8, 'survive', 'normal']]) {
  try {
    setupGame(seed, n, goal, diff);
    run(80 * 360);
    const alive = G.S.nations.filter(x => x.alive);
    console.log(`seed ${seed}: year ${G.yearOf(G.S.day)}, ${alive.length} alive of ${G.S.nations.length}, wars ${G.S.wars.length}, result ${JSON.stringify(G.S.result)}`);
  } catch (e) { failures++; console.log(`seed ${seed} CRASH`, e.stack); }
}
for (const size of ['medium', 'large', 'huge']) {
  try {
    const n = data.balance.mapSizes[size].defNations;
    let t = Date.now(); setupGame(7, n, 'hegemon', 'normal', size); const gen = Date.now() - t;
    t = Date.now(); run(30 * 360); const sim = Date.now() - t;
    const free = G.S.P.filter(p => p.owner == null).length;
    console.log(`${size}: ${G.S.P.length} provinces, ${n} nations, grid ${G.S.W}x${G.S.H}, generate ${gen} ms, 30 years in ${sim} ms (${(sim / (30 * 360)).toFixed(2)} ms/day), free provinces left ${free}, alive ${G.S.nations.filter(x => x.alive).length}`);
  } catch (e) { failures++; console.log(`${size} CRASH`, e.stack); }
}
// determinism: continuing a game and continuing its save must give identical states
setupGame(42, 24, 'hegemon', 'normal', process.argv[2] || 'large');
run(10 * 360);
const save = JSON.stringify(G.serialize());
run(10 * 360);
const a = hash(G.serialize());
G.load(JSON.parse(save));
run(10 * 360);
const b = hash(G.serialize());
console.log(`determinism: ${a} vs ${b} ${a === b ? 'OK' : 'MISMATCH'}`);
if (a !== b) failures++;
console.log(`save size ${(save.length / 1024).toFixed(0)} KB, total ${Date.now() - t0} ms`);
process.exit(failures ? 1 : 0);

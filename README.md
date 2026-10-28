# Wheel of Nations

A real-time grand strategy game from the stone age up. You found a small farming tribe on one tile, then grow, settle, build and fight on a procedurally generated map: Small (48 tiles) to Huge (about 1,000 tiles and up to 32 tribes).

## Play
- **Windows:** unzip `WheelOfNations-<version>-win-x64.zip` and run `Wheel of Nations.exe`. Saves and settings are kept in `%APPDATA%\Wheel of Nations\`.
- **Develop:** install Node.js 20+, then `npm install` and `npm start`.

## Economy and armies
- Every tribe starts with a few hundred people on a tile where farming, forestry and stone are all possible. Free tiles hold 0 to 300 people.
- Tiles have no name until settled; then they take a place name from the settling tribe's culture (60 cultures in `src/data/cultures.json`).
- People eat bread and burn firewood. Wheat only feeds bakeries.
- GDP is the yearly value added by every building: what it makes, at each good's price, less what it uses up. Raw (tier 1) goods are cheap, made goods (tier 2) worth more; taxes are a share of GDP.
- The Resources page forecasts every good (averages, construction in progress, population growth) and suggests what to build, following the chain to the input that is really missing.
- Soldiers come out of the workforce while they serve; soldiers killed in war are gone from the population.
- Place names: real ones from the culture first, then names built from its naming elements (`gen` in cultures.json).
- Every province has a biome (plains, forest, hills, mountains, desert). Stone can be quarried anywhere; farms and forestry are not possible in deserts or mountains.
- Goods sit in one national stockpile. Farms grow wheat or fiber, forestry cuts wood, quarries cut stone. All three need stone tools from toolsmiths, or they work at half speed.
- Bakeries turn wheat into bread, burning wood. People eat one bread a week; hungry provinces shrink, and subsistence farming covers only part of the gap.
- Buildings employ the province's own workers. Construction costs wood and stone and needs free workers as builders. You can turn each building's work rate down to free workers.
- Armies are swordsmen (front row) and spearmen (back row); each soldier needs a sword or a spear. Battles run day by day; 1:1 fills both rows.

## Population

Population moves, in the spirit of Victoria 3. Every province has a living standard built from food, firewood and work.
Growth follows it. Once a month, idle workers and their families leave provinces with no jobs for provinces with
open jobs in the same tribe, nearer ones first. People also leave a hungry, cold or jobless tribe for a better-off
neighbour that has work for them, as long as the two tribes are not at war. Builders are not tied to their
province: a project takes idle workers locally first, then from the nearest provinces of the tribe. The Buildings
page shows who moved and where the builders came from (`src/sim/population.js`).

## Project layout
```
main.js, preload.js   Electron shell: window, app:// file protocol, save files on disk
src/index.html        Page skeleton
src/styles.css        All styling
src/data/*.json       Game content and balance (governments, techs, biomes, goods, buildings, names...)
src/sim/              The simulation. Plain JavaScript with no DOM access, deterministic with a seeded RNG.
  core.js             State, data, RNG, and read-only queries
  world.js            Map generation (grid of land cells grouped into provinces, biomes)
  nation.js           Creating nations
  military.js         Armies (swordsmen/spearmen), movement, day-by-day battles, sieges, nukes
  industry.js         Goods, workforce, buildings, weekly production, construction, AI economy planner
  economy.js          Income, population and GDP growth, recruitment, reinforcement, research, revolts
  diplomacy.js        Wars, war score, peace deals, alliances, AI war declarations
  ai.js               AI army movement
  events.js           Decision events and resolving decisions
  game.js             Public API: newGame, tick, player commands (cmd*), save/load
src/ui/               Everything the player sees
  app.js              Entry point, game clock, input, dialogs, save/load
  map.js              Map renderer and camera
  panels.js           Page contents (selection card, tribe, wars, research, nations, log)
  manage.js           The page window: Tribe E, Resources G, Buildings B, Army M, Wars V, Research R, Nations N, Log L
  setup.js            The nation wheel
tools/test-sim.mjs    Headless tests: long AI-only games and save/load determinism
tools/build-win.sh    Builds the Windows zip by dropping the game into the official Electron runtime
```

## Rules of the codebase
1. **The simulation never touches the UI.** `src/sim` reads and writes one plain JSON object (`S`). The UI calls `G.tick()` and `G.cmd*()` functions, and listens for events through `G.setEmitter`.
2. **All game state is JSON.** No Sets, Maps or class instances in `S`, so a save is just `JSON.stringify(S)`.
3. **Use the seeded RNG.** The sim uses `R()` from `core.js`, never `Math.random()`. Loading a save and playing on gives exactly the same result. `npm test` checks this.
4. **Content goes in `src/data`.** Tune numbers and add governments, techs or names there before touching code.

## Debugging
In the desktop app, press `F12` or `Ctrl+Shift+I` for DevTools and `Ctrl+R` to reload. `window.__wn` gives you the sim (`__wn.G`), the map camera and the UI state from the console.

## Building the Windows version
- On Windows: `npm install`, then `npm run dist` (uses electron-builder; makes a single portable .exe).
- On Linux or macOS without npm: `tools/build-win.sh` (needs curl, unzip, zip and node).

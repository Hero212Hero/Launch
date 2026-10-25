# Coin Express

A railroad tycoon game that runs in the browser, in the spirit of Railroad Tycoon 3 and Transport Fever.

This is the first playable step: a generated map with towns and industries, track laying, stations, trains, cargo deliveries and money. The goal is $1,000,000 in cash before January 1860. Graphics are placeholders.

## Play

- Open `dist/index.html` in any browser. It is a single file with nothing to install.
- Or run it from source: serve the repository folder (for example `npx serve .`) and open `index.html`.

## How the code is organised

```
src/core/   the simulation: no browser code, runs in Node for tests
  data.js       rules and tuning numbers (cargo, industries, locomotives, prices)
  world.js      map generation: terrain, towns, industries
  track.js      the track network, track planning and train routing
  economy.js    money, dates, station catchments, delivery payments
  commands.js   every player action, checked and logged
  sim.js        the clock: trains, production, monthly books
src/ui/     drawing the map, the panels and dialogs
src/main.js input, the game loop, saving
tools/build.mjs  bundles everything into dist/
tests/      Node tests for the simulation
```

Every change to the world goes through `dispatch(state, command)` in `commands.js`. Commands are plain JSON and are logged in `state.commandLog`. That is the base for undo, replays, AI rivals and multiplayer later: an AI company issues the same commands a player does. The game state is plain JSON too, so saving is a `JSON.stringify` (the game autosaves to the browser each month).

## Develop

```
npm test        # simulation tests (Node 20+)
npm run build   # rebuild dist/index.html and dist/artifact.html
```

## Credits and licences

The code here is original. Ideas were drawn from studying open-source transport games; GPL-licensed projects (OpenTTD, Simutrans, Freerails) were used for ideas only, with no code copied. Code from MIT-licensed projects (OpenLoco, tobymao/18xx) may be reused in future with attribution recorded here.

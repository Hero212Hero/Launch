// Builds a new game: terrain, towns, industries and the player's company.

import {
  MAP_W, MAP_H, GRASS, FOREST, HILL, WATER, INDUSTRY_TYPES, INDUSTRY_COUNTS,
  TOWN_NAMES, COSTS,
} from './data.js';
import { rngNext, rngInt } from './rng.js';
import { tileAt } from './map.js';

function makeNoise(state, w, h, cell) {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const grid = [];
  for (let i = 0; i < gw * gh; i++) grid.push(rngNext(state));
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell;
    const fy = y / cell;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = smooth(fx - ix);
    const ty = smooth(fy - iy);
    const g = (gx, gy) => grid[gy * gw + gx];
    const top = g(ix, iy) * (1 - tx) + g(ix + 1, iy) * tx;
    const bottom = g(ix, iy + 1) * (1 - tx) + g(ix + 1, iy + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  };
}

function generateTerrain(state) {
  const { map } = state;
  const broad = makeNoise(state, map.w, map.h, 13);
  const detail = makeNoise(state, map.w, map.h, 5);
  const woods = makeNoise(state, map.w, map.h, 7);
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const h = broad(x, y) * 0.68 + detail(x, y) * 0.32;
      let t = GRASS;
      if (h < 0.3) t = WATER;
      else if (h > 0.68) t = HILL;
      else if (woods(x, y) > 0.62) t = FOREST;
      map.terrain[tileAt(map, x, y)] = t;
    }
  }
}

function freeLand(state, t) {
  const { map } = state;
  return t >= 0 && map.terrain[t] !== WATER && map.town[t] < 0 && map.industry[t] < 0;
}

function placeTowns(state, count) {
  const { map } = state;
  const names = TOWN_NAMES.slice();
  for (let attempt = 0; attempt < 4000 && state.towns.length < count; attempt++) {
    const x = rngInt(state, 4, map.w - 5);
    const y = rngInt(state, 4, map.h - 5);
    const t = tileAt(map, x, y);
    if (map.terrain[t] !== GRASS) continue;
    if (state.towns.some((tw) => Math.hypot(tw.x - x, tw.y - y) < 15)) continue;
    const name = names.splice(rngInt(state, 0, names.length - 1), 1)[0];
    const town = { id: state.towns.length, name, x, y, tile: t, pop: rngInt(state, 350, 1600) };
    state.towns.push(town);
    // Houses spiral out from the centre; bigger towns sprawl further.
    const houses = Math.round(town.pop / 70);
    let placed = 0;
    for (let r = 0; r <= 4 && placed < houses; r++) {
      for (let dy = -r; dy <= r && placed < houses; dy++) {
        for (let dx = -r; dx <= r && placed < houses; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const h = tileAt(map, x + dx, y + dy);
          if (h < 0 || map.terrain[h] === WATER || map.town[h] >= 0) continue;
          if (r > 0 && rngNext(state) < 0.3) continue;
          map.town[h] = town.id;
          placed++;
        }
      }
    }
  }
}

function nearestTown(state, x, y) {
  let best = state.towns[0];
  for (const t of state.towns) {
    if (Math.hypot(t.x - x, t.y - y) < Math.hypot(best.x - x, best.y - y)) best = t;
  }
  return best;
}

function placeIndustry(state, typeId) {
  const { map } = state;
  const type = INDUSTRY_TYPES[typeId];
  for (let attempt = 0; attempt < 3000; attempt++) {
    const x = rngInt(state, 2, map.w - 4);
    const y = rngInt(state, 2, map.h - 4);
    const tiles = [tileAt(map, x, y), tileAt(map, x + 1, y), tileAt(map, x, y + 1), tileAt(map, x + 1, y + 1)];
    if (!tiles.every((t) => freeLand(state, t))) continue;
    // Early attempts insist on the preferred terrain; later ones take anything.
    if (attempt < 1500 && map.terrain[tiles[0]] !== type.prefers) continue;
    if (state.towns.some((tw) => Math.hypot(tw.x - x, tw.y - y) < 5)) continue;
    if (state.industries.some((ind) => Math.hypot(ind.x - x, ind.y - y) < 6)) continue;
    const id = state.industries.length;
    const town = nearestTown(state, x, y);
    for (const t of tiles) map.industry[t] = id;
    state.industries.push({
      id, type: typeId, name: `${town.name} ${type.name}`, x, y, tiles,
      stock: {}, lastProduced: 0, lastShipped: 0,
    });
    return;
  }
}

export function createGame(seed = Math.floor(Math.random() * 1e9)) {
  const n = MAP_W * MAP_H;
  const state = {
    version: 1,
    seed,
    rng: seed | 0,
    tick: 0,
    map: {
      w: MAP_W, h: MAP_H,
      terrain: new Array(n).fill(GRASS),
      town: new Array(n).fill(-1),
      industry: new Array(n).fill(-1),
    },
    towns: [],
    industries: [],
    stations: [],
    trains: [],
    track: {}, // "a-b" tile pair -> owning company id
    companies: [{
      id: 0,
      name: 'Coin Express Rail Co.',
      color: '#c8402f',
      cash: COSTS.startCash,
      month: emptyLedger(),
      year: emptyLedger(),
      lastYear: null,
      history: [],
    }],
    messages: [],
    nextId: 1,
    commandLog: [],
    outcome: null,
    events: [], // short-lived notices for the screen; not part of the rules
  };
  generateTerrain(state);
  placeTowns(state, 6);
  for (const [typeId, count] of Object.entries(INDUSTRY_COUNTS)) {
    for (let i = 0; i < count; i++) placeIndustry(state, typeId);
  }
  return state;
}

export function emptyLedger() {
  return { revenue: 0, construction: 0, trains: 0, upkeep: 0 };
}

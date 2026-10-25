// Tile helpers. The map is a grid stored as flat arrays; a tile is its array index.

import { CATCHMENT } from './data.js';

export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function tileAt(map, x, y) {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return -1;
  return y * map.w + x;
}

export function tileX(map, t) {
  return t % map.w;
}

export function tileY(map, t) {
  return Math.floor(t / map.w);
}

export function tileDist(map, a, b) {
  return Math.hypot(tileX(map, a) - tileX(map, b), tileY(map, a) - tileY(map, b));
}

// Tiles within the station catchment square around t.
export function tilesAround(map, t, r = CATCHMENT) {
  const out = [];
  const x0 = tileX(map, t);
  const y0 = tileY(map, t);
  for (let y = y0 - r; y <= y0 + r; y++) {
    for (let x = x0 - r; x <= x0 + r; x++) {
      const i = tileAt(map, x, y);
      if (i >= 0) out.push(i);
    }
  }
  return out;
}

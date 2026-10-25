// The track network. A piece of track joins two neighbouring tiles (straight or
// diagonal); the whole network is the set of those joins.

import { TERRAIN, TOWN_TILE_COST, COSTS } from './data.js';
import { DIRS, tileAt, tileX, tileY } from './map.js';

export function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function hasTrack(state, a, b) {
  return state.track[edgeKey(a, b)] !== undefined;
}

export function trackNeighbors(state, t) {
  const { map } = state;
  const out = [];
  for (const [dx, dy] of DIRS) {
    const n = tileAt(map, tileX(map, t) + dx, tileY(map, t) + dy);
    if (n >= 0 && hasTrack(state, t, n)) out.push(n);
  }
  return out;
}

export function tileHasTrack(state, t) {
  return trackNeighbors(state, t).length > 0;
}

export function segmentLength(map, a, b) {
  return tileX(map, a) !== tileX(map, b) && tileY(map, a) !== tileY(map, b) ? Math.SQRT2 : 1;
}

// Dollar cost of laying one new piece of track from a to b. Infinity if blocked.
export function segmentCost(state, a, b) {
  const { map } = state;
  if (map.industry[a] >= 0 || map.industry[b] >= 0) return Infinity;
  const terrain = (TERRAIN[map.terrain[a]].cost + TERRAIN[map.terrain[b]].cost) / 2;
  const town = map.town[a] >= 0 || map.town[b] >= 0 ? TOWN_TILE_COST : 1;
  return Math.round(COSTS.trackPerTile * terrain * town * segmentLength(map, a, b));
}

// Tiny binary heap keyed on .f for the searches below.
function heapPush(heap, node) {
  heap.push(node);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p].f <= heap[i].f) break;
    [heap[p], heap[i]] = [heap[i], heap[p]];
    i = p;
  }
}

function heapPop(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && heap[l].f < heap[m].f) m = l;
      if (r < heap.length && heap[r].f < heap[m].f) m = r;
      if (m === i) break;
      [heap[m], heap[i]] = [heap[i], heap[m]];
      i = m;
    }
  }
  return top;
}

function walkBack(prev, end) {
  const path = [end];
  while (prev.has(path[0])) path.unshift(prev.get(path[0]));
  return path;
}

// Cheapest way to lay track between two tiles, reusing track already there.
// Returns { path, cost } or null when there is no way through.
export function planTrack(state, from, to) {
  const { map } = state;
  if (from === to || from < 0 || to < 0) return null;
  if (map.industry[from] >= 0 || map.industry[to] >= 0) return null;
  const ax = tileX(map, from);
  const ay = tileY(map, from);
  const lx = tileX(map, to) - ax;
  const ly = tileY(map, to) - ay;
  const llen = Math.hypot(lx, ly) || 1;
  // Small pull toward the straight line keeps the planner from zig-zagging over
  // equally priced ground.
  const offLine = (t) => Math.abs((tileX(map, t) - ax) * ly - (tileY(map, t) - ay) * lx) / llen;

  const best = new Map([[from, 0]]);
  const prev = new Map();
  const heap = [{ t: from, g: 0, f: 0 }];
  while (heap.length) {
    const { t, g } = heapPop(heap);
    if (t === to) {
      const path = walkBack(prev, to);
      let cost = 0;
      for (let i = 1; i < path.length; i++) {
        if (!hasTrack(state, path[i - 1], path[i])) cost += segmentCost(state, path[i - 1], path[i]);
      }
      return { path, cost };
    }
    if (g > best.get(t)) continue;
    for (const [dx, dy] of DIRS) {
      const n = tileAt(map, tileX(map, t) + dx, tileY(map, t) + dy);
      if (n < 0) continue;
      const step = hasTrack(state, t, n)
        ? COSTS.trackPerTile * 0.05
        : segmentCost(state, t, n) + COSTS.trackPerTile * 0.04 * offLine(n);
      if (step === Infinity) continue;
      const ng = g + step;
      if (ng < (best.get(n) ?? Infinity)) {
        best.set(n, ng);
        prev.set(n, t);
        heapPush(heap, { t: n, g: ng, f: ng });
      }
    }
  }
  return null;
}

// Shortest route along existing track. Returns a list of tiles or null.
export function findRoute(state, from, to) {
  const { map } = state;
  if (from === to) return [from];
  const best = new Map([[from, 0]]);
  const prev = new Map();
  const heap = [{ t: from, f: 0 }];
  while (heap.length) {
    const { t, f } = heapPop(heap);
    if (t === to) return walkBack(prev, to);
    if (f > best.get(t)) continue;
    for (const n of trackNeighbors(state, t)) {
      const nf = f + segmentLength(map, t, n);
      if (nf < (best.get(n) ?? Infinity)) {
        best.set(n, nf);
        prev.set(n, t);
        heapPush(heap, { t: n, f: nf });
      }
    }
  }
  return null;
}

export function pathLength(map, path) {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += segmentLength(map, path[i - 1], path[i]);
  return len;
}

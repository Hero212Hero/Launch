// Seeded random numbers kept inside the game state, so a saved game (or a replay
// of its command log) always rolls the same dice. Mulberry32.

export function rngNext(state) {
  state.rng = (state.rng + 0x6d2b79f5) | 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rngInt(state, lo, hi) {
  return lo + Math.floor(rngNext(state) * (hi - lo + 1));
}

export function rngPick(state, list) {
  return list[Math.floor(rngNext(state) * list.length)];
}

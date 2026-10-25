import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/core/world.js';
import { dispatch } from '../src/core/commands.js';
import { step } from '../src/core/sim.js';
import { tileAt } from '../src/core/map.js';
import { planTrack } from '../src/core/track.js';
import { WATER, TICKS_PER_DAY, DAYS_PER_MONTH } from '../src/core/data.js';

// A land tile just beside an industry, where a station can go.
function besideIndustry(state, ind) {
  for (const [dx, dy] of [[0, 2], [2, 0], [0, -1], [-1, 0], [2, 2], [-1, -1]]) {
    const t = tileAt(state.map, ind.x + dx, ind.y + dy);
    if (t >= 0 && state.map.terrain[t] !== WATER && state.map.industry[t] < 0) return t;
  }
  return -1;
}

function runDays(state, days) {
  for (let i = 0; i < days * TICKS_PER_DAY; i++) step(state);
}

test('the same seed builds the same map', () => {
  const a = createGame(1234);
  const b = createGame(1234);
  assert.deepEqual(a.map, b.map);
  assert.deepEqual(a.towns, b.towns);
  assert.equal(a.towns.length, 6);
  assert.equal(a.industries.length, 13);
});

test('track planning avoids industries and charges for new track only', () => {
  const s = createGame(42);
  const ind = s.industries[0];
  const from = tileAt(s.map, ind.x - 3, ind.y);
  const to = tileAt(s.map, ind.x + 4, ind.y);
  const plan = planTrack(s, from, to);
  assert.ok(plan);
  assert.ok(plan.path.every((t) => s.map.industry[t] < 0));
  const before = s.companies[0].cash;
  const res = dispatch(s, { type: 'buildTrack', from, to });
  assert.ok(res.ok, res.error);
  assert.equal(s.companies[0].cash, before - plan.cost);
  assert.equal(planTrack(s, from, to).cost, 0);
  assert.equal(s.commandLog.length, 1);
});

test('a coal train earns money hauling coal to a steel mill', () => {
  const s = createGame(7);
  const mine = s.industries.find((i) => i.type === 'coalMine');
  const mill = s.industries.find((i) => i.type === 'steelMill');
  const a = besideIndustry(s, mine);
  const b = besideIndustry(s, mill);
  s.companies[0].cash = 5e6; // this test is about deliveries, not budgets
  assert.ok(dispatch(s, { type: 'buildTrack', from: a, to: b }).ok);
  const sa = dispatch(s, { type: 'buildStation', tile: a });
  const sb = dispatch(s, { type: 'buildStation', tile: b });
  assert.ok(sa.ok, sa.error);
  assert.ok(sb.ok, sb.error);
  assert.ok(sa.station.catchment.industries.includes(mine.id));
  const buy = dispatch(s, {
    type: 'buyTrain', loco: 'mogul', cars: ['coal', 'coal', 'coal'], stops: [sa.station.id, sb.station.id],
  });
  assert.ok(buy.ok, buy.error);
  let steel = 0;
  for (let m = 0; m < 12; m++) {
    runDays(s, DAYS_PER_MONTH);
    steel += mill.lastProduced;
  }
  const train = s.trains[0];
  assert.ok(train.profitTotal > 0, `train should profit, got ${train.profitTotal}`);
  assert.ok(steel > 0, 'the mill should turn coal into steel');
});

test('commands are refused when the company cannot pay', () => {
  const s = createGame(9);
  s.companies[0].cash = 10;
  const ind = s.industries[0];
  const res = dispatch(s, { type: 'buildTrack', from: tileAt(s.map, ind.x - 3, ind.y), to: tileAt(s.map, ind.x + 4, ind.y) });
  assert.equal(res.ok, false);
  assert.match(res.error, /Not enough cash/);
  assert.equal(s.commandLog.length, 0);
});

test('a saved game survives a JSON round trip', () => {
  const s = createGame(11);
  runDays(s, 40);
  const copy = JSON.parse(JSON.stringify(s));
  step(s);
  step(copy);
  assert.deepEqual(copy, s);
});

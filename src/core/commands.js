// Every change a player (or, later, an AI rival or a network peer) makes to the
// world goes through dispatch(). Commands are plain JSON, checked before they run,
// and logged, which is what makes saves, replays, undo and multiplayer possible.

import { COSTS, LOCOS, CAR, CARGO, LOAD_DAYS, TICKS_PER_DAY } from './data.js';
import { tileX, tileY } from './map.js';
import { planTrack, edgeKey, tileHasTrack, trackNeighbors, segmentCost } from './track.js';
import { spend, refund, addMessage, catchmentAt, money } from './economy.js';

const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = (error) => ({ ok: false, error });

function stationAt(state, tile) {
  return state.stations.find((s) => s.tile === tile);
}

function nearestTownName(state, tile) {
  const x = tileX(state.map, tile);
  const y = tileY(state.map, tile);
  let best = state.towns[0];
  for (const t of state.towns) {
    if (Math.hypot(t.x - x, t.y - y) < Math.hypot(best.x - x, best.y - y)) best = t;
  }
  return best.name;
}

export function trainCost(locoId, carCount) {
  const loco = LOCOS.find((l) => l.id === locoId);
  return loco ? loco.price + carCount * CAR.price : 0;
}

const HANDLERS = {
  buildTrack(state, company, { from, to }) {
    const plan = planTrack(state, from, to);
    if (!plan) return fail('Track cannot reach there. Industries block the way.');
    if (plan.cost === 0) return fail('That track is already built.');
    if (plan.cost > company.cash) return fail(`Not enough cash. That track costs ${money(plan.cost)}.`);
    for (let i = 1; i < plan.path.length; i++) {
      const key = edgeKey(plan.path[i - 1], plan.path[i]);
      if (state.track[key] === undefined) state.track[key] = company.id;
    }
    spend(company, plan.cost, 'construction');
    return ok({ cost: plan.cost, path: plan.path });
  },

  buildStation(state, company, { tile }) {
    if (!tileHasTrack(state, tile)) return fail('Stations go on a tile that already has track.');
    if (stationAt(state, tile)) return fail('There is already a station here.');
    if (state.stations.some((s) => Math.max(Math.abs(s.x - tileX(state.map, tile)), Math.abs(s.y - tileY(state.map, tile))) < 3)) {
      return fail('Too close to another station. Leave at least two tiles between them.');
    }
    if (COSTS.station > company.cash) return fail(`Not enough cash. A station costs ${money(COSTS.station)}.`);
    const town = nearestTownName(state, tile);
    const taken = state.stations.filter((s) => s.name.startsWith(town)).length;
    const station = {
      id: state.nextId++,
      owner: company.id,
      name: taken ? `${town} ${['East', 'West', 'North', 'South', 'Junction'][taken - 1] || taken + 1}` : town,
      tile,
      x: tileX(state.map, tile),
      y: tileY(state.map, tile),
      catchment: catchmentAt(state, tile),
      waiting: {},
    };
    state.stations.push(station);
    spend(company, COSTS.station, 'construction');
    return ok({ station });
  },

  bulldoze(state, company, { tile }) {
    const station = stationAt(state, tile);
    if (station) {
      if (station.owner !== company.id) return fail('That station belongs to someone else.');
      state.stations = state.stations.filter((s) => s !== station);
      for (const train of state.trains) {
        train.stops = train.stops.filter((id) => id !== station.id);
        train.stopIndex = Math.min(train.stopIndex, Math.max(0, train.stops.length - 1));
        train.reroute = true;
      }
      refund(company, COSTS.station * COSTS.refund, 'construction');
      return ok({ removed: 'station' });
    }
    const pieces = trackNeighbors(state, tile).filter((n) => state.track[edgeKey(tile, n)] === company.id);
    if (!pieces.length) return fail('Nothing of yours to bulldoze here.');
    let back = 0;
    for (const n of pieces) {
      back += segmentCost(state, tile, n) * COSTS.refund;
      delete state.track[edgeKey(tile, n)];
    }
    back = Math.round(back);
    refund(company, back, 'construction');
    for (const train of state.trains) train.reroute = true;
    return ok({ removed: 'track', refund: back });
  },

  buyTrain(state, company, { loco: locoId, cars, stops }) {
    const loco = LOCOS.find((l) => l.id === locoId);
    if (!loco) return fail('Pick a locomotive.');
    if (!Array.isArray(stops) || stops.length < 2) return fail('A train needs at least two stops.');
    const stations = stops.map((id) => state.stations.find((s) => s.id === id));
    if (stations.some((s) => !s)) return fail('One of the stops no longer exists.');
    for (let i = 0; i < stops.length; i++) {
      if (stops[i] === stops[(i + 1) % stops.length]) return fail('Two stops in a row are the same station.');
    }
    if (!Array.isArray(cars) || cars.length < 1) return fail('Add at least one car.');
    if (cars.length > loco.maxCars) return fail(`The ${loco.name} pulls at most ${loco.maxCars} cars.`);
    if (cars.some((c) => !CARGO[c])) return fail('Unknown car type.');
    const price = trainCost(locoId, cars.length);
    if (price > company.cash) return fail(`Not enough cash. This train costs ${money(price)}.`);
    const num = state.trains.filter((t) => t.owner === company.id).length + 1;
    const train = {
      id: state.nextId++,
      owner: company.id,
      name: `Train ${num}`,
      loco: locoId,
      cars: cars.map((cargo) => ({ cargo, amount: 0, origin: null, loadedDay: 0 })),
      stops: stops.slice(),
      stopIndex: 0,
      tile: stations[0].tile,
      path: [stations[0].tile],
      seg: 0,
      segT: 0,
      status: 'loading',
      wait: LOAD_DAYS * TICKS_PER_DAY,
      arrived: false,
      reroute: false,
      price,
      profitYear: 0,
      profitLastYear: null,
      profitTotal: 0,
    };
    state.trains.push(train);
    spend(company, price, 'trains');
    addMessage(state, `${train.name} (${loco.name}) bought for ${money(price)}.`);
    return ok({ train });
  },

  sellTrain(state, company, { trainId }) {
    const train = state.trains.find((t) => t.id === trainId);
    if (!train || train.owner !== company.id) return fail('That train is not yours.');
    const back = Math.round(train.price * COSTS.trainResale);
    state.trains = state.trains.filter((t) => t !== train);
    refund(company, back, 'trains');
    addMessage(state, `${train.name} sold for ${money(back)}.`);
    return ok({ refund: back });
  },

  renameCompany(state, company, { name }) {
    const clean = String(name || '').trim().slice(0, 40);
    if (!clean) return fail('Give the company a name.');
    company.name = clean;
    return ok();
  },
};

export function dispatch(state, cmd) {
  const handler = HANDLERS[cmd.type];
  if (!handler) return fail(`Unknown command ${cmd.type}`);
  const company = state.companies[cmd.company ?? 0];
  if (!company) return fail('Unknown company.');
  if (state.outcome === 'bankrupt') return fail('The company is bankrupt.');
  const result = handler(state, company, cmd);
  if (result.ok) state.commandLog.push({ tick: state.tick, ...cmd });
  return result;
}

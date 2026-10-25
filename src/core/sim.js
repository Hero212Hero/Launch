// The clock. step() advances the world by one tick: trains move every tick,
// industries and towns produce every day, and the books close every month.

import {
  TICKS_PER_DAY, DAYS_PER_MONTH, LOCOS, CAR, CARGO, INDUSTRY_TYPES, STATION_CAP,
  STATION_SPOIL, LOAD_DAYS, GOAL_YEAR, GOAL_CASH, MONTH_NAMES,
} from './data.js';
import { rngNext } from './rng.js';
import { findRoute, hasTrack, segmentLength } from './track.js';
import {
  gameDay, gameDate, earn, spend, addMessage, stationAccepts, deliveryPay, money,
} from './economy.js';
import { emptyLedger } from './world.js';

export function locoOf(train) {
  return LOCOS.find((l) => l.id === train.loco);
}

// Tiles per tick. Each car adds drag.
export function trainSpeed(train) {
  return (locoOf(train).speed * Math.max(0.55, 1 - 0.035 * train.cars.length)) / TICKS_PER_DAY;
}

function stationById(state, id) {
  return state.stations.find((s) => s.id === id);
}

function routeStations(state, train) {
  return train.stops.map((id) => stationById(state, id)).filter(Boolean);
}

function startLeg(state, train) {
  const dest = stationById(state, train.stops[train.stopIndex]);
  if (!dest) {
    train.status = 'noOrders';
    return;
  }
  const route = findRoute(state, train.tile, dest.tile);
  if (!route) {
    train.status = 'lost';
    return;
  }
  // Keep a few tiles of where the train came from so its cars still trail
  // behind the locomotive as it pulls out.
  const tail = train.path[train.path.length - 1] === route[0] ? train.path.slice(-7, -1) : [];
  train.path = [...tail, ...route];
  train.seg = tail.length;
  train.segT = 0;
  train.status = 'moving';
  if (route.length === 1) arrive(state, train);
}

function loadCars(state, train, station) {
  const others = routeStations(state, train).filter((s) => s.id !== station.id);
  const day = gameDay(state);
  for (const car of train.cars) {
    if (car.amount > 0 && car.origin !== station.id) continue;
    if (car.amount >= CAR.capacity) continue;
    // Only pick up cargo that some other stop on the route will take.
    if (!others.some((s) => stationAccepts(state, s, car.cargo))) continue;
    const waiting = Math.floor(station.waiting[car.cargo] || 0);
    const take = Math.min(CAR.capacity - car.amount, waiting);
    if (take <= 0) continue;
    station.waiting[car.cargo] -= take;
    if (car.amount === 0) car.loadedDay = day;
    car.amount += take;
    car.origin = station.id;
  }
}

function feedIndustry(state, station, cargo, amount) {
  for (const id of station.catchment.industries) {
    const ind = state.industries[id];
    const type = INDUSTRY_TYPES[ind.type];
    if (type.converts && type.converts[cargo]) {
      ind.stock[cargo] = (ind.stock[cargo] || 0) + amount;
      return;
    }
  }
}

function arrive(state, train) {
  const station = stationById(state, train.stops[train.stopIndex]);
  train.status = 'loading';
  train.wait = LOAD_DAYS * TICKS_PER_DAY;
  if (!station) return;
  const company = state.companies[train.owner];
  const day = gameDay(state);
  let total = 0;
  const units = {};
  for (const car of train.cars) {
    if (car.amount <= 0 || car.origin === station.id) continue;
    if (!stationAccepts(state, station, car.cargo)) continue;
    const origin = stationById(state, car.origin);
    const pay = origin ? deliveryPay(state, car.cargo, car.amount, origin, station, day - car.loadedDay) : 0;
    total += pay;
    units[car.cargo] = (units[car.cargo] || 0) + car.amount;
    feedIndustry(state, station, car.cargo, car.amount);
    car.amount = 0;
    car.origin = null;
  }
  if (total > 0) {
    earn(company, total);
    train.profitYear += total;
    train.profitTotal += total;
    state.events.push({ type: 'cash', tile: station.tile, amount: total });
    const parts = Object.entries(units).map(([c, n]) => `${n} ${CARGO[c].name.toLowerCase()}`);
    addMessage(state, `${train.name} delivered ${parts.join(', ')} to ${station.name} for ${money(total)}.`, 'cash');
  }
  loadCars(state, train, station);
}

function followReroute(state, train) {
  train.reroute = false;
  if (train.status !== 'moving') return;
  const dest = stationById(state, train.stops[train.stopIndex]);
  const a = train.path[train.seg];
  const b = train.path[train.seg + 1];
  if (dest && b !== undefined && train.segT > 0 && hasTrack(state, a, b)) {
    const ahead = findRoute(state, b, dest.tile);
    if (ahead) {
      train.path = [a, ...ahead];
      train.seg = 0;
      return;
    }
  }
  train.tile = a;
  train.segT = 0;
  startLeg(state, train);
}

function moveTrain(state, train) {
  const { map } = state;
  let d = trainSpeed(train);
  while (d > 0) {
    const a = train.path[train.seg];
    const b = train.path[train.seg + 1];
    if (b === undefined) {
      arrive(state, train);
      return;
    }
    if (train.segT === 0 && !hasTrack(state, a, b)) {
      train.reroute = true;
      followReroute(state, train);
      return;
    }
    const len = segmentLength(map, a, b);
    const left = (1 - train.segT) * len;
    if (d >= left) {
      d -= left;
      train.seg++;
      train.segT = 0;
      train.tile = train.path[train.seg];
    } else {
      train.segT += d / len;
      d = 0;
    }
  }
  if (train.seg >= train.path.length - 1) arrive(state, train);
}

function updateTrain(state, train) {
  if (train.stops.length < 2) {
    train.status = 'noOrders';
    return;
  }
  if (train.reroute) followReroute(state, train);
  if (train.status === 'noOrders') startLeg(state, train);
  if (train.status === 'loading') {
    train.wait--;
    if (train.wait % TICKS_PER_DAY === 0) {
      const station = stationById(state, train.stops[train.stopIndex]);
      if (station) loadCars(state, train, station);
    }
    if (train.wait > 0) return;
    train.stopIndex = (train.stopIndex + 1) % train.stops.length;
    startLeg(state, train);
    return;
  }
  if (train.status === 'lost') {
    if (state.tick % TICKS_PER_DAY === 0) startLeg(state, train);
    return;
  }
  if (train.status === 'moving') moveTrain(state, train);
}

function supply(state, cargo, amount, targets) {
  const weight = targets.reduce((sum, t) => sum + t.weight, 0);
  if (!weight || amount <= 0) return 0;
  for (const { station, weight: w } of targets) {
    station.waiting[cargo] = Math.min(STATION_CAP, (station.waiting[cargo] || 0) + (amount * w) / weight);
  }
  return amount;
}

function produceDaily(state) {
  for (const ind of state.industries) {
    const type = INDUSTRY_TYPES[ind.type];
    let amount = 0;
    if (type.converts) {
      for (const [input, output] of Object.entries(type.converts)) {
        if (output !== type.produces[0]) continue;
        amount += ind.stock[input] || 0;
        ind.stock[input] = 0;
      }
    } else {
      amount = (type.base / DAYS_PER_MONTH) * (0.7 + rngNext(state) * 0.6);
    }
    const targets = state.stations
      .filter((s) => s.catchment.industries.includes(ind.id))
      .map((station) => ({ station, weight: 1 }));
    ind.producedMonth = (ind.producedMonth || 0) + amount;
    ind.shippedMonth = (ind.shippedMonth || 0) + supply(state, type.produces[0], amount, targets);
  }
  for (const town of state.towns) {
    const targets = [];
    for (const station of state.stations) {
      const hit = station.catchment.towns.find((t) => t.id === town.id);
      if (hit) targets.push({ station, weight: hit.houses });
    }
    const f = 0.8 + rngNext(state) * 0.4;
    supply(state, 'passengers', ((town.pop / 30) * f) / DAYS_PER_MONTH, targets);
    supply(state, 'mail', ((town.pop / 100) * f) / DAYS_PER_MONTH, targets);
  }
}

function closeMonth(state) {
  const date = gameDate(state); // already the first day of the new month
  const endedMonth = (date.month + 11) % 12;
  const endedYear = date.month === 0 ? date.year - 1 : date.year;

  for (const ind of state.industries) {
    ind.lastProduced = Math.round(ind.producedMonth || 0);
    ind.lastShipped = Math.round(ind.shippedMonth || 0);
    ind.producedMonth = 0;
    ind.shippedMonth = 0;
  }
  for (const station of state.stations) {
    for (const c of Object.keys(station.waiting)) station.waiting[c] *= STATION_SPOIL;
  }
  for (const company of state.companies) {
    let upkeep = 0;
    for (const train of state.trains.filter((t) => t.owner === company.id)) {
      const cost = (locoOf(train).upkeep + train.cars.length * CAR.upkeep) / 12;
      upkeep += cost;
      train.profitYear -= cost;
      train.profitTotal -= cost;
    }
    spend(company, Math.round(upkeep), 'upkeep');
    const m = company.month;
    company.history.push({
      label: `${MONTH_NAMES[endedMonth]} ${endedYear}`,
      revenue: m.revenue,
      expenses: m.construction + m.trains + m.upkeep,
      cash: company.cash,
    });
    if (company.history.length > 24) company.history.shift();
    company.month = emptyLedger();
    if (date.month === 0) {
      company.lastYear = company.year;
      company.year = emptyLedger();
    }
  }
  if (date.month === 0) {
    for (const train of state.trains) {
      train.profitLastYear = train.profitYear;
      train.profitYear = 0;
    }
  }
  const player = state.companies[0];
  if (!state.outcome) {
    if (player.cash >= GOAL_CASH) state.outcome = 'won';
    else if (date.year >= GOAL_YEAR) state.outcome = 'timeUp';
    if (state.outcome) state.events.push({ type: 'outcome', outcome: state.outcome });
  }
}

export function step(state) {
  state.tick++;
  for (const train of state.trains) updateTrain(state, train);
  if (state.tick % TICKS_PER_DAY === 0) {
    produceDaily(state);
    if (gameDay(state) % DAYS_PER_MONTH === 0) closeMonth(state);
  }
}

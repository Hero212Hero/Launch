// Money, dates, station catchments and cargo payments.

import {
  TICKS_PER_DAY, DAYS_PER_MONTH, START_YEAR, MONTH_NAMES, CARGO, INDUSTRY_TYPES,
  TOWN_ACCEPTS, CATCHMENT,
} from './data.js';
import { tilesAround, tileDist } from './map.js';

export function gameDay(state) {
  return Math.floor(state.tick / TICKS_PER_DAY);
}

export function gameDate(state) {
  const day = gameDay(state);
  const month = Math.floor(day / DAYS_PER_MONTH);
  return { year: START_YEAR + Math.floor(month / 12), month: month % 12, day: (day % DAYS_PER_MONTH) + 1 };
}

export function formatDate(state) {
  const d = gameDate(state);
  return `${MONTH_NAMES[d.month]} ${d.day}, ${d.year}`;
}

export function spend(company, amount, category) {
  company.cash -= amount;
  company.month[category] += amount;
  company.year[category] += amount;
}

// Money back from selling or bulldozing counts against that spending category.
export function refund(company, amount, category) {
  spend(company, -amount, category);
}

export function earn(company, amount) {
  company.cash += amount;
  company.month.revenue += amount;
  company.year.revenue += amount;
}

export function addMessage(state, text, kind = 'info') {
  state.messages.unshift({ day: gameDay(state), text, kind });
  if (state.messages.length > 40) state.messages.length = 40;
}

// Which towns and industries a station at tile t would serve.
export function catchmentAt(state, t) {
  const { map } = state;
  const towns = new Map(); // town id -> house tiles covered
  const industries = new Set();
  for (const i of tilesAround(map, t, CATCHMENT)) {
    if (map.town[i] >= 0) towns.set(map.town[i], (towns.get(map.town[i]) || 0) + 1);
    if (map.industry[i] >= 0) industries.add(map.industry[i]);
  }
  return {
    towns: [...towns].map(([id, houses]) => ({ id, houses })),
    industries: [...industries],
  };
}

export function catchmentCargo(state, catchment) {
  const supplies = new Set();
  const accepts = new Set();
  if (catchment.towns.length) {
    supplies.add('passengers');
    supplies.add('mail');
    for (const c of TOWN_ACCEPTS) accepts.add(c);
  }
  for (const id of catchment.industries) {
    const type = INDUSTRY_TYPES[state.industries[id].type];
    for (const c of type.produces) supplies.add(c);
    for (const c of type.accepts) accepts.add(c);
  }
  return { supplies: [...supplies], accepts: [...accepts] };
}

export function stationAccepts(state, station, cargo) {
  return catchmentCargo(state, station.catchment).accepts.includes(cargo);
}

// What a delivery earns: rate x units x distance, shrinking the longer it took.
export function deliveryPay(state, cargo, amount, fromStation, toStation, days) {
  const info = CARGO[cargo];
  const dist = tileDist(state.map, fromStation.tile, toStation.tile);
  const speed = Math.max(0.3, 1 - days / (info.decayDays * 2));
  return Math.round(amount * info.rate * dist * speed);
}

export function money(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}

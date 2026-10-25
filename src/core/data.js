// Game rules and tuning numbers. Everything the simulation balances on lives here,
// so tweaking the economy never means hunting through logic files.

export const TICKS_PER_DAY = 8;
export const DAYS_PER_MONTH = 30; // simplified calendar: 12 months of 30 days
export const START_YEAR = 1850;
export const GOAL_YEAR = 1860;
export const GOAL_CASH = 1000000;
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const MAP_W = 72;
export const MAP_H = 52;
export const CATCHMENT = 2; // a station gathers from tiles within this many steps

// Terrain ids stored in map.terrain.
export const GRASS = 0;
export const FOREST = 1;
export const HILL = 2;
export const WATER = 3;
export const TERRAIN = [
  { name: 'Grassland', cost: 1 },
  { name: 'Forest', cost: 1.4 },
  { name: 'Hills', cost: 2.4 },
  { name: 'Water', cost: 6 }, // bridge
];
export const TOWN_TILE_COST = 2.5; // buying out buildings in the way

// rate: dollars paid per unit per tile of distance, before the speed bonus.
// decayDays: how quickly the cargo loses value in transit.
export const CARGO = {
  passengers: { name: 'Passengers', color: '#e9d6a0', rate: 8, decayDays: 48 },
  mail: { name: 'Mail', color: '#c9d8f0', rate: 12, decayDays: 36 },
  coal: { name: 'Coal', color: '#2f2c2a', rate: 6, decayDays: 280 },
  lumber: { name: 'Lumber', color: '#a8743f', rate: 6.5, decayDays: 220 },
  grain: { name: 'Grain', color: '#e2b93b', rate: 7, decayDays: 140 },
  steel: { name: 'Steel', color: '#8d9aa6', rate: 8.5, decayDays: 280 },
  goods: { name: 'Goods', color: '#b5527a', rate: 9.5, decayDays: 120 },
};
export const CARGO_IDS = Object.keys(CARGO);

// base: units produced per month for raw producers.
// converts: processors turn delivered input into output one-for-one the next month.
export const INDUSTRY_TYPES = {
  coalMine: { name: 'Coal Mine', produces: ['coal'], accepts: [], base: 48, prefers: HILL, color: '#4b4540', mark: 'C' },
  loggingCamp: { name: 'Logging Camp', produces: ['lumber'], accepts: [], base: 44, prefers: FOREST, color: '#5e7a3a', mark: 'L' },
  farm: { name: 'Farm', produces: ['grain'], accepts: [], base: 40, prefers: GRASS, color: '#c9a640', mark: 'F' },
  steelMill: { name: 'Steel Mill', produces: ['steel'], accepts: ['coal'], base: 0, converts: { coal: 'steel' }, prefers: GRASS, color: '#6f7d8a', mark: 'S' },
  sawmill: { name: 'Sawmill', produces: ['goods'], accepts: ['lumber'], base: 0, converts: { lumber: 'goods' }, prefers: GRASS, color: '#8a5a3a', mark: 'W' },
};
export const INDUSTRY_COUNTS = { coalMine: 3, loggingCamp: 3, farm: 3, steelMill: 2, sawmill: 2 };

export const TOWN_ACCEPTS = ['passengers', 'mail', 'goods', 'grain', 'steel'];
export const TOWN_NAMES = [
  'Ashford', 'Millbrook', 'Cedar Falls', 'Harlow', 'Kingsbridge', 'Redwater',
  'Fairhaven', 'Stonegate', 'Willow Bend', 'Dunmore', 'Bramley', 'Oakridge',
];

// speed: tiles per day on flat track with no cars.
export const LOCOS = [
  { id: 'american', name: '4-4-0 American', price: 42000, speed: 1.8, maxCars: 5, upkeep: 9000, blurb: 'Quick and cheap. Best for passengers and mail.' },
  { id: 'mogul', name: '2-6-0 Mogul', price: 60000, speed: 1.4, maxCars: 8, upkeep: 12000, blurb: 'Slower, but pulls long freight trains.' },
];
export const CAR = { price: 4000, capacity: 20, upkeep: 600 };

export const COSTS = {
  trackPerTile: 1600,
  station: 18000,
  refund: 0.25, // share of track/station cost returned when bulldozed
  trainResale: 0.5,
  startCash: 300000,
};

export const STATION_CAP = 300; // most cargo of one type a station platform holds
export const STATION_SPOIL = 0.9; // share of waiting cargo kept each month
export const LOAD_DAYS = 2;

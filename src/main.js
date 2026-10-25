// Starts the game in the browser: the clock, mouse and touch input, tools, and saving.

import { DAYS_PER_MONTH, COSTS } from './core/data.js';
import { createGame } from './core/world.js';
import { dispatch } from './core/commands.js';
import { step } from './core/sim.js';
import { planTrack, tileHasTrack } from './core/track.js';
import { catchmentAt, catchmentCargo, money, gameDay } from './core/economy.js';
import { tileX, tileY } from './core/map.js';
import { TILE, buildTerrainCache, drawFrame, screenToTile } from './ui/render.js';
import {
  renderPanel, renderTopbar, welcomeDialog, helpDialog, menuDialog, outcomeDialog,
  newTrainDialog, closeDialog,
} from './ui/hud.js';

const SAVE_KEY = 'coin-express-save-v1';
const TICKS_PER_SECOND = [0, 8, 24, 72]; // normal speed: one game day per second
const TOOL_KEYS = { 1: 'inspect', 2: 'track', 3: 'station', 4: 'bulldoze' };

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const el = (id) => document.getElementById(id);

const view = {
  cam: { x: 0, y: 0, zoom: 1 },
  w: 0, h: 0, dpr: 1,
  tool: 'inspect',
  hoverTile: -1,
  trackStart: -1,
  preview: null,
  stationCheck: null,
  selected: null,
  floats: [],
  trackDirty: true,
};

const game = {
  state: null,
  view,
  speed: 1,
  pausedSpeed: 1,
  terrain: null,
  run,
  select,
  setTool,
  resume,
  newGame,
};

let errorText = '';
let errorUntil = 0;
let lastTop = null;
let tickBudget = 0;

// ---- saving ----

function serialize() {
  return JSON.stringify({ ...game.state, events: [] });
}

function save() {
  try {
    localStorage.setItem(SAVE_KEY, serialize());
  } catch (e) {
    // Storage can be blocked (private windows); the game still plays.
  }
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// ---- game control ----

function useState(state) {
  game.state = state;
  game.terrain = buildTerrainCache(state);
  view.selected = null;
  view.trackStart = -1;
  view.preview = null;
  view.trackDirty = true;
  view.floats = [];
  lastTop = state.messages[0] || null;
  el('ticker').innerHTML = '';
  fitCamera();
  renderPanel(game, true);
}

function newGame() {
  useState(createGame());
  save();
  game.speed = 1;
  updateSpeedButtons();
}

function resume() {
  if (game.speed === 0 && game.pausedSpeed) game.speed = game.pausedSpeed;
  updateSpeedButtons();
}

function pauseForDialog() {
  if (game.speed !== 0) game.pausedSpeed = game.speed;
  game.speed = 0;
  updateSpeedButtons();
}

function run(cmd) {
  const res = dispatch(game.state, { company: 0, ...cmd });
  if (res.ok) {
    view.trackDirty = true;
    view.preview = null;
    renderPanel(game, true);
  } else {
    flashError(res.error);
  }
  return res;
}

function select(sel) {
  view.selected = sel;
  el('panel').classList.remove('collapsed');
  renderPanel(game, true);
}

function setTool(tool) {
  view.tool = tool;
  view.trackStart = -1;
  view.preview = null;
  for (const b of document.querySelectorAll('.tool[data-tool]')) b.classList.toggle('active', b.dataset.tool === tool);
  updateHint();
}

function flashError(text) {
  errorText = text;
  errorUntil = performance.now() + 3500;
  updateHint();
}

function updateSpeedButtons() {
  for (const b of document.querySelectorAll('.speed-btn')) b.classList.toggle('active', Number(b.dataset.speed) === game.speed);
}

// ---- hints under the cursor ----

function cargoNames(list) {
  return list.length ? list.map((c) => c[0].toUpperCase() + c.slice(1)).join(', ') : 'nothing';
}

function updateHint() {
  const hint = el('hint');
  const now = performance.now();
  let html = '';
  if (view.tool === 'inspect') {
    html = 'Click anything on the map to see details. Drag to move the map, scroll or pinch to zoom.';
  } else if (view.tool === 'track') {
    if (view.trackStart < 0) html = 'Click where the new track should <b>start</b>.';
    else if (view.preview) {
      const p = view.preview;
      html = p.cost === 0
        ? 'That track is already built. Click to continue from there.'
        : `Click to build: <b>${money(p.cost)}</b> for ${p.path.length - 1} tiles.${p.affordable ? '' : ' <span class="err">Not enough cash.</span>'} Right-click or Esc to stop.`;
    } else html = 'Click where the track should <b>end</b>. Right-click or Esc to stop.';
  } else if (view.tool === 'station') {
    const c = view.stationCheck;
    if (!c) html = `Click a tile that has track. A station costs <b>${money(COSTS.station)}</b>.`;
    else if (!c.ok) html = `<span class="err">${c.reason}</span>`;
    else html = `Build here for <b>${money(COSTS.station)}</b>. Picks up: ${cargoNames(c.cargo.supplies)}. Delivers: ${cargoNames(c.cargo.accepts)}.`;
  } else if (view.tool === 'bulldoze') {
    html = 'Click your track or a station to remove it. You get a quarter of the cost back.';
  }
  if (errorText && now < errorUntil) html = `<span class="err">${errorText}</span>`;
  if (hint.innerHTML !== html) hint.innerHTML = html;
}

function checkStation(tile) {
  const { state } = game;
  if (tile < 0) return null;
  const x = tileX(state.map, tile);
  const y = tileY(state.map, tile);
  const cargo = catchmentCargo(state, catchmentAt(state, tile));
  if (!tileHasTrack(state, tile)) return { ok: false, reason: 'Stations go on a tile that already has track.', cargo };
  if (state.stations.some((s) => s.tile === tile)) return { ok: false, reason: 'There is already a station here.', cargo };
  if (state.stations.some((s) => Math.max(Math.abs(s.x - x), Math.abs(s.y - y)) < 3)) return { ok: false, reason: 'Too close to another station.', cargo };
  return { ok: true, cargo };
}

function setHover(tile) {
  if (tile === view.hoverTile) return;
  view.hoverTile = tile;
  const { state } = game;
  if (view.tool === 'track' && view.trackStart >= 0 && tile >= 0) {
    const plan = planTrack(state, view.trackStart, tile);
    view.preview = plan ? { ...plan, affordable: plan.cost <= state.companies[0].cash } : null;
  } else view.preview = null;
  view.stationCheck = view.tool === 'station' ? checkStation(tile) : null;
  updateHint();
}

// ---- clicking the map ----

function trainNear(tile) {
  const { state } = game;
  let best = null;
  for (const t of state.trains) {
    const d = Math.max(Math.abs(tileX(state.map, t.tile) - tileX(state.map, tile)), Math.abs(tileY(state.map, t.tile) - tileY(state.map, tile)));
    if (d <= 1 && (!best || d < best.d)) best = { t, d };
  }
  return best && best.t;
}

function clickTile(tile) {
  const { state } = game;
  if (tile < 0) return;
  if (view.tool === 'inspect') {
    const station = state.stations.find((s) => s.tile === tile);
    const train = trainNear(tile);
    if (train && !(station && train.status === 'loading' && view.selected?.kind === 'train')) select({ kind: 'train', id: train.id });
    else if (station) select({ kind: 'station', id: station.id });
    else if (state.map.industry[tile] >= 0) select({ kind: 'industry', id: state.map.industry[tile] });
    else if (state.map.town[tile] >= 0) select({ kind: 'town', id: state.map.town[tile] });
    else select(null);
    return;
  }
  if (view.tool === 'track') {
    if (view.trackStart < 0) {
      if (state.map.industry[tile] >= 0) {
        flashError('Track cannot go through an industry.');
        return;
      }
      view.trackStart = tile;
      view.hoverTile = -1;
      setHover(tile);
      updateHint();
      return;
    }
    if (tile === view.trackStart) return;
    const plan = planTrack(state, view.trackStart, tile);
    if (plan && plan.cost === 0) {
      view.trackStart = tile;
    } else {
      const res = run({ type: 'buildTrack', from: view.trackStart, to: tile });
      if (res.ok) view.trackStart = tile; // keep going from the end
    }
    view.hoverTile = -1;
    setHover(tile);
    return;
  }
  if (view.tool === 'station') {
    const res = run({ type: 'buildStation', tile });
    if (res.ok) select({ kind: 'station', id: res.station.id });
    view.stationCheck = checkStation(tile);
    updateHint();
    return;
  }
  if (view.tool === 'bulldoze') {
    const res = run({ type: 'bulldoze', tile });
    if (res.ok && view.selected?.kind === 'station' && !state.stations.some((s) => s.id === view.selected.id)) select(null);
  }
}

// ---- camera and pointer input ----

function resize() {
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.w = canvas.clientWidth;
  view.h = canvas.clientHeight;
  canvas.width = Math.round(view.w * view.dpr);
  canvas.height = Math.round(view.h * view.dpr);
}

function clampCamera() {
  const { map } = game.state;
  view.cam.zoom = Math.max(0.3, Math.min(2.6, view.cam.zoom));
  // Keep the map filling the screen where it is big enough to; centre it where not.
  const clampAxis = (c, size, screen) => {
    const half = screen / 2 / view.cam.zoom;
    return size > half * 2 ? Math.max(half, Math.min(size - half, c)) : size / 2;
  };
  view.cam.x = clampAxis(view.cam.x, map.w * TILE, view.w);
  view.cam.y = clampAxis(view.cam.y, map.h * TILE, view.h);
}

function fitCamera() {
  const { map } = game.state;
  // Fill the screen; the edges of the map are a drag away.
  view.cam.zoom = Math.max(0.45, view.w / (map.w * TILE), view.h / (map.h * TILE));
  view.cam.x = (map.w * TILE) / 2;
  view.cam.y = (map.h * TILE) / 2;
  clampCamera();
}

function zoomAt(sx, sy, factor) {
  const before = { x: (sx - view.w / 2) / view.cam.zoom + view.cam.x, y: (sy - view.h / 2) / view.cam.zoom + view.cam.y };
  view.cam.zoom *= factor;
  clampCamera();
  view.cam.x = before.x - (sx - view.w / 2) / view.cam.zoom;
  view.cam.y = before.y - (sy - view.h / 2) / view.cam.zoom;
  clampCamera();
}

const pointers = new Map();
let drag = null;
let pinch = null;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
    drag = null;
    return;
  }
  drag = { x: e.offsetX, y: e.offsetY, moved: false, button: e.button };
});

canvas.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / pinch.dist);
    pinch.dist = dist;
    return;
  }
  if (drag) {
    const dx = e.offsetX - drag.x;
    const dy = e.offsetY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 6) {
      drag.moved = true;
      canvas.classList.add('panning');
    }
    if (drag.moved) {
      view.cam.x -= dx / view.cam.zoom;
      view.cam.y -= dy / view.cam.zoom;
      clampCamera();
      drag.x = e.offsetX;
      drag.y = e.offsetY;
      return;
    }
  }
  if (e.pointerType === 'mouse' || !drag) setHover(screenToTile(view, game.state.map, e.offsetX, e.offsetY));
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pinch) {
    if (pointers.size < 2) pinch = null;
    drag = null;
    return;
  }
  if (drag && !drag.moved) {
    const tile = screenToTile(view, game.state.map, e.offsetX, e.offsetY);
    if (drag.button === 2) {
      view.trackStart = -1;
      view.preview = null;
      updateHint();
    } else {
      if (e.pointerType !== 'mouse') setHover(tile);
      clickTile(tile);
    }
  }
  drag = null;
  canvas.classList.remove('panning');
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', (e) => {
  pointers.delete(e.pointerId);
  drag = null;
  pinch = null;
});
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse') setHover(-1);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (!el('modal').hidden || e.target.closest('input, select, textarea')) {
    if (e.key === 'Escape' && !el('modal').hidden) {
      closeDialog();
      resume();
    }
    return;
  }
  if (TOOL_KEYS[e.key]) setTool(TOOL_KEYS[e.key]);
  else if (e.key === '5') openNewTrain();
  else if (e.key === 'Escape') {
    if (view.trackStart >= 0) {
      view.trackStart = -1;
      view.preview = null;
      updateHint();
    } else setTool('inspect');
  } else if (e.key === ' ') {
    e.preventDefault();
    if (game.speed === 0) game.speed = game.pausedSpeed || 1;
    else {
      game.pausedSpeed = game.speed;
      game.speed = 0;
    }
    updateSpeedButtons();
  } else if (e.key === '+' || e.key === '=') zoomAt(view.w / 2, view.h / 2, 1.2);
  else if (e.key === '-') zoomAt(view.w / 2, view.h / 2, 1 / 1.2);
  else if (e.key.startsWith('Arrow')) {
    const d = 120 / view.cam.zoom;
    if (e.key === 'ArrowLeft') view.cam.x -= d;
    if (e.key === 'ArrowRight') view.cam.x += d;
    if (e.key === 'ArrowUp') view.cam.y -= d;
    if (e.key === 'ArrowDown') view.cam.y += d;
    clampCamera();
  }
});

// ---- buttons ----

function openNewTrain(fromStationId) {
  pauseForDialog();
  newTrainDialog(game, fromStationId);
}

for (const b of document.querySelectorAll('.tool[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
el('new-train-btn').addEventListener('click', () => openNewTrain(view.selected?.kind === 'station' ? view.selected.id : undefined));
for (const b of document.querySelectorAll('.speed-btn')) {
  b.addEventListener('click', () => {
    game.speed = Number(b.dataset.speed);
    if (game.speed) game.pausedSpeed = game.speed;
    updateSpeedButtons();
  });
}
el('help-btn').addEventListener('click', () => {
  pauseForDialog();
  helpDialog(game);
});
el('menu-btn').addEventListener('click', () => {
  pauseForDialog();
  menuDialog(game);
});
el('modal').addEventListener('click', (e) => {
  if (e.target === el('modal')) {
    closeDialog();
    resume();
  }
});

// Rows in the panel are redrawn often, so they act on pointerdown.
el('panel').addEventListener('pointerdown', (e) => {
  const row = e.target.closest('[data-select]');
  if (!row) return;
  const [kind, id] = row.dataset.select.split(':');
  select({ kind, id: Number(id) });
});
el('panel').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) {
    if (e.target.closest('.panel-head') && window.matchMedia('(max-width: 720px)').matches) el('panel').classList.toggle('collapsed');
    return;
  }
  const act = btn.dataset.action;
  if (act === 'deselect') select(null);
  if (act === 'newTrain') openNewTrain(btn.dataset.from ? Number(btn.dataset.from) : undefined);
  if (act === 'sellTrain') {
    if (btn.dataset.confirm) {
      const res = run({ type: 'sellTrain', trainId: Number(btn.dataset.id) });
      if (res.ok) select(null);
    } else {
      btn.dataset.confirm = '1';
      btn.textContent = 'Tap again to sell';
    }
  }
});

// ---- the clock ----

function drainEvents(now) {
  const { state } = game;
  for (const ev of state.events) {
    if (ev.type === 'cash') view.floats.push({ tile: ev.tile, text: `+${money(ev.amount)}`, born: now });
    if (ev.type === 'outcome') {
      pauseForDialog();
      outcomeDialog(game, ev.outcome);
    }
  }
  state.events.length = 0;
  // New news lines go to the ticker for a few seconds.
  const fresh = [];
  for (const m of state.messages) {
    if (m === lastTop) break;
    fresh.push(m);
  }
  lastTop = state.messages[0] || null;
  const ticker = el('ticker');
  for (const m of fresh.slice(0, 3).reverse()) {
    const div = document.createElement('div');
    div.className = m.kind;
    div.textContent = m.text;
    ticker.prepend(div);
    setTimeout(() => div.remove(), 6000);
  }
  while (ticker.children.length > 3) ticker.lastChild.remove();
}

let lastFrame = performance.now();
let lastHud = 0;
function frame(now) {
  const dt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  const { state } = game;
  tickBudget += dt * TICKS_PER_SECOND[game.speed];
  const startMonth = Math.floor(gameDay(state) / DAYS_PER_MONTH);
  let n = 0;
  while (tickBudget >= 1 && n < 400) {
    step(state);
    tickBudget--;
    n++;
  }
  if (!game.speed) tickBudget = 0;
  if (Math.floor(gameDay(state) / DAYS_PER_MONTH) !== startMonth) save();
  drainEvents(now);
  drawFrame(ctx, state, view, game.terrain, now);
  if (now - lastHud > 250) {
    lastHud = now;
    renderTopbar(game);
    renderPanel(game, false);
    updateHint();
  }
  requestAnimationFrame(frame);
}

function start(data) {
  resize();
  const saved = (data && data.save && JSON.parse(data.save)) || loadSave();
  useState(saved || createGame());
  setTool('inspect');
  if (window.matchMedia('(max-width: 720px)').matches) el('panel').classList.add('collapsed');
  if (data && data.save) {
    updateSpeedButtons();
  } else {
    pauseForDialog();
    welcomeDialog(game, Boolean(saved));
  }
  window.claude?.hot?.snapshot?.(() => ({ save: serialize() }));
  window.addEventListener('resize', () => {
    resize();
    clampCamera();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
  });
  requestAnimationFrame(frame);
}

if (window.claude?.hot?.ready) window.claude.hot.ready(start);
else start(window.claude?.hot?.data ?? {});

window.coinExpress = game; // handy for poking at the game from the browser console

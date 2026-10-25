// Draws the map on a canvas. Placeholder art: flat colour tiles, simple shapes
// for buildings and trains. Terrain, towns and industries never change during a
// game, so they are painted once into an offscreen canvas.

import { GRASS, FOREST, HILL, WATER, CARGO, INDUSTRY_TYPES, CATCHMENT } from '../core/data.js';
import { tileX, tileY, tileAt } from '../core/map.js';
import { segmentLength } from '../core/track.js';

export const TILE = 32;

const PAINT = {
  grass: ['#8da768', '#93ad6c', '#88a163'],
  forestFloor: '#7b9659',
  tree: ['#3f6232', '#4a6f38', '#365a2d'],
  hill: ['#b4a172', '#ab9869', '#bba879'],
  hillLine: '#8f7d52',
  water: '#4d7f9f',
  ripple: '#6e9cb9',
  roofs: ['#9b4a36', '#7d5a45', '#a8613d', '#6f6255'],
  wall: '#e3d6bd',
  yard: '#a39a80',
  tie: '#5c3f27',
  rail: '#2a2a2a',
  label: '#fffaf0',
  halo: '#1a1f1d',
};

function hash(x, y) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export function tileCenter(map, t) {
  return [(tileX(map, t) + 0.5) * TILE, (tileY(map, t) + 0.5) * TILE];
}

function paintTile(g, state, t) {
  const { map } = state;
  const x = tileX(map, t);
  const y = tileY(map, t);
  const px = x * TILE;
  const py = y * TILE;
  const r = hash(x, y);
  const type = map.terrain[t];
  if (type === WATER) {
    g.fillStyle = PAINT.water;
    g.fillRect(px, py, TILE, TILE);
    g.strokeStyle = PAINT.ripple;
    g.lineWidth = 1.5;
    g.beginPath();
    const ry = py + 8 + r * 16;
    g.moveTo(px + 6, ry);
    g.quadraticCurveTo(px + 12, ry - 3, px + 18, ry);
    g.stroke();
    return;
  }
  if (type === HILL) {
    g.fillStyle = PAINT.hill[Math.floor(r * 3)];
    g.fillRect(px, py, TILE, TILE);
    g.strokeStyle = PAINT.hillLine;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(px + 16, py + 26, 10 + r * 4, Math.PI * 1.15, Math.PI * 1.85);
    g.stroke();
    return;
  }
  g.fillStyle = type === FOREST ? PAINT.forestFloor : PAINT.grass[Math.floor(r * 3)];
  g.fillRect(px, py, TILE, TILE);
  if (type === FOREST && map.town[t] < 0) {
    for (let i = 0; i < 3; i++) {
      const tx = px + 7 + hash(x + i, y) * 18;
      const ty = py + 7 + hash(x, y + i) * 18;
      g.fillStyle = PAINT.tree[i];
      g.beginPath();
      g.arc(tx, ty, 6, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (type === GRASS && r > 0.86) {
    g.fillStyle = '#7f9a5c';
    g.fillRect(px + r * 20, py + hash(y, x) * 20, 3, 3);
  }
}

function paintHouses(g, state, t) {
  const { map } = state;
  const x = tileX(map, t);
  const y = tileY(map, t);
  const n = 2 + Math.floor(hash(x * 3, y) * 2);
  for (let i = 0; i < n; i++) {
    const hx = x * TILE + 3 + hash(x + i * 7, y) * 17;
    const hy = y * TILE + 3 + hash(x, y + i * 5) * 17;
    g.fillStyle = PAINT.wall;
    g.fillRect(hx, hy + 4, 11, 8);
    g.fillStyle = PAINT.roofs[Math.floor(hash(hx, hy) * 4)];
    g.fillRect(hx - 1, hy, 13, 6);
  }
}

function paintIndustry(g, state, ind) {
  const type = INDUSTRY_TYPES[ind.type];
  const px = ind.x * TILE;
  const py = ind.y * TILE;
  const s = TILE * 2;
  g.fillStyle = PAINT.yard;
  g.fillRect(px + 2, py + 2, s - 4, s - 4);
  g.strokeStyle = '#6d6553';
  g.lineWidth = 2;
  g.strokeRect(px + 2, py + 2, s - 4, s - 4);
  g.fillStyle = type.color;
  if (ind.type === 'coalMine') {
    g.beginPath();
    g.moveTo(px + 8, py + s - 10);
    g.lineTo(px + 26, py + 14);
    g.lineTo(px + 44, py + s - 10);
    g.fill();
    g.fillRect(px + 40, py + 18, 16, 22);
  } else if (ind.type === 'loggingCamp') {
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#8a5a32' : '#a06a3a';
      g.fillRect(px + 8, py + 34 + i * 5, 30, 4);
    }
    g.fillStyle = type.color;
    g.fillRect(px + 38, py + 12, 18, 16);
  } else if (ind.type === 'farm') {
    g.fillStyle = '#d8bc58';
    g.fillRect(px + 6, py + 30, 52, 26);
    g.strokeStyle = '#b39535';
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.moveTo(px + 6, py + 34 + i * 5);
      g.lineTo(px + 58, py + 34 + i * 5);
      g.stroke();
    }
    g.fillStyle = '#9b3b2c';
    g.fillRect(px + 12, py + 10, 20, 16);
    g.fillStyle = '#d9d0bd';
    g.fillRect(px + 38, py + 8, 10, 20);
  } else {
    g.fillRect(px + 8, py + 22, 48, 32);
    g.fillStyle = '#4a4f55';
    g.fillRect(px + 14, py + 6, 7, 18);
    g.fillRect(px + 28, py + 10, 7, 14);
    g.fillStyle = '#d9d0bd55';
    g.beginPath();
    g.arc(px + 18, py + 4, 6, 0, Math.PI * 2);
    g.fill();
  }
  // letter badge so each kind reads at a glance
  g.fillStyle = '#1b1f1d';
  g.beginPath();
  g.arc(px + s - 12, py + 12, 9, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff3d6';
  g.font = 'bold 12px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(type.mark, px + s - 12, py + 12.5);
}

export function buildTerrainCache(state) {
  const { map } = state;
  const canvas = document.createElement('canvas');
  canvas.width = map.w * TILE;
  canvas.height = map.h * TILE;
  const g = canvas.getContext('2d');
  for (let t = 0; t < map.w * map.h; t++) paintTile(g, state, t);
  for (let t = 0; t < map.w * map.h; t++) if (map.town[t] >= 0) paintHouses(g, state, t);
  for (const ind of state.industries) paintIndustry(g, state, ind);
  return canvas;
}

// ---- per-frame drawing ----

function parseTrack(state) {
  const out = [];
  for (const key of Object.keys(state.track)) {
    const [a, b] = key.split('-').map(Number);
    out.push([a, b, state.track[key]]);
  }
  return out;
}

function drawTrackPieces(ctx, state, view, pieces, style) {
  const { map } = state;
  const detailed = view.cam.zoom * TILE >= 18;
  if (detailed && !style) {
    ctx.strokeStyle = PAINT.tie;
    ctx.lineWidth = 3;
    for (const [a, b] of pieces) {
      const [ax, ay] = tileCenter(map, a);
      const [bx, by] = tileCenter(map, b);
      const len = Math.hypot(bx - ax, by - ay);
      const nx = -(by - ay) / len;
      const ny = (bx - ax) / len;
      const count = Math.round(len / 7);
      ctx.beginPath();
      for (let i = 0; i <= count; i++) {
        const cx = ax + ((bx - ax) * i) / count;
        const cy = ay + ((by - ay) * i) / count;
        ctx.moveTo(cx - nx * 7, cy - ny * 7);
        ctx.lineTo(cx + nx * 7, cy + ny * 7);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = PAINT.rail;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const [a, b] of pieces) {
      const [ax, ay] = tileCenter(map, a);
      const [bx, by] = tileCenter(map, b);
      const len = Math.hypot(bx - ax, by - ay);
      const nx = (-(by - ay) / len) * 3.5;
      const ny = ((bx - ax) / len) * 3.5;
      ctx.moveTo(ax + nx, ay + ny);
      ctx.lineTo(bx + nx, by + ny);
      ctx.moveTo(ax - nx, ay - ny);
      ctx.lineTo(bx - nx, by - ny);
    }
    ctx.stroke();
    return;
  }
  ctx.strokeStyle = style || '#3a2c20';
  ctx.lineWidth = style ? 6 : Math.max(2, 4 / view.cam.zoom);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [a, b] of pieces) {
    const [ax, ay] = tileCenter(map, a);
    const [bx, by] = tileCenter(map, b);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function drawStations(ctx, state, view) {
  const { map } = state;
  for (const s of state.stations) {
    const [cx, cy] = tileCenter(map, s.tile);
    const color = state.companies[s.owner].color;
    ctx.fillStyle = '#f4ead4';
    ctx.strokeStyle = '#1b1f1d';
    ctx.lineWidth = 2;
    ctx.fillRect(cx - 13, cy - 9, 26, 18);
    ctx.strokeRect(cx - 13, cy - 9, 26, 18);
    ctx.fillStyle = color;
    ctx.fillRect(cx - 13, cy - 9, 26, 7);
    const sel = view.selected;
    if (sel && sel.kind === 'station' && sel.id === s.id) {
      ctx.strokeStyle = '#d6a740';
      ctx.lineWidth = 3;
      ctx.strokeRect(cx - 17, cy - 13, 34, 26);
    }
  }
}

// Point a given distance behind the train's head, along its path.
function pointBehind(map, train, back) {
  const { path } = train;
  if (path.length < 2) {
    const [x, y] = tileCenter(map, path[0]);
    return [x, y, 0];
  }
  let i = train.seg;
  let along;
  if (i >= path.length - 1) {
    i = path.length - 2;
    along = segmentLength(map, path[i], path[i + 1]) - back;
  } else {
    along = train.segT * segmentLength(map, path[i], path[i + 1]) - back;
  }
  while (along < 0 && i > 0) {
    i--;
    along += segmentLength(map, path[i], path[i + 1]);
  }
  const a = path[i];
  const b = path[i + 1];
  const f = Math.max(0, Math.min(1, along / segmentLength(map, a, b)));
  const [ax, ay] = tileCenter(map, a);
  const [bx, by] = tileCenter(map, b);
  return [ax + (bx - ax) * f, ay + (by - ay) * f, Math.atan2(by - ay, bx - ax)];
}

function drawTrains(ctx, state, view) {
  const { map } = state;
  for (const train of state.trains) {
    const color = state.companies[train.owner].color;
    const selected = view.selected && view.selected.kind === 'train' && view.selected.id === train.id;
    for (let i = train.cars.length; i >= 0; i--) {
      const [x, y, ang] = pointBehind(map, train, i * 0.55);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      if (i === 0) {
        ctx.fillStyle = '#1d1d1f';
        ctx.fillRect(-8, -5.5, 16, 11);
        ctx.fillStyle = color;
        ctx.fillRect(-8, -5.5, 6, 11);
        ctx.fillStyle = '#d6a740';
        ctx.fillRect(5, -2, 3, 4);
      } else {
        const car = train.cars[i - 1];
        ctx.fillStyle = '#3b3530';
        ctx.fillRect(-7, -5, 14, 10);
        if (car.amount > 0) {
          ctx.fillStyle = CARGO[car.cargo].color;
          ctx.fillRect(-5.5, -3.5, 11, 7);
        } else {
          ctx.strokeStyle = CARGO[car.cargo].color;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(-5, -3, 10, 6);
        }
      }
      if (selected && i === 0) {
        ctx.strokeStyle = '#d6a740';
        ctx.lineWidth = 2;
        ctx.strokeRect(-10, -8, 20, 16);
      }
      ctx.restore();
    }
  }
}

function haloText(ctx, text, x, y, size, font, color = PAINT.label) {
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, size / 4);
  ctx.strokeStyle = PAINT.halo;
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawLabels(ctx, state, view) {
  const { map } = state;
  const z = view.cam.zoom;
  // Labels are drawn in screen space so they stay readable at any zoom.
  const toScreen = (wx, wy) => [(wx - view.cam.x) * z + view.w / 2, (wy - view.cam.y) * z + view.h / 2];
  for (const town of state.towns) {
    const [sx, sy] = toScreen((town.x + 0.5) * TILE, (town.y - 1.2) * TILE);
    haloText(ctx, town.name, sx, sy, 17, "'Rye', Georgia, serif");
    if (z > 0.55) haloText(ctx, `pop. ${town.pop.toLocaleString('en-US')}`, sx, sy + 15, 12, "'Barlow Semi Condensed', sans-serif", '#e9e2cf');
  }
  if (z > 0.62) {
    for (const ind of state.industries) {
      const [sx, sy] = toScreen((ind.x + 1) * TILE, (ind.y + 2.35) * TILE);
      haloText(ctx, INDUSTRY_TYPES[ind.type].name, sx, sy, 12, "'Barlow Semi Condensed', sans-serif");
    }
  }
  for (const s of state.stations) {
    const [sx, sy] = toScreen((s.x + 0.5) * TILE, (s.y + 1.05) * TILE);
    haloText(ctx, s.name, sx, sy, 13, "'Barlow Semi Condensed', sans-serif", '#ffe3a3');
  }
}

function drawOverlays(ctx, state, view) {
  const { map } = state;
  const hover = view.hoverTile;
  if (view.tool === 'station' && hover >= 0) {
    const x = tileX(map, hover);
    const y = tileY(map, hover);
    const ok = view.stationCheck && view.stationCheck.ok;
    ctx.fillStyle = ok ? '#d6a74033' : '#ec756333';
    ctx.strokeStyle = ok ? '#d6a740' : '#ec7563';
    ctx.lineWidth = 2;
    const r = CATCHMENT;
    ctx.fillRect((x - r) * TILE, (y - r) * TILE, (2 * r + 1) * TILE, (2 * r + 1) * TILE);
    ctx.setLineDash([6, 5]);
    ctx.strokeRect((x - r) * TILE, (y - r) * TILE, (2 * r + 1) * TILE, (2 * r + 1) * TILE);
    ctx.setLineDash([]);
  }
  if (view.tool === 'track' && view.preview) {
    const pieces = [];
    for (let i = 1; i < view.preview.path.length; i++) pieces.push([view.preview.path[i - 1], view.preview.path[i]]);
    drawTrackPieces(ctx, state, view, pieces, view.preview.affordable ? '#d6a740cc' : '#ec7563cc');
  }
  if (view.tool === 'track' && view.trackStart >= 0) {
    const [cx, cy] = tileCenter(map, view.trackStart);
    ctx.fillStyle = '#d6a740';
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  if (hover >= 0) {
    ctx.strokeStyle = view.tool === 'bulldoze' ? '#ec7563' : '#fff8e6';
    ctx.lineWidth = 2;
    ctx.strokeRect(tileX(map, hover) * TILE + 1, tileY(map, hover) * TILE + 1, TILE - 2, TILE - 2);
  }
  const sel = view.selected;
  if (sel && sel.kind === 'industry') {
    const ind = state.industries[sel.id];
    ctx.strokeStyle = '#d6a740';
    ctx.lineWidth = 3;
    ctx.strokeRect(ind.x * TILE - 2, ind.y * TILE - 2, TILE * 2 + 4, TILE * 2 + 4);
  }
}

function drawFloats(ctx, state, view, now) {
  const { map } = state;
  const z = view.cam.zoom;
  view.floats = view.floats.filter((f) => now - f.born < 1800);
  for (const f of view.floats) {
    const age = (now - f.born) / 1800;
    const [wx, wy] = tileCenter(map, f.tile);
    const sx = (wx - view.cam.x) * z + view.w / 2;
    const sy = (wy - view.cam.y) * z + view.h / 2 - 18 - age * 36;
    ctx.globalAlpha = 1 - age * age;
    haloText(ctx, f.text, sx, sy, 16, "'Barlow Semi Condensed', sans-serif", '#9fe39f');
    ctx.globalAlpha = 1;
  }
}

export function drawFrame(ctx, state, view, terrain, now) {
  const { w, h, dpr, cam } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#22302a';
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * (w / 2 - cam.x * cam.zoom), dpr * (h / 2 - cam.y * cam.zoom));
  ctx.imageSmoothingEnabled = cam.zoom < 1;
  ctx.drawImage(terrain, 0, 0);
  if (!view.trackCache || view.trackDirty) {
    view.trackCache = parseTrack(state);
    view.trackDirty = false;
  }
  drawTrackPieces(ctx, state, view, view.trackCache);
  drawOverlays(ctx, state, view);
  drawStations(ctx, state, view);
  drawTrains(ctx, state, view);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawLabels(ctx, state, view);
  drawFloats(ctx, state, view, now);
}

export function screenToTile(view, map, sx, sy) {
  const wx = (sx - view.w / 2) / view.cam.zoom + view.cam.x;
  const wy = (sy - view.h / 2) / view.cam.zoom + view.cam.y;
  return tileAt(map, Math.floor(wx / TILE), Math.floor(wy / TILE));
}

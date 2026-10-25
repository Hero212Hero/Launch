// Everything on screen that is not the map: the info panel, hints, the news
// ticker and the dialogs. All game changes go through game.run(command).

import {
  CARGO, CARGO_IDS, INDUSTRY_TYPES, LOCOS, CAR, COSTS, GOAL_CASH, GOAL_YEAR, TOWN_ACCEPTS,
} from '../core/data.js';
import { formatDate, gameDate, catchmentCargo, money } from '../core/economy.js';
import { findRoute } from '../core/track.js';
import { trainCost } from '../core/commands.js';
import { locoOf } from '../core/sim.js';

const $ = (id) => document.getElementById(id);

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function chip(cargo) {
  return `<span class="chip"><i style="background:${CARGO[cargo].color}"></i>${CARGO[cargo].name}</span>`;
}

function chips(list, empty = 'Nothing') {
  return list.length ? `<div class="chips">${list.map(chip).join('')}</div>` : `<span class="muted small">${empty}</span>`;
}

function rows(pairs) {
  return `<div class="rows">${pairs.map(([k, v, cls = '']) => `<span class="${cls.includes('total') ? 'total' : ''}">${k}</span><span class="v ${cls}">${v}</span>`).join('')}</div>`;
}

function section(label, body) {
  return `<div><div class="section-label">${label}</div>${body}</div>`;
}

const STATUS_TEXT = {
  moving: 'Running',
  loading: 'At station',
  lost: 'No route',
  noOrders: 'No orders',
};

function trainLine(state, train) {
  const stop = state.stations.find((s) => s.id === train.stops[train.stopIndex]);
  const where = stop ? stop.name : 'nowhere';
  if (train.status === 'moving') return `Heading to ${esc(where)}`;
  if (train.status === 'loading') return `Loading at ${esc(where)}`;
  if (train.status === 'lost') return `No track to ${esc(where)}. Connect it and the train will go.`;
  return 'Needs at least two stops.';
}

function ledgerRows(ledger) {
  const spent = ledger.construction + ledger.trains + ledger.upkeep;
  const profit = ledger.revenue - ledger.upkeep;
  return rows([
    ['Cargo revenue', money(ledger.revenue), 'good'],
    ['Train running costs', money(-ledger.upkeep), ledger.upkeep ? 'bad' : ''],
    ['Operating profit', money(profit), `total ${profit >= 0 ? 'good' : 'bad'}`],
    ['Building and buying', money(-(spent - ledger.upkeep)), ''],
  ]);
}

// ---- panel views. Each returns { kind, title, live, actions }. "live" is redrawn
// a few times a second; "actions" only when the selection changes.

function companyView(game) {
  const { state } = game;
  const c = state.companies[0];
  const date = gameDate(state);
  const pct = Math.max(0, Math.min(100, (c.cash / GOAL_CASH) * 100));
  const yearsLeft = GOAL_YEAR - date.year;
  const goalNote = state.outcome === 'won'
    ? 'Goal reached. Keep growing.'
    : yearsLeft > 0 ? `${yearsLeft} year${yearsLeft === 1 ? '' : 's'} left, until Jan 1, ${GOAL_YEAR}` : 'Time is up. Play on as long as you like.';
  const trains = state.trains.filter((t) => t.owner === 0);
  const trainList = trains.length
    ? `<div class="list">${trains.map((t) => `
        <div class="list-row" data-select="train:${t.id}">
          <span><strong>${esc(t.name)}</strong> <span class="pill ${t.status}">${STATUS_TEXT[t.status]}</span></span>
          <span class="${t.profitYear >= 0 ? '' : 'muted'}">${money(t.profitYear)}</span>
          <span class="sub">${trainLine(state, t)}</span>
        </div>`).join('')}</div>`
    : '<span class="muted small">No trains yet. Lay track between two places, add a station at each end, then buy a train.</span>';
  const news = state.messages.slice(0, 5).map((m) => `<div class="${m.kind}">${esc(m.text)}</div>`).join('') || '<span class="muted small">Nothing yet.</span>';
  return {
    kind: 'Your railroad',
    title: c.name,
    live: [
      section(`Goal: ${money(GOAL_CASH)} cash`, `<div class="goal-bar"><span style="width:${pct}%"></span></div><div class="small muted" style="margin-top:4px">${money(c.cash)} of ${money(GOAL_CASH)} · ${goalNote}</div>`),
      section(`This year (${date.year})`, ledgerRows(c.year)),
      c.lastYear ? section('Last year', rows([['Operating profit', money(c.lastYear.revenue - c.lastYear.upkeep), c.lastYear.revenue - c.lastYear.upkeep >= 0 ? 'good' : 'bad']])) : '',
      section(`Trains (${trains.length}) · profit this year`, trainList),
      section('Latest news', `<div class="news">${news}</div>`),
    ].join(''),
    actions: '<button type="button" class="btn primary" data-action="newTrain">Buy a train</button>',
  };
}

function stationsServing(state, test) {
  return state.stations.filter(test).map((s) => esc(s.name));
}

function townView(game, id) {
  const { state } = game;
  const town = state.towns[id];
  const served = stationsServing(state, (s) => s.catchment.towns.some((t) => t.id === id));
  return {
    kind: 'Town',
    title: town.name,
    live: [
      rows([
        ['Population', town.pop.toLocaleString('en-US')],
        ['Passengers each month', `about ${Math.round(town.pop / 30)}`],
        ['Mail each month', `about ${Math.round(town.pop / 100)}`],
      ]),
      section('Wants', chips(TOWN_ACCEPTS)),
      section('Your stations here', served.length ? served.join(', ') : '<span class="muted small">None. Build a station within two tiles of the houses.</span>'),
    ].join(''),
    actions: '',
  };
}

function industryView(game, id) {
  const { state } = game;
  const ind = state.industries[id];
  const type = INDUSTRY_TYPES[ind.type];
  const served = stationsServing(state, (s) => s.catchment.industries.includes(id));
  const share = ind.lastProduced ? Math.round((ind.lastShipped / ind.lastProduced) * 100) : 0;
  const what = type.converts
    ? `Turns ${Object.keys(type.converts).map((c) => CARGO[c].name.toLowerCase()).join(' and ')} into ${CARGO[type.produces[0]].name.toLowerCase()}. Deliver ${Object.keys(type.converts).map((c) => CARGO[c].name.toLowerCase()).join(' and ')} here to get ${CARGO[type.produces[0]].name.toLowerCase()} to sell on.`
    : `Produces about ${type.base} ${CARGO[type.produces[0]].name.toLowerCase()} a month.`;
  return {
    kind: type.name,
    title: ind.name,
    live: [
      `<p class="small" style="margin:0">${what}</p>`,
      section('Makes', chips(type.produces)),
      type.accepts.length ? section('Wants', chips(type.accepts)) : '',
      section('Last month', rows([
        ['Produced', `${ind.lastProduced || 0}`],
        ['Picked up by your stations', `${share}%`],
      ])),
      section('Your stations here', served.length ? served.join(', ') : '<span class="muted small">None. Build a station within two tiles.</span>'),
    ].join(''),
    actions: '',
  };
}

function stationView(game, id) {
  const { state } = game;
  const st = state.stations.find((s) => s.id === id);
  if (!st) return null;
  const cargo = catchmentCargo(state, st.catchment);
  const waiting = CARGO_IDS.filter((c) => (st.waiting[c] || 0) >= 1);
  const trains = state.trains.filter((t) => t.stops.includes(id));
  return {
    kind: 'Station',
    title: st.name,
    live: [
      section('Waiting on the platform', waiting.length ? rows(waiting.map((c) => [CARGO[c].name, Math.floor(st.waiting[c])])) : '<span class="muted small">Nothing waiting yet.</span>'),
      section('Picks up', chips(cargo.supplies, 'Nothing nearby to pick up')),
      section('Delivers', chips(cargo.accepts, 'Nothing nearby wants cargo')),
      section('Trains calling here', trains.length ? `<div class="list">${trains.map((t) => `<div class="list-row" data-select="train:${t.id}"><span>${esc(t.name)}</span><span class="pill ${t.status}">${STATUS_TEXT[t.status]}</span></div>`).join('')}</div>` : '<span class="muted small">None yet.</span>'),
    ].join(''),
    actions: `<button type="button" class="btn primary" data-action="newTrain" data-from="${id}">Buy a train from here</button>`,
  };
}

function trainView(game, id) {
  const { state } = game;
  const train = state.trains.find((t) => t.id === id);
  if (!train) return null;
  const loco = locoOf(train);
  const stops = train.stops.map((sid, i) => {
    const st = state.stations.find((s) => s.id === sid);
    const here = i === train.stopIndex;
    return `<div class="${here ? '' : 'muted'}">${here ? '▸ ' : ''}${i + 1}. ${esc(st ? st.name : 'Removed station')}</div>`;
  }).join('');
  const cars = train.cars.map((car) => {
    const fill = Math.round((car.amount / CAR.capacity) * 100);
    return `<div class="car" title="${CARGO[car.cargo].name}: ${car.amount}/${CAR.capacity}" style="border-color:${CARGO[car.cargo].color}"><span style="width:${fill}%;background:${CARGO[car.cargo].color}"></span></div>`;
  }).join('');
  return {
    kind: loco.name,
    title: train.name,
    live: [
      `<div><span class="pill ${train.status}">${STATUS_TEXT[train.status]}</span> <span class="small">${trainLine(state, train)}</span></div>`,
      section('Cars', `<div class="cars">${cars}</div><div class="small muted" style="margin-top:4px">${[...new Set(train.cars.map((c) => CARGO[c.cargo].name))].join(', ')}</div>`),
      section('Route', `<div class="small">${stops}</div>`),
      section('Profit', rows([
        ['This year', money(train.profitYear), train.profitYear >= 0 ? 'good' : 'bad'],
        ['Last year', train.profitLastYear === null ? '–' : money(train.profitLastYear)],
        ['Since bought', money(train.profitTotal), train.profitTotal >= 0 ? 'good' : 'bad'],
      ])),
    ].join(''),
    actions: `<button type="button" class="btn danger" data-action="sellTrain" data-id="${id}">Sell for ${money(train.price * COSTS.trainResale)}</button>`,
  };
}

function viewFor(game) {
  const sel = game.view.selected;
  if (!sel) return companyView(game);
  if (sel.kind === 'town') return townView(game, sel.id);
  if (sel.kind === 'industry') return industryView(game, sel.id);
  if (sel.kind === 'station') return stationView(game, sel.id) || companyView(game);
  if (sel.kind === 'train') return trainView(game, sel.id) || companyView(game);
  return companyView(game);
}

export function renderPanel(game, full) {
  const v = viewFor(game);
  const close = game.view.selected ? '<button type="button" class="close" data-action="deselect" aria-label="Back to company">×</button>' : '';
  if (full) {
    $('panel-head').innerHTML = `${close}<div class="kind">${esc(v.kind)}</div><h2>${esc(v.title)}</h2>`;
    $('panel-actions').innerHTML = v.actions;
  }
  if ($('panel-live').dataset.html !== v.live) {
    $('panel-live').innerHTML = v.live;
    $('panel-live').dataset.html = v.live;
  }
}

export function renderTopbar(game) {
  const c = game.state.companies[0];
  const cash = $('cash');
  cash.textContent = money(c.cash);
  cash.classList.toggle('negative', c.cash < 0);
  $('date').textContent = formatDate(game.state);
  $('company-name').textContent = c.name;
}

// ---- dialogs ----

export function openDialog(html, onClick) {
  $('dialog').innerHTML = html;
  $('modal').hidden = false;
  $('dialog').onclick = onClick || null;
  const first = $('dialog').querySelector('button.primary, button');
  if (first) first.focus();
}

export function closeDialog() {
  $('modal').hidden = true;
  $('dialog').innerHTML = '';
  $('dialog').onclick = null;
  $('dialog').onchange = null;
}

export function helpHtml() {
  return `
    <h3>How to play</h3>
    <ol class="steps">
      <li><b>Lay track.</b> Pick <em>Lay track</em>, click where it starts, then click where it ends. You see the price before you build. Hills, forest, towns and rivers cost more.</li>
      <li><b>Build a station</b> on your track, close to a town or an industry. The shaded square shows what the station reaches.</li>
      <li><b>Buy a train.</b> Choose its stops and the kinds of cars it pulls.</li>
      <li><b>Get paid on delivery.</b> A train earns money when it brings cargo to a station that wants it. Longer trips pay more; slow trips pay less.</li>
    </ol>
    <h3>What goes where</h3>
    <p>Passengers and mail travel between towns. Coal goes to a steel mill, which makes steel that towns buy. Lumber goes to a sawmill, which makes goods that towns buy. Towns also buy grain from farms.</p>
    <h3>Controls</h3>
    <p>Drag the map to move it. Scroll or pinch to zoom. Keys 1 to 5 pick tools, Space pauses, Esc stops laying track.</p>`;
}

export function welcomeDialog(game, hasSave) {
  openDialog(`
    <h1>Coin Express</h1>
    <p class="lede">It is 1850. You run a small railroad company with ${money(COSTS.startCash)} in the bank. Connect towns and industries, haul their cargo, and build a fortune.</p>
    <p><strong>Goal:</strong> have ${money(GOAL_CASH)} in cash before January ${GOAL_YEAR}.</p>
    ${helpHtml()}
    <div class="actions">
      ${hasSave ? '<button type="button" class="btn" data-act="continue">Continue saved game</button>' : ''}
      <button type="button" class="btn primary" data-act="new">Start a new railroad</button>
    </div>`, (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'continue') { closeDialog(); game.resume(); }
    if (act === 'new') {
      closeDialog();
      if (hasSave) game.newGame();
      else game.resume(); // the fresh map behind the dialog is already new
    }
  });
}

export function helpDialog(game) {
  openDialog(`<h2>How Coin Express works</h2>${helpHtml()}<div class="actions"><button type="button" class="btn primary" data-act="close">Back to the game</button></div>`, (e) => {
    if (e.target.closest('[data-act="close"]')) { closeDialog(); game.resume(); }
  });
}

export function menuDialog(game) {
  let confirming = false;
  const draw = () => openDialog(`
    <h2>Game</h2>
    <p class="muted">Your game saves itself in this browser at the start of every month.</p>
    <h3>Company name</h3>
    <input class="name-input" id="company-input" maxlength="40" value="${esc(game.state.companies[0].name)}">
    <h3>Map</h3>
    <p class="small muted">Map number ${game.state.seed}. Every new railroad gets a fresh map.</p>
    <div class="actions">
      ${confirming
        ? '<span class="warn">This throws away the current game.</span><button type="button" class="btn" data-act="cancel">Keep playing</button><button type="button" class="btn danger" data-act="reallyNew">Yes, start over</button>'
        : '<button type="button" class="btn" data-act="new">Start a new railroad</button><button type="button" class="btn primary" data-act="close">Done</button>'}
    </div>`, (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const name = document.getElementById('company-input')?.value;
    if (name && name !== game.state.companies[0].name) game.run({ type: 'renameCompany', name });
    if (act === 'close' || act === 'cancel') {
      if (act === 'cancel') { confirming = false; draw(); return; }
      closeDialog();
      game.resume();
    }
    if (act === 'new') { confirming = true; draw(); }
    if (act === 'reallyNew') { closeDialog(); game.newGame(); }
  });
  draw();
}

export function outcomeDialog(game, outcome) {
  const c = game.state.companies[0];
  const won = outcome === 'won';
  openDialog(`
    <h1>${won ? 'A railroad fortune' : `January ${GOAL_YEAR}`}</h1>
    <p class="lede">${won
      ? `${esc(c.name)} reached ${money(GOAL_CASH)} on ${formatDate(game.state)}. The papers call you a rail baron.`
      : `Time is up. ${esc(c.name)} has ${money(c.cash)}, short of the ${money(GOAL_CASH)} goal.`}</p>
    <p>${won ? 'Keep playing to see how big it can grow, or start fresh on a new map.' : 'You can keep building on this map, or start fresh and try a different plan.'}</p>
    <div class="actions">
      <button type="button" class="btn" data-act="new">New railroad</button>
      <button type="button" class="btn primary" data-act="keep">Keep playing</button>
    </div>`, (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'keep') { closeDialog(); game.resume(); }
    if (act === 'new') { closeDialog(); game.newGame(); }
  });
}

// ---- buying a train ----

function routeCargo(state, stations) {
  const info = stations.map((s) => catchmentCargo(state, s.catchment));
  const out = [];
  for (const c of CARGO_IDS) {
    const loads = stations.filter((s, i) => info[i].supplies.includes(c));
    const takes = stations.filter((s, i) => info[i].accepts.includes(c));
    const useful = loads.some((a) => takes.some((b) => b.id !== a.id));
    if (useful) out.push({ cargo: c, loads, takes });
  }
  return out;
}

export function newTrainDialog(game, fromStationId) {
  const { state } = game;
  const mine = state.stations.filter((s) => s.owner === 0);
  if (mine.length < 2) {
    openDialog(`
      <h2>Buy a train</h2>
      <p>A train needs somewhere to go. Build at least two stations first, joined by track.</p>
      <p class="muted">You have ${mine.length === 0 ? 'no stations' : 'one station'} so far.</p>
      <div class="actions"><button type="button" class="btn" data-act="close">Close</button><button type="button" class="btn primary" data-act="station">Build a station</button></div>`, (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) { closeDialog(); game.resume(); }
      if (act === 'station') game.setTool('station');
    });
    return;
  }
  const first = mine.find((s) => s.id === fromStationId) || mine[0];
  const linked = mine.filter((s) => s !== first).sort((a, b) => {
    const ra = findRoute(state, first.tile, a.tile) ? 0 : 1;
    const rb = findRoute(state, first.tile, b.tile) ? 0 : 1;
    return ra - rb || Math.hypot(a.x - first.x, a.y - first.y) - Math.hypot(b.x - first.x, b.y - first.y);
  });
  const form = { loco: LOCOS[0].id, stops: [first.id, linked[0].id], cars: {}, error: '' };
  let carsTouched = false;

  const stationsOf = () => form.stops.map((id) => state.stations.find((s) => s.id === id)).filter(Boolean);
  const defaultCars = () => {
    const loco = LOCOS.find((l) => l.id === form.loco);
    const useful = routeCargo(state, stationsOf()).map((r) => r.cargo);
    form.cars = {};
    const order = useful.includes('passengers') ? ['passengers', 'passengers', 'mail', ...useful] : [...useful, ...useful, ...useful];
    let n = 0;
    for (const c of order) {
      if (n >= Math.min(3, loco.maxCars) || !useful.includes(c)) continue;
      form.cars[c] = (form.cars[c] || 0) + 1;
      n++;
    }
  };
  defaultCars();

  const draw = () => {
    const loco = LOCOS.find((l) => l.id === form.loco);
    const stations = stationsOf();
    const useful = routeCargo(state, stations);
    for (const c of Object.keys(form.cars)) if (!useful.some((u) => u.cargo === c)) delete form.cars[c];
    const carCount = Object.values(form.cars).reduce((a, b) => a + b, 0);
    const price = trainCost(form.loco, carCount);
    const gaps = [];
    for (let i = 0; i < stations.length; i++) {
      const a = stations[i];
      const b = stations[(i + 1) % stations.length];
      if (stations.length === 2 && i === 1) break;
      if (a.id === b.id) gaps.push(`Stop ${i + 1} and the next stop are the same station.`);
      else if (!findRoute(state, a.tile, b.tile)) gaps.push(`No track joins ${esc(a.name)} and ${esc(b.name)} yet. The train will wait until you connect them.`);
    }
    const options = (selected) => mine.map((s) => `<option value="${s.id}"${s.id === selected ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
    openDialog(`
      <h2>Buy a train</h2>
      <h3>Locomotive</h3>
      <div class="loco-pick">${LOCOS.map((l) => `
        <button type="button" class="loco-card${l.id === form.loco ? ' active' : ''}" data-loco="${l.id}">
          <strong>${l.name}</strong>
          <span class="specs">${money(l.price)} · pulls up to ${l.maxCars} cars · ${money(l.upkeep)} a year to run</span>
          <span class="small">${l.blurb}</span>
        </button>`).join('')}</div>
      <h3>Stops, in order</h3>
      ${form.stops.map((id, i) => `
        <div class="stop-row"><span class="num">${i + 1}</span>
          <select data-stop="${i}" aria-label="Stop ${i + 1}">${options(id)}</select>
          ${form.stops.length > 2 ? `<button type="button" class="icon-btn" data-remove="${i}" aria-label="Remove stop ${i + 1}">×</button>` : ''}
        </div>`).join('')}
      ${form.stops.length < 6 ? '<button type="button" class="btn" data-act="addStop">Add a stop</button>' : ''}
      ${gaps.map((g) => `<p class="warn">${g}</p>`).join('')}
      <h3>Cars (${carCount} of ${loco.maxCars}) · ${money(CAR.price)} each</h3>
      ${useful.length ? useful.map(({ cargo, loads, takes }) => `
        <div class="car-row">
          <span class="what"><i style="background:${CARGO[cargo].color}"></i>${CARGO[cargo].name}</span>
          <span class="counter">
            <button type="button" data-car="${cargo}" data-delta="-1" aria-label="One fewer ${CARGO[cargo].name} car"${form.cars[cargo] ? '' : ' disabled'}>−</button>
            <span>${form.cars[cargo] || 0}</span>
            <button type="button" data-car="${cargo}" data-delta="1" aria-label="One more ${CARGO[cargo].name} car"${carCount < loco.maxCars ? '' : ' disabled'}>+</button>
          </span>
          <span class="note">Loads at ${loads.map((s) => esc(s.name)).join(', ')} · delivers to ${takes.map((s) => esc(s.name)).join(', ')}</span>
        </div>`).join('') : '<p class="warn">None of these stops have cargo another stop wants. Try a station by a town plus one by another town, or a coal mine plus a steel mill.</p>'}
      <div class="total-line"><span>Total price</span><strong>${money(price)}</strong></div>
      ${form.error ? `<p class="warn">${esc(form.error)}</p>` : ''}
      <div class="actions">
        <button type="button" class="btn" data-act="cancel">Cancel</button>
        <button type="button" class="btn primary" data-act="buy"${carCount && price <= state.companies[0].cash ? '' : ' disabled'}>${price > state.companies[0].cash ? 'Not enough cash' : 'Buy train'}</button>
      </div>`, onClick);
    $('dialog').onchange = (e) => {
      const i = e.target.dataset.stop;
      if (i === undefined) return;
      form.stops[Number(i)] = Number(e.target.value);
      if (!carsTouched) defaultCars();
      draw();
    };
  };

  const onClick = (e) => {
    const el = e.target.closest('button');
    if (!el) return;
    form.error = '';
    if (el.dataset.loco) {
      form.loco = el.dataset.loco;
      const max = LOCOS.find((l) => l.id === form.loco).maxCars;
      let n = 0;
      for (const c of Object.keys(form.cars)) {
        form.cars[c] = Math.max(0, Math.min(form.cars[c], max - n));
        n += form.cars[c];
      }
    } else if (el.dataset.car) {
      form.cars[el.dataset.car] = Math.max(0, (form.cars[el.dataset.car] || 0) + Number(el.dataset.delta));
      carsTouched = true;
    } else if (el.dataset.remove !== undefined) {
      form.stops.splice(Number(el.dataset.remove), 1);
    } else if (el.dataset.act === 'addStop') {
      const last = form.stops[form.stops.length - 1];
      const next = mine.find((s) => s.id !== last && !form.stops.includes(s.id)) || mine.find((s) => s.id !== last);
      form.stops.push(next.id);
      if (!carsTouched) defaultCars();
    } else if (el.dataset.act === 'cancel') {
      closeDialog();
      game.resume();
      return;
    } else if (el.dataset.act === 'buy') {
      const cars = [];
      for (const c of CARGO_IDS) for (let i = 0; i < (form.cars[c] || 0); i++) cars.push(c);
      const res = game.run({ type: 'buyTrain', loco: form.loco, cars, stops: form.stops });
      if (res.ok) {
        closeDialog();
        game.select({ kind: 'train', id: res.train.id });
        game.resume();
        return;
      }
      form.error = res.error;
    } else {
      return;
    }
    draw();
  };
  draw();
}

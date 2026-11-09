// The battle page: connects to the game, turns taps into orders, and keeps the
// board, panel and top bar in step with the server.
import { FACING_NAME, facingToward, samePoint } from "../game/grid.js";
import { getMap, registerMap } from "../game/maps.js";
import { pathTo } from "../game/movement.js";
import { UNITS, UNIT_KINDS } from "../game/units.js";
import type { Facing, GameEvent, Point, Unit, UnitKind } from "../game/types.js";
import type { PlayerView } from "../game/view.js";
import { Board } from "./board.js";
import { attachGestures } from "./camera.js";
import { playerName, renderPanel, renderTopBar, resignConfirm, unitLabel } from "./panel.js";
import {
  defaultFacing,
  draftProblem,
  emptyOrders,
  goldLeft,
  isMine,
  isMyAttackTurn,
  moveOrderFor,
  mySeat,
  mySpawnTiles,
  plannedEnd,
  reachOf,
  targetsOf,
  unitAt,
  unitById,
  canPlan,
  type Boot,
  type ClientState,
} from "./state.js";

declare global {
  interface Window {
    SALIENT_GAME: Boot;
  }
}

const boot = window.SALIENT_GAME;
// Every game carries its own copy of its map; the rules look it up by id.
registerMap(boot.map);
const s: ClientState = {
  boot,
  map: getMap(boot.mapId),
  view: null,
  players: boot.players,
  connected: false,
  draft: emptyOrders(),
  editing: true,
  selected: null,
  hover: null,
  log: [],
  pending: false,
};

const canvas = document.getElementById("board") as HTMLCanvasElement;
const panel = document.getElementById("panel")!;
const tooltip = document.getElementById("tooltip")!;
const banner = document.getElementById("banner")!;
const keyHelp = document.getElementById("key-help")!;
const board = new Board(canvas, s);

// --- Rendering -------------------------------------------------------------------

let resignAsked = false;
function refresh() {
  renderTopBar(s);
  panel.innerHTML = renderPanel(s);
  if (resignAsked) {
    const foot = panel.querySelector(".panel-foot");
    if (foot) foot.outerHTML = resignConfirm();
  }
}

function frame(now: number) {
  board.draw(now);
  requestAnimationFrame(frame);
}

let bannerTimer = 0;
function showBanner(text: string, sub = "", tone: "info" | "turn" | "win" | "lose" = "info", ms = 1800) {
  banner.innerHTML = `<strong>${text}</strong>${sub ? `<span>${sub}</span>` : ""}`;
  banner.className = `board-banner tone-${tone} show`;
  banner.hidden = false;
  window.clearTimeout(bannerTimer);
  if (ms > 0)
    bannerTimer = window.setTimeout(() => {
      banner.classList.remove("show");
      window.setTimeout(() => (banner.hidden = true), 300);
    }, ms);
}

function toast(message: string) {
  showBanner("Not allowed", message, "lose", 2600);
}

// --- The connection ---------------------------------------------------------------

let socket: WebSocket | null = null;
let retry = 0;

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${proto}://${location.host}/ws/g/${encodeURIComponent(boot.gameId)}`);
  socket.addEventListener("open", () => {
    s.connected = true;
    retry = 0;
    refresh();
  });
  socket.addEventListener("message", (e) => onMessage(JSON.parse(String(e.data))));
  socket.addEventListener("close", (e) => {
    s.connected = false;
    refresh();
    if (e.code === 4403 || e.code === 4404) return;
    // Back off, so a server restart is not met with a stampede of reconnects.
    retry = Math.min(retry + 1, 6);
    window.setTimeout(connect, 400 * 2 ** retry);
  });
}

function send(action: Record<string, unknown>) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return toast("Not connected. Reconnecting…");
  s.pending = true;
  socket.send(JSON.stringify({ type: "action", action }));
  refresh();
}

type ServerMessage =
  | { type: "state"; view: PlayerView; events: GameEvent[]; players: { seat: number; name: string }[] }
  | { type: "lobby" }
  | { type: "closed" }
  | { type: "error"; code: string; message: string };

const knownUnits = new Map<number, Pick<Unit, "seat" | "kind">>();

function onMessage(m: ServerMessage) {
  if (m.type === "error") {
    s.pending = false;
    toast(m.message);
    refresh();
    return;
  }
  if (m.type === "closed" || m.type === "lobby") {
    location.reload();
    return;
  }
  const before = s.view;
  const v = m.view;
  for (const u of before?.units ?? []) knownUnits.set(u.id, { seat: u.seat, kind: u.kind });
  for (const u of v.units) knownUnits.set(u.id, { seat: u.seat, kind: u.kind });
  for (const e of m.events) if (e.type === "spawn") knownUnits.set(e.unit.id, e.unit);

  board.anim.ingest(before, v, m.events, performance.now());
  tooltip.hidden = true;
  s.players = m.players;
  s.view = v;
  s.pending = false;

  const newRound = !before || before.round !== v.round || before.phase !== v.phase;
  if (v.phase === "planning") {
    if (newRound) {
      s.draft = v.myOrders ? structuredClone(v.myOrders) : emptyOrders();
      s.editing = v.myOrders === null;
    } else if (v.myOrders && !s.editing) {
      s.draft = structuredClone(v.myOrders);
    } else if (v.myOrders && s.editing && before?.myOrders === null) {
      // Our submission was accepted.
      s.editing = false;
    }
    // Drop orders for units that are gone.
    s.draft.moves = s.draft.moves.filter((mv) => v.units.some((u) => u.id === mv.unitId));
  }
  if (newRound) s.selected = null;
  if (s.selected?.type === "unit" && !unitById(s, s.selected.id)) s.selected = null;
  if (s.selected?.type === "target" && (!unitById(s, s.selected.targetId) || !unitById(s, s.selected.shooterId))) s.selected = null;

  placeCursor();
  for (const e of m.events) logEvent(e, v.round);
  announce(before, v);
  refresh();
}

function announce(before: PlayerView | null, v: PlayerView) {
  const seat = mySeat(s);
  if (!before) {
    if (v.phase === "over") showBanner(v.winner === seat ? "Victory" : v.winner === null ? "Draw" : "Defeat", "", v.winner === seat ? "win" : "lose", 2500);
    return;
  }
  if (v.phase === "over" && before.phase !== "over") {
    const won = v.winner === seat;
    showBanner(won ? "Victory" : v.winner === null ? "Draw" : "Defeat", won ? "The field is yours." : `${v.winner === null ? "Nobody" : playerName(s, v.winner)} holds the field.`, won ? "win" : "lose", 0);
    return;
  }
  // Banners wait for the update's animation to finish. By then the game may
  // have moved on (another update arrived), so each one checks it still
  // describes the current state before showing.
  const delay = Math.max(0, board.anim.busyUntil - performance.now());
  const stillCurrent = () => s.view === v;
  if (isMyAttackTurn(s) && !(before.phase === "attack" && before.attackTurn === seat)) {
    window.setTimeout(() => stillCurrent() && showBanner("Your shot", "Pick a unit, then a target", "turn"), delay);
  } else if (v.round !== before.round && v.phase === "planning") {
    window.setTimeout(() => stillCurrent() && showBanner(`Round ${v.round}`, "Plan your moves"), delay);
  }
}

function logEvent(e: GameEvent, round: number) {
  const seat = mySeat(s);
  const name = (id: number) => {
    const u = knownUnits.get(id);
    return u ? unitLabel(s, u) : "A unit";
  };
  const who = (p: number | null) => (p === null ? "Nobody" : p === seat ? "You" : playerName(s, p));
  let html = "";
  switch (e.type) {
    case "spawn":
      html = e.unit.seat === seat ? `You deployed a ${UNITS[e.unit.kind].name.toLowerCase()}.` : `${who(e.unit.seat)} deployed a ${UNITS[e.unit.kind].name.toLowerCase()}.`;
      break;
    case "spawnFailed":
      html = `Your ${UNITS[e.kind].name.toLowerCase()} couldn't deploy: something was on the tile. No gold spent.`;
      break;
    case "move":
      if (e.bumped) html = `${name(e.unitId)} ran into something and stopped.`;
      break;
    case "shot": {
      const target = name(e.targetId).replace(/^Your/, "your");
      html = e.hit
        ? `${name(e.shooterId)} ${e.crit ? "landed a critical hit on" : "hit"} ${target} for <strong>${e.damage}</strong>${e.killed ? ", killing it" : ""}.`
        : `${name(e.shooterId)} missed ${target} (${Math.round(e.chance * 100)}%).`;
      break;
    }
    case "capture":
      html =
        e.to === null
          ? `${e.site === "post" ? "A command post" : "An income site"} was neutralised.`
          : `${who(e.to)} took ${e.site === "post" ? "a command post" : "an income site"}.`;
      break;
    case "income":
      html = `+${e.amount} gold.`;
      break;
    case "bleed":
      html = `${who(e.seat)} lost ${e.tickets} tickets to the enemy's command posts.`;
      break;
    case "eliminated":
      html = `${who(e.seat)} ${e.seat === seat ? "are" : "is"} out of tickets.`;
      break;
    case "gameOver":
      html = e.winner === null ? "The game ends in a draw." : `${who(e.winner)} won.`;
      break;
  }
  if (html) s.log.push({ round, html });
  if (s.log.length > 60) s.log.splice(0, s.log.length - 60);
}

// --- Taps on the board -------------------------------------------------------------

function onTap(p: Point) {
  const v = s.view;
  if (!v) return;
  resignAsked = false;
  const u = unitAt(s, p);
  if (canPlan(s)) planningTap(p, u);
  else if (v.phase === "attack" && isMyAttackTurn(s)) attackTap(u);
  else s.selected = u ? { type: "unit", id: u.id } : null;
  refresh();
}

function planningTap(p: Point, u: Unit | undefined) {
  const sel = s.selected;
  const selUnit = sel?.type === "unit" ? unitById(s, sel.id) : undefined;
  if (selUnit && isMine(s, selUnit)) {
    const order = moveOrderFor(s, selUnit.id);
    // Tapping the ghost at the end of a route turns it.
    if (order && order.path.length && samePoint(plannedEnd(s, selUnit), p)) {
      order.facing = ((order.facing + 1) % 8) as Facing;
      return;
    }
    if (u?.id === selUnit.id) {
      s.selected = null;
      return;
    }
  }
  if (u && isMine(s, u)) {
    s.selected = { type: "unit", id: u.id };
    return;
  }
  if (selUnit && isMine(s, selUnit) && !u) {
    const reach = reachOf(s, selUnit);
    const path = pathTo(s.map, reach, p);
    if (path && path.length) {
      const prev = path.length > 1 ? path[path.length - 2]! : selUnit;
      const facing = facingToward(prev, path[path.length - 1]!);
      const existing = moveOrderFor(s, selUnit.id);
      if (existing) {
        existing.path = path;
        existing.facing = facing;
      } else s.draft.moves.push({ unitId: selUnit.id, path, facing });
      return;
    }
  }
  const spawnIndex = s.draft.spawns.findIndex((sp) => sp.x === p.x && sp.y === p.y);
  if (spawnIndex >= 0) {
    s.selected = { type: "spawn", index: spawnIndex };
    return;
  }
  if (!u && mySpawnTiles(s).some((t) => samePoint(t, p))) {
    s.selected = { type: "spawnTile", x: p.x, y: p.y };
    return;
  }
  s.selected = u ? { type: "unit", id: u.id } : null;
}

function attackTap(u: Unit | undefined) {
  const sel = s.selected;
  const shooterId = sel?.type === "unit" ? sel.id : sel?.type === "target" ? sel.shooterId : null;
  const shooter = shooterId !== null ? unitById(s, shooterId) : undefined;
  if (u && shooter && isMine(s, shooter) && !isMine(s, u) && targetsOf(s, shooter).some((t) => t.id === u.id)) {
    if (sel?.type === "target" && sel.targetId === u.id) {
      fire();
      return;
    }
    s.selected = { type: "target", shooterId: shooter.id, targetId: u.id };
    return;
  }
  s.selected = u ? { type: "unit", id: u.id } : null;
}

function fire() {
  const sel = s.selected;
  if (sel?.type !== "target" || s.pending) return;
  send({ type: "attack", unitId: sel.shooterId, targetId: sel.targetId });
  s.selected = null;
}

// --- Panel buttons -------------------------------------------------------------------

panel.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!el) return;
  const action = el.dataset.action!;
  const sel = s.selected;
  switch (action) {
    case "buy": {
      if (sel?.type !== "spawnTile") break;
      const kind = el.dataset.kind as UnitKind;
      s.draft.spawns.push({ kind, x: sel.x, y: sel.y, facing: defaultFacing(s.map, sel) });
      s.selected = { type: "spawn", index: s.draft.spawns.length - 1 };
      break;
    }
    case "set-facing": {
      if (sel?.type !== "unit") break;
      const facing = Number(el.dataset.facing) as Facing;
      const order = moveOrderFor(s, sel.id);
      if (order) order.facing = facing;
      else s.draft.moves.push({ unitId: sel.id, path: [], facing });
      break;
    }
    case "clear-order":
      s.draft.moves = s.draft.moves.filter((m) => m.unitId !== Number(el.dataset.unit));
      break;
    case "spawn-facing":
      if (sel?.type === "spawn" && s.draft.spawns[sel.index]) s.draft.spawns[sel.index]!.facing = Number(el.dataset.facing) as Facing;
      break;
    case "cancel-spawn":
      if (sel?.type === "spawn") s.draft.spawns.splice(sel.index, 1);
      s.selected = null;
      break;
    case "submit":
      s.selected = null;
      send({ type: "orders", orders: s.draft });
      break;
    case "edit-orders":
      s.editing = true;
      break;
    case "select-unit":
      s.selected = { type: "unit", id: Number(el.dataset.unit) };
      break;
    case "target":
      if (sel?.type === "unit") s.selected = { type: "target", shooterId: sel.id, targetId: Number(el.dataset.target) };
      break;
    case "untarget":
      if (sel?.type === "target") s.selected = { type: "unit", id: sel.shooterId };
      break;
    case "fire":
      fire();
      break;
    case "hold":
      send({ type: "hold", unitId: Number(el.dataset.unit) });
      s.selected = null;
      break;
    case "end-attacks":
      send({ type: "endAttacks" });
      s.selected = null;
      break;
    case "resign-ask":
      resignAsked = true;
      break;
    case "resign-cancel":
      resignAsked = false;
      break;
    case "resign":
      resignAsked = false;
      send({ type: "resign" });
      break;
  }
  refresh();
});

// --- Pointer, keys, resizing ---------------------------------------------------------

function onHover(sx: number, sy: number | null) {
  // The cursor stays where it was when the mouse leaves the board: the
  // keyboard always has a tile to act on.
  const tile = sy === null ? null : board.tileAt(sx, sy);
  if (!tile || sy === null) {
    tooltip.hidden = true;
    return;
  }
  s.hover = tile;
  showTooltip(tile, sx, sy);
}

function showTooltip(tile: Point, sx: number, sy: number) {
  const u = unitAt(s, tile);
  if (u) {
    tooltip.innerHTML = `<strong>${unitLabel(s, u)}</strong><span>${u.hp} / ${UNITS[u.kind].hp} hp · facing ${FACING_NAME[u.facing]}</span>`;
    tooltip.style.left = `${sx + 14}px`;
    tooltip.style.top = `${sy + 14}px`;
    tooltip.hidden = false;
  } else tooltip.hidden = true;
}

/** Where the cursor starts: on your first unit, else your base, else the middle. */
function placeCursor() {
  if (s.hover || !s.view) return;
  const mine = s.view.units.find((u) => isMine(s, u));
  s.hover = mine ? { x: mine.x, y: mine.y } : (mySpawnTiles(s)[0] ?? { x: Math.floor(s.map.width / 2), y: Math.floor(s.map.height / 2) });
}

/** Put the cursor on a tile from the keyboard: keep it in view and label it. */
function cursorTo(p: Point) {
  s.hover = { x: Math.max(0, Math.min(s.map.width - 1, p.x)), y: Math.max(0, Math.min(s.map.height - 1, p.y)) };
  if (board.reveal(s.hover)) board.userMoved = true;
  const c = board.camera.toScreen(s.hover.x + 0.5, s.hover.y + 0.5);
  showTooltip(s.hover, c.x + board.camera.scale * 0.3, c.y + board.camera.scale * 0.1);
}

attachGestures(canvas, board.camera, {
  tap: (sx, sy, button) => {
    const p = board.tileAt(sx, sy);
    if (button === 2) {
      s.selected = null;
      refresh();
      return;
    }
    if (p) onTap(p);
  },
  hover: onHover,
  changed: () => {
    board.userMoved = true;
    tooltip.hidden = true;
  },
});

// --- The keyboard ---------------------------------------------------------------------
// Everything a tap or a panel button does has a key, so a game can be played
// without the mouse. The cursor (s.hover) is the tile keys act on.

const MOVES: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
};

/** The shooter the attack keys work on: the selected unit, or the target's shooter. */
function currentShooter(): Unit | undefined {
  const sel = s.selected;
  const id = sel?.type === "unit" ? sel.id : sel?.type === "target" ? sel.shooterId : null;
  const u = id !== null ? unitById(s, id) : undefined;
  return u && isMine(s, u) ? u : undefined;
}

function rotateSelected(step: 1 | 7) {
  const sel = s.selected;
  if (!canPlan(s)) return false;
  if (sel?.type === "unit") {
    const u = unitById(s, sel.id);
    if (!u || !isMine(s, u)) return false;
    const order = moveOrderFor(s, u.id);
    const next = (((order?.facing ?? u.facing) + step) % 8) as Facing;
    if (order) order.facing = next;
    else s.draft.moves.push({ unitId: u.id, path: [], facing: next });
    return true;
  }
  if (sel?.type === "spawn") {
    const sp = s.draft.spawns[sel.index];
    if (!sp) return false;
    sp.facing = ((sp.facing + step) % 8) as Facing;
    return true;
  }
  return false;
}

/** Deploy unit class n (1-based, shop order) on the selected base tile or the cursor's. */
function deployByNumber(n: number) {
  const kind = UNIT_KINDS[n - 1];
  if (!kind || !canPlan(s)) return false;
  const sel = s.selected;
  const tile = sel?.type === "spawnTile" ? { x: sel.x, y: sel.y } : s.hover;
  if (!tile) return false;
  if (!mySpawnTiles(s).some((t) => samePoint(t, tile)) || unitAt(s, tile) || s.draft.spawns.some((sp) => samePoint(sp, tile))) {
    toast("Put the cursor on a free tile of your base to deploy.");
    return true;
  }
  if (UNITS[kind].cost > goldLeft(s)) {
    toast(`Not enough gold for a ${UNITS[kind].name.toLowerCase()}.`);
    return true;
  }
  s.draft.spawns.push({ kind, x: tile.x, y: tile.y, facing: defaultFacing(s.map, tile) });
  s.selected = { type: "spawn", index: s.draft.spawns.length - 1 };
  return true;
}

/** Tab: step through your units (in the attack phase, the ones that can still fire). */
function cycleUnits(back: boolean) {
  const v = s.view;
  if (!v) return false;
  const pool =
    v.phase === "attack" && isMyAttackTurn(s)
      ? v.readyShooters.map((id) => unitById(s, id)).filter((u): u is Unit => !!u)
      : v.units.filter((u) => isMine(s, u));
  if (!pool.length) return false;
  const cur = currentShooter();
  const i = cur ? pool.findIndex((u) => u.id === cur.id) : -1;
  const next = i < 0 ? pool[back ? pool.length - 1 : 0]! : pool[(i + (back ? pool.length - 1 : 1)) % pool.length]!;
  s.selected = { type: "unit", id: next.id };
  cursorTo(next);
  return true;
}

/** Pick target n (1-based, the panel's order) or cycle with 0. */
function pickTarget(n: number | "next") {
  if (!isMyAttackTurn(s)) return false;
  const shooter = currentShooter();
  if (!shooter || s.view!.acted.includes(shooter.id)) return false;
  const targets = targetsOf(s, shooter);
  if (!targets.length) return false;
  let t: Unit | undefined;
  if (n === "next") {
    const sel = s.selected;
    const i = sel?.type === "target" ? targets.findIndex((x) => x.id === sel.targetId) : -1;
    t = targets[(i + 1) % targets.length];
  } else t = targets[n - 1];
  if (!t) return false;
  s.selected = { type: "target", shooterId: shooter.id, targetId: t.id };
  cursorTo(t);
  return true;
}

function finish() {
  const v = s.view;
  if (!v || s.pending) return false;
  if (canPlan(s)) {
    const problem = draftProblem(s);
    if (problem) {
      toast(problem);
      return true;
    }
    s.selected = null;
    send({ type: "orders", orders: s.draft });
    return true;
  }
  if (isMyAttackTurn(s)) {
    send({ type: "endAttacks" });
    s.selected = null;
    return true;
  }
  return false;
}

function onKey(e: KeyboardEvent): boolean {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === "?" || (key === "/" && e.shiftKey)) {
    keyHelp.hidden = !keyHelp.hidden;
    return true;
  }
  if (key === "Escape") {
    if (!keyHelp.hidden) keyHelp.hidden = true;
    else s.selected = null;
    resignAsked = false;
    return true;
  }
  const move = MOVES[key];
  if (move && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const step = e.shiftKey ? 3 : 1;
    const from = s.hover ?? { x: 0, y: 0 };
    cursorTo({ x: from.x + move[0] * step, y: from.y + move[1] * step });
    return true;
  }
  if ((key === "Enter" || key === " ") && !e.shiftKey) {
    if (s.hover) onTap(s.hover);
    return true;
  }
  if (key === "Enter" && e.shiftKey) return finish();
  if (/^[1-9]$/.test(key)) {
    const n = Number(key);
    return s.view?.phase === "attack" ? pickTarget(n) : deployByNumber(n);
  }
  switch (key) {
    case "q":
      return rotateSelected(7);
    case "e":
      return rotateSelected(1);
    case "Tab":
      return cycleUnits(e.shiftKey);
    case "t":
      return pickTarget("next");
    case "f":
      if (s.selected?.type === "target") {
        fire();
        return true;
      }
      return false;
    case "h": {
      const u = currentShooter();
      if (!u || !isMyAttackTurn(s) || s.view!.acted.includes(u.id)) return false;
      send({ type: "hold", unitId: u.id });
      s.selected = null;
      return true;
    }
    case "Backspace":
    case "Delete": {
      const sel = s.selected;
      if (!canPlan(s)) return false;
      if (sel?.type === "spawn") {
        s.draft.spawns.splice(sel.index, 1);
        s.selected = null;
        return true;
      }
      if (sel?.type === "unit") {
        s.draft.moves = s.draft.moves.filter((m) => m.unitId !== sel.id);
        return true;
      }
      return false;
    }
    case "+":
    case "=":
      zoomBy(1.25);
      return true;
    case "-":
    case "_":
      zoomBy(0.8);
      return true;
    case "0":
      board.fit();
      return true;
  }
  return false;
}

function zoomBy(f: number) {
  board.userMoved = true;
  const c = s.hover ? board.camera.toScreen(s.hover.x + 0.5, s.hover.y + 0.5) : { x: board.viewSize.w / 2, y: board.viewSize.h / 2 };
  board.camera.zoomAt(f, c.x, c.y);
}

window.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  if (target.closest("input, textarea, select")) return;
  // A focused button or link keeps Enter and Space; the board gets the rest.
  if ((e.key === "Enter" || e.key === " " || e.key === "Tab") && target.closest("button, a, summary")) return;
  if (e.ctrlKey || e.metaKey) return;
  if (onKey(e)) {
    e.preventDefault();
    refresh();
  }
});

document.getElementById("zoom-in")!.addEventListener("click", () => {
  board.userMoved = true;
  const { w, h } = board.viewSize;
  board.camera.zoomAt(1.25, w / 2, h / 2);
});
document.getElementById("zoom-out")!.addEventListener("click", () => {
  board.userMoved = true;
  const { w, h } = board.viewSize;
  board.camera.zoomAt(0.8, w / 2, h / 2);
});
document.getElementById("zoom-fit")!.addEventListener("click", () => board.fit());
document.getElementById("key-help-open")!.addEventListener("click", () => (keyHelp.hidden = !keyHelp.hidden));
document.getElementById("key-help-close")!.addEventListener("click", () => (keyHelp.hidden = true));

new ResizeObserver(() => board.resize()).observe(canvas.parentElement!);
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => board.repaint());

// Read-only hooks for the browser suites: where a tile is on screen, and what
// this player can see. Tests click real coordinates through these rather than
// reaching into the state, so they exercise the same path as a player.
(window as unknown as { __salient: unknown }).__salient = {
  screenOf: (x: number, y: number) => {
    const p = board.camera.toScreen(x + 0.5, y + 0.5);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  },
  myUnits: () => s.view?.units.filter((u) => isMine(s, u)) ?? [],
  enemyUnits: () => s.view?.units.filter((u) => !isMine(s, u)) ?? [],
  spawnTiles: () => mySpawnTiles(s),
  reach: (unitId: number) => {
    const u = unitById(s, unitId);
    if (!u) return [];
    return [...reachOf(s, u).cost.keys()].map((i) => ({ x: i % s.map.width, y: Math.floor(i / s.map.width) }));
  },
  targets: (unitId: number) => {
    const u = unitById(s, unitId);
    return u ? targetsOf(s, u).map((t) => t.id) : [];
  },
  readyShooters: () => s.view?.readyShooters ?? [],
  log: () => s.log.map((l) => l.html),
  phase: () => s.view && { phase: s.view.phase, round: s.view.round, attackTurn: s.view.attackTurn, ready: s.view.seats.map((p) => p.ready) },
  busy: () => board.anim.animating,
  hover: () => s.hover,
};

board.resize();
refresh();
connect();
requestAnimationFrame(frame);

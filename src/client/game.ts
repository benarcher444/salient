// The battle page: connects to the game, turns taps into orders, and keeps the
// board, panel and top bar in step with the server.
import { facingName, facingToward, normFacing, samePoint } from "../game/grid.js";
import { getMap, registerMap } from "../game/maps.js";
import { replaySteps, type ReplayLog, type ReplayStep } from "../game/replay.js";
import { useTuning } from "../game/tuning.js";
import { pathTo } from "../game/movement.js";
import { UNITS, UNIT_KINDS, hasTrait } from "../game/units.js";
import { RULES } from "../game/constants.js";
import { baseTiles } from "../game/visibility.js";
import type { Facing, GameEvent, Point, Unit, UnitKind } from "../game/types.js";
import type { PlayerView } from "../game/view.js";
import { Board } from "./board.js";
import { attachGestures } from "./camera.js";
import { esc, playerName, renderPanel, renderTopBar, resignConfirm, unitLabel } from "./panel.js";
import {
  defaultFacing,
  draftProblem,
  emptyOrders,
  firstLeg,
  fullPathTo,
  goldLeft,
  isMine,
  isMyAttackTurn,
  moveOrderFor,
  mySeat,
  mySpawnTiles,
  plannedEnd,
  reachOf,
  routeFor,
  wayOn,
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
// Every game carries its own copy of its map and of its tuning (unit stats,
// rule numbers); the rules look the map up by id and read the active tuning.
registerMap(boot.map);
if (boot.tuning) useTuning(boot.tuning);
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
  aiming: null,
  replay: null,
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
  // Aiming belongs to one selection: anything else selected (or planning over) ends it.
  if (s.aiming && (!aimTarget() || JSON.stringify(s.selected) !== s.aiming.selection)) s.aiming = null;
  renderTopBar(s);
  panel.innerHTML = renderPanel(s);
  if (resignAsked) {
    const foot = panel.querySelector(".panel-foot");
    if (foot) foot.outerHTML = resignConfirm();
  }
}

const minimap = document.getElementById("minimap") as HTMLCanvasElement | null;

function frame(now: number) {
  board.draw(now);
  // Hidden on a phone (no layout box): nothing to draw.
  if (minimap?.offsetParent) board.drawMinimap(minimap, now);
  requestAnimationFrame(frame);
}

// Click or drag on the minimap to move the board's view there.
if (minimap) {
  let dragging = false;
  const moveTo = (e: PointerEvent) => {
    const r = minimap.getBoundingClientRect();
    board.stopGlide();
    board.centreOn(board.minimapToWorld(minimap, e.clientX - r.left, e.clientY - r.top));
    board.userMoved = true;
    tooltip.hidden = true;
  };
  minimap.addEventListener("pointerdown", (e) => {
    dragging = true;
    minimap.setPointerCapture(e.pointerId);
    moveTo(e);
  });
  minimap.addEventListener("pointermove", (e) => dragging && moveTo(e));
  const stop = () => (dragging = false);
  minimap.addEventListener("pointerup", stop);
  minimap.addEventListener("pointercancel", stop);
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
  // A replay is only watching: nothing it does reaches the server.
  if (s.replay) return;
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
  // During a replay the live game waits: its update is applied on leaving.
  if (s.replay) {
    heldMessage = m;
    return;
  }
  const before = s.view;
  const v = m.view;
  for (const u of before?.units ?? []) knownUnits.set(u.id, { seat: u.seat, kind: u.kind });
  for (const u of v.units) knownUnits.set(u.id, { seat: u.seat, kind: u.kind });
  for (const e of m.events) if (e.type === "spawn") knownUnits.set(e.unit.id, e.unit);

  // Like Civilization: an enemy's shot at one of yours (or a shell bursting
  // on them) brings the camera over first, unless it is already well in view.
  const me = v.seat;
  board.anim.ingest(before, v, m.events, performance.now(), {
    focusOn: (e) =>
      me !== null && e.shooterSeat !== me && (e.targetSeat === me || e.splash.some((x) => x.seat === me)) && !board.inView(e.to),
  });
  tooltip.hidden = true;
  s.players = m.players;
  s.view = v;
  s.pending = false;
  // The first view says where this player's base is: frame the board on it.
  if (!before && !board.userMoved) board.fit();

  const newRound = !before || before.round !== v.round || before.phase !== v.phase;
  if (v.phase === "planning") {
    if (newRound) {
      s.draft = v.myOrders ? structuredClone(v.myOrders) : emptyOrders();
      s.editing = v.myOrders === null;
      // Units on a route over several rounds start the round with its next leg planned.
      if (!v.myOrders) continueRoutes(v);
    } else if (v.myOrders && !s.editing) {
      s.draft = structuredClone(v.myOrders);
    } else if (v.myOrders && s.editing && before?.myOrders === null) {
      // Our submission was accepted.
      s.editing = false;
    }
    // Drop orders for units that are gone.
    s.draft.moves = s.draft.moves.filter((mv) => v.units.some((u) => u.id === mv.unitId));
    s.draft.routes = (s.draft.routes ?? []).filter((r) => v.units.some((u) => u.id === r.unitId));
  }
  if (newRound) s.selected = null;
  if (s.selected?.type === "unit" && !unitById(s, s.selected.id)) s.selected = null;
  if (s.selected?.type === "target" && (!unitById(s, s.selected.targetId) || !unitById(s, s.selected.shooterId))) s.selected = null;

  placeCursor();
  for (const e of m.events) logEvent(e, v.round);
  announce(before, v);
  warnBaseLoss(m.events);
  refresh();
  // The lobby's Replay button opens a finished game with ?replay=1.
  if (!before && v.phase === "over" && autoReplay) {
    autoReplay = false;
    void startReplay();
  }
}

// --- Replay ---------------------------------------------------------------------------
// A finished game, watched again from the start with the fog lifted. The
// server sends the log (only once the game is over); the browser rebuilds
// every step with the same rules, tuning and dice, and plays them through
// the same animations as a live game: a step every two seconds, or when its
// animation finishes if that takes longer.

const REPLAY_STEP_MS = 2000;
let autoReplay = new URLSearchParams(location.search).get("replay") === "1";
let steps: ReplayStep[] = [];
let heldMessage: ServerMessage | null = null;
let beforeReplay: { view: PlayerView; log: ClientState["log"] } | null = null;
let replayTimer = 0;

async function startReplay() {
  if (s.replay || !s.view || s.view.phase !== "over") return;
  beforeReplay = { view: s.view, log: s.log };
  s.replay = { index: 0, total: 0, playing: false, speed: 1, loading: true };
  s.selected = null;
  s.aiming = null;
  resignAsked = false;
  refresh();
  try {
    const res = await fetch(`/g/${encodeURIComponent(boot.gameId)}/replay`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    steps = replaySteps(boot.mapId, (await res.json()) as ReplayLog);
  } catch {
    s.replay = null;
    beforeReplay = null;
    toast("The replay couldn't be loaded.");
    refresh();
    return;
  }
  // Names for the log: every unit that ever took the field.
  for (const step of steps) {
    for (const u of step.view.units) knownUnits.set(u.id, { seat: u.seat, kind: u.kind });
    for (const e of step.events) if (e.type === "spawn") knownUnits.set(e.unit.id, e.unit);
  }
  s.replay = { index: 0, total: steps.length, playing: true, speed: 1 };
  replayJump(0);
  scheduleReplay();
}

/** Show a step at once, without animation (going back, or to the start). */
function replayJump(i: number) {
  const r = s.replay!;
  r.index = Math.max(0, Math.min(steps.length - 1, i));
  board.anim.reset();
  s.view = steps[r.index]!.view;
  s.log = [];
  for (let k = 1; k <= r.index; k++) for (const e of steps[k]!.events) logEvent(e, steps[k]!.round);
  tooltip.hidden = true;
  refresh();
}

/** Play the next step, animated, as a live update would be. */
function replayAdvance() {
  const r = s.replay!;
  if (r.index >= steps.length - 1) return;
  const before = s.view!;
  const step = steps[++r.index]!;
  board.anim.ingest(before, step.view, step.events, performance.now());
  s.view = step.view;
  for (const e of step.events) logEvent(e, step.round);
  tooltip.hidden = true;
  const delay = Math.max(0, board.anim.busyUntil - performance.now());
  const shown = step.view;
  if (step.view.phase === "over") {
    const w = step.view.winner;
    window.setTimeout(() => s.view === shown && showBanner(w === null ? "Draw" : `${playerName(s, w)} wins`, "The end of the replay", "win", 2500), delay);
  } else if (step.view.round !== before.round) {
    window.setTimeout(() => s.view === shown && showBanner(`Round ${step.view.round}`, "", "info", Math.min(1600, REPLAY_STEP_MS / r.speed)), delay);
  }
  refresh();
}

/** While playing, the next step comes after REPLAY_STEP_MS (by speed), or once the animation ends. */
function scheduleReplay() {
  window.clearTimeout(replayTimer);
  const r = s.replay;
  if (!r || !r.playing) return;
  if (r.index >= steps.length - 1) {
    r.playing = false;
    refresh();
    return;
  }
  const wait = Math.max(REPLAY_STEP_MS / r.speed, board.anim.busyUntil - performance.now() + 200);
  replayTimer = window.setTimeout(() => {
    if (!s.replay?.playing) return;
    replayAdvance();
    scheduleReplay();
  }, wait);
}

function replayControl(action: string): boolean {
  const r = s.replay;
  if (!r || r.loading) return false;
  switch (action) {
    case "replay-play":
      if (r.index >= steps.length - 1) replayJump(0);
      r.playing = true;
      scheduleReplay();
      break;
    case "replay-pause":
      r.playing = false;
      window.clearTimeout(replayTimer);
      break;
    case "replay-forward":
      window.clearTimeout(replayTimer);
      replayAdvance();
      scheduleReplay();
      break;
    case "replay-back":
      r.playing = false;
      window.clearTimeout(replayTimer);
      replayJump(r.index - 1);
      break;
    case "replay-restart":
      window.clearTimeout(replayTimer);
      replayJump(0);
      scheduleReplay();
      break;
    case "replay-speed":
      r.speed = r.speed >= 4 ? 1 : r.speed * 2;
      scheduleReplay();
      break;
    case "replay-exit":
      exitReplay();
      break;
    default:
      return false;
  }
  return true;
}

/** Back to the game as it ended, and to anything the server sent meanwhile. */
function exitReplay() {
  window.clearTimeout(replayTimer);
  s.replay = null;
  steps = [];
  board.anim.reset();
  if (beforeReplay) {
    s.view = beforeReplay.view;
    s.log = beforeReplay.log;
  }
  beforeReplay = null;
  s.selected = null;
  refresh();
  const held = heldMessage;
  heldMessage = null;
  if (held) onMessage(held);
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
      html =
        e.seat === seat
          ? `Your ${UNITS[e.kind].name.toLowerCase()} couldn't deploy: something was on the tile. No gold spent.`
          : `${who(e.seat)}'s ${UNITS[e.kind].name.toLowerCase()} couldn't deploy: something was on the tile.`;
      break;
    case "move":
      if (e.bumped) html = `${name(e.unitId)} ran into something and stopped.`;
      break;
    case "shot": {
      const target = name(e.targetId).replace(/^Your/, "your");
      if (e.intendedId !== undefined) {
        // The shot was taken by an enemy its side couldn't see, standing in the way.
        const struck = knownUnits.has(e.targetId) && e.targetSeat === seat ? target : "an unseen enemy";
        html = `${name(e.shooterId)} fired at ${name(e.intendedId).replace(/^Your/, "your")}, but ${struck} was in the way: ${
          e.hit ? `${e.crit ? "a critical hit" : "hit"} for <strong>${e.damage}</strong>${e.killed ? ", killing it" : ""}` : "missed"
        }.`;
      } else html = e.hit
        ? `${name(e.shooterId)} ${e.crit ? "landed a critical hit on" : "hit"} ${target} for <strong>${e.damage}</strong>${e.killed ? ", killing it" : ""}.`
        : `${name(e.shooterId)} missed ${target} (${Math.round(e.chance * 100)}%).`;
      // An explosive's blast: everyone it caught, the target too on a miss.
      if (e.splash.length) {
        const caught = e.splash.map(
          (x) => `${name(x.unitId).replace(/^Your/, "your")} <strong>${x.damage}</strong>${x.killed ? " (killed)" : ""}`,
        );
        html += ` The blast hit ${caught.join(", ")}.`;
      }
      break;
    }
    case "capture":
      html = captureLine(e, who);
      break;
    case "captureProgress": {
      const left = e.needed - e.rounds;
      if (e.site === "post") {
        html = `${who(e.seat)} ${e.seat === seat ? "are" : "is"} taking a command post: ${left} more round${left === 1 ? "" : "s"} there and it changes hands.`;
        break;
      }
      const home = baseTiles(s.map, s.view?.seats.length ?? 2)[e.index]?.home;
      const whose = home === seat ? "your" : home === e.seat ? "their own" : `${who(home ?? 0)}'s`;
      html = `${who(e.seat)} ${e.seat === seat ? "are" : "is"} taking ${whose} base tile: ${left} more round${left === 1 ? "" : "s"} there and it changes hands.`;
      break;
    }
    case "income":
      html = `+${e.amount} gold.`;
      break;
    case "eliminated":
      html = `${who(e.seat)} ${e.seat === seat ? "have" : "has"} no base and no units left: knocked out.`;
      break;
    case "gameOver":
      html = e.winner === null ? "The game ends in a draw." : `${who(e.winner)} won.`;
      break;
  }
  if (html) s.log.push({ round, html });
  if (s.log.length > 60) s.log.splice(0, s.log.length - 60);
}

/** A capture, in words. Base tiles say whose base they belong to. */
function captureLine(e: Extract<GameEvent, { type: "capture" }>, who: (p: number | null) => string): string {
  let what = e.site === "post" ? "a command post" : "a supply depot";
  if (e.site === "base") {
    const home = baseTiles(s.map, s.view?.seats.length ?? 0)[e.index]?.home;
    what = home === undefined ? "a base tile" : home === mySeat(s) ? "a tile of your base" : `a tile of ${playerName(s, home)}'s base`;
  }
  if (e.to === null) return `${who(e.from)} lost ${what}: it's neutral now.`;
  return `${who(e.to)} took ${what}.`;
}

/** Losing a tile of your base deserves a banner, not just a log line. */
function warnBaseLoss(events: GameEvent[]) {
  const seat = mySeat(s);
  if (seat === null) return;
  const lost = events.filter((e) => e.type === "capture" && e.site === "base" && e.from === seat).length;
  if (!lost) return;
  const left = s.view ? baseTiles(s.map, s.view.seats.length).filter((_, i) => s.view!.baseOwners[i] === seat).length : 0;
  const delay = Math.max(0, board.anim.busyUntil - performance.now());
  const v = s.view;
  window.setTimeout(
    () => s.view === v && showBanner(lost === 1 ? "Base tile lost" : `${lost} base tiles lost`, left ? `${left} left. Retake them before they're all gone.` : "No base left: keep a unit alive or you're out.", "lose", 3200),
    delay,
  );
}

// --- Routes over several rounds ----------------------------------------------------
// A tile beyond reach becomes a standing destination: this round's move is as
// far along the way as the unit can walk, and the rest is kept (on the server,
// with the orders) for the next rounds, each of which starts with the next leg
// planned. The server never moves a unit by itself; the player still locks in.

function dropRoute(unitId: number) {
  s.draft.routes = (s.draft.routes ?? []).filter((r) => r.unitId !== unitId);
}

/**
 * Send a unit towards a tile over as many rounds as it takes. Plans this
 * round's leg and keeps the destination if the leg doesn't get there. Legs on
 * the way face the way the unit walks; the leg that arrives takes
 * `finalFacing`, the facing the player aimed at the destination. false if
 * there is no way there that avoids the enemies this player can see.
 */
function setRoute(unit: Unit, to: Point, finalFacing?: Facing): boolean {
  const path = fullPathTo(s, unit, to);
  if (!path || !path.length) return false;
  const leg = firstLeg(s, unit, path);
  const existing = moveOrderFor(s, unit.id);
  const arrives = leg.length === path.length;
  const walking = leg.length ? facingToward(leg.length > 1 ? leg[leg.length - 2]! : unit, leg[leg.length - 1]!) : (existing?.facing ?? unit.facing);
  const facing = arrives && finalFacing !== undefined ? finalFacing : walking;
  if (existing) {
    existing.path = leg;
    existing.facing = facing;
  } else s.draft.moves.push({ unitId: unit.id, path: leg, facing });
  dropRoute(unit.id);
  if (!arrives) (s.draft.routes ??= []).push({ unitId: unit.id, to: { x: to.x, y: to.y }, ...(finalFacing !== undefined ? { facing: finalFacing } : {}) });
  untangleLegs();
  return true;
}

/**
 * A route's leg is cut short rather than finish on a tile another of your
 * units will hold (or a deployment): the rules allow one unit per tile. Only
 * legs of routes give way, never moves the player chose.
 */
function untangleLegs() {
  const mine = s.view?.units.filter((u) => isMine(s, u)) ?? [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of s.draft.routes ?? []) {
      const u = unitById(s, r.unitId);
      const m = u && moveOrderFor(s, u.id);
      if (!u || !m || !m.path.length) continue;
      const end = m.path[m.path.length - 1]!;
      const taken =
        mine.some((o) => o.id !== u.id && samePoint(plannedEnd(s, o), end)) || s.draft.spawns.some((sp) => samePoint(sp, end));
      if (!taken) continue;
      m.path.pop();
      if (m.path.length) m.facing = facingToward(m.path.length > 1 ? m.path[m.path.length - 2]! : u, m.path[m.path.length - 1]!);
      changed = true;
    }
  }
}

/**
 * A new planning phase: each unit with a standing destination gets its next
 * leg, or loses the route if it's there, can't get there, or an enemy it can
 * see stands on the way. A route never turns aside round an enemy: it stops
 * and the unit waits for orders (the owner's call). The server already ended
 * the routes of units an enemy stopped mid-move.
 */
function continueRoutes(v: PlayerView) {
  for (const r of v.myRoutes ?? []) {
    const u = unitById(s, r.unitId);
    if (!u || !isMine(s, u) || samePoint(u, r.to)) continue;
    const way = wayOn(s, u, r.to);
    const blocker = way?.find((p) => v.units.some((o) => o.seat !== u.seat && samePoint(o, p)));
    if (!way || blocker) {
      if (blocker) s.log.push({ round: v.round, html: `${unitLabel(s, u)}: route stopped, an enemy is in the way.` });
      continue;
    }
    setRoute(u, r.to, r.facing);
  }
}

// --- Taps on the board -------------------------------------------------------------

/** How a tap came: a mouse, a finger or pen, or Enter on the keyboard cursor. */
type Input = "mouse" | "touch" | "key";

/** A tap on a tile. */
function onTap(p: Point, input: Input = "key") {
  const v = s.view;
  if (!v) return;
  resignAsked = false;
  const u = unitAt(s, p);
  if (canPlan(s)) planningTap(p, u, input);
  else if (v.phase === "attack" && isMyAttackTurn(s)) attackTap(u);
  else s.selected = u ? { type: "unit", id: u.id } : null;
  refresh();
}

function planningTap(p: Point, u: Unit | undefined, input: Input) {
  const sel = s.selected;
  const selUnit = sel?.type === "unit" ? unitById(s, sel.id) : undefined;
  if (selUnit && isMine(s, selUnit)) {
    const order = moveOrderFor(s, selUnit.id);
    // Tapping the ghost at the end of a route (or a long route's destination)
    // aims it: it follows the pointer until the next tap.
    const route = routeFor(s, selUnit.id);
    if ((order && order.path.length && samePoint(plannedEnd(s, selUnit), p)) || (route && samePoint(route.to, p))) {
      startAim();
      return;
    }
    if (u?.id === selUnit.id) {
      // With a mouse, clicking it again turns it on the spot (a right click
      // then sets that facing and cancels its move or route); otherwise it
      // deselects.
      if (input === "mouse") startAim(true);
      else s.selected = null;
      return;
    }
  }
  // A teammate that is moving away leaves its tile free: with a unit
  // selected, clicking it routes the selected unit there (deselect first to
  // pick the teammate itself).
  const leaving = !!u && isMine(s, u) && !!moveOrderFor(s, u.id)?.path.length;
  if (u && isMine(s, u) && !(selUnit && isMine(s, selUnit) && leaving && u.id !== selUnit.id)) {
    s.selected = { type: "unit", id: u.id };
    // With a mouse the unit turns on the spot to follow the pointer straight
    // away: a right click sets that facing (dropping any move or route it
    // had: the owner's way to just turn a unit round), a left click on a tile
    // moves it instead and leaves its orders as they were.
    if (input === "mouse") startAim(true);
    return;
  }
  // A route may also end on an enemy's tile: take it if they leave, stop in front of them if not.
  if (selUnit && isMine(s, selUnit) && (!u || leaving || !isMine(s, u))) {
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
      // A move within reach replaces any route the unit had.
      dropRoute(selUnit.id);
      // It then turns to follow the pointer (a right click, or on a touch screen the next tap, sets it).
      if (input !== "key") startAim();
      return;
    }
    // Further than it can go this round: a route over several rounds, if
    // there's a way. The first leg is this round's move, aimed the same way.
    if (!path && setRoute(selUnit, p)) {
      if (input !== "key") startAim();
      return;
    }
  }
  const spawnIndex = s.draft.spawns.findIndex((sp) => sp.x === p.x && sp.y === p.y);
  if (spawnIndex >= 0) {
    // A second tap on a selected deployment aims it.
    if (sel?.type === "spawn" && sel.index === spawnIndex) startAim();
    else s.selected = { type: "spawn", index: spawnIndex };
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
  if (action === "replay-start") {
    void startReplay();
    return;
  }
  if (replayControl(action)) {
    refresh();
    return;
  }
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
      s.aiming = null;
      aimTarget()?.set(normFacing(Number(el.dataset.facing)));
      break;
    }
    case "aim":
      if (s.aiming) cancelAim();
      else startAim();
      break;
    case "clear-order":
      // Settled: an aim in progress must not put the old orders back later.
      s.aiming = null;
      s.draft.moves = s.draft.moves.filter((m) => m.unitId !== Number(el.dataset.unit));
      dropRoute(Number(el.dataset.unit));
      break;
    case "cancel-route":
      // This round's leg stays as an ordinary move; only the rest is dropped.
      s.aiming = null;
      dropRoute(Number(el.dataset.unit));
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
  if (s.aiming) {
    faceToward(board.camera.toWorld(sx, sy));
    refresh();
  }
  showTooltip(tile, sx, sy);
}

// --- Aiming ------------------------------------------------------------------------
// Facings are any whole degree. Q and E turn in steps; aiming turns the unit to
// follow the pointer and sets it on the next tap; R points it at the cursor.

/** The facing being set: the selected unit's (through its order, made if need be) or a deployment's. */
function aimTarget(): { anchor: Point; get: () => Facing; set: (f: Facing) => void } | null {
  const sel = s.selected;
  if (!canPlan(s)) return null;
  if (sel?.type === "unit") {
    const u = unitById(s, sel.id);
    if (!u || !isMine(s, u)) return null;
    // Aiming started by clicking the unit: it turns where it stands, and its
    // move and route give way to that (put back if the aim is cancelled).
    if (s.aiming?.spot) {
      return {
        anchor: u,
        get: () => {
          const m = moveOrderFor(s, u.id);
          return m && !m.path.length ? m.facing : u.facing;
        },
        set: (facing) => {
          dropRoute(u.id);
          s.draft.moves = s.draft.moves.filter((m) => m.unitId !== u.id);
          s.draft.moves.push({ unitId: u.id, path: [], facing });
        },
      };
    }
    // A route over several rounds is aimed at its destination: the facing it
    // takes on arriving. This round's leg keeps facing the way it walks.
    const route = routeFor(s, u.id);
    if (route) {
      const path = fullPathTo(s, u, route.to);
      const walkIn = path && path.length ? facingToward(path.length > 1 ? path[path.length - 2]! : u, path[path.length - 1]!) : u.facing;
      return { anchor: route.to, get: () => route.facing ?? walkIn, set: (f) => (route.facing = f) };
    }
    return {
      anchor: plannedEnd(s, u),
      get: () => moveOrderFor(s, u.id)?.facing ?? u.facing,
      set: (facing) => {
        const order = moveOrderFor(s, u.id);
        if (order) order.facing = facing;
        else s.draft.moves.push({ unitId: u.id, path: [], facing });
      },
    };
  }
  if (sel?.type === "spawn") {
    const sp = s.draft.spawns[sel.index];
    if (!sp) return null;
    return { anchor: sp, get: () => sp.facing, set: (f) => (sp.facing = f) };
  }
  return null;
}

/** Turn the selected unit or deployment to face a point (in tiles, fractions allowed). */
function faceToward(world: Point): boolean {
  const t = aimTarget();
  if (!t) return false;
  const from = { x: t.anchor.x + 0.5, y: t.anchor.y + 0.5 };
  if (Math.hypot(world.x - from.x, world.y - from.y) < 0.35) return false;
  t.set(facingToward(from, world));
  return true;
}

/** Start aiming the selection. `spot`: a unit turns where it stands (see ClientState.aiming). */
function startAim(spot = false) {
  const sel = s.selected;
  if (spot && sel?.type === "unit") {
    const move = moveOrderFor(s, sel.id);
    const route = routeFor(s, sel.id);
    s.aiming = {
      before: 0,
      selection: JSON.stringify(sel),
      spot: { move: move ? structuredClone(move) : null, route: route ? structuredClone(route) : null },
    };
    const t = aimTarget();
    if (!t) {
      s.aiming = null;
      return;
    }
    s.aiming.before = t.get();
    return;
  }
  const t = aimTarget();
  if (t) s.aiming = { before: t.get(), selection: JSON.stringify(s.selected) };
}

function cancelAim() {
  const spot = s.aiming?.spot;
  const sel = s.selected;
  if (spot && sel?.type === "unit") {
    // Put back the move and route it had before it was turned on the spot.
    s.draft.moves = s.draft.moves.filter((m) => m.unitId !== sel.id);
    if (spot.move) s.draft.moves.push(spot.move);
    dropRoute(sel.id);
    if (spot.route) (s.draft.routes ??= []).push(spot.route);
  } else if (s.aiming) aimTarget()?.set(s.aiming.before);
  s.aiming = null;
  // Following the pointer may have made a turn-on-the-spot order; one that
  // ends up facing where the unit already does is no order at all.
  if (sel?.type === "unit") {
    const u = unitById(s, sel.id);
    const order = u && moveOrderFor(s, u.id);
    if (u && order && order.path.length === 0 && order.facing === u.facing) s.draft.moves = s.draft.moves.filter((m) => m !== order);
  }
}

/**
 * What a unit standing on a site is doing to it, in words for the tooltip:
 * the badge on the board says whose it is; this says what happens next.
 */
function siteLine(u: Unit): string {
  const v = s.view;
  if (!v) return "";
  const whose = (o: number | null) => (o === null ? "neutral" : o === v.seat ? "yours" : `${esc(playerName(s, o))}'s`);
  const next = (o: number | null) => (o === null ? `${u.seat === v.seat ? "yours" : `${esc(playerName(s, u.seat))}'s`}` : "neutral");
  // Rounds still to hold a tile for this step (posts: one round a step before rules revision 2).
  const left = (taking: { seat: number; rounds: number } | null | undefined) =>
    (hasTrait(u.kind, "engineer") ? RULES.engineerBaseCaptureRounds : RULES.baseCaptureRounds) - (taking?.seat === u.seat ? taking.rounds : 0);
  const after = (n: number) => (n <= 1 ? "at the end of the round" : `after ${n} more rounds here`);
  const post = s.map.posts.findIndex((p) => samePoint(p, u));
  if (post >= 0) {
    const o = v.postOwners[post] ?? null;
    if (o === u.seat) return `On a command post: ${whose(o)}.`;
    return `On a command post (${whose(o)}): ${next(o)} ${after(RULES.rulesRevision >= 2 ? left(v.postCapture?.[post]) : 1)}.`;
  }
  const inc = s.map.income.findIndex((p) => samePoint(p, u));
  if (inc >= 0) {
    const o = v.incomeOwners[inc] ?? null;
    if (o === u.seat) return `On a supply depot: ${whose(o)}.`;
    return hasTrait(u.kind, "engineer") ? `On a supply depot (${whose(o)}): ${next(o)} at the end of the round.` : `On a supply depot (${whose(o)}): only an engineer can take it.`;
  }
  const bi = baseTiles(s.map, v.seats.length).findIndex((t) => samePoint(t, u));
  if (bi >= 0) {
    const o = v.baseOwners[bi] ?? null;
    if (o === u.seat) return `On a base tile: ${whose(o)}.`;
    return `On a base tile (${whose(o)}): ${next(o)} ${after(left(v.baseCapture?.[bi]))}.`;
  }
  return "";
}

function showTooltip(tile: Point, sx: number, sy: number) {
  const u = unitAt(s, tile);
  if (u) {
    const site = siteLine(u);
    tooltip.innerHTML = `<strong>${unitLabel(s, u)}</strong><span>${u.hp} / ${UNITS[u.kind].hp} hp · facing ${facingName(u.facing)}</span>${site ? `<span>${site}</span>` : ""}`;
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
  tap: (sx, sy, button, pointerType) => {
    const p = board.tileAt(sx, sy);
    const world = board.camera.toWorld(sx, sy);
    // With a mouse: left click moves (and the unit then turns to follow the
    // pointer), right click sets the facing there and deselects. A touch
    // screen has no right click, so there the tap after a route sets it.
    if (button === 2) {
      if (canPlan(s)) faceToward(world);
      s.aiming = null;
      s.selected = null;
      refresh();
      return;
    }
    if (s.aiming) {
      if (pointerType !== "mouse") {
        faceToward(world);
        s.aiming = null;
        refresh();
        return;
      }
      // A left click while aiming is an ordinary click (a new route, another
      // unit), and only a right click sets a facing: put it back first.
      cancelAim();
    }
    if (p) onTap(p, pointerType === "mouse" ? "mouse" : "touch");
  },
  hover: onHover,
  changed: () => {
    board.userMoved = true;
    board.stopGlide();
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

/** Turn the selected unit or deployment by `step` degrees (clockwise positive). */
function rotateSelected(step: number) {
  const t = aimTarget();
  if (!t) return false;
  s.aiming = null;
  t.set(normFacing(t.get() + step));
  return true;
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
  // During a replay: Space plays or pauses, the side arrows step, Esc leaves.
  // Everything else (zoom, the cursor up and down, ?) works as usual.
  if (s.replay && !s.replay.loading) {
    if (key === " ") return replayControl(s.replay.playing ? "replay-pause" : "replay-play");
    if (key === "ArrowRight") return replayControl("replay-forward");
    if (key === "ArrowLeft") return replayControl("replay-back");
    if (key === "Escape" && keyHelp.hidden) return replayControl("replay-exit");
  }
  if (key === "?" || (key === "/" && e.shiftKey)) {
    keyHelp.hidden = !keyHelp.hidden;
    return true;
  }
  if (key === "Escape") {
    if (!keyHelp.hidden) keyHelp.hidden = true;
    else if (s.aiming) cancelAim();
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
    if (s.aiming) {
      // Enter sets the aim as it is; the cursor keys turned nothing.
      s.aiming = null;
      return true;
    }
    if (s.hover) onTap(s.hover);
    return true;
  }
  if (key === "Enter" && e.shiftKey) return finish();
  if (/^[0-9]$/.test(key)) {
    const n = key === "0" ? 10 : Number(key);
    return s.view?.phase === "attack" ? pickTarget(n) : deployByNumber(n);
  }
  switch (key) {
    case "q":
      return rotateSelected(e.shiftKey ? -45 : -15);
    case "e":
      return rotateSelected(e.shiftKey ? 45 : 15);
    case "r":
      if (!s.hover) return false;
      s.aiming = null;
      return faceToward({ x: s.hover.x + 0.5, y: s.hover.y + 0.5 });
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
        dropRoute(sel.id);
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
    case "z":
      board.showWhole();
      return true;
  }
  return false;
}

function zoomBy(f: number) {
  board.userMoved = true;
  board.stopGlide();
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
document.getElementById("zoom-fit")!.addEventListener("click", () => board.showWhole());
document.getElementById("key-help-open")!.addEventListener("click", () => (keyHelp.hidden = !keyHelp.hidden));
document.getElementById("key-help-close")!.addEventListener("click", () => (keyHelp.hidden = true));

new ResizeObserver(() => board.resize()).observe(canvas.parentElement!);
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => board.repaint());

// Read-only hooks for the browser suites: where a tile is on screen, and what
// this player can see. Tests click real coordinates through these rather than
// reaching into the state, so they exercise the same path as a player.
(window as unknown as { __salient: unknown }).__salient = {
  screenOf: (x: number, y: number) => {
    // The board shows part of the map: pan to the tile first, as a player would.
    if (board.reveal({ x, y })) board.userMoved = true;
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
  draft: () => s.view && { moves: s.draft.moves.map((m) => ({ unitId: m.unitId, steps: m.path.length, end: m.path[m.path.length - 1] ?? null, facing: m.facing })), routes: s.draft.routes ?? [], myRoutes: s.view.myRoutes },
  mapSize: () => ({ width: s.map.width, height: s.map.height }),
  log: () => s.log.map((l) => l.html),
  phase: () => s.view && { phase: s.view.phase, round: s.view.round, attackTurn: s.view.attackTurn, ready: s.view.seats.map((p) => p.ready) },
  busy: () => board.anim.animating,
  hover: () => s.hover,
  replay: () => s.replay && { index: s.replay.index, total: s.replay.total, playing: s.replay.playing, units: s.view?.units.length ?? 0 },
};

board.resize();
refresh();
connect();
requestAnimationFrame(frame);

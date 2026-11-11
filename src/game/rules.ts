// The round structure: planning (everyone orders at once), movement (resolved
// together), attacks (taken in turn), then upkeep. `applyAction` is the only
// way the state changes, and it is deterministic given the roll function, so
// a game is fully described by its seed and its list of actions.
import { RULES } from "./constants.js";
import { blastTiles, commanded, damageFor, flankOf, previewShot, rollShot, shieldFactor } from "./combat.js";
import { facingToward, inBounds, samePoint } from "./grid.js";
import { getMap } from "./maps.js";
import { validatePath } from "./movement.js";
import { traceLine } from "./los.js";
import { UNITS, UNIT_KINDS, hasTrait } from "./units.js";
import { isArmed } from "./combat.js";
import { baseTiles, baseTilesOwned, isSpawnTile, unitVisibleTo, visibleTiles } from "./visibility.js";
import {
  RuleError,
  type Action,
  type Facing,
  type GameEvent,
  type GameState,
  type MapDef,
  type MoveOrder,
  type Orders,
  type Point,
  type Seat,
  type Unit,
} from "./types.js";

export function newGame(mapId: string, seatCount: number): GameState {
  const map = getMap(mapId);
  if (seatCount < 2 || seatCount > map.seats) throw new Error(`${map.name} takes 2 to ${map.seats} players`);
  return {
    mapId,
    seatCount,
    round: 1,
    phase: "planning",
    seats: Array.from({ length: seatCount }, (_, seat) => ({
      seat,
      gold: RULES.startGold,
      eliminated: false,
    })),
    units: [],
    nextUnitId: 1,
    postOwners: map.posts.map(() => null),
    incomeOwners: map.income.map(() => null),
    baseOwners: baseTiles(map, seatCount).map((t) => t.home),
    baseCapture: baseTiles(map, seatCount).map(() => null),
    orders: Array.from({ length: seatCount }, () => null),
    routes: Array.from({ length: seatCount }, () => []),
    attackTurn: null,
    actedUnitIds: [],
    burst: null,
    winner: null,
  };
}

export interface Applied {
  state: GameState;
  events: GameEvent[];
}

/** Apply one action to a copy of the state. Throws RuleError if it is not allowed. */
export function applyAction(prev: GameState, action: Action, roll: () => number): Applied {
  const state = structuredClone(prev);
  const map = getMap(state.mapId);
  const events: GameEvent[] = [];
  if (state.phase === "over") throw new RuleError("game_over");
  const seat = state.seats[action.seat];
  if (!seat) throw new RuleError("not_your_unit", `no seat ${action.seat}`);
  if (seat.eliminated) throw new RuleError("eliminated");

  switch (action.type) {
    case "orders":
      submitOrders(map, state, action.seat, action.orders, events);
      break;
    case "attack":
      attack(map, state, action.seat, action.unitId, action.targetId, roll, events);
      break;
    case "hold": {
      requireAttackTurn(state, action.seat);
      const unit = ownUnit(state, action.seat, action.unitId);
      if (state.actedUnitIds.includes(unit.id)) throw new RuleError("already_acted");
      if (state.burst && state.burst.unitId !== unit.id) throw new RuleError("finish_burst");
      state.burst = null;
      state.actedUnitIds.push(unit.id);
      events.push({ type: "hold", unitId: unit.id, seat: action.seat });
      passAttackTurn(map, state, action.seat, events);
      break;
    }
    case "endAttacks":
      requireAttackTurn(state, action.seat);
      state.burst = null;
      for (const u of state.units) if (u.seat === action.seat && !state.actedUnitIds.includes(u.id)) state.actedUnitIds.push(u.id);
      passAttackTurn(map, state, action.seat, events);
      break;
    case "resign":
      eliminate(state, action.seat, events);
      if (!checkWinner(state, events)) {
        if (state.phase === "planning") maybeResolvePlanning(map, state, events);
        else if (state.phase === "attack") {
          // Their units are gone, so whoever was due to shoot may have lost
          // every target. Re-pick the attacker rather than leave them stuck.
          const current = state.attackTurn;
          if (state.burst && !state.units.some((u) => u.id === state.burst!.unitId)) state.burst = null;
          if (current === null || current === action.seat || readyShooters(map, state, current).length === 0) {
            passAttackTurn(map, state, current ?? action.seat, events);
          }
        }
      }
      break;
  }
  return { state, events };
}

// --- Planning --------------------------------------------------------------

function submitOrders(map: MapDef, state: GameState, seat: Seat, orders: Orders, events: GameEvent[]) {
  if (state.phase !== "planning") throw new RuleError("wrong_phase");
  validateOrders(map, state, seat, orders);
  // Re-submitting before everyone is in replaces the earlier orders.
  state.orders[seat] = structuredClone(orders);
  // The standing destinations go with them, and stay for later rounds.
  state.routes[seat] = structuredClone(orders.routes ?? []);
  maybeResolvePlanning(map, state, events);
}

/** Every check a submitted set of orders must pass. Exported so the browser can pre-check. */
export function validateOrders(map: MapDef, state: GameState, seat: Seat, orders: Orders): void {
  const seen = new Set<number>();
  const byUnit = new Map<number, MoveOrder>();
  for (const m of orders.moves) {
    if (seen.has(m.unitId)) throw new RuleError("duplicate_order");
    seen.add(m.unitId);
    const unit = ownUnit(state, seat, m.unitId);
    if (!isFacing(m.facing)) throw new RuleError("bad_path", `facing ${m.facing}`);
    if (unit.fired && m.path.length > 0) throw new RuleError("fired_cannot_move", `unit ${unit.id}`);
    const verdict = validatePath(map, unit, m.path);
    if (verdict !== "ok") throw new RuleError(verdict, `unit ${unit.id}`);
    byUnit.set(unit.id, m);
  }

  // Where each of this seat's units will try to finish. Two may not aim for
  // the same tile, and nobody may plan to end on a teammate who is staying put.
  const destinations = new Set<string>();
  for (const u of state.units) {
    if (u.seat !== seat) continue;
    const order = byUnit.get(u.id);
    const end = order && order.path.length > 0 ? order.path[order.path.length - 1]! : u;
    const k = `${end.x},${end.y}`;
    if (destinations.has(k)) throw new RuleError("duplicate_destination");
    destinations.add(k);
  }

  // Standing destinations: lenient, since the tile may be fogged or out of
  // reach for now. Only that the unit is yours, the tile is on the map, and
  // one per unit.
  const routed = new Set<number>();
  for (const r of orders.routes ?? []) {
    if (routed.has(r.unitId)) throw new RuleError("duplicate_order", `route for unit ${r.unitId}`);
    routed.add(r.unitId);
    ownUnit(state, seat, r.unitId);
    if (!Number.isInteger(r.to.x) || !Number.isInteger(r.to.y) || !inBounds(map, r.to.x, r.to.y)) {
      throw new RuleError("bad_path", `route for unit ${r.unitId}`);
    }
    if (r.facing !== undefined && !isFacing(r.facing)) throw new RuleError("bad_path", `route facing ${r.facing}`);
  }

  let cost = 0;
  const spawnTilesUsed = new Set<string>();
  for (const s of orders.spawns) {
    if (!UNIT_KINDS.includes(s.kind)) throw new RuleError("bad_spawn_tile", `kind ${s.kind}`);
    if (!isSpawnTile(map, state, seat, s)) throw new RuleError("bad_spawn_tile");
    if (!isFacing(s.facing)) throw new RuleError("bad_spawn_tile", `facing ${s.facing}`);
    const k = `${s.x},${s.y}`;
    if (spawnTilesUsed.has(k) || destinations.has(k)) throw new RuleError("spawn_tile_occupied");
    // A teammate standing there now is in the way even if it is ordered off:
    // kept simple, so a plan never depends on a move working out.
    if (state.units.some((u) => u.seat === seat && u.x === s.x && u.y === s.y)) throw new RuleError("spawn_tile_occupied");
    spawnTilesUsed.add(k);
    cost += UNITS[s.kind].cost;
  }
  if (cost > state.seats[seat]!.gold) throw new RuleError("not_enough_gold");
}

function maybeResolvePlanning(map: MapDef, state: GameState, events: GameEvent[]) {
  const waiting = state.seats.some((s) => !s.eliminated && state.orders[s.seat] === null);
  if (waiting) return;
  // Moves first, then deployments: a unit that steps onto a tile gets it, and
  // a deployment planned there fails (and is refunded). The other way round,
  // a side could block any tile of its base by buying a unit onto it.
  resolveMoves(map, state, events);
  resolveSpawns(state, events);
  // Last round's shooters have sat out this move; they may move again next time.
  for (const u of state.units) u.fired = false;
  state.phase = "attack";
  state.actedUnitIds = [];
  state.burst = null;
  events.push({ type: "phase", phase: "attack" });
  state.attackTurn = nextAttacker(map, state, null);
  if (state.attackTurn === null) endRound(map, state, events);
}

function resolveSpawns(state: GameState, events: GameEvent[]) {
  for (const seatState of state.seats) {
    const orders = state.orders[seatState.seat];
    if (!orders || seatState.eliminated) continue;
    for (const s of orders.spawns) {
      const cost = UNITS[s.kind].cost;
      // Checked again at resolution: an enemy may have been standing on the
      // tile all along, unseen, or have just walked onto it. Nothing is
      // charged for a failed deployment.
      const blocked = state.units.some((u) => u.x === s.x && u.y === s.y);
      if (blocked || cost > seatState.gold) {
        events.push({ type: "spawnFailed", seat: seatState.seat, kind: s.kind, x: s.x, y: s.y, refund: cost });
        continue;
      }
      seatState.gold -= cost;
      const unit: Unit = {
        id: state.nextUnitId++,
        seat: seatState.seat,
        kind: s.kind,
        x: s.x,
        y: s.y,
        facing: s.facing,
        hp: UNITS[s.kind].hp,
        moved: false,
        damaged: false,
        fired: false,
      };
      state.units.push(unit);
      events.push({ type: "spawn", unit: { ...unit } });
    }
  }
}

/**
 * Everyone moves at once, one step per tick. A side's own units pass through
 * one another freely (onto, past, even swapping places); only enemies get in
 * the way. In each tick a step is refused if a unit of another side wants the
 * same tile, if it would swap places with an enemy, or if the tile ahead is
 * held by an enemy that is not itself moving on. A refused unit stops where it
 * is for the rest of the round, turned towards where it was going: that is how
 * you find an enemy you could not see.
 *
 * Nobody may finish on a tile with another unit, so when the steps are done,
 * of any two units sharing a tile the later arrival steps back along its
 * route, again until every tile holds one (a unit's starting tile is its own,
 * so this always ends). The rules look only at positions and ticks, never at
 * the order units are listed in.
 */
function resolveMoves(map: MapDef, state: GameState, events: GameEvent[]) {
  const orders = new Map<number, MoveOrder>();
  for (const o of state.orders) for (const m of o?.moves ?? []) orders.set(m.unitId, m);

  interface Mover {
    unit: Unit;
    path: Point[];
    from: Point;
    taken: Point[];
    active: boolean;
    bumped: boolean;
    /** Stopped by an enemy (not just stepped back off a teammate's tile). */
    metEnemy?: boolean;
  }
  const movers: Mover[] = [];
  for (const unit of state.units) {
    const order = orders.get(unit.id);
    if (!order) continue;
    movers.push({ unit, path: order.path, from: { x: unit.x, y: unit.y }, taken: [], active: order.path.length > 0, bumped: false });
  }
  const key = (p: Point) => `${p.x},${p.y}`;

  const longest = Math.max(0, ...movers.map((m) => m.path.length));
  for (let t = 0; t < longest; t++) {
    const stepping = movers.filter((m) => m.active && t < m.path.length);
    if (stepping.length === 0) break;
    const moverOf = new Map(stepping.map((m) => [m.unit, m]));
    const standing = new Map<string, Unit[]>();
    for (const u of state.units) standing.set(key(u), [...(standing.get(key(u)) ?? []), u]);
    const enemiesAt = (p: Point, seat: Seat) => (standing.get(key(p)) ?? []).filter((u) => u.seat !== seat);
    const want = new Map<Mover, Point>();
    for (const m of stepping) want.set(m, m.path[t]!);

    const refused = new Set<Mover>();
    const seatsWanting = new Map<string, Set<Seat>>();
    for (const [m, p] of want) seatsWanting.set(key(p), (seatsWanting.get(key(p)) ?? new Set()).add(m.unit.seat));
    for (const [m, p] of want) {
      // Two sides reaching for one tile: everyone reaching for it stops.
      if (seatsWanting.get(key(p))!.size > 1) refused.add(m);
      // Swapping places with an enemy is refused (friends may swap).
      for (const other of enemiesAt(p, m.unit.seat)) {
        const om = moverOf.get(other);
        if (om && samePoint(want.get(om)!, m.unit)) refused.add(m);
      }
    }
    // A step onto an enemy's tile is fine only if that enemy is stepping out
    // this same tick. Refusals cascade back down a queue, so repeat until
    // nothing changes.
    let changed = true;
    while (changed) {
      changed = false;
      for (const [m, p] of want) {
        if (refused.has(m)) continue;
        if (enemiesAt(p, m.unit.seat).some((o) => !moverOf.has(o) || refused.has(moverOf.get(o)!))) {
          refused.add(m);
          changed = true;
        }
      }
    }

    for (const [m, p] of want) {
      if (refused.has(m)) {
        m.active = false;
        m.bumped = true;
        m.metEnemy = true;
        m.unit.facing = facingToward(m.unit, p);
      } else {
        m.unit.facing = facingToward(m.unit, p);
        m.unit.x = p.x;
        m.unit.y = p.y;
        m.unit.moved = true;
        m.taken.push({ ...p });
      }
    }
  }

  // Untangle: nobody finishes on a shared tile. A unit's arrival on its
  // current tile is its step count (-1: it never left its start); the later
  // arrival steps back, ties going to the higher unit id.
  const moverByUnit = new Map(movers.map((m) => [m.unit, m]));
  const arrival = (u: Unit) => (moverByUnit.get(u)?.taken.length ?? 0) - 1;
  for (let tangled = true; tangled; ) {
    tangled = false;
    const byTile = new Map<string, Unit[]>();
    for (const u of state.units) byTile.set(key(u), [...(byTile.get(key(u)) ?? []), u]);
    for (const group of byTile.values()) {
      if (group.length < 2) continue;
      const back = [...group].sort((a, b) => arrival(b) - arrival(a) || b.id - a.id)[0]!;
      const m = moverByUnit.get(back);
      if (!m || m.taken.length === 0) continue; // cannot happen: starting tiles are distinct
      const left = m.taken.pop()!;
      const to = m.taken[m.taken.length - 1] ?? m.from;
      back.x = to.x;
      back.y = to.y;
      back.facing = facingToward(back, left);
      back.moved = m.taken.length > 0;
      m.bumped = true;
      tangled = true;
    }
  }

  for (const m of movers) {
    const order = orders.get(m.unit.id)!;
    if (!m.bumped) m.unit.facing = order.facing;
    if (m.taken.length > 0 || m.bumped || order.path.length === 0) {
      events.push({ type: "move", unitId: m.unit.id, seat: m.unit.seat, from: m.from, steps: m.taken, bumped: m.bumped });
    }
    // A route that runs into an enemy is over: the unit stops and waits for
    // orders rather than carry on round it (the owner's call). Routes never
    // move anyone on the server, so old logs still replay the same.
    if (m.metEnemy) {
      const routes = state.routes?.[m.unit.seat];
      if (routes) state.routes[m.unit.seat] = routes.filter((r) => r.unitId !== m.unit.id);
    }
  }
}

// --- Attacks ---------------------------------------------------------------

/** Seats in the order they take attack turns this round. The lead rotates every round. */
export function initiativeOrder(state: GameState): Seat[] {
  const order: Seat[] = [];
  for (let i = 0; i < state.seatCount; i++) {
    const s = (state.round - 1 + i) % state.seatCount;
    if (!state.seats[s]!.eliminated) order.push(s);
  }
  return order;
}

/**
 * The units a seat knows of: its own and the enemies it can see. Only these
 * block its shots, so the browser (which knows exactly these) and the server
 * always agree on what can be shot, and a refused shot never gives away an
 * unseen unit.
 */
export function knownTo(map: MapDef, state: GameState, seat: Seat, tiles?: ReadonlySet<number>): Unit[] {
  const seen = tiles ?? visibleTiles(map, state, seat);
  return state.units.filter((u) => unitVisibleTo(map, state, seat, u, seen));
}

/** Enemies this unit could shoot right now. */
export function targetsFor(map: MapDef, state: GameState, unit: Unit, tiles?: ReadonlySet<number>): Unit[] {
  if (!isArmed(unit.kind)) return [];
  const known = knownTo(map, state, unit.seat, tiles);
  return known.filter((t) => t.seat !== unit.seat && previewShot(map, unit, t, known).possible);
}

/**
 * Units of this seat that have not acted and have something to shoot at.
 * While one of its units is part way through its shots, only that one.
 */
export function readyShooters(map: MapDef, state: GameState, seat: Seat): Unit[] {
  const tiles = visibleTiles(map, state, seat);
  const burst = state.burst;
  return state.units.filter(
    (u) =>
      u.seat === seat &&
      !state.actedUnitIds.includes(u.id) &&
      (!burst || burst.unitId === u.id || !state.units.some((b) => b.id === burst.unitId && b.seat === seat)) &&
      targetsFor(map, state, u, tiles).length > 0,
  );
}

/**
 * The next seat, after `after` in initiative order, with a unit that can
 * shoot. Seats with nothing to shoot at are skipped rather than made to pass
 * by hand. null when nobody can shoot: the attack phase is over.
 */
function nextAttacker(map: MapDef, state: GameState, after: Seat | null): Seat | null {
  const order = initiativeOrder(state);
  if (order.length === 0) return null;
  const start = after === null ? 0 : order.indexOf(after) + 1;
  for (let i = 0; i < order.length; i++) {
    const s = order[(start + i) % order.length]!;
    if (readyShooters(map, state, s).length > 0) return s;
  }
  return null;
}

function requireAttackTurn(state: GameState, seat: Seat) {
  if (state.phase !== "attack") throw new RuleError("wrong_phase");
  if (state.attackTurn !== seat) throw new RuleError("not_your_turn");
}

function ownUnit(state: GameState, seat: Seat, unitId: number): Unit {
  const unit = state.units.find((u) => u.id === unitId);
  if (!unit) throw new RuleError("no_such_unit");
  if (unit.seat !== seat) throw new RuleError("not_your_unit");
  return unit;
}

function attack(
  map: MapDef,
  state: GameState,
  seat: Seat,
  unitId: number,
  targetId: number,
  roll: () => number,
  events: GameEvent[],
) {
  requireAttackTurn(state, seat);
  const shooter = ownUnit(state, seat, unitId);
  if (state.actedUnitIds.includes(shooter.id)) throw new RuleError("already_acted");
  if (state.burst && state.burst.unitId !== shooter.id) throw new RuleError("finish_burst");
  const aimedAt = state.units.find((u) => u.id === targetId);
  if (!aimedAt) throw new RuleError("no_such_unit");
  const known = knownTo(map, state, seat);
  if (!targetsFor(map, state, shooter).includes(aimedAt)) throw new RuleError("cannot_shoot");

  // An enemy the shooter's side can't see (a stealthy commando, someone in
  // the fog mid-way along a long shot) and that stands on the line takes the
  // shot instead: the nearest such one. Otherwise hiding a unit would let
  // shots pass through it.
  const line = traceLine(map, shooter, aimedAt);
  const hidden = line.tiles
    .map((p) => state.units.find((u) => u.x === p.x && u.y === p.y && u.seat !== seat && !known.includes(u)))
    .find((u): u is Unit => !!u);
  const target = hidden ?? aimedAt;
  // The shot is rolled against what it strikes. A hidden unit is often
  // hidden because the shooter has no line to its own tile (the line to the
  // aimed-at unit only clips it), so its own preview can come out
  // impossible; then the shot keeps the chance it was fired with, and the
  // damage is worked out for the unit it struck. (Without this every such
  // shot rolled 0% and missed, and a side could fire into it all game.
  // Rules revision 1: older games keep rolling 0%, as they were played.)
  let preview = previewShot(map, shooter, target, known);
  if (hidden && !preview.possible && RULES.rulesRevision >= 1) {
    const aimed = previewShot(map, shooter, aimedAt, known);
    const flank = flankOf(shooter, hidden);
    const shield = shieldFactor(shooter, hidden, flank);
    preview = {
      ...aimed,
      flank,
      fatal: false,
      chance: Math.max(RULES.minHitChance / 100, Math.round(aimed.chance * shield * 100) / 100),
      damage: damageFor(shooter, hidden, flank, commanded(shooter, known)),
    };
  }
  const result = rollShot(preview, roll(), roll());
  const fired = state.burst?.unitId === shooter.id ? state.burst.fired + 1 : 1;
  const hurt = (u: Unit, damage: number) => {
    u.hp -= damage;
    u.damaged = true;
    return u.hp <= 0;
  };
  const dead = new Set<number>();
  shooter.fired = true;
  if (result.hit && hurt(target, result.damage)) dead.add(target.id);

  // Explosives: the shell lands on the target's tile whether it hits or not.
  // A direct hit does full damage to the target and the blast to everyone
  // round it; a miss does the blast to the target as well. Friend and foe.
  const splash: Extract<GameEvent, { type: "shot" }>["splash"] = [];
  if (preview.splash > 0) {
    for (const p of blastTiles(map, target)) {
      const u = state.units.find((o) => o.x === p.x && o.y === p.y);
      if (!u || (u === target && result.hit)) continue;
      const killedNow = !dead.has(u.id) && hurt(u, preview.splash);
      if (killedNow) dead.add(u.id);
      splash.push({ unitId: u.id, seat: u.seat, at: { x: u.x, y: u.y }, damage: preview.splash, killed: killedNow });
    }
  }
  const killed = dead.has(target.id) && result.hit;
  const lostSeats = new Set(state.units.filter((u) => dead.has(u.id)).map((u) => u.seat));
  state.units = state.units.filter((u) => !dead.has(u.id));
  events.push({
    type: "shot",
    shooterId: shooter.id,
    targetId: target.id,
    shooterSeat: shooter.seat,
    targetSeat: target.seat,
    from: { x: shooter.x, y: shooter.y },
    to: { x: target.x, y: target.y },
    chance: preview.chance,
    hit: result.hit,
    crit: result.crit,
    damage: result.damage,
    killed,
    splash,
    ...(hidden ? { intendedId: aimedAt.id } : {}),
  });
  // Losing your last unit with no base tiles left knocks you out at once.
  let out = false;
  for (const s of lostSeats) {
    if (knockedOut(state, s)) {
      eliminate(state, s, events);
      out = true;
    }
  }
  if (out && checkWinner(state, events)) return;
  if (state.seats[seat]!.eliminated) return passAttackTurn(map, state, seat, events);

  // A unit with shots left keeps its side's turn, if it is still standing and has a target.
  const alive = state.units.some((u) => u.id === shooter.id);
  if (alive && fired < UNITS[shooter.kind].shots && targetsFor(map, state, shooter).length > 0) {
    state.burst = { unitId: shooter.id, fired };
    return;
  }
  state.burst = null;
  if (alive) state.actedUnitIds.push(shooter.id);
  passAttackTurn(map, state, seat, events);
}

function passAttackTurn(map: MapDef, state: GameState, seat: Seat, events: GameEvent[]) {
  state.attackTurn = nextAttacker(map, state, seat);
  if (state.attackTurn === null) endRound(map, state, events);
}

// --- Upkeep ----------------------------------------------------------------

function endRound(map: MapDef, state: GameState, events: GameEvent[]) {
  state.burst = null;
  const unitAt = (p: Point) => state.units.find((u) => u.x === p.x && u.y === p.y);

  // Captures. A unit standing on a site its side does not own takes it one
  // step towards its side: an enemy's becomes neutral, a neutral one becomes
  // theirs. One unit per tile, so a capturer is always alone on the tile, and
  // a defender standing on it blocks it. Posts take one round a step; income
  // sites need an engineer; base tiles take baseCaptureRounds a step (an
  // engineer's, engineerBaseCaptureRounds), held by the same side throughout.
  const capture = (site: "post" | "income" | "base", owners: (Seat | null)[], i: number, p: Point, engineersOnly = false) => {
    const u = unitAt(p);
    if (!u || (engineersOnly && !hasTrait(u.kind, "engineer"))) return;
    const owner = owners[i] ?? null;
    if (owner === u.seat) return;
    const next = owner === null ? u.seat : null;
    owners[i] = next;
    events.push({ type: "capture", site, index: i, from: owner, to: next });
  };
  map.posts.forEach((p, i) => capture("post", state.postOwners, i, p));
  map.income.forEach((p, i) => capture("income", state.incomeOwners, i, p, true));
  baseTiles(map, state.seatCount).forEach((p, i) => {
    const u = unitAt(p);
    if (!u || state.baseOwners[i] === u.seat) {
      // Nobody taking it (or its owner standing on it): progress is lost.
      state.baseCapture[i] = null;
      return;
    }
    const needed = hasTrait(u.kind, "engineer") ? RULES.engineerBaseCaptureRounds : RULES.baseCaptureRounds;
    const before = state.baseCapture[i];
    const rounds = before && before.seat === u.seat ? before.rounds + 1 : 1;
    if (rounds >= needed) {
      state.baseCapture[i] = null;
      capture("base", state.baseOwners, i, p);
    } else {
      state.baseCapture[i] = { seat: u.seat, rounds };
      events.push({ type: "captureProgress", site: "base", index: i, seat: u.seat, rounds, needed });
    }
  });

  for (const s of state.seats) {
    if (s.eliminated) continue;
    let amount: number = RULES.baseIncome;
    map.income.forEach((site, i) => {
      if (state.incomeOwners[i] === s.seat) amount += site.value;
    });
    s.gold += amount;
    events.push({ type: "income", seat: s.seat, amount });
  }

  // Healing reads the damage flags before they are reset below.
  for (const u of state.units) {
    const max = UNITS[u.kind].hp;
    let heal = u.damaged ? 0 : RULES.healPerRound;
    const medicNearby = state.units.some(
      (m) => m !== u && m.seat === u.seat && hasTrait(m.kind, "medic") && Math.max(Math.abs(m.x - u.x), Math.abs(m.y - u.y)) <= RULES.medicRange,
    );
    if (medicNearby) heal += RULES.medicHeal;
    u.hp = Math.min(max, u.hp + heal);
  }

  // A side with no base tiles and no units left is out.
  for (const s of state.seats) if (!s.eliminated && knockedOut(state, s.seat)) eliminate(state, s.seat, events);
  if (checkWinner(state, events)) return;

  // Nobody took the field in time: a draw.
  if (RULES.roundLimit > 0 && state.round >= RULES.roundLimit) {
    finish(state, null, events);
    return;
  }

  state.round += 1;
  state.phase = "planning";
  state.orders = state.orders.map(() => null);
  state.attackTurn = null;
  state.actedUnitIds = [];
  for (const u of state.units) {
    u.moved = false;
    u.damaged = false;
  }
  events.push({ type: "round", round: state.round });
}

function eliminate(state: GameState, seat: Seat, events: GameEvent[]) {
  const s = state.seats[seat]!;
  if (s.eliminated) return;
  s.eliminated = true;
  state.units = state.units.filter((u) => u.seat !== seat);
  state.orders[seat] = null;
  state.routes[seat] = [];
  events.push({ type: "eliminated", seat });
}

/** Out of the game: owns no base tile and has no unit on the field. Command posts don't keep you in. */
export function knockedOut(state: Pick<GameState, "baseOwners" | "units">, seat: Seat): boolean {
  return baseTilesOwned(state, seat) === 0 && !state.units.some((u) => u.seat === seat);
}

/** Ends the game if one seat (or none) is left standing. Returns whether it ended. */
function checkWinner(state: GameState, events: GameEvent[]): boolean {
  const standing = state.seats.filter((s) => !s.eliminated);
  if (standing.length > 1) return false;
  finish(state, standing[0]?.seat ?? null, events);
  return true;
}

function finish(state: GameState, winner: Seat | null, events: GameEvent[]) {
  state.phase = "over";
  state.winner = winner;
  state.attackTurn = null;
  events.push({ type: "gameOver", winner });
}

/** A facing is whole degrees, 0..359. */
export const isFacing = (n: number): n is Facing => Number.isInteger(n) && n >= 0 && n < 360;

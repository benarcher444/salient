// Where a unit can go this round, and checking a route someone submitted.
import { DIRS, inBounds, stepCost, stepOpen } from "./grid.js";
import { UNITS } from "./units.js";
import type { MapDef, Point, Unit } from "./types.js";

/** Movement budget in half-tiles (see stepCost). */
export const moveBudget = (unit: Pick<Unit, "kind">) => UNITS[unit.kind].move * 2;

export interface Reach {
  /** Cheapest cost to each reachable tile index, the start included at 0. */
  cost: Map<number, number>;
  /** Previous tile index on the cheapest route, for rebuilding the path. */
  from: Map<number, number>;
}

/**
 * Every tile the unit can reach within its budget. `blocked` holds tile
 * indexes it may not walk through (enemies the player can see): a route may
 * end on one (if the enemy moves off, you take the tile; if not, you stop in
 * front of it) but never pass it. Friendly units can be walked through;
 * whether a tile is a legal place to stop is the caller's question.
 */
export function reachable(map: MapDef, unit: Unit, blocked: ReadonlySet<number>): Reach {
  const budget = moveBudget(unit);
  const start = unit.y * map.width + unit.x;
  const cost = new Map<number, number>([[start, 0]]);
  const from = new Map<number, number>();
  // The graph is tiny (a few hundred tiles in range), so a sorted array beats
  // writing a heap.
  const open: number[] = [start];
  while (open.length > 0) {
    open.sort((a, b) => (cost.get(a) ?? 0) - (cost.get(b) ?? 0));
    const cur = open.shift()!;
    const c = cost.get(cur)!;
    const p = { x: cur % map.width, y: Math.floor(cur / map.width) };
    for (const d of DIRS) {
      const n = { x: p.x + d.x, y: p.y + d.y };
      if (!inBounds(map, n.x, n.y)) continue;
      const ni = n.y * map.width + n.x;
      if (!stepOpen(map, p, n)) continue;
      const nc = c + stepCost(map, p, n);
      if (nc > budget) continue;
      const prev = cost.get(ni);
      if (prev !== undefined && prev <= nc) continue;
      cost.set(ni, nc);
      from.set(ni, cur);
      // A blocked tile can end a route, never lead on.
      if (!blocked.has(ni) && !open.includes(ni)) open.push(ni);
    }
  }
  return { cost, from };
}

/** The cheapest route to a reachable tile, excluding the start. */
export function pathTo(map: MapDef, reach: Reach, target: Point): Point[] | null {
  let idx = target.y * map.width + target.x;
  if (!reach.cost.has(idx)) return null;
  const path: Point[] = [];
  while (reach.from.has(idx)) {
    path.unshift({ x: idx % map.width, y: Math.floor(idx / map.width) });
    idx = reach.from.get(idx)!;
  }
  return path;
}

/** Is this submitted route legal terrain-wise and within budget? Units are not considered. */
export function validatePath(map: MapDef, unit: Unit, path: readonly Point[]): "ok" | "bad_path" | "path_too_long" {
  let prev: Point = unit;
  let spent = 0;
  for (const step of path) {
    if (!Number.isInteger(step.x) || !Number.isInteger(step.y)) return "bad_path";
    if (!inBounds(map, step.x, step.y)) return "bad_path";
    if (!stepOpen(map, prev, step)) return "bad_path";
    spent += stepCost(map, prev, step);
    prev = step;
  }
  return spent <= moveBudget(unit) ? "ok" : "path_too_long";
}

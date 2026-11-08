// Fog of war and spawn points: what each seat can see, and where it can deploy.
import { RULES } from "./constants.js";
import { DIRS, distance, isPassable, stepOpen } from "./grid.js";
import { traceLine, visibleFrom } from "./los.js";
import { STEALTH_RANGE, UNITS, hasTrait } from "./units.js";
import type { GameState, MapDef, Point, Seat, Unit } from "./types.js";

/** Tile indexes the seat can see: its units' sight plus a little around its sites. */
export function visibleTiles(map: MapDef, state: GameState, seat: Seat): Set<number> {
  const seen = new Set<number>();
  for (const u of state.units) {
    if (u.seat === seat) visibleFrom(map, u, UNITS[u.kind].sight, seen);
  }
  for (const p of map.bases[seat] ?? []) visibleFrom(map, p, RULES.siteSight, seen);
  state.postOwners.forEach((owner, i) => {
    const p = map.posts[i];
    if (owner === seat && p) visibleFrom(map, p, RULES.siteSight, seen);
  });
  return seen;
}

/**
 * Can the seat see this unit? Its own units always; an enemy when it stands
 * on a visible tile — except a stealthy one, which must also be within
 * STEALTH_RANGE of one of the seat's units with a clear line to it.
 */
export function unitVisibleTo(map: MapDef, state: GameState, seat: Seat, unit: Unit, tiles: ReadonlySet<number>): boolean {
  if (unit.seat === seat) return true;
  if (!tiles.has(unit.y * map.width + unit.x)) return false;
  if (!hasTrait(unit.kind, "stealth")) return true;
  return state.units.some(
    (o) => o.seat === seat && distance(o, unit) <= STEALTH_RANGE && traceLine(map, o, unit).clear,
  );
}

/** Tiles where the seat may deploy: its base, and each command post it holds plus the open tiles beside it. */
export function spawnTiles(map: MapDef, state: Pick<GameState, "postOwners">, seat: Seat): Point[] {
  const tiles: Point[] = [...(map.bases[seat] ?? [])];
  state.postOwners.forEach((owner, i) => {
    const p = map.posts[i];
    if (owner !== seat || !p) return;
    tiles.push(p);
    for (const d of [DIRS[0]!, DIRS[2]!, DIRS[4]!, DIRS[6]!]) {
      const n = { x: p.x + d.x, y: p.y + d.y };
      if (isPassable(map, n.x, n.y) && stepOpen(map, p, n)) tiles.push(n);
    }
  });
  return tiles;
}

export const isSpawnTile = (map: MapDef, state: Pick<GameState, "postOwners">, seat: Seat, p: Point) =>
  spawnTiles(map, state, seat).some((t) => t.x === p.x && t.y === p.y);

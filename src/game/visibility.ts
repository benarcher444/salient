// Fog of war and spawn points: what each seat can see, and where it can deploy.
import { RULES } from "./constants.js";
import { distance } from "./grid.js";
import { traceLine, visibleFrom } from "./los.js";
import { UNITS, hasTrait, stealthRange } from "./units.js";
import type { GameState, MapDef, Point, Seat, Unit } from "./types.js";

/** A base tile and the seat whose base it is. */
export interface BaseTile extends Point {
  home: Seat;
}

/**
 * The base tiles in play: the bases of seats 0..seatCount-1, flattened in seat
 * order. `state.baseOwners[i]` is the owner of tile i. A four-seat map played
 * by two leaves the other two bases out of the game entirely.
 */
export function baseTiles(map: MapDef, seatCount: number): BaseTile[] {
  return map.bases.slice(0, seatCount).flatMap((tiles, home) => tiles.map((p) => ({ x: p.x, y: p.y, home })));
}

/** How many base tiles this seat owns, of any base. */
export const baseTilesOwned = (state: Pick<GameState, "baseOwners">, seat: Seat) => state.baseOwners.filter((o) => o === seat).length;

/** Tile indexes the seat can see: its units' sight plus a little around the sites it holds. */
export function visibleTiles(map: MapDef, state: GameState, seat: Seat): Set<number> {
  const seen = new Set<number>();
  for (const u of state.units) {
    if (u.seat === seat) visibleFrom(map, u, UNITS[u.kind].sight, seen);
  }
  baseTiles(map, state.seatCount).forEach((p, i) => {
    if (state.baseOwners[i] === seat) visibleFrom(map, p, RULES.siteSight, seen);
  });
  state.postOwners.forEach((owner, i) => {
    const p = map.posts[i];
    if (owner === seat && p) visibleFrom(map, p, RULES.siteSight, seen);
  });
  return seen;
}

/**
 * Can the seat see this unit? Its own units always; an enemy when it stands
 * on a visible tile — except a stealthy one, which must also be within
 * stealth range of one of the seat's units with a clear line to it.
 */
export function unitVisibleTo(map: MapDef, state: GameState, seat: Seat, unit: Unit, tiles: ReadonlySet<number>): boolean {
  if (unit.seat === seat) return true;
  if (!tiles.has(unit.y * map.width + unit.x)) return false;
  if (!hasTrait(unit.kind, "stealth")) return true;
  return state.units.some(
    (o) => o.seat === seat && distance(o, unit) <= stealthRange() && traceLine(map, o, unit).clear,
  );
}

export type SpawnState = Pick<GameState, "postOwners" | "baseOwners" | "seatCount">;

/**
 * Tiles where the seat may deploy: every base tile it owns (its own or one
 * taken from an enemy), and each command post it holds plus the open tiles
 * beside it.
 */
export function spawnTiles(map: MapDef, state: SpawnState, seat: Seat): Point[] {
  const tiles: Point[] = [];
  const seen = new Set<string>();
  const add = (p: Point) => {
    const k = `${p.x},${p.y}`;
    if (seen.has(k)) return;
    seen.add(k);
    tiles.push({ x: p.x, y: p.y });
  };
  baseTiles(map, state.seatCount).forEach((p, i) => {
    if (state.baseOwners[i] === seat) add(p);
  });
  // A post is a spawn point on its own tile only, not the tiles round it.
  state.postOwners.forEach((owner, i) => {
    const p = map.posts[i];
    if (owner === seat && p) add(p);
  });
  return tiles;
}

export const isSpawnTile = (map: MapDef, state: SpawnState, seat: Seat, p: Point) =>
  spawnTiles(map, state, seat).some((t) => t.x === p.x && t.y === p.y);

// Tiles, edges and directions: the geometry every other rule is built on.
import type { EdgeKind, Facing, MapDef, Point, Side, Terrain } from "./types.js";

export interface TerrainRules {
  label: string;
  /** Can a unit stand here? */
  passable: boolean;
  /** Movement cost multiplier when stepping onto it. */
  moveCost: number;
  /** Does it stop sight lines passing through it? */
  blocksSight: boolean;
  /** Does a unit next to (or in) it, on the shooter's line, count as in cover? */
  cover: boolean;
}

export const TERRAIN: Record<Terrain, TerrainRules> = {
  grass: { label: "Grass", passable: true, moveCost: 1, blocksSight: false, cover: false },
  road: { label: "Road", passable: true, moveCost: 1, blocksSight: false, cover: false },
  floor: { label: "Floor", passable: true, moveCost: 1, blocksSight: false, cover: false },
  forest: { label: "Woods", passable: true, moveCost: 2, blocksSight: false, cover: true },
  rock: { label: "Rock", passable: false, moveCost: 1, blocksSight: true, cover: false },
  water: { label: "Water", passable: false, moveCost: 1, blocksSight: false, cover: false },
  crate: { label: "Crates", passable: false, moveCost: 1, blocksSight: false, cover: true },
};

export const EDGE_LABEL: Record<EdgeKind, string> = {
  wall: "Wall",
  window: "Window",
  door: "Doorway",
};

/** Walls stop everything; windows stop feet but not bullets; doorways stop nothing. */
export const edgeBlocksMove = (e: EdgeKind | null) => e === "wall" || e === "window";
export const edgeBlocksSight = (e: EdgeKind | null) => e === "wall";

/** Unit vectors for each facing, 0 = north, clockwise. */
export const DIRS: readonly Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

export const FACING_NAME = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

export function inBounds(map: MapDef, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function terrainAt(map: MapDef, x: number, y: number): Terrain {
  const t = map.terrain[y * map.width + x];
  if (t === undefined) throw new Error(`terrainAt out of bounds: ${x},${y}`);
  return t;
}

export function isPassable(map: MapDef, x: number, y: number): boolean {
  return inBounds(map, x, y) && TERRAIN[terrainAt(map, x, y)].passable;
}

export function hEdge(map: MapDef, x: number, y: number): EdgeKind | null {
  return map.hEdges[y * map.width + x] ?? null;
}

export function vEdge(map: MapDef, x: number, y: number): EdgeKind | null {
  return map.vEdges[y * (map.width + 1) + x] ?? null;
}

/** The edge on one side of a tile. */
export function edgeAt(map: MapDef, x: number, y: number, side: Side): EdgeKind | null {
  switch (side) {
    case "n":
      return hEdge(map, x, y);
    case "s":
      return hEdge(map, x, y + 1);
    case "w":
      return vEdge(map, x, y);
    case "e":
      return vEdge(map, x + 1, y);
  }
}

/** The edge between two orthogonally adjacent tiles. */
export function edgeBetween(map: MapDef, a: Point, b: Point): EdgeKind | null {
  if (b.x === a.x + 1 && b.y === a.y) return vEdge(map, b.x, a.y);
  if (b.x === a.x - 1 && b.y === a.y) return vEdge(map, a.x, a.y);
  if (b.y === a.y + 1 && b.x === a.x) return hEdge(map, a.x, b.y);
  if (b.y === a.y - 1 && b.x === a.x) return hEdge(map, a.x, a.y);
  throw new Error(`edgeBetween: tiles not orthogonally adjacent: ${a.x},${a.y} ${b.x},${b.y}`);
}

/** Can a unit step orthogonally from a to b, ignoring other units? */
function orthogonalStepOpen(map: MapDef, a: Point, b: Point): boolean {
  return isPassable(map, b.x, b.y) && !edgeBlocksMove(edgeBetween(map, a, b));
}

/**
 * Can a unit step from a to an adjacent tile b (8 directions), ignoring units?
 *
 * A diagonal step is allowed only when BOTH orthogonal two-step routes around
 * the corner are open. Otherwise a unit could slip diagonally through the
 * point where two walls meet, or squeeze between two boulders.
 */
export function stepOpen(map: MapDef, a: Point, b: Point): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return false;
  if (!isPassable(map, b.x, b.y)) return false;
  if (dx === 0 || dy === 0) return orthogonalStepOpen(map, a, b);
  const viaX = { x: b.x, y: a.y };
  const viaY = { x: a.x, y: b.y };
  return (
    orthogonalStepOpen(map, a, viaX) &&
    orthogonalStepOpen(map, viaX, b) &&
    orthogonalStepOpen(map, a, viaY) &&
    orthogonalStepOpen(map, viaY, b)
  );
}

/**
 * Cost of one step, in half-tiles so diagonals stay whole numbers: an
 * orthogonal step is 2, a diagonal 3 (about 1.5 tiles), doubled into woods.
 */
export function stepCost(map: MapDef, a: Point, b: Point): number {
  const diagonal = a.x !== b.x && a.y !== b.y;
  return (diagonal ? 3 : 2) * TERRAIN[terrainAt(map, b.x, b.y)].moveCost;
}

/** A facing in whole degrees, 0..359: any number of degrees, wrapped and rounded. */
export function normFacing(deg: number): Facing {
  return ((Math.round(deg) % 360) + 360) % 360;
}

/** The facing that points from a towards b, to the nearest degree. */
export function facingToward(a: Point, b: Point): Facing {
  const angle = Math.atan2(b.x - a.x, -(b.y - a.y)); // 0 = north, clockwise positive
  return normFacing((angle * 180) / Math.PI);
}

/** Angle of a facing in radians, 0 = north, clockwise. */
export function facingAngle(f: Facing): number {
  return (f * Math.PI) / 180;
}

/** The nearest compass point, in words, for a facing. */
export const facingName = (f: Facing) => FACING_NAME[Math.round(normFacing(f) / 45) % 8]!;

/** Smallest angle between two bearings, in degrees, 0..180. */
export function angleBetweenDeg(a: number, b: number): number {
  let d = Math.abs(a - b) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return (d * 180) / Math.PI;
}

/** Bearing from a to b in radians, 0 = north, clockwise. */
export function bearing(a: Point, b: Point): number {
  return Math.atan2(b.x - a.x, -(b.y - a.y));
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
export const key = (p: Point) => `${p.x},${p.y}`;

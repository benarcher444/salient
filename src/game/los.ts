// Line of sight between tile centres, and what the line passes through.
import { TERRAIN, hEdge, inBounds, terrainAt, vEdge } from "./grid.js";
import type { EdgeKind, MapDef, Point } from "./types.js";

/** Something the line passed through that does not block it but softens a shot. */
export interface Obstacle {
  kind: "window" | "crate" | "forest";
  /** A point on the obstacle: the tile for terrain, the far tile for an edge. */
  at: Point;
}

export interface SightLine {
  clear: boolean;
  obstacles: Obstacle[];
}

const BLOCKED: SightLine = { clear: false, obstacles: [] };

/**
 * Trace the straight line from the centre of tile `a` to the centre of tile `b`.
 *
 * The walk visits every tile edge the line crosses, in order (a grid traversal
 * done in integer arithmetic). Floating point is avoided on purpose: lines
 * between tile centres very often pass exactly through a tile corner, and a
 * rounding error there decides whether you can see round a building.
 *
 * Exact corner crossings use the rule in `cornerBlocks`.
 */
export function traceLine(map: MapDef, a: Point, b: Point): SightLine {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const obstacles: Obstacle[] = [];
  let x = a.x;
  let y = a.y;
  let crossedX = 0; // vertical grid lines crossed so far
  let crossedY = 0; // horizontal grid lines crossed so far

  while (x !== b.x || y !== b.y) {
    // The next vertical line is crossed at t = (2*crossedX + 1) / (2*adx),
    // the next horizontal one at t = (2*crossedY + 1) / (2*ady). Comparing
    // the cross-multiplied numerators says which comes first, exactly.
    let cmp: number;
    if (adx === 0) cmp = 1;
    else if (ady === 0) cmp = -1;
    else cmp = (2 * crossedX + 1) * ady - (2 * crossedY + 1) * adx;

    if (cmp < 0) {
      const edge = vEdge(map, sx > 0 ? x + 1 : x, y);
      if (!noteEdge(edge, { x: x + sx, y }, obstacles)) return BLOCKED;
      x += sx;
      crossedX++;
    } else if (cmp > 0) {
      const edge = hEdge(map, x, sy > 0 ? y + 1 : y);
      if (!noteEdge(edge, { x, y: y + sy }, obstacles)) return BLOCKED;
      y += sy;
      crossedY++;
    } else {
      const corner = cornerBlocks(map, x, y, sx, sy);
      if (corner === "blocked") return BLOCKED;
      if (corner === "window") obstacles.push({ kind: "window", at: { x: x + sx, y: y + sy } });
      x += sx;
      y += sy;
      crossedX++;
      crossedY++;
    }

    // Terrain of the tile just entered. The destination itself never blocks:
    // you can see the face of a rock, and a unit is never standing in one.
    if (x === b.x && y === b.y) break;
    if (!inBounds(map, x, y)) return BLOCKED;
    const t = terrainAt(map, x, y);
    if (TERRAIN[t].blocksSight) return BLOCKED;
    if (t === "crate" || t === "forest") obstacles.push({ kind: t, at: { x, y } });
  }
  return { clear: true, obstacles };
}

function noteEdge(edge: EdgeKind | null, beyond: Point, obstacles: Obstacle[]): boolean {
  if (edge === "wall") return false;
  if (edge === "window") obstacles.push({ kind: "window", at: beyond });
  return true;
}

/**
 * The line passes exactly through the corner shared by four tiles. Name the
 * four half-edges meeting there: up, down, left and right of the corner point.
 * The line goes from one quadrant to the diagonally opposite one, so it is
 * stopped only when walls at the corner separate those two quadrants — that
 * is, when (one of the two half-edges bounding the start quadrant's far side)
 * AND (one bounding the end quadrant's far side) are walls. A single wall
 * ending at the corner only grazes the line, and does not stop it; an L of two
 * walls (a room corner) or a straight wall does.
 *
 * Two sight-blocking tiles touching diagonally across the line (two boulders)
 * also stop it.
 */
function cornerBlocks(map: MapDef, x: number, y: number, sx: number, sy: number): "clear" | "window" | "blocked" {
  const cx = sx > 0 ? x + 1 : x; // corner point, in grid-line coordinates
  const cy = sy > 0 ? y + 1 : y;
  const up = vEdge(map, cx, cy - 1); // vertical line above the corner
  const down = vEdge(map, cx, cy);
  const left = hEdge(map, cx - 1, cy); // horizontal line left of the corner
  const right = hEdge(map, cx, cy);

  // Each diagonal pair of quadrants is separated by one of two pairs of
  // half-edges. Going towards +x+y (or -x-y) the separating sets are
  // {up, left} on one side and {down, right} on the other; for the other
  // diagonal they are {up, right} and {down, left}.
  const [a1, a2, b1, b2] = sx === sy ? [up, right, down, left] : [up, left, down, right];
  const sideA = (k: EdgeKind) => a1 === k || a2 === k;
  const sideB = (k: EdgeKind) => b1 === k || b2 === k;
  if (sideA("wall") && sideB("wall")) return "blocked";

  const side1 = { x: x + sx, y };
  const side2 = { x, y: y + sy };
  if (inBounds(map, side1.x, side1.y) && inBounds(map, side2.x, side2.y)) {
    if (TERRAIN[terrainAt(map, side1.x, side1.y)].blocksSight && TERRAIN[terrainAt(map, side2.x, side2.y)].blocksSight) {
      return "blocked";
    }
  }

  const solidA = (k: EdgeKind) => sideA(k) || sideA("wall");
  const solidB = (k: EdgeKind) => sideB(k) || sideB("wall");
  if (solidA("window") && solidB("window")) return "window";
  return "clear";
}

/** Tiles within `radius` of `from` that it has a clear line to. */
export function visibleFrom(map: MapDef, from: Point, radius: number, into: Set<number>): void {
  const r = Math.ceil(radius);
  for (let y = from.y - r; y <= from.y + r; y++) {
    for (let x = from.x - r; x <= from.x + r; x++) {
      if (!inBounds(map, x, y)) continue;
      const idx = y * map.width + x;
      if (into.has(idx)) continue;
      if (Math.hypot(x - from.x, y - from.y) > radius) continue;
      if (traceLine(map, from, { x, y }).clear) into.add(idx);
    }
  }
}

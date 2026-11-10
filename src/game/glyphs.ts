// The symbol for each unit class, as SVG path data on a 24x24 grid, stroked.
// The same strings draw the inline SVG on server-rendered pages and, through
// Path2D, the tokens on the battle canvas, so a class looks the same
// everywhere. Not rules, but shared by both sides for the same reason.
import type { UnitKind } from "./types.js";

export const UNIT_GLYPH: Record<UnitKind, string> = {
  rifleman: "M5 11l7-5 7 5M5 17l7-5 7 5",
  scout: "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6zM12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z",
  engineer: "M14.5 5.5a4 4 0 0 0-5 5l-5 5a1.8 1.8 0 0 0 2.5 2.5l5-5a4 4 0 0 0 5-5l-2.5 2.5-2.2-.3-.3-2.2z",
  heavy: "M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9zM12 8.5v7M8.5 12h7",
  sniper: "M12 5a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM12 2v6M12 16v6M2 12h6M16 12h6",
  riot: "M12 3l7 2.8V11c0 4.8-3 8.2-7 10-4-1.8-7-5.2-7-10V5.8zM12 7v10",
  commando: "M4.5 19.5l9.5-9.5M14 10l2-6 4 4-6 2M4.5 19.5l2.5.5-.5-2.5",
  shotgun: "M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3.2 3.2M14.8 14.8L18 18M18 6l-3.2 3.2M9.2 14.8L6 18",
  healer: "M12 19.5s-7.5-4.6-7.5-10a4 4 0 0 1 7.5-2 4 4 0 0 1 7.5 2c0 5.4-7.5 10-7.5 10z",
  officer: "M12 3.5l2.5 5.3 5.8.7-4.3 4 1.1 5.8L12 16.5l-5.1 2.8 1.1-5.8-4.3-4 5.8-.7z",
};

export function glyphSvg(kind: UnitKind, cls = "glyph"): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${UNIT_GLYPH[kind]}"/></svg>`;
}

/**
 * Each class has its own silhouette, so units can be told apart at a glance
 * before reading the symbol. Points are on a circle of radius 1 with the unit
 * facing up (north, -y); the board turns the shape to the unit's facing, so
 * the asymmetric ones point the way the unit looks. `null` is a circle.
 */
export const UNIT_SHAPE: Record<UnitKind, readonly (readonly [number, number])[] | null> = {
  rifleman: null,
  scout: [
    [0, -1.3],
    [0.7, -0.1],
    [0, 0.9],
    [-0.7, -0.1],
  ],
  engineer: gear(8, 1.02, 0.8),
  heavy: polygon(6, 1.04, 0),
  sniper: [
    [0, -1.22],
    [0.98, 0.78],
    [-0.98, 0.78],
  ],
  riot: [
    [-1, -0.72],
    [1, -0.72],
    [0.96, 0.2],
    [0.52, 0.8],
    [0, 1.02],
    [-0.52, 0.8],
    [-0.96, 0.2],
  ],
  commando: [
    [0, -1.22],
    [0.94, 0.88],
    [0, 0.42],
    [-0.94, 0.88],
  ],
  shotgun: [
    [-0.62, -0.88],
    [0.62, -0.88],
    [0.88, -0.62],
    [0.88, 0.62],
    [0.62, 0.88],
    [-0.62, 0.88],
    [-0.88, 0.62],
    [-0.88, -0.62],
  ],
  healer: [
    [-0.34, -1],
    [0.34, -1],
    [0.34, -0.34],
    [1, -0.34],
    [1, 0.34],
    [0.34, 0.34],
    [0.34, 1],
    [-0.34, 1],
    [-0.34, 0.34],
    [-1, 0.34],
    [-1, -0.34],
    [-0.34, -0.34],
  ],
  officer: star(5, 1.18, 0.62),
};

/** Token size relative to a rifleman: big units look big. */
export const UNIT_SIZE: Record<UnitKind, number> = {
  rifleman: 1,
  scout: 0.86,
  engineer: 0.95,
  heavy: 1.18,
  sniper: 0.95,
  riot: 1.1,
  commando: 0.9,
  shotgun: 1.02,
  healer: 0.95,
  officer: 1.02,
};

/** How far the shape reaches forward, as a multiple of its radius (where the facing arrow starts). */
export const shapeFront = (kind: UnitKind) => {
  const pts = UNIT_SHAPE[kind];
  return pts ? Math.max(...pts.map(([, y]) => -y)) : 1;
};

function polygon(n: number, r: number, offset: number): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const a = offset + (i / n) * Math.PI * 2 - Math.PI / 2;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
}

function star(points: number, outer: number, inner: number): [number, number][] {
  return Array.from({ length: points * 2 }, (_, i) => {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? inner : outer;
    return [Math.cos(a) * r, Math.sin(a) * r] as [number, number];
  });
}

function gear(teeth: number, outer: number, inner: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 4 < 2 ? outer : inner;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

/** The silhouette as SVG path data, facing up, radius 1. */
export function shapePathData(kind: UnitKind): string {
  const pts = UNIT_SHAPE[kind];
  if (!pts) return "M1 0A1 1 0 1 1 -1 0A1 1 0 1 1 1 0Z";
  return `M${pts.map(([x, y]) => `${x.toFixed(3)} ${y.toFixed(3)}`).join("L")}Z`;
}

/**
 * A unit's badge for pages and the side panel: its silhouette in the seat
 * colour (CSS `--badge`) with the class symbol on top, matching the board.
 */
export function unitBadgeSvg(kind: UnitKind): string {
  const k = 1 / 1.25;
  return `<svg class="badge-svg" viewBox="-1.32 -1.32 2.64 2.64" aria-hidden="true"><path class="badge-body" d="${shapePathData(kind)}" transform="scale(${(UNIT_SIZE[kind] * 1.0).toFixed(2)})"/><g transform="translate(${(-0.6 * k).toFixed(3)} ${(-0.6 * k).toFixed(3)}) scale(${((1.2 * k) / 24).toFixed(4)})"><path d="${UNIT_GLYPH[kind]}" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
}

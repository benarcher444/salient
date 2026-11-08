// The static map art: ground, buildings, trees, rocks, water. Drawn once per
// map and theme into an offscreen canvas, then scaled onto the board every
// frame. Everything is procedural, seeded per tile, so there are no image
// files to load and the same map always looks the same.
import { inBounds } from "../game/grid.js";
import type { EdgeKind, MapDef, Terrain } from "../game/types.js";
import { alpha, shade, tileNoise, type Palette } from "./palette.js";

/** Pixels per tile in the cached art. High enough to stay crisp when zoomed in. */
export const ART_PX = 72;

const terrainAt = (map: MapDef, x: number, y: number): Terrain | null =>
  inBounds(map, x, y) ? map.terrain[y * map.width + x]! : null;

/** What a tile's ground looks like under whatever stands on it. */
function groundOf(map: MapDef, x: number, y: number): "grass" | "road" | "floor" | "water" {
  const t = terrainAt(map, x, y)!;
  if (t === "road" || t === "floor" || t === "water" || t === "grass") return t;
  // Crates and the like inside a building sit on the floor.
  const floors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ].filter(([dx, dy]) => terrainAt(map, x + dx!, y + dy!) === "floor").length;
  return floors >= 2 ? "floor" : "grass";
}

/** `px` pixels per tile: the editor draws smaller, since it redraws on every stroke. */
export function renderMapArt(map: MapDef, pal: Palette, px = ART_PX): HTMLCanvasElement {
  const T = px;
  const canvas = document.createElement("canvas");
  canvas.width = map.width * T;
  canvas.height = map.height * T;
  const g = canvas.getContext("2d")!;
  g.lineCap = "round";
  g.lineJoin = "round";

  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) drawGround(g, map, pal, x, y, T);
  drawGrid(g, map, pal, T);
  drawBases(g, map, pal, T);
  drawEdgeShadows(g, map, pal, T);
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      const t = terrainAt(map, x, y);
      if (t === "crate") drawCrate(g, pal, x, y, T);
      if (t === "rock") drawRock(g, pal, x, y, T);
    }
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (terrainAt(map, x, y) === "forest") drawTrees(g, pal, x, y, T);
  drawEdges(g, map, pal, T);
  return canvas;
}

function drawGround(g: CanvasRenderingContext2D, map: MapDef, pal: Palette, x: number, y: number, T: number) {
  const px = x * T;
  const py = y * T;
  const ground = groundOf(map, x, y);
  const n = tileNoise(x, y);

  if (ground === "grass") {
    g.fillStyle = shade(pal.grass, (n - 0.5) * 0.07);
    g.fillRect(px, py, T, T);
    // Tufts: a few short strokes, darker and lighter than the ground.
    for (let i = 0; i < 6; i++) {
      const tx = px + tileNoise(x, y, i * 3 + 1) * T;
      const ty = py + tileNoise(x, y, i * 3 + 2) * T;
      const light = tileNoise(x, y, i * 3 + 3) > 0.5;
      g.strokeStyle = shade(pal.grass, light ? 0.12 : -0.14);
      g.lineWidth = T * 0.022;
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(tx - T * 0.03, ty - T * 0.07);
      g.moveTo(tx + T * 0.03, ty);
      g.lineTo(tx + T * 0.05, ty - T * 0.06);
      g.stroke();
    }
  } else if (ground === "road") {
    g.fillStyle = shade(pal.road, (n - 0.5) * 0.05);
    g.fillRect(px, py, T, T);
    for (let i = 0; i < 7; i++) {
      g.fillStyle = shade(pal.road, tileNoise(x, y, i + 40) > 0.5 ? -0.12 : 0.1);
      g.beginPath();
      g.arc(px + tileNoise(x, y, i + 10) * T, py + tileNoise(x, y, i + 20) * T, T * (0.012 + tileNoise(x, y, i + 30) * 0.02), 0, Math.PI * 2);
      g.fill();
    }
    // A darker verge where the road meets something else.
    g.strokeStyle = shade(pal.road, -0.16);
    g.lineWidth = T * 0.05;
    const edge = (dx: number, dy: number, x1: number, y1: number, x2: number, y2: number) => {
      const t = terrainAt(map, x + dx, y + dy);
      if (t !== null && t !== "road") {
        g.beginPath();
        g.moveTo(px + x1 * T, py + y1 * T);
        g.lineTo(px + x2 * T, py + y2 * T);
        g.stroke();
      }
    };
    edge(0, -1, 0, 0.03, 1, 0.03);
    edge(0, 1, 0, 0.97, 1, 0.97);
    edge(-1, 0, 0.03, 0, 0.03, 1);
    edge(1, 0, 0.97, 0, 0.97, 1);
  } else if (ground === "floor") {
    g.fillStyle = shade(pal.floor, (n - 0.5) * 0.04);
    g.fillRect(px, py, T, T);
    // Planks: four boards per tile with staggered joints.
    g.strokeStyle = shade(pal.floor, -0.13);
    g.lineWidth = T * 0.018;
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      g.moveTo(px, py + (i * T) / 4);
      g.lineTo(px + T, py + (i * T) / 4);
      g.stroke();
    }
    for (let i = 0; i < 4; i++) {
      const jx = px + (0.2 + tileNoise(x, y, i + 50) * 0.6) * T;
      g.beginPath();
      g.moveTo(jx, py + (i * T) / 4);
      g.lineTo(jx, py + ((i + 1) * T) / 4);
      g.stroke();
    }
  } else {
    // Water: deeper towards the middle of a body of water, foam at the shore.
    const gradient = g.createLinearGradient(px, py, px + T, py + T);
    gradient.addColorStop(0, shade(pal.water, 0.04));
    gradient.addColorStop(1, shade(pal.water, -0.06));
    g.fillStyle = gradient;
    g.fillRect(px, py, T, T);
    g.strokeStyle = alpha("#ffffff", 0.28);
    g.lineWidth = T * 0.025;
    for (let i = 0; i < 2; i++) {
      const cx = px + (0.25 + tileNoise(x, y, i + 60) * 0.5) * T;
      const cy = py + (0.25 + tileNoise(x, y, i + 70) * 0.5) * T;
      g.beginPath();
      g.arc(cx, cy, T * 0.1, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
    }
    g.strokeStyle = alpha("#ffffff", 0.45);
    g.lineWidth = T * 0.06;
    const shore = (dx: number, dy: number, x1: number, y1: number, x2: number, y2: number) => {
      const t = terrainAt(map, x + dx, y + dy);
      if (t !== null && t !== "water") {
        g.beginPath();
        g.moveTo(px + x1 * T, py + y1 * T);
        g.lineTo(px + x2 * T, py + y2 * T);
        g.stroke();
      }
    };
    shore(0, -1, 0, 0.03, 1, 0.03);
    shore(0, 1, 0, 0.97, 1, 0.97);
    shore(-1, 0, 0.03, 0, 0.03, 1);
    shore(1, 0, 0.97, 0, 0.97, 1);
  }
}

function drawGrid(g: CanvasRenderingContext2D, map: MapDef, pal: Palette, T: number) {
  g.strokeStyle = pal.grid;
  g.lineWidth = Math.max(1, T * 0.012);
  g.beginPath();
  for (let x = 1; x < map.width; x++) {
    g.moveTo(x * T, 0);
    g.lineTo(x * T, map.height * T);
  }
  for (let y = 1; y < map.height; y++) {
    g.moveTo(0, y * T);
    g.lineTo(map.width * T, y * T);
  }
  g.stroke();
}

function drawBases(g: CanvasRenderingContext2D, map: MapDef, pal: Palette, T: number) {
  map.bases.forEach((tiles, seat) => {
    const colour = pal.seats[seat]!;
    const inBase = (x: number, y: number) => tiles.some((p) => p.x === x && p.y === y);
    for (const p of tiles) {
      const px = p.x * T;
      const py = p.y * T;
      g.fillStyle = alpha(colour, 0.22);
      g.fillRect(px, py, T, T);
      g.save();
      g.beginPath();
      g.rect(px, py, T, T);
      g.clip();
      g.strokeStyle = alpha(colour, 0.3);
      g.lineWidth = T * 0.05;
      for (let i = -1; i < 4; i++) {
        g.beginPath();
        g.moveTo(px + (i * T) / 3, py + T);
        g.lineTo(px + (i * T) / 3 + T, py);
        g.stroke();
      }
      g.restore();
      // Outline the outside of the base region only.
      g.strokeStyle = alpha(colour, 0.85);
      g.lineWidth = T * 0.06;
      g.lineCap = "square";
      const side = (dx: number, dy: number, x1: number, y1: number, x2: number, y2: number) => {
        if (inBase(p.x + dx, p.y + dy)) return;
        g.beginPath();
        g.moveTo(px + x1 * T, py + y1 * T);
        g.lineTo(px + x2 * T, py + y2 * T);
        g.stroke();
      };
      side(0, -1, 0, 0.04, 1, 0.04);
      side(0, 1, 0, 0.96, 1, 0.96);
      side(-1, 0, 0.04, 0, 0.04, 1);
      side(1, 0, 0.96, 0, 0.96, 1);
      g.lineCap = "round";
    }
  });
}

interface EdgeSeg {
  kind: EdgeKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Is there a floor tile on either side? Windows indoors are glass, outdoors sandbags. */
  indoor: boolean;
}

function edgeSegments(map: MapDef): EdgeSeg[] {
  const segs: EdgeSeg[] = [];
  const isFloor = (x: number, y: number) => terrainAt(map, x, y) === "floor";
  for (let y = 0; y <= map.height; y++)
    for (let x = 0; x < map.width; x++) {
      const kind = map.hEdges[y * map.width + x];
      if (kind) segs.push({ kind, x1: x, y1: y, x2: x + 1, y2: y, indoor: isFloor(x, y - 1) || isFloor(x, y) });
    }
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x <= map.width; x++) {
      const kind = map.vEdges[y * (map.width + 1) + x];
      if (kind) segs.push({ kind, x1: x, y1: y, x2: x, y2: y + 1, indoor: isFloor(x - 1, y) || isFloor(x, y) });
    }
  return segs;
}

function drawEdgeShadows(g: CanvasRenderingContext2D, map: MapDef, pal: Palette, T: number) {
  g.strokeStyle = pal.shadow;
  for (const s of edgeSegments(map)) {
    if (s.kind === "door") continue;
    g.lineWidth = T * (s.kind === "wall" ? 0.2 : 0.14);
    g.beginPath();
    g.moveTo(s.x1 * T + T * 0.07, s.y1 * T + T * 0.09);
    g.lineTo(s.x2 * T + T * 0.07, s.y2 * T + T * 0.09);
    g.stroke();
  }
}

function drawEdges(g: CanvasRenderingContext2D, map: MapDef, pal: Palette, T: number) {
  const segs = edgeSegments(map);
  const line = (s: EdgeSeg, from: number, to: number) => {
    g.beginPath();
    g.moveTo((s.x1 + (s.x2 - s.x1) * from) * T, (s.y1 + (s.y2 - s.y1) * from) * T);
    g.lineTo((s.x1 + (s.x2 - s.x1) * to) * T, (s.y1 + (s.y2 - s.y1) * to) * T);
    g.stroke();
  };

  // Walls: one thick dark stroke with round caps (so corners join cleanly),
  // then a thin lighter one along the top for a little depth.
  g.strokeStyle = pal.wall;
  g.lineWidth = T * 0.17;
  for (const s of segs) if (s.kind === "wall" || (s.kind === "window" && s.indoor)) line(s, 0, s.kind === "window" ? 0.22 : 1);
  for (const s of segs) if (s.kind === "window" && s.indoor) line(s, 0.78, 1);
  g.strokeStyle = shade(pal.wall, 0.22);
  g.lineWidth = T * 0.05;
  for (const s of segs) if (s.kind === "wall") line(s, 0.08, 0.92);

  for (const s of segs) {
    if (s.kind === "window" && s.indoor) {
      g.strokeStyle = pal.window;
      g.lineWidth = T * 0.09;
      line(s, 0.2, 0.8);
      g.strokeStyle = alpha("#ffffff", 0.7);
      g.lineWidth = T * 0.025;
      line(s, 0.3, 0.55);
    } else if (s.kind === "window") {
      // Out in the open a window edge is a low wall of sandbags.
      const n = 3;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const cx = (s.x1 + (s.x2 - s.x1) * t) * T;
        const cy = (s.y1 + (s.y2 - s.y1) * t) * T;
        const horizontal = s.y1 === s.y2;
        const w = (horizontal ? T / n : T * 0.2) * 0.92;
        const h = (horizontal ? T * 0.2 : T / n) * 0.92;
        g.fillStyle = shade(pal.sandbag, (tileNoise(s.x1 + i, s.y1, 90) - 0.5) * 0.12);
        g.strokeStyle = shade(pal.sandbag, -0.3);
        g.lineWidth = T * 0.018;
        roundRect(g, cx - w / 2, cy - h / 2, w, h, T * 0.06);
        g.fill();
        g.stroke();
      }
    } else if (s.kind === "door") {
      // Door frames: a jamb at each end and a faint threshold between.
      g.strokeStyle = pal.wall;
      g.lineWidth = T * 0.17;
      line(s, 0, 0.12);
      line(s, 0.88, 1);
      g.strokeStyle = alpha(pal.door, 0.75);
      g.lineWidth = T * 0.05;
      line(s, 0.18, 0.82);
    }
  }

  // A frame around the whole map.
  g.strokeStyle = shade(pal.wall, -0.1);
  g.lineWidth = T * 0.08;
  g.strokeRect(T * 0.04, T * 0.04, map.width * T - T * 0.08, map.height * T - T * 0.08);
}

function drawCrate(g: CanvasRenderingContext2D, pal: Palette, x: number, y: number, T: number) {
  const s = T * 0.72;
  const px = x * T + (T - s) / 2;
  const py = y * T + (T - s) / 2;
  g.fillStyle = pal.shadow;
  roundRect(g, px + T * 0.06, py + T * 0.08, s, s, T * 0.06);
  g.fill();
  g.fillStyle = shade(pal.crate, (tileNoise(x, y, 7) - 0.5) * 0.1);
  roundRect(g, px, py, s, s, T * 0.06);
  g.fill();
  g.strokeStyle = shade(pal.crate, -0.35);
  g.lineWidth = T * 0.04;
  g.stroke();
  g.lineWidth = T * 0.035;
  g.beginPath();
  g.moveTo(px + s * 0.12, py + s * 0.12);
  g.lineTo(px + s * 0.88, py + s * 0.88);
  g.moveTo(px + s * 0.88, py + s * 0.12);
  g.lineTo(px + s * 0.12, py + s * 0.88);
  g.stroke();
  g.strokeStyle = alpha("#ffffff", 0.22);
  g.lineWidth = T * 0.03;
  g.beginPath();
  g.moveTo(px + s * 0.1, py + s * 0.06);
  g.lineTo(px + s * 0.9, py + s * 0.06);
  g.stroke();
}

function drawRock(g: CanvasRenderingContext2D, pal: Palette, x: number, y: number, T: number) {
  const boulders = 2 + Math.floor(tileNoise(x, y, 3) * 2);
  for (let b = 0; b < boulders; b++) {
    const cx = x * T + (0.3 + tileNoise(x, y, b + 100) * 0.4) * T;
    const cy = y * T + (0.3 + tileNoise(x, y, b + 110) * 0.4) * T;
    const r = T * (b === 0 ? 0.42 : 0.24 + tileNoise(x, y, b + 120) * 0.1);
    const points: [number, number][] = [];
    const sides = 7;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + tileNoise(x, y, b * 10 + i) * 0.5;
      const rr = r * (0.78 + tileNoise(x, y, b * 10 + i + 200) * 0.3);
      points.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    const poly = (dx: number, dy: number) => {
      g.beginPath();
      points.forEach(([px, py], i) => (i === 0 ? g.moveTo(px + dx, py + dy) : g.lineTo(px + dx, py + dy)));
      g.closePath();
    };
    g.fillStyle = pal.shadow;
    poly(T * 0.06, T * 0.08);
    g.fill();
    const grad = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    grad.addColorStop(0, shade(pal.rock, 0.22));
    grad.addColorStop(1, shade(pal.rock, -0.2));
    g.fillStyle = grad;
    poly(0, 0);
    g.fill();
    g.strokeStyle = shade(pal.rock, -0.35);
    g.lineWidth = T * 0.02;
    g.stroke();
  }
}

function drawTrees(g: CanvasRenderingContext2D, pal: Palette, x: number, y: number, T: number) {
  const trees = 2 + Math.floor(tileNoise(x, y, 5) * 2);
  for (let i = 0; i < trees; i++) {
    const cx = x * T + (0.22 + tileNoise(x, y, i + 300) * 0.56) * T;
    const cy = y * T + (0.22 + tileNoise(x, y, i + 310) * 0.56) * T;
    const r = T * (0.26 + tileNoise(x, y, i + 320) * 0.12);
    g.fillStyle = pal.shadow;
    g.beginPath();
    g.arc(cx + T * 0.07, cy + T * 0.09, r, 0, Math.PI * 2);
    g.fill();
    const grad = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    grad.addColorStop(0, shade(pal.forest, 0.25));
    grad.addColorStop(1, shade(pal.forest, -0.18));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = shade(pal.forest, -0.25);
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      g.arc(cx + (tileNoise(x, y, i * 7 + k + 400) - 0.5) * r, cy + (tileNoise(x, y, i * 7 + k + 410) - 0.3) * r, r * 0.12, 0, Math.PI * 2);
      g.fill();
    }
  }
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

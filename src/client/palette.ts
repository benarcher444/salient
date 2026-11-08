// Board colours, read from the stylesheet's custom properties so the canvas
// follows light and dark exactly as the HTML does. Re-read when the theme
// changes; nothing on the canvas names a colour of its own.

export interface Palette {
  grass: string;
  road: string;
  floor: string;
  forest: string;
  rock: string;
  water: string;
  crate: string;
  wall: string;
  window: string;
  sandbag: string;
  door: string;
  grid: string;
  fog: string;
  shadow: string;
  post: string;
  income: string;
  reach: string;
  path: string;
  danger: string;
  ok: string;
  warn: string;
  ink: string;
  paper: string;
  seats: string[];
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#ff00ff";

export function readPalette(): Palette {
  return {
    grass: css("--t-grass"),
    road: css("--t-road"),
    floor: css("--t-floor"),
    forest: css("--t-forest"),
    rock: css("--t-rock"),
    water: css("--t-water"),
    crate: css("--t-crate"),
    wall: css("--t-wall"),
    window: css("--t-window"),
    sandbag: css("--t-sandbag"),
    door: css("--t-door"),
    grid: css("--t-grid"),
    fog: css("--fog"),
    shadow: css("--board-shadow"),
    post: css("--site-post"),
    income: css("--site-income"),
    reach: css("--board-reach"),
    path: css("--board-path"),
    danger: css("--danger"),
    ok: css("--ok"),
    warn: css("--warn-fill"),
    ink: css("--board-ink"),
    paper: css("--board-paper"),
    seats: [css("--seat-0"), css("--seat-1"), css("--seat-2"), css("--seat-3")],
  };
}

// --- Colour arithmetic for procedural variation -------------------------------

export function rgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Lighten (amount > 0) or darken (amount < 0) towards white or black, amount in -1..1. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = rgb(hex);
  const t = amount > 0 ? 255 : 0;
  const a = Math.abs(amount);
  const mix = (c: number) => Math.round(c + (t - c) * a);
  return `rgb(${mix(r)} ${mix(g)} ${mix(b)})`;
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgb(${r} ${g} ${b} / ${a})`;
}

/** Deterministic noise per tile, so the art is the same on every redraw. */
export function tileNoise(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

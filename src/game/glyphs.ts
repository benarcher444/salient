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
  breacher: "M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3.2 3.2M14.8 14.8L18 18M18 6l-3.2 3.2M9.2 14.8L6 18",
};

export function glyphSvg(kind: UnitKind, cls = "glyph"): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${UNIT_GLYPH[kind]}"/></svg>`;
}

// The battle's keyboard controls, listed once: the key help on the battle page
// and the How to play page both render this list. (The handling itself is in
// src/client/game.ts; change both together.) Not rules, but shared by the
// server's pages and the browser, like the glyphs.

export const KEY_HELP: readonly { keys: string[]; what: string }[] = [
  { keys: ["←", "↑", "→", "↓"], what: "Move the cursor (or W A S D). Hold Shift for 3 tiles." },
  { keys: ["Enter"], what: "Act on the cursor's tile, as a tap: select, move there, aim, fire." },
  { keys: ["1", "–", "8"], what: "Deploy that unit on the base tile under the cursor (the shop's order)." },
  { keys: ["Q", "E"], what: "Turn the selected unit or deployment left or right." },
  { keys: ["Tab"], what: "Next unit of yours. In the attack phase, next unit that can fire." },
  { keys: ["1", "–", "9"], what: "Attack phase: aim at that target in the list. T cycles targets." },
  { keys: ["F"], what: "Fire at the chosen target. H holds fire with the unit." },
  { keys: ["Del"], what: "Clear the selected unit's order, or cancel a deployment." },
  { keys: ["Shift", "Enter"], what: "Lock in orders, or finish firing for the round." },
  { keys: ["+", "−", "0"], what: "Zoom in, out, or fit the whole map." },
  { keys: ["Esc"], what: "Deselect. ? shows or hides this list." },
];

export function keyHelpHtml(): string {
  return `<dl class="key-list">${KEY_HELP.map(
    (k) =>
      `<div><dt>${k.keys.map((x) => (x === "–" ? `<span class="faint">–</span>` : `<kbd>${x}</kbd>`)).join("")}</dt><dd>${k.what}</dd></div>`,
  ).join("")}</dl>`;
}

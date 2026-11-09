// Is a map playable? The editor shows these problems live, the server refuses
// to start a game on a map that has any, and the rules test runs every
// built-in map through it.
import { DIRS, TERRAIN, inBounds, stepOpen } from "./grid.js";
import { seatName } from "./seats.js";
import type { MapDef, Point } from "./types.js";

export const MAP_LIMITS = {
  minSize: 12,
  maxSize: 40,
  /** Small bases: every tile is worth capturing, and a side is out when it has none left and no units. */
  maxBaseTiles: 6,
  maxPosts: 9,
  maxIncome: 9,
  minIncomeValue: 5,
  maxIncomeValue: 100,
};

const at = (p: Point) => `(${p.x + 1}, ${p.y + 1})`;

/** Everything wrong with the map, in plain words. Empty means playable. */
export function checkMap(map: MapDef): string[] {
  const problems: string[] = [];
  const terrain = (p: Point) => map.terrain[p.y * map.width + p.x]!;
  const standable = (p: Point) => inBounds(map, p.x, p.y) && TERRAIN[terrain(p)].passable;

  if (!map.name.trim()) problems.push("Give the map a name.");

  // Bases
  for (let seat = 0; seat < map.seats; seat++) {
    const tiles = map.bases[seat] ?? [];
    if (tiles.length === 0) problems.push(`${seatName(seat)} (seat ${seat + 1}) has no base tiles. Paint some with the Base tool.`);
    if (tiles.length > MAP_LIMITS.maxBaseTiles) problems.push(`${seatName(seat)}'s base has ${tiles.length} tiles; the most is ${MAP_LIMITS.maxBaseTiles}.`);
    const blocked = tiles.find((p) => !standable(p));
    if (blocked) problems.push(`${seatName(seat)}'s base tile at ${at(blocked)} is on ${TERRAIN[terrain(blocked)].label.toLowerCase()}, which can't be stood on.`);
  }

  // Sites
  if (map.posts.length === 0) problems.push("Add at least one command post: posts are the forward spawn points.");
  if (map.posts.length > MAP_LIMITS.maxPosts) problems.push(`There are ${map.posts.length} command posts; the most is ${MAP_LIMITS.maxPosts}.`);
  if (map.income.length > MAP_LIMITS.maxIncome) problems.push(`There are ${map.income.length} income sites; the most is ${MAP_LIMITS.maxIncome}.`);
  for (const p of map.posts) if (!standable(p)) problems.push(`The command post at ${at(p)} can't be stood on.`);
  for (const p of map.income) if (!standable(p)) problems.push(`The income site at ${at(p)} can't be stood on.`);

  // One thing per tile.
  const used = new Map<string, string>();
  const claim = (p: Point, what: string) => {
    const k = `${p.x},${p.y}`;
    const before = used.get(k);
    if (before && before !== what) problems.push(`${before} and ${what.toLowerCase()} share the tile at ${at(p)}.`);
    used.set(k, before ?? what);
  };
  map.bases.forEach((tiles, seat) => tiles.forEach((p) => claim(p, `${seatName(seat)}'s base`)));
  map.posts.forEach((p) => claim(p, "A command post"));
  map.income.forEach((p) => claim(p, "An income site"));

  // Every seat must be able to walk to every site and every other base, or
  // the game can stall with nobody able to reach anybody.
  const reach = new Map<number, Set<string>>();
  for (let seat = 0; seat < map.seats; seat++) {
    const start = (map.bases[seat] ?? []).find(standable);
    if (start) reach.set(seat, walkable(map, start));
  }
  const unreachable: string[] = [];
  for (const [seat, seen] of reach) {
    const targets: [string, Point][] = [
      ...map.posts.map((p): [string, Point] => [`the command post at ${at(p)}`, p]),
      ...map.income.map((p): [string, Point] => [`the income site at ${at(p)}`, p]),
      ...map.bases.flatMap((tiles, other) => (other !== seat && tiles[0] ? [[`${seatName(other)}'s base`, tiles[0]] as [string, Point]] : [])),
    ];
    for (const [label, p] of targets) {
      if (standable(p) && !seen.has(`${p.x},${p.y}`)) unreachable.push(`${seatName(seat)} can't reach ${label}.`);
    }
  }
  problems.push(...unreachable.slice(0, 4));
  if (unreachable.length > 4) problems.push(`…and ${unreachable.length - 4} more places that can't be reached.`);
  return problems;
}

/** Every tile a unit could walk to from `start`, ignoring other units. */
export function walkable(map: MapDef, start: Point): Set<string> {
  const seen = new Set([`${start.x},${start.y}`]);
  const queue = [start];
  while (queue.length) {
    const p = queue.shift()!;
    for (const d of DIRS) {
      const q = { x: p.x + d.x, y: p.y + d.y };
      if (!inBounds(map, q.x, q.y) || seen.has(`${q.x},${q.y}`) || !stepOpen(map, p, q)) continue;
      seen.add(`${q.x},${q.y}`);
      queue.push(q);
    }
  }
  return seen;
}

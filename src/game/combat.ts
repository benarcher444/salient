// Shooting: whether a shot is possible, its chance to hit, and its damage.
// The browser calls the same functions to show the hit chance before you
// click, so the number on screen is exactly the number the server rolls.
import { RULES } from "./constants.js";
import { TERRAIN, angleBetweenDeg, bearing, distance, facingAngle, terrainAt } from "./grid.js";
import { traceLine } from "./los.js";
import { UNITS, hasTrait } from "./units.js";
import type { MapDef, Point, Unit } from "./types.js";

export type Flank = "front" | "side" | "rear";

export interface Modifier {
  label: string;
  factor: number;
}

export type ShotBlock = "out_of_range" | "outside_arc" | "no_line_of_sight" | "same_side";

export interface ShotPreview {
  possible: boolean;
  block?: ShotBlock;
  distance: number;
  /** 0..1 */
  chance: number;
  /** Damage on an ordinary hit (a crit multiplies it). */
  damage: number;
  flank: Flank;
  inCover: boolean;
  /** What changed the chance, in order, for the tooltip. */
  modifiers: Modifier[];
}

export const BLOCK_TEXT: Record<ShotBlock, string> = {
  out_of_range: "Out of range",
  outside_arc: "Outside firing arc",
  no_line_of_sight: "No line of sight",
  same_side: "Friendly",
};

/** Which side of the target the shot arrives from. */
export function flankOf(shooter: Point, target: Pick<Unit, "x" | "y" | "facing">): Flank {
  const theta = angleBetweenDeg(facingAngle(target.facing), bearing(target, shooter));
  if (theta <= 60) return "front";
  if (theta >= 135) return "rear";
  return "side";
}

export function inArc(shooter: Pick<Unit, "x" | "y" | "facing" | "kind">, target: Point): boolean {
  const theta = angleBetweenDeg(facingAngle(shooter.facing), bearing(shooter, target));
  // Half a degree of slack so a target exactly on the arc's edge counts.
  return theta <= UNITS[shooter.kind].arc / 2 + 0.5;
}

/**
 * Everything about a shot short of rolling the dice. Visibility (can this
 * seat see the target at all, including stealth) is checked by the caller;
 * this covers range, arc, the sight line and the numbers.
 */
export function previewShot(map: MapDef, shooter: Unit, target: Unit): ShotPreview {
  const stats = UNITS[shooter.kind];
  const d = distance(shooter, target);
  const flank = flankOf(shooter, target);
  const base: ShotPreview = { possible: false, distance: d, chance: 0, damage: 0, flank, inCover: false, modifiers: [] };

  if (shooter.seat === target.seat) return { ...base, block: "same_side" };
  if (d > stats.range) return { ...base, block: "out_of_range" };
  if (!inArc(shooter, target)) return { ...base, block: "outside_arc" };
  const line = traceLine(map, shooter, target);
  if (!line.clear) return { ...base, block: "no_line_of_sight" };

  const modifiers: Modifier[] = [];
  let chance = stats.accuracy;

  if (d > stats.optimal) {
    const factor = 1 - (0.5 * (d - stats.optimal)) / Math.max(1, stats.range - stats.optimal);
    modifiers.push({ label: `Long range (${d.toFixed(1)} tiles)`, factor });
  }

  if (hasTrait(shooter.kind, "steady")) {
    if (shooter.moved) modifiers.push({ label: "Moved this round", factor: RULES.traits.steadyPenalty });
    if (d < RULES.traits.steadyMinRange) modifiers.push({ label: "Too close for the scope", factor: RULES.traits.steadyPenalty });
  }

  // Cover: something right next to the target, on the shooter's side of the
  // line, or woods the target is standing in. Something right next to the
  // shooter costs nothing (it is leaning out of that window), and anything in
  // between only partly obstructs. This is the old prototype's barrier rule: a
  // window near the shooter costs little, one near the target a lot.
  const ignoresCover = hasTrait(shooter.kind, "closeQuarters") && d <= RULES.traits.closeQuartersRange;
  const chebyshev = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  let inCover = TERRAIN[terrainAt(map, target.x, target.y)].cover;
  let obstructions = 0;
  for (const o of line.obstacles) {
    if (chebyshev(o.at, target) <= 1) inCover = true;
    else if (chebyshev(o.at, shooter) > 1) obstructions++;
  }
  if (inCover && !ignoresCover) modifiers.push({ label: "Target in cover", factor: RULES.coverFactor });
  if (inCover && ignoresCover) modifiers.push({ label: "Cover ignored up close", factor: 1 });
  for (let i = 0; i < Math.min(obstructions, 3); i++) modifiers.push({ label: "Partly obstructed", factor: RULES.obstructionFactor });

  for (const m of modifiers) chance *= m.factor;
  chance = Math.min(RULES.maxHitChance, Math.max(RULES.minHitChance, Math.round(chance)));

  return {
    possible: true,
    distance: d,
    chance: chance / 100,
    damage: damageFor(shooter, target, flank),
    flank,
    inCover: inCover && !ignoresCover,
    modifiers,
  };
}

export function damageFor(shooter: Unit, target: Unit, flank: Flank): number {
  const t = RULES.traits;
  let dmg = UNITS[shooter.kind].damage * RULES.flank[flank];
  if (flank === "rear" && hasTrait(shooter.kind, "backstab")) dmg = UNITS[shooter.kind].damage * t.backstabMultiplier;
  if (flank === "front" && hasTrait(target.kind, "shield")) dmg *= t.shieldFrontDamage;
  if (hasTrait(target.kind, "armoured")) dmg *= t.armouredDamage;
  return Math.round(dmg);
}

export interface ShotResult {
  hit: boolean;
  crit: boolean;
  damage: number;
}

/**
 * Roll a shot. One roll decides both: below `chance` is a hit, and the lowest
 * slice of that (critChance of the hit range) is a critical.
 */
export function rollShot(preview: ShotPreview, roll: number): ShotResult {
  if (roll >= preview.chance) return { hit: false, crit: false, damage: 0 };
  const crit = roll < preview.chance * RULES.critChance;
  return { hit: true, crit, damage: crit ? Math.round(preview.damage * RULES.critMultiplier) : preview.damage };
}

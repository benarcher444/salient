// Shooting: whether a shot is possible, its chance to hit, and its damage.
// The browser calls the same functions to show the hit chance before you
// click, so the number on screen is exactly the number the server rolls.
import { RULES } from "./constants.js";
import { TERRAIN, angleBetweenDeg, bearing, distance, facingAngle, inBounds, terrainAt } from "./grid.js";
import { traceLine } from "./los.js";
import { UNITS, hasTrait } from "./units.js";
import type { MapDef, Point, Unit } from "./types.js";

export type Flank = "front" | "side" | "rear";

export interface Modifier {
  label: string;
  factor: number;
}

export type ShotBlock = "unarmed" | "out_of_range" | "outside_arc" | "no_line_of_sight" | "enemy_in_way" | "same_side";

export interface ShotPreview {
  possible: boolean;
  block?: ShotBlock;
  distance: number;
  /** 0..1 */
  chance: number;
  /** Damage on an ordinary hit (a crit multiplies it). */
  damage: number;
  /** A hit kills outright, whatever the target's health (a backstab from next to it). */
  fatal: boolean;
  /** Explosives: what the blast does to everything next to the target, and to the target on a miss. 0 otherwise. */
  splash: number;
  flank: Flank;
  inCover: boolean;
  /** What changed the chance, in order, for the tooltip. */
  modifiers: Modifier[];
}

export const BLOCK_TEXT: Record<ShotBlock, string> = {
  unarmed: "Unarmed",
  out_of_range: "Out of range",
  outside_arc: "Outside firing arc",
  no_line_of_sight: "No line of sight",
  enemy_in_way: "Another enemy is in the way",
  same_side: "Friendly",
};

/** Can this class shoot at all? Engineers and riot shields can't. */
export const isArmed = (kind: Unit["kind"]) => !hasTrait(kind, "unarmed");

const chebyshev = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

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

/** Is an officer of the shooter's side (not the shooter) close enough to steady its aim? */
export function commanded(shooter: Unit, units: readonly Unit[]): boolean {
  return units.some(
    (o) => o.id !== shooter.id && o.seat === shooter.seat && hasTrait(o.kind, "command") && chebyshev(o, shooter) <= RULES.traits.commandRange,
  );
}

/**
 * Everything about a shot short of rolling the dice. Visibility (can this
 * seat see the target at all, including stealth) is checked by the caller;
 * this covers range, arc, the sight line and the numbers. `units` is everyone
 * the caller knows of: an enemy standing on the line blocks the shot (your
 * own side's units don't: you shoot past them), and it is how an officer's
 * presence is found.
 */
export function previewShot(map: MapDef, shooter: Unit, target: Unit, units: readonly Unit[] = []): ShotPreview {
  const stats = UNITS[shooter.kind];
  const t = RULES.traits;
  const d = distance(shooter, target);
  const flank = flankOf(shooter, target);
  const base: ShotPreview = { possible: false, distance: d, chance: 0, damage: 0, fatal: false, splash: 0, flank, inCover: false, modifiers: [] };

  if (shooter.seat === target.seat) return { ...base, block: "same_side" };
  if (!isArmed(shooter.kind)) return { ...base, block: "unarmed" };
  if (d > stats.range) return { ...base, block: "out_of_range" };
  if (!inArc(shooter, target)) return { ...base, block: "outside_arc" };
  const line = traceLine(map, shooter, target);
  if (!line.clear) return { ...base, block: "no_line_of_sight" };
  const inTheWay = units.some(
    (u) => u.seat !== shooter.seat && u.id !== target.id && line.tiles.some((p) => p.x === u.x && p.y === u.y),
  );
  if (inTheWay) return { ...base, block: "enemy_in_way" };

  const modifiers: Modifier[] = [];
  let chance = stats.accuracy;

  if (d > stats.optimal) {
    const factor = 1 - ((1 - RULES.longRangeAccuracy) * (d - stats.optimal)) / Math.max(1, stats.range - stats.optimal);
    modifiers.push({ label: `Long range (${d.toFixed(1)} tiles)`, factor });
  }
  // A scope is built for distance: the closer the target, the worse the aim.
  if (hasTrait(shooter.kind, "scoped") && d < stats.optimal) {
    const factor = t.scopedCloseAccuracy + (1 - t.scopedCloseAccuracy) * clamp01((d - 1) / Math.max(1, stats.optimal - 1));
    modifiers.push({ label: `Too close for the scope (${d.toFixed(1)} tiles)`, factor });
  }
  if (hasTrait(shooter.kind, "steady") && shooter.moved) modifiers.push({ label: "Moved this round: not braced", factor: t.steadyPenalty });
  const officer = commanded(shooter, units);
  if (officer) modifiers.push({ label: "Officer nearby", factor: t.commandAccuracy });

  // Cover: something right next to the target, on the shooter's side of the
  // line, or woods the target is standing in. Something right next to the
  // shooter costs nothing (it is leaning out of that window), and anything in
  // between only partly obstructs. This is the old prototype's barrier rule: a
  // window near the shooter costs little, one near the target a lot.
  const ignoresCover = hasTrait(shooter.kind, "closeQuarters") && d <= t.closeQuartersRange;
  let inCover = TERRAIN[terrainAt(map, target.x, target.y)].cover;
  let obstructions = 0;
  for (const o of line.obstacles) {
    if (chebyshev(o.at, target) <= 1) inCover = true;
    else if (chebyshev(o.at, shooter) > 1) obstructions++;
  }
  if (inCover && !ignoresCover) modifiers.push({ label: "Target in cover", factor: RULES.coverFactor });
  if (inCover && ignoresCover) modifiers.push({ label: "Cover ignored up close", factor: 1 });
  for (let i = 0; i < Math.min(obstructions, 3); i++) modifiers.push({ label: "Partly obstructed", factor: RULES.obstructionFactor });
  if (flank === "front" && hasTrait(target.kind, "shield")) {
    modifiers.push(hasTrait(shooter.kind, "shieldBreaker") ? { label: "Riot shield (punches through)", factor: t.shieldBreakerHit } : { label: "Riot shield", factor: t.shieldFrontHit });
  }

  for (const m of modifiers) chance *= m.factor;
  chance = Math.min(RULES.maxHitChance, Math.max(RULES.minHitChance, Math.round(chance)));

  const fatal = flank === "rear" && hasTrait(shooter.kind, "backstab") && chebyshev(shooter, target) <= t.backstabFatalRange;
  return {
    possible: true,
    distance: d,
    chance: chance / 100,
    damage: fatal ? target.hp : damageFor(shooter, target, flank, officer),
    fatal,
    splash: splashFor(shooter),
    flank,
    inCover: inCover && !ignoresCover,
    modifiers,
  };
}

/** What a shield in front of `target` does to `shooter`'s hit chance (1 = nothing). */
export function shieldFactor(shooter: Pick<Unit, "kind">, target: Pick<Unit, "kind">, flank: Flank): number {
  if (flank !== "front" || !hasTrait(target.kind, "shield")) return 1;
  return hasTrait(shooter.kind, "shieldBreaker") ? RULES.traits.shieldBreakerHit : RULES.traits.shieldFrontHit;
}

export function damageFor(shooter: Unit, target: Unit, flank: Flank, officer = false): number {
  const stats = UNITS[shooter.kind];
  const t = RULES.traits;
  let dmg = stats.damage * RULES.flank[flank];
  if (flank === "rear" && hasTrait(shooter.kind, "backstab")) dmg = stats.damage * t.backstabMultiplier;
  // Spread shot: full damage next to the target, falling to spreadFarDamage at max range.
  if (hasTrait(shooter.kind, "spread")) {
    const d = distance(shooter, target);
    dmg *= 1 - (1 - t.spreadFarDamage) * clamp01((d - 1) / Math.max(1, stats.range - 1));
  }
  if (officer) dmg *= t.commandDamage;
  if (hasTrait(target.kind, "armoured")) dmg *= t.armouredDamage;
  return Math.round(dmg);
}

/** What an explosive's blast does to each unit it catches. 0 for anything else. */
export function splashFor(shooter: Unit): number {
  return hasTrait(shooter.kind, "explosive") ? Math.round(UNITS[shooter.kind].damage * RULES.traits.splashDamage) : 0;
}

/**
 * The tiles an explosion at `at` reaches: its own and the eight round it,
 * except through a wall. Friend and foe alike are caught.
 */
export function blastTiles(map: MapDef, at: Point): Point[] {
  const tiles: Point[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const p = { x: at.x + dx, y: at.y + dy };
      if (!inBounds(map, p.x, p.y)) continue;
      if ((dx || dy) && !traceLine(map, at, p).clear) continue;
      tiles.push(p);
    }
  }
  return tiles;
}

export interface ShotResult {
  hit: boolean;
  crit: boolean;
  damage: number;
}

/** The least and most an ordinary (not critical) hit can do: damage varies by damageVariance either way. */
export function damageRange(preview: Pick<ShotPreview, "damage" | "fatal">): [number, number] {
  if (preview.fatal) return [preview.damage, preview.damage];
  const v = RULES.damageVariance;
  return [Math.max(1, Math.round(preview.damage * (1 - v))), Math.round(preview.damage * (1 + v))];
}

/**
 * Roll a shot. The first roll decides both hit and crit: below `chance` is a
 * hit, and the lowest slice of that (critChance of the hit range) is a
 * critical. The second sets where the damage falls in its range.
 */
export function rollShot(preview: ShotPreview, roll: number, spread = 0.5): ShotResult {
  if (roll >= preview.chance) return { hit: false, crit: false, damage: 0 };
  if (preview.fatal) return { hit: true, crit: false, damage: preview.damage };
  const crit = roll < preview.chance * RULES.critChance;
  const [lo, hi] = damageRange(preview);
  const dealt = lo + Math.round((hi - lo) * spread);
  return { hit: true, crit, damage: crit ? Math.round(dealt * RULES.critMultiplier) : dealt };
}

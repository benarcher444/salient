// The numbers the game is balanced by, read from the JSON files in /tuning so
// they can be tinkered with without touching code. The files are imported
// (not read from disk), so the same data reaches the server and the browser
// bundle and src/game stays free of Node imports.
//
// Every game keeps a snapshot of the tuning it was created under (like its
// map), because a game is rebuilt by replaying its actions: change a unit's
// damage under a game in progress and its history would replay differently.
// UNITS and RULES are therefore the *active* tuning: plain objects whose
// contents `withTuning` swaps for the duration of a synchronous rules call.
import rulesFile from "../../tuning/rules.json" with { type: "json" };
import breacher from "../../tuning/units/breacher.json" with { type: "json" };
import commando from "../../tuning/units/commando.json" with { type: "json" };
import engineer from "../../tuning/units/engineer.json" with { type: "json" };
import heavy from "../../tuning/units/heavy.json" with { type: "json" };
import rifleman from "../../tuning/units/rifleman.json" with { type: "json" };
import riot from "../../tuning/units/riot.json" with { type: "json" };
import scout from "../../tuning/units/scout.json" with { type: "json" };
import sniper from "../../tuning/units/sniper.json" with { type: "json" };
import type { UnitKind } from "./types.js";

export const TRAITS = ["engineer", "medic", "armoured", "shield", "stealth", "backstab", "steady", "closeQuarters"] as const;
/**
 * engineer: can capture income sites. medic: neighbouring allies heal extra.
 * armoured: takes less damage. shield: takes much less from the front.
 * stealth: only seen up close. backstab: shots in the back hit far harder.
 * steady: accuracy drops if it moved, and up close. closeQuarters: ignores cover up close.
 */
export type Trait = (typeof TRAITS)[number];

export interface UnitStats {
  kind: UnitKind;
  name: string;
  /** One line for the shop card. */
  role: string;
  cost: number;
  hp: number;
  /** Tiles per round (a diagonal step costs 1.5). */
  move: number;
  /** Tiles it can see, in a full circle. */
  sight: number;
  /** Furthest it can shoot. */
  range: number;
  /** Beyond this distance accuracy starts to fall away, to half at max range. */
  optimal: number;
  /** Percent chance to hit at optimal range in the open. */
  accuracy: number;
  damage: number;
  /** Width of the firing arc in degrees, centred on its facing. */
  arc: number;
  traits: Trait[];
}

export interface RulesTuning {
  startGold: number;
  baseIncome: number;
  healPerRound: number;
  medicHeal: number;
  critChance: number;
  critMultiplier: number;
  roundLimit: number;
  siteSight: number;
  minHitChance: number;
  maxHitChance: number;
  coverFactor: number;
  obstructionFactor: number;
  flank: { front: number; side: number; rear: number };
  traits: {
    armouredDamage: number;
    shieldFrontDamage: number;
    backstabMultiplier: number;
    stealthRange: number;
    steadyPenalty: number;
    steadyMinRange: number;
    closeQuartersRange: number;
  };
}

export interface Tuning {
  rules: RulesTuning;
  units: Record<UnitKind, UnitStats>;
}

export const UNIT_KINDS: readonly UnitKind[] = ["rifleman", "scout", "engineer", "heavy", "sniper", "riot", "commando", "breacher"];

export class TuningError extends Error {}

/** Field checks: [name, smallest allowed, largest allowed, whole numbers only]. */
type NumberRule = [string, number, number, boolean?];

const UNIT_NUMBERS: NumberRule[] = [
  ["cost", 0, 10_000, true],
  ["hp", 1, 10_000, true],
  ["move", 0, 30],
  ["sight", 0, 40],
  ["range", 0, 40],
  ["optimal", 0, 40],
  ["accuracy", 0, 100],
  ["damage", 0, 10_000],
  ["arc", 1, 360],
];

const RULE_NUMBERS: NumberRule[] = [
  ["startGold", 0, 100_000, true],
  ["baseIncome", 0, 100_000, true],
  ["healPerRound", 0, 10_000],
  ["medicHeal", 0, 10_000],
  ["critChance", 0, 1],
  ["critMultiplier", 0, 100],
  ["roundLimit", 1, 1000, true],
  ["siteSight", 0, 40],
  ["minHitChance", 0, 100],
  ["maxHitChance", 0, 100],
  ["coverFactor", 0, 10],
  ["obstructionFactor", 0, 10],
];
const FLANK_NUMBERS: NumberRule[] = [
  ["front", 0, 100],
  ["side", 0, 100],
  ["rear", 0, 100],
];
const TRAIT_NUMBERS: NumberRule[] = [
  ["armouredDamage", 0, 10],
  ["shieldFrontDamage", 0, 10],
  ["backstabMultiplier", 0, 100],
  ["stealthRange", 0, 40],
  ["steadyPenalty", 0, 10],
  ["steadyMinRange", 0, 40],
  ["closeQuartersRange", 0, 40],
];

function checkNumbers(file: string, obj: Record<string, unknown>, rules: NumberRule[], prefix = "") {
  for (const [name, min, max, whole] of rules) {
    const v = obj[name];
    const field = `"${prefix}${name}"`;
    if (v === undefined) throw new TuningError(`${file}: ${field} is missing.`);
    if (typeof v !== "number" || !Number.isFinite(v)) throw new TuningError(`${file}: ${field} must be a number, not ${JSON.stringify(v)}.`);
    if (v < min || v > max) throw new TuningError(`${file}: ${field} is ${v}; it must be between ${min} and ${max}.`);
    if (whole && !Number.isInteger(v)) throw new TuningError(`${file}: ${field} must be a whole number, not ${v}.`);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkUnit(kind: UnitKind, raw: unknown): UnitStats {
  const file = `tuning/units/${kind}.json`;
  if (!isObject(raw)) throw new TuningError(`${file}: must be a JSON object { ... }.`);
  for (const name of ["name", "role"]) {
    if (typeof raw[name] !== "string" || !(raw[name] as string).trim()) throw new TuningError(`${file}: "${name}" must be some text.`);
  }
  checkNumbers(file, raw, UNIT_NUMBERS);
  if ((raw.optimal as number) > (raw.range as number)) throw new TuningError(`${file}: "optimal" (${raw.optimal}) can't be more than "range" (${raw.range}).`);
  if (!Array.isArray(raw.traits)) throw new TuningError(`${file}: "traits" must be a list, like ["armoured"] or [].`);
  for (const t of raw.traits) {
    if (!TRAITS.includes(t as Trait)) throw new TuningError(`${file}: unknown trait ${JSON.stringify(t)}. Known traits: ${TRAITS.join(", ")}.`);
  }
  // "kind" appears in stored snapshots; the files go without it (the file name says it).
  const known = new Set(["kind", "name", "role", "traits", ...UNIT_NUMBERS.map(([n]) => n)]);
  const extra = Object.keys(raw).find((k) => !known.has(k));
  if (extra) throw new TuningError(`${file}: unknown field "${extra}" (a typo?).`);
  return { ...(raw as Omit<UnitStats, "kind">), kind, traits: [...(raw.traits as Trait[])] };
}

function checkRules(raw: unknown): RulesTuning {
  const file = "tuning/rules.json";
  if (!isObject(raw)) throw new TuningError(`${file}: must be a JSON object { ... }.`);
  checkNumbers(file, raw, RULE_NUMBERS);
  if (!isObject(raw.flank)) throw new TuningError(`${file}: "flank" must be an object like { "front": 1, "side": 1.25, "rear": 1.5 }.`);
  checkNumbers(file, raw.flank, FLANK_NUMBERS, "flank.");
  if (!isObject(raw.traits)) throw new TuningError(`${file}: "traits" must be an object of trait numbers.`);
  checkNumbers(file, raw.traits, TRAIT_NUMBERS, "traits.");
  if ((raw.minHitChance as number) > (raw.maxHitChance as number)) throw new TuningError(`${file}: "minHitChance" can't be more than "maxHitChance".`);
  const known = new Set(["flank", "traits", ...RULE_NUMBERS.map(([n]) => n)]);
  const extra = Object.keys(raw).find((k) => !known.has(k));
  if (extra) throw new TuningError(`${file}: unknown field "${extra}" (a typo?).`);
  return structuredClone(raw) as unknown as RulesTuning;
}

/** Validate tuning data (from the files, or a game's stored snapshot). Throws TuningError naming the file and field. */
export function checkTuning(raw: { rules: unknown; units: Record<string, unknown> }): Tuning {
  const units = {} as Record<UnitKind, UnitStats>;
  for (const kind of UNIT_KINDS) {
    if (!(kind in raw.units)) throw new TuningError(`tuning/units/${kind}.json is missing.`);
    units[kind] = checkUnit(kind, raw.units[kind]);
  }
  return { rules: checkRules(raw.rules), units };
}

/** The tuning in the files right now. New games are created under it. */
export const FILE_TUNING: Tuning = checkTuning({
  rules: rulesFile,
  units: { rifleman, scout, engineer, heavy, sniper, riot, commando, breacher },
});

/** The active tuning, read by every rule. Swapped by withTuning, never reassigned. */
export const UNITS: Record<UnitKind, UnitStats> = structuredClone(FILE_TUNING.units);
export const RULES: RulesTuning = structuredClone(FILE_TUNING.rules);

let current: Tuning = FILE_TUNING;

/** Make `t` the active tuning (the browser does this once, from the game it shows). */
export function useTuning(t: Tuning) {
  for (const kind of UNIT_KINDS) UNITS[kind] = t.units[kind];
  Object.assign(RULES, t.rules);
  current = t;
}

/**
 * Run `fn` with `t` active, then put back what was active before. Rules calls
 * are synchronous, so nothing else can run in between.
 */
export function withTuning<T>(t: Tuning, fn: () => T): T {
  if (t === current) return fn();
  const before = current;
  useTuning(t);
  try {
    return fn();
  } finally {
    useTuning(before);
  }
}

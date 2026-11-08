// The unit catalogue. One entry per class; every rule that differs between
// classes reads a field or a trait from here rather than testing the kind.
import type { UnitKind } from "./types.js";

export type Trait =
  /** Can capture income sites. */
  | "engineer"
  /** Allies standing next to it at the end of a round heal extra. */
  | "medic"
  /** Takes less damage from every direction. */
  | "armoured"
  /** Takes much less damage from shots that arrive from in front. */
  | "shield"
  /** Only seen by enemies within STEALTH_RANGE tiles. */
  | "stealth"
  /** Shots into the back hit far harder. */
  | "backstab"
  /** Accuracy drops sharply if it moved this round, and up close. */
  | "steady"
  /** Ignores cover at close range. */
  | "closeQuarters";

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

export const STEALTH_RANGE = 3;

export const UNITS: Record<UnitKind, UnitStats> = {
  rifleman: {
    kind: "rifleman",
    name: "Rifleman",
    role: "Dependable all-rounder.",
    cost: 100,
    hp: 100,
    move: 5,
    sight: 8,
    range: 8,
    optimal: 5,
    accuracy: 75,
    damage: 30,
    arc: 120,
    traits: [],
  },
  scout: {
    kind: "scout",
    name: "Scout",
    role: "Fast, far-sighted, fragile. Finds targets for others.",
    cost: 70,
    hp: 70,
    move: 7,
    sight: 11,
    range: 6,
    optimal: 3,
    accuracy: 65,
    damage: 18,
    arc: 150,
    traits: [],
  },
  engineer: {
    kind: "engineer",
    name: "Engineer",
    role: "Captures income sites and patches up neighbours.",
    cost: 90,
    hp: 90,
    move: 5,
    sight: 7,
    range: 5,
    optimal: 3,
    accuracy: 65,
    damage: 20,
    arc: 120,
    traits: ["engineer", "medic"],
  },
  heavy: {
    kind: "heavy",
    name: "Heavy",
    role: "Slow, armoured, hits hard down a narrow arc.",
    cost: 160,
    hp: 160,
    move: 3,
    sight: 7,
    range: 8,
    optimal: 5,
    accuracy: 65,
    damage: 45,
    arc: 90,
    traits: ["armoured"],
  },
  sniper: {
    kind: "sniper",
    name: "Sniper",
    role: "Deadly at long range if it holds still.",
    cost: 150,
    hp: 70,
    move: 4,
    sight: 10,
    range: 14,
    optimal: 12,
    accuracy: 85,
    damage: 60,
    arc: 60,
    traits: ["steady"],
  },
  riot: {
    kind: "riot",
    name: "Riot",
    role: "Shield bearer. Leads the push into a building.",
    cost: 130,
    hp: 130,
    move: 4,
    sight: 7,
    range: 3,
    optimal: 2,
    accuracy: 80,
    damage: 25,
    arc: 120,
    traits: ["shield"],
  },
  commando: {
    kind: "commando",
    name: "Commando",
    role: "Unseen until close. Devastating from behind.",
    cost: 140,
    hp: 80,
    move: 6,
    sight: 8,
    range: 4,
    optimal: 2,
    accuracy: 80,
    damage: 35,
    arc: 120,
    traits: ["stealth", "backstab"],
  },
  breacher: {
    kind: "breacher",
    name: "Breacher",
    role: "Shotgun. Cover means nothing to it up close.",
    cost: 110,
    hp: 110,
    move: 5,
    sight: 7,
    range: 4,
    optimal: 2,
    accuracy: 85,
    damage: 50,
    arc: 120,
    traits: ["closeQuarters"],
  },
};

export const UNIT_KINDS = Object.keys(UNITS) as UnitKind[];

export const TRAIT_TEXT: Record<Trait, string> = {
  engineer: "Captures income sites.",
  medic: "Neighbouring allies heal +10 at round end.",
  armoured: "Takes 20% less damage.",
  shield: "Takes 60% less damage from the front.",
  stealth: `Only seen within ${STEALTH_RANGE} tiles.`,
  backstab: "Shots in the back do 2.5x damage.",
  steady: "Half accuracy if it moved, and up close.",
  closeQuarters: "Ignores cover within 2 tiles.",
};

export const hasTrait = (kind: UnitKind, trait: Trait) => UNITS[kind].traits.includes(trait);

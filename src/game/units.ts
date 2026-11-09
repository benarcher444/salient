// The unit catalogue. The numbers live in tuning/units/<kind>.json (see
// tuning.ts); every rule that differs between classes reads a field or a trait
// from here rather than testing the kind.
import { RULES, UNITS, UNIT_KINDS, type Trait, type UnitStats } from "./tuning.js";
import type { UnitKind } from "./types.js";

export { UNITS, UNIT_KINDS, type Trait, type UnitStats };

/** Only seen by enemies within this many tiles (stealth trait). Read at call time: it is tuning. */
export const stealthRange = () => RULES.traits.stealthRange;

const pct = (factor: number) => `${Math.round((1 - factor) * 100)}%`;

/** Plain words for each trait, with the current numbers in. */
export function traitText(trait: Trait): string {
  const t = RULES.traits;
  switch (trait) {
    case "engineer":
      return "Captures income sites.";
    case "medic":
      return `Neighbouring allies heal +${RULES.medicHeal} at round end.`;
    case "armoured":
      return `Takes ${pct(t.armouredDamage)} less damage.`;
    case "shield":
      return `Takes ${pct(t.shieldFrontDamage)} less damage from the front.`;
    case "stealth":
      return `Only seen within ${t.stealthRange} tiles.`;
    case "backstab":
      return `Shots in the back do ${t.backstabMultiplier}x damage.`;
    case "steady":
      return `${t.steadyPenalty === 0.5 ? "Half" : `${Math.round(t.steadyPenalty * 100)}%`} accuracy if it moved, and up close.`;
    case "closeQuarters":
      return `Ignores cover within ${Math.floor(t.closeQuartersRange)} tiles.`;
  }
}

/** Kept for the panel and pages: `TRAIT_TEXT[trait]` reads the active numbers. */
export const TRAIT_TEXT: Record<Trait, string> = new Proxy({} as Record<Trait, string>, {
  get: (_, trait) => traitText(trait as Trait),
});

export const hasTrait = (kind: UnitKind, trait: Trait) => UNITS[kind].traits.includes(trait);

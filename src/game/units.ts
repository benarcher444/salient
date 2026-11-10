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
    case "unarmed":
      return "Carries no weapon.";
    case "engineer":
      return RULES.engineerBaseCaptureRounds < RULES.baseCaptureRounds
        ? `Captures income sites, and base tiles in ${RULES.engineerBaseCaptureRounds === 1 ? "one round" : `${RULES.engineerBaseCaptureRounds} rounds`} a step.`
        : "Captures income sites.";
    case "medic":
      return `Allies within ${RULES.medicRange} tiles heal +${RULES.medicHeal} at round end, even under fire.`;
    case "command":
      return `Allies within ${t.commandRange} tiles get ${Math.round((t.commandAccuracy - 1) * 100)}% more accuracy and ${Math.round((t.commandDamage - 1) * 100)}% more damage.`;
    case "shield":
      return `Shots from the front hit only ${Math.round(t.shieldFrontHit * 100)}% as often.`;
    case "stealth":
      return `Only seen within ${t.stealthRange} tiles.`;
    case "backstab":
      return `Shots in the back do ${t.backstabMultiplier}x damage, and kill outright from ${t.backstabFatalRange === 1 ? "the next tile" : `${t.backstabFatalRange} tiles`}.`;
    case "steady":
      return `${t.steadyPenalty === 0.5 ? "Half" : `${Math.round(t.steadyPenalty * 100)}%`} accuracy if it moved this round.`;
    case "scoped":
      return `Accuracy falls the closer the target (to ${Math.round(t.scopedCloseAccuracy * 100)}% next to it). Sees ${t.scopeSight} tiles in a narrow strip ahead.`;
    case "closeQuarters":
      return `Ignores cover within ${Math.floor(t.closeQuartersRange)} tiles.`;
    case "spread":
      return `Damage falls with distance, to ${Math.round(t.spreadFarDamage * 100)}% at max range.`;
    case "explosive":
      return `The blast does ${Math.round(t.splashDamage * 100)}% damage to everything next to the target, yours too, and to the target on a miss.`;
    case "armoured":
      return `Takes ${pct(t.armouredDamage)} less damage.`;
  }
}

/** Kept for the panel and pages: `TRAIT_TEXT[trait]` reads the active numbers. */
export const TRAIT_TEXT: Record<Trait, string> = new Proxy({} as Record<Trait, string>, {
  get: (_, trait) => traitText(trait as Trait),
});

export const hasTrait = (kind: UnitKind, trait: Trait) => UNITS[kind].traits.includes(trait);

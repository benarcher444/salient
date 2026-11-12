// What each class is for, as the bot plays it (Regular and Veteran; a Novice
// doesn't think about it). The owner's ask after game bqu7z9, where the bots
// bought every class but played them all like riflemen: their riots stood
// anywhere, their commandos walked up to the front, their snipers led the
// way and died in three rounds, their engineers walked into fights (23 of 25
// died), and under the house rules they never went back to heal.
//
// Each class adds to the tile score `bot.ts` already uses (about one point a
// tile of walking), may change where the unit is heading, and may choose its
// facing. Everything comes from the bot's own PlayerView.
//   Riot:      stands on the line between an enemy and a friend it could
//              shoot, shield towards that enemy; with no enemy seen, keeps
//              close to the armed friends.
//   Commando:  heads round behind the most valuable enemy it can reach, keeps
//              out of an enemy's stealth range unless it is at its back, and
//              faces the one it can stab; holds fire at a face it won't kill
//              (bot.ts's chooseShot), since firing pins it down.
//   Sniper:    stays behind the front line and away from enemies, and moves
//              to a tile with a long shot (it holds still once it has one).
//   Heavy:     stays behind the front, looks for a shot at bunched enemies.
//   Officer:   stays among the armed friends its order reaches, behind the front.
//   Healer:    goes to the wounded (bot.ts), keeps in the group, behind the front.
//   Shotgun:   closes in, from a flank where it can.
//   Scout:     keeps its distance, watching from the edge of its sight.
//   Engineer:  keeps out of the enemy's fire, behind the front.
//   Wounded:   (any class) badly hurt and within 8 tiles, heads for a healer
//              or, under heal-at-base, beside a base tile or post it holds;
//              under half health, prefers tiles where it will heal.
// Measured against the same bots without roles (simulate.ts --levels=
// veteran,veteran-plain): Facility 13-7 (12-8 with both house rules),
// Crossroads and Riverside about even, the Warren with house rules even.
import { flankOf, helpReaches, isArmed, lineSpots, previewShot } from "./combat.js";
import { RULES } from "./constants.js";
import { distance, facingAngle, facingToward, inBounds, isPassable } from "./grid.js";
import { traceLine } from "./los.js";
import { nearOwnBase } from "./rules.js";
import { UNITS, hasTrait, stealthRange } from "./units.js";
import { baseTiles } from "./visibility.js";
import type { PlayerView } from "./view.js";
import type { Facing, GameState, MapDef, Point, Unit, UnitKind } from "./types.js";

/** Units that make the front line; the others keep behind it. */
const FRONT: ReadonlySet<UnitKind> = new Set(["rifleman", "shotgun", "riot", "scout", "commando"]);
/** How far behind the front a class keeps, in walking tiles, and how hard it holds to that. */
const BEHIND: Partial<Record<UnitKind, { margin: number; weight: number }>> = {
  sniper: { margin: 3, weight: 0.8 },
  heavy: { margin: 1.5, weight: 0.6 },
  officer: { margin: 1, weight: 0.4 },
  healer: { margin: 1, weight: 0.5 },
  engineer: { margin: 2, weight: 0.6 },
};

/** The free tile right behind an enemy, as it faces now (or one beside that), if any. */
export function rearTile(map: MapDef, units: readonly Unit[], e: Unit): Point | null {
  const a = facingAngle(e.facing);
  const back = { x: e.x - Math.round(Math.sin(a)), y: e.y + Math.round(Math.cos(a)) };
  const tries = [back, { x: back.x + 1, y: back.y }, { x: back.x - 1, y: back.y }, { x: back.x, y: back.y + 1 }, { x: back.x, y: back.y - 1 }];
  return (
    tries.find(
      (p) =>
        inBounds(map, p.x, p.y) &&
        isPassable(map, p.x, p.y) &&
        !(p.x === e.x && p.y === e.y) &&
        flankOf(p, e) === "rear" &&
        !units.some((o) => o.x === p.x && o.y === p.y),
    ) ?? null
  );
}

export interface RoleSense {
  /** Walking distance between tiles, round walls (bot.ts's cached fields). */
  walk(from: Point, to: Point): number;
  /** Expected damage the enemies it sees could do to `u` standing at `p`. */
  danger(u: Unit, p: Point): number;
  /** What an enemy unit is worth taking out. */
  worth(u: Unit): number;
}

const key = (p: Point) => `${p.x},${p.y}`;
const chebyshev = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export class Roles {
  /** Tiles on an enemy's line of fire at a friend, and what standing there shields (riots). */
  private screen = new Map<string, { value: number; enemy: Unit; top: number }>();
  private frontCache = new Map<string, number>();
  private healTiles: Point[] = [];

  constructor(
    private map: MapDef,
    private view: PlayerView,
    private state: GameState,
    private mine: Unit[],
    private enemies: Unit[],
    private sense: RoleSense,
  ) {
    for (const e of enemies) {
      if (!isArmed(e.kind)) continue;
      for (const f of mine) {
        if (f.kind === "riot" || distance(e, f) > UNITS[e.kind].range) continue;
        const line = traceLine(map, e, f);
        if (!line.clear) continue;
        const value = 1.5 * (UNITS[f.kind].cost / 100) * (isArmed(f.kind) ? 1 : 0.7);
        for (const { p } of lineSpots(e, f, line.tiles)) {
          if ((p.x === e.x && p.y === e.y) || (p.x === f.x && p.y === f.y)) continue;
          const k = key(p);
          const had = this.screen.get(k);
          // Shielding several lines adds up (to a cap); it faces the biggest.
          this.screen.set(k, { value: Math.min(4, (had?.value ?? 0) + value), enemy: had && had.top >= value ? had.enemy : e, top: Math.max(had?.top ?? 0, value) });
        }
      }
    }
    if (RULES.healOnlyNearBase) {
      const seat = view.seat!;
      const sites = [
        ...baseTiles(map, view.seats.length).filter((_, i) => view.baseOwners[i] === seat),
        ...(RULES.rulesRevision >= 3 ? map.posts.filter((_, i) => view.postOwners[i] === seat) : []),
      ];
      const seen = new Set<string>();
      for (const s of sites)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const p = { x: s.x + dx, y: s.y + dy };
            if (!isPassable(map, p.x, p.y) || seen.has(key(p))) continue;
            seen.add(key(p));
            this.healTiles.push(p);
          }
    }
  }

  private frac(u: Unit): number {
    return u.hp / UNITS[u.kind].hp;
  }

  private healers(u: Unit): Unit[] {
    return this.mine.filter((m) => m.id !== u.id && hasTrait(m.kind, "medic"));
  }

  /** Where the front line stands, as walking distance to `goal`: the nearest front-line friend. */
  private front(u: Unit, goal: Point): number {
    const k = key(goal);
    let d = this.frontCache.get(k);
    if (d === undefined) {
      d = Math.min(Infinity, ...this.mine.filter((f) => f.id !== u.id && FRONT.has(f.kind)).map((f) => this.sense.walk(f, goal)));
      this.frontCache.set(k, d);
    }
    return d;
  }

  /** Where a unit should be heading instead of `goal`, if anywhere. */
  goal(u: Unit, goal: Point, claimed: ReadonlySet<string>): Point {
    const frac = this.frac(u);
    // The badly hurt go to be healed, if it's close (8 tiles): under
    // heal-at-base beside a base tile or post it holds, or to a healer,
    // whichever is nearer; otherwise to a healer. (Measured: sending them
    // further, or sooner, lost games on the Warren.)
    const wounded = RULES.healOnlyNearBase ? frac < 0.35 : frac < 0.4;
    if (wounded && !hasTrait(u.kind, "medic")) {
      const options: Point[] = [...this.healers(u)];
      if (!nearOwnBase(this.map, this.state, u)) options.push(...this.healTiles.filter((t) => !claimed.has(key(t))));
      else if (RULES.healOnlyNearBase) return u; // Already healing: stay.
      const best = options.map((p) => ({ p, d: this.sense.walk(u, p) })).sort((a, b) => a.d - b.d)[0];
      if (best && best.d <= 8) return best.p;
    }
    if (hasTrait(u.kind, "backstab")) {
      // Round behind the enemy most worth stabbing within reach of a few rounds.
      let bestV = 0;
      let best: Point | null = null;
      for (const e of this.enemies) {
        const rear = this.rearTile(e);
        if (!rear) continue;
        const d = this.sense.walk(u, rear);
        if (d > 12) continue;
        const v = this.sense.worth(e) / (1 + d / 4);
        if (v > bestV) {
          bestV = v;
          best = rear;
        }
      }
      if (best) return best;
    }
    return goal;
  }

  private rearTile(e: Unit): Point | null {
    return rearTile(this.map, this.view.units, e);
  }

  /** What the class makes of standing on `p` this round, added to the tile score. */
  score(u: Unit, p: Point, goal: Point): number {
    let s = 0;
    const frac = this.frac(u);
    const armedEnemies = this.enemies.filter((e) => isArmed(e.kind));

    // Hurt: next to a healer if one is about, and under heal-at-base where
    // the base heals it. (Keeping the hurt out of fire too, and from 75%
    // health, made them so timid they lost the race for base tiles.)
    if (frac < 0.5) {
      if (this.healers(u).some((h) => chebyshev(h, p) <= RULES.medicRange && helpReaches(this.map, h, p))) s += 2 * (1 - frac);
      if (RULES.healOnlyNearBase && nearOwnBase(this.map, this.state, { ...u, x: p.x, y: p.y })) s += 3 * (1 - frac);
    }

    // Support keeps behind the front line.
    const behind = BEHIND[u.kind];
    if (behind) {
      const front = this.front(u, goal);
      if (Number.isFinite(front)) s -= behind.weight * Math.max(0, behind.margin - (this.sense.walk(p, goal) - front));
    }

    switch (u.kind) {
      case "riot": {
        const spot = this.screen.get(key(p));
        if (spot) s += spot.value;
        else if (!armedEnemies.length && this.mine.some((f) => f.id !== u.id && isArmed(f.kind) && chebyshev(f, p) <= 1)) s += 0.5;
        break;
      }
      case "commando": {
        const stealth = stealthRange();
        for (const e of this.enemies) {
          const d = chebyshev(p, e);
          const rear = flankOf(p, e) === "rear";
          if (rear && d <= RULES.traits.backstabFatalRange) s += 4 * (this.sense.worth(e) / 100);
          else if (rear && d <= UNITS[u.kind].range) s += 1.5 * (this.sense.worth(e) / 100);
          else if (distance(p, e) <= stealth) s -= 2;
        }
        // Out of every enemy's stealth range it can't be seen, so can't be shot:
        // scoreTile's worry about standing close doesn't apply to it.
        if (!this.enemies.some((e) => distance(p, e) <= stealth)) s += 1.5 * this.enemies.filter((e) => distance(p, e) < 2.5).length;
        break;
      }
      case "sniper": {
        for (const e of armedEnemies) if (distance(p, e) <= 4) s -= 1;
        if (!(p.x === u.x && p.y === u.y) && armedEnemies.some((e) => distance(p, e) >= 6 && this.shotFrom(u, p, e))) s += 1;
        break;
      }
      case "heavy": {
        const bunched = this.enemies.filter((e) => this.enemies.some((o) => o.id !== e.id && chebyshev(o, e) <= 1));
        if (bunched.some((e) => this.shotFrom(u, p, e))) s += 1;
        for (const e of armedEnemies) if (distance(p, e) < 2.5) s -= 1;
        break;
      }
      case "officer": {
        const led = this.mine.filter(
          (f) => f.id !== u.id && isArmed(f.kind) && chebyshev(f, p) <= RULES.traits.commandRange && helpReaches(this.map, p, f),
        ).length;
        s += Math.min(2.4, 0.6 * led);
        break;
      }
      case "healer": {
        s += Math.min(1.2, 0.3 * this.mine.filter((f) => f.id !== u.id && chebyshev(f, p) <= 1).length);
        s -= (0.5 * this.sense.danger(u, p)) / 30;
        break;
      }
      case "shotgun": {
        // Close in on a side or back: walking at a rifle's face gets a
        // shotgun killed.
        let close = 0;
        for (const e of this.enemies)
          if (distance(p, e) <= UNITS[u.kind].optimal && flankOf(p, e) !== "front" && this.shotFrom(u, p, e)) close += this.sense.worth(e) / 100;
        s += Math.min(2, close);
        break;
      }
      case "scout": {
        for (const e of armedEnemies) if (distance(p, e) <= 3) s -= 1;
        break;
      }
      case "engineer": {
        s -= this.sense.danger(u, p) / 30;
        break;
      }
    }
    return s;
  }

  /** Riots face the enemy they screen from; commandos the enemy they can stab. null = the usual. */
  facing(u: Unit, at: Point): Facing | null {
    if (u.kind === "riot") {
      const spot = this.screen.get(key(at));
      if (spot) return facingToward(at, spot.enemy);
      // Otherwise the most dangerous enemy it can see, shield first.
      const e = [...this.enemies].filter((x) => isArmed(x.kind)).sort((a, b) => distance(at, a) - distance(at, b))[0];
      return e ? facingToward(at, e) : null;
    }
    if (hasTrait(u.kind, "backstab")) {
      const prey = this.enemies
        .filter((e) => flankOf(at, e) === "rear" && distance(at, e) <= UNITS[u.kind].range)
        .sort((a, b) => this.sense.worth(b) - this.sense.worth(a))[0];
      return prey ? facingToward(at, prey) : null;
    }
    return null;
  }

  private shotFrom(u: Unit, p: Point, e: Unit): boolean {
    if (distance(p, e) > UNITS[u.kind].range) return false;
    const moved = u.moved || p.x !== u.x || p.y !== u.y;
    return previewShot(this.map, { ...u, x: p.x, y: p.y, moved, facing: facingToward(p, e) }, e, this.view.units).possible;
  }
}

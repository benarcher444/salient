// Turning a server update into motion. The server sends the new view and the
// events that led to it; this works out, for each unit, where it should be
// drawn at any moment while the update plays out: moves first (everyone at
// once, step by step, the way the rules resolve them), then each shot in turn.
import { facingAngle } from "../game/grid.js";
import { UNITS } from "../game/units.js";
import type { GameEvent, Point, Unit } from "../game/types.js";
import type { PlayerView } from "../game/view.js";

export const STEP_MS = 190;
export const SHOT_MS = 750;

interface Walk {
  path: Point[];
  start: number;
}

export interface Ghost {
  unit: Unit;
  start: number;
  end: number;
  dies: boolean;
}

export interface Tracer {
  from: Point;
  to: Point;
  start: number;
  hit: boolean;
  crit: boolean;
  seat: number;
}

export interface Floater {
  at: Point;
  text: string;
  tone: "hit" | "crit" | "miss" | "info";
  start: number;
}

export interface Pulse {
  site: "post" | "income" | "base";
  index: number;
  seat: number | null;
  start: number;
}

export class Animator {
  private walks = new Map<number, Walk>();
  private appear = new Map<number, number>();
  /** Show this hp until the given time (a shot's impact), then the real value. */
  private hpUntil = new Map<number, { hp: number; until: number }>();
  ghosts: Ghost[] = [];
  tracers: Tracer[] = [];
  floaters: Floater[] = [];
  pulses: Pulse[] = [];
  busyUntil = 0;

  ingest(before: PlayerView | null, after: PlayerView, events: GameEvent[], now: number) {
    if (!before) return;
    const oldUnits = new Map(before.units.map((u) => [u.id, u]));
    const newIds = new Set(after.units.map((u) => u.id));
    let t = now;

    // Moves: one walk per unit seen moving. Own units come with their exact
    // steps; an enemy seen before and after just glides between the two.
    let longest = 0;
    for (const e of events) {
      if (e.type === "move" && e.steps.length > 0) {
        this.walks.set(e.unitId, { path: [e.from, ...e.steps], start: t });
        longest = Math.max(longest, e.steps.length);
      }
    }
    for (const u of after.units) {
      const old = oldUnits.get(u.id);
      if (old && !this.walks.has(u.id) && (old.x !== u.x || old.y !== u.y)) {
        this.walks.set(u.id, { path: [{ x: old.x, y: old.y }, { x: u.x, y: u.y }], start: t });
        longest = Math.max(longest, 2);
      }
    }
    const moveEnd = t + longest * STEP_MS;

    // Units that came into view fade in as the moves finish; ones that left
    // view (and were not shot) fade out where they were last seen.
    const killed = new Set(events.filter((e) => e.type === "shot" && e.killed).map((e) => (e as { targetId: number }).targetId));
    for (const u of after.units) if (!oldUnits.has(u.id)) this.appear.set(u.id, events.some((e) => e.type === "spawn" && e.unit.id === u.id) ? t : moveEnd);
    for (const old of before.units) {
      if (!newIds.has(old.id) && !killed.has(old.id)) this.ghosts.push({ unit: old, start: t, end: t + 500, dies: false });
    }

    // Shots, one after another.
    t = Math.max(moveEnd, t) + (longest > 0 ? 150 : 0);
    for (const e of events) {
      if (e.type !== "shot") continue;
      this.tracers.push({ from: e.from, to: e.to, start: t, hit: e.hit, crit: e.crit, seat: e.shooterSeat });
      const impact = t + 260;
      const label = !e.hit ? "Miss" : e.crit ? `Crit −${e.damage}` : `−${e.damage}`;
      this.floaters.push({ at: e.to, text: label, tone: !e.hit ? "miss" : e.crit ? "crit" : "hit", start: impact });
      const old = oldUnits.get(e.targetId);
      if (old) {
        this.hpUntil.set(e.targetId, { hp: old.hp, until: impact });
        if (e.killed) this.ghosts.push({ unit: old, start: impact, end: impact + 700, dies: true });
      }
      t += SHOT_MS;
    }

    for (const e of events) {
      if (e.type === "capture") this.pulses.push({ site: e.site, index: e.index, seat: e.to, start: t });
    }
    this.busyUntil = Math.max(this.busyUntil, t, moveEnd + 350);
  }

  /** Where to draw a unit now, in tile coordinates of its centre, and its heading. */
  pose(u: Unit, now: number): { x: number; y: number; angle: number; alpha: number } {
    let x = u.x + 0.5;
    let y = u.y + 0.5;
    let angle = facingAngle(u.facing);
    const walk = this.walks.get(u.id);
    if (walk) {
      const elapsed = now - walk.start;
      const steps = walk.path.length - 1;
      const f = Math.max(0, Math.min(steps, elapsed / STEP_MS));
      if (f >= steps) this.walks.delete(u.id);
      else {
        const i = Math.floor(f);
        const a = walk.path[i]!;
        const b = walk.path[i + 1]!;
        const k = ease(f - i);
        x = a.x + (b.x - a.x) * k + 0.5;
        y = a.y + (b.y - a.y) * k + 0.5;
        angle = Math.atan2(b.x - a.x, -(b.y - a.y));
      }
    }
    let alpha = 1;
    const appearAt = this.appear.get(u.id);
    if (appearAt !== undefined) {
      alpha = Math.max(0, Math.min(1, (now - appearAt) / 350));
      if (alpha >= 1) this.appear.delete(u.id);
    }
    return { x, y, angle, alpha };
  }

  hp(u: Unit, now: number): number {
    const held = this.hpUntil.get(u.id);
    if (held && now < held.until) return held.hp;
    if (held) this.hpUntil.delete(u.id);
    return u.hp;
  }

  maxHp = (u: Unit) => UNITS[u.kind].hp;

  /** Drop effects that have finished. */
  prune(now: number) {
    this.ghosts = this.ghosts.filter((g) => now < g.end);
    this.tracers = this.tracers.filter((t) => now < t.start + 500);
    this.floaters = this.floaters.filter((f) => now < f.start + 1300);
    this.pulses = this.pulses.filter((p) => now < p.start + 900);
  }

  get animating() {
    return this.walks.size > 0 || this.appear.size > 0 || this.ghosts.length > 0 || this.tracers.length > 0 || this.floaters.length > 0 || this.pulses.length > 0;
  }
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

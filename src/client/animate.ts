// Turning a server update into motion. The server sends the new view and the
// events that led to it; this works out, for each unit, where it should be
// drawn at any moment while the update plays out: moves first (everyone at
// once, step by step, the way the rules resolve them), then each shot in turn.
import { facingAngle } from "../game/grid.js";
import { UNITS, hasTrait } from "../game/units.js";
import type { GameEvent, Point, Unit } from "../game/types.js";
import type { PlayerView } from "../game/view.js";

export const STEP_MS = 190;
export const SHOT_MS = 750;
/** A unit's death: flash, fall, burst. */
export const DEATH_MS = 1500;
/** The scorch mark it leaves on its tile. */
export const REMAINS_MS = 6000;
/** The camera's glide to a shot at one of your units (Civilization-style), before the shot plays. */
export const FOCUS_MS = 450;

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
  /** An explosive shell: it lands on the target's tile even when it misses, and bursts. */
  blast: boolean;
}

export interface Floater {
  at: Point;
  text: string;
  tone: "hit" | "crit" | "miss" | "info";
  start: number;
}

/** Where a unit fell: a scorch mark in its side's colour, fading. */
export interface Remains {
  at: Point;
  seat: number;
  start: number;
}

/** Bring a shot into view: the camera glides to frame `from` and `to`, starting at `start`. */
export interface Focus {
  from: Point;
  to: Point;
  start: number;
  taken?: boolean;
}

export interface IngestOptions {
  /** Should the camera go to this shot first? (An enemy's shot at one of yours, off screen.) */
  focusOn?: (shot: Extract<GameEvent, { type: "shot" }>) => boolean;
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
  remains: Remains[] = [];
  focus: Focus[] = [];
  busyUntil = 0;

  ingest(before: PlayerView | null, after: PlayerView, events: GameEvent[], now: number, opts: IngestOptions = {}) {
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
    const killed = new Set<number>();
    for (const e of events) {
      if (e.type !== "shot") continue;
      if (e.killed) killed.add(e.targetId);
      for (const x of e.splash) if (x.killed) killed.add(x.unitId);
    }
    for (const u of after.units) if (!oldUnits.has(u.id)) this.appear.set(u.id, events.some((e) => e.type === "spawn" && e.unit.id === u.id) ? t : moveEnd);
    for (const old of before.units) {
      if (!newIds.has(old.id) && !killed.has(old.id)) this.ghosts.push({ unit: old, start: t, end: t + 500, dies: false });
    }

    // Shots, one after another.
    t = Math.max(moveEnd, t) + (longest > 0 ? 150 : 0);
    for (const e of events) {
      if (e.type !== "shot") continue;
      // Like Civilization: the camera goes to a shot at one of yours first.
      if (opts.focusOn?.(e)) {
        this.focus.push({ from: e.from, to: e.to, start: t });
        t += FOCUS_MS;
      }
      const shooter = oldUnits.get(e.shooterId);
      const blast = e.splash.length > 0 || (!!shooter && hasTrait(shooter.kind, "explosive"));
      this.tracers.push({ from: e.from, to: e.to, start: t, hit: e.hit, crit: e.crit, seat: e.shooterSeat, blast });
      const impact = t + 260;
      const label = !e.hit ? "Miss" : e.crit ? `Crit −${e.damage}` : `−${e.damage}`;
      const self = e.splash.find((x) => x.unitId === e.targetId);
      this.floaters.push({ at: e.to, text: self ? `Blast −${self.damage}` : label, tone: !e.hit && !self ? "miss" : e.crit ? "crit" : "hit", start: impact });
      for (const x of e.splash) {
        const victim = oldUnits.get(x.unitId);
        if (x.unitId !== e.targetId) this.floaters.push({ at: x.at, text: `−${x.damage}`, tone: "hit", start: impact + 80 });
        if (!victim) continue;
        if (x.unitId !== e.targetId) this.hpUntil.set(x.unitId, { hp: victim.hp, until: impact });
        if (x.killed) this.die(victim, impact);
      }
      const old = oldUnits.get(e.targetId);
      if (old) {
        this.hpUntil.set(e.targetId, { hp: old.hp, until: impact });
        if (e.killed) this.die(old, impact);
      }
      t += SHOT_MS + (killed.has(e.targetId) || e.splash.some((x) => x.killed) ? DEATH_MS - 700 : 0);
    }

    for (const e of events) {
      if (e.type === "capture") this.pulses.push({ site: e.site, index: e.index, seat: e.to, start: t });
    }
    this.busyUntil = Math.max(this.busyUntil, t, moveEnd + 350);
  }

  /** A unit killed at `at` (ms): its fall, a "Down" label, and the mark it leaves. */
  private die(u: Unit, at: number) {
    this.ghosts.push({ unit: u, start: at, end: at + DEATH_MS, dies: true });
    // Below the unit, clear of the damage figure rising above it.
    this.floaters.push({ at: { x: u.x, y: u.y + 0.95 }, text: "Down", tone: "crit", start: at + 300 });
    this.remains.push({ at: { x: u.x, y: u.y }, seat: u.seat, start: at + 300 });
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

  /** Forget everything in flight: a replay jumping to another step starts clean. */
  reset() {
    this.walks.clear();
    this.appear.clear();
    this.hpUntil.clear();
    this.ghosts = [];
    this.tracers = [];
    this.floaters = [];
    this.pulses = [];
    this.remains = [];
    this.focus = [];
    this.busyUntil = 0;
  }

  /** Drop effects that have finished. */
  prune(now: number) {
    this.ghosts = this.ghosts.filter((g) => now < g.end);
    this.tracers = this.tracers.filter((t) => now < t.start + 500);
    this.floaters = this.floaters.filter((f) => now < f.start + 1300);
    this.pulses = this.pulses.filter((p) => now < p.start + 900);
    this.remains = this.remains.filter((r) => now < r.start + REMAINS_MS);
    this.focus = this.focus.filter((f) => now < f.start + FOCUS_MS);
  }

  get animating() {
    // Remains linger for seconds: they don't hold anything up.
    return this.walks.size > 0 || this.appear.size > 0 || this.ghosts.length > 0 || this.tracers.length > 0 || this.floaters.length > 0 || this.pulses.length > 0 || this.focus.length > 0;
  }
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

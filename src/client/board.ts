// Drawing the battle, every frame: the cached map art, sites, fog, orders,
// units and effects, in that order.
import { previewShot } from "../game/combat.js";
import { facingAngle } from "../game/grid.js";
import { pathTo } from "../game/movement.js";
import { UNIT_GLYPH } from "../game/glyphs.js";
import { UNITS } from "../game/units.js";
import type { Point, Unit } from "../game/types.js";
import { Animator } from "./animate.js";
import { renderMapArt } from "./art.js";
import { Camera } from "./camera.js";
import { alpha, readPalette, shade, type Palette } from "./palette.js";
import {
  canPlan,
  isMine,
  isMyAttackTurn,
  moveOrderFor,
  mySeat,
  mySpawnTiles,
  reachOf,
  targetsOf,
  unitById,
  type ClientState,
} from "./state.js";

const FOG_PX = 4;

const glyphs = new Map<string, Path2D>();
const glyphPath = (kind: Unit["kind"]) => {
  let p = glyphs.get(kind);
  if (!p) glyphs.set(kind, (p = new Path2D(UNIT_GLYPH[kind])));
  return p;
};

export class Board {
  readonly ctx: CanvasRenderingContext2D;
  readonly camera: Camera;
  readonly anim = new Animator();
  private art: HTMLCanvasElement | null = null;
  private fog: HTMLCanvasElement;
  private fogFor: unknown = null;
  pal: Palette;
  private w = 0;
  private h = 0;
  /** Set once the player pans or zooms; from then on resizes leave the view alone. */
  userMoved = false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly s: ClientState,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.camera = new Camera(s.map.width, s.map.height);
    this.pal = readPalette();
    this.fog = document.createElement("canvas");
    this.fog.width = s.map.width * FOG_PX;
    this.fog.height = s.map.height * FOG_PX;
  }

  /** Re-read colours (theme change) and redraw the map art. */
  repaint() {
    this.pal = readPalette();
    this.art = renderMapArt(this.s.map, this.pal);
    this.fogFor = null;
  }

  resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    // Keep the whole map in view as the layout settles (the panel fills in,
    // a phone rotates) until the player pans or zooms themselves.
    if (!this.userMoved) this.camera.fit(this.w, this.h);
  }

  fit() {
    this.userMoved = false;
    this.camera.fit(this.w, this.h);
  }

  get viewSize() {
    return { w: this.w, h: this.h };
  }

  tileAt(sx: number, sy: number): Point | null {
    const p = this.camera.toWorld(sx, sy);
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= this.s.map.width || y >= this.s.map.height) return null;
    return { x, y };
  }

  draw(now: number) {
    const g = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const cam = this.camera;
    cam.clamp(this.w, this.h);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    if (!this.art) this.repaint();

    // Everything below is drawn in tile coordinates.
    g.save();
    g.translate(-cam.x * cam.scale, -cam.y * cam.scale);
    g.scale(cam.scale, cam.scale);

    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(this.art!, 0, 0, this.s.map.width, this.s.map.height);
    this.drawSites(now);
    this.drawFog();
    this.drawPlanning(now);
    this.drawAttack(now);
    this.drawUnits(now);
    this.drawEffects(now);
    this.drawHover();

    g.restore();
    this.anim.prune(now);
  }

  private drawFog() {
    const v = this.s.view;
    if (!v) return;
    const w = this.s.map.width;
    const h = this.s.map.height;
    if (this.fogFor !== v) {
      // FOG_PX pixels per tile, upscaled with smoothing: the edge of the fog
      // softens over about a quarter of a tile. One pixel per tile looked like
      // clouds; a hard edge looked like a spreadsheet.
      const f = this.fog.getContext("2d")!;
      f.clearRect(0, 0, this.fog.width, this.fog.height);
      f.fillStyle = this.pal.fog;
      const visible = new Set(v.visible);
      for (let i = 0; i < w * h; i++) {
        if (!visible.has(i)) f.fillRect((i % w) * FOG_PX, Math.floor(i / w) * FOG_PX, FOG_PX, FOG_PX);
      }
      this.fogFor = v;
    }
    const g = this.ctx;
    g.save();
    g.globalAlpha = 0.58;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.fog, 0, 0, w, h);
    g.restore();
  }

  private drawSites(now: number) {
    const g = this.ctx;
    const v = this.s.view;
    const map = this.s.map;
    const pulse = (site: "post" | "income", i: number) => this.anim.pulses.find((p) => p.site === site && p.index === i);

    map.posts.forEach((p, i) => {
      const owner = v?.postOwners[i] ?? null;
      const colour = owner === null ? this.pal.post : this.pal.seats[owner]!;
      const cx = p.x + 0.5;
      const cy = p.y + 0.5;
      g.fillStyle = alpha(this.pal.paper, 0.9);
      g.beginPath();
      g.arc(cx, cy, 0.42, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = colour;
      g.lineWidth = 0.08;
      g.stroke();
      g.setLineDash([0.12, 0.08]);
      g.lineWidth = 0.03;
      g.beginPath();
      g.arc(cx, cy, 0.32, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      // Flag
      g.strokeStyle = this.pal.ink;
      g.lineWidth = 0.045;
      g.beginPath();
      g.moveTo(cx - 0.1, cy + 0.2);
      g.lineTo(cx - 0.1, cy - 0.24);
      g.stroke();
      g.fillStyle = owner === null ? shade(this.pal.post, 0.35) : colour;
      g.beginPath();
      const wave = Math.sin(now / 400 + i) * 0.03;
      g.moveTo(cx - 0.08, cy - 0.24);
      g.quadraticCurveTo(cx + 0.06, cy - 0.2 + wave, cx + 0.2, cy - 0.16);
      g.quadraticCurveTo(cx + 0.06, cy - 0.1 + wave, cx - 0.08, cy - 0.06);
      g.closePath();
      g.fill();
      const pl = pulse("post", i);
      if (pl) this.ring(cx, cy, pl.seat === null ? this.pal.post : this.pal.seats[pl.seat]!, (now - pl.start) / 900);
    });

    map.income.forEach((p, i) => {
      const owner = v?.incomeOwners[i] ?? null;
      const cx = p.x + 0.5;
      const cy = p.y + 0.5;
      g.save();
      g.translate(cx, cy);
      g.rotate(Math.PI / 4);
      const grad = g.createLinearGradient(-0.25, -0.25, 0.25, 0.25);
      grad.addColorStop(0, shade(this.pal.income, 0.35));
      grad.addColorStop(1, shade(this.pal.income, -0.2));
      g.fillStyle = grad;
      g.fillRect(-0.24, -0.24, 0.48, 0.48);
      g.strokeStyle = owner === null ? shade(this.pal.income, -0.4) : this.pal.seats[owner]!;
      g.lineWidth = owner === null ? 0.04 : 0.09;
      g.strokeRect(-0.24, -0.24, 0.48, 0.48);
      g.restore();
      // A glint that sweeps across now and then.
      const glint = (now / 1600 + i * 0.37) % 1;
      if (glint < 0.25) {
        g.fillStyle = alpha("#ffffff", 0.7 * (1 - glint * 4));
        g.beginPath();
        g.arc(cx - 0.08, cy - 0.1, 0.05, 0, Math.PI * 2);
        g.fill();
      }
      const pl = pulse("income", i);
      if (pl) this.ring(cx, cy, pl.seat === null ? this.pal.income : this.pal.seats[pl.seat]!, (now - pl.start) / 900);
    });
  }

  private ring(cx: number, cy: number, colour: string, t: number) {
    if (t < 0 || t > 1) return;
    const g = this.ctx;
    g.strokeStyle = alpha(colourHex(colour), 1 - t);
    g.lineWidth = 0.08;
    g.beginPath();
    g.arc(cx, cy, 0.45 + t * 0.9, 0, Math.PI * 2);
    g.stroke();
  }

  private drawPlanning(now: number) {
    const s = this.s;
    const v = s.view;
    const seat = mySeat(s);
    if (!v || seat === null || v.phase !== "planning") return;
    const g = this.ctx;
    const mine = this.pal.seats[seat]!;

    if (canPlan(s)) {
      // Where you can deploy.
      const breathe = 0.5 + Math.sin(now / 500) * 0.15;
      for (const p of mySpawnTiles(s)) {
        g.strokeStyle = alpha(mine, breathe);
        g.lineWidth = 0.05;
        g.setLineDash([0.14, 0.1]);
        g.strokeRect(p.x + 0.1, p.y + 0.1, 0.8, 0.8);
        g.setLineDash([]);
      }
    }

    // The selected unit's reach and the route to the hovered tile.
    const sel = s.selected;
    if (canPlan(s) && sel?.type === "unit") {
      const u = unitById(s, sel.id);
      if (u && isMine(s, u)) {
        const reach = reachOf(s, u);
        g.fillStyle = this.pal.reach;
        for (const idx of reach.cost.keys()) {
          const x = idx % s.map.width;
          const y = Math.floor(idx / s.map.width);
          g.fillRect(x + 0.04, y + 0.04, 0.92, 0.92);
        }
        if (s.hover && reach.cost.has(s.hover.y * s.map.width + s.hover.x)) {
          const path = pathTo(s.map, reach, s.hover);
          if (path && path.length) this.route(u, path, this.pal.path, true);
        }
      }
    }

    // Every drafted move: its route and a ghost where it will end up.
    const orders = canPlan(s) ? s.draft : (v.myOrders ?? { moves: [], spawns: [] });
    for (const m of orders.moves) {
      const u = unitById(s, m.unitId);
      if (!u) continue;
      if (m.path.length) this.route(u, m.path, mine, false);
      const end = m.path.length ? m.path[m.path.length - 1]! : u;
      if (m.path.length) this.token(u, end.x + 0.5, end.y + 0.5, facingAngle(m.facing), 0.5, { ghost: true });
      this.arc(end.x + 0.5, end.y + 0.5, u.kind, m.facing, mine, 0.1);
    }
    orders.spawns.forEach((sp, i) => {
      const fake: Unit = { id: -1 - i, seat, kind: sp.kind, x: sp.x, y: sp.y, facing: sp.facing, hp: UNITS[sp.kind].hp, moved: false, damaged: false };
      const selected = sel?.type === "spawn" && sel.index === i;
      this.token(fake, sp.x + 0.5, sp.y + 0.5, facingAngle(sp.facing), 0.6, { ghost: true, selected, badge: "+" });
      this.arc(sp.x + 0.5, sp.y + 0.5, sp.kind, sp.facing, mine, selected ? 0.14 : 0.07);
    });

    if (sel?.type === "spawnTile") {
      g.strokeStyle = mine;
      g.lineWidth = 0.08;
      g.strokeRect(sel.x + 0.06, sel.y + 0.06, 0.88, 0.88);
    }
  }

  private route(u: Unit, path: Point[], hex: string, preview: boolean) {
    const g = this.ctx;
    const colour = alpha(hex, preview ? 0.9 : 0.85);
    g.strokeStyle = colour;
    g.lineWidth = preview ? 0.07 : 0.09;
    g.setLineDash(preview ? [0.12, 0.12] : []);
    g.beginPath();
    g.moveTo(u.x + 0.5, u.y + 0.5);
    for (const p of path) g.lineTo(p.x + 0.5, p.y + 0.5);
    g.stroke();
    g.setLineDash([]);
    // Arrowhead at the end.
    const end = path[path.length - 1]!;
    const prev = path.length > 1 ? path[path.length - 2]! : u;
    const a = Math.atan2(end.y - prev.y, end.x - prev.x);
    const ex = end.x + 0.5 - Math.cos(a) * 0.3;
    const ey = end.y + 0.5 - Math.sin(a) * 0.3;
    g.fillStyle = colour;
    g.beginPath();
    g.moveTo(ex + Math.cos(a) * 0.16, ey + Math.sin(a) * 0.16);
    g.lineTo(ex + Math.cos(a + 2.4) * 0.16, ey + Math.sin(a + 2.4) * 0.16);
    g.lineTo(ex + Math.cos(a - 2.4) * 0.16, ey + Math.sin(a - 2.4) * 0.16);
    g.closePath();
    g.fill();
    if (preview) {
      g.fillStyle = alpha(hex, 0.25);
      g.fillRect(end.x + 0.08, end.y + 0.08, 0.84, 0.84);
    }
  }

  /** The firing arc as a soft wedge out to the unit's range. */
  private arc(cx: number, cy: number, kind: Unit["kind"], facing: number, colour: string, strength: number) {
    const g = this.ctx;
    const st = UNITS[kind];
    const heading = facingAngle(facing as Unit["facing"]) - Math.PI / 2;
    const half = ((st.arc / 2) * Math.PI) / 180;
    const grad = g.createRadialGradient(cx, cy, 0.3, cx, cy, st.range);
    grad.addColorStop(0, alpha(colourHex(colour), strength * 1.8));
    grad.addColorStop(1, alpha(colourHex(colour), 0));
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, st.range, heading - half, heading + half);
    g.closePath();
    g.fill();
    g.strokeStyle = alpha(colourHex(colour), strength * 2.5);
    g.lineWidth = 0.03;
    g.stroke();
  }

  private drawAttack(now: number) {
    const s = this.s;
    const v = s.view;
    if (!v || v.phase !== "attack") return;
    const sel = s.selected;
    const shooterId = sel?.type === "unit" ? sel.id : sel?.type === "target" ? sel.shooterId : null;
    const shooter = shooterId !== null ? unitById(s, shooterId) : undefined;
    if (!shooter || !isMine(s, shooter)) return;
    const pose = this.anim.pose(shooter, now);
    this.arc(pose.x, pose.y, shooter.kind, shooter.facing, this.pal.seats[shooter.seat]!, 0.12);
    if (!isMyAttackTurn(s) || v.acted.includes(shooter.id)) return;
    const g = this.ctx;
    // Reticles wait until the update has finished playing out, so they never
    // sit over a unit that is still walking or fading into view.
    if (now < this.anim.busyUntil) return;
    for (const t of targetsOf(s, shooter)) {
      const p = previewShot(s.map, shooter, t);
      const chosen = sel?.type === "target" && sel.targetId === t.id;
      const tx = t.x + 0.5;
      const ty = t.y + 0.5;
      if (chosen) {
        g.strokeStyle = alpha(colourHex(this.pal.danger), 0.85);
        g.lineWidth = 0.05;
        g.setLineDash([0.15, 0.1]);
        g.beginPath();
        g.moveTo(pose.x, pose.y);
        g.lineTo(tx, ty);
        g.stroke();
        g.setLineDash([]);
      }
      // Reticle.
      const spin = now / 1200;
      g.strokeStyle = this.pal.danger;
      g.lineWidth = chosen ? 0.07 : 0.045;
      for (let k = 0; k < 4; k++) {
        const a = spin + (k * Math.PI) / 2;
        g.beginPath();
        g.arc(tx, ty, 0.56, a, a + 0.9);
        g.stroke();
      }
      this.label(`${Math.round(p.chance * 100)}%`, tx, ty - 0.8, chosen ? this.pal.danger : this.pal.ink);
    }
  }

  /**
   * A small pill of text at a point on the map. Drawn in screen pixels, not
   * tile units: fonts a fraction of a pixel tall render unreliably when
   * scaled up by the canvas transform.
   */
  private label(text: string, x: number, y: number, bg: string, size = 12) {
    const g = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const sp = this.camera.toScreen(x, y);
    g.save();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.font = `700 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const w = g.measureText(text).width + size * 0.9;
    const h = size * 1.55;
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(sp.x - w / 2, sp.y - h / 2, w, h, h / 2);
    g.fill();
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, sp.x, sp.y + 0.5);
    g.restore();
  }

  private drawUnits(now: number) {
    const s = this.s;
    const v = s.view;
    if (!v) return;
    const sel = s.selected;
    const myTurn = isMyAttackTurn(s);
    const ready = new Set(v.readyShooters);
    for (const u of v.units) {
      const p = this.anim.pose(u, now);
      const acted = v.phase === "attack" && v.acted.includes(u.id);
      const isSel = (sel?.type === "unit" && sel.id === u.id) || (sel?.type === "target" && (sel.shooterId === u.id || sel.targetId === u.id));
      this.token(u, p.x, p.y, p.angle, p.alpha * (acted ? 0.6 : 1), {
        selected: isSel,
        ready: myTurn && ready.has(u.id) && !acted,
        hp: this.anim.hp(u, now),
        now,
        moving: !!moveOrderFor(s, u.id)?.path.length && v.phase === "planning",
      });
    }
    for (const gh of this.anim.ghosts) {
      if (now < gh.start) {
        const p = this.anim.pose(gh.unit, now);
        this.token(gh.unit, p.x, p.y, p.angle, 1, { hp: gh.unit.hp, now });
        continue;
      }
      const t = (now - gh.start) / (gh.end - gh.start);
      const x = gh.unit.x + 0.5;
      const y = gh.unit.y + 0.5;
      if (gh.dies) {
        this.burst(x, y, this.pal.seats[gh.unit.seat]!, t);
        this.token(gh.unit, x, y, facingAngle(gh.unit.facing), Math.max(0, 1 - t * 1.6), { hp: 0, now, scale: 1 + t * 0.3 });
      } else {
        this.token(gh.unit, x, y, facingAngle(gh.unit.facing), Math.max(0, 1 - t), { hp: gh.unit.hp, now });
      }
    }
  }

  private burst(x: number, y: number, colour: string, t: number) {
    const g = this.ctx;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + i;
      const d = 0.2 + t * (0.6 + (i % 3) * 0.2);
      g.fillStyle = alpha(colourHex(i % 2 ? colour : this.pal.warn), Math.max(0, 1 - t));
      g.beginPath();
      g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.07 * (1 - t) + 0.02, 0, Math.PI * 2);
      g.fill();
    }
  }

  /**
   * A unit token: a coloured disc with the class symbol, a nose showing which
   * way it faces, and a health ring.
   */
  token(
    u: Unit,
    cx: number,
    cy: number,
    angle: number,
    opacity: number,
    o: { selected?: boolean; ready?: boolean; ghost?: boolean; hp?: number; now?: number; badge?: string; moving?: boolean; scale?: number } = {},
  ) {
    if (opacity <= 0) return;
    const g = this.ctx;
    const colour = this.pal.seats[u.seat]!;
    const r = 0.38 * (o.scale ?? 1);
    g.save();
    g.globalAlpha = opacity;

    if (!o.ghost) {
      g.fillStyle = this.pal.shadow;
      g.beginPath();
      g.ellipse(cx + 0.05, cy + 0.08, r * 1.02, r * 0.95, 0, 0, Math.PI * 2);
      g.fill();
    }

    if (o.ready && o.now !== undefined) {
      const t = (o.now % 1400) / 1400;
      g.strokeStyle = alpha(colourHex(this.pal.warn), 1 - t);
      g.lineWidth = 0.06;
      g.beginPath();
      g.arc(cx, cy, r + 0.08 + t * 0.25, 0, Math.PI * 2);
      g.stroke();
    }
    if (o.selected) {
      g.strokeStyle = this.pal.paper;
      g.lineWidth = 0.1;
      g.beginPath();
      g.arc(cx, cy, r + 0.14, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = this.pal.ink;
      g.lineWidth = 0.04;
      g.stroke();
    }

    // The nose: a small wedge on the rim pointing where the unit faces.
    const heading = angle - Math.PI / 2;
    g.fillStyle = colour;
    g.beginPath();
    g.moveTo(cx + Math.cos(heading) * (r + 0.17), cy + Math.sin(heading) * (r + 0.17));
    g.lineTo(cx + Math.cos(heading + 0.55) * (r - 0.02), cy + Math.sin(heading + 0.55) * (r - 0.02));
    g.lineTo(cx + Math.cos(heading - 0.55) * (r - 0.02), cy + Math.sin(heading - 0.55) * (r - 0.02));
    g.closePath();
    g.fill();

    const grad = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    grad.addColorStop(0, shade(colour, 0.25));
    grad.addColorStop(1, shade(colour, -0.2));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = shade(colour, -0.45);
    g.beginPath();
    g.arc(cx, cy, r * 0.74, 0, Math.PI * 2);
    g.fill();
    if (o.ghost) {
      g.setLineDash([0.08, 0.06]);
      g.strokeStyle = this.pal.paper;
      g.lineWidth = 0.035;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }

    g.save();
    g.translate(cx - r * 0.55, cy - r * 0.55);
    g.scale((r * 1.1) / 24, (r * 1.1) / 24);
    g.strokeStyle = "#ffffff";
    g.lineWidth = 2.2;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.stroke(glyphPath(u.kind));
    g.restore();

    if (!o.ghost && o.hp !== undefined) {
      const max = UNITS[u.kind].hp;
      const f = Math.max(0, Math.min(1, o.hp / max));
      g.strokeStyle = alpha("#000000", 0.35);
      g.lineWidth = 0.07;
      g.beginPath();
      g.arc(cx, cy, r + 0.06, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = f > 0.6 ? this.pal.ok : f > 0.3 ? this.pal.warn : this.pal.danger;
      g.beginPath();
      g.arc(cx, cy, r + 0.06, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
      g.stroke();
    }
    if (o.badge) {
      // A small "+" disc: drawn as strokes, not text, so it stays crisp.
      const bx = cx + r * 0.8;
      const by = cy - r * 0.8;
      g.fillStyle = this.pal.ink;
      g.beginPath();
      g.arc(bx, by, 0.15, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#ffffff";
      g.lineWidth = 0.045;
      g.beginPath();
      g.moveTo(bx - 0.08, by);
      g.lineTo(bx + 0.08, by);
      g.moveTo(bx, by - 0.08);
      g.lineTo(bx, by + 0.08);
      g.stroke();
    }
    g.restore();
  }

  private drawEffects(now: number) {
    const g = this.ctx;
    for (const t of this.anim.tracers) {
      const k = (now - t.start) / 260;
      if (k < 0) continue;
      const fx = t.from.x + 0.5;
      const fy = t.from.y + 0.5;
      let tx = t.to.x + 0.5;
      let ty = t.to.y + 0.5;
      if (!t.hit) {
        // A miss flies past, a little to one side.
        const a = Math.atan2(ty - fy, tx - fx) + 0.12;
        const d = Math.hypot(tx - fx, ty - fy) + 1;
        tx = fx + Math.cos(a) * d;
        ty = fy + Math.sin(a) * d;
      }
      const head = Math.min(1, k);
      const tail = Math.max(0, Math.min(1, k - 0.35));
      const fade = Math.max(0, 1 - (now - t.start - 260) / 240);
      const hx = fx + (tx - fx) * head;
      const hy = fy + (ty - fy) * head;
      g.strokeStyle = alpha(colourHex(t.crit ? this.pal.warn : "#fff3c4"), fade);
      g.lineWidth = t.crit ? 0.09 : 0.06;
      g.beginPath();
      g.moveTo(fx + (tx - fx) * tail, fy + (ty - fy) * tail);
      g.lineTo(hx, hy);
      g.stroke();
      if (k < 0.4) {
        g.fillStyle = alpha("#fff3c4", 1 - k / 0.4);
        g.beginPath();
        g.arc(fx, fy, 0.22, 0, Math.PI * 2);
        g.fill();
      }
      if (t.hit && k >= 1) this.burst(tx, ty, this.pal.danger, Math.min(1, (now - t.start - 260) / 400));
    }
    for (const f of this.anim.floaters) {
      const k = (now - f.start) / 1300;
      if (k < 0) continue;
      const colour = f.tone === "miss" ? this.pal.ink : f.tone === "crit" ? this.pal.warn : this.pal.danger;
      g.save();
      g.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.6) / 0.4);
      this.label(f.text, f.at.x + 0.5, f.at.y - 0.2 - k * 0.6, colour);
      g.restore();
    }
  }

  private drawHover() {
    const h = this.s.hover;
    if (!h) return;
    const g = this.ctx;
    g.strokeStyle = alpha(colourHex(this.pal.paper), 0.8);
    g.lineWidth = 0.04;
    g.strokeRect(h.x + 0.03, h.y + 0.03, 0.94, 0.94);
  }
}

/** Colours from the palette are hex; this tolerates the odd rgb() too by falling back to white. */
function colourHex(c: string): string {
  return c.startsWith("#") ? c : "#ffffff";
}


// Drawing the battle, every frame: the cached map art, sites, fog, orders,
// units and effects, in that order.
import { damageRange, previewShot } from "../game/combat.js";
import { RULES } from "../game/constants.js";
import { facingAngle, facingToward } from "../game/grid.js";
import { pathTo } from "../game/movement.js";
import { UNIT_GLYPH, UNIT_SHAPE, UNIT_SIZE, shapeFront } from "../game/glyphs.js";
import { UNITS, hasTrait } from "../game/units.js";
import { baseTiles } from "../game/visibility.js";
import type { Point, Unit } from "../game/types.js";
import { Animator, FOCUS_MS, REMAINS_MS } from "./animate.js";
import { renderMapArt } from "./art.js";
import { drawIncome, drawPost } from "./sites.js";
import { Camera } from "./camera.js";
import { alpha, readPalette, shade, type Palette } from "./palette.js";
import {
  canPlan,
  firstLeg,
  fullPathTo,
  isMine,
  isMyAttackTurn,
  moveOrderFor,
  mySeat,
  mySpawnTiles,
  reachOf,
  routePlan,
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
  /** The camera gliding to a shot (see Animator.focus), in tile coordinates. */
  private glide: { fromX: number; fromY: number; toX: number; toY: number; start: number } | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly s: ClientState,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.camera = new Camera(s.map.width, s.map.height, true);
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
    if (!this.userMoved) this.fitHome();
  }

  fit() {
    this.userMoved = false;
    this.fitHome();
  }

  /** Zoom out to the whole map (Z, the fit button): as far out as the camera goes. */
  showWhole() {
    this.userMoved = true;
    this.camera.fit(this.w, this.h, 12, true);
    this.camera.clamp(this.w, this.h);
  }

  /**
   * Fill the view and, where the map is cropped, centre on this player's own
   * base, so what they deploy onto is on screen. (Filling, it never shows
   * past an edge; zooming out from here can show the whole map.)
   */
  private fitHome() {
    this.camera.fit(this.w, this.h);
    const v = this.s.view;
    const seat = v?.seat ?? null;
    if (!v || seat === null) return;
    const home = baseTiles(this.s.map, v.seats.length).filter((t, i) => v.baseOwners[i] === seat || t.home === seat);
    if (!home.length) return;
    const cx = home.reduce((t, p) => t + p.x + 0.5, 0) / home.length;
    const cy = home.reduce((t, p) => t + p.y + 0.5, 0) / home.length;
    this.camera.x = cx - this.w / this.camera.scale / 2;
    this.camera.y = cy - this.h / this.camera.scale / 2;
    this.camera.clamp(this.w, this.h);
  }

  /**
   * Is this tile comfortably on screen (inside the middle of the view, not
   * at an edge where the shot would be half out of sight)?
   */
  inView(p: Point, margin = 0.15): boolean {
    const sp = this.camera.toScreen(p.x + 0.5, p.y + 0.5);
    return sp.x > this.w * margin && sp.x < this.w * (1 - margin) && sp.y > this.h * margin && sp.y < this.h * (1 - margin);
  }

  /**
   * The camera's glide to a shot at one of your units, like Civilization:
   * it frames shooter and target together when they fit, the target alone
   * when not, and doesn't move at all if the target is already well in view.
   */
  private follow(now: number) {
    for (const f of this.anim.focus) {
      if (f.taken || now < f.start) continue;
      f.taken = true;
      if (this.inView(f.to)) continue;
      const visW = this.w / this.camera.scale;
      const visH = this.h / this.camera.scale;
      const both = Math.abs(f.from.x - f.to.x) + 2 < visW * 0.8 && Math.abs(f.from.y - f.to.y) + 2 < visH * 0.8;
      const c = both ? { x: (f.from.x + f.to.x) / 2 + 0.5, y: (f.from.y + f.to.y) / 2 + 0.5 } : { x: f.to.x + 0.5, y: f.to.y + 0.5 };
      // Work out where the clamp would let it end, so the glide doesn't jump at the end.
      const save = { x: this.camera.x, y: this.camera.y };
      this.camera.x = c.x - visW / 2;
      this.camera.y = c.y - visH / 2;
      this.camera.clamp(this.w, this.h);
      this.glide = { fromX: save.x, fromY: save.y, toX: this.camera.x, toY: this.camera.y, start: now };
      this.camera.x = save.x;
      this.camera.y = save.y;
      this.userMoved = true;
    }
    if (this.glide) {
      const k = Math.min(1, (now - this.glide.start) / (FOCUS_MS - 50));
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.camera.x = this.glide.fromX + (this.glide.toX - this.glide.fromX) * e;
      this.camera.y = this.glide.fromY + (this.glide.toY - this.glide.fromY) * e;
      if (k >= 1) this.glide = null;
    }
  }

  /** Stop a glide: the player took the camera (panned, zoomed, clicked the minimap). */
  stopGlide() {
    this.glide = null;
  }

  /** Centre the view on a point of the map (in tiles), as far as the edges allow. */
  centreOn(p: { x: number; y: number }) {
    this.camera.x = p.x - this.w / this.camera.scale / 2;
    this.camera.y = p.y - this.h / this.camera.scale / 2;
    this.camera.clamp(this.w, this.h);
  }

  /** Where the map sits inside the minimap canvas: CSS pixels per tile and the offset. */
  private minimapFit(target: HTMLCanvasElement) {
    const r = target.getBoundingClientRect();
    const k = Math.min(r.width / this.s.map.width, r.height / this.s.map.height);
    return { r, k, ox: (r.width - this.s.map.width * k) / 2, oy: (r.height - this.s.map.height * k) / 2 };
  }

  /** The map point (in tiles) under a point of the minimap (CSS pixels from its corner). */
  minimapToWorld(target: HTMLCanvasElement, cx: number, cy: number) {
    const { k, ox, oy } = this.minimapFit(target);
    return { x: (cx - ox) / k, y: (cy - oy) / k };
  }

  /**
   * The whole map, small: terrain, fog, every unit this player can see as a
   * dot in its side's colour, and a box round the part the board shows.
   */
  drawMinimap(target: HTMLCanvasElement, now: number) {
    const s = this.s;
    const { r, k, ox, oy } = this.minimapFit(target);
    if (!r.width || !r.height) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(r.width * dpr);
    const H = Math.round(r.height * dpr);
    if (target.width !== W || target.height !== H) {
      target.width = W;
      target.height = H;
    }
    const g = target.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    if (!this.art) this.repaint();
    g.translate(ox, oy);
    g.scale(k, k);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(this.art!, 0, 0, s.map.width, s.map.height);
    const v = s.view;
    if (v) {
      g.globalAlpha = 0.58;
      g.drawImage(this.fog, 0, 0, s.map.width, s.map.height);
      g.globalAlpha = 1;
      for (const u of v.units) {
        const p = this.anim.pose(u, now);
        if (p.alpha <= 0) continue;
        g.fillStyle = this.pal.seats[u.seat]!;
        g.strokeStyle = this.pal.paper;
        g.lineWidth = 1.5 / k;
        g.beginPath();
        g.arc(p.x, p.y, Math.max(0.5, 3.2 / k), 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }
    // The board's view, in ink over a paper halo so it reads on any terrain.
    const cam = this.camera;
    const vw = this.w / cam.scale;
    const vh = this.h / cam.scale;
    for (const [width, colour] of [
      [4, alpha(colourHex(this.pal.paper), 0.85)],
      [2, this.pal.ink],
    ] as const) {
      g.strokeStyle = colour;
      g.lineWidth = width / k;
      g.strokeRect(cam.x, cam.y, vw, vh);
    }
  }

  /** Pan just enough to keep a tile, and a tile around it, on screen. True if the view moved. */
  reveal(p: Point): boolean {
    const cam = this.camera;
    const visW = this.w / cam.scale;
    const visH = this.h / cam.scale;
    const x0 = cam.x;
    const y0 = cam.y;
    // Only once the tile itself is (partly) off screen, then with a tile to spare.
    if (p.x < cam.x) cam.x = p.x - 1;
    else if (p.x + 1 > cam.x + visW) cam.x = p.x + 2 - visW;
    if (p.y < cam.y) cam.y = p.y - 1;
    else if (p.y + 1 > cam.y + visH) cam.y = p.y + 2 - visH;
    cam.clamp(this.w, this.h);
    return cam.x !== x0 || cam.y !== y0;
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
    this.follow(now);
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
    this.drawBaseOwners();
    this.drawSites(now);
    this.drawFog();
    this.drawPlanning(now);
    this.drawAttack(now);
    this.drawCursorArc(now);
    this.drawRemains(now);
    this.drawUnits(now);
    this.drawSiteBadges();
    this.drawEffects(now);
    this.drawHover(now);

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

  /**
   * Base tiles no longer held by their home side. The cached art paints every
   * base in its home colour; a captured tile is washed in its captor's colour
   * with a flag in the corner, a neutral one is greyed out with a dashed edge.
   */
  private drawBaseOwners() {
    const v = this.s.view;
    if (!v) return;
    const g = this.ctx;
    baseTiles(this.s.map, v.seats.length).forEach((t, i) => {
      const owner = v.baseOwners[i] ?? null;
      // (A capture under way is drawn over the unit taking it: drawSiteBadges.)
      // Heal-at-base house rule: a faint wash on the tiles round your own
      // base tiles, where your units heal.
      if (RULES.healOnlyNearBase && owner !== null && owner === v.seat) {
        g.fillStyle = alpha(colourHex(this.pal.seats[owner]!), 0.1);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = t.x + dx;
          const y = t.y + dy;
          if (x >= 0 && y >= 0 && x < this.s.map.width && y < this.s.map.height && !(dx === 0 && dy === 0)) g.fillRect(x, y, 1, 1);
        }
      }
      if (owner === t.home) return;
      g.save();
      if (owner === null) {
        g.fillStyle = alpha(colourHex(this.pal.paper), 0.6);
        g.fillRect(t.x, t.y, 1, 1);
        g.strokeStyle = alpha(colourHex(this.pal.ink), 0.55);
        g.lineWidth = 0.05;
        g.setLineDash([0.12, 0.1]);
        g.strokeRect(t.x + 0.08, t.y + 0.08, 0.84, 0.84);
      } else {
        const c = this.pal.seats[owner]!;
        g.fillStyle = alpha(colourHex(this.pal.paper), 0.35);
        g.fillRect(t.x, t.y, 1, 1);
        g.fillStyle = alpha(c, 0.42);
        g.fillRect(t.x, t.y, 1, 1);
        g.strokeStyle = alpha(c, 0.95);
        g.lineWidth = 0.07;
        g.strokeRect(t.x + 0.06, t.y + 0.06, 0.88, 0.88);
        // A small flag: this tile is someone else's spawn point now.
        g.fillStyle = c;
        g.beginPath();
        g.moveTo(t.x + 0.14, t.y + 0.14);
        g.lineTo(t.x + 0.42, t.y + 0.14);
        g.lineTo(t.x + 0.14, t.y + 0.42);
        g.closePath();
        g.fill();
      }
      g.restore();
    });
  }

  /**
   * A unit covers the tile under it, and with it the site's colours: so on
   * every occupied command post and supply depot, and every occupied base
   * tile that isn't simply its own side's unit on its own tile, a badge in
   * the tile's corner, over the unit, says whose it is now (the owner's
   * colour, a dashed grey ring when nobody's), with the site's own sign: a
   * flag, a diamond, a square. A capture under way shows its progress, one
   * pip per round held, in the taker's colour.
   */
  private drawSiteBadges() {
    const v = this.s.view;
    if (!v) return;
    const g = this.ctx;
    const map = this.s.map;
    const occupied = (p: Point) => v.units.some((u) => u.x === p.x && u.y === p.y);
    const badge = (p: Point, owner: number | null, sign: "post" | "income" | "base") => {
      const cx = p.x + 0.84;
      const cy = p.y + 0.16;
      const r = 0.23;
      // The sign is drawn for a badge of radius 0.17, scaled up.
      g.save();
      g.translate(cx, cy);
      g.scale(r / 0.17, r / 0.17);
      g.translate(-cx, -cy);
      const colour = owner === null ? colourHex(this.pal.paper) : colourHex(this.pal.seats[owner]!);
      g.fillStyle = colour;
      g.strokeStyle = owner === null ? alpha(colourHex(this.pal.ink), 0.8) : "#ffffff";
      g.lineWidth = 0.035;
      g.setLineDash(owner === null ? [0.06, 0.05] : []);
      g.beginPath();
      g.arc(cx, cy, 0.17, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.setLineDash([]);
      const ink = owner === null ? colourHex(this.pal.ink) : "#ffffff";
      g.fillStyle = ink;
      g.strokeStyle = ink;
      g.lineWidth = 0.025;
      g.beginPath();
      if (sign === "post") {
        g.moveTo(cx - 0.05, cy + 0.09);
        g.lineTo(cx - 0.05, cy - 0.09);
        g.stroke();
        g.beginPath();
        g.moveTo(cx - 0.05, cy - 0.09);
        g.lineTo(cx + 0.08, cy - 0.05);
        g.lineTo(cx - 0.05, cy - 0.01);
        g.closePath();
        g.fill();
      } else if (sign === "income") {
        g.moveTo(cx, cy - 0.09);
        g.lineTo(cx + 0.08, cy);
        g.lineTo(cx, cy + 0.09);
        g.lineTo(cx - 0.08, cy);
        g.closePath();
        g.fill();
      } else {
        // A base tile: a small square, like the tiles themselves. (A house
        // with a roof read as an arrow pointing up.)
        g.fillRect(cx - 0.07, cy - 0.07, 0.14, 0.14);
      }
      g.restore();
    };
    // A capture step under way: one pip per round held, in the taker's colour.
    const pips = (t: Point, taking: { seat: number; rounds: number } | null) => {
      if (!taking) return;
      const need = RULES.baseCaptureRounds;
      const c = this.pal.seats[taking.seat]!;
      for (let k = 0; k < need; k++) {
        g.fillStyle = k < taking.rounds ? c : alpha(colourHex(this.pal.paper), 0.85);
        g.strokeStyle = alpha(colourHex(this.pal.ink), 0.7);
        g.lineWidth = 0.02;
        g.beginPath();
        g.arc(t.x + 0.84 - (need - 1 - k) * 0.12, t.y + 0.47, 0.045, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    };
    map.posts.forEach((p, i) => {
      if (!occupied(p)) return;
      badge(p, v.postOwners[i] ?? null, "post");
      pips(p, v.postCapture?.[i] ?? null);
    });
    map.income.forEach((p, i) => {
      if (occupied(p)) badge(p, v.incomeOwners[i] ?? null, "income");
    });
    baseTiles(map, v.seats.length).forEach((t, i) => {
      if (!occupied(t)) return;
      const owner = v.baseOwners[i] ?? null;
      const taking = v.baseCapture?.[i] ?? null;
      // A side's own unit on its own home tile, still its own, is the usual
      // case and says nothing: no badge (every unit deployed would carry one).
      const unit = v.units.find((u) => u.x === t.x && u.y === t.y);
      if (!taking && owner === t.home && unit?.seat === owner) return;
      badge(t, owner, "base");
      pips(t, taking);
    });
  }

  private drawSites(now: number) {
    const g = this.ctx;
    const v = this.s.view;
    const map = this.s.map;
    const pulse = (site: "post" | "income", i: number) => this.anim.pulses.find((p) => p.site === site && p.index === i);

    map.posts.forEach((p, i) => {
      drawPost(g, this.pal, p, v?.postOwners[i] ?? null, now, i);
      const pl = pulse("post", i);
      if (pl) this.ring(p.x + 0.5, p.y + 0.5, pl.seat === null ? this.pal.post : this.pal.seats[pl.seat]!, (now - pl.start) / 900);
    });
    map.income.forEach((p, i) => {
      drawIncome(g, this.pal, p, v?.incomeOwners[i] ?? null, now, i);
      const pl = pulse("income", i);
      if (pl) this.ring(p.x + 0.5, p.y + 0.5, pl.seat === null ? this.pal.income : this.pal.seats[pl.seat]!, (now - pl.start) / 900);
    });
    if (v) {
      const bases = baseTiles(map, v.seats.length);
      for (const pl of this.anim.pulses) {
        const t = pl.site === "base" ? bases[pl.index] : undefined;
        if (t) this.ring(t.x + 0.5, t.y + 0.5, pl.seat === null ? this.pal.ink : this.pal.seats[pl.seat]!, (now - pl.start) / 900);
      }
    }
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
        } else if (s.hover && !(s.hover.x === u.x && s.hover.y === u.y)) {
          // Beyond this round's reach: the route it would take over several
          // rounds, this round's leg as an ordinary preview.
          const path = fullPathTo(s, u, s.hover);
          if (path && path.length) {
            const leg = firstLeg(s, u, path);
            if (leg.length) this.route(u, leg, this.pal.path, true);
            const plan = routePlan(s, u, { unitId: u.id, to: s.hover }, { moves: [{ unitId: u.id, path: leg, facing: 0 }], spawns: [] });
            if (plan) this.routeAhead(u, plan, this.pal.path, true);
          }
        }
      }
    }

    // Every drafted move: its route and a ghost where it will end up.
    const orders = canPlan(s) ? s.draft : (v.myOrders ?? { moves: [], spawns: [] });
    // Routes over several rounds: the way on beyond this round's leg, fainter.
    const routed = new Set<number>();
    for (const r of orders.routes ?? []) {
      const u = unitById(s, r.unitId);
      const plan = u && routePlan(s, u, r, orders);
      if (!u || !plan) continue;
      routed.add(u.id);
      this.routeAhead(u, plan, mine, false);
      // Where it will stand at the end, facing the way it was aimed (or the
      // way it walks in): the arc the player is choosing.
      const last = plan.path[plan.path.length - 1]!;
      const before = plan.path.length > 1 ? plan.path[plan.path.length - 2]! : u;
      const facing = r.facing ?? facingToward(before, last);
      this.token(u, last.x + 0.5, last.y + 0.5, facingAngle(facing), 0.4, { ghost: true });
      this.arc(last.x + 0.5, last.y + 0.5, u.kind, facing, mine, 0.1);
    }
    for (const m of orders.moves) {
      const u = unitById(s, m.unitId);
      if (!u) continue;
      if (m.path.length) this.route(u, m.path, mine, false);
      const end = m.path.length ? m.path[m.path.length - 1]! : u;
      if (m.path.length) this.token(u, end.x + 0.5, end.y + 0.5, facingAngle(m.facing), 0.5, { ghost: true });
      // A unit on a long route shows its arc at the destination, not at this round's stop.
      if (!routed.has(u.id)) this.arc(end.x + 0.5, end.y + 0.5, u.kind, m.facing, mine, 0.1);
    }
    orders.spawns.forEach((sp, i) => {
      const fake: Unit = { id: -1 - i, seat, kind: sp.kind, x: sp.x, y: sp.y, facing: sp.facing, hp: UNITS[sp.kind].hp, moved: false, damaged: false, fired: false };
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

  /**
   * The part of a route left for later rounds: a faint dashed line from
   * where this round's leg ends, a numbered marker where each later round's
   * leg ends (2 is next round: this one is 1), and a ring on the
   * destination. `preview` is the hover's, in the preview colour.
   */
  private routeAhead(u: Unit, plan: NonNullable<ReturnType<typeof routePlan>>, hex: string, preview: boolean) {
    const g = this.ctx;
    const { path, done, ends } = plan;
    const from = done > 0 ? path[done - 1]! : u;
    const rest = path.slice(done);
    if (!rest.length) return;
    const colour = colourHex(hex);
    g.strokeStyle = alpha(colour, preview ? 0.7 : 0.55);
    g.lineWidth = preview ? 0.06 : 0.07;
    g.setLineDash([0.1, 0.14]);
    g.beginPath();
    g.moveTo(from.x + 0.5, from.y + 0.5);
    for (const p of rest) g.lineTo(p.x + 0.5, p.y + 0.5);
    g.stroke();
    g.setLineDash([]);
    // The destination: a ring, filled faintly.
    const end = path[path.length - 1]!;
    g.fillStyle = alpha(colour, 0.14);
    g.strokeStyle = alpha(colour, 0.75);
    g.lineWidth = 0.06;
    g.beginPath();
    g.arc(end.x + 0.5, end.y + 0.5, 0.36, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    ends.forEach((i, k) => {
      const p = path[i];
      if (p) this.label(String(k + 2), p.x + 0.5, p.y + 0.5, alpha(colour, 0.9), 11);
    });
  }

  /** The firing arc as a soft wedge out to the unit's range. */
  private arc(cx: number, cy: number, kind: Unit["kind"], facing: number, colour: string, strength: number) {
    const g = this.ctx;
    const st = UNITS[kind];
    const heading = facingAngle(facing) - Math.PI / 2;
    if (hasTrait(kind, "scoped")) {
      // The scope's long, narrow strip of sight, faintly, beyond the firing arc.
      const halfScope = ((RULES.traits.scopeArc / 2) * Math.PI) / 180;
      g.strokeStyle = alpha(colourHex(colour), strength * 2);
      g.lineWidth = 0.03;
      g.setLineDash([0.2, 0.15]);
      g.beginPath();
      g.moveTo(cx, cy);
      g.arc(cx, cy, RULES.traits.scopeSight, heading - halfScope, heading + halfScope);
      g.closePath();
      g.stroke();
      g.setLineDash([]);
    }
    if (hasTrait(kind, "unarmed")) return;
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
      const p = previewShot(s.map, shooter, t, v.units);
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
      const [lo, hi] = damageRange(p);
      const dmg = p.fatal ? "kill" : lo === hi ? `${lo}` : `${lo}–${hi}`;
      this.label(`${Math.round(p.chance * 100)}% · ${dmg}`, tx, ty - 0.8, chosen ? this.pal.danger : this.pal.ink);
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
      const moving = !!moveOrderFor(s, u.id)?.path.length && v.phase === "planning";
      // The same pulse marks, in planning, your units that could move and
      // have no orders yet, and in the attack phase the ones that can fire.
      const awaitingOrders = canPlan(s) && isMine(s, u) && !u.fired && !moveOrderFor(s, u.id);
      this.token(u, p.x, p.y, p.angle, p.alpha * (acted ? 0.6 : 1), {
        selected: isSel,
        ready: (myTurn && ready.has(u.id) && !acted) || awaitingOrders,
        hp: this.anim.hp(u, now),
        now,
        moving,
        // A sniper that hasn't moved has its tripod down: full accuracy.
        braced: hasTrait(u.kind, "steady") && !u.moved && !moving,
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
        this.death(gh.unit, x, y, t, now);
      } else {
        this.token(gh.unit, x, y, facingAngle(gh.unit.facing), Math.max(0, 1 - t), { hp: gh.unit.hp, now });
      }
    }
  }

  /**
   * A unit dying, t from 0 to 1: a white flash as the shot lands, then it
   * spins and shrinks as it falls, fading, with a burst in its side's colour.
   */
  private death(u: Unit, x: number, y: number, t: number, now: number) {
    const g = this.ctx;
    const seat = this.pal.seats[u.seat]!;
    if (t < 0.6) this.burst(x, y, seat, t / 0.6);
    const fall = Math.max(0, (t - 0.1) / 0.9);
    const opacity = t < 0.35 ? 1 : Math.max(0, 1 - (t - 0.35) / 0.65);
    this.token(u, x, y, facingAngle(u.facing) + fall * fall * 2.6, opacity, { hp: 0, now, scale: 1 - 0.45 * fall });
    if (t < 0.14) {
      g.fillStyle = alpha("#ffffff", 0.85 * (1 - t / 0.14));
      g.beginPath();
      g.arc(x, y, 0.42 + t, 0, Math.PI * 2);
      g.fill();
    }
  }

  /** Where units fell: a scorch mark and a cross in the side's colour, fading over a few seconds. */
  private drawRemains(now: number) {
    const g = this.ctx;
    for (const r of this.anim.remains) {
      const k = (now - r.start) / REMAINS_MS;
      if (k < 0) continue;
      const a = k < 0.08 ? k / 0.08 : 1 - Math.max(0, (k - 0.6) / 0.4);
      const cx = r.at.x + 0.5;
      const cy = r.at.y + 0.5;
      g.fillStyle = alpha("#000000", 0.26 * a);
      g.beginPath();
      g.ellipse(cx, cy + 0.05, 0.34, 0.27, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = alpha(colourHex(this.pal.seats[r.seat]!), 0.85 * a);
      g.lineWidth = 0.08;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(cx - 0.16, cy - 0.16);
      g.lineTo(cx + 0.16, cy + 0.16);
      g.moveTo(cx + 0.16, cy - 0.16);
      g.lineTo(cx - 0.16, cy + 0.16);
      g.stroke();
    }
  }

  /** An explosion: a flash and a ring spreading over the tiles round the target. */
  private blast(x: number, y: number, t: number) {
    const g = this.ctx;
    const fade = Math.max(0, 1 - t);
    g.fillStyle = alpha(colourHex(this.pal.warn), 0.45 * fade);
    g.beginPath();
    g.arc(x, y, 0.4 + t * 1.1, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = alpha("#fff3c4", fade);
    g.lineWidth = 0.08;
    g.beginPath();
    g.arc(x, y, 0.3 + t * 1.3, 0, Math.PI * 2);
    g.stroke();
    this.burst(x, y, this.pal.danger, t);
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
    o: {
      selected?: boolean;
      ready?: boolean;
      ghost?: boolean;
      hp?: number;
      now?: number;
      badge?: string;
      moving?: boolean;
      scale?: number;
      braced?: boolean;
    } = {},
  ) {
    if (opacity <= 0) return;
    const g = this.ctx;
    const colour = this.pal.seats[u.seat]!;
    const r = 0.34 * UNIT_SIZE[u.kind] * (o.scale ?? 1);
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
      g.arc(cx, cy, r * 1.15 + 0.06 + t * 0.22, 0, Math.PI * 2);
      g.stroke();
    }
    if (o.selected) {
      g.strokeStyle = this.pal.paper;
      g.lineWidth = 0.1;
      g.beginPath();
      g.arc(cx, cy, r * 1.15 + 0.12, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = this.pal.ink;
      g.lineWidth = 0.04;
      g.stroke();
    }

    // Everything below is drawn turned to the facing, with the shape's "up" as
    // forward: the class silhouette, then a bold arrow out in front of it.
    const outline = shade(colour, -0.55);
    g.save();
    g.translate(cx, cy);
    g.rotate(angle);
    const front = shapeFront(u.kind) * r;
    g.beginPath();
    g.moveTo(0, -(front + 0.27));
    g.lineTo(0.21, -(front - 0.02));
    g.lineTo(0, -(front + 0.05));
    g.lineTo(-0.21, -(front - 0.02));
    g.closePath();
    g.lineJoin = "round";
    g.strokeStyle = outline;
    g.lineWidth = 0.1;
    g.stroke();
    g.fillStyle = "#ffffff";
    g.fill();
    g.strokeStyle = colour;
    g.lineWidth = 0.035;
    g.stroke();

    shapePath(g, u.kind, r);
    const grad = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r * 1.1);
    grad.addColorStop(0, shade(colour, 0.22));
    grad.addColorStop(1, shade(colour, -0.22));
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = outline;
    g.lineWidth = 0.05;
    g.stroke();
    if (o.ghost) {
      g.setLineDash([0.08, 0.06]);
      g.strokeStyle = this.pal.paper;
      g.lineWidth = 0.035;
      g.stroke();
      g.setLineDash([]);
    }
    g.restore();

    // The class symbol stays upright so it can always be read.
    const gs = r * 1.25;
    g.save();
    g.translate(cx - gs / 2, cy - gs / 2);
    g.scale(gs / 24, gs / 24);
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = alpha("#000000", 0.35);
    g.lineWidth = 4.4;
    g.stroke(glyphPath(u.kind));
    g.strokeStyle = "#ffffff";
    g.lineWidth = 2.6;
    g.stroke(glyphPath(u.kind));
    g.restore();

    if (!o.ghost && o.hp !== undefined) {
      // A health bar along the bottom of the tile.
      const max = UNITS[u.kind].hp;
      const f = Math.max(0, Math.min(1, o.hp / max));
      const bw = 0.62;
      const bx = cx - bw / 2;
      const by = cy + 0.36;
      g.fillStyle = alpha("#000000", 0.55);
      g.fillRect(bx - 0.025, by - 0.025, bw + 0.05, 0.12);
      g.fillStyle = f > 0.6 ? this.pal.ok : f > 0.3 ? this.pal.warn : this.pal.danger;
      g.fillRect(bx, by, bw * f, 0.07);
    }
    if (o.braced) {
      // A tripod in a small disc at the token's lower left: braced for full accuracy.
      const bx = cx - r * 0.95;
      const by = cy + r * 0.7;
      g.fillStyle = this.pal.ink;
      g.beginPath();
      g.arc(bx, by, 0.15, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#ffffff";
      g.lineWidth = 0.035;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(bx - 0.07, by - 0.07);
      g.lineTo(bx + 0.07, by - 0.07);
      g.moveTo(bx, by - 0.07);
      g.lineTo(bx - 0.08, by + 0.08);
      g.moveTo(bx, by - 0.07);
      g.lineTo(bx + 0.08, by + 0.08);
      g.moveTo(bx, by - 0.07);
      g.lineTo(bx, by + 0.09);
      g.stroke();
    }
    if (o.badge) {
      // A small "+" disc: drawn as strokes, not text, so it stays crisp.
      const bx = cx + r * 0.85;
      const by = cy - r * 0.85;
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
      if (!t.hit && !t.blast) {
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
      if (t.blast && k >= 1) this.blast(tx, ty, Math.min(1, (now - t.start - 260) / 500));
      else if (t.hit && k >= 1) this.burst(tx, ty, this.pal.danger, Math.min(1, (now - t.start - 260) / 400));
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

  /**
   * The firing arc of whatever unit is under the cursor, either side's, and
   * the reach of a healer's or officer's help (under the cursor or selected).
   */
  private drawCursorArc(now: number) {
    const h = this.s.hover;
    const v = this.s.view;
    if (!v) return;
    const sel = this.s.selected;
    const selected = sel?.type === "unit" ? unitById(this.s, sel.id) : undefined;
    const hovered = h ? v.units.find((x) => x.x === h.x && x.y === h.y) : undefined;
    for (const u of new Set([hovered, selected])) {
      if (!u) continue;
      const range = hasTrait(u.kind, "medic") ? RULES.medicRange : hasTrait(u.kind, "command") ? RULES.traits.commandRange : 0;
      if (range > 0) this.auraRing(u, range);
    }
    if (!hovered) return;
    const p = this.anim.pose(hovered, now);
    if (p.alpha < 0.5) return;
    this.arc(p.x, p.y, hovered.kind, hovered.facing, this.pal.seats[hovered.seat]!, 0.13);
  }

  /** A dashed square round a unit: the tiles its help reaches (healing, an officer's boost). */
  private auraRing(u: Unit, range: number) {
    const g = this.ctx;
    const colour = this.pal.seats[u.seat]!;
    g.fillStyle = alpha(colourHex(colour), 0.08);
    g.fillRect(u.x - range, u.y - range, range * 2 + 1, range * 2 + 1);
    g.strokeStyle = alpha(colourHex(colour), 0.7);
    g.lineWidth = 0.05;
    g.setLineDash([0.18, 0.12]);
    g.strokeRect(u.x - range + 0.05, u.y - range + 0.05, range * 2 + 0.9, range * 2 + 0.9);
    g.setLineDash([]);
  }

  /**
   * The cursor: the tile the keyboard acts on, and the tile under the mouse.
   * Corner brackets in ink over a paper halo, so it reads on every terrain.
   */
  private drawHover(now: number) {
    const h = this.s.hover;
    if (!h) return;
    const g = this.ctx;
    const pulse = 0.02 * Math.sin(now / 260);
    const a = 0.04 - pulse;
    const b = 0.96 + pulse;
    const len = 0.28;
    const corners: [number, number, number, number][] = [
      [a, a, 1, 1],
      [b, a, -1, 1],
      [a, b, 1, -1],
      [b, b, -1, -1],
    ];
    g.save();
    g.lineCap = "round";
    g.lineJoin = "round";
    for (const [width, colour] of [
      [0.13, alpha(colourHex(this.pal.paper), 0.9)],
      [0.06, this.pal.ink],
    ] as const) {
      g.strokeStyle = colour;
      g.lineWidth = width;
      g.beginPath();
      for (const [x, y, dx, dy] of corners) {
        g.moveTo(h.x + x + dx * len, h.y + y);
        g.lineTo(h.x + x, h.y + y);
        g.lineTo(h.x + x, h.y + y + dy * len);
      }
      g.stroke();
    }
    g.restore();
  }
}

/** A class silhouette around the origin, facing up, at radius r (the caller rotates). */
function shapePath(g: CanvasRenderingContext2D, kind: Unit["kind"], r: number) {
  const pts = UNIT_SHAPE[kind];
  g.beginPath();
  if (!pts) {
    g.arc(0, 0, r, 0, Math.PI * 2);
    return;
  }
  pts.forEach(([x, y], i) => (i ? g.lineTo(x * r, y * r) : g.moveTo(x * r, y * r)));
  g.closePath();
}

/** Colours from the palette are hex; this tolerates the odd rgb() too by falling back to white. */
function colourHex(c: string): string {
  return c.startsWith("#") ? c : "#ffffff";
}


// Pan and zoom, and the pointer gestures that drive them. A short press that
// barely moves is a tap (select, order, fire); anything else pans. Two fingers
// pinch to zoom.
import type { Point } from "../game/types.js";

export class Camera {
  /** CSS pixels per tile. */
  scale = 32;
  /** World position (in tiles) at the canvas's top-left. */
  x = 0;
  y = 0;
  minScale = 8;
  maxScale = 120;

  constructor(
    private readonly worldW: number,
    private readonly worldH: number,
    /**
     * Fill the view: the map always covers the whole canvas, with nothing
     * round it, so it can't be zoomed out past that or panned off an edge.
     * The battle uses it; the editor wants to see the whole map at once.
     */
    private readonly fill = false,
  ) {}

  toWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: this.x + sx / this.scale, y: this.y + sy / this.scale };
  }

  toScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.x) * this.scale, y: (wy - this.y) * this.scale };
  }

  fit(viewW: number, viewH: number, pad = 12) {
    if (this.fill) {
      this.scale = this.minScale = this.coverScale(viewW, viewH);
      this.maxScale = Math.max(this.maxScale, this.scale * 2);
    } else {
      this.scale = Math.min((viewW - pad * 2) / this.worldW, (viewH - pad * 2) / this.worldH);
      this.minScale = Math.min(this.scale * 0.8, 16);
    }
    this.x = -(viewW / this.scale - this.worldW) / 2;
    this.y = -(viewH / this.scale - this.worldH) / 2;
  }

  /** The smallest scale at which the map covers the whole view. */
  private coverScale(viewW: number, viewH: number) {
    return Math.max(viewW / this.worldW, viewH / this.worldH);
  }

  /** Zoom by `factor`, keeping the world point under (sx, sy) where it is. */
  zoomAt(factor: number, sx: number, sy: number) {
    const before = this.toWorld(sx, sy);
    this.scale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * factor));
    this.x = before.x - sx / this.scale;
    this.y = before.y - sy / this.scale;
  }

  pan(dxScreen: number, dyScreen: number) {
    this.x -= dxScreen / this.scale;
    this.y -= dyScreen / this.scale;
  }

  /** Keep at least part of the map on screen (all of the screen covered, when filling). */
  clamp(viewW: number, viewH: number) {
    if (this.fill) {
      const cover = this.coverScale(viewW, viewH);
      this.minScale = cover;
      if (this.scale < cover) this.scale = cover;
      const visW = viewW / this.scale;
      const visH = viewH / this.scale;
      this.x = Math.min(this.worldW - visW, Math.max(0, this.x));
      this.y = Math.min(this.worldH - visH, Math.max(0, this.y));
      return;
    }
    const margin = 2;
    const visW = viewW / this.scale;
    const visH = viewH / this.scale;
    this.x = Math.min(this.worldW - margin, Math.max(margin - visW, this.x));
    this.y = Math.min(this.worldH - margin, Math.max(margin - visH, this.y));
  }
}

export interface GestureHandlers {
  tap(sx: number, sy: number, button: number): void;
  hover(sx: number, sy: number | null): void;
  changed(): void;
}

const TAP_SLOP = 6;

export function attachGestures(canvas: HTMLCanvasElement, camera: Camera, h: GestureHandlers) {
  const pointers = new Map<number, Point>();
  let downAt: Point | null = null;
  let moved = false;
  let pinchDistance = 0;

  const local = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      downAt = p;
      moved = false;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDistance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      moved = true; // a pinch is never a tap
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const p = local(e);
    const prev = pointers.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === "mouse") h.hover(p.x, p.y);
      return;
    }
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinchDistance > 0) camera.zoomAt(d / pinchDistance, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
      pinchDistance = d;
      h.changed();
      return;
    }
    if (downAt && Math.hypot(p.x - downAt.x, p.y - downAt.y) > TAP_SLOP) moved = true;
    if (moved) {
      camera.pan(p.x - prev.x, p.y - prev.y);
      h.changed();
    }
    if (e.pointerType === "mouse") h.hover(p.x, p.y);
  });

  const end = (e: PointerEvent) => {
    const wasOnly = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDistance = 0;
    if (wasOnly && !moved && downAt && e.type === "pointerup") {
      const p = local(e);
      h.tap(p.x, p.y, e.button);
    }
    if (pointers.size === 0) downAt = null;
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse" && !pointers.has(e.pointerId)) h.hover(0, null);
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const p = local(e);
      camera.zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
      h.changed();
    },
    { passive: false },
  );
}

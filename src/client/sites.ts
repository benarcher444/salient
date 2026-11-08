// Command posts and income sites on the canvas, in tile coordinates. Shared
// by the battle board and the map editor so a site looks the same in both.
import type { Point } from "../game/types.js";
import { alpha, shade, type Palette } from "./palette.js";

/** A post: a pad ringed in its owner's colour (grey when neutral), with a flag. */
export function drawPost(g: CanvasRenderingContext2D, pal: Palette, p: Point, owner: number | null, now: number, i: number) {
  const colour = owner === null ? pal.post : pal.seats[owner]!;
  const cx = p.x + 0.5;
  const cy = p.y + 0.5;
  g.fillStyle = alpha(pal.paper, 0.9);
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
  g.strokeStyle = pal.ink;
  g.lineWidth = 0.045;
  g.beginPath();
  g.moveTo(cx - 0.1, cy + 0.2);
  g.lineTo(cx - 0.1, cy - 0.24);
  g.stroke();
  g.fillStyle = owner === null ? shade(pal.post, 0.35) : colour;
  g.beginPath();
  const wave = Math.sin(now / 400 + i) * 0.03;
  g.moveTo(cx - 0.08, cy - 0.24);
  g.quadraticCurveTo(cx + 0.06, cy - 0.2 + wave, cx + 0.2, cy - 0.16);
  g.quadraticCurveTo(cx + 0.06, cy - 0.1 + wave, cx - 0.08, cy - 0.06);
  g.closePath();
  g.fill();
}

/** An income site: a gold diamond, edged in its owner's colour, that glints now and then. */
export function drawIncome(g: CanvasRenderingContext2D, pal: Palette, p: Point, owner: number | null, now: number, i: number) {
  const cx = p.x + 0.5;
  const cy = p.y + 0.5;
  g.save();
  g.translate(cx, cy);
  g.rotate(Math.PI / 4);
  const grad = g.createLinearGradient(-0.25, -0.25, 0.25, 0.25);
  grad.addColorStop(0, shade(pal.income, 0.35));
  grad.addColorStop(1, shade(pal.income, -0.2));
  g.fillStyle = grad;
  g.fillRect(-0.24, -0.24, 0.48, 0.48);
  g.strokeStyle = owner === null ? shade(pal.income, -0.4) : pal.seats[owner]!;
  g.lineWidth = owner === null ? 0.04 : 0.09;
  g.strokeRect(-0.24, -0.24, 0.48, 0.48);
  g.restore();
  const glint = (now / 1600 + i * 0.37) % 1;
  if (glint < 0.25) {
    g.fillStyle = alpha("#ffffff", 0.7 * (1 - glint * 4));
    g.beginPath();
    g.arc(cx - 0.08, cy - 0.1, 0.05, 0, Math.PI * 2);
    g.fill();
  }
}

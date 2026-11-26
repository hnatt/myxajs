// Drawing the flies' droppings, and the layer that keeps them.
//
// Marks change only when one is dropped or rubbed, so they are kept on an
// offscreen layer of their own instead of being redrawn every frame.  The
// overlay copies the layer back into each box it clears, which keeps a mark
// under a passing fly intact at the cost of a small blit.

import { bounds } from './droppings.js';

/** Light falls from the upper left, as on the animals. */
const LIGHT = [-0.55, -0.84];

const SPECK_DARK = [34, 23, 15];
const SPECK_BROWN = [78, 52, 28];
const SPOT = [150, 118, 66];
const SPOT_RIM = [104, 76, 38];

function rgba(c, a) {
  return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
}

function mixc(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map(Math.round);
}

/**
 * Draw one mark with its smears, in the coordinates of the current
 * transform.  `devicePx` is how many device pixels one unit is, to decide
 * whether the highlight on a speck is big enough to see.
 */
export function drawDropping(ctx, d, devicePx = 1) {
  const col = d.pale ? SPOT_RIM : mixc(SPECK_DARK, SPECK_BROWN, d.tone);

  // A smear is a thin film dragged out of the mark: it starts full width and
  // tapers, fading towards its far end.
  for (const m of d.smears) {
    const dx = m.x1 - m.x0;
    const dy = m.y1 - m.y0;
    const len = Math.hypot(dx, dy) || 1e-3;
    const nx = -dy / len;
    const ny = dx / len;
    const w0 = m.w / 2;
    const w1 = m.w * 0.12;
    const g = ctx.createLinearGradient(m.x0, m.y0, m.x1, m.y1);
    g.addColorStop(0, rgba(col, m.a * 0.85));
    g.addColorStop(0.55, rgba(col, m.a * 0.45));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(m.x0 + nx * w0, m.y0 + ny * w0);
    ctx.lineTo(m.x1 + nx * w1, m.y1 + ny * w1);
    ctx.lineTo(m.x1 - nx * w1, m.y1 - ny * w1);
    ctx.lineTo(m.x0 - nx * w0, m.y0 - ny * w0);
    // Round the start, around the back of the stroke.
    ctx.arc(m.x0, m.y0, w0, Math.atan2(-ny, -nx), Math.atan2(ny, nx), true);
    ctx.fill();
    if (m.w * devicePx >= 4 && m.grain) {
      ctx.strokeStyle = g;
      ctx.lineWidth = Math.max(m.w * 0.06, 0.5 / devicePx);
      ctx.beginPath();
      for (const [o, f] of m.grain) {
        const sx = m.x0 + nx * o * m.w;
        const sy = m.y0 + ny * o * m.w;
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + dx * f, sy + dy * f);
      }
      ctx.stroke();
    }
  }

  if (d.mass <= 0.01) return;
  const m = d.mass;
  // Rubbing wears a mark down as well as fading it.
  const r = d.r * (0.5 + 0.5 * Math.sqrt(m));
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(d.rot);
  ctx.scale(d.stretch, 1);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  if (d.pale) {
    // Dried regurgitate: a translucent pool with the solids left at its rim.
    ctx.fillStyle = rgba(SPOT, 0.32 * m);
    ctx.fill();
    ctx.strokeStyle = rgba(SPOT_RIM, 0.55 * m);
    ctx.lineWidth = r * 0.22;
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.fillStyle = rgba(col, 0.93 * Math.pow(m, 0.8));
  ctx.fill();
  ctx.restore();
  // A fresh speck is a little raised droplet, so it catches the light.
  if (r * devicePx >= 2.2 && m > 0.3) {
    ctx.fillStyle = `rgba(255,236,214,${(0.28 * m).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(d.x + LIGHT[0] * r * 0.42, d.y + LIGHT[1] * r * 0.42, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** An offscreen canvas holding every mark, the size of the overlay. */
export class StainLayer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.dpr = 1;
  }

  /** Match the overlay's backing store, and draw everything afresh. */
  resize(width, height, dpr, list) {
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.dpr = dpr;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const d of list) drawDropping(ctx, d, dpr);
  }

  /** Redraw the marks inside one box, in CSS px. */
  redraw(box, list) {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const ax = Math.max(0, Math.floor(box[0] * dpr));
    const ay = Math.max(0, Math.floor(box[1] * dpr));
    const bx = Math.min(this.canvas.width, Math.ceil(box[2] * dpr));
    const by = Math.min(this.canvas.height, Math.ceil(box[3] * dpr));
    if (bx <= ax || by <= ay) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(ax, ay, bx - ax, by - ay);
    // Clipped, or a mark straddling the edge would be drawn over itself and
    // darken outside the box.
    ctx.save();
    ctx.beginPath();
    ctx.rect(ax, ay, bx - ax, by - ay);
    ctx.clip();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const [x0, y0, x1, y1] = [ax / dpr, ay / dpr, bx / dpr, by / dpr];
    for (const d of list) {
      const b = bounds(d);
      if (b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1) continue;
      drawDropping(ctx, d, dpr);
    }
    ctx.restore();
  }
}

// What the flies leave behind, and how the pointer rubs it away.
//
// House flies leave two kinds of mark.  Fly specks are faeces: small, round,
// dark and slightly raised, half a millimetre to a millimetre across.  Paler,
// larger, translucent spots are regurgitate, the drop a fly puts down to
// dissolve food, which dries with a darker rim like a coffee ring.
//
// A mark stays until the pointer rubs it off.  It does not just vanish: each
// pass drags part of it into a streak in the direction of the rub, and the
// streaks thin out with more rubbing.  A quick pass smudges a speck; a few
// strokes back and forth clean it.
//
// Positions and sizes are in CSS px, in the same space as the animals.  No
// DOM here: the renderer is in droppings-render.js.

/** The pointer rubs as if it were a fingertip this wide, in mm. */
export const WIPE_RADIUS_MM = 2.2;

const PALE_CHANCE = 0.15; // share of marks that are regurgitate, not faeces
const DRAG = 0.6; // share of a speck one full pass drags into a smear
const THIN = 0.45; // share of a smear one full pass wipes away
const MAX_SMEARS = 5;
const GONE = 0.05; // a speck this faint, with no smear left, is clean

export class Droppings {
  /**
   * @param {import('./random.js').Random} rng
   * @param {number} max  oldest marks go once there are more than this
   */
  constructor(rng, max = 200) {
    this.rng = rng;
    this.max = max;
    this.list = [];
    /** Boxes [x0, y0, x1, y1] whose look has changed since last drained. */
    this.changed = [];
  }

  get count() {
    return this.list.length;
  }

  /** A fresh mark at (x, y), left by a fly `flyLen` px long. */
  add(x, y, flyLen) {
    const rng = this.rng;
    const pale = rng.random() < PALE_CHANCE;
    const d = {
      x,
      y,
      // Radius: specks 0.5-1 mm across on a 7 mm fly, pale spots 1-2 mm.
      r: flyLen * (pale ? rng.uniform(0.07, 0.13) : rng.uniform(0.036, 0.068)),
      stretch: rng.uniform(1, 1.3), // no drop lands perfectly round
      rot: rng.uniform(0, Math.PI),
      pale,
      tone: rng.random(), // 0 near-black, 1 brown
      mass: 1, // what is left of the mark itself, 0..1
      smears: [],
    };
    this.list.push(d);
    this.changed.push(bounds(d));
    while (this.list.length > this.max) this.changed.push(bounds(this.list.shift()));
    return d;
  }

  /** Remove every mark. */
  clear() {
    for (const d of this.list) this.changed.push(bounds(d));
    this.list = [];
  }

  /**
   * The pointer moved from (ax, ay) to (bx, by), rubbing a circle `radius`
   * px wide along the way.  Returns true if any mark changed.
   */
  wipe(ax, ay, bx, by, radius) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 0.5 || !this.list.length) return false; // resting, not rubbing
    const ux = dx / len;
    const uy = dy / len;
    const rng = this.rng;
    let any = false;

    for (let k = this.list.length - 1; k >= 0; k--) {
      const d = this.list[k];
      const before = bounds(d);
      let hit = false;

      // The mark itself: part of it is dragged off into a streak.
      const s = rubbed(ax, ay, ux, uy, len, d.x, d.y, radius + d.r * d.stretch);
      if (s > 0 && d.mass > 0) {
        const dragged = d.mass * DRAG * s;
        d.mass -= dragged;
        const reach = d.r * (2.5 + 3.5 * s) * rng.uniform(0.8, 1.2);
        const side = rng.gauss(0, 0.25) * d.r;
        d.smears.push({
          x0: d.x - ux * d.r * 0.3 - uy * side,
          y0: d.y - uy * d.r * 0.3 + ux * side,
          x1: d.x + ux * reach - uy * side * 2,
          y1: d.y + uy * reach + ux * side * 2,
          w: 2 * d.r * (0.55 + 0.45 * d.mass) * rng.uniform(0.85, 1.15),
          a: Math.min(0.9, dragged * (d.pale ? 0.8 : 1.4)),
          // A rub leaves fine parallel striations: [offset across, share of
          // the length], for drawing up close.
          grain: [0, 1, 2].map(() => [rng.uniform(-0.38, 0.38), rng.uniform(0.45, 1)]),
        });
        hit = true;
      }

      // Smears already there thin out under the rub.
      for (const m of d.smears) {
        if (m === d.smears[d.smears.length - 1] && hit) continue;
        const mx = (m.x0 + m.x1) / 2;
        const my = (m.y0 + m.y1) / 2;
        const half = Math.hypot(m.x1 - m.x0, m.y1 - m.y0) / 2;
        const t = rubbed(ax, ay, ux, uy, len, mx, my, radius + half);
        if (t > 0) {
          m.a *= 1 - THIN * t;
          m.w *= 1 + 0.08 * t;
          hit = true;
        }
      }
      if (!hit) continue;

      d.smears = d.smears.filter((m) => m.a >= 0.03);
      if (d.smears.length > MAX_SMEARS) {
        d.smears.sort((p, q) => q.a - p.a);
        d.smears.length = MAX_SMEARS;
      }
      any = true;
      if (d.mass < GONE && !d.smears.length) {
        this.list.splice(k, 1);
        this.changed.push(before);
      } else {
        this.changed.push(union(before, bounds(d)));
      }
    }
    return any;
  }
}

/**
 * How firmly a rub along the segment from (ax, ay), direction (ux, uy),
 * length `len`, passed over the point (px, py) within `reach`: 0 for a miss,
 * up to 1 for a full pass straight across it.
 */
function rubbed(ax, ay, ux, uy, len, px, py, reach) {
  const along = (px - ax) * ux + (py - ay) * uy;
  const off = Math.abs((px - ax) * -uy + (py - ay) * ux);
  if (off >= reach) return 0;
  const half = Math.sqrt(reach * reach - off * off);
  const inside = Math.min(len, along + half) - Math.max(0, along - half);
  if (inside <= 0) return 0;
  // A graze at the edge of the fingertip drags less than a pass dead over it.
  const centred = 1 - (off / reach) ** 2;
  return Math.min(1, inside / (2 * reach) + 0.25) * centred;
}

/** Box around a mark and its smears, in CSS px, with room for antialiasing. */
export function bounds(d) {
  const r = d.r * d.stretch + 1.5;
  let x0 = d.x - r;
  let y0 = d.y - r;
  let x1 = d.x + r;
  let y1 = d.y + r;
  for (const m of d.smears) {
    const w = m.w / 2 + 1.5;
    x0 = Math.min(x0, m.x0 - w, m.x1 - w);
    y0 = Math.min(y0, m.y0 - w, m.y1 - w);
    x1 = Math.max(x1, m.x0 + w, m.x1 + w);
    y1 = Math.max(y1, m.y0 + w, m.y1 + w);
  }
  return [x0, y0, x1, y1];
}

function union(a, b) {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

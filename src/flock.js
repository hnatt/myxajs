// Flies among flies.
//
// On foot, flies keep out of each other's way: a walker veers round a fly in
// its path, and two bodies never overlap.  In the air they are left alone;
// they may be at different heights.
//
// Two flies that come near each other on foot have met, and a meeting
// sometimes turns into mating: one walks up to the other and mounts it (see
// the court, await, mount and mate states in fly.js).  Each meeting gets one
// roll of the dice; to roll again the two have to part and meet afresh.  The
// odds are better when the two are the only flies on the page.
//
// No DOM here.

import { wrap } from './util.js';
import { WALK, LAUNCH, IDLE } from './fly.js';

const BODY_GAP_L = 0.8; // centre spacing that two flies on foot keep, in body lengths
const LOOK_L = 1.8; // how far ahead a walker watches for flies in its way
const LOOK_ANGLE = 0.9; // radians either side of straight ahead
const VEER = 3.5; // rad/s: how hard it turns away from one dead ahead
const NEAR_L = 2.5; // closer than this, two flies have met
const APART_L = 4.0; // further than this, they have parted and may meet again
/** With only two flies on the page, neither has anyone else to meet: the
 * chance a meeting turns into mating is multiplied by this. */
const ONLY_TWO = 3;

export class Flock {
  /**
   * @param {import('./random.js').Random} rng
   * @param {object} opts  mating (bool), matingChance (0..1 per meeting)
   */
  constructor(rng, opts = {}) {
    this.rng = rng;
    this.mating = opts.mating ?? true;
    this.matingChance = opts.matingChance ?? 0.1;
    this._met = new Set();
  }

  /** Run after the flies have moved this frame. */
  update(flies, dt) {
    // A partner that has gone (the population shrank) lets its mate go.
    for (const f of flies) {
      if (f.mate && !flies.includes(f.mate)) f._enter(f.height > 0.05 ? LAUNCH : IDLE);
    }
    let onPage = 0;
    for (const f of flies) if (!f.hidden && f.world.contains(f.x, f.y)) onPage++;
    this._chance = Math.min(1, this.matingChance * (onPage === 2 ? ONLY_TWO : 1));
    for (let i = 0; i < flies.length; i++) {
      const a = flies[i];
      if (!a.onFoot) continue;
      for (let j = i + 1; j < flies.length; j++) {
        const b = flies[j];
        if (!b.onFoot) continue;
        this._pair(a, b, dt);
      }
    }
  }

  _pair(a, b, dt) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    const L = (a.length + b.length) / 2;
    if (a.mate !== b) {
      this._veer(a, dx, dy, d, dt);
      this._veer(b, -dx, -dy, d, dt);
      this._separate(a, b, dx, dy, d, L);
    }
    this._meet(a, b, d, L);
  }

  /** A walker turns away from a fly in its path. */
  _veer(f, dx, dy, d, dt) {
    if (f.state !== WALK || d > LOOK_L * f.length || d < 1e-6) return;
    const off = wrap(Math.atan2(dy, dx) - f.heading);
    if (Math.abs(off) > LOOK_ANGLE) return;
    const urgency = 1 - d / (LOOK_L * f.length);
    f.heading -= Math.sign(off || 1) * VEER * urgency * dt;
  }

  /**
   * Keep two bodies apart.  Only a fly that is walking is shifted: one that
   * is standing still would be seen to slide.  If neither is walking -- one
   * landed on the other, say -- the newcomer walks off.
   */
  _separate(a, b, dx, dy, d, L) {
    const min = BODY_GAP_L * L;
    if (d >= min) return;
    let nx = dx / (d || 1);
    let ny = dy / (d || 1);
    if (d < 1e-6) {
      const t = this.rng.uniform(0, Math.PI * 2);
      nx = Math.cos(t);
      ny = Math.sin(t);
    }
    const wa = a.walking ? 1 : 0;
    const wb = b.walking ? 1 : 0;
    if (!wa && !wb) {
      const mover = a.stateT < b.stateT ? a : b;
      if (mover.mate) return; // a pair being formed sorts itself out
      const sign = mover === a ? -1 : 1;
      mover._enter(WALK);
      mover.heading = Math.atan2(ny * sign, nx * sign) + this.rng.gauss(0, 0.3);
      return;
    }
    const push = min - d;
    const ka = wa / (wa + wb);
    const kb = wb / (wa + wb);
    a.x -= nx * push * ka;
    a.y -= ny * push * ka;
    b.x += nx * push * kb;
    b.y += ny * push * kb;
  }

  _meet(a, b, d, L) {
    const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
    if (d > APART_L * L) {
      this._met.delete(key);
      return;
    }
    if (d > NEAR_L * L || this._met.has(key) || !this.mating) return;
    // Only a meeting on the move, between two flies free to take it up.
    if (!a.available || !b.available) return;
    if (a.state !== WALK && b.state !== WALK) return;
    this._met.add(key);
    if (this.rng.random() >= this._chance) return;
    let suitor = a.state === WALK ? a : b;
    if (a.state === WALK && b.state === WALK && this.rng.random() < 0.5) suitor = b;
    suitor.court(suitor === a ? b : a);
  }
}

// A jumping spider that hunts the fly from the edges of the page.
//
// Salticids do not build webs; they stalk.  The pattern modelled here is the
// real one: sit still, watch, creep closer while the prey is settled, freeze
// whenever it moves, and finally leap.  A miss sends the spider scurrying back
// to cover.
//
// This one lives on the borders of the viewport.  It never walks further in
// than a couple of body lengths from an edge -- only the leap itself carries it
// into open page -- and it is happy to slip over the edge and disappear.

import { Random } from './random.js';
import { TAU, smoothstep, wrap, turnTowards, clamp, bodyLight } from './util.js';
import { LEGS, TETRAPOD_A, TETRAPOD_B, CROUCHED, makeSpiderPose } from './spider-geometry.js';
import { CURLED } from './fly-geometry.js';
import { makePose as makeFlyPose } from './fly-geometry.js';
import { FLIGHT, LANDING, LAUNCH } from './fly.js';

export const LURK = 'lurk';
export const PATROL = 'patrol';
export const STALK = 'stalk';
export const POUNCE = 'pounce';
export const RETREAT = 'retreat';
export const HIDE = 'hide';
export const SEIZE = 'seize';
export const HAUL = 'haul';
export const FEED = 'feed';

/** Where the prey is held, in body lengths ahead of the carapace: gripped in
 * the front legs, up against the fangs. */
export const CARRY_AT = 0.48;

/** How long after a kill before another fly shows up, in seconds. */
export const RESPAWN_DELAY = [10, 60];

const SIGHT_MM = 320; // salticid eyesight is extraordinary for its size
const POUNCE_MM = 62; // about seven body lengths, a realistic salticid leap
const CATCH_L = 0.42; // body lengths: close enough to seize the fly
export const BAND_L = 2.2; // never walks further in from an edge than this
const LANE_L = 1.1; // the depth inside the edge that it prefers to walk at
export const HIDE_L = 1.7; // how far over the edge it will slip to hide
const TRACK_RATE = 2.6; // rad/s: the fastest it will swing onto a moving target
export const TRACK_RATE_FOR_TESTS = TRACK_RATE;
const AIM_NOISE = 1.6; // wobble injected into the aim, so tracking is not robotic
const AIM_DECAY = 2.5; // how quickly that wobble pulls back to the true bearing
const STRIDE = 0.62; // body lengths per gait cycle; short strides read as a shuffle
const SWING_DUTY = 0.45;
/** Turning has to drive the legs too.  A body that rotates while its feet stay
 * planted drags them round into a twisted star and never steps to fix it, so a
 * turn counts towards the gait as the arc swept at about this radius. */
const GAIT_TURN_RADIUS = 0.95;
/** However far the gait falls behind, a planted foot may never be dragged
 * further than this from where it belongs. */
const MAX_DRAG = 0.55;
const BLEND_TIME = 0.16;

const AIRBORNE = new Set([FLIGHT, LANDING, LAUNCH]);

export class Spider {
  /**
   * @param {import('./world.js').World} world
   * @param {import('./fly.js').Fly[]} prey
   * @param {Random} rng
   * @param {object} opts  sizeMm, speed, respawnDelay
   */
  constructor(world, prey, rng = new Random(), opts = {}) {
    this.world = world;
    this.prey = prey;
    this.rng = rng;
    this.sizeMm = opts.sizeMm ?? 9.0;
    this.speedScale = opts.speed ?? 1.0;
    this.respawnDelay = opts.respawnDelay ?? RESPAWN_DELAY;

    this.x = rng.uniform(world.x, world.x + world.width);
    this.y = world.y + (rng.random() < 0.5 ? 0 : world.height);
    this.heading = rng.uniform(0, TAU);
    this.height = 0;
    this.walkSpeed = 0;
    this.gaitPhase = 0;

    this.pose = makeSpiderPose();
    this._blendFrom = this.pose.feet.map((f) => [...f]);
    this._blendLift = [0, 0, 0, 0, 0, 0, 0, 0];
    this._blendT = 1;

    this._footWorld = [];
    this._swingFrom = [];
    this._prevLegPhase = [0, 0, 0, 0, 0, 0, 0, 0];
    // No animal stands in a perfect mirror image of itself.  Each leg gets a
    // small permanent offset from the textbook rest position, and its own slow
    // idle drift, so a standing spider is never a symmetric star.
    this._restJitter = LEGS.map(() => [rng.gauss(0, 0.05), rng.gauss(0, 0.06)]);
    this._idlePhase = LEGS.map(() => rng.uniform(0, TAU));
    this._idleT = 0;
    this._aim = 0; // current wobble away from the true bearing
    this.carried = null; // the fly it has hold of, if any
    this.carriedPose = makeFlyPose(CURLED.map((f) => [...f]), [1, 1, 1, 1, 1, 1]);
    this._carryYaw = 0;
    this._struggle = 0;
    this._lap = rng.random() < 0.5 ? 1 : -1;
    this._wave = 0; // front leg raised and waved, as salticids do
    this._waveLeg = 0;
    this._waveIn = rng.uniform(1, 4);
    this._gaitHeading = this.heading;
    this._leapFrom = null;
    this._leapTo = null;
    this._freeze = 0;

    this.state = LURK;
    this.stateT = 0;
    this.stateDur = rng.uniform(1, 3);
    this._reseedFeet();
  }

  // -- geometry ---------------------------------------------------------
  get length() {
    return this.sizeMm * this.world.pxPerMm;
  }

  /** False once it has slipped far enough over the edge to be hidden. */
  get visible() {
    return this._edge()[0] > -0.55 * this.length;
  }

  /** [distance inside the nearest edge (negative outside), inward normal]. */
  _edge(x = this.x, y = this.y) {
    const m = this.world;
    const left = x - m.x;
    const right = m.x + m.width - x;
    const top = y - m.y;
    const bottom = m.y + m.height - y;
    const d = Math.min(left, right, top, bottom);
    let n;
    if (d === left) n = [1, 0];
    else if (d === right) n = [-1, 0];
    else if (d === top) n = [0, 1];
    else n = [0, -1];
    return [d, n];
  }

  _band() {
    const m = this.world;
    return Math.min(BAND_L * this.length, m.width / 3, m.height / 3);
  }

  /**
   * Stop it wandering off into space, and nothing more.  Clamping the inward
   * side as well pinned the spider against an invisible straight line; keeping
   * near the edge is the job of the lane it walks and of the walk back in.
   */
  _holdToEdge() {
    const [d, n] = this._edge();
    const hide = HIDE_L * this.length;
    if (d < -hide) {
      this.x += n[0] * (-hide - d);
      this.y += n[1] * (-hide - d);
    }
  }

  // -- the lane it patrols: the page rectangle, inset a little -----------
  _laneRect() {
    const m = this.world;
    const inset = Math.min(LANE_L * this.length, m.width / 4, m.height / 4);
    return [m.x + inset, m.y + inset, m.width - 2 * inset, m.height - 2 * inset];
  }

  _laneLen() {
    const [, , w, h] = this._laneRect();
    return 2 * (w + h);
  }

  /** The point a distance `s` clockwise around the lane. */
  _lanePoint(s) {
    const [x, y, w, h] = this._laneRect();
    const total = 2 * (w + h);
    s = ((s % total) + total) % total;
    if (s < w) return [x + s, y];
    s -= w;
    if (s < h) return [x + w, y + s];
    s -= h;
    if (s < w) return [x + w - s, y + h];
    return [x, y + h - (s - w)];
  }

  /** Distance around the lane of the point on it nearest to (px, py). */
  _laneS(px, py) {
    const [x, y, w, h] = this._laneRect();
    const cx = clamp(px, x, x + w);
    const cy = clamp(py, y, y + h);
    const options = [
      [Math.abs(py - y), cx - x],
      [Math.abs(px - (x + w)), w + (cy - y)],
      [Math.abs(py - (y + h)), w + h + (x + w - cx)],
      [Math.abs(px - x), 2 * w + h + (y + h - cy)],
    ];
    let best = options[0];
    for (const o of options) if (o[0] < best[0]) best = o;
    return best[1];
  }

  /** A point further along the lane, heading towards `goalS`. */
  _laneTarget(goalS = null, lookahead = 3) {
    const total = this._laneLen();
    const here = this._laneS(this.x, this.y);
    let step = lookahead * this.length;
    let direction = this._lap;
    if (goalS !== null) {
      let gap = (((goalS - here) % total) + total) % total;
      if (gap > total / 2) {
        gap = total - gap;
        direction = -1;
      } else {
        direction = 1;
      }
      step = Math.min(step, Math.max(gap, 0));
    }
    return this._lanePoint(here + direction * step);
  }

  /**
   * Swing onto a target at a limited rate, with a little wobble.  A salticid
   * turns its whole body to hold prey in its forward eyes, but it cannot do it
   * instantly and it does not do it perfectly.
   */
  _track(tx, ty, dt, rate = TRACK_RATE) {
    this._aim += this.rng.gauss(0, AIM_NOISE) * dt;
    this._aim *= Math.exp(-AIM_DECAY * dt);
    const desired = Math.atan2(ty - this.y, tx - this.x) + this._aim;
    this.heading = turnTowards(this.heading, desired, rate * dt);
    this._stepGait(0);
  }

  /** Where the prey is held and how it lies: [x, y, heading], or null. */
  carryTransform() {
    if (!this.carried) return null;
    const L = this.length;
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    const lx = CARRY_AT * L;
    const wobble = 0.1 * this._struggle * Math.sin(this.stateT * 27);
    return [this.x + lx * c, this.y + lx * s, this.heading + this._carryYaw + wobble];
  }

  /** Front legs closed round the prey, holding it up to the fangs. */
  _clasp() {
    const feet = this.pose.feet;
    const lift = this.pose.lift;
    const shake = 0.05 * this._struggle;
    for (const [i, side] of [[0, -1], [1, 1]]) {
      const fx = 0.6 + shake * Math.sin(this.stateT * 29 + i);
      const fy = side * (0.19 + shake * Math.sin(this.stateT * 23 + i));
      feet[i] = this._clampToReach(i, fx, fy);
      lift[i] = 1;
    }
  }

  /**
   * The fly in its grip: thrashing at first, then still.  Venom immobilises
   * prey within seconds, so the struggle decays rather than stopping dead, and
   * the legs curl as it goes.
   */
  _updateCarried() {
    const pose = this.carriedPose;
    const t = this.stateT;
    const power = this._struggle;
    pose.feet = CURLED.map((base, i) => [
      base[0] + 0.1 * power * Math.sin(t * 23 + i * 1.9),
      base[1] + 0.12 * power * Math.sin(t * 19 + i * 2.7),
    ]);
    pose.lift = [1, 1, 1, 1, 1, 1];
    // Wings beat while it fights, then settle half-folded as it goes limp.
    pose.wingSpread = 0.45 + 0.55 * power;
    pose.wingBlur = Math.max(0, power * (0.45 + 0.55 * Math.sin(t * 31)));
    pose.height = 0;
    const carry = this.carryTransform();
    if (carry) pose.light = bodyLight(carry[2]);
  }

  /** Done with it.  Another fly turns up in its own time. */
  _consume() {
    const fly = this.carried;
    this.carried = null;
    if (fly) fly.release(this.rng.uniform(this.respawnDelay[0], this.respawnDelay[1]));
  }

  /** Somewhere just over the nearest edge to a point, out of sight. */
  _hiddenSpotNear(px, py) {
    const m = this.world;
    const out = HIDE_L * this.length * 0.9;
    const x = clamp(px, m.x, m.x + m.width);
    const y = clamp(py, m.y, m.y + m.height);
    const options = [
      [x - m.x, [m.x - out, y]],
      [m.x + m.width - x, [m.x + m.width + out, y]],
      [y - m.y, [x, m.y - out]],
      [m.y + m.height - y, [x, m.y + m.height + out]],
    ];
    let best = options[0];
    for (const o of options) if (o[0] < best[0]) best = o;
    return best[1];
  }

  /** The closest fly at any distance, seen or not. */
  _nearestPrey() {
    let best = null;
    let bestD = Infinity;
    for (const fly of this.prey) {
      if (fly.hidden) continue;
      const d = Math.hypot(fly.x - this.x, fly.y - this.y);
      if (d < bestD) {
        best = fly;
        bestD = d;
      }
    }
    return best;
  }

  /** Slip round to cover near the fly.  Only ever done while already out of
   * sight, so the spider is never seen to jump. */
  _reappearNearPrey() {
    if (this._edge()[0] > -0.5 * this.length) return false;
    const fly = this._nearestPrey();
    if (!fly) return false;
    [this.x, this.y] = this._hiddenSpotNear(fly.x, fly.y);
    this.heading = Math.atan2(fly.y - this.y, fly.x - this.x);
    this._reseedFeet();
    return true;
  }

  _toWorld(local) {
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    const L = this.length;
    const lx = local[0] * L;
    const ly = local[1] * L;
    return [this.x + lx * c - ly * s, this.y + lx * s + ly * c];
  }

  _toLocal(world) {
    const c = Math.cos(-this.heading);
    const s = Math.sin(-this.heading);
    const L = this.length;
    const dx = world[0] - this.x;
    const dy = world[1] - this.y;
    return [(dx * c - dy * s) / L, (dx * s + dy * c) / L];
  }

  /** Where leg i wants its foot, including this spider's own stance. */
  _rest(i) {
    const base = LEGS[i][1];
    const j = this._restJitter[i];
    return [base[0] + j[0], base[1] + j[1]];
  }

  _reseedFeet() {
    this._footWorld = LEGS.map((_, i) => this._toWorld(this._rest(i)));
    this._swingFrom = this._footWorld.map((p) => [...p]);
  }

  _clampToReach(i, fx, fy) {
    const [coxa, , femur, tibia, tarsus] = LEGS[i];
    const dx = fx - coxa[0];
    const dy = fy - coxa[1];
    const d = Math.hypot(dx, dy) || 1e-6;
    const lo = 0.5 * (femur + tibia);
    const hi = 0.96 * (femur + tibia + tarsus);
    if (d >= lo && d <= hi) return [fx, fy];
    const k = clamp(d, lo, hi) / d;
    return [coxa[0] + dx * k, coxa[1] + dy * k];
  }

  // -- prey -------------------------------------------------------------
  /** The nearest fly it can actually see, or null. */
  _quarry() {
    let best = null;
    let bestD = SIGHT_MM * this.world.pxPerMm;
    for (const fly of this.prey) {
      if (fly.hidden) continue;
      const d = Math.hypot(fly.x - this.x, fly.y - this.y);
      if (d < bestD) {
        best = fly;
        bestD = d;
      }
    }
    return best;
  }

  // -- state machine ----------------------------------------------------
  _enter(state) {
    this._blendFrom = this.pose.feet.map((f) => [...f]);
    this._blendLift = [...this.pose.lift];
    this._blendT = 0;
    this.state = state;
    this.stateT = 0;
    const rng = this.rng;
    const sp = this.speedScale;
    if (state === LURK) {
      this.stateDur = rng.uniform(1, 3);
    } else if (state === PATROL) {
      this.stateDur = rng.uniform(2, 6);
      this.walkSpeed = rng.uniform(12, 26) * sp;
      this._reseedFeet();
    } else if (state === STALK) {
      this.stateDur = rng.uniform(20, 40);
      this.walkSpeed = rng.uniform(9, 19) * sp;
      this._reseedFeet();
    } else if (state === POUNCE) {
      this.stateDur = 0.3;
    } else if (state === RETREAT) {
      this.stateDur = rng.uniform(2.5, 4.5);
      // A dash home after a failed leap; an unhurried correction after merely
      // drifting a little too far in.
      const far = this._edge()[0] > this._band() * 2;
      const [lo, hi] = far ? [45, 75] : [18, 30];
      this.walkSpeed = rng.uniform(lo, hi) * sp;
      this._reseedFeet();
    } else if (state === HIDE) {
      this.stateDur = rng.uniform(2, 7);
      this.walkSpeed = rng.uniform(20, 35) * sp;
      this._reseedFeet();
    } else if (state === SEIZE) {
      this.stateDur = rng.uniform(1.4, 2.6);
      this._struggle = 1;
      this._carryYaw = rng.choice([-1, 1]) * rng.uniform(1.9, 2.7);
      this._reseedFeet();
    } else if (state === HAUL) {
      this.stateDur = 14;
      this.walkSpeed = rng.uniform(13, 22) * sp;
      this._reseedFeet();
    } else if (state === FEED) {
      this.stateDur = rng.uniform(5, 9);
      this._reseedFeet();
    }
  }

  // -- locomotion -------------------------------------------------------
  _walkTowards(tx, ty, dt, turn = 5, hold = true) {
    const desired = Math.atan2(ty - this.y, tx - this.x);
    this.heading = turnTowards(this.heading, desired, turn * dt);
    const step = this.walkSpeed * this.world.pxPerMm * dt;
    this.x += Math.cos(this.heading) * step;
    this.y += Math.sin(this.heading) * step;
    if (hold) this._holdToEdge();
    this._stepGait(step);
  }

  /** Reverse, hauling the prey.  A spider dragging something keeps its fangs
   * in it and backs towards cover rather than turning round. */
  _walkBackwards(dt) {
    const step = this.walkSpeed * this.world.pxPerMm * dt;
    this.x -= Math.cos(this.heading) * step;
    this.y -= Math.sin(this.heading) * step;
    this._holdToEdge();
    this._stepGait(step, true);
  }

  /** Advance the gait by a distance walked plus the arc swept by turning. */
  _stepGait(travel, reverse = false) {
    const swept = Math.abs(wrap(this.heading - this._gaitHeading)) * GAIT_TURN_RADIUS;
    this._gaitHeading = this.heading;
    const stride = STRIDE * this.length;
    if (stride > 0) this.gaitPhase = (this.gaitPhase + (travel + swept * this.length) / stride) % 1;
    this._updateGait(reverse);
  }

  _updateGait(reverse = false) {
    const L = this.length;
    const way = reverse ? -1 : 1;
    const stride = STRIDE * L;
    const feet = new Array(8);
    const lifts = [0, 0, 0, 0, 0, 0, 0, 0];
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    for (const [group, offset] of [[TETRAPOD_A, 0], [TETRAPOD_B, 0.5]]) {
      const ph = (this.gaitPhase + offset) % 1;
      for (const i of group) {
        const rest = this._rest(i);
        const prev = this._prevLegPhase[i];
        if (ph < SWING_DUTY) {
          if (prev >= SWING_DUTY || prev > ph) this._swingFrom[i] = [...this._footWorld[i]];
          const restWorld = this._toWorld(rest);
          const t = ph / SWING_DUTY;
          const tx = restWorld[0] + ch * stride * 0.5 * way;
          const ty = restWorld[1] + sh * stride * 0.5 * way;
          const k = smoothstep(t);
          const from = this._swingFrom[i];
          this._footWorld[i] = [from[0] + (tx - from[0]) * k, from[1] + (ty - from[1]) * k];
          lifts[i] = Math.sin(Math.PI * t);
        }
        this._prevLegPhase[i] = ph;
        const [fx, fy] = this._toLocal(this._footWorld[i]);
        let [cx, cy] = this._clampToReach(i, fx, fy);
        // A planted foot may lag behind the body, but only so far.
        const dvx = cx - rest[0];
        const dvy = cy - rest[1];
        const dv = Math.hypot(dvx, dvy);
        if (dv > MAX_DRAG) {
          const k = MAX_DRAG / dv;
          cx = rest[0] + dvx * k;
          cy = rest[1] + dvy * k;
        }
        if (cx !== fx || cy !== fy) this._footWorld[i] = this._toWorld([cx, cy]);
        feet[i] = [cx, cy];
      }
    }
    this.pose.feet = feet;
    this.pose.lift = lifts;
  }

  /**
   * Small adjustments for a spider that is standing rather than walking.  Left
   * perfectly still it reads as a dead symmetric star, which is not what a
   * watching salticid looks like: it shifts its footing and waves a front leg.
   */
  _settle(dt) {
    this._idleT += dt;
    const t = this._idleT;
    this._updateGait();
    const feet = this.pose.feet;
    const lift = this.pose.lift;
    for (let i = 0; i < 8; i++) {
      const ph = this._idlePhase[i];
      feet[i][0] += 0.02 * Math.sin(t * 1.7 + ph);
      feet[i][1] += 0.024 * Math.sin(t * 1.3 + ph * 1.7);
    }

    this._waveIn -= dt;
    if (this._wave <= 0 && this._waveIn <= 0) {
      this._wave = 1;
      this._waveLeg = this.rng.choice([0, 1]);
      this._waveIn = this.rng.uniform(1.5, 5);
    }
    if (this._wave > 0) {
      this._wave = Math.max(0, this._wave - dt / 0.9);
      const u = Math.sin(Math.PI * (1 - this._wave));
      const i = this._waveLeg;
      const [rx, ry] = this._rest(i);
      feet[i][0] = rx + 0.22 * u;
      feet[i][1] = ry + 0.1 * u * (i % 2 === 0 ? -1 : 1);
      feet[i][1] += 0.05 * Math.sin(t * 9) * u;
      lift[i] = Math.max(lift[i], u);
    }

    // Idle drift and the wave both move feet independently of the gait, so
    // they have to be brought back inside each leg's reach afterwards.
    for (let i = 0; i < 8; i++) feet[i] = this._clampToReach(i, feet[i][0], feet[i][1]);
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    this.stateT += dt;
    const p = this.pose;

    // Only a leap may take it into open page.  If anything else has left it
    // stranded inland -- a retreat that ran out of time, say -- head back to
    // the border before doing anything else.
    if (![POUNCE, RETREAT, SEIZE, HAUL, FEED].includes(this.state)) {
      if (this._edge()[0] > this._band()) this._enter(RETREAT);
    }

    const fly = this._quarry();
    const L = this.length;
    const ppm = this.world.pxPerMm;

    switch (this.state) {
      case LURK: {
        this.height = 0;
        p.palp = Math.sin(this.stateT * 5) * (0.5 + 0.5 * Math.sin(this.stateT));
        this._settle(dt);
        if (fly) {
          // A salticid swivels its whole body onto prey.
          this._track(fly.x, fly.y, dt, 2.2);
          this._settle(dt);
          if (this.stateT > 0.4) this._enter(STALK);
        } else if (this.stateT >= this.stateDur) {
          const r = this.rng.random();
          if (this._nearestPrey()) {
            // Nothing in sight but a fly exists somewhere: go to cover and come
            // back out nearer to it.
            this._enter(r < 0.7 ? HIDE : PATROL);
          } else {
            this._enter(r < 0.6 ? PATROL : HIDE);
          }
        }
        break;
      }
      case PATROL: {
        this.height = 0;
        const [tx, ty] = this._laneTarget();
        this._walkTowards(tx, ty, dt, 3.2);
        if (fly) this._enter(STALK);
        else if (this.stateT >= this.stateDur) this._enter(LURK);
        break;
      }
      case STALK: {
        this.height = 0;
        if (!fly) {
          this._enter(LURK);
          break;
        }
        const gap = Math.hypot(fly.x - this.x, fly.y - this.y);
        if (gap < POUNCE_MM * ppm && fly.height < 0.4) {
          this._enter(POUNCE);
          this._leapFrom = [this.x, this.y];
          this._leapTo = [fly.x, fly.y];
          this.heading = Math.atan2(fly.y - this.y, fly.x - this.x);
          this.stateDur = clamp(gap / (900 * ppm), 0.18, 0.45);
        } else if (AIRBORNE.has(fly.state)) {
          // In the air: hold still and follow it with the whole body.
          this._freeze = 0.3;
          this._track(fly.x, fly.y, dt);
          this._settle(dt);
        } else {
          // On the ground: creep, freezing now and then.
          if (this.rng.random() < 0.5 * dt) this._freeze = this.rng.uniform(0.2, 0.6);
          else this._freeze = Math.max(0, this._freeze - dt);
          if (this._freeze <= 0) {
            const [tx, ty] = this._laneTarget(this._laneS(fly.x, fly.y));
            this._walkTowards(tx, ty, dt, 2.4);
          } else {
            this._track(fly.x, fly.y, dt, 1.4);
            this._settle(dt);
          }
        }
        if (this.state === STALK && this.stateT >= this.stateDur) this._enter(LURK);
        break;
      }
      case POUNCE: {
        const t = Math.min(1, this.stateT / this.stateDur);
        const [fx, fy] = this._leapFrom;
        const [tx, ty] = this._leapTo;
        this.x = fx + (tx - fx) * t;
        this.y = fy + (ty - fy) * t;
        this.height = Math.sin(Math.PI * t) * 1.6;
        p.feet = CROUCHED.map((c) => [...c]);
        p.lift = [1, 1, 1, 1, 1, 1, 1, 1];
        p.crouch = 1;
        const caught = fly && fly.height < 0.45 && Math.hypot(fly.x - this.x, fly.y - this.y) < CATCH_L * L;
        if (caught || t >= 1) {
          this.height = 0;
          p.crouch = 0;
          if (caught) {
            fly.caught();
            this.carried = fly;
            this._enter(SEIZE);
          } else {
            this._enter(RETREAT);
          }
        }
        break;
      }
      case RETREAT: {
        this.height = 0;
        const [d, n] = this._edge();
        this._walkTowards(this.x - n[0] * 400, this.y - n[1] * 400, dt, 8, false);
        if (this.stateT >= this.stateDur || d <= this._band()) this._enter(LURK);
        break;
      }
      case HIDE: {
        // Slip over the edge and sit out of sight, the way a salticid backs
        // into a crevice between hunts.
        this.height = 0;
        const [d, n] = this._edge();
        if (d > -HIDE_L * L * 0.8) {
          this._walkTowards(this.x - n[0] * 400, this.y - n[1] * 400, dt);
        } else {
          this._settle(dt);
          p.palp = Math.sin(this.stateT * 4) * 0.5;
        }
        if (fly && this.stateT > 1 && this.rng.random() < 0.9 * dt) {
          this._enter(STALK);
        } else if (this.stateT >= this.stateDur) {
          const moved = this._reappearNearPrey();
          this._enter(moved ? PATROL : LURK);
        }
        break;
      }
      case SEIZE: {
        // Gripped in the front legs with the fangs in.  Hold on: the venom does
        // the work, and it only takes a few seconds.
        this.height = 0;
        this._struggle = Math.max(0, 1 - this.stateT / (this.stateDur * 0.85));
        this.heading += Math.sin(this.stateT * 33) * 1.4 * this._struggle * dt;
        p.bite = 0.55 + 0.45 * Math.sin(this.stateT * 24) * this._struggle;
        p.palp = Math.sin(this.stateT * 13);
        this._settle(dt);
        this._clasp();
        if (this.stateT >= this.stateDur) this._enter(HAUL);
        break;
      }
      case HAUL: {
        // Back towards cover, prey held out in front, walking in reverse.
        this.height = 0;
        const [d, n] = this._edge();
        this.heading = turnTowards(this.heading, Math.atan2(n[1], n[0]), 1.8 * dt);
        this._walkBackwards(dt);
        this._clasp();
        p.bite = 0.22 + 0.1 * Math.sin(this.stateT * 5);
        p.palp = 0.4 * Math.sin(this.stateT * 3);
        // All the way out of sight before it settles down to eat.
        if (d <= -HIDE_L * L * 0.92 || this.stateT >= this.stateDur) this._enter(FEED);
        break;
      }
      case FEED: {
        // Maceration: the chelicerae work back and forth, shredding.
        this.height = 0;
        p.bite = 0.5 + 0.5 * Math.sin(this.stateT * 7.5);
        p.palp = Math.sin(this.stateT * 5.5);
        this._settle(dt);
        this._clasp();
        if (this.stateT >= this.stateDur) {
          this._consume();
          this._enter(LURK);
        }
        break;
      }
    }

    if (this.state !== POUNCE) p.crouch = 0;
    if (this._blendT < 1) {
      this._blendT = Math.min(1, this._blendT + dt / BLEND_TIME);
      const k = smoothstep(this._blendT);
      p.feet = p.feet.map((b, i) => {
        const a = this._blendFrom[i];
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      });
      p.lift = p.lift.map((b, i) => this._blendLift[i] + (b - this._blendLift[i]) * k);
    }

    if (this.carried) this._updateCarried();

    p.height = this.height;
    p.light = bodyLight(this.heading);
    return p;
  }

  /** Radius around (x, y) holding spider, legs, shadow and any carried fly. */
  get extent() {
    return this.length * 1.6 + 4;
  }
}

// Behaviour: what the fly decides to do, and the pose that results.
//
// The fly is a small state machine -- walk, pause, groom, take off, fly, land --
// driving an articulated pose.  Positions are in CSS pixels but every *speed*
// and *size* is expressed in millimetres, converted through the world's pixel
// density, so the insect is a real-sized insect.
//
// It is afraid of the pointer.  A fly's escape reflex is driven by *looming* --
// how soon a thing will arrive, not how far away it is right now -- which is
// why swatting slowly rarely works.  So the pointer is judged on
// time-to-contact as well as plain distance.

import { Random } from './random.js';
import { TAU, smoothstep, wrap, turnTowards, pick, clamp, bodyLight } from './util.js';
import {
  LEGS, TUCKED, TRIPOD_A, TRIPOD_B, WING_BASE, WING_REST_ANGLE, WING_OUT_ANGLE, makePose,
} from './fly-geometry.js';

export const WALK = 'walk';
export const IDLE = 'idle';
export const GROOM_FRONT = 'groom_front';
export const GROOM_HIND = 'groom_hind';
export const GROOM_WING = 'groom_wing';
export const LAUNCH = 'launch';
export const FLIGHT = 'flight';
export const LANDING = 'landing';

const AIRBORNE = new Set([LAUNCH, FLIGHT, LANDING]);

/** What a grounded fly does next.  Real flies groom a *lot*. */
export const DEFAULT_BEHAVIOUR = {
  walk: 0.40,
  groomFront: 0.16,
  groomHind: 0.12,
  groomWing: 0.08,
  idle: 0.14,
  takeOff: 0.10,
};

const BEHAVIOUR_STATE = {
  walk: WALK,
  groomFront: GROOM_FRONT,
  groomHind: GROOM_HIND,
  groomWing: GROOM_WING,
  idle: IDLE,
  takeOff: LAUNCH,
};

/** How far past an edge a walking fly may stray before it turns back, and the
 * hard limit beyond which it cannot go.  A fly pinned exactly inside the glass
 * looks fenced in. */
const STRAY_L = 1.6;
const STRAY_HARD_L = 2.8;
/** In flight it is given more room, and occasionally slips the leash. */
const AIR_PAD_L = 3.0;
const AIR_LEASH_L = 14.0;

// Free-flying house flies make about ten body saccades a second, with only
// 30-100 ms of translation in between, and even then they are not flying
// straight: yaw rates of up to about 150 deg/s are normal between saccades.
// That residual turning is what rounds the trajectory off.
const SACCADE_GAP = [0.020, 0.070];
const SACCADE_RISE = [0.030, 0.050];
const CRUISE_YAW_MAX = 2.6; // rad/s, about 150 deg/s
const CRUISE_YAW_SD = 1.35; // rad/s, the spread it actually wanders over
const CRUISE_YAW_TAU = 0.30; // seconds of correlation in that wandering

const STRIDE = 0.28; // body lengths advanced per gait cycle
const SWING_DUTY = 0.45; // fraction of the cycle a leg spends in the air
const BLEND_TIME = 0.20; // seconds to cross-fade between two poses
const LAUNCH_BLEND = 0.04; // the take-off is far too brief for the usual cross-fade

// Grooming acts: [stroke period in seconds, fewest strokes, most strokes].
// Flies rub their legs at roughly 4-5 strokes a second and sweep a little
// slower; a wing stroke, reaching right over the wing, is slower still.
const GROOM_ACT = {
  rubFront: [0.21, 3, 7],
  sweepHead: [0.32, 2, 4],
  sweepAbdomen: [0.42, 2, 4],
  rubHind: [0.24, 3, 6],
  sweepWing: [0.62, 2, 3],
};
/** The acts each grooming state cycles through. */
const GROOM_PLAN = {
  [GROOM_FRONT]: ['rubFront', 'sweepHead'],
  [GROOM_HIND]: ['sweepAbdomen', 'rubHind'],
  [GROOM_WING]: ['sweepWing', 'rubHind'],
};

/**
 * One cycle of a cleaning stroke: the foot travels from `a` to `b` in contact
 * for the first `contact` of the cycle, then lifts and comes back.  `bowIn`
 * and `bowOut` bend the outward and return paths sideways (positive = away
 * from the body axis), so the leg loops instead of shuttling on a line.
 * Coordinates are for the right side; mirror y for the left.
 */
function stroke(u, contact, a, b, bowIn, bowOut) {
  const on = u < contact;
  const q = on ? 0.5 - 0.5 * Math.cos((Math.PI * u) / contact) : (u - contact) / (1 - contact);
  const [p0, p1, bow] = on ? [a, b, bowIn] : [b, a, bowOut];
  const x = p0[0] + (p1[0] - p0[0]) * q;
  const y = p0[1] + (p1[1] - p0[1]) * q + bow * Math.sin(Math.PI * q);
  return [x, y, on];
}

// The pointer, all scaled by `shyness`.
export const CURSOR_PANIC_MM = 9.0; // this close, take off regardless of speed
export const CURSOR_SCURRY_MM = 19.0; // this close, hurry away on foot
export const CURSOR_AIR_MM = 26.0; // this close in flight, veer off
export const CURSOR_PANIC_TTC = 0.32; // seconds to contact that triggers a take-off
export const CURSOR_SCURRY_TTC = 0.70; // seconds to contact that triggers a scurry
export const CURSOR_NOTICE_MM = 85.0; // beyond this the pointer is too far to matter

const range = (rng, [a, b]) => rng.uniform(a, b);

export class Fly {
  /**
   * @param {import('./world.js').World} world
   * @param {Random} rng
   * @param {object} opts  sizeMm, speed, shyness, cursor, stray, excursions,
   *                       behaviour (weights)
   */
  constructor(world, rng = new Random(), opts = {}) {
    this.world = world;
    this.rng = rng;
    this.sizeMm = opts.sizeMm ?? 7.0;
    this.speedScale = opts.speed ?? 1.0;
    this.shyness = opts.shyness ?? 1.0;
    this.cursorFear = opts.cursor ?? true;
    this.stray = opts.stray ?? true;
    this.excursions = opts.excursions ?? true;
    this.setBehaviour(opts.behaviour);

    this.x = world.x + world.width * 0.5;
    this.y = world.y + world.height * 0.5;
    this.heading = rng.uniform(0, TAU);

    this.height = 0; // body lengths above the surface
    this.walkSpeed = 0; // mm/s
    // A fly is always driven along its own body axis: it does not hover or
    // slide sideways, so airspeed is a scalar and steering turns the body.
    this.airspeed = 0; // px/s
    this.cruiseSpeed = 0; // px/s
    this.cruiseHeight = 2.0;
    this._turnLeft = 0; // radians remaining in the current saccade
    this._turnRate = 0;
    this.gaitPhase = 0;

    this._footWorld = [];
    this._swingFrom = [];
    this._prevLegPhase = [0, 0, 0, 0, 0, 0];

    this.pose = makePose();
    this._wingOpenTarget = [0, 0];
    this._act = null;
    this.groomAct = null; // the grooming act under way, for anyone watching
    this.groomSide = 0;
    this._blendFrom = this.pose.feet.map((f) => [...f]);
    this._blendLift = [0, 0, 0, 0, 0, 0];
    this._blendT = 1;
    this._blendTime = BLEND_TIME;

    this.state = IDLE;
    this.stateT = 0;
    this.stateDur = rng.uniform(0.4, 1.2);
    this._target = null;
    this._justEntered = false;
    /** Set while a spider has hold of it; the overlay stops drawing it. */
    this.hidden = false;
    this.predator = null; // a hunter's position
    this.predatorVel = [0, 0];
    this._alarmCd = 0;
    /** Seconds until it comes back, while a spider is digesting the last one. */
    this.respawnIn = null;
    this._excursion = 0; // seconds it is allowed off the screen
    this._cruiseYaw = 0; // gentle turning between saccades
    this._escapeIn = null; // escape latency, seconds
    this._landBest = Infinity;
    this._saccadeIn = 0;

    this.cursor = null; // pointer position
    this.cursorVel = [0, 0]; // px/s, smoothed
    this._cursorCd = 0; // refractory period between startles
    this._fleeT = 0; // seconds left of a panicked run
    this._panic = false;

    this._reseedFeet();
    this.respawn(); // the first one flies in too, it does not appear
  }

  setBehaviour(weights) {
    const w = { ...DEFAULT_BEHAVIOUR, ...(weights || {}) };
    this.groundChoices = Object.keys(BEHAVIOUR_STATE)
      .filter((k) => w[k] > 0)
      .map((k) => [BEHAVIOUR_STATE[k], w[k]]);
    if (!this.groundChoices.length) this.groundChoices = [[IDLE, 1]];
  }

  // -- geometry helpers -------------------------------------------------
  get pxPerMm() {
    return this.world.pxPerMm;
  }

  /** Body length in CSS pixels. */
  get length() {
    return this.sizeMm * this.world.pxPerMm;
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

  /** Hold a foot inside its leg's reach, so the IK never saturates. */
  _clampToReach(i, fx, fy) {
    const [coxa, , femur, tibia, tarsus] = LEGS[i];
    const dx = fx - coxa[0];
    const dy = fy - coxa[1];
    const d = Math.hypot(dx, dy) || 1e-6;
    const lo = 0.55 * (femur + tibia);
    const hi = 0.96 * (femur + tibia + tarsus);
    if (d >= lo && d <= hi) return [fx, fy];
    const k = clamp(d, lo, hi) / d;
    return [coxa[0] + dx * k, coxa[1] + dy * k];
  }

  _reseedFeet() {
    this._footWorld = LEGS.map((l) => this._toWorld(l[1]));
    this._swingFrom = this._footWorld.map((p) => [...p]);
  }

  // -- being hunted -----------------------------------------------------
  /** Where the spider is; null if there is none. */
  sensePredator(pos, dt) {
    if (!pos) {
      this.predator = null;
      this.predatorVel = [0, 0];
      return;
    }
    if (this.predator && dt > 0) {
      const vx = (pos[0] - this.predator[0]) / dt;
      const vy = (pos[1] - this.predator[1]) / dt;
      const k = Math.min(1, 20 * dt);
      this.predatorVel = [
        this.predatorVel[0] + (vx - this.predatorVel[0]) * k,
        this.predatorVel[1] + (vy - this.predatorVel[1]) * k,
      ];
    }
    this.predator = [pos[0], pos[1]];
  }

  /**
   * Bolt if something is very close or arriving fast.
   *
   * A fly ignores a spider creeping up from a distance -- which is exactly why
   * the stalk works -- but a leap is a looming threat, and it answers that the
   * way it answers any: straight into the air.
   */
  _reactToPredator(dt) {
    this._alarmCd = Math.max(0, this._alarmCd - dt);
    if (this._escapeIn !== null) {
      // Escape is not instant: a fly's response to a looming threat has a
      // latency of a few tens of milliseconds, and that is the whole margin
      // the spider has to work with.
      this._escapeIn -= dt;
      if (this._escapeIn <= 0) {
        this._escapeIn = null;
        if (!this.hidden && !AIRBORNE.has(this.state)) {
          this._enter(LAUNCH);
          this.stateDur = 0.05;
          this._alarmCd = 0.7;
        }
      }
      return;
    }
    if (!this.predator || this._alarmCd > 0 || this.hidden || AIRBORNE.has(this.state)) return;
    const dx = this.x - this.predator[0];
    const dy = this.y - this.predator[1];
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6) return;
    const closing = (this.predatorVel[0] * dx + this.predatorVel[1] * dy) / dist;
    const ttc = closing > 20 ? dist / closing : Infinity;
    if (dist < 3.5 * this.length || ttc < 0.38) {
      this.heading = Math.atan2(dy, dx) + this.rng.gauss(0, 0.25);
      this._escapeIn = this.rng.uniform(0.030, 0.055);
    }
  }

  // -- the pointer, which the fly treats as a predator ------------------
  /** Feed in the pointer position; null when it is outside the page. */
  senseCursor(pos, dt) {
    if (!pos || !this.cursorFear) {
      this.cursor = null;
      this.cursorVel = [0, 0];
      return;
    }
    if (this.cursor && dt > 0) {
      const vx = (pos[0] - this.cursor[0]) / dt;
      const vy = (pos[1] - this.cursor[1]) / dt;
      // Smoothed, so one jumpy sample does not spook it.
      const k = Math.min(1, 20 * dt);
      this.cursorVel = [
        this.cursorVel[0] + (vx - this.cursorVel[0]) * k,
        this.cursorVel[1] + (vy - this.cursorVel[1]) * k,
      ];
    }
    this.cursor = [pos[0], pos[1]];
  }

  /** [distance in mm, seconds until the pointer reaches the fly]. */
  _looming() {
    const dx = this.x - this.cursor[0];
    const dy = this.y - this.cursor[1];
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6) return [0, 0];
    // Closing speed: the part of the pointer's motion aimed at the fly.
    const closing = (this.cursorVel[0] * dx + this.cursorVel[1] * dy) / dist;
    const ttc = closing > 20 ? dist / closing : Infinity;
    return [dist / this.pxPerMm, ttc];
  }

  /** The furthest of a few candidate spots from the pointer. */
  _fleePoint(marginL = 2.5) {
    const picks = [];
    for (let i = 0; i < 6; i++) picks.push(this._randomPoint(marginL));
    if (!this.cursor) return picks[0];
    const [cx, cy] = this.cursor;
    let best = picks[0];
    let bestD = -1;
    for (const p of picks) {
      const d = Math.hypot(p[0] - cx, p[1] - cy);
      if (d > bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  _reactToCursor(dt) {
    this._cursorCd = Math.max(0, this._cursorCd - dt);
    this._fleeT = Math.max(0, this._fleeT - dt);
    if (!this.cursor || this._cursorCd > 0 || this.hidden) return;

    const dx = this.x - this.cursor[0];
    const dy = this.y - this.cursor[1];
    const [distMm, ttc] = this._looming();
    const rng = this.rng;
    const away = distMm > 1e-6 ? Math.atan2(dy, dx) : rng.uniform(0, TAU);
    const shy = this.shyness;
    const near = distMm < CURSOR_NOTICE_MM * shy;

    if (this.state === FLIGHT || this.state === LANDING) {
      if (distMm < CURSOR_AIR_MM * shy || (near && ttc < CURSOR_SCURRY_TTC)) {
        if (this.state === LANDING) {
          // Do not settle next to a predator; stay up and move on.
          this.heading = away;
          this._panic = true;
          this._enter(FLIGHT);
        } else if (!this._turnLeft) {
          this._turnLeft = wrap(away - this.heading);
          this._turnRate = this._turnLeft / 0.05;
          this._target = this._fleePoint();
        }
        this._cursorCd = 0.3;
      }
      return;
    }
    if (this.state === LAUNCH) return;

    if (distMm < CURSOR_PANIC_MM * shy || (near && ttc < CURSOR_PANIC_TTC)) {
      // Too close, or something is arriving fast: bail out into the air.
      this.heading = away + rng.gauss(0, 0.25);
      this._panic = true;
      this._enter(LAUNCH);
      this.stateDur = 0.05; // the same reflex as the escape from a spider
      this._cursorCd = 0.5;
    } else if (distMm < CURSOR_SCURRY_MM * shy || (near && ttc < CURSOR_SCURRY_TTC)) {
      this.heading = away + rng.gauss(0, 0.35);
      this._enter(WALK);
      this.walkSpeed = rng.uniform(34, 62) * this.speedScale;
      this.stateDur = rng.uniform(0.5, 1.3);
      this._fleeT = this.stateDur;
      this._cursorCd = 0.35;
    }
  }

  /** Seized by the spider: stop existing until it is done. */
  caught() {
    this.hidden = true;
    this.predator = null;
  }

  /** The spider has finished with it; another will be along shortly. */
  release(delay) {
    this.respawnIn = delay;
  }

  /** Run the clock while a spider has it, or has eaten it. */
  tickHidden(dt) {
    if (this.respawnIn === null) return;
    this.respawnIn -= dt;
    if (this.respawnIn <= 0) {
      this.respawnIn = null;
      this.respawn();
    }
  }

  /** Arrive from off-screen and fly in, rather than appearing from nowhere. */
  respawn() {
    const rng = this.rng;
    const w = this.world;
    const out = rng.uniform(5, 11) * this.length;
    let aim;
    switch (rng.randrange(4)) {
      case 0:
        this.x = w.x - out;
        this.y = rng.uniform(w.y, w.y + w.height);
        aim = 0;
        break;
      case 1:
        this.x = w.x + w.width + out;
        this.y = rng.uniform(w.y, w.y + w.height);
        aim = Math.PI;
        break;
      case 2:
        this.x = rng.uniform(w.x, w.x + w.width);
        this.y = w.y - out;
        aim = Math.PI / 2;
        break;
      default:
        this.x = rng.uniform(w.x, w.x + w.width);
        this.y = w.y + w.height + out;
        aim = -Math.PI / 2;
    }
    this.heading = aim + rng.gauss(0, 0.30);
    this.hidden = false;
    this.respawnIn = null;
    this.predator = null;
    this._excursion = 0;
    this._reseedFeet();
    this._enter(FLIGHT);
    this._target = this._randomPoint(3.0);
    this.stateDur = rng.uniform(1.2, 3.0);
    this.height = this.cruiseHeight;
  }

  // -- state machine ----------------------------------------------------
  _enter(state) {
    this._blendFrom = this.pose.feet.map((f) => [...f]);
    this._blendLift = [...this.pose.lift];
    this._blendT = 0;
    this._blendTime = state === LAUNCH ? LAUNCH_BLEND : BLEND_TIME;
    this.state = state;
    this.stateT = 0;
    this._justEntered = true;
    const rng = this.rng;

    if (state === WALK) {
      this.walkSpeed = rng.uniform(7, 26) * this.speedScale;
      this.stateDur = rng.uniform(1.2, 5.0);
      this._fleeT = 0;
      this._reseedFeet();
    } else if (state === IDLE) {
      this.stateDur = rng.uniform(0.6, 2.6);
    } else if (state === GROOM_FRONT || state === GROOM_HIND || state === GROOM_WING) {
      // The bout ends at the first act boundary after this.
      this.stateDur = rng.uniform(1.4, 3.4);
      this._act = null;
    } else if (state === LAUNCH) {
      this.stateDur = rng.uniform(0.045, 0.075);
    } else if (state === FLIGHT) {
      this.stateDur = rng.uniform(0.8, 3.5);
      this.cruiseSpeed = rng.uniform(240, 480) * this.speedScale * this.pxPerMm;
      if (this._panic) {
        this.cruiseSpeed *= 1.5;
        this.stateDur = Math.max(this.stateDur, 1.4);
      }
      this.airspeed = this.cruiseSpeed * 0.55;
      this.cruiseHeight = rng.uniform(1.6, 3.4);
      if (this._panic) {
        this._target = this._fleePoint();
        this._panic = false;
      } else {
        this._newWaypoint();
      }
      this._saccadeIn = range(rng, SACCADE_GAP);
      this._turnLeft = this._turnRate = 0;
      this._cruiseYaw = 0;
    } else if (state === LANDING) {
      this.stateDur = 1.8;
      this._landBest = Infinity;
      if (this.cruiseSpeed <= 0) this.cruiseSpeed = 300 * this.speedScale * this.pxPerMm;
      this._target = this._landingSpot();
    }
  }

  _nextGroundState() {
    this._enter(pick(this.rng, this.groundChoices));
  }

  _randomPoint(marginL) {
    const w = this.world;
    let margin = marginL * this.length;
    margin = Math.min(margin, w.width / 3, w.height / 3);
    return [
      this.rng.uniform(w.x + margin, w.x + w.width - margin),
      this.rng.uniform(w.y + margin, w.y + w.height - margin),
    ];
  }

  _newWaypoint() {
    this._target = this._randomPoint(2.5);
  }

  /** Somewhere ahead of it: a fly lands on the run, it does not double back.
   * Nowhere near the pointer, either. */
  _landingSpot() {
    let best = null;
    let bestScore = Infinity;
    const wary = this.cursor ? CURSOR_AIR_MM * this.shyness * this.pxPerMm : 0;
    for (let i = 0; i < 8; i++) {
      const p = this._randomPoint(2.0);
      const dx = p[0] - this.x;
      const dy = p[1] - this.y;
      const dist = Math.hypot(dx, dy) || 1;
      const turn = Math.abs(wrap(Math.atan2(dy, dx) - this.heading));
      let score = turn * 2 + dist / (40 * this.length);
      if (wary && Math.hypot(p[0] - this.cursor[0], p[1] - this.cursor[1]) < wary) score += 100;
      if (score < bestScore) {
        best = p;
        bestScore = score;
      }
    }
    return best;
  }

  // -- per-state motion -------------------------------------------------
  /**
   * Let a walking fly stray over an edge, then bring it back.  A fly on the
   * rim of the page, half of it hanging over the edge, is a fly.
   */
  _steerInside(dt) {
    const w = this.world;
    const L = this.length;
    const stray = (this.stray ? STRAY_L : -0.6) * L;
    const px = (this.x < w.x - stray ? 1 : 0) - (this.x > w.x + w.width + stray ? 1 : 0);
    const py = (this.y < w.y - stray ? 1 : 0) - (this.y > w.y + w.height + stray ? 1 : 0);
    if (px || py) this.heading = turnTowards(this.heading, Math.atan2(py, px), 5 * dt);
    const hard = (this.stray ? STRAY_HARD_L : 0) * L;
    this.x = clamp(this.x, w.x - hard, w.x + w.width + hard);
    this.y = clamp(this.y, w.y - hard, w.y + w.height + hard);
  }

  _updateWalk(dt) {
    const rng = this.rng;
    if (this._fleeT > 0 && this.cursor) {
      // Running away: hold a straight line, away from the pointer.
      const away = Math.atan2(this.y - this.cursor[1], this.x - this.cursor[0]);
      this.heading = turnTowards(this.heading, away, 6 * dt);
    } else {
      // Flies do not walk in straight lines; wander, with occasional sharper
      // course corrections.
      this.heading += rng.gauss(0, 1.1) * dt;
      if (rng.random() < 0.6 * dt) this.heading += rng.uniform(-1, 1);
    }
    this._steerInside(dt);

    const step = this.walkSpeed * this.pxPerMm * dt;
    this.x += Math.cos(this.heading) * step;
    this.y += Math.sin(this.heading) * step;

    const stridePx = STRIDE * this.length;
    if (stridePx > 0) this.gaitPhase = (this.gaitPhase + step / stridePx) % 1;
    this._updateGait();
  }

  /** Alternating-tripod walk with feet planted in world space. */
  _updateGait() {
    const L = this.length;
    const stridePx = STRIDE * L;
    const feet = new Array(6);
    const lifts = [0, 0, 0, 0, 0, 0];
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);

    for (const [group, offset] of [[TRIPOD_A, 0], [TRIPOD_B, 0.5]]) {
      const ph = (this.gaitPhase + offset) % 1;
      for (const i of group) {
        const restWorld = this._toWorld(LEGS[i][1]);
        const prev = this._prevLegPhase[i];
        if (ph < SWING_DUTY) {
          if (prev >= SWING_DUTY || prev > ph) {
            // Lift-off: remember where the foot leaves the ground.
            this._swingFrom[i] = [...this._footWorld[i]];
          }
          const t = ph / SWING_DUTY;
          const tx = restWorld[0] + ch * stridePx * 0.5;
          const ty = restWorld[1] + sh * stridePx * 0.5;
          const k = smoothstep(t);
          const from = this._swingFrom[i];
          lifts[i] = Math.sin(Math.PI * t);
          const out = lifts[i] * 0.05 * (LEGS[i][1][1] > 0 ? 1 : -1);
          this._footWorld[i] = [
            from[0] + (tx - from[0]) * k - sh * out * L,
            from[1] + (ty - from[1]) * k + ch * out * L,
          ];
        }
        this._prevLegPhase[i] = ph;
        const [fx, fy] = this._toLocal(this._footWorld[i]);
        const [cx, cy] = this._clampToReach(i, fx, fy);
        if (cx !== fx || cy !== fy) this._footWorld[i] = this._toWorld([cx, cy]);
        feet[i] = [cx, cy];
      }
    }
    this.pose.feet = feet;
    this.pose.lift = lifts;
  }

  /**
   * Direction back over the page, or null while within reach of it.
   *
   * Checked a short way along the current heading as well as underfoot: by the
   * time a fly at full speed has actually left the page it is already well
   * outside, so it has to commit to the turn before that.
   */
  _offGlass(lookahead = 0, padL = AIR_PAD_L) {
    const pad = padL * this.length;
    const x = this.x + Math.cos(this.heading) * this.airspeed * lookahead;
    const y = this.y + Math.sin(this.heading) * this.airspeed * lookahead;
    if (this.world.distanceTo(x, y) <= pad) return null;
    // Aim at a fresh point rather than at the centre, or every recovery
    // converges on the same spot and the flight paths turn into a starburst.
    this._target = this._randomPoint(3.0);
    return Math.atan2(this._target[1] - this.y, this._target[0] - this.x);
  }

  /** Move along the body axis.  Flies fly forwards, nose first. */
  _advance(dt) {
    const step = this.airspeed * dt;
    this.x += Math.cos(this.heading) * step;
    this.y += Math.sin(this.heading) * step;
  }

  _updateFlight(dt) {
    const rng = this.rng;
    let [tx, ty] = this._target;
    let dx = tx - this.x;
    let dy = ty - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist < 4 * this.length) {
      this._newWaypoint();
      [tx, ty] = this._target;
      dx = tx - this.x;
      dy = ty - this.y;
    }
    const desired = Math.atan2(dy, dx);

    // Now and then it slips the leash and wanders off the page altogether,
    // coming back of its own accord a moment later.
    this._excursion = Math.max(0, this._excursion - dt);
    if (this.excursions && this._excursion <= 0 && rng.random() < 0.05 * dt) {
      this._excursion = rng.uniform(0.5, 1.6);
    }
    const far = this._offGlass(0, AIR_LEASH_L);
    let escape;
    if (far !== null) escape = far; // too far out: always come back
    else if (this._excursion > 0) escape = null;
    else escape = this._offGlass(0.30);
    if (escape !== null && !this._turnLeft) {
      // Drifted off the page: flick straight back over it.
      this._turnLeft = wrap(escape - this.heading);
      this._turnRate = this._turnLeft / 0.06;
      this._saccadeIn = rng.uniform(0.05, 0.15);
    }

    if (this._turnLeft) {
      // Mid-saccade: a house fly turns in a fast flick, ~50 ms, not a lazy arc.
      let step = this._turnRate * dt;
      if (Math.abs(step) >= Math.abs(this._turnLeft)) {
        step = this._turnLeft;
        this._turnLeft = 0;
      } else {
        this._turnLeft -= step;
      }
      this.heading += step;
    } else {
      // Between saccades the heading still drifts, as an Ornstein-Uhlenbeck
      // wander bounded by the observed yaw rate.
      this._cruiseYaw +=
        (-this._cruiseYaw / CRUISE_YAW_TAU) * dt +
        CRUISE_YAW_SD * Math.sqrt((2 * dt) / CRUISE_YAW_TAU) * rng.gauss(0, 1);
      this._cruiseYaw = clamp(this._cruiseYaw, -CRUISE_YAW_MAX, CRUISE_YAW_MAX);
      const pull = clamp(wrap(desired - this.heading), -0.7, 0.7) * 0.9;
      this.heading += (this._cruiseYaw + pull) * dt;

      this._saccadeIn -= dt;
      if (this._saccadeIn <= 0) {
        this._saccadeIn = range(rng, SACCADE_GAP);
        let turn;
        if (rng.random() < 0.7) {
          // Mostly a corrective flick towards where it is going.
          turn = clamp(wrap(desired - this.heading), -1.3, 1.3);
          if (Math.abs(turn) < 0.22) turn = rng.choice([-1, 1]) * rng.uniform(0.22, 0.75);
        } else {
          turn = rng.choice([-1, 1]) * rng.uniform(0.25, 1.30);
        }
        this._turnLeft = turn;
        this._turnRate = turn / range(rng, SACCADE_RISE);
      }
    }

    // Airspeed stays near cruise: no hovering, no drifting to a stop.
    const target = this.cruiseSpeed * (this._turnLeft ? 0.75 : 1);
    this.airspeed += (target - this.airspeed) * Math.min(1, 5 * dt);
    this._advance(dt);
  }

  /**
   * Fly to the chosen spot and settle onto it.  True once touched down.
   *
   * The touchdown radius and the descent are tied to each other on purpose: a
   * fly made to creep onto an exact spot orbits it at minimum speed, which is
   * precisely what a hovering dragonfly looks like.
   */
  _updateLanding(dt) {
    const L = this.length;
    const [tx, ty] = this._target;
    const dx = tx - this.x;
    const dy = ty - this.y;
    const dist = Math.hypot(dx, dy);
    const touch = 1.5 * L;

    this.heading = turnTowards(this.heading, Math.atan2(dy, dx), 7 * dt);
    // Slow onto the spot, but never crawl: a house fly lands on the run.
    const floor = 70 * this.speedScale * this.pxPerMm;
    const want = Math.max(floor, Math.min(this.cruiseSpeed, dist / 0.30));
    this.airspeed += (want - this.airspeed) * Math.min(1, 9 * dt);
    this._advance(dt);

    // Height reaches zero exactly as it arrives, so touchdown is smooth.
    const glide = clamp((dist - touch) / (9 * L), 0, 1);
    this.height = Math.min(this.height, 2.2 * glide);

    // If it sails past, put it down rather than turning back for another go.
    this._landBest = Math.min(this._landBest, dist);
    return dist <= touch || dist > this._landBest + 2.5 * L;
  }

  // -- poses ------------------------------------------------------------
  _poseGroundRest() {
    return [LEGS.map((l) => [l[1][0], l[1][1]]), [0, 0, 0, 0, 0, 0]];
  }

  // -- grooming -----------------------------------------------------------
  //
  // A grooming bout is a run of distinct acts, each a whole number of strokes,
  // the way flies actually do it: the front legs alternately rub each other
  // and sweep over the head; the hind legs sweep down the sides of the
  // abdomen, reach up over a wing and stroke it out to the tip, and between
  // those rub each other behind the body to shed the dust they collected.
  // While the hind legs are up the fly stands on the other four, the middle
  // pair braced wider; while the front legs are up, the middle pair steps
  // forward under the head.

  _startAct(name) {
    const rng = this.rng;
    const act = { name, t: 0, side: 0 };
    const [period, lo, hi] = GROOM_ACT[name];
    act.period = period * rng.uniform(0.9, 1.1);
    act.dur = act.period * (lo + rng.randrange(hi - lo + 1));
    if (name === 'sweepWing') {
      // One wing at a time, alternating, or now and then both at once.
      const prev = this._lastWingSide ?? (rng.random() < 0.5 ? 1 : -1);
      act.side = rng.random() < 0.3 ? 0 : -prev;
      if (act.side) this._lastWingSide = act.side;
    }
    this._act = act;
    this.groomAct = name;
    this.groomSide = act.side; // -1 left, 1 right, 0 both or not one-sided
    // Cross-fade into the new act's opening position.
    this._blendFrom = this.pose.feet.map((f) => [...f]);
    this._blendLift = [...this.pose.lift];
    this._blendT = 0;
    this._blendTime = 0.16;
  }

  /** Pose for the current grooming act; advances through the bout. */
  _poseGroom(dt) {
    const plan = GROOM_PLAN[this.state];
    if (!this._act) this._startAct(plan[0]);
    const act = this._act;
    act.t += dt;
    if (act.t >= act.dur) {
      if (this.stateT >= this.stateDur) return null; // bout over, at an act boundary
      const i = plan.indexOf(act.name);
      this._startAct(plan[(i + 1) % plan.length]);
    }
    const a = this._act;
    const u = (a.t / a.period) % 1;
    const p = this.pose;
    const [feet, lift] = this._poseGroundRest();
    const wing = this._wingOpenTarget;
    wing[0] = wing[1] = 0;
    const hindUp = a.name !== 'rubFront' && a.name !== 'sweepHead';

    // The four legs left standing spread out to carry the fly.
    if (hindUp) {
      feet[0] = [0.60, -0.43];
      feet[1] = [0.60, 0.43];
      feet[2] = [-0.04, -0.63];
      feet[3] = [-0.04, 0.63];
    } else {
      feet[2] = [0.13, -0.57];
      feet[3] = [0.13, 0.57];
      feet[4] = [-0.46, -0.50];
      feet[5] = [-0.46, 0.50];
    }

    if (a.name === 'rubFront') {
      // Tarsi scrubbed against each other just in front of the head, sliding
      // fore and aft in opposition.
      const w = TAU * u;
      for (const [i, sgn] of [[0, -1], [1, 1]]) {
        feet[i] = [0.585 + 0.045 * Math.sin(w) * sgn, sgn * (0.05 + 0.022 * Math.cos(w))];
        lift[i] = 1;
      }
      p.headYaw = 0.04 * Math.sin(a.t * 5);
    } else if (a.name === 'sweepHead') {
      // Both front legs reach up behind the eyes and sweep forward over them.
      for (const [i, sgn] of [[0, -1], [1, 1]]) {
        const v = (u + (sgn > 0 ? 0.07 : 0)) % 1;
        const [x, y, on] = stroke(v, 0.55, [0.37, 0.25], [0.61, 0.035], -0.06, 0.11);
        feet[i] = [x, sgn * y];
        lift[i] = on ? 0.7 : 1;
        p.over[i] = on ? 1 : 0;
      }
      p.headYaw = 0.06 * Math.sin(TAU * u);
    } else if (a.name === 'sweepAbdomen') {
      // Both hind legs stroke down the flanks together and off past the tip;
      // the wings are lifted aside to make room.
      for (const [i, sgn] of [[4, -1], [5, 1]]) {
        const [x, y, on] = stroke(u, 0.6, [-0.21, 0.31], [-0.60, 0.05], -0.06, 0.15);
        feet[i] = [x, sgn * y];
        lift[i] = 1;
        p.over[i] = on ? 1 : 0;
      }
      wing[0] = wing[1] = 0.55;
      p.abdomenBend = 0.03 * Math.sin(TAU * u);
    } else if (a.name === 'rubHind') {
      // The hind tarsi crossed behind the abdomen, rubbing each other.
      const w = TAU * u;
      for (const [i, sgn] of [[4, -1], [5, 1]]) {
        feet[i] = [-0.67 + 0.045 * Math.sin(w) * sgn, -sgn * 0.024 + 0.012 * Math.cos(w)];
        lift[i] = 1;
      }
      wing[0] = wing[1] = 0.25;
    } else if (a.name === 'sweepWing') {
      // The hind leg comes up over the wing from outside, presses it out and
      // down, and strokes along it to the tip, drawing it back as it goes.
      // Released, the wing springs back into place.
      const on = u < 0.62;
      const q = on ? 0.5 - 0.5 * Math.cos((Math.PI * u) / 0.62) : (u - 0.62) / 0.38;
      const open = on ? 0.55 - 1.15 * q : 0;
      for (const [i, sgn, k] of [[4, -1, 0], [5, 1, 1]]) {
        if (a.side && a.side !== sgn) {
          // The other hind leg stays down, tucked in a little to prop the body.
          feet[i] = [-0.42, sgn * 0.46];
          continue;
        }
        wing[k] = open;
        const ang = WING_REST_ANGLE + (WING_OUT_ANGLE - WING_REST_ANGLE) * open;
        const ax = Math.cos(ang);
        const ay = Math.sin(ang);
        // Along the wing (s from its hinge) and across it (n, out to the
        // leading edge positive).
        let s0, n0;
        if (on) {
          s0 = 0.38 + 0.42 * q;
          n0 = 0.07 - 0.12 * q;
        } else {
          s0 = 0.80 - 0.42 * q;
          n0 = -0.05 + 0.12 * q + 0.22 * Math.sin(Math.PI * q);
        }
        const x = WING_BASE[0] + s0 * ax + n0 * ay;
        const y = WING_BASE[1] + s0 * ay - n0 * ax;
        feet[i] = [x, sgn * y];
        lift[i] = 1;
        p.over[i] = 1;
        p.abdomenBend += 0.05 * sgn * (on ? Math.sin(Math.PI * q) : 0);
      }
    }
    for (let i = 0; i < 6; i++) feet[i] = this._clampToReach(i, feet[i][0], feet[i][1]);
    return [feet, lift];
  }

  _poseIdle(t) {
    const [feet, lift] = this._poseGroundRest();
    // Barely-there twitches so a resting fly is not perfectly frozen.
    for (let i = 0; i < 6; i++) {
      feet[i][0] += 0.010 * Math.sin(t * 3.1 + i * 1.7);
      feet[i][1] += 0.008 * Math.sin(t * 2.3 + i * 2.9);
    }
    this.pose.headYaw = 0.035 * Math.sin(t * 1.4);
    return [feet, lift];
  }

  /** The leg thrust: legs drive down and back, then fold away. */
  _poseLaunch(u) {
    const [feet, lift] = this._poseGroundRest();
    for (let i = 0; i < 6; i++) {
      const rest = LEGS[i][1];
      const push = 1 + 0.16 * Math.sin(Math.PI * Math.min(1, u * 1.3));
      const [fx, fy] = this._clampToReach(i, rest[0] * push, rest[1] * push);
      const fold = Math.max(0, (u - 0.5) / 0.5);
      const [tx, ty] = TUCKED[i];
      feet[i] = [fx + (tx - fx) * fold, fy + (ty - fy) * fold];
      lift[i] = fold;
    }
    return [feet, lift];
  }

  /** Settle the wings back over the abdomen instead of snapping shut. */
  _foldWings(pose, dt) {
    const k = Math.min(1, 22 * dt);
    pose.wingBlur -= pose.wingBlur * k;
    pose.wingSpread -= pose.wingSpread * k;
    if (pose.wingBlur < 0.01) pose.wingBlur = 0;
    if (pose.wingSpread < 0.01) pose.wingSpread = 0;
  }

  // -- main tick --------------------------------------------------------
  update(dt) {
    dt = Math.min(dt, 0.05);
    this._reactToPredator(dt);
    this._reactToCursor(dt);
    this.stateT += dt;
    const p = this.pose;
    const s = this.state;
    p.headYaw = 0;
    p.abdomenBend = 0;
    p.bodySquash = 1;
    p.over.fill(0);
    const wingOpen = this._wingOpenTarget;
    wingOpen[0] = wingOpen[1] = 0;
    if (s !== GROOM_FRONT && s !== GROOM_HIND && s !== GROOM_WING) this.groomAct = null;
    let targetLift = null;

    if (s === WALK) {
      this._updateWalk(dt);
      this._foldWings(p, dt);
      this.height = 0;
      if (this.stateT >= this.stateDur) this._nextGroundState();
    } else if (s === IDLE || s === GROOM_FRONT || s === GROOM_HIND || s === GROOM_WING) {
      this.height = 0;
      this._foldWings(p, dt);
      if (s === IDLE) {
        [p.feet, targetLift] = this._poseIdle(this.stateT);
        if (this.stateT >= this.stateDur) this._nextGroundState();
      } else {
        const groomed = this._poseGroom(dt);
        if (groomed) [p.feet, targetLift] = groomed;
        else this._nextGroundState();
      }
    } else if (s === LAUNCH) {
      const u = smoothstep(this.stateT / this.stateDur);
      [p.feet, targetLift] = this._poseLaunch(u);
      p.bodySquash = 1 - 0.05 * Math.sin(Math.PI * u);
      // The wings are already beating.  A house fly does not spread them first
      // and pause -- the whole take-off is over in about 50 ms.
      p.wingSpread = 1;
      p.wingBlur = 1;
      this.height = 0.4 * u;
      if (this.stateT >= this.stateDur) this._enter(FLIGHT);
    } else if (s === FLIGHT) {
      this._updateFlight(dt);
      const bob = 0.12 * Math.sin(this.stateT * 6);
      this.height += (this.cruiseHeight + bob - this.height) * Math.min(1, 3 * dt);
      p.feet = TUCKED.map((t) => [...t]);
      targetLift = [1, 1, 1, 1, 1, 1];
      p.wingSpread = 1;
      p.wingBlur = 1;
      if (this.stateT >= this.stateDur) this._enter(LANDING);
    } else if (s === LANDING) {
      const landed = this._updateLanding(dt);
      const u = clamp(this.height / 1.2, 0, 1);
      p.feet = TUCKED.map((t, i) => {
        const r = LEGS[i][1];
        return [t[0] + (r[0] - t[0]) * (1 - u), t[1] + (r[1] - t[1]) * (1 - u)];
      });
      targetLift = [u, u, u, u, u, u];
      p.wingSpread = 1;
      p.wingBlur = Math.max(0.25, u);
      if (landed || this.stateT >= this.stateDur) {
        this.height = 0;
        [this.x, this.y] = this.world.clamp(this.x, this.y, 1.2 * this.length);
        this._enter(this.rng.choice([IDLE, GROOM_FRONT, WALK]));
      }
    }

    if (this._justEntered && this.state === LAUNCH) {
      // The hand-over happened inside this frame's ground-state branch, which
      // had already folded the wings; redo it so the very first drawn frame of
      // a take-off has the wings beating.
      [p.feet, targetLift] = this._poseLaunch(0);
      p.bodySquash = 1;
      p.wingSpread = 1;
      p.wingBlur = 1;
      this.height = 0;
    }
    this._justEntered = false;

    if (targetLift) p.lift = targetLift;
    // A wing let go by the grooming leg springs back, not snaps.
    const kw = Math.min(1, 24 * dt);
    p.wingOpen[0] += (wingOpen[0] - p.wingOpen[0]) * kw;
    p.wingOpen[1] += (wingOpen[1] - p.wingOpen[1]) * kw;

    // Cross-fade limb positions through state changes so nothing snaps.
    if (this._blendT < 1) {
      this._blendT = Math.min(1, this._blendT + dt / this._blendTime);
      const k = smoothstep(this._blendT);
      p.feet = p.feet.map((b, i) => {
        const a = this._blendFrom[i];
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      });
      p.lift = p.lift.map((b, i) => this._blendLift[i] + (b - this._blendLift[i]) * k);
    }

    p.height = this.height;
    p.wingPhase = (p.wingPhase + dt * 60) % TAU;
    // Keep the highlight towards a fixed world light as the body turns.
    p.light = bodyLight(this.heading);
    return p;
  }

  /** Radius around (x, y) that holds fly, legs and shadow, in CSS px. */
  get extent() {
    return this.length * 1.6 + 4;
  }
}

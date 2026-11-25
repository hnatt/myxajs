// src/random.js
var Random = class {
  constructor(seed) {
    if (seed === void 0 || seed === null) {
      seed = Math.random() * 4294967296 >>> 0;
    }
    this._s = seed >>> 0;
    this._spare = null;
  }
  /** Uniform in [0, 1). */
  random() {
    let t = this._s = this._s + 1831565813 >>> 0;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  uniform(a, b) {
    return a + (b - a) * this.random();
  }
  /** Normal deviate, by Box-Muller; the second value of each pair is kept. */
  gauss(mu = 0, sigma = 1) {
    if (this._spare !== null) {
      const z = this._spare;
      this._spare = null;
      return mu + sigma * z;
    }
    let u = 0;
    while (u <= 1e-12) u = this.random();
    const v = this.random();
    const r = Math.sqrt(-2 * Math.log(u));
    this._spare = r * Math.sin(2 * Math.PI * v);
    return mu + sigma * r * Math.cos(2 * Math.PI * v);
  }
  /** Integer in [0, n). */
  randrange(n) {
    return Math.floor(this.random() * n);
  }
  choice(seq) {
    return seq[this.randrange(seq.length)];
  }
};

// src/world.js
var CSS_PX_PER_MM = 96 / 25.4;
var World = class {
  constructor(width = 1280, height = 800, pxPerMm = CSS_PX_PER_MM) {
    this.x = 0;
    this.y = 0;
    this.width = width;
    this.height = height;
    this.pxPerMm = pxPerMm;
  }
  resize(width, height) {
    this.width = width;
    this.height = height;
  }
  contains(x, y) {
    return x >= this.x && x < this.x + this.width && y >= this.y && y < this.y + this.height;
  }
  /** Clamp a point into the region, keeping `margin` px of headroom. */
  clamp(x, y, margin = 0) {
    const m = Math.min(margin, this.width / 2 - 1, this.height / 2 - 1);
    return [
      Math.min(Math.max(x, this.x + m), this.x + this.width - m),
      Math.min(Math.max(y, this.y + m), this.y + this.height - m)
    ];
  }
  distanceTo(x, y) {
    const dx = Math.max(this.x - x, 0, x - (this.x + this.width));
    const dy = Math.max(this.y - y, 0, y - (this.y + this.height));
    return Math.hypot(dx, dy);
  }
};

// src/util.js
var TAU = Math.PI * 2;
function smoothstep(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function wrap(a) {
  return ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
}
function turnTowards(cur, target, maxDelta) {
  const d = wrap(target - cur);
  return cur + clamp(d, -maxDelta, maxDelta);
}
function pick(rng, choices) {
  let total = 0;
  for (const [, w] of choices) total += w;
  let r = rng.uniform(0, total);
  for (const [name, w] of choices) {
    r -= w;
    if (r <= 0) return name;
  }
  return choices[choices.length - 1][0];
}
function bodyLight(heading) {
  const c = Math.cos(-heading);
  const s = Math.sin(-heading);
  const lx = -0.55;
  const ly = -0.84;
  return [lx * c - ly * s, lx * s + ly * c];
}

// src/fly-geometry.js
var LEGS = [
  [[0.2, -0.1], [0.56, -0.4], 0.195, 0.202, 0.13, -1],
  [[0.2, 0.1], [0.56, 0.4], 0.195, 0.202, 0.13, 1],
  [[0.07, -0.13], [0.06, -0.58], 0.178, 0.185, 0.14, 1],
  [[0.07, 0.13], [0.06, 0.58], 0.178, 0.185, 0.14, -1],
  [[-0.07, -0.12], [-0.5, -0.52], 0.251, 0.26, 0.15, 1],
  [[-0.07, 0.12], [-0.5, 0.52], 0.251, 0.26, 0.15, -1]
];
var CURLED = [
  [0.416, -0.28],
  [0.416, 0.28],
  [0.064, -0.4],
  [0.064, 0.4],
  [-0.328, -0.36],
  [-0.328, 0.36]
];
var TUCKED = [
  [-0.02, -0.36],
  [-0.02, 0.36],
  [-0.18, -0.38],
  [-0.18, 0.38],
  [-0.44, -0.4],
  [-0.44, 0.4]
];
var TRIPOD_A = [0, 3, 4];
var TRIPOD_B = [1, 2, 5];
function makePose(feet, lift) {
  return {
    feet: feet ?? LEGS.map((l) => [l[1][0], l[1][1]]),
    lift: lift ?? [0, 0, 0, 0, 0, 0],
    wingSpread: 0,
    // 0 = folded at rest, 1 = out
    wingBlur: 0,
    // 0 = still, 1 = beating
    wingPhase: 0,
    headYaw: 0,
    abdomenBend: 0,
    bodySquash: 1,
    // crouch before take-off
    height: 0,
    // body lengths above the surface
    light: [-0.6, -0.8]
    // unit vector, body-local
  };
}

// src/fly.js
var WALK = "walk";
var IDLE = "idle";
var GROOM_FRONT = "groom_front";
var GROOM_HIND = "groom_hind";
var GROOM_WING = "groom_wing";
var LAUNCH = "launch";
var FLIGHT = "flight";
var LANDING = "landing";
var AIRBORNE = /* @__PURE__ */ new Set([LAUNCH, FLIGHT, LANDING]);
var DEFAULT_BEHAVIOUR = {
  walk: 0.4,
  groomFront: 0.16,
  groomHind: 0.12,
  groomWing: 0.08,
  idle: 0.14,
  takeOff: 0.1
};
var BEHAVIOUR_STATE = {
  walk: WALK,
  groomFront: GROOM_FRONT,
  groomHind: GROOM_HIND,
  groomWing: GROOM_WING,
  idle: IDLE,
  takeOff: LAUNCH
};
var STRAY_L = 1.6;
var STRAY_HARD_L = 2.8;
var AIR_PAD_L = 3;
var AIR_LEASH_L = 14;
var SACCADE_GAP = [0.02, 0.07];
var SACCADE_RISE = [0.03, 0.05];
var CRUISE_YAW_MAX = 2.6;
var CRUISE_YAW_SD = 1.35;
var CRUISE_YAW_TAU = 0.3;
var STRIDE = 0.28;
var SWING_DUTY = 0.45;
var BLEND_TIME = 0.2;
var LAUNCH_BLEND = 0.04;
var CURSOR_PANIC_MM = 9;
var CURSOR_SCURRY_MM = 19;
var CURSOR_AIR_MM = 26;
var CURSOR_PANIC_TTC = 0.32;
var CURSOR_SCURRY_TTC = 0.7;
var CURSOR_NOTICE_MM = 85;
var range = (rng, [a, b]) => rng.uniform(a, b);
var Fly = class {
  /**
   * @param {import('./world.js').World} world
   * @param {Random} rng
   * @param {object} opts  sizeMm, speed, shyness, cursor, stray, excursions,
   *                       behaviour (weights)
   */
  constructor(world, rng = new Random(), opts = {}) {
    this.world = world;
    this.rng = rng;
    this.sizeMm = opts.sizeMm ?? 7;
    this.speedScale = opts.speed ?? 1;
    this.shyness = opts.shyness ?? 1;
    this.cursorFear = opts.cursor ?? true;
    this.stray = opts.stray ?? true;
    this.excursions = opts.excursions ?? true;
    this.setBehaviour(opts.behaviour);
    this.x = world.x + world.width * 0.5;
    this.y = world.y + world.height * 0.5;
    this.heading = rng.uniform(0, TAU);
    this.height = 0;
    this.walkSpeed = 0;
    this.airspeed = 0;
    this.cruiseSpeed = 0;
    this.cruiseHeight = 2;
    this._turnLeft = 0;
    this._turnRate = 0;
    this.gaitPhase = 0;
    this._footWorld = [];
    this._swingFrom = [];
    this._prevLegPhase = [0, 0, 0, 0, 0, 0];
    this.pose = makePose();
    this._blendFrom = this.pose.feet.map((f) => [...f]);
    this._blendLift = [0, 0, 0, 0, 0, 0];
    this._blendT = 1;
    this._blendTime = BLEND_TIME;
    this.state = IDLE;
    this.stateT = 0;
    this.stateDur = rng.uniform(0.4, 1.2);
    this._target = null;
    this._justEntered = false;
    this.hidden = false;
    this.predator = null;
    this.predatorVel = [0, 0];
    this._alarmCd = 0;
    this.respawnIn = null;
    this._excursion = 0;
    this._cruiseYaw = 0;
    this._escapeIn = null;
    this._landBest = Infinity;
    this._saccadeIn = 0;
    this.cursor = null;
    this.cursorVel = [0, 0];
    this._cursorCd = 0;
    this._fleeT = 0;
    this._panic = false;
    this._reseedFeet();
    this.respawn();
  }
  setBehaviour(weights) {
    const w = { ...DEFAULT_BEHAVIOUR, ...weights || {} };
    this.groundChoices = Object.keys(BEHAVIOUR_STATE).filter((k) => w[k] > 0).map((k) => [BEHAVIOUR_STATE[k], w[k]]);
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
        this.predatorVel[1] + (vy - this.predatorVel[1]) * k
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
      this._escapeIn = this.rng.uniform(0.03, 0.055);
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
      const k = Math.min(1, 20 * dt);
      this.cursorVel = [
        this.cursorVel[0] + (vx - this.cursorVel[0]) * k,
        this.cursorVel[1] + (vy - this.cursorVel[1]) * k
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
      if (distMm < CURSOR_AIR_MM * shy || near && ttc < CURSOR_SCURRY_TTC) {
        if (this.state === LANDING) {
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
    if (distMm < CURSOR_PANIC_MM * shy || near && ttc < CURSOR_PANIC_TTC) {
      this.heading = away + rng.gauss(0, 0.25);
      this._panic = true;
      this._enter(LAUNCH);
      this.stateDur = 0.05;
      this._cursorCd = 0.5;
    } else if (distMm < CURSOR_SCURRY_MM * shy || near && ttc < CURSOR_SCURRY_TTC) {
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
    this.heading = aim + rng.gauss(0, 0.3);
    this.hidden = false;
    this.respawnIn = null;
    this.predator = null;
    this._excursion = 0;
    this._reseedFeet();
    this._enter(FLIGHT);
    this._target = this._randomPoint(3);
    this.stateDur = rng.uniform(1.2, 3);
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
      this.stateDur = rng.uniform(1.2, 5);
      this._fleeT = 0;
      this._reseedFeet();
    } else if (state === IDLE) {
      this.stateDur = rng.uniform(0.6, 2.6);
    } else if (state === GROOM_FRONT || state === GROOM_HIND || state === GROOM_WING) {
      this.stateDur = rng.uniform(1.4, 3.4);
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
      this.rng.uniform(w.y + margin, w.y + w.height - margin)
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
      const p = this._randomPoint(2);
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
      const away = Math.atan2(this.y - this.cursor[1], this.x - this.cursor[0]);
      this.heading = turnTowards(this.heading, away, 6 * dt);
    } else {
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
            from[1] + (ty - from[1]) * k + ch * out * L
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
    this._target = this._randomPoint(3);
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
    this._excursion = Math.max(0, this._excursion - dt);
    if (this.excursions && this._excursion <= 0 && rng.random() < 0.05 * dt) {
      this._excursion = rng.uniform(0.5, 1.6);
    }
    const far = this._offGlass(0, AIR_LEASH_L);
    let escape;
    if (far !== null) escape = far;
    else if (this._excursion > 0) escape = null;
    else escape = this._offGlass(0.3);
    if (escape !== null && !this._turnLeft) {
      this._turnLeft = wrap(escape - this.heading);
      this._turnRate = this._turnLeft / 0.06;
      this._saccadeIn = rng.uniform(0.05, 0.15);
    }
    if (this._turnLeft) {
      let step = this._turnRate * dt;
      if (Math.abs(step) >= Math.abs(this._turnLeft)) {
        step = this._turnLeft;
        this._turnLeft = 0;
      } else {
        this._turnLeft -= step;
      }
      this.heading += step;
    } else {
      this._cruiseYaw += -this._cruiseYaw / CRUISE_YAW_TAU * dt + CRUISE_YAW_SD * Math.sqrt(2 * dt / CRUISE_YAW_TAU) * rng.gauss(0, 1);
      this._cruiseYaw = clamp(this._cruiseYaw, -CRUISE_YAW_MAX, CRUISE_YAW_MAX);
      const pull = clamp(wrap(desired - this.heading), -0.7, 0.7) * 0.9;
      this.heading += (this._cruiseYaw + pull) * dt;
      this._saccadeIn -= dt;
      if (this._saccadeIn <= 0) {
        this._saccadeIn = range(rng, SACCADE_GAP);
        let turn;
        if (rng.random() < 0.7) {
          turn = clamp(wrap(desired - this.heading), -1.3, 1.3);
          if (Math.abs(turn) < 0.22) turn = rng.choice([-1, 1]) * rng.uniform(0.22, 0.75);
        } else {
          turn = rng.choice([-1, 1]) * rng.uniform(0.25, 1.3);
        }
        this._turnLeft = turn;
        this._turnRate = turn / range(rng, SACCADE_RISE);
      }
    }
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
    const floor = 70 * this.speedScale * this.pxPerMm;
    const want = Math.max(floor, Math.min(this.cruiseSpeed, dist / 0.3));
    this.airspeed += (want - this.airspeed) * Math.min(1, 9 * dt);
    this._advance(dt);
    const glide = clamp((dist - touch) / (9 * L), 0, 1);
    this.height = Math.min(this.height, 2.2 * glide);
    this._landBest = Math.min(this._landBest, dist);
    return dist <= touch || dist > this._landBest + 2.5 * L;
  }
  // -- poses ------------------------------------------------------------
  _poseGroundRest() {
    return [LEGS.map((l) => [l[1][0], l[1][1]]), [0, 0, 0, 0, 0, 0]];
  }
  /** Front tarsi held up in front of the head and scrubbed together. */
  _poseGroomFront(t) {
    const [feet, lift] = this._poseGroundRest();
    const r = Math.sin(t * 21);
    for (const [i, sgn] of [[0, -1], [1, 1]]) {
      feet[i] = [0.46 + 0.06 * r * sgn, sgn * (0.085 + 0.045 * r)];
      lift[i] = 1;
    }
    this.pose.headYaw = 0.05 * Math.sin(t * 7);
    return [feet, lift];
  }
  /** Hind legs sweeping forward over the abdomen, alternating sides. */
  _poseGroomHind(t) {
    const [feet, lift] = this._poseGroundRest();
    for (const [i, sgn] of [[4, -1], [5, 1]]) {
      const ph = t * 6.5 + (i === 4 ? 0 : Math.PI);
      const u = 0.5 - 0.5 * Math.cos(ph);
      const rest = LEGS[i][1];
      feet[i] = [rest[0] + 0.3 * u, sgn * (Math.abs(rest[1]) - 0.34 * u)];
      lift[i] = u;
    }
    this.pose.abdomenBend = 0.07 * Math.sin(t * 6.5);
    return [feet, lift];
  }
  /** A hind leg stroked back along the wing membrane. */
  _poseGroomWing(t) {
    const [feet, lift] = this._poseGroundRest();
    const u = 0.5 - 0.5 * Math.cos(t * 4.5);
    const [i, sgn] = Math.floor(t * 0.5) % 2 === 0 ? [4, -1] : [5, 1];
    feet[i] = [-0.1 - 0.42 * u, sgn * (0.14 + 0.16 * u)];
    lift[i] = 1;
    this.pose.abdomenBend = 0.05 * sgn * u;
    return [feet, lift];
  }
  _poseIdle(t) {
    const [feet, lift] = this._poseGroundRest();
    for (let i = 0; i < 6; i++) {
      feet[i][0] += 0.01 * Math.sin(t * 3.1 + i * 1.7);
      feet[i][1] += 8e-3 * Math.sin(t * 2.3 + i * 2.9);
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
    p.headYaw = 0;
    p.abdomenBend = 0;
    p.bodySquash = 1;
    let targetLift = null;
    const s = this.state;
    if (s === WALK) {
      this._updateWalk(dt);
      this._foldWings(p, dt);
      this.height = 0;
      if (this.stateT >= this.stateDur) this._nextGroundState();
    } else if (s === IDLE || s === GROOM_FRONT || s === GROOM_HIND || s === GROOM_WING) {
      this.height = 0;
      this._foldWings(p, dt);
      let feet;
      if (s === IDLE) [feet, targetLift] = this._poseIdle(this.stateT);
      else if (s === GROOM_FRONT) [feet, targetLift] = this._poseGroomFront(this.stateT);
      else if (s === GROOM_HIND) [feet, targetLift] = this._poseGroomHind(this.stateT);
      else [feet, targetLift] = this._poseGroomWing(this.stateT);
      p.feet = feet;
      if (this.stateT >= this.stateDur) this._nextGroundState();
    } else if (s === LAUNCH) {
      const u = smoothstep(this.stateT / this.stateDur);
      [p.feet, targetLift] = this._poseLaunch(u);
      p.bodySquash = 1 - 0.05 * Math.sin(Math.PI * u);
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
      [p.feet, targetLift] = this._poseLaunch(0);
      p.bodySquash = 1;
      p.wingSpread = 1;
      p.wingBlur = 1;
      this.height = 0;
    }
    this._justEntered = false;
    if (targetLift) p.lift = targetLift;
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
    p.light = bodyLight(this.heading);
    return p;
  }
  /** Radius around (x, y) that holds fly, legs and shadow, in CSS px. */
  get extent() {
    return this.length * 1.6 + 4;
  }
};

// src/spider-geometry.js
var LEGS2 = [
  [[0.3, -0.15], [0.88, -0.55], 0.32, 0.335, 0.13, -1],
  [[0.3, 0.15], [0.88, 0.55], 0.32, 0.335, 0.13, 1],
  [[0.18, -0.19], [0.37, -0.92], 0.34, 0.355, 0.14, 1],
  [[0.18, 0.19], [0.37, 0.92], 0.34, 0.355, 0.14, -1],
  [[0.04, -0.19], [-0.26, -0.88], 0.34, 0.355, 0.14, -1],
  [[0.04, 0.19], [-0.26, 0.88], 0.34, 0.355, 0.14, 1],
  [[-0.08, -0.17], [-0.79, -0.72], 0.415, 0.435, 0.15, 1],
  [[-0.08, 0.17], [-0.79, 0.72], 0.415, 0.435, 0.15, -1]
];
var TETRAPOD_A = [0, 4, 3, 7];
var TETRAPOD_B = [1, 5, 2, 6];
var CROUCHED = [
  [0.62, -0.42],
  [0.62, 0.42],
  [0.3, -0.68],
  [0.3, 0.68],
  [-0.18, -0.66],
  [-0.18, 0.66],
  [-0.6, -0.55],
  [-0.6, 0.55]
];
function makeSpiderPose() {
  return {
    feet: LEGS2.map((l) => [l[1][0], l[1][1]]),
    lift: [0, 0, 0, 0, 0, 0, 0, 0],
    palp: 0,
    // pedipalp waggle
    bite: 0,
    // chelicerae working, 0 = closed, 1 = spread
    crouch: 0,
    // 0 = standing, 1 = gathered to jump
    height: 0,
    // body lengths above the surface, mid-leap
    light: [-0.6, -0.8]
  };
}

// src/spider.js
var LURK = "lurk";
var PATROL = "patrol";
var STALK = "stalk";
var POUNCE = "pounce";
var RETREAT = "retreat";
var HIDE = "hide";
var SEIZE = "seize";
var HAUL = "haul";
var FEED = "feed";
var CARRY_AT = 0.48;
var RESPAWN_DELAY = [10, 60];
var SIGHT_MM = 320;
var POUNCE_MM = 62;
var CATCH_L = 0.42;
var BAND_L = 2.2;
var LANE_L = 1.1;
var HIDE_L = 1.7;
var TRACK_RATE = 2.6;
var AIM_NOISE = 1.6;
var AIM_DECAY = 2.5;
var STRIDE2 = 0.62;
var SWING_DUTY2 = 0.45;
var GAIT_TURN_RADIUS = 0.95;
var MAX_DRAG = 0.55;
var BLEND_TIME2 = 0.16;
var AIRBORNE2 = /* @__PURE__ */ new Set([FLIGHT, LANDING, LAUNCH]);
var Spider = class {
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
    this.sizeMm = opts.sizeMm ?? 9;
    this.speedScale = opts.speed ?? 1;
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
    this._restJitter = LEGS2.map(() => [rng.gauss(0, 0.05), rng.gauss(0, 0.06)]);
    this._idlePhase = LEGS2.map(() => rng.uniform(0, TAU));
    this._idleT = 0;
    this._aim = 0;
    this.carried = null;
    this.carriedPose = makePose(CURLED.map((f) => [...f]), [1, 1, 1, 1, 1, 1]);
    this._carryYaw = 0;
    this._struggle = 0;
    this._lap = rng.random() < 0.5 ? 1 : -1;
    this._wave = 0;
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
    s = (s % total + total) % total;
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
      [Math.abs(px - x), 2 * w + h + (y + h - cy)]
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
      let gap = ((goalS - here) % total + total) % total;
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
      base[1] + 0.12 * power * Math.sin(t * 19 + i * 2.7)
    ]);
    pose.lift = [1, 1, 1, 1, 1, 1];
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
      [m.y + m.height - y, [x, m.y + m.height + out]]
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
    const base = LEGS2[i][1];
    const j = this._restJitter[i];
    return [base[0] + j[0], base[1] + j[1]];
  }
  _reseedFeet() {
    this._footWorld = LEGS2.map((_, i) => this._toWorld(this._rest(i)));
    this._swingFrom = this._footWorld.map((p) => [...p]);
  }
  _clampToReach(i, fx, fy) {
    const [coxa, , femur, tibia, tarsus] = LEGS2[i];
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
    const stride = STRIDE2 * this.length;
    if (stride > 0) this.gaitPhase = (this.gaitPhase + (travel + swept * this.length) / stride) % 1;
    this._updateGait(reverse);
  }
  _updateGait(reverse = false) {
    const L = this.length;
    const way = reverse ? -1 : 1;
    const stride = STRIDE2 * L;
    const feet = new Array(8);
    const lifts = [0, 0, 0, 0, 0, 0, 0, 0];
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    for (const [group, offset] of [[TETRAPOD_A, 0], [TETRAPOD_B, 0.5]]) {
      const ph = (this.gaitPhase + offset) % 1;
      for (const i of group) {
        const rest = this._rest(i);
        const prev = this._prevLegPhase[i];
        if (ph < SWING_DUTY2) {
          if (prev >= SWING_DUTY2 || prev > ph) this._swingFrom[i] = [...this._footWorld[i]];
          const restWorld = this._toWorld(rest);
          const t = ph / SWING_DUTY2;
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
    for (let i = 0; i < 8; i++) feet[i] = this._clampToReach(i, feet[i][0], feet[i][1]);
  }
  update(dt) {
    dt = Math.min(dt, 0.05);
    this.stateT += dt;
    const p = this.pose;
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
          this._track(fly.x, fly.y, dt, 2.2);
          this._settle(dt);
          if (this.stateT > 0.4) this._enter(STALK);
        } else if (this.stateT >= this.stateDur) {
          const r = this.rng.random();
          if (this._nearestPrey()) {
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
        } else if (AIRBORNE2.has(fly.state)) {
          this._freeze = 0.3;
          this._track(fly.x, fly.y, dt);
          this._settle(dt);
        } else {
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
        this.height = 0;
        const [d, n] = this._edge();
        this.heading = turnTowards(this.heading, Math.atan2(n[1], n[0]), 1.8 * dt);
        this._walkBackwards(dt);
        this._clasp();
        p.bite = 0.22 + 0.1 * Math.sin(this.stateT * 5);
        p.palp = 0.4 * Math.sin(this.stateT * 3);
        if (d <= -HIDE_L * L * 0.92 || this.stateT >= this.stateDur) this._enter(FEED);
        break;
      }
      case FEED: {
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
      this._blendT = Math.min(1, this._blendT + dt / BLEND_TIME2);
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
};

// src/overlay.js
var STYLE = [
  "position:fixed",
  "inset:0",
  "width:100%",
  "height:100%",
  "margin:0",
  "padding:0",
  "border:0",
  "background:transparent",
  "pointer-events:none",
  "user-select:none",
  "-webkit-user-select:none",
  "touch-action:none",
  "contain:strict"
].join(";");
var Overlay = class {
  /**
   * @param {object} opts  canvas, container, zIndex, maxDpr
   */
  constructor(opts = {}) {
    this.owned = !opts.canvas;
    this.maxDpr = opts.maxDpr ?? 2;
    let canvas = opts.canvas;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.setAttribute("style", `${STYLE};z-index:${opts.zIndex ?? 2147483647}`);
      (opts.container || document.body).appendChild(canvas);
    } else {
      canvas.style.pointerEvents = "none";
    }
    canvas.setAttribute("aria-hidden", "true");
    canvas.setAttribute("role", "presentation");
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this._dirty = [];
    this._onResize = () => this.resize();
    if (typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(canvas);
    }
    window.addEventListener("resize", this._onResize, { passive: true });
    this.resize();
  }
  /** Match the backing store to the element's size and the device pixel
   * ratio.  Returns true if anything changed (the canvas is then blank). */
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(this.maxDpr, window.devicePixelRatio || 1);
    if (w === this.width && h === this.height && dpr === this.dpr) return false;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this._dirty = [];
    if (this.onresize) this.onresize(w, h);
    return true;
  }
  /** Where the canvas sits in the viewport, for mapping pointer coordinates.
   * A fixed overlay we created is always at the origin. */
  origin() {
    if (this.owned) return [0, 0];
    const r = this.canvas.getBoundingClientRect();
    return [r.left, r.top];
  }
  /** Clear what was drawn last frame and start a new frame in CSS pixels. */
  begin() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const [x0, y0, x1, y1] of this._dirty) {
      const ax = Math.max(0, Math.floor(x0 * dpr));
      const ay = Math.max(0, Math.floor(y0 * dpr));
      const bx = Math.min(this.canvas.width, Math.ceil(x1 * dpr));
      const by = Math.min(this.canvas.height, Math.ceil(y1 * dpr));
      if (bx > ax && by > ay) ctx.clearRect(ax, ay, bx - ax, by - ay);
    }
    this._dirty = [];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  /** Note a box about to be drawn into, so the next frame clears it.
   * Returns false if it is entirely off the canvas: nothing to draw. */
  mark(x, y, r) {
    const x0 = x - r, y0 = y - r, x1 = x + r, y1 = y + r;
    if (x1 < 0 || y1 < 0 || x0 > this.width || y0 > this.height) return false;
    this._dirty.push([x0 - 1, y0 - 1, x1 + 1, y1 + 1]);
    return true;
  }
  clearAll() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._dirty = [];
  }
  destroy() {
    window.removeEventListener("resize", this._onResize);
    if (this._ro) this._ro.disconnect();
    if (this.owned) this.canvas.remove();
    else this.clearAll();
  }
};

// src/pointer.js
var OPTS = { passive: true, capture: true };
var Pointer = class {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.present = false;
    this._touchTimer = 0;
    this._move = (e) => {
      this.x = e.clientX;
      this.y = e.clientY;
      this.present = true;
      if (e.pointerType === "touch" || e.pointerType === "pen") this._lingerThenLeave();
    };
    this._leave = (e) => {
      if (!e.relatedTarget) this.present = false;
    };
    this._gone = () => {
      this.present = false;
    };
    window.addEventListener("pointermove", this._move, OPTS);
    window.addEventListener("pointerdown", this._move, OPTS);
    document.addEventListener("pointerout", this._leave, OPTS);
    window.addEventListener("blur", this._gone, OPTS);
  }
  /** A finger lifted from the glass is no longer looming over anything. */
  _lingerThenLeave() {
    clearTimeout(this._touchTimer);
    this._touchTimer = setTimeout(() => {
      this.present = false;
    }, 600);
  }
  /** Position relative to an origin, or null when there is no pointer. */
  at(originX = 0, originY = 0) {
    return this.present ? [this.x - originX, this.y - originY] : null;
  }
  destroy() {
    clearTimeout(this._touchTimer);
    window.removeEventListener("pointermove", this._move, OPTS);
    window.removeEventListener("pointerdown", this._move, OPTS);
    document.removeEventListener("pointerout", this._leave, OPTS);
    window.removeEventListener("blur", this._gone, OPTS);
  }
};

// src/fly-render.js
var TAU2 = Math.PI * 2;
var THORAX_DARK = [0.14, 0.15, 0.19];
var THORAX_LIGHT = [0.5, 0.52, 0.6];
var STRIPE = [0.055, 0.058, 0.075];
var ABDOMEN_DARK = [0.06, 0.068, 0.085];
var ABDOMEN_LIGHT = [0.23, 0.242, 0.3];
var ABDOMEN_MIDLINE = [0.04, 0.045, 0.055];
var EYE_DARK = [0.215, 0.14, 0.17];
var EYE_LIGHT = [0.52, 0.365, 0.38];
var FRONS = [0.73, 0.65, 0.63];
var LEG = [0.1, 0.1, 0.115];
var LEG_LIT = [0.3, 0.31, 0.345];
var VEIN = [0.3, 0.3, 0.345];
var TARSUS = [0.52, 0.5, 0.28];
var WING_BASE = [0.05, 0.1];
var WING_LEN = 0.84;
var WING_HALFW = 0.28;
var WING_REST_ANGLE = 143 * Math.PI / 180;
var WING_OUT_ANGLE = 118 * Math.PI / 180;
var WING_BEAT_MID = 112 * Math.PI / 180;
var WING_BEAT_AMP = 33 * Math.PI / 180;
var WING_FLAT = "rgba(160,166,175,0.55)";
var DETAIL_PX = 42;
function rgb(c, a = 1) {
  const r = Math.round(c[0] * 255);
  const g = Math.round(c[1] * 255);
  const b = Math.round(c[2] * 255);
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}
function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function lobe(x0, x1, halfW, n = 34) {
  const top = [];
  const bottom = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = x0 + (x1 - x0) * u;
    const w = halfW(u);
    top.push([x, -w]);
    bottom.push([x, w]);
  }
  return top.concat(bottom.reverse());
}
function pathOf(pts) {
  const p = new Path2D();
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
  p.closePath();
  return p;
}
function bbox(pts) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0) * 0.62 || 0.1];
}
function abdomenProfile(u) {
  const rise = 0.84 + 0.16 * Math.min(1, u / 0.14);
  return 0.185 * rise * Math.pow(Math.max(0, 1 - u ** 3), 0.36);
}
function thoraxProfile(u) {
  return 0.194 * Math.pow(1 - (2 * u - 1) ** 6 * 0.9, 0.4);
}
function buildWing(n = 48) {
  const lead = [];
  const trail = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const rise = Math.pow(Math.min(1, u / 0.2), 0.65);
    const env = Math.pow(1 - u ** 10, 0.28) * rise;
    const lobeW = 0.1 * Math.exp(-(((u - 0.2) / 0.22) ** 2)) * rise;
    lead.push([u * WING_LEN, -WING_HALFW * 0.44 * env]);
    trail.push([u * WING_LEN, WING_HALFW * (0.56 * env + lobeW)]);
  }
  return lead.concat(trail.reverse());
}
var G = null;
function geometry() {
  if (G) return G;
  const abdomen = lobe(0, -0.46, abdomenProfile, 40);
  const thorax = lobe(-0.07, 0.31, thoraxProfile, 34);
  const veins = new Path2D();
  for (const [spread, reach] of [[-0.34, 0.9], [-0.1, 0.94], [0.18, 0.92], [0.4, 0.72], [0.58, 0.42]]) {
    veins.moveTo(0.04, 0);
    veins.bezierCurveTo(
      WING_LEN * 0.35,
      spread * WING_HALFW * 0.7,
      WING_LEN * 0.7,
      spread * WING_HALFW,
      WING_LEN * reach,
      spread * WING_HALFW * 1.05
    );
  }
  const midline = new Path2D();
  midline.moveTo(0, -0.042);
  midline.bezierCurveTo(-0.22, -0.032, -0.35, -0.018, -0.46, 0);
  midline.bezierCurveTo(-0.35, 0.018, -0.22, 0.032, 0, 0.042);
  midline.closePath();
  const proboscis = new Path2D();
  proboscis.moveTo(0.5, 0);
  proboscis.bezierCurveTo(0.466, -9e-3, 0.4, -0.013, 0.326, -0.01);
  proboscis.bezierCurveTo(0.4, 0.013, 0.466, 9e-3, 0.5, 0);
  proboscis.closePath();
  const tergites = new Path2D();
  for (const x of [-0.15, -0.26, -0.36]) {
    const w = abdomenProfile(-x / 0.46);
    tergites.rect(x, -w, 0.014, 2 * w);
  }
  const stripes = new Path2D();
  for (const [y, w] of [[-0.082, 0.02], [-0.028, 0.017], [0.028, 0.017], [0.082, 0.02]]) {
    stripes.rect(-0.03, y - w / 2, 0.32, w);
  }
  const silhouette = new Path2D();
  silhouette.addPath(pathOf(lobe(-0.02, -0.48, abdomenProfile, 14)));
  silhouette.addPath(pathOf(lobe(-0.07, 0.31, thoraxProfile, 12)));
  silhouette.ellipse(0.413, 0, 0.115, 0.18, 0, 0, TAU2);
  G = {
    abdomen: pathOf(abdomen),
    thorax: pathOf(thorax),
    abdomenBox: bbox(abdomen),
    thoraxBox: bbox(thorax),
    wing: pathOf(buildWing()),
    veins,
    midline,
    tergites,
    stripes,
    proboscis,
    silhouette,
    wingFill: null
    // gradient, made once against the first context
  };
  return G;
}
function shade(ctx, path, dark, light, lv, box) {
  const [cx, cy, r] = box;
  const g = ctx.createLinearGradient(cx + lv[0] * r, cy + lv[1] * r, cx - lv[0] * r, cy - lv[1] * r);
  g.addColorStop(0, rgb(light));
  g.addColorStop(0.55, rgb(mix(light, dark, 0.5)));
  g.addColorStop(1, rgb(dark));
  ctx.fillStyle = g;
  ctx.fill(path);
}
function ik(coxa, foot, femur, tibia, sign) {
  const dx = foot[0] - coxa[0];
  const dy = foot[1] - coxa[1];
  const d = Math.max(1e-5, Math.min(Math.hypot(dx, dy), (femur + tibia) * 0.995));
  const cosK = Math.max(-1, Math.min(1, (femur * femur + d * d - tibia * tibia) / (2 * femur * d)));
  const ang = Math.atan2(dy, dx) + sign * Math.acos(cosK);
  return [coxa[0] + femur * Math.cos(ang), coxa[1] + femur * Math.sin(ang)];
}
function drawLeg(ctx, idx, foot, lift, detail) {
  const [coxa, , femur, tibia, tarsus, kneeSign] = LEGS[idx];
  const lat = idx % 2 ? 1 : -1;
  const ax = foot[0] - coxa[0];
  const ay = foot[1] - coxa[1];
  const d = Math.hypot(ax, ay) || 1e-5;
  const ankle = [foot[0] - ax / d * tarsus, foot[1] - ay / d * tarsus];
  const knee = ik(coxa, ankle, femur, tibia, kneeSign);
  const col = rgb(mix(LEG, LEG_LIT, 0.25 + 0.5 * lift));
  const thick = 1 + 0.15 * lift;
  ctx.strokeStyle = col;
  ctx.lineWidth = 0.017 * thick;
  ctx.beginPath();
  ctx.moveTo(coxa[0], coxa[1]);
  ctx.lineTo(knee[0], knee[1]);
  ctx.stroke();
  ctx.lineWidth = 0.012 * thick;
  ctx.beginPath();
  ctx.moveTo(knee[0], knee[1]);
  ctx.lineTo(ankle[0], ankle[1]);
  ctx.stroke();
  ctx.strokeStyle = rgb(TARSUS);
  ctx.lineWidth = 75e-4 * thick;
  ctx.beginPath();
  ctx.moveTo(ankle[0], ankle[1]);
  ctx.lineTo(foot[0], foot[1]);
  ctx.stroke();
  if (!detail) return;
  ctx.strokeStyle = col;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 3e-3;
  ctx.beginPath();
  const nx0 = -(ankle[1] - knee[1]);
  const ny0 = ankle[0] - knee[0];
  const n = Math.hypot(nx0, ny0) || 1;
  for (const t of [0.34, 0.6, 0.84]) {
    const bx = knee[0] + (ankle[0] - knee[0]) * t;
    const by = knee[1] + (ankle[1] - knee[1]) * t;
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + nx0 / n * 0.014 * lat, by + ny0 / n * 0.014 * lat);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}
function wingGradient(ctx, g) {
  if (!g.wingFill) {
    const w = ctx.createLinearGradient(0.06, 0, WING_LEN * 0.95, 0);
    w.addColorStop(0, "rgba(128,125,168,0.72)");
    w.addColorStop(0.4, "rgba(168,173,191,0.56)");
    w.addColorStop(0.75, "rgba(161,173,156,0.50)");
    w.addColorStop(1, "rgba(186,194,181,0.46)");
    g.wingFill = w;
  }
  return g.wingFill;
}
function drawWing(ctx, g, sign, angle, alpha, veins, flat = false) {
  ctx.save();
  ctx.translate(WING_BASE[0], WING_BASE[1] * sign);
  ctx.rotate(angle * sign);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = flat ? WING_FLAT : wingGradient(ctx, g);
  ctx.fill(g.wing);
  ctx.globalAlpha = Math.min(1, alpha * 1.25);
  ctx.strokeStyle = rgb(VEIN);
  ctx.lineWidth = 8e-3;
  ctx.stroke(g.wing);
  if (veins) {
    ctx.globalAlpha = alpha * 0.95;
    ctx.lineWidth = 65e-4;
    ctx.stroke(g.veins);
  }
  ctx.restore();
}
function drawWings(ctx, g, pose, detail) {
  if (pose.wingBlur > 0.02) {
    const amp = WING_BEAT_AMP * pose.wingBlur;
    const n = detail ? 6 : 3;
    const alpha = detail ? 0.15 : 0.24;
    for (const sign of [-1, 1]) {
      for (let k = 0; k < n; k++) {
        const c = Math.cos(Math.PI * (k / (n - 1)));
        const edge = 0.45 + 0.55 * Math.abs(c);
        drawWing(ctx, g, sign, WING_BEAT_MID + amp * c, alpha * edge, false, !detail);
      }
    }
    return;
  }
  const angle = WING_REST_ANGLE + (WING_OUT_ANGLE - WING_REST_ANGLE) * pose.wingSpread;
  for (const sign of [-1, 1]) drawWing(ctx, g, sign, angle, 0.5, detail);
}
function drawBody(ctx, g, pose) {
  const lv = pose.light;
  ctx.save();
  ctx.translate(-0.02, 0);
  ctx.rotate(pose.abdomenBend);
  shade(ctx, g.abdomen, ABDOMEN_DARK, ABDOMEN_LIGHT, lv, g.abdomenBox);
  ctx.fillStyle = rgb(ABDOMEN_MIDLINE, 0.3);
  ctx.fill(g.midline);
  ctx.fillStyle = rgb(ABDOMEN_MIDLINE, 0.28);
  ctx.fill(g.tergites);
  ctx.restore();
  shade(ctx, g.thorax, THORAX_DARK, THORAX_LIGHT, lv, g.thoraxBox);
  ctx.fillStyle = rgb(STRIPE, 0.75);
  ctx.fill(g.stripes);
  ctx.fillStyle = rgb(THORAX_DARK, 0.55);
  ctx.beginPath();
  ctx.ellipse(-0.045, 0, 0.055, 0.0825, 0, 0, TAU2);
  ctx.fill();
  ctx.save();
  ctx.rotate(pose.headYaw);
  ctx.fillStyle = rgb([0.2, 0.19, 0.19]);
  ctx.beginPath();
  ctx.ellipse(0.487, 0, 0.04, 0.052, 0, 0, TAU2);
  ctx.fill();
  ctx.fillStyle = rgb([FRONS[0] * 0.45, FRONS[1] * 0.45, FRONS[2] * 0.45]);
  ctx.beginPath();
  ctx.ellipse(0.413, 0, 0.11, 0.18, 0, 0, TAU2);
  ctx.fill();
  for (const sign of [-1, 1]) {
    ctx.save();
    ctx.translate(0.409, 0.063 * sign);
    ctx.rotate(0.2 * sign);
    ctx.scale(0.098, 0.116);
    const eg = ctx.createRadialGradient(-lv[0] * 0.45, -lv[1] * 0.45, 0.05, 0, 0, 1.25);
    eg.addColorStop(0, rgb(EYE_LIGHT));
    eg.addColorStop(0.55, rgb(mix(EYE_LIGHT, EYE_DARK, 0.5)));
    eg.addColorStop(1, rgb(EYE_DARK));
    ctx.fillStyle = eg;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.beginPath();
    ctx.arc(-lv[0] * 0.5, -lv[1] * 0.5, 0.22, 0, TAU2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = rgb(FRONS);
  ctx.fill(g.proboscis);
  ctx.restore();
  ctx.fillStyle = "rgba(117,110,87,0.85)";
  ctx.beginPath();
  ctx.arc(-0.05, -0.12, 0.022, 0, TAU2);
  ctx.moveTo(-0.05 + 0.022, 0.12);
  ctx.arc(-0.05, 0.12, 0.022, 0, TAU2);
  ctx.fill();
}
function drawFlyShadow(ctx, scale, heading, pose) {
  const g = geometry();
  const h = pose.height;
  const light = pose.light;
  const fade = Math.max(0, Math.min(1, (2.1 - h) / 0.6));
  const off = h * 0.22 * scale;
  const blur = 1 + h * 0.2;
  const alpha = 0.3 / (1 + h * 1.8) * fade;
  if (alpha < 8e-3) return;
  ctx.save();
  ctx.translate(-light[0] * off, -light[1] * off);
  ctx.rotate(heading);
  ctx.scale(scale * blur, scale * blur);
  if (h > 0.35) {
    ctx.scale(1.25, 0.85);
    const rg = ctx.createRadialGradient(-0.04, 0, 0.04, -0.04, 0, 0.45);
    rg.addColorStop(0, `rgba(13,10,8,${alpha * 0.85})`);
    rg.addColorStop(0.55, `rgba(13,10,8,${alpha * 0.45})`);
    rg.addColorStop(1, "rgba(13,10,8,0)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(-0.04, 0, 0.45, 0, TAU2);
    ctx.fill();
  } else {
    for (const [grow, a] of [[1.14, 0.34], [1, 1]]) {
      ctx.save();
      ctx.scale(grow, grow);
      ctx.fillStyle = `rgba(13,10,8,${alpha * a * 0.6})`;
      ctx.fill(g.silhouette);
      ctx.restore();
    }
  }
  ctx.restore();
}
function drawFly(ctx, scale, heading, pose, dpr = 1, detailMode = "auto") {
  const g = geometry();
  ctx.save();
  ctx.rotate(heading);
  const persp = scale * (1 + pose.height * 0.16);
  ctx.scale(persp * pose.bodySquash, persp * (1 + (1 - pose.bodySquash) * 0.35));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const detail = detailMode === "high" || detailMode === "auto" && scale * dpr >= DETAIL_PX;
  for (let i = 0; i < pose.feet.length; i++) drawLeg(ctx, i, pose.feet[i], pose.lift[i] ?? 0, detail);
  drawBody(ctx, g, pose);
  drawWings(ctx, g, pose, detail);
  ctx.restore();
}

// src/spider-render.js
var TAU3 = Math.PI * 2;
var CARAPACE_DARK = [0.075, 0.058, 0.04];
var CARAPACE_LIGHT = [0.315, 0.262, 0.19];
var CARAPACE_RIM = [0.43, 0.385, 0.31];
var ABDOMEN_PALE = [0.615, 0.58, 0.505];
var ABDOMEN_SHADE = [0.25, 0.228, 0.185];
var ABDOMEN_STRIPE = [0.045, 0.038, 0.03];
var LEG_PALE = [0.415, 0.365, 0.283];
var LEG_BAND = [0.13, 0.098, 0.062];
var EYE = [0.055, 0.05, 0.05];
var PALP = [0.42, 0.378, 0.3];
var DETAIL_PX2 = 46;
function carapaceProfile(u) {
  const base = 0.215 * Math.pow(Math.max(0, 1 - ((u - 0.6) / 0.78) ** 2), 0.42);
  const ends = Math.min(1, 0.55 + u / 0.14 * 0.45) * Math.min(1, 0.6 + (1 - u) / 0.12 * 0.4);
  return base * ends;
}
function abdomenProfile2(u) {
  const rise = 0.82 + 0.18 * Math.min(1, u / 0.18);
  return 0.24 * rise * Math.pow(Math.max(0, 1 - u ** 2.6), 0.34);
}
function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
var G2 = null;
function geometry2() {
  if (G2) return G2;
  const carapacePts = lobe(-0.05, 0.42, carapaceProfile, 32);
  const abdomenPts = lobe(-0.06, -0.58, abdomenProfile2, 36);
  const stripes = new Path2D();
  for (const sign of [-1, 1]) {
    stripes.moveTo(-0.08, sign * 0.045);
    stripes.bezierCurveTo(-0.26, sign * 0.055, -0.42, sign * 0.048, -0.54, sign * 0.03);
    stripes.bezierCurveTo(-0.42, sign * 0.135, -0.26, sign * 0.17, -0.08, sign * 0.15);
    stripes.closePath();
  }
  const silhouette = new Path2D();
  silhouette.addPath(pathOf(lobe(-0.06, -0.58, abdomenProfile2, 14)));
  silhouette.addPath(pathOf(lobe(-0.05, 0.42, carapaceProfile, 12)));
  G2 = {
    carapacePts,
    abdomenPts,
    carapace: pathOf(carapacePts),
    abdomen: pathOf(abdomenPts),
    carapaceBox: bbox(carapacePts),
    abdomenBox: bbox(abdomenPts),
    stripes,
    silhouette,
    noise: buildNoise(),
    bristles: buildBristles(),
    bands: buildBands()
  };
  return G2;
}
function buildNoise(size = 96, seed = 7) {
  const rng = new Random(seed);
  const c = makeCanvas(size, size);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < size * size; i++) {
    const roll = rng.random();
    let alpha = 0;
    let tone = 0;
    if (roll < 0.34) alpha = Math.floor(46 * rng.random());
    else if (roll > 0.74) {
      alpha = Math.floor(34 * rng.random());
      tone = 255;
    }
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = tone;
    d[i * 4 + 3] = alpha;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function buildBristles() {
  const table = [];
  for (let idx = 0; idx < 8; idx++) {
    const rng = new Random(idx * 97 + 5);
    const perLeg = [];
    for (const seg of [0, 1]) {
      for (const t of [0.24, 0.52, 0.8]) {
        for (const side of [-1, 1]) {
          const ang = rng.uniform(0.55, 1.15);
          perLeg.push([seg, t, side, Math.sin(ang), Math.cos(ang) * 0.3, 0.03 * (0.6 + rng.random())]);
        }
      }
    }
    table.push(perLeg);
  }
  return table;
}
function buildBands() {
  const table = [];
  for (let idx = 0; idx < 8; idx++) {
    const rng = new Random(idx * 31 + 11);
    const perLeg = [];
    for (const [seg, spots] of [[0, [0.3, 0.7]], [1, [0.24, 0.64]], [2, [0.48]]]) {
      for (const t of spots) {
        const start = Math.min(0.88, Math.max(0.04, t + rng.uniform(-0.09, 0.09)));
        perLeg.push([seg, start, Math.min(1, start + 0.13 + 0.09 * rng.random())]);
      }
    }
    table.push(perLeg);
  }
  return table;
}
function noisePattern(ctx, g, devScale) {
  const pattern = ctx.createPattern(g.noise, "repeat");
  const k = Math.max(0.8, devScale / 1.6);
  if (pattern.setTransform) pattern.setTransform(new DOMMatrix([1 / k, 0, 0, 1 / k, 0, 0]));
  return pattern;
}
function innerShadow(ctx, path) {
  ctx.save();
  ctx.clip(path);
  for (const [width, alpha] of [[0.115, 0.1], [0.065, 0.12], [0.03, 0.15]]) {
    ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
    ctx.lineWidth = width;
    ctx.stroke(path);
  }
  ctx.restore();
}
function pile(ctx, pts, path, count, length, seed, colour, alpha) {
  const rng = new Random(seed);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  ctx.save();
  ctx.clip(path);
  ctx.strokeStyle = rgb(colour, alpha);
  ctx.lineWidth = 7e-3;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const x = rng.uniform(x0, x1);
    const y = rng.uniform(y0, y1);
    const a = rng.uniform(0, TAU3);
    const h = length * (0.5 + rng.random());
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * h, y + Math.sin(a) * h);
  }
  ctx.stroke();
  ctx.restore();
}
function hairs(ctx, pts, count, length, seed, colour, alpha, width) {
  const rng = new Random(seed);
  const n = pts.length;
  let cx = 0, cy = 0;
  for (const [x, y] of pts) {
    cx += x;
    cy += y;
  }
  cx /= n;
  cy /= n;
  ctx.strokeStyle = rgb(colour, alpha);
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let k = 0; k < count; k++) {
    const i = Math.floor((k + rng.random()) * n / count) % n;
    const [x, y] = pts[i];
    const dx = x - cx, dy = y - cy;
    const d = Math.hypot(dx, dy) || 1;
    const nx = dx / d, ny = dy / d;
    const a = rng.uniform(-0.95, 0.95);
    const ca = Math.cos(a), sa = Math.sin(a);
    const hx = nx * ca - ny * sa, hy = nx * sa + ny * ca;
    const h = length * (0.25 + 1.5 * rng.random() ** 2);
    ctx.moveTo(x - nx * h * 0.25, y - ny * h * 0.25);
    ctx.lineTo(x + hx * h, y + hy * h);
  }
  ctx.stroke();
}
var hairCache = /* @__PURE__ */ new Map();
function hairLayer(devScale, part) {
  const key = `${part}:${Math.round(devScale)}`;
  let entry = hairCache.get(key);
  if (entry) return entry;
  if (hairCache.size > 8) hairCache.clear();
  const g = geometry2();
  const isAbdomen = part === "abdomen";
  const pts = isAbdomen ? g.abdomenPts : g.carapacePts;
  const path = isAbdomen ? g.abdomen : g.carapace;
  const pad = 0.16;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  x0 -= pad;
  x1 += pad;
  y0 -= pad;
  y1 += pad;
  const w = Math.max(1, Math.ceil((x1 - x0) * devScale) + 2);
  const h = Math.max(1, Math.ceil((y1 - y0) * devScale) + 2);
  const canvas = makeCanvas(w, h);
  const c = canvas.getContext("2d");
  c.scale(devScale, devScale);
  c.translate(-x0, -y0);
  innerShadow(c, path);
  if (isAbdomen) {
    pile(c, pts, path, 90, 0.055, 31, [0.14, 0.115, 0.085], 0.3);
    hairs(c, pts, 150, 0.07, 11, [0.13, 0.105, 0.075], 0.5, 55e-4);
  } else {
    pile(c, pts, path, 70, 0.048, 41, [0.1, 0.08, 0.055], 0.32);
    hairs(c, pts, 110, 0.058, 23, [0.1, 0.078, 0.055], 0.5, 55e-4);
  }
  entry = { canvas, x0, y0, w: w / devScale, h: h / devScale };
  hairCache.set(key, entry);
  return entry;
}
function blitHairs(ctx, devScale, part) {
  const e = hairLayer(devScale, part);
  ctx.drawImage(e.canvas, e.x0, e.y0, e.w, e.h);
}
function sheen(ctx, path, box, lv) {
  const [cx, cy, r] = box;
  const hx = cx + lv[0] * r * 0.42;
  const hy = cy + lv[1] * r * 0.42;
  const g = ctx.createRadialGradient(hx, hy, r * 0.04, hx, hy, r * 0.8);
  g.addColorStop(0, "rgba(255,255,255,0.17)");
  g.addColorStop(0.6, "rgba(255,255,255,0.05)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fill(path);
}
var SEGMENTS = [[0, 0.066], [1, 0.044], [2, 0.024]];
function legJoints(idx, foot) {
  const [coxa, , femur, tibia, tarsus, kneeSign] = LEGS2[idx];
  const ax = foot[0] - coxa[0];
  const ay = foot[1] - coxa[1];
  const d = Math.hypot(ax, ay) || 1e-5;
  const ankle = [foot[0] - ax / d * tarsus, foot[1] - ay / d * tarsus];
  return [coxa, ik(coxa, ankle, femur, tibia, kneeSign), ankle, foot];
}
function drawLegs(ctx, g, feet, detail) {
  const joints = feet.map((f, i) => legJoints(i, f));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const lay = (seg) => {
    ctx.beginPath();
    for (const j of joints) {
      ctx.moveTo(j[seg][0], j[seg][1]);
      ctx.lineTo(j[seg + 1][0], j[seg + 1][1]);
    }
  };
  ctx.strokeStyle = rgb(LEG_PALE);
  for (const [seg, width] of SEGMENTS) {
    ctx.lineWidth = width;
    lay(seg);
    ctx.stroke();
  }
  ctx.strokeStyle = rgb(LEG_BAND, 0.85);
  for (const [seg, width] of SEGMENTS) {
    ctx.lineWidth = width;
    ctx.beginPath();
    joints.forEach((j, idx) => {
      const p = j[seg];
      const q = j[seg + 1];
      for (const [bseg, t0, t1] of g.bands[idx]) {
        if (bseg !== seg) continue;
        ctx.moveTo(p[0] + (q[0] - p[0]) * t0, p[1] + (q[1] - p[1]) * t0);
        ctx.lineTo(p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1);
      }
    });
    ctx.stroke();
  }
  if (detail) {
    ctx.strokeStyle = "rgba(41,31,20,0.45)";
    ctx.lineWidth = 55e-4;
    ctx.beginPath();
    joints.forEach((j, idx) => {
      for (const [seg, t, side, sinA, cosA, ln] of g.bristles[idx]) {
        const p = j[seg];
        const q = j[seg + 1];
        const vx = q[0] - p[0];
        const vy = q[1] - p[1];
        const n = Math.hypot(vx, vy) || 1;
        const ux = vx / n;
        const uy = vy / n;
        const bx = p[0] + vx * t;
        const by = p[1] + vy * t;
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + (-uy * side * sinA + ux * cosA) * ln, by + (ux * side * sinA + uy * cosA) * ln);
      }
    });
    ctx.stroke();
  }
  ctx.strokeStyle = rgb(LEG_BAND);
  ctx.lineWidth = 0.026;
  ctx.beginPath();
  for (const [coxa, , , foot] of joints) {
    const ax = foot[0] - coxa[0];
    const ay = foot[1] - coxa[1];
    const d = Math.hypot(ax, ay) || 1;
    ctx.moveTo(foot[0] - ax / d * 0.05, foot[1] - ay / d * 0.05);
    ctx.lineTo(foot[0], foot[1]);
  }
  ctx.stroke();
}
function grain(ctx, g, path, devScale) {
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = noisePattern(ctx, g, devScale);
  ctx.fill(path);
  ctx.globalAlpha = 1;
}
function drawBody2(ctx, g, pose, detail, devScale) {
  const lv = pose.light;
  shade(ctx, g.abdomen, ABDOMEN_SHADE, ABDOMEN_PALE, lv, g.abdomenBox);
  ctx.save();
  ctx.clip(g.abdomen);
  ctx.fillStyle = rgb(ABDOMEN_STRIPE, 0.92);
  ctx.fill(g.stripes);
  ctx.restore();
  if (detail) grain(ctx, g, g.abdomen, devScale);
  sheen(ctx, g.abdomen, g.abdomenBox, lv);
  blitHairs(ctx, devScale, "abdomen");
  shade(ctx, g.carapace, CARAPACE_DARK, CARAPACE_LIGHT, lv, g.carapaceBox);
  if (detail) grain(ctx, g, g.carapace, devScale);
  sheen(ctx, g.carapace, g.carapaceBox, lv);
  ctx.strokeStyle = rgb(CARAPACE_RIM, 0.22);
  ctx.lineWidth = 0.012;
  ctx.stroke(g.carapace);
  blitHairs(ctx, devScale, "carapace");
  const eyes = [
    [0.345, 0.088, 0.082],
    [0.345, -0.088, 0.082],
    [0.3, 0.185, 0.04],
    [0.3, -0.185, 0.04],
    [0.075, 0.18, 0.034],
    [0.075, -0.18, 0.034]
  ];
  ctx.fillStyle = rgb(EYE);
  ctx.beginPath();
  for (const [x, y, r] of eyes) {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU3);
  }
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.20)";
  ctx.beginPath();
  for (const [x, y, r] of eyes) {
    const ex = x - lv[0] * r * 0.42;
    const ey = y - lv[1] * r * 0.42;
    ctx.moveTo(ex + r * 0.22, ey);
    ctx.arc(ex, ey, r * 0.22, 0, TAU3);
  }
  ctx.fill();
  for (const sign of [-1, 1]) {
    ctx.save();
    ctx.translate(0.4, 0.052 * sign);
    ctx.rotate((0.12 + 0.5 * pose.bite) * sign);
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.1, 0.058, 0, 0, TAU3);
    ctx.fillStyle = "rgb(38,29,22)";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 7e-3;
    ctx.stroke();
    ctx.strokeStyle = "rgb(8,6,5)";
    ctx.lineCap = "round";
    ctx.lineWidth = 0.024;
    ctx.beginPath();
    ctx.moveTo(0.07, 0.014 * sign);
    ctx.lineTo(0.07 + 0.095 * (0.3 + 0.7 * pose.bite), (0.014 + 0.055 * pose.bite) * sign);
    ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = rgb(PALP);
  ctx.lineCap = "round";
  ctx.lineWidth = 0.055;
  ctx.beginPath();
  for (const sign of [-1, 1]) {
    const a = (0.3 + 0.18 * pose.palp) * sign;
    const ox = 0.4;
    const oy = 0.075 * sign;
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + 0.13 * Math.cos(a), oy + 0.13 * Math.sin(a));
  }
  ctx.stroke();
}
function drawSpiderShadow(ctx, scale, heading, pose) {
  const g = geometry2();
  const h = pose.height;
  const light = pose.light;
  const fade = Math.max(0, Math.min(1, (1.6 - h) / 0.5));
  const off = h * 0.22 * scale;
  const blur = 1 + h * 0.2;
  const alpha = 0.34 / (1 + h * 1.8) * fade;
  if (alpha < 8e-3) return;
  ctx.save();
  ctx.translate(-light[0] * off, -light[1] * off);
  ctx.rotate(heading);
  ctx.scale(scale * blur, scale * blur);
  if (h > 0.3) {
    ctx.scale(1.25, 0.9);
    const rg = ctx.createRadialGradient(-0.04, 0, 0.04, -0.04, 0, 0.5);
    rg.addColorStop(0, `rgba(13,10,8,${alpha * 0.85})`);
    rg.addColorStop(0.55, `rgba(13,10,8,${alpha * 0.45})`);
    rg.addColorStop(1, "rgba(13,10,8,0)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(-0.04, 0, 0.5, 0, TAU3);
    ctx.fill();
  } else {
    for (const [grow, a] of [[1.14, 0.34], [1, 1]]) {
      ctx.save();
      ctx.scale(grow, grow);
      ctx.fillStyle = `rgba(13,10,8,${alpha * a * 0.6})`;
      ctx.fill(g.silhouette);
      ctx.restore();
    }
  }
  ctx.restore();
}
function drawSpider(ctx, scale, heading, pose, dpr = 1, detailMode = "auto") {
  const g = geometry2();
  ctx.save();
  ctx.rotate(heading);
  const s = scale * (1 + pose.height * 0.16);
  ctx.scale(s, s);
  const devScale = scale * dpr;
  const detail = detailMode === "high" || detailMode === "auto" && devScale >= DETAIL_PX2;
  drawLegs(ctx, g, pose.feet, detail);
  drawBody2(ctx, g, pose, detail, devScale);
  ctx.restore();
}
function clearCaches() {
  hairCache.clear();
}

// src/myxa.js
var DEFAULTS = Object.freeze({
  /** How many flies. */
  flies: 1,
  /** Body length in millimetres; a house fly is about 7. */
  flySizeMm: 7,
  /** Speed multiplier for everything that moves. */
  speed: 1,
  /** Frame-rate cap.  60 matches most displays; 30 halves the cost. */
  fps: 60,
  /** Random seed, for a repeatable fly.  Unset: different every time. */
  seed: void 0,
  /** Stop and remove the overlay after this many seconds.  Unset: never. */
  duration: void 0,
  /** The jumping spider that hunts the fly from the edges. */
  spider: true,
  /** Spider body length in millimetres. */
  spiderSizeMm: 9,
  /** Soft contact shadows under both animals. */
  shadow: true,
  /** Whether the fly is afraid of the pointer. */
  cursor: true,
  /** Scales every distance at which the pointer spooks the fly. */
  shyness: 1,
  /** Relative weights of what a fly on the ground does next. */
  behaviour: DEFAULT_BEHAVIOUR,
  /** Let a walking fly wander part-way off the edge of the page. */
  stray: true,
  /** Let a flying fly now and then leave the page for a moment. */
  excursions: true,
  /** Seconds before a new fly turns up after the spider eats one: [min, max]. */
  respawnDelay: RESPAWN_DELAY,
  /** CSS pixels per millimetre.  96 dpi is the CSS reference. */
  pxPerMm: CSS_PX_PER_MM,
  /** 'auto' picks by on-screen size; 'low' skips fine detail; 'high' forces it. */
  detail: "auto",
  /** Cap on device pixel ratio, to bound the canvas's memory and fill cost. */
  maxDpr: 2,
  /** Stacking order of the overlay canvas. */
  zIndex: 2147483647,
  /** Draw into this canvas instead of creating a full-viewport overlay. */
  canvas: null,
  /** Where to append the created overlay.  Default: document.body. */
  container: null,
  /** Start even when the user prefers reduced motion. */
  ignoreReducedMotion: false
});
function prefersReducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
var Myxa = class _Myxa {
  /** Create and start a toy in one call. */
  static start(options) {
    return new _Myxa(options).start();
  }
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.options.behaviour = { ...DEFAULT_BEHAVIOUR, ...options.behaviour || {} };
    this.running = false;
    this.paused = false;
    this.reducedMotion = false;
    this.flies = [];
    this.spider = null;
    this._raf = 0;
    this._frame = this._frame.bind(this);
  }
  start() {
    if (this.running) return this;
    if (typeof document === "undefined") throw new Error("Myxa needs a browser document");
    if (!this.options.canvas && !this.options.container && !document.body) {
      document.addEventListener("DOMContentLoaded", () => this.start(), { once: true });
      return this;
    }
    if (!this.options.ignoreReducedMotion && prefersReducedMotion()) {
      this.reducedMotion = true;
      return this;
    }
    const o = this.options;
    this.rng = new Random(o.seed);
    this.overlay = new Overlay(o);
    this.world = new World(this.overlay.width, this.overlay.height, o.pxPerMm);
    this.overlay.onresize = (w, h) => this.world.resize(w, h);
    this.pointer = new Pointer();
    this._syncPopulation();
    this.running = true;
    this.paused = false;
    this._started = null;
    this._last = null;
    this._raf = requestAnimationFrame(this._frame);
    return this;
  }
  /** Remove the overlay and every listener. */
  stop() {
    if (!this.running) return this;
    cancelAnimationFrame(this._raf);
    this.overlay.destroy();
    this.pointer.destroy();
    clearCaches();
    this.flies = [];
    this.spider = null;
    this.running = false;
    return this;
  }
  /** Freeze in place; the animals stay drawn. */
  pause() {
    if (this.running && !this.paused) {
      cancelAnimationFrame(this._raf);
      this.paused = true;
    }
    return this;
  }
  resume() {
    if (this.running && this.paused) {
      this.paused = false;
      this._last = null;
      this._raf = requestAnimationFrame(this._frame);
    }
    return this;
  }
  /** Change options while running.  Anything in DEFAULTS except `canvas`,
   * `container`, `zIndex` and `seed` takes effect at once. */
  set(options = {}) {
    const o = this.options;
    Object.assign(o, options);
    if (options.behaviour) o.behaviour = { ...DEFAULT_BEHAVIOUR, ...options.behaviour };
    if (!this.running) return this;
    if (this.overlay && options.maxDpr !== void 0) {
      this.overlay.maxDpr = o.maxDpr;
      this.overlay.resize();
    }
    if (options.pxPerMm !== void 0) this.world.pxPerMm = o.pxPerMm;
    for (const fly of this.flies) this._configureFly(fly);
    this._syncPopulation();
    if (this.spider) this._configureSpider(this.spider);
    if (options.zIndex !== void 0 && this.overlay.owned) this.overlay.canvas.style.zIndex = o.zIndex;
    return this;
  }
  _flyOptions() {
    const o = this.options;
    return {
      sizeMm: o.flySizeMm,
      speed: o.speed,
      shyness: o.shyness,
      cursor: o.cursor,
      stray: o.stray,
      excursions: o.excursions,
      behaviour: o.behaviour
    };
  }
  _configureFly(fly) {
    const f = this._flyOptions();
    fly.sizeMm = f.sizeMm;
    fly.speedScale = f.speed;
    fly.shyness = f.shyness;
    fly.cursorFear = f.cursor;
    fly.stray = f.stray;
    fly.excursions = f.excursions;
    fly.setBehaviour(f.behaviour);
  }
  _configureSpider(spider) {
    const o = this.options;
    spider.sizeMm = o.spiderSizeMm;
    spider.speedScale = o.speed;
    spider.respawnDelay = o.respawnDelay;
  }
  /** Add or remove flies and the spider to match the options. */
  _syncPopulation() {
    const o = this.options;
    const want = Math.max(0, Math.floor(o.flies));
    while (this.flies.length < want) this.flies.push(new Fly(this.world, this.rng, this._flyOptions()));
    if (this.flies.length > want) this.flies.length = want;
    if (o.spider && !this.spider) {
      this.spider = new Spider(this.world, this.flies, this.rng, {
        sizeMm: o.spiderSizeMm,
        speed: o.speed,
        respawnDelay: o.respawnDelay
      });
    } else if (!o.spider && this.spider) {
      if (this.spider.carried) this.spider.carried.release(0);
      this.spider = null;
    }
  }
  _frame(now) {
    this._raf = requestAnimationFrame(this._frame);
    const o = this.options;
    if (this._last === null) {
      this._last = now;
      if (this._started === null) this._started = now;
      return;
    }
    const minGap = o.fps > 0 ? 1e3 / o.fps - 1.5 : 0;
    if (now - this._last < minGap) return;
    const dt = (now - this._last) / 1e3;
    this._last = now;
    if (o.duration && (now - this._started) / 1e3 >= o.duration) {
      this.stop();
      return;
    }
    this.tick(dt);
    this.draw();
  }
  /** Advance the simulation by `dt` seconds. */
  tick(dt) {
    const sp = this.spider;
    const seen = sp && sp.visible ? [sp.x, sp.y] : null;
    const [ox, oy] = this.pointer ? this.overlay.origin() : [0, 0];
    const cursor = this.pointer ? this.pointer.at(ox, oy) : null;
    for (const fly of this.flies) {
      if (fly.hidden) {
        fly.tickHidden(dt);
        continue;
      }
      fly.sensePredator(seen, dt);
      fly.senseCursor(cursor, dt);
      fly.update(dt);
    }
    if (sp) sp.update(dt);
  }
  draw() {
    const ov = this.overlay;
    const ctx = ov.ctx;
    const o = this.options;
    const dpr = ov.dpr;
    ov.begin();
    for (const fly of this.flies) {
      if (fly.hidden || !ov.mark(fly.x, fly.y, fly.extent)) continue;
      ctx.save();
      ctx.translate(fly.x, fly.y);
      if (o.shadow) drawFlyShadow(ctx, fly.length, fly.heading, fly.pose);
      drawFly(ctx, fly.length, fly.heading, fly.pose, dpr, o.detail);
      ctx.restore();
    }
    const sp = this.spider;
    if (sp && ov.mark(sp.x, sp.y, sp.extent)) {
      ctx.save();
      ctx.translate(sp.x, sp.y);
      if (o.shadow) drawSpiderShadow(ctx, sp.length, sp.heading, sp.pose);
      const carry = sp.carryTransform();
      if (carry) {
        ctx.save();
        ctx.translate(carry[0] - sp.x, carry[1] - sp.y);
        drawFly(ctx, sp.carried.length, carry[2], sp.carriedPose, dpr, o.detail);
        ctx.restore();
      }
      drawSpider(ctx, sp.length, sp.heading, sp.pose, dpr, o.detail);
      ctx.restore();
    }
  }
};
export {
  DEFAULTS,
  DEFAULT_BEHAVIOUR,
  Fly,
  Myxa,
  Random,
  Spider,
  World,
  Myxa as default,
  drawFly,
  drawFlyShadow,
  drawSpider,
  drawSpiderShadow
};

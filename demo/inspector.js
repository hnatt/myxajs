// The demo's inspection box: a small arena of its own, with its own fly and
// spider, seen through a camera that rides on one of them.  The animal stays
// put in the middle of the box and the ground moves under it.
//
// Two ways to hold the camera, named as on a chart plotter:
//   north up    the ground keeps its orientation and the animal turns;
//   heading up  the animal always faces the top of the box and the ground
//               turns under it.

import { World, Fly, Spider, Random, DEFAULT_BEHAVIOUR, drawFly, drawFlyShadow, drawSpider, drawSpiderShadow } from '../src/index.js';

const ARENA_W = 640; // CSS px: a small page, so the two meet often
const ARENA_H = 400;
const TRAIL_S = 3; // seconds of path drawn behind the subject

/** What a grounded fly is told to keep doing, as behaviour weights. */
const ONLY = (key) => Object.fromEntries(Object.keys(DEFAULT_BEHAVIOUR).map((k) => [k, k === key ? 1 : 0]));
const FLY_BEHAVIOURS = {
  natural: { weights: DEFAULT_BEHAVIOUR },
  walk: { weights: ONLY('walk'), state: 'walk' },
  idle: { weights: ONLY('idle'), state: 'idle' },
  groomFront: { weights: ONLY('groomFront'), state: 'groom_front' },
  groomHind: { weights: ONLY('groomHind'), state: 'groom_hind' },
  groomWing: { weights: ONLY('groomWing'), state: 'groom_wing' },
  // Mostly in the air, but it has to land somewhere between flights.
  fly: { weights: { ...ONLY('takeOff'), idle: 0.15 }, state: 'launch' },
};

const FLY_STATE = {
  walk: 'walking',
  idle: 'resting',
  groom_front: 'grooming the front legs and head',
  groom_hind: 'grooming the abdomen',
  groom_wing: 'grooming the wings',
  launch: 'taking off',
  flight: 'flying',
  landing: 'landing',
};
const SIDE = { '-1': 'left', 1: 'right', 0: 'both' };
const GROOM_ACT = {
  rubFront: () => 'rubbing the front feet together',
  sweepHead: () => 'sweeping the front legs over the head',
  sweepAbdomen: () => 'sweeping the hind legs down the abdomen',
  rubHind: () => 'rubbing the hind feet together',
  sweepWing: (side) => (side ? `stroking the ${SIDE[side]} wing` : 'stroking both wings'),
};
const SPIDER_STATE = {
  lurk: 'lurking',
  patrol: 'patrolling the edge',
  stalk: 'stalking',
  pounce: 'leaping',
  retreat: 'going back to the edge',
  hide: 'hiding over the edge',
  seize: 'biting its catch',
  haul: 'hauling its catch backwards to cover',
  feed: 'feeding, out of sight of the page',
};

export class Inspector {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} status  where the running commentary goes
   */
  constructor(canvas, status) {
    this.canvas = canvas;
    this.status = status;
    this.ctx = canvas.getContext('2d');
    this.subject = 'fly'; // or 'spider'
    this.rotation = 'north'; // or 'heading'
    this.zoom = 4;
    this.timeScale = 1;
    this.paused = false;

    this.rng = new Random();
    this.world = new World(ARENA_W, ARENA_H);
    this.flies = [new Fly(this.world, this.rng, { cursor: false })];
    this.spider = null;
    this.setSpider(true);

    this._trail = [];
    this._cam = null; // [x, y, rotation] while gliding to a new subject
    this._speed = 0;
    this._last = null;
    this._visible = true;
    this._frame = this._frame.bind(this);

    new ResizeObserver(() => this._resize()).observe(canvas);
    this._resize();
    // Only run while it is on screen: there is a toy on the page already.
    new IntersectionObserver((entries) => {
      this._visible = entries[0].isIntersecting;
      if (this._visible) this._kick();
    }).observe(canvas);
    this._kick();
  }

  get fly() {
    return this.flies[0];
  }

  setSpider(on) {
    if (on && !this.spider) {
      this.spider = new Spider(this.world, this.flies, this.rng, { respawnDelay: [2, 4] });
    } else if (!on && this.spider) {
      if (this.spider.carried) this.spider.carried.release(0.5);
      this.spider = null;
    }
  }

  setSubject(subject) {
    if (subject === this.subject) return;
    if (subject === 'spider') this.setSpider(true);
    this.subject = subject;
    this._trail = [];
    this._glide();
  }

  setRotation(rotation) {
    this.rotation = rotation;
    this._glide();
  }

  /** Tell the fly what to keep doing, and start it now if it is grounded. */
  setFlyBehaviour(key) {
    const b = FLY_BEHAVIOURS[key];
    const fly = this.fly;
    fly.setBehaviour(b.weights);
    // Landing picks its own next move; the box puts it back on this one.
    this._wantState = b.state && b.state !== 'launch' ? b.state : null;
    const grounded = !fly.hidden && !['launch', 'flight', 'landing'].includes(fly.state);
    if (b.state && grounded) fly._enter(b.state);
  }

  /** Send the spider into one of its states. */
  setSpiderState(state) {
    const sp = this.spider;
    if (!sp || sp.carried) return;
    sp._enter(state);
  }

  /** Put the fly down a few body lengths in front of the spider. */
  dropFly() {
    const sp = this.spider;
    const fly = this.fly;
    if (!sp || sp.carried) return;
    if (fly.hidden) {
      fly.respawn();
    }
    const [, n] = sp._edge();
    const L = sp.length;
    const along = [-n[1], n[0]];
    const side = this.rng.uniform(-3, 3) * L;
    const x = sp.x + n[0] * 5.5 * L + along[0] * side;
    const y = sp.y + n[1] * 5.5 * L + along[1] * side;
    [fly.x, fly.y] = this.world.clamp(x, y, 2 * fly.length);
    fly.height = 0;
    fly.heading = this.rng.uniform(0, Math.PI * 2);
    fly._reseedFeet();
    fly._enter(this.rng.choice(['idle', 'groom_front', 'groom_hind', 'groom_wing']));
    if (this.subject === 'fly') this._glide();
  }

  togglePause() {
    this.paused = !this.paused;
    if (!this.paused) this._last = null;
    this._kick();
    return this.paused;
  }

  /** Draw again without advancing, e.g. after a zoom change while paused. */
  redraw() {
    this._draw();
  }

  /** One frame forward, while paused. */
  step() {
    this._tick(1 / 60);
    this._draw();
  }

  // -- internals --------------------------------------------------------

  _kick() {
    if (!this._raf && this._visible) this._raf = requestAnimationFrame(this._frame);
  }

  _frame(now) {
    this._raf = 0;
    if (!this._visible) return;
    if (!this.paused) {
      const dt = this._last === null ? 0 : Math.min(0.1, (now - this._last) / 1000);
      this._last = now;
      if (dt > 0) this._tick(dt * this.timeScale);
    }
    this._draw();
    if (!this.paused) this._kick();
  }

  _tick(dt) {
    const sp = this.spider;
    const seen = sp && sp.visible ? [sp.x, sp.y] : null;
    const before = this._focus();
    for (const fly of this.flies) {
      if (fly.hidden) {
        fly.tickHidden(dt);
        if (!fly.hidden && this.subject === 'fly') this._glide();
        continue;
      }
      fly.sensePredator(seen, dt);
      fly.senseCursor(null, dt);
      const was = fly.state;
      fly.update(dt);
      if (was === 'landing' && fly.state !== 'landing' && this._wantState && fly === this.fly) {
        fly._enter(this._wantState);
      }
    }
    if (sp) sp.update(dt);

    const after = this._focus();
    if (before && after && dt > 0) {
      const v = Math.hypot(after[0] - before[0], after[1] - before[1]) / dt / this.world.pxPerMm;
      this._speed += (v - this._speed) * Math.min(1, dt * 6);
    }
    this._trailT = (this._trailT ?? 0) + dt;
    if (after) {
      this._trail.push([after[0], after[1], this._trailT]);
      while (this._trail.length && this._trailT - this._trail[0][2] > TRAIL_S) this._trail.shift();
    }
  }

  /** Where the camera should be: [x, y, heading], or null. */
  _focus() {
    if (this.subject === 'spider') {
      const sp = this.spider;
      return sp ? [sp.x, sp.y, sp.heading] : null;
    }
    const fly = this.fly;
    if (!fly.hidden) return [fly.x, fly.y, fly.heading];
    // In the spider's grip: ride along with it.
    const carry = this.spider && this.spider.carried === fly ? this.spider.carryTransform() : null;
    return carry ? [carry[0], carry[1], carry[2]] : null;
  }

  /** Ease the camera over to wherever it should now be, instead of cutting. */
  _glide() {
    this._gliding = true;
  }

  _resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, Math.round(r.width));
    this.h = Math.max(1, Math.round(r.height));
    this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    if (this.paused) this._draw();
  }

  _camera() {
    const f = this._focus();
    if (!this._cam) this._cam = f ? [...f] : [ARENA_W / 2, ARENA_H / 2, 0];
    const c = this._cam;
    if (f) {
      const want = [f[0], f[1], this.rotation === 'heading' ? f[2] + Math.PI / 2 : 0];
      if (this._gliding) {
        const k = 0.15;
        const dr = Math.atan2(Math.sin(want[2] - c[2]), Math.cos(want[2] - c[2]));
        c[0] += (want[0] - c[0]) * k;
        c[1] += (want[1] - c[1]) * k;
        c[2] += dr * k;
        if (Math.hypot(want[0] - c[0], want[1] - c[1]) < 0.5 && Math.abs(dr) < 0.01) this._gliding = false;
      } else {
        c[0] = want[0];
        c[1] = want[1];
        c[2] = want[2];
      }
    }
    return c;
  }

  _draw() {
    const { ctx, w, h, dpr, zoom } = this;
    const [cx, cy, rot] = this._camera();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#d6ccb9';
    ctx.fillRect(0, 0, w, h);

    // The ground, under the full camera transform.
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(zoom, zoom);
    ctx.rotate(-rot);
    ctx.translate(-cx, -cy);
    this._drawGround(ctx, cx, cy);
    this._drawTrail(ctx);
    ctx.restore();

    // The animals are drawn at their zoomed size rather than scaled up, so
    // they stay sharp and the spider's cached fur is made at the right size.
    const place = (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      const c = Math.cos(-rot);
      const s = Math.sin(-rot);
      return [w / 2 + (dx * c - dy * s) * zoom, h / 2 + (dx * s + dy * c) * zoom];
    };
    for (const fly of this.flies) {
      if (fly.hidden) continue;
      const [x, y] = place(fly.x, fly.y);
      ctx.save();
      ctx.translate(x, y);
      drawFlyShadow(ctx, fly.length * zoom, fly.heading - rot, fly.pose);
      drawFly(ctx, fly.length * zoom, fly.heading - rot, fly.pose, dpr);
      ctx.restore();
    }
    const sp = this.spider;
    if (sp) {
      const [x, y] = place(sp.x, sp.y);
      ctx.save();
      ctx.translate(x, y);
      drawSpiderShadow(ctx, sp.length * zoom, sp.heading - rot, sp.pose);
      const carry = sp.carryTransform();
      if (carry) {
        const [fx, fy] = place(carry[0], carry[1]);
        ctx.save();
        ctx.translate(fx - x, fy - y);
        drawFly(ctx, sp.carried.length * zoom, carry[2] - rot, sp.carriedPose, dpr);
        ctx.restore();
      }
      drawSpider(ctx, sp.length * zoom, sp.heading - rot, sp.pose, dpr);
      ctx.restore();
    }

    this._drawScaleBar(ctx);
    this._report();
  }

  /** Graph paper on the page, a darker margin beyond its edge. */
  _drawGround(ctx, cx, cy) {
    const mm = this.world.pxPerMm;
    const reach = Math.hypot(this.w, this.h) / 2 / this.zoom + 10;
    const x0 = cx - reach;
    const x1 = cx + reach;
    const y0 = cy - reach;
    const y1 = cy + reach;
    ctx.fillStyle = '#fbf8f1';
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);

    const lines = (step, colour, width) => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width / this.zoom;
      ctx.beginPath();
      for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
      }
      for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
      }
      ctx.stroke();
    };
    if (this.zoom * mm >= 6) lines(mm, 'rgba(120,140,170,0.16)', 1);
    lines(mm * 10, 'rgba(120,140,170,0.38)', 1);

    // The edge of the page: the spider's border, and its cover beyond.
    ctx.strokeStyle = 'rgba(90,70,50,0.55)';
    ctx.lineWidth = 2 / this.zoom;
    ctx.strokeRect(0, 0, ARENA_W, ARENA_H);
  }

  _drawTrail(ctx) {
    const t = this._trail;
    if (t.length < 2) return;
    const now = t[t.length - 1][2];
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.6 / this.zoom;
    for (let i = 1; i < t.length; i++) {
      const a = 1 - (now - t[i][2]) / TRAIL_S;
      // A jump (a respawn, a switch of subject) is not part of the path.
      if (Math.hypot(t[i][0] - t[i - 1][0], t[i][1] - t[i - 1][1]) > 150) continue;
      ctx.strokeStyle = `rgba(176,96,48,${(0.5 * a).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(t[i - 1][0], t[i - 1][1]);
      ctx.lineTo(t[i][0], t[i][1]);
      ctx.stroke();
    }
  }

  _drawScaleBar(ctx) {
    const mmPx = this.world.pxPerMm * this.zoom;
    const n = mmPx * 5 > 160 ? 1 : mmPx * 10 > 160 ? 5 : 10;
    const len = n * mmPx;
    const x = 14;
    const y = this.h - 16;
    ctx.strokeStyle = 'rgba(43,38,32,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.lineTo(x + len, y - 4);
    ctx.stroke();
    ctx.fillStyle = 'rgba(43,38,32,0.85)';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`${n} mm`, x + len + 6, y + 1);
    if (this.rotation === 'north') {
      // A north arrow, since that is what "north up" holds still.
      const ax = this.w - 22;
      ctx.beginPath();
      ctx.moveTo(ax, 12);
      ctx.lineTo(ax - 5, 26);
      ctx.lineTo(ax + 5, 26);
      ctx.closePath();
      ctx.fill();
      ctx.fillText('N', ax - 4, 40);
    }
  }

  _report() {
    let text;
    if (this.subject === 'spider') {
      const sp = this.spider;
      text = sp ? `Spider: ${SPIDER_STATE[sp.state] ?? sp.state}` : 'No spider';
    } else {
      const fly = this.fly;
      if (fly.hidden) {
        const held = this.spider && this.spider.carried === fly;
        text = held ? 'Fly: caught' : 'Fly: eaten. Another one is on its way.';
      } else {
        text = `Fly: ${FLY_STATE[fly.state] ?? fly.state}`;
        if (fly.groomAct) text += `, ${GROOM_ACT[fly.groomAct](fly.groomSide)}`;
      }
    }
    text += ` · ${this._speed.toFixed(0)} mm/s`;
    if (text !== this._lastText) {
      this.status.textContent = text;
      this._lastText = text;
    }
  }
}

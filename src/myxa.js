// Options, the animation loop and the public API.

import { Random } from './random.js';
import { World, CSS_PX_PER_MM } from './world.js';
import { Fly, DEFAULT_BEHAVIOUR } from './fly.js';
import { Spider, RESPAWN_DELAY } from './spider.js';
import { Overlay } from './overlay.js';
import { Pointer } from './pointer.js';
import { drawFly, drawFlyShadow } from './fly-render.js';
import { drawSpider, drawSpiderShadow, clearCaches } from './spider-render.js';

export const DEFAULTS = Object.freeze({
  /** How many flies. */
  flies: 1,
  /** Body length in millimetres; a house fly is about 7. */
  flySizeMm: 7.0,
  /** Speed multiplier for everything that moves. */
  speed: 1.0,
  /** Frame-rate cap.  60 matches most displays; 30 halves the cost. */
  fps: 60,
  /** Random seed, for a repeatable fly.  Unset: different every time. */
  seed: undefined,
  /** Stop and remove the overlay after this many seconds.  Unset: never. */
  duration: undefined,
  /** The jumping spider that hunts the fly from the edges. */
  spider: true,
  /** Spider body length in millimetres. */
  spiderSizeMm: 9.0,
  /** Soft contact shadows under both animals. */
  shadow: true,
  /** Whether the fly is afraid of the pointer. */
  cursor: true,
  /** Scales every distance at which the pointer spooks the fly. */
  shyness: 1.0,
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
  detail: 'auto',
  /** Cap on device pixel ratio, to bound the canvas's memory and fill cost. */
  maxDpr: 2,
  /** Stacking order of the overlay canvas. */
  zIndex: 2147483647,
  /** Draw into this canvas instead of creating a full-viewport overlay. */
  canvas: null,
  /** Where to append the created overlay.  Default: document.body. */
  container: null,
  /** Start even when the user prefers reduced motion. */
  ignoreReducedMotion: false,
});

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class Myxa {
  /** Create and start a toy in one call. */
  static start(options) {
    return new Myxa(options).start();
  }

  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.options.behaviour = { ...DEFAULT_BEHAVIOUR, ...(options.behaviour || {}) };
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
    if (typeof document === 'undefined') throw new Error('Myxa needs a browser document');
    if (!this.options.canvas && !this.options.container && !document.body) {
      document.addEventListener('DOMContentLoaded', () => this.start(), { once: true });
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
    if (this.overlay && options.maxDpr !== undefined) {
      this.overlay.maxDpr = o.maxDpr;
      this.overlay.resize();
    }
    if (options.pxPerMm !== undefined) this.world.pxPerMm = o.pxPerMm;
    for (const fly of this.flies) this._configureFly(fly);
    this._syncPopulation();
    if (this.spider) this._configureSpider(this.spider);
    if (options.zIndex !== undefined && this.overlay.owned) this.overlay.canvas.style.zIndex = o.zIndex;
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
      behaviour: o.behaviour,
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
    // Shrink in place: the spider holds this very array as its prey list.
    if (this.flies.length > want) this.flies.length = want;
    if (o.spider && !this.spider) {
      this.spider = new Spider(this.world, this.flies, this.rng, {
        sizeMm: o.spiderSizeMm,
        speed: o.speed,
        respawnDelay: o.respawnDelay,
      });
    } else if (!o.spider && this.spider) {
      // Anything it was holding is let go, and comes back on the wing.
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
    // Frame-rate cap, with a little slack so a 60 Hz display is not halved by
    // jitter in the timestamps.
    const minGap = o.fps > 0 ? 1000 / o.fps - 1.5 : 0;
    if (now - this._last < minGap) return;
    const dt = (now - this._last) / 1000;
    this._last = now;
    if (o.duration && (now - this._started) / 1000 >= o.duration) {
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
        // In the spider's grip, or eaten: the spider draws it while it holds
        // it, and afterwards it just runs down its return clock.
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
      // A carried fly is drawn before the spider, so the chelicerae close
      // over it.
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
}

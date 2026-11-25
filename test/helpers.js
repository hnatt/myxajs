import { Fly } from '../src/fly.js';
import { Spider } from '../src/spider.js';
import { World } from '../src/world.js';
import { Random } from '../src/random.js';
import { wrap } from '../src/util.js';

export { wrap };
export const DT = 1 / 60;

/** A typical laptop viewport, in CSS px. */
export function world() {
  return new World(1440, 900);
}

export function fly(seed, opts = {}, w = world()) {
  return new Fly(w, new Random(seed), opts);
}

/** Step a fly and a spider together the way the main loop does. */
export function step(f, s, dt = DT) {
  if (f.hidden) f.tickHidden(dt);
  else {
    f.sensePredator(s.visible ? [s.x, s.y] : null, dt);
    f.update(dt);
  }
  s.update(dt);
}

export function pair(seed, w = world()) {
  const f = new Fly(w, new Random(seed));
  const s = new Spider(w, [f], new Random(seed + 10));
  return [f, s, w];
}

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

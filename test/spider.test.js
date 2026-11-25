import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Spider, TRACK_RATE_FOR_TESTS, RESPAWN_DELAY } from '../src/spider.js';
import { LEGS as SPIDER_LEGS } from '../src/spider-geometry.js';
import { LEGS as FLY_LEGS } from '../src/fly-geometry.js';
import { Random } from '../src/random.js';
import { DT, pair, step, world, wrap, median } from './helpers.js';

function hunt(seeds = [2, 5, 7, 11], minutes = 6) {
  const stats = { pounces: 0, catches: 0, states: new Set(), strays: 0, worst: 0, reach: 0 };
  for (const seed of seeds) {
    const [f, s] = pair(seed);
    let prev = s.state;
    for (let i = 0; i < 60 * 60 * minutes; i++) {
      step(f, s);
      stats.states.add(s.state);
      // Only a leap, and the walk home from one, may leave the border.
      if (!['pounce', 'retreat', 'seize', 'haul', 'feed'].includes(s.state)) {
        const r = s._edge()[0] / s.length;
        stats.worst = Math.max(stats.worst, r);
        if (r > 2.4) stats.strays++;
      }
      s.pose.feet.forEach((foot, j) => {
        const [coxa, , fe, ti, ta] = SPIDER_LEGS[j];
        stats.reach = Math.max(stats.reach, Math.hypot(foot[0] - coxa[0], foot[1] - coxa[1]) / (fe + ti + ta));
      });
      if (prev !== 'pounce' && s.state === 'pounce') stats.pounces++;
      if (prev === 'pounce' && s.state === 'seize') stats.catches++;
      prev = s.state;
    }
  }
  return stats;
}

const HUNT = hunt();

test('the spider keeps to the edges', () => {
  assert.equal(HUNT.strays, 0, `worst ${HUNT.worst.toFixed(2)} body lengths in`);
});

test('the spider actually hunts', () => {
  assert.ok(HUNT.pounces >= 4, `only ${HUNT.pounces} pounces`);
  for (const s of ['lurk', 'patrol', 'stalk', 'pounce']) assert.ok(HUNT.states.has(s), `never entered ${s}`);
});

test('the fly usually gets away', () => {
  const rate = HUNT.catches / Math.max(1, HUNT.pounces);
  assert.ok(rate < 0.45, `caught the fly ${(100 * rate).toFixed(0)}% of the time`);
});

test('spider legs never exceed their reach', () => {
  assert.ok(HUNT.reach <= 1, `foot reached ${HUNT.reach.toFixed(2)}`);
});

test('turning in place still steps', () => {
  const s = new Spider(world(), [], new Random(3));
  s.heading = 0;
  s._reseedFeet();
  const start = s.gaitPhase;
  let worst = 0;
  for (let i = 0; i < 180; i++) {
    s.heading += 2 / 60;
    s._stepGait(0);
    s.pose.feet.forEach((foot, j) => {
      const rest = s._rest(j);
      worst = Math.max(worst, Math.hypot(foot[0] - rest[0], foot[1] - rest[1]));
    });
  }
  assert.notEqual(s.gaitPhase, start, 'legs never stepped while turning');
  assert.ok(worst <= 0.56, `a foot was dragged ${worst.toFixed(2)} from rest`);
});

test('planted feet never drag far', () => {
  let worst = 0;
  for (const seed of [2, 5]) {
    const [f, s] = pair(seed);
    for (let i = 0; i < 60 * 60 * 4; i++) {
      step(f, s);
      const devs = s.pose.feet
        .map((foot, j) => Math.hypot(foot[0] - s._rest(j)[0], foot[1] - s._rest(j)[1]))
        .sort((a, b) => a - b);
      worst = Math.max(worst, devs[devs.length - 2]); // ignore the one waving leg
    }
  }
  assert.ok(worst <= 0.6, `a foot was dragged ${worst.toFixed(2)} from rest`);
});

test('tracking a flying fly is rate-limited and wobbles', () => {
  const [f, s] = pair(5);
  let fastest = 0;
  const errors = [];
  for (let i = 0; i < 60 * 60 * 5; i++) {
    if (!f.hidden) {
      f.sensePredator(s.visible ? [s.x, s.y] : null, DT);
      f.update(DT);
    } else f.tickHidden(DT);
    const was = s.state;
    const before = s.heading;
    s.update(DT);
    if (was === 'stalk' && s.state === 'stalk' && f.state === 'flight' && !f.hidden) {
      fastest = Math.max(fastest, Math.abs(wrap(s.heading - before)) * 60);
      errors.push(Math.abs(wrap(s.heading - Math.atan2(f.y - s.y, f.x - s.x))));
    }
  }
  assert.ok(errors.length, 'never tracked a flying fly');
  assert.ok(fastest <= TRACK_RATE_FOR_TESTS * 1.05, `turned at ${fastest.toFixed(2)} rad/s`);
  assert.ok(median(errors) < 0.6, 'lost the fly');
  assert.ok(Math.max(...errors) > 0.01, 'aim is suspiciously perfect');
});

test('the spider never jumps while it can be seen', () => {
  let worst = 0;
  for (const seed of [2, 7]) {
    const [f, s] = pair(seed);
    let px = s.x, py = s.y, wasVisible = s.visible;
    for (let i = 0; i < 60 * 60 * 5; i++) {
      if (!f.hidden) {
        f.sensePredator(s.visible ? [s.x, s.y] : null, DT);
        f.update(DT);
      } else f.tickHidden(DT);
      const state = s.state;
      s.update(DT);
      if (state !== 'pounce' && wasVisible) worst = Math.max(worst, Math.hypot(s.x - px, s.y - py) / s.length);
      px = s.x;
      py = s.y;
      wasVisible = s.visible;
    }
  }
  assert.ok(worst < 1, `visibly jumped ${worst.toFixed(1)} body lengths in one frame`);
});

function captureRun(seeds = [2, 5, 7, 11], minutes = 10) {
  const out = { order: [], hauls: [], struggleEnd: [], reach: 0, carried: 0, haulEnds: [], delays: [] };
  for (const seed of seeds) {
    const [f, s] = pair(seed);
    let prev = s.state, px = s.x, py = s.y;
    for (let i = 0; i < 60 * 60 * minutes; i++) {
      step(f, s);
      if (s.state !== prev) {
        if (['pounce', 'seize', 'haul', 'feed'].includes(prev)) out.order.push([prev, s.state]);
        if (prev === 'seize') out.struggleEnd.push(s._struggle);
        if (prev === 'haul') out.haulEnds.push(s._edge()[0] / s.length);
        if (prev === 'feed' && f.respawnIn) out.delays.push(f.respawnIn);
      }
      if (s.state === 'haul') {
        const dx = s.x - px, dy = s.y - py;
        const d = Math.hypot(dx, dy);
        if (d > 0.3) out.hauls.push((dx * Math.cos(s.heading) + dy * Math.sin(s.heading)) / d);
      }
      if (s.carried) {
        out.carried++;
        s.carriedPose.feet.forEach((foot, j) => {
          const [coxa, , fe, ti, ta] = FLY_LEGS[j];
          out.reach = Math.max(out.reach, Math.hypot(foot[0] - coxa[0], foot[1] - coxa[1]) / (fe + ti + ta));
        });
      }
      prev = s.state;
      px = s.x;
      py = s.y;
    }
  }
  return out;
}

const CAPTURE = captureRun();

test('a capture runs seize, haul, then feed', () => {
  const steps = Object.fromEntries(CAPTURE.order);
  assert.ok(CAPTURE.order.some(([a, b]) => a === 'pounce' && b === 'seize'), 'a catch never led to a seizure');
  assert.equal(steps.seize, 'haul');
  assert.equal(steps.haul, 'feed');
  assert.equal(steps.feed, 'lurk');
  assert.ok(CAPTURE.carried > 300, 'the fly was barely carried at all');
});

test('hauling walks backwards', () => {
  assert.ok(CAPTURE.hauls.length, 'never hauled anything');
  assert.equal(CAPTURE.hauls.filter((p) => p > 0).length, 0, 'walked forwards while hauling');
  assert.ok(median(CAPTURE.hauls) < -0.9, 'hauled sideways rather than backwards');
});

test('the struggle subsides', () => {
  assert.ok(CAPTURE.struggleEnd.length, 'nothing was ever seized');
  assert.ok(Math.max(...CAPTURE.struggleEnd) < 0.05);
});

test('carried fly legs stay in reach', () => {
  assert.ok(CAPTURE.reach <= 1, `a curled leg reached ${CAPTURE.reach.toFixed(2)}`);
});

test('prey is dragged right out of sight', () => {
  assert.ok(CAPTURE.haulEnds.length, 'never finished a haul');
  assert.ok(Math.max(...CAPTURE.haulEnds) < -0.55, 'stopped hauling while still visible');
});

test('the next fly takes its time', () => {
  assert.ok(CAPTURE.delays.length, 'no fly was ever released');
  for (const d of CAPTURE.delays) assert.ok(d >= RESPAWN_DELAY[0] - 0.1 && d <= RESPAWN_DELAY[1] + 0.1, `delay of ${d}`);
});

test('respawnDelay is configurable', () => {
  const w = world();
  const s = new Spider(w, [], new Random(1), { respawnDelay: [1, 2] });
  const released = [];
  s.carried = { release: (d) => released.push(d) };
  s._consume();
  assert.ok(released[0] >= 1 && released[0] <= 2);
});

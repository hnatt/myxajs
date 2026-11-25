import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LEGS } from '../src/fly-geometry.js';
import { LEGS as SPIDER_LEGS } from '../src/spider-geometry.js';
import { ik, buildWing } from '../src/fly-render.js';
import { DT, fly, world, wrap } from './helpers.js';

/** Rest knee position and interior angle for each leg, as drawn. */
function knees(legs) {
  return legs.map(([coxa, foot, fem, tib, tar, sign]) => {
    const ax = foot[0] - coxa[0];
    const ay = foot[1] - coxa[1];
    const d = Math.hypot(ax, ay);
    const ankle = [foot[0] - (ax / d) * tar, foot[1] - (ay / d) * tar];
    const knee = ik(coxa, ankle, fem, tib, sign);
    const v1 = [coxa[0] - knee[0], coxa[1] - knee[1]];
    const v2 = [ankle[0] - knee[0], ankle[1] - knee[1]];
    const ang = (Math.acos((v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2))) * 180) / Math.PI;
    return [coxa, knee, ang];
  });
}

test('legs never exceed their reach', () => {
  // If a foot outruns femur+tibia the IK saturates and the limb detaches.
  const f = fly(4);
  let worst = 0;
  for (let i = 0; i < 60 * 120; i++) {
    const pose = f.update(DT);
    pose.feet.forEach((foot, j) => {
      const [coxa, , fem, tib, tar] = LEGS[j];
      worst = Math.max(worst, Math.hypot(foot[0] - coxa[0], foot[1] - coxa[1]) / (fem + tib + tar));
    });
  }
  assert.ok(worst <= 1, `foot reached ${worst.toFixed(2)} of full leg length`);
});

test('rest knee angle looks like a leg', () => {
  // ~90 degrees reads as scaffolding; a real fly's knee is much more open.
  knees(LEGS).forEach(([, , ang], i) => assert.ok(ang > 105 && ang < 145, `leg ${i} knee at ${ang.toFixed(0)} deg`));
});

test('every knee bends away from the body', () => {
  for (const [name, legs] of [['fly', LEGS], ['spider', SPIDER_LEGS]]) {
    knees(legs).forEach(([coxa, knee], i) => {
      const lat = coxa[1] > 0 ? 1 : -1;
      assert.ok(knee[1] * lat > coxa[1] * lat, `${name} leg ${i}: knee inboard of its coxa`);
    });
  }
});

test('neighbouring spider legs do not cross', () => {
  const k = knees(SPIDER_LEGS);
  for (const side of [0, 1]) {
    const xs = [side, side + 2, side + 4, side + 6].map((i) => k[i][1][0]);
    assert.deepEqual(xs, [...xs].sort((a, b) => b - a), `knee order along one side: ${xs}`);
  }
});

test('every behaviour is reachable', () => {
  const f = fly(7);
  const seen = new Set();
  for (let i = 0; i < 60 * 60 * 6; i++) {
    f.update(DT);
    seen.add(f.state);
  }
  for (const s of ['walk', 'idle', 'groom_front', 'groom_hind', 'groom_wing', 'launch', 'flight', 'landing']) {
    assert.ok(seen.has(s), `never entered ${s}`);
  }
});

test('take-off is immediate, with the wings already beating', () => {
  // A slow ramp through low blur values renders as two static blades held
  // out sideways -- a beetle opening its wing cases.
  const durations = [];
  const blurs = [];
  for (let seed = 0; seed < 4; seed++) {
    const f = fly(seed);
    let start = null;
    for (let i = 0; i < 60 * 60 * 4; i++) {
      const was = f.state;
      f.update(DT);
      if (f.state === 'launch') {
        if (was !== 'launch') start = i;
        blurs.push(f.pose.wingBlur);
      } else if (was === 'launch' && start !== null) {
        durations.push((i - start) / 60);
        start = null;
      }
    }
  }
  assert.ok(durations.length > 10, 'not enough take-offs sampled');
  assert.ok(Math.max(...durations) < 0.12, `take-off took ${Math.max(...durations)} s`);
  assert.ok(Math.min(...blurs) > 0.9, `wings at ${Math.min(...blurs)} during take-off`);
});

test('wing tip is blunt, not pointed', () => {
  const pts = buildWing();
  const n = pts.length / 2;
  const lead = pts.slice(0, n);
  const trail = pts.slice(n).reverse();
  const width = lead.map((p, i) => trail[i][1] - p[1]);
  const widest = Math.max(...width);
  assert.ok(width[Math.floor(0.95 * (n - 1))] / widest > 0.45, 'wing tapers to a point');
  assert.ok(width[Math.floor(0.1 * (n - 1))] / widest < 0.75, 'wing root should be narrow');
});

function flightStats(seeds = [0, 1, 2, 3]) {
  let drift = 0, backwards = 0, off = 0, frames = 0, slow = 0;
  for (const seed of seeds) {
    const f = fly(seed);
    let px = f.x, py = f.y;
    for (let i = 0; i < 60 * 60 * 4; i++) {
      f.update(DT);
      if (f.state === 'flight' || f.state === 'landing') {
        const dx = f.x - px, dy = f.y - py;
        const speed = Math.hypot(dx, dy) * 60;
        if (speed > 1) {
          const d = Math.abs((wrap(Math.atan2(dy, dx) - f.heading) * 180) / Math.PI);
          drift = Math.max(drift, d);
          if (d > 90) backwards++;
          frames++;
        }
        if (speed / f.pxPerMm < 30) slow++;
        if (f.state === 'flight' && !f.world.contains(f.x, f.y)) off++;
      }
      px = f.x;
      py = f.y;
    }
  }
  return { drift, backwards, off, frames, slow };
}

test('flight is always nose-first', () => {
  const s = flightStats();
  assert.ok(s.frames > 1000, 'not enough flight sampled');
  assert.equal(s.backwards, 0);
  assert.ok(s.drift < 1, `body pointed ${s.drift.toFixed(1)} deg away from travel`);
});

test('flight does not hover', () => {
  const s = flightStats();
  assert.ok(s.slow / s.frames < 0.02, `${((100 * s.slow) / s.frames).toFixed(1)}% near-stationary`);
});

test('flight mostly stays over the page', () => {
  const s = flightStats();
  assert.ok(s.off / s.frames < 0.25, `${((100 * s.off) / s.frames).toFixed(1)}% of flight off the page`);
});

test('flight is saccadic, like a house fly', () => {
  // About ten body saccades a second, tens of ms of translation between them,
  // and the heading still drifting in between.
  let saccades = 0, flying = 0;
  const gaps = [];
  const per100 = [];
  for (const seed of [1, 2, 3]) {
    const f = fly(seed);
    let turning = 0, last = 0, heading = f.heading, swept = 0, n = 0, clock = 0;
    for (let i = 0; i < 60 * 60 * 5; i++) {
      f.update(DT);
      if (f.state !== 'flight') {
        heading = f.heading;
        continue;
      }
      flying += DT;
      clock += DT;
      if (f._turnLeft && !turning) {
        saccades++;
        if (last) gaps.push(clock - last);
        last = clock;
      }
      turning = f._turnLeft;
      swept += Math.abs(wrap(f.heading - heading));
      heading = f.heading;
      if (++n % 6 === 0) {
        per100.push((swept * 180) / Math.PI);
        swept = 0;
      }
    }
  }
  const rate = saccades / flying;
  assert.ok(rate > 6 && rate < 15, `${rate.toFixed(1)} saccades a second`);
  const gap = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  assert.ok(gap < 0.17, `${(gap * 1000).toFixed(0)} ms between saccades`);
  const drift = [...per100].sort((a, b) => a - b)[Math.floor(per100.length / 2)];
  assert.ok(drift > 15 && drift < 90, `heading moves ${drift.toFixed(0)} deg per 100 ms`);
});

test('landing does not orbit the spot', () => {
  const landings = [];
  for (let seed = 0; seed < 6; seed++) {
    const f = fly(seed);
    let prev = f.heading, start = null, swing = 0;
    for (let i = 0; i < 60 * 60 * 5; i++) {
      const was = f.state;
      f.update(DT);
      if (f.state === 'landing') {
        if (was !== 'landing') {
          start = i;
          swing = 0;
        }
        if (Math.hypot(f._target[0] - f.x, f._target[1] - f.y) < 3 * f.length) {
          swing += Math.abs((wrap(f.heading - prev) * 180) / Math.PI);
        }
      } else if (was === 'landing' && start !== null) {
        landings.push([(i - start) / 60, swing]);
        start = null;
      }
      prev = f.heading;
    }
  }
  assert.ok(landings.length > 10, 'not enough landings sampled');
  assert.ok(Math.max(...landings.map((l) => l[0])) < 2.5, 'a landing took too long');
  assert.ok(Math.max(...landings.map((l) => l[1])) < 200, 'body swung round onto the spot');
});

test('a new fly arrives on the wing', () => {
  for (let seed = 0; seed < 6; seed++) {
    const f = fly(seed);
    assert.equal(f.state, 'flight');
    assert.ok(!f.world.contains(f.x, f.y), 'started already over the page');
    assert.ok(f.height > 0.5, 'started on the ground');
  }
});

test('a walking fly may stray over the edge, but not far', () => {
  const w = world();
  w.resize(500, 900); // a narrow, portrait-ish page
  const f = fly(11, {}, w);
  let worst = 0;
  for (let i = 0; i < 60 * 60 * 3; i++) {
    f.update(DT);
    assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y));
    if (f.height < 0.1) {
      const out = Math.max(-f.x, f.x - w.width, -f.y, f.y - w.height);
      worst = Math.max(worst, out / f.length);
    }
  }
  assert.ok(worst <= 2.85, `walked ${worst.toFixed(1)} body lengths off the page`);
});

test('stray: false keeps a walking fly on the page', () => {
  const w = world();
  w.resize(500, 600);
  const f = fly(11, { stray: false }, w);
  let worst = -Infinity;
  for (let i = 0; i < 60 * 60 * 3; i++) {
    f.update(DT);
    if (f.state === 'walk') worst = Math.max(worst, -f.x, f.x - w.width, -f.y, f.y - w.height);
  }
  // One frame's step may land past the clamp before the next frame's turn.
  assert.ok(worst <= 3, `walked ${worst.toFixed(1)} px off the page`);
});

test('excursions: false keeps flight closer to the page', () => {
  const w = world();
  const offFor = (excursions) => {
    let far = 0;
    for (const seed of [0, 1, 2, 3]) {
      const f = fly(seed, { excursions }, w);
      for (let i = 0; i < 60 * 60 * 4; i++) {
        f.update(DT);
        if (f.state === 'flight' && w.distanceTo(f.x, f.y) > 4 * f.length) far++;
      }
    }
    return far;
  };
  assert.ok(offFor(false) < offFor(true), 'excursions made no difference');
});

test('behaviour weights decide what a grounded fly does', () => {
  const f = fly(3, { behaviour: { walk: 1, groomFront: 0, groomHind: 0, groomWing: 0, idle: 0, takeOff: 0 } });
  const seen = new Set();
  for (let i = 0; i < 60 * 60 * 3; i++) {
    f.update(DT);
    seen.add(f.state);
  }
  for (const s of ['groom_hind', 'groom_wing']) assert.ok(!seen.has(s), `entered ${s} at weight 0`);
  assert.ok(seen.has('walk'));
});

test('speed scales how fast it walks', () => {
  const dist = (speed) => {
    const f = fly(5, { speed, behaviour: { walk: 1, groomFront: 0, groomHind: 0, groomWing: 0, idle: 0, takeOff: 0 } });
    let d = 0;
    for (let i = 0; i < 60 * 60; i++) {
      const [x, y] = [f.x, f.y];
      f.update(DT);
      if (f.state === 'walk') d += Math.hypot(f.x - x, f.y - y);
    }
    return d;
  };
  assert.ok(dist(2) > 1.5 * dist(1));
});

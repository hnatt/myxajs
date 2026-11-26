import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Droppings, bounds } from '../src/droppings.js';
import { DEFAULTS } from '../src/myxa.js';
import { Random } from '../src/random.js';
import { DT, fly } from './helpers.js';

const L = 26; // a 7 mm fly, in CSS px
const R = 8.3; // the wiping fingertip, in CSS px

function one(seed = 1) {
  const d = new Droppings(new Random(seed));
  const speck = d.add(100, 100, L);
  d.changed = [];
  return [d, speck];
}

test('droppings are on by default and leave a fly every minute or so', () => {
  assert.equal(DEFAULTS.droppings, true);
  assert.deepEqual(DEFAULTS.droppingInterval, [20, 90]);
  assert.equal(DEFAULTS.maxDroppings, 200);
});

test('a speck is the size of a real one', () => {
  const d = new Droppings(new Random(3));
  for (let i = 0; i < 200; i++) {
    const s = d.add(0, 0, L);
    // 0.5-1 mm specks, 1-2 mm pale spots, on a fly 7 mm long.
    const mm = (2 * s.r) / (L / 7);
    assert.ok(s.pale ? mm > 0.9 && mm < 1.9 : mm > 0.45 && mm < 1.0, `${mm.toFixed(2)} mm`);
  }
});

test('a resting pointer does not wipe', () => {
  const [d, s] = one();
  assert.equal(d.wipe(100, 100, 100.2, 100, R), false);
  assert.equal(s.mass, 1);
});

test('a rub that misses leaves it alone', () => {
  const [d, s] = one();
  assert.equal(d.wipe(0, 140, 200, 140, R), false);
  assert.equal(s.mass, 1);
  assert.equal(d.changed.length, 0);
});

test('one pass smudges a speck into a streak along the rub', () => {
  const [d, s] = one();
  assert.ok(d.wipe(80, 100, 120, 100, R));
  assert.ok(s.mass < 0.6 && s.mass > 0.2, `mass ${s.mass}`);
  assert.equal(s.smears.length, 1);
  const m = s.smears[0];
  assert.ok(m.x1 > m.x0 + 2 * s.r, 'the smear trails the way the pointer went');
  assert.ok(Math.abs(m.y1 - m.y0) < 2 * s.r);
  assert.equal(d.count, 1, 'one pass does not clean it');
  assert.equal(d.changed.length, 1);
  const b = d.changed[0];
  assert.ok(b[2] >= m.x1, 'the changed box covers the new smear');
});

test('a few strokes back and forth clean it off', () => {
  const [d] = one();
  let strokes = 0;
  while (d.count && strokes < 30) {
    const dir = strokes % 2 ? -1 : 1;
    d.wipe(100 - 20 * dir, 100, 100 + 20 * dir, 100, R);
    strokes++;
  }
  assert.equal(d.count, 0);
  assert.ok(strokes >= 3 && strokes <= 12, `took ${strokes} strokes`);
});

test('a graze smudges less than a pass straight over', () => {
  const [a, sa] = one(5);
  const [b, sb] = one(5);
  a.wipe(80, 100, 120, 100, R);
  b.wipe(80, 100 + R * 0.85, 120, 100 + R * 0.85, R);
  assert.ok(sb.mass > sa.mass);
});

test('past the cap the oldest go', () => {
  const d = new Droppings(new Random(1), 5);
  const first = d.add(0, 0, L);
  for (let i = 1; i < 7; i++) d.add(i * 10, 0, L);
  assert.equal(d.count, 5);
  assert.ok(!d.list.includes(first));
});

test('bounds hold the mark and its smears', () => {
  const [d, s] = one();
  d.wipe(60, 100, 140, 100, R);
  const [x0, y0, x1, y1] = bounds(s);
  for (const m of s.smears) {
    for (const [x, y] of [[m.x0, m.y0], [m.x1, m.y1]]) assert.ok(x > x0 && x < x1 && y > y0 && y < y1);
  }
});

test('a fly leaves droppings behind it while it sits, never in the air', () => {
  const f = fly(2, { droppingInterval: [2, 4], behaviour: { walk: 0.3, idle: 0.3, groomFront: 0.2, takeOff: 0.2 } });
  const drops = [];
  for (let i = 0; i < 60 * 120; i++) {
    f.update(DT);
    const [state, x, y, h] = [f.state, f.x, f.y, f.heading];
    for (const p of f.drops) {
      drops.push(p);
      assert.ok(!['launch', 'flight', 'landing', 'walk'].includes(state), `dropped while ${state}`);
      // At the tip of the abdomen, behind the fly.
      const back = -((p[0] - x) * Math.cos(h) + (p[1] - y) * Math.sin(h)) / f.length;
      assert.ok(back > 0.35 && back < 0.6, `dropped ${back.toFixed(2)} body lengths behind`);
    }
    f.drops.length = 0;
  }
  assert.ok(drops.length >= 10, `only ${drops.length} in two minutes`);
});

test('a fly with droppings off leaves none', () => {
  const f = fly(2);
  for (let i = 0; i < 60 * 120; i++) f.update(DT);
  assert.equal(f.drops.length, 0);
});

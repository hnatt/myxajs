// The pointer, which the fly treats as a predator.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DT, fly } from './helpers.js';
import { CURSOR_PANIC_MM, CURSOR_SCURRY_MM, CURSOR_NOTICE_MM } from '../src/fly.js';

/** A fly settled on the ground in the middle of the page, grooming. */
function settled(seed = 1, opts = {}) {
  const f = fly(seed, opts);
  f.x = 700;
  f.y = 450;
  f.height = 0;
  f._enter('groom_front');
  f.stateDur = 60;
  return f;
}

/** Park the pointer at a distance in mm and let a few frames pass. */
function parkAt(f, mm, frames = 10) {
  const at = [f.x + mm * f.pxPerMm, f.y];
  for (let i = 0; i < frames; i++) {
    f.senseCursor(at, DT);
    f.update(DT);
  }
}

test('the pointer thresholds are pinned', () => {
  assert.equal(CURSOR_PANIC_MM, 9);
  assert.equal(CURSOR_SCURRY_MM, 19);
  assert.equal(CURSOR_NOTICE_MM, 85);
});

test('a pointer parked well away is ignored', () => {
  const f = settled();
  parkAt(f, 40, 120);
  assert.equal(f.state, 'groom_front');
});

test('a pointer parked close by sends it off on foot, away from it', () => {
  const f = settled();
  parkAt(f, 15, 3);
  assert.equal(f.state, 'walk');
  assert.ok(f._fleeT > 0);
  const x0 = f.x;
  parkAt(f, 15 + (f.x - x0) / f.pxPerMm, 20);
  assert.ok(f.x < x0, 'it walked towards the pointer');
});

test('a pointer right on top of it makes it take off', () => {
  const f = settled();
  f.senseCursor([f.x + 5 * f.pxPerMm, f.y], DT);
  f.update(DT);
  assert.ok(['launch', 'flight'].includes(f.state), f.state);
  for (let i = 0; i < 10; i++) f.update(DT);
  assert.equal(f.state, 'flight');
  // A panicked fly flies faster than a leisurely one.
  assert.ok(f.cruiseSpeed >= 240 * 1.5 * f.pxPerMm * 0.999);
});

test('a fast-approaching pointer startles it from further away', () => {
  // Looming: time-to-contact matters, not only distance.
  const f = settled();
  // 400 mm/s straight at it, from beyond the distance it notices anything,
  // so the smoothed velocity is established by the time it matters.
  const speed = 400 * f.pxPerMm;
  let x = f.x - 150 * f.pxPerMm;
  let launchedAt = null;
  for (let i = 0; i < 60 && launchedAt === null; i++) {
    x += speed * DT;
    f.senseCursor([x, f.y], DT);
    f.update(DT);
    if (f.state === 'launch' || f.state === 'flight') launchedAt = (f.x - x) / f.pxPerMm;
  }
  assert.ok(launchedAt !== null, 'never took off');
  assert.ok(launchedAt > CURSOR_PANIC_MM * 1.5, `took off only ${launchedAt.toFixed(0)} mm out`);
});

test('a slowly approaching pointer gets close before it reacts', () => {
  const f = settled();
  const speed = 10 * f.pxPerMm; // 10 mm/s: a creep
  let x = f.x - 40 * f.pxPerMm;
  let reactedAt = null;
  for (let i = 0; i < 60 * 5 && reactedAt === null; i++) {
    x += speed * DT;
    f.senseCursor([x, f.y], DT);
    f.update(DT);
    if (f.state !== 'groom_front') reactedAt = (f.x - x) / f.pxPerMm;
  }
  assert.ok(reactedAt !== null, 'never reacted');
  assert.ok(reactedAt < CURSOR_SCURRY_MM + 1, `reacted ${reactedAt.toFixed(0)} mm out`);
});

test('in the air it veers away from the pointer', () => {
  const f = fly(2);
  for (let i = 0; i < 60 && f.state !== 'flight'; i++) f.update(DT);
  f.x = 700;
  f.y = 450;
  f._turnLeft = 0;
  const ahead = [f.x + Math.cos(f.heading) * 15 * f.pxPerMm, f.y + Math.sin(f.heading) * 15 * f.pxPerMm];
  f.senseCursor(ahead, DT);
  f.update(DT);
  assert.ok(Math.abs(f._turnLeft) > 1, 'no evasive saccade');
});

test('it will not land next to the pointer', () => {
  const near = [];
  for (let seed = 0; seed < 6; seed++) {
    const f = fly(seed);
    const cursor = [720, 450];
    for (let i = 0; i < 60 * 60 * 2; i++) {
      f.senseCursor(cursor, DT);
      const was = f.state;
      f.update(DT);
      if (was === 'landing' && f.state !== 'landing' && f.state !== 'flight') {
        near.push(Math.hypot(f.x - cursor[0], f.y - cursor[1]) / f.pxPerMm);
      }
    }
  }
  assert.ok(near.length > 5, 'not enough landings');
  assert.ok(Math.min(...near) > CURSOR_PANIC_MM, `landed ${Math.min(...near).toFixed(0)} mm from the pointer`);
});

test('shyness scales the distances', () => {
  const bold = settled(1, { shyness: 0.5 });
  parkAt(bold, 15, 5);
  assert.equal(bold.state, 'groom_front', 'a bold fly should sit tight at 15 mm');
  const shy = settled(1, { shyness: 2 });
  parkAt(shy, 30, 5);
  assert.notEqual(shy.state, 'groom_front', 'a shy fly should leave at 30 mm');
});

test('cursor: false turns the fear off', () => {
  const f = settled(1, { cursor: false });
  parkAt(f, 2, 30);
  assert.equal(f.state, 'groom_front');
  assert.equal(f.cursor, null);
});

test('a pointer that leaves the page is forgotten', () => {
  const f = settled();
  f.senseCursor([0, 0], DT);
  f.senseCursor(null, DT);
  assert.equal(f.cursor, null);
  assert.deepEqual(f.cursorVel, [0, 0]);
});

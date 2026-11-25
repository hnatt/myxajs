import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULTS } from '../src/myxa.js';
import { DEFAULT_BEHAVIOUR } from '../src/fly.js';
import { optionsFromDataset } from '../src/dataset.js';
import { Random } from '../src/random.js';

test('defaults are pinned', () => {
  assert.equal(DEFAULTS.flies, 1);
  assert.equal(DEFAULTS.flySizeMm, 7);
  assert.equal(DEFAULTS.speed, 1);
  assert.equal(DEFAULTS.fps, 60);
  assert.equal(DEFAULTS.spider, true);
  assert.equal(DEFAULTS.spiderSizeMm, 9);
  assert.equal(DEFAULTS.shadow, true);
  assert.equal(DEFAULTS.cursor, true);
  assert.equal(DEFAULTS.shyness, 1);
  assert.deepEqual(DEFAULTS.respawnDelay, [10, 60]);
  assert.deepEqual(DEFAULT_BEHAVIOUR, {
    walk: 0.4, groomFront: 0.16, groomHind: 0.12, groomWing: 0.08, idle: 0.14, takeOff: 0.1,
  });
  assert.ok(Math.abs(DEFAULTS.pxPerMm - 96 / 25.4) < 1e-9);
});

test('script-tag data attributes become options', () => {
  const o = optionsFromDataset({
    autostart: '', flies: '3', spider: 'false', cursor: '', shyness: '1.5',
    respawnDelay: '[2, 4]', detail: 'low', bogus: '1',
  });
  assert.deepEqual(o, { flies: 3, spider: false, cursor: true, shyness: 1.5, respawnDelay: [2, 4], detail: 'low' });
});

test('the seeded generator repeats and is roughly normal', () => {
  const a = new Random(42), b = new Random(42);
  for (let i = 0; i < 100; i++) assert.equal(a.random(), b.random());
  const r = new Random(7);
  let sum = 0, sq = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) {
    const g = r.gauss(0, 1);
    sum += g;
    sq += g * g;
  }
  assert.ok(Math.abs(sum / n) < 0.05);
  assert.ok(Math.abs(Math.sqrt(sq / n) - 1) < 0.05);
});

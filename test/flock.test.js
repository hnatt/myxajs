import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Fly } from '../src/fly.js';
import { Spider } from '../src/spider.js';
import { Flock } from '../src/flock.js';
import { World } from '../src/world.js';
import { Random } from '../src/random.js';
import { DEFAULTS } from '../src/myxa.js';
import { DT, wrap } from './helpers.js';

const WALK_ONLY = { walk: 1, groomFront: 0, groomHind: 0, groomWing: 0, idle: 0, takeOff: 0 };

/** Step everything the way the main loop does. */
function tick(flies, flock, spider = null, dt = DT) {
  const seen = spider && spider.visible ? [spider.x, spider.y] : null;
  for (const f of flies) {
    if (f.hidden) {
      f.tickHidden(dt);
      continue;
    }
    f.sensePredator(seen, dt);
    f.update(dt);
  }
  flock.update(flies, dt);
  if (spider) spider.update(dt);
}

/** Two flies already mating, the pair at (x, y). */
function matingPair(seed, w, x = 700, y = 450) {
  const rng = new Random(seed);
  const bottom = new Fly(w, rng, { cursor: false });
  const top = new Fly(w, rng, { cursor: false });
  bottom.x = x;
  bottom.y = y;
  bottom.heading = rng.uniform(0, Math.PI * 2);
  bottom._reseedFeet();
  bottom._enter('idle');
  top.mount(bottom);
  return [top, bottom];
}

test('mating is on by default, one meeting in ten', () => {
  assert.equal(DEFAULTS.mating, true);
  assert.equal(DEFAULTS.matingChance, 0.1);
});

test('flies on foot do not walk through each other', () => {
  const w = new World(500, 400);
  const rng = new Random(3);
  const flies = Array.from({ length: 8 }, () => new Fly(w, rng, { behaviour: WALK_ONLY, cursor: false }));
  for (const f of flies) {
    f.x = rng.uniform(100, 400);
    f.y = rng.uniform(100, 300);
    f._reseedFeet();
    f._enter('walk');
  }
  const flock = new Flock(rng, { mating: false });
  let worst = Infinity;
  for (let i = 0; i < 60 * 60; i++) {
    tick(flies, flock);
    if (i < 60) continue; // let the starting jumble sort itself out
    for (let a = 0; a < flies.length; a++) {
      for (let b = a + 1; b < flies.length; b++) {
        if (!flies[a].onFoot || !flies[b].onFoot) continue;
        const d = Math.hypot(flies[a].x - flies[b].x, flies[a].y - flies[b].y) / flies[a].length;
        worst = Math.min(worst, d);
      }
    }
  }
  assert.ok(worst > 0.7, `two flies came within ${worst.toFixed(2)} body lengths`);
});

/** Share of meetings that turn into courtship, with `others` more flies
 * sitting elsewhere on the page. */
function courtShare(others, n = 3000) {
  let courted = 0;
  for (let k = 0; k < n; k++) {
    const w = new World(1000, 800);
    const rng = new Random(k);
    const a = new Fly(w, rng, { cursor: false });
    const b = new Fly(w, rng, { cursor: false });
    a.x = 500;
    a.y = 400;
    b.x = 500 + 1.5 * a.length;
    b.y = 400;
    a._enter('walk');
    b._enter('idle');
    const rest = Array.from({ length: others }, (_, i) => {
      const f = new Fly(w, rng, { cursor: false });
      f.x = 100 + 60 * i;
      f.y = 100;
      f._enter('idle');
      return f;
    });
    for (const f of [a, b, ...rest]) f.height = 0; // as the first update would leave them
    const flock = new Flock(rng, { matingChance: 0.1 });
    flock.update([a, b, ...rest], DT);
    // One roll per meeting: still together, no second chance.
    flock.update([a, b, ...rest], DT);
    if (a.state === 'court') courted++;
  }
  return courted / n;
}

test('about one meeting in ten turns into mating', () => {
  const share = courtShare(1);
  assert.ok(Math.abs(share - 0.1) < 0.02, `share ${share.toFixed(3)}`);
});

test('the only two flies on the page are three times as likely to mate', () => {
  const share = courtShare(0);
  assert.ok(Math.abs(share - 0.3) < 0.03, `share ${share.toFixed(3)}`);
});

test('a meeting with mating off, or between flies in the air, comes to nothing', () => {
  const w = new World(1000, 800);
  const rng = new Random(1);
  const a = new Fly(w, rng, { cursor: false });
  const b = new Fly(w, rng, { cursor: false });
  b.x = a.x + a.length;
  a._enter('walk');
  b._enter('walk');
  a.height = b.height = 0;
  new Flock(rng, { mating: false, matingChance: 1 }).update([a, b], DT);
  assert.equal(a.state, 'walk');
  b._enter('flight');
  b.height = 2;
  new Flock(rng, { matingChance: 1 }).update([a, b], DT);
  assert.equal(a.state, 'walk');
});

test('the mating sequence: court, mount, tussle, copula, part', () => {
  const w = new World(1000, 800);
  const rng = new Random(9);
  const a = new Fly(w, rng, { cursor: false, behaviour: WALK_ONLY });
  const b = new Fly(w, rng, { cursor: false, behaviour: WALK_ONLY });
  a.x = 400;
  a.y = 400;
  b.x = 400 + 2 * a.length;
  b.y = 420;
  a._reseedFeet();
  b._reseedFeet();
  a._enter('walk');
  b._enter('walk');
  const flock = new Flock(rng, { matingChance: 1 });
  const seen = [];
  let rode = 0;
  let mated = 0;
  let stared = 0;
  let presented = false;
  for (let i = 0; i < 60 * 70; i++) {
    tick([a, b], flock);
    const suitor = a.state === 'court' ? a : b.state === 'court' ? b : null;
    if (suitor && suitor.courtPhase === 'stare') {
      // Face to face, a little way apart, both standing still.
      const other = suitor.mate;
      assert.ok(suitor._faces(other, 0.35) && other._faces(suitor, 0.35), 'not facing each other');
      assert.ok(Math.hypot(other.x - suitor.x, other.y - suitor.y) > 1.3 * a.length);
      stared++;
    }
    const label = `${a.state}/${b.state}`;
    if (seen[seen.length - 1] !== label) seen.push(label);
    const mounting = a.state === 'mount' ? a : b.state === 'mount' ? b : null;
    if (mounting && !presented) {
      // Mounted from behind: the other had turned its back.
      assert.ok(mounting.mate._facesAway(mounting, 0.45), 'the one underneath did not turn its back');
      presented = true;
    }
    const top = a.mateRole === 'top' ? a : b.mateRole === 'top' ? b : null;
    if (top && top.state === 'mate') {
      mated++;
      const bottom = top.mate;
      assert.ok(top.height > 0.1 && bottom.height === 0);
      assert.ok(Math.abs(wrap(top.heading - bottom.heading)) < 0.1, 'facing the same way');
      // Riding on its back, set back a little: its head over the thorax.
      const back = -((top.x - bottom.x) * Math.cos(bottom.heading) + (top.y - bottom.y) * Math.sin(bottom.heading));
      assert.ok(back > 0.2 * bottom.length && back < 0.45 * bottom.length);
      rode++;
    }
    if (mated && !top) break;
  }
  const text = seen.join(' → ');
  assert.match(text, /court\/await|await\/court/, text);
  assert.match(text, /mount\/await|await\/mount/, text);
  assert.ok(stared / 60 >= 1, `stared only ${(stared / 60).toFixed(2)} s`);
  assert.ok(presented);
  assert.ok(rode / 60 > 20, `mated only ${(rode / 60).toFixed(1)} s`);
  // At the end the one on top flies off and the other cleans itself.
  assert.ok(seen.some((s) => /launch\/groom_hind|groom_hind\/launch/.test(s)), text);
  assert.equal(a.mate, null);
  assert.equal(b.mate, null);
});

test('either fly may end up on top', () => {
  let suitorOnTop = 0;
  let otherOnTop = 0;
  for (let seed = 0; seed < 16; seed++) {
    const w = new World(1000, 800);
    const rng = new Random(seed);
    const a = new Fly(w, rng, { cursor: false });
    const b = new Fly(w, rng, { cursor: false });
    a.x = 400;
    a.y = 400;
    b.x = 400 + 2 * a.length;
    b.y = 400;
    for (const f of [a, b]) {
      f.height = 0;
      f._reseedFeet();
      f._enter('idle');
    }
    a.court(b);
    const flock = new Flock(rng, { mating: false });
    for (let i = 0; i < 60 * 20 && !a.mateRole; i++) tick([a, b], flock);
    if (a.mateRole === 'top') suitorOnTop++;
    if (a.mateRole === 'bottom') otherOnTop++;
  }
  assert.ok(suitorOnTop > 2 && otherOnTop > 2, `suitor on top ${suitorOnTop}, other on top ${otherOnTop}`);
});

test('a spider that leaps at a mating pair never misses, and takes the one on top', () => {
  let leaps = 0;
  for (let seed = 0; seed < 20; seed++) {
    const w = new World(1440, 900);
    const [top, bottom] = matingPair(seed, w, 40 * w.pxPerMm, 450);
    const s = new Spider(w, [bottom, top], new Random(seed + 100));
    s.x = 3;
    s.y = 450;
    s._reseedFeet();
    const flock = new Flock(new Random(seed));
    let caught = null;
    for (let i = 0; i < 60 * 15 && !caught; i++) {
      tick([bottom, top], flock, s);
      if (s.state === 'pounce') leaps++;
      if (s.carried) caught = s.carried;
    }
    assert.equal(caught, top, `seed ${seed}: the spider took ${caught === bottom ? 'the bottom one' : 'nothing'}`);
  }
  assert.ok(leaps > 0);
});

test('the one left behind turns to watch, hesitates, then follows the spider off the page', () => {
  for (const seed of [1, 2, 3]) {
    const w = new World(1440, 900);
    const [top, bottom] = matingPair(seed, w, 40 * w.pxPerMm, 450);
    bottom.heading = 0; // facing away from the spider on the left edge
    top._ride();
    const s = new Spider(w, [bottom, top], new Random(seed + 7));
    s.x = 3;
    s.y = 450;
    s._reseedFeet();
    const flock = new Flock(new Random(seed));
    const phases = [];
    let faced = false;
    let gone = null;
    for (let i = 0; i < 60 * 90 && gone === null; i++) {
      tick([bottom, top], flock, s);
      const ph = bottom.state === 'mourn' ? bottom._mournPhase : bottom.state;
      if (phases[phases.length - 1] !== ph) phases.push(ph);
      if (bottom._mournPhase === 'watch' && bottom.state === 'mourn') {
        const bearing = Math.atan2(s.y - bottom.y, s.x - bottom.x);
        if (Math.abs(wrap(bearing - bottom.heading)) < 0.35) faced = true;
      }
      if (bottom.hidden) gone = i / 60;
    }
    const text = phases.join(' → ');
    const from = phases.indexOf('startle');
    assert.ok(from >= 0, text);
    assert.deepEqual(phases.slice(from, from + 6), ['startle', 'turn', 'watch', 'step', 'pause', 'follow'], text);
    assert.ok(faced, 'it never turned to face the spider');
    assert.ok(gone !== null, `it never left the page: ${text}`);
    assert.ok(bottom.respawnIn > 0, 'another fly should come back later');
  }
});

test('a mating pair ignores the pointer, but it can touch them', () => {
  const w = new World(1440, 900);
  const [top, bottom] = matingPair(4, w);
  bottom.heading = 0;
  top._ride();
  top.cursorFear = bottom.cursorFear = true;
  const flock = new Flock(new Random(4));
  for (let i = 0; i < 60; i++) tick([bottom, top], flock);
  const [bx, by] = [bottom.x, bottom.y];
  const L = top.length;
  let slip = 0;
  let wing = 0;
  // Sweep the pointer across the pair from the side, fast, over the wings
  // and the one on top; then take it away.
  const path = [];
  for (let k = 0; k <= 30; k++) path.push([top.x - 0.2 * L, by - 1.5 * L + (3 * L * k) / 30]);
  for (let i = 0; i < 60 * 3; i++) {
    const at = i < path.length ? path[i] : null;
    for (const f of [top, bottom]) f.senseCursor(at, DT);
    tick([bottom, top], flock);
    slip = Math.max(slip, Math.hypot(...top._slip));
    wing = Math.max(wing, ...top._wingPush.map(Math.abs), ...bottom._wingPush.map(Math.abs));
  }
  assert.equal(top.state, 'mate');
  assert.equal(bottom.state, 'mate');
  assert.equal(top.mate, bottom);
  assert.ok(slip > 0.05, `the one on top was not moved (${slip.toFixed(3)})`);
  assert.ok(wing > 0.2, `the wings were not touched (${wing.toFixed(3)})`);
  assert.deepEqual([bottom.x, bottom.y], [bx, by], 'the one underneath stays put');
  // It has scrambled back into place.
  assert.ok(Math.hypot(...top._slip) < 0.02 && Math.abs(top._slipYaw) < 0.03);
});

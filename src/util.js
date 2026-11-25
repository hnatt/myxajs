// Small maths helpers shared by both animals.

export const TAU = Math.PI * 2;

export function smoothstep(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Wrap an angle into [-pi, pi). */
export function wrap(a) {
  return ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

export function turnTowards(cur, target, maxDelta) {
  const d = wrap(target - cur);
  return cur + clamp(d, -maxDelta, maxDelta);
}

/** Weighted choice from [[name, weight], ...]. */
export function pick(rng, choices) {
  let total = 0;
  for (const [, w] of choices) total += w;
  let r = rng.uniform(0, total);
  for (const [name, w] of choices) {
    r -= w;
    if (r <= 0) return name;
  }
  return choices[choices.length - 1][0];
}

/** Rotate a world-space light direction into body space for a heading. */
export function bodyLight(heading) {
  const c = Math.cos(-heading);
  const s = Math.sin(-heading);
  const lx = -0.55;
  const ly = -0.84;
  return [lx * c - ly * s, lx * s + ly * c];
}

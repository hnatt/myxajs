// Seeded pseudo-random numbers, standing in for Python's random.Random.
//
// mulberry32 is tiny, fast and good enough for an animation; the point of the
// seed is a repeatable fly for tests and demos, not statistical quality.

export class Random {
  constructor(seed) {
    if (seed === undefined || seed === null) {
      seed = (Math.random() * 0x100000000) >>> 0;
    }
    this._s = seed >>> 0;
    this._spare = null;
  }

  /** Uniform in [0, 1). */
  random() {
    let t = (this._s = (this._s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  uniform(a, b) {
    return a + (b - a) * this.random();
  }

  /** Normal deviate, by Box-Muller; the second value of each pair is kept. */
  gauss(mu = 0, sigma = 1) {
    if (this._spare !== null) {
      const z = this._spare;
      this._spare = null;
      return mu + sigma * z;
    }
    let u = 0;
    while (u <= 1e-12) u = this.random();
    const v = this.random();
    const r = Math.sqrt(-2 * Math.log(u));
    this._spare = r * Math.sin(2 * Math.PI * v);
    return mu + sigma * r * Math.cos(2 * Math.PI * v);
  }

  /** Integer in [0, n). */
  randrange(n) {
    return Math.floor(this.random() * n);
  }

  choice(seq) {
    return seq[this.randrange(seq.length)];
  }
}

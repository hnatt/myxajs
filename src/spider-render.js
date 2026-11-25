// Procedural rendering of a jumping spider (Salticidae), in Canvas 2D.
//
// Proportions and colours are measured from a reference photograph of a
// Plexippus-like jumping spider: a broad dark carapace carrying the big
// forward eyes, a cream abdomen with two bold black stripes, and eight banded
// tan legs.
//
// Flat gradients with crisp edges read as vector art, so the body carries a
// fine speckle, a feathered shadow inside each rim, a soft sheen towards the
// light and a few hundred hairs.  Hairs and rim shadows never change relative
// to the body, so they are drawn once per size into a cached layer and
// blitted; the legs' strokes are batched one path per width.

import { LEGS } from './spider-geometry.js';
import { Random } from './random.js';
import { lobe, pathOf, bbox, shade, ik, rgb } from './fly-render.js';

const TAU = Math.PI * 2;

const CARAPACE_DARK = [0.075, 0.058, 0.040];
const CARAPACE_LIGHT = [0.315, 0.262, 0.190];
const CARAPACE_RIM = [0.430, 0.385, 0.310];
const ABDOMEN_PALE = [0.615, 0.580, 0.505];
const ABDOMEN_SHADE = [0.250, 0.228, 0.185];
const ABDOMEN_STRIPE = [0.045, 0.038, 0.030];
const LEG_PALE = [0.415, 0.365, 0.283];
const LEG_BAND = [0.130, 0.098, 0.062];
const EYE = [0.055, 0.050, 0.050];
const PALP = [0.420, 0.378, 0.300];

/** Speckle and leg bristles only above this body length in device pixels. */
export const DETAIL_PX = 46;

function carapaceProfile(u) {
  // Broad and squarish, widest across the eye region towards the front, but
  // with both ends rounded off -- squared-off ends read as a slab.
  const base = 0.215 * Math.pow(Math.max(0, 1 - ((u - 0.6) / 0.78) ** 2), 0.42);
  const ends = Math.min(1, 0.55 + (u / 0.14) * 0.45) * Math.min(1, 0.6 + ((1 - u) / 0.12) * 0.4);
  return base * ends;
}

function abdomenProfile(u) {
  const rise = 0.82 + 0.18 * Math.min(1, u / 0.18);
  return 0.24 * rise * Math.pow(Math.max(0, 1 - u ** 2.6), 0.34);
}

export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

let G = null;

function geometry() {
  if (G) return G;
  const carapacePts = lobe(-0.05, 0.42, carapaceProfile, 32);
  const abdomenPts = lobe(-0.06, -0.58, abdomenProfile, 36);
  const stripes = new Path2D();
  for (const sign of [-1, 1]) {
    stripes.moveTo(-0.08, sign * 0.045);
    stripes.bezierCurveTo(-0.26, sign * 0.055, -0.42, sign * 0.048, -0.54, sign * 0.03);
    stripes.bezierCurveTo(-0.42, sign * 0.135, -0.26, sign * 0.17, -0.08, sign * 0.15);
    stripes.closePath();
  }
  const silhouette = new Path2D();
  silhouette.addPath(pathOf(lobe(-0.06, -0.58, abdomenProfile, 14)));
  silhouette.addPath(pathOf(lobe(-0.05, 0.42, carapaceProfile, 12)));
  G = {
    carapacePts,
    abdomenPts,
    carapace: pathOf(carapacePts),
    abdomen: pathOf(abdomenPts),
    carapaceBox: bbox(carapacePts),
    abdomenBox: bbox(abdomenPts),
    stripes,
    silhouette,
    noise: buildNoise(),
    bristles: buildBristles(),
    bands: buildBands(),
  };
  return G;
}

/**
 * A tile of fine light and dark specks, built once.  Flat gradients read as
 * plastic; a little noise breaks them up into something that looks like
 * chitin.  (A broad multi-octave mottle under the speckle is deliberately left
 * out: it costs a blended composite per body part and does not show at the
 * sizes a spider is drawn on a web page.)
 */
function buildNoise(size = 96, seed = 7) {
  const rng = new Random(seed);
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < size * size; i++) {
    const roll = rng.random();
    let alpha = 0;
    let tone = 0;
    if (roll < 0.34) alpha = Math.floor(46 * rng.random());
    else if (roll > 0.74) {
      alpha = Math.floor(34 * rng.random());
      tone = 255;
    }
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = tone;
    d[i * 4 + 3] = alpha;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Leg bristles: fixed features of the animal, so worked out once. */
function buildBristles() {
  const table = [];
  for (let idx = 0; idx < 8; idx++) {
    const rng = new Random(idx * 97 + 5);
    const perLeg = [];
    for (const seg of [0, 1]) {
      for (const t of [0.24, 0.52, 0.8]) {
        for (const side of [-1, 1]) {
          const ang = rng.uniform(0.55, 1.15);
          perLeg.push([seg, t, side, Math.sin(ang), Math.cos(ang) * 0.3, 0.03 * (0.6 + rng.random())]);
        }
      }
    }
    table.push(perLeg);
  }
  return table;
}

/** Dark leg bands, jittered per leg.  Identical bands on all eight legs look
 * stamped on rather than grown. */
function buildBands() {
  const table = [];
  for (let idx = 0; idx < 8; idx++) {
    const rng = new Random(idx * 31 + 11);
    const perLeg = [];
    for (const [seg, spots] of [[0, [0.3, 0.7]], [1, [0.24, 0.64]], [2, [0.48]]]) {
      for (const t of spots) {
        const start = Math.min(0.88, Math.max(0.04, t + rng.uniform(-0.09, 0.09)));
        perLeg.push([seg, start, Math.min(1, start + 0.13 + 0.09 * rng.random())]);
      }
    }
    table.push(perLeg);
  }
  return table;
}

function noisePattern(ctx, g, devScale) {
  const pattern = ctx.createPattern(g.noise, 'repeat');
  // One texel is roughly a device pixel and a half, in body space, so the
  // grain turns with the spider instead of swimming underneath it.
  const k = Math.max(0.8, devScale / 1.6);
  if (pattern.setTransform) pattern.setTransform(new DOMMatrix([1 / k, 0, 0, 1 / k, 0, 0]));
  return pattern;
}

/** A feathered shadow round the inside of a rim, so the shape has a top. */
function innerShadow(ctx, path) {
  ctx.save();
  ctx.clip(path);
  for (const [width, alpha] of [[0.115, 0.1], [0.065, 0.12], [0.03, 0.15]]) {
    ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
    ctx.lineWidth = width;
    ctx.stroke(path);
  }
  ctx.restore();
}

/** Hair lying over the body surface, not just standing off the edge. */
function pile(ctx, pts, path, count, length, seed, colour, alpha) {
  const rng = new Random(seed);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  ctx.save();
  ctx.clip(path);
  ctx.strokeStyle = rgb(colour, alpha);
  ctx.lineWidth = 0.007;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const x = rng.uniform(x0, x1);
    const y = rng.uniform(y0, y1);
    const a = rng.uniform(0, TAU);
    const h = length * (0.5 + rng.random());
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * h, y + Math.sin(a) * h);
  }
  ctx.stroke();
  ctx.restore();
}

/** Fine setae standing out from an outline, splayed a little at random. */
function hairs(ctx, pts, count, length, seed, colour, alpha, width) {
  const rng = new Random(seed);
  const n = pts.length;
  let cx = 0, cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  cx /= n; cy /= n;
  ctx.strokeStyle = rgb(colour, alpha);
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let k = 0; k < count; k++) {
    // Jitter where each hair leaves the outline and how long it is; evenly
    // spaced hairs of one length are a picket fence, not fur.
    const i = Math.floor(((k + rng.random()) * n) / count) % n;
    const [x, y] = pts[i];
    const dx = x - cx, dy = y - cy;
    const d = Math.hypot(dx, dy) || 1;
    const nx = dx / d, ny = dy / d;
    const a = rng.uniform(-0.95, 0.95);
    const ca = Math.cos(a), sa = Math.sin(a);
    const hx = nx * ca - ny * sa, hy = nx * sa + ny * ca;
    const h = length * (0.25 + 1.5 * rng.random() ** 2);
    ctx.moveTo(x - nx * h * 0.25, y - ny * h * 0.25); // root it in the body
    ctx.lineTo(x + hx * h, y + hy * h);
  }
  ctx.stroke();
}

/** Hair layers are hundreds of tiny strokes; rendered once per size. */
const hairCache = new Map();

function hairLayer(devScale, part) {
  const key = `${part}:${Math.round(devScale)}`;
  let entry = hairCache.get(key);
  if (entry) return entry;
  if (hairCache.size > 8) hairCache.clear();

  const g = geometry();
  const isAbdomen = part === 'abdomen';
  const pts = isAbdomen ? g.abdomenPts : g.carapacePts;
  const path = isAbdomen ? g.abdomen : g.carapace;
  const pad = 0.16;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  const w = Math.max(1, Math.ceil((x1 - x0) * devScale) + 2);
  const h = Math.max(1, Math.ceil((y1 - y0) * devScale) + 2);
  const canvas = makeCanvas(w, h);
  const c = canvas.getContext('2d');
  c.scale(devScale, devScale);
  c.translate(-x0, -y0);
  innerShadow(c, path);
  if (isAbdomen) {
    pile(c, pts, path, 90, 0.055, 31, [0.14, 0.115, 0.085], 0.3);
    hairs(c, pts, 150, 0.07, 11, [0.13, 0.105, 0.075], 0.5, 0.0055);
  } else {
    pile(c, pts, path, 70, 0.048, 41, [0.1, 0.08, 0.055], 0.32);
    hairs(c, pts, 110, 0.058, 23, [0.1, 0.078, 0.055], 0.5, 0.0055);
  }
  entry = { canvas, x0, y0, w: w / devScale, h: h / devScale };
  hairCache.set(key, entry);
  return entry;
}

function blitHairs(ctx, devScale, part) {
  const e = hairLayer(devScale, part);
  ctx.drawImage(e.canvas, e.x0, e.y0, e.w, e.h);
}

/** The faint gloss chitin has, towards the light.  Filling the outline with a
 * gradient that fades to nothing is the same as clipping and painting. */
function sheen(ctx, path, box, lv) {
  const [cx, cy, r] = box;
  const hx = cx + lv[0] * r * 0.42;
  const hy = cy + lv[1] * r * 0.42;
  const g = ctx.createRadialGradient(hx, hy, r * 0.04, hx, hy, r * 0.8);
  g.addColorStop(0, 'rgba(255,255,255,0.17)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.05)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fill(path);
}

const SEGMENTS = [[0, 0.066], [1, 0.044], [2, 0.024]];

function legJoints(idx, foot) {
  const [coxa, , femur, tibia, tarsus, kneeSign] = LEGS[idx];
  const ax = foot[0] - coxa[0];
  const ay = foot[1] - coxa[1];
  const d = Math.hypot(ax, ay) || 1e-5;
  const ankle = [foot[0] - (ax / d) * tarsus, foot[1] - (ay / d) * tarsus];
  return [coxa, ik(coxa, ankle, femur, tibia, kneeSign), ankle, foot];
}

/** All eight legs, drawn in batched passes: one path per width class. */
function drawLegs(ctx, g, feet, detail) {
  const joints = feet.map((f, i) => legJoints(i, f));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const lay = (seg) => {
    ctx.beginPath();
    for (const j of joints) {
      ctx.moveTo(j[seg][0], j[seg][1]);
      ctx.lineTo(j[seg + 1][0], j[seg + 1][1]);
    }
  };

  ctx.strokeStyle = rgb(LEG_PALE);
  for (const [seg, width] of SEGMENTS) {
    ctx.lineWidth = width;
    lay(seg);
    ctx.stroke();
  }

  // (The legs used to be stroked a second time with the speck pattern.  It
  // doubled their cost and is invisible on legs a couple of pixels wide.)

  // Dark banding, the most recognisable thing about a salticid's legs.  Cheap
  // enough to keep at every size.
  ctx.strokeStyle = rgb(LEG_BAND, 0.85);
  for (const [seg, width] of SEGMENTS) {
    ctx.lineWidth = width;
    ctx.beginPath();
    joints.forEach((j, idx) => {
      const p = j[seg];
      const q = j[seg + 1];
      for (const [bseg, t0, t1] of g.bands[idx]) {
        if (bseg !== seg) continue;
        ctx.moveTo(p[0] + (q[0] - p[0]) * t0, p[1] + (q[1] - p[1]) * t0);
        ctx.lineTo(p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1);
      }
    });
    ctx.stroke();
  }

  if (detail) {
    // Bristles, all in one path, from the precomputed table.
    ctx.strokeStyle = 'rgba(41,31,20,0.45)';
    ctx.lineWidth = 0.0055;
    ctx.beginPath();
    joints.forEach((j, idx) => {
      for (const [seg, t, side, sinA, cosA, ln] of g.bristles[idx]) {
        const p = j[seg];
        const q = j[seg + 1];
        const vx = q[0] - p[0];
        const vy = q[1] - p[1];
        const n = Math.hypot(vx, vy) || 1;
        const ux = vx / n;
        const uy = vy / n;
        const bx = p[0] + vx * t;
        const by = p[1] + vy * t;
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + (-uy * side * sinA + ux * cosA) * ln, by + (ux * side * sinA + uy * cosA) * ln);
      }
    });
    ctx.stroke();
  }

  // Dark tarsal tips.
  ctx.strokeStyle = rgb(LEG_BAND);
  ctx.lineWidth = 0.026;
  ctx.beginPath();
  for (const [coxa, , , foot] of joints) {
    const ax = foot[0] - coxa[0];
    const ay = foot[1] - coxa[1];
    const d = Math.hypot(ax, ay) || 1;
    ctx.moveTo(foot[0] - (ax / d) * 0.05, foot[1] - (ay / d) * 0.05);
    ctx.lineTo(foot[0], foot[1]);
  }
  ctx.stroke();
}

function grain(ctx, g, path, devScale) {
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = noisePattern(ctx, g, devScale);
  ctx.fill(path);
  ctx.globalAlpha = 1;
}

function drawBody(ctx, g, pose, detail, devScale) {
  const lv = pose.light;

  // --- abdomen: cream, with two bold black stripes ---
  shade(ctx, g.abdomen, ABDOMEN_SHADE, ABDOMEN_PALE, lv, g.abdomenBox);
  ctx.save();
  ctx.clip(g.abdomen);
  ctx.fillStyle = rgb(ABDOMEN_STRIPE, 0.92);
  ctx.fill(g.stripes);
  ctx.restore();
  if (detail) grain(ctx, g, g.abdomen, devScale);
  sheen(ctx, g.abdomen, g.abdomenBox, lv);
  blitHairs(ctx, devScale, 'abdomen');

  // --- carapace ---
  shade(ctx, g.carapace, CARAPACE_DARK, CARAPACE_LIGHT, lv, g.carapaceBox);
  if (detail) grain(ctx, g, g.carapace, devScale);
  sheen(ctx, g.carapace, g.carapaceBox, lv);
  ctx.strokeStyle = rgb(CARAPACE_RIM, 0.22);
  ctx.lineWidth = 0.012;
  ctx.stroke(g.carapace);
  blitHairs(ctx, devScale, 'carapace');

  // --- eyes: two big forward-facing ones, plus the smaller lateral pairs ---
  const eyes = [[0.345, 0.088, 0.082], [0.345, -0.088, 0.082], [0.3, 0.185, 0.04],
    [0.3, -0.185, 0.04], [0.075, 0.18, 0.034], [0.075, -0.18, 0.034]];
  ctx.fillStyle = rgb(EYE);
  ctx.beginPath();
  for (const [x, y, r] of eyes) {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
  }
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.20)';
  ctx.beginPath();
  for (const [x, y, r] of eyes) {
    const ex = x - lv[0] * r * 0.42;
    const ey = y - lv[1] * r * 0.42;
    ctx.moveTo(ex + r * 0.22, ey);
    ctx.arc(ex, ey, r * 0.22, 0, TAU);
  }
  ctx.fill();

  // --- chelicerae: the jaws the prey is seized and macerated with.  Spiders
  // --- do not chew so much as shred, working them back and forth.
  for (const sign of [-1, 1]) {
    ctx.save();
    ctx.translate(0.4, 0.052 * sign);
    ctx.rotate((0.12 + 0.5 * pose.bite) * sign);
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.1, 0.058, 0, 0, TAU);
    ctx.fillStyle = 'rgb(38,29,22)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 0.007;
    ctx.stroke();
    // Fang, folded along the chelicera until it strikes.
    ctx.strokeStyle = 'rgb(8,6,5)';
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.024;
    ctx.beginPath();
    ctx.moveTo(0.07, 0.014 * sign);
    ctx.lineTo(0.07 + 0.095 * (0.3 + 0.7 * pose.bite), (0.014 + 0.055 * pose.bite) * sign);
    ctx.stroke();
    ctx.restore();
  }

  // --- pedipalps, held in front of the face and waggled ---
  ctx.strokeStyle = rgb(PALP);
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.055;
  ctx.beginPath();
  for (const sign of [-1, 1]) {
    const a = (0.3 + 0.18 * pose.palp) * sign;
    const ox = 0.4;
    const oy = 0.075 * sign;
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + 0.13 * Math.cos(a), oy + 0.13 * Math.sin(a));
  }
  ctx.stroke();
}

export function drawSpiderShadow(ctx, scale, heading, pose) {
  const g = geometry();
  const h = pose.height;
  const light = pose.light;
  const fade = Math.max(0, Math.min(1, (1.6 - h) / 0.5));
  const off = h * 0.22 * scale;
  const blur = 1 + h * 0.2;
  const alpha = (0.34 / (1 + h * 1.8)) * fade;
  if (alpha < 0.008) return;
  ctx.save();
  ctx.translate(-light[0] * off, -light[1] * off);
  ctx.rotate(heading);
  ctx.scale(scale * blur, scale * blur);
  if (h > 0.3) {
    ctx.scale(1.25, 0.9);
    const rg = ctx.createRadialGradient(-0.04, 0, 0.04, -0.04, 0, 0.5);
    rg.addColorStop(0, `rgba(13,10,8,${alpha * 0.85})`);
    rg.addColorStop(0.55, `rgba(13,10,8,${alpha * 0.45})`);
    rg.addColorStop(1, 'rgba(13,10,8,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(-0.04, 0, 0.5, 0, TAU);
    ctx.fill();
  } else {
    for (const [grow, a] of [[1.14, 0.34], [1, 1]]) {
      ctx.save();
      ctx.scale(grow, grow);
      ctx.fillStyle = `rgba(13,10,8,${alpha * a * 0.6})`;
      ctx.fill(g.silhouette);
      ctx.restore();
    }
  }
  ctx.restore();
}

/** Draw a spider of body length `scale` CSS px, facing `heading` radians. */
export function drawSpider(ctx, scale, heading, pose, dpr = 1, detailMode = 'auto') {
  const g = geometry();
  ctx.save();
  ctx.rotate(heading);
  const s = scale * (1 + pose.height * 0.16);
  ctx.scale(s, s);
  const devScale = scale * dpr;
  const detail = detailMode === 'high' || (detailMode === 'auto' && devScale >= DETAIL_PX);
  drawLegs(ctx, g, pose.feet, detail);
  drawBody(ctx, g, pose, detail, devScale);
  ctx.restore();
}

// Exposed for tests of the cache, and for the overlay's teardown.
export function clearCaches() {
  hairCache.clear();
}

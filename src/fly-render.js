// Procedural rendering of a house fly (Musca domestica), in Canvas 2D.
//
// Drawing the fly rather than blitting a sprite keeps it sharp at any device
// pixel ratio, lets it be re-lit as the body turns so the highlight always sits
// towards the light, and lets the six legs be articulated by inverse kinematics
// so the walk is a real insect gait instead of a looping flipbook.
//
// Proportions (head 0.21, thorax 0.35, abdomen 0.44 of body length, thorax
// width 0.37) and colours are measured from a reference photograph.

import { LEGS, WING_BASE, WING_LEN, WING_REST_ANGLE, WING_OUT_ANGLE } from './fly-geometry.js';

const TAU = Math.PI * 2;

// Palette.  A grey fly: dark thorax with four black longitudinal stripes, a
// buff abdomen with a dark median line, and very large red-brown compound eyes.
const THORAX_DARK = [0.140, 0.150, 0.190];
const THORAX_LIGHT = [0.500, 0.520, 0.600];
const STRIPE = [0.055, 0.058, 0.075];
const ABDOMEN_DARK = [0.060, 0.068, 0.085];
const ABDOMEN_LIGHT = [0.230, 0.242, 0.300];
const ABDOMEN_MIDLINE = [0.040, 0.045, 0.055];
const EYE_DARK = [0.215, 0.140, 0.170];
const EYE_LIGHT = [0.520, 0.365, 0.380];
const FRONS = [0.730, 0.650, 0.630];
const LEG = [0.100, 0.100, 0.115];
const LEG_LIT = [0.300, 0.310, 0.345];
const VEIN = [0.300, 0.300, 0.345];
const TARSUS = [0.520, 0.500, 0.280]; // the pale yellowish feet

const WING_HALFW = 0.280;
const WING_BEAT_MID = (112 * Math.PI) / 180;
const WING_BEAT_AMP = (33 * Math.PI) / 180;
/** The wing tint, averaged along its length, for the beating-wing ghosts. */
const WING_FLAT = 'rgba(160,166,175,0.55)';

/** Below this rendered body length in *device* pixels, bristles and wing
 * veins are smaller than a pixel; drawing them only costs time. */
export const DETAIL_PX = 42;

export function rgb(c, a = 1) {
  const r = Math.round(c[0] * 255);
  const g = Math.round(c[1] * 255);
  const b = Math.round(c[2] * 255);
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

export function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// --------------------------------------------------------------------------
// Static geometry, built once.
// --------------------------------------------------------------------------

/** A closed, mirror-symmetric body segment sampled along its long axis. */
export function lobe(x0, x1, halfW, n = 34) {
  const top = [];
  const bottom = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = x0 + (x1 - x0) * u;
    const w = halfW(u);
    top.push([x, -w]);
    bottom.push([x, w]);
  }
  return top.concat(bottom.reverse());
}

export function pathOf(pts) {
  const p = new Path2D();
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
  p.closePath();
  return p;
}

export function bbox(pts) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0) * 0.62 || 0.1];
}

function abdomenProfile(u) {
  // Widest just behind the waist, then tapering to a blunt point.
  const rise = 0.84 + 0.16 * Math.min(1, u / 0.14);
  return 0.185 * rise * Math.pow(Math.max(0, 1 - u ** 3), 0.36);
}

function thoraxProfile(u) {
  return 0.194 * Math.pow(1 - (2 * u - 1) ** 6 * 0.9, 0.4);
}

/**
 * A house fly's wing is a broad paddle with a bluntly rounded tip.  The width
 * envelope holds most of its value almost to the end and only then falls away;
 * a plain sine profile tapers to a dragonfly-like point instead.
 */
export function buildWing(n = 48) {
  const lead = [];
  const trail = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const rise = Math.pow(Math.min(1, u / 0.2), 0.65); // narrow at the root
    const env = Math.pow(1 - u ** 10, 0.28) * rise;
    // The anal lobe fills out the trailing edge near the base.
    const lobeW = 0.10 * Math.exp(-(((u - 0.2) / 0.22) ** 2)) * rise;
    lead.push([u * WING_LEN, -WING_HALFW * 0.44 * env]);
    trail.push([u * WING_LEN, WING_HALFW * (0.56 * env + lobeW)]);
  }
  return lead.concat(trail.reverse());
}

let G = null; // geometry, built on first draw (Path2D needs a browser)

function geometry() {
  if (G) return G;
  const abdomen = lobe(0.0, -0.46, abdomenProfile, 40);
  const thorax = lobe(-0.07, 0.31, thoraxProfile, 34);
  const veins = new Path2D();
  for (const [spread, reach] of [[-0.34, 0.90], [-0.10, 0.94], [0.18, 0.92], [0.40, 0.72], [0.58, 0.42]]) {
    veins.moveTo(0.04, 0);
    veins.bezierCurveTo(
      WING_LEN * 0.35, spread * WING_HALFW * 0.7,
      WING_LEN * 0.7, spread * WING_HALFW,
      WING_LEN * reach, spread * WING_HALFW * 1.05,
    );
  }
  const midline = new Path2D();
  midline.moveTo(0, -0.042);
  midline.bezierCurveTo(-0.22, -0.032, -0.35, -0.018, -0.46, 0);
  midline.bezierCurveTo(-0.35, 0.018, -0.22, 0.032, 0, 0.042);
  midline.closePath();
  const proboscis = new Path2D();
  proboscis.moveTo(0.5, 0);
  proboscis.bezierCurveTo(0.466, -0.009, 0.4, -0.013, 0.326, -0.01);
  proboscis.bezierCurveTo(0.4, 0.013, 0.466, 0.009, 0.5, 0);
  proboscis.closePath();
  const tergites = new Path2D();
  for (const x of [-0.15, -0.26, -0.36]) {
    // Each band spans the abdomen at its own station along it (the abdomen is
    // drawn shifted 0.02 back, from 0 to -0.46).
    const w = abdomenProfile(-x / 0.46);
    tergites.rect(x, -w, 0.014, 2 * w);
  }
  const stripes = new Path2D();
  for (const [y, w] of [[-0.082, 0.02], [-0.028, 0.017], [0.028, 0.017], [0.082, 0.02]]) {
    stripes.rect(-0.03, y - w / 2, 0.32, w);
  }
  const silhouette = new Path2D();
  silhouette.addPath(pathOf(lobe(-0.02, -0.48, abdomenProfile, 14)));
  silhouette.addPath(pathOf(lobe(-0.07, 0.31, thoraxProfile, 12)));
  silhouette.ellipse(0.413, 0, 0.115, 0.18, 0, 0, TAU);

  G = {
    abdomen: pathOf(abdomen),
    thorax: pathOf(thorax),
    abdomenBox: bbox(abdomen),
    thoraxBox: bbox(thorax),
    wing: pathOf(buildWing()),
    veins,
    midline,
    tergites,
    stripes,
    proboscis,
    silhouette,
    wingFill: null, // gradient, made once against the first context
  };
  return G;
}

// --------------------------------------------------------------------------
// Parts
// --------------------------------------------------------------------------

/** Fill a path with a light-direction-aware gradient. */
export function shade(ctx, path, dark, light, lv, box) {
  const [cx, cy, r] = box;
  const g = ctx.createLinearGradient(cx + lv[0] * r, cy + lv[1] * r, cx - lv[0] * r, cy - lv[1] * r);
  g.addColorStop(0, rgb(light));
  g.addColorStop(0.55, rgb(mix(light, dark, 0.5)));
  g.addColorStop(1, rgb(dark));
  ctx.fillStyle = g;
  ctx.fill(path);
}

/**
 * Two-bone IK.  `sign` picks which of the two solutions the knee takes.  It is
 * given per leg rather than derived: which way a leg folds is simply an
 * anatomical fact about that leg.
 */
export function ik(coxa, foot, femur, tibia, sign) {
  const dx = foot[0] - coxa[0];
  const dy = foot[1] - coxa[1];
  const d = Math.max(1e-5, Math.min(Math.hypot(dx, dy), (femur + tibia) * 0.995));
  const cosK = Math.max(-1, Math.min(1, (femur * femur + d * d - tibia * tibia) / (2 * femur * d)));
  const ang = Math.atan2(dy, dx) + sign * Math.acos(cosK);
  return [coxa[0] + femur * Math.cos(ang), coxa[1] + femur * Math.sin(ang)];
}

/**
 * One leg.  With `onTop`, only the tibia and tarsus: the part of a grooming
 * leg that lies across the eyes, the wings or the abdomen, drawn again after
 * the body so it is seen on top.
 */
function drawLeg(ctx, idx, foot, lift, detail, onTop = false) {
  const [coxa, , femur, tibia, tarsus, kneeSign] = LEGS[idx];
  const lat = idx % 2 ? 1 : -1;
  // Solve the two long bones to the ankle so the tarsus stays flat.
  const ax = foot[0] - coxa[0];
  const ay = foot[1] - coxa[1];
  const d = Math.hypot(ax, ay) || 1e-5;
  const ankle = [foot[0] - (ax / d) * tarsus, foot[1] - (ay / d) * tarsus];
  const knee = ik(coxa, ankle, femur, tibia, kneeSign);

  // A raised foot is nearer the viewer: a touch thicker and lighter.
  const col = rgb(mix(LEG, LEG_LIT, 0.25 + 0.5 * lift));
  const thick = 1 + 0.15 * lift;
  ctx.strokeStyle = col;
  if (!onTop) {
    ctx.lineWidth = 0.017 * thick;
    ctx.beginPath();
    ctx.moveTo(coxa[0], coxa[1]);
    ctx.lineTo(knee[0], knee[1]);
    ctx.stroke();
  }
  ctx.lineWidth = 0.012 * thick;
  ctx.beginPath();
  ctx.moveTo(knee[0], knee[1]);
  ctx.lineTo(ankle[0], ankle[1]);
  ctx.stroke();
  ctx.strokeStyle = rgb(TARSUS);
  ctx.lineWidth = 0.0075 * thick;
  ctx.beginPath();
  ctx.moveTo(ankle[0], ankle[1]);
  ctx.lineTo(foot[0], foot[1]);
  ctx.stroke();

  if (!detail) return;
  // Bristles along the tibia -- tiny, but they are what reads as "insect".
  ctx.strokeStyle = col;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 0.003;
  ctx.beginPath();
  const nx0 = -(ankle[1] - knee[1]);
  const ny0 = ankle[0] - knee[0];
  const n = Math.hypot(nx0, ny0) || 1;
  for (const t of [0.34, 0.6, 0.84]) {
    const bx = knee[0] + (ankle[0] - knee[0]) * t;
    const by = knee[1] + (ankle[1] - knee[1]) * t;
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + (nx0 / n) * 0.014 * lat, by + (ny0 / n) * 0.014 * lat);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function wingGradient(ctx, g) {
  if (!g.wingFill) {
    // Alpha lives in globalAlpha, so one gradient serves every wing drawn.
    const w = ctx.createLinearGradient(0.06, 0, WING_LEN * 0.95, 0);
    w.addColorStop(0, 'rgba(128,125,168,0.72)');
    w.addColorStop(0.4, 'rgba(168,173,191,0.56)');
    w.addColorStop(0.75, 'rgba(161,173,156,0.50)');
    w.addColorStop(1, 'rgba(186,194,181,0.46)');
    g.wingFill = w;
  }
  return g.wingFill;
}

function drawWing(ctx, g, sign, angle, alpha, veins, flat = false) {
  ctx.save();
  ctx.translate(WING_BASE[0], WING_BASE[1] * sign);
  ctx.rotate(angle * sign);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = flat ? WING_FLAT : wingGradient(ctx, g);
  ctx.fill(g.wing);
  ctx.globalAlpha = Math.min(1, alpha * 1.25);
  ctx.strokeStyle = rgb(VEIN);
  ctx.lineWidth = 0.008;
  ctx.stroke(g.wing);
  if (veins) {
    ctx.globalAlpha = alpha * 0.95;
    ctx.lineWidth = 0.0065;
    ctx.stroke(g.veins);
  }
  ctx.restore();
}

function drawWings(ctx, g, pose, detail) {
  if (pose.wingBlur > 0.02) {
    // A beating wing is a translucent fan.  Ghosts are spaced by cosine so they
    // crowd at the stroke reversals, where a real wing lingers.  The fan is the
    // dearest thing about a fly in the air, so a small fly gets three ghosts a
    // side with a flat tint; only a large one gets six with a gradient each,
    // which is where three would start to read as separate wings.
    const amp = WING_BEAT_AMP * pose.wingBlur;
    const n = detail ? 6 : 3;
    const alpha = detail ? 0.15 : 0.24;
    for (const sign of [-1, 1]) {
      for (let k = 0; k < n; k++) {
        const c = Math.cos(Math.PI * (k / (n - 1)));
        const edge = 0.45 + 0.55 * Math.abs(c);
        drawWing(ctx, g, sign, WING_BEAT_MID + amp * c, alpha * edge, false, !detail);
      }
    }
    return;
  }
  // A wing being groomed is pushed out and drawn back on its own.
  const span = WING_OUT_ANGLE - WING_REST_ANGLE;
  for (const [sign, k] of [[-1, 0], [1, 1]]) {
    const angle = WING_REST_ANGLE + span * (pose.wingSpread + pose.wingOpen[k]);
    drawWing(ctx, g, sign, angle, 0.5, detail);
  }
}

function drawBody(ctx, g, pose) {
  const lv = pose.light;

  // --- abdomen (drawn first so the thorax overlaps its waist) ---
  ctx.save();
  ctx.translate(-0.02, 0);
  ctx.rotate(pose.abdomenBend);
  shade(ctx, g.abdomen, ABDOMEN_DARK, ABDOMEN_LIGHT, lv, g.abdomenBox);
  // Median stripe and tergite bands.  Both are cut to the outline up front
  // rather than clipped: a clip is one of the dearer things a canvas does.
  ctx.fillStyle = rgb(ABDOMEN_MIDLINE, 0.30);
  ctx.fill(g.midline);
  ctx.fillStyle = rgb(ABDOMEN_MIDLINE, 0.28);
  ctx.fill(g.tergites);
  ctx.restore();

  // --- thorax with the four diagnostic black stripes ---
  shade(ctx, g.thorax, THORAX_DARK, THORAX_LIGHT, lv, g.thoraxBox);
  // The stripes lie wholly inside the thorax, so they need no clip.
  ctx.fillStyle = rgb(STRIPE, 0.75);
  ctx.fill(g.stripes);
  // Scutellum: the little rounded plate at the rear of the thorax.
  ctx.fillStyle = rgb(THORAX_DARK, 0.55);
  ctx.beginPath();
  ctx.ellipse(-0.045, 0, 0.055, 0.0825, 0, 0, TAU);
  ctx.fill();

  // --- head, dominated by the compound eyes ---
  ctx.save();
  ctx.rotate(pose.headYaw);
  ctx.fillStyle = rgb([0.2, 0.19, 0.19]);
  ctx.beginPath();
  ctx.ellipse(0.487, 0, 0.04, 0.052, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = rgb([FRONS[0] * 0.45, FRONS[1] * 0.45, FRONS[2] * 0.45]);
  ctx.beginPath();
  ctx.ellipse(0.413, 0, 0.11, 0.18, 0, 0, TAU);
  ctx.fill();

  for (const sign of [-1, 1]) {
    ctx.save();
    ctx.translate(0.409, 0.063 * sign);
    ctx.rotate(0.2 * sign);
    ctx.scale(0.098, 0.116);
    const eg = ctx.createRadialGradient(-lv[0] * 0.45, -lv[1] * 0.45, 0.05, 0, 0, 1.25);
    eg.addColorStop(0, rgb(EYE_LIGHT));
    eg.addColorStop(0.55, rgb(mix(EYE_LIGHT, EYE_DARK, 0.5)));
    eg.addColorStop(1, rgb(EYE_DARK));
    ctx.fillStyle = eg;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.arc(-lv[0] * 0.5, -lv[1] * 0.5, 0.22, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = rgb(FRONS);
  ctx.fill(g.proboscis);
  ctx.restore();

  // Halteres: the vestigial hind wings, just visible behind the wing bases.
  ctx.fillStyle = 'rgba(117,110,87,0.85)';
  ctx.beginPath();
  ctx.arc(-0.05, -0.12, 0.022, 0, TAU);
  ctx.moveTo(-0.05 + 0.022, 0.12);
  ctx.arc(-0.05, 0.12, 0.022, 0, TAU);
  ctx.fill();
}

/** Soft contact shadow; it slides out and fades as the fly gains height. */
export function drawFlyShadow(ctx, scale, heading, pose) {
  const g = geometry();
  const h = pose.height;
  const light = pose.light;
  const fade = Math.max(0, Math.min(1, (2.1 - h) / 0.6));
  const off = h * 0.22 * scale;
  const blur = 1 + h * 0.2;
  const alpha = (0.3 / (1 + h * 1.8)) * fade;
  if (alpha < 0.008) return;
  ctx.save();
  ctx.translate(-light[0] * off, -light[1] * off);
  ctx.rotate(heading);
  ctx.scale(scale * blur, scale * blur);
  if (h > 0.35) {
    // Height blurs the silhouette away into a soft pool.
    ctx.scale(1.25, 0.85);
    const rg = ctx.createRadialGradient(-0.04, 0, 0.04, -0.04, 0, 0.45);
    rg.addColorStop(0, `rgba(13,10,8,${alpha * 0.85})`);
    rg.addColorStop(0.55, `rgba(13,10,8,${alpha * 0.45})`);
    rg.addColorStop(1, 'rgba(13,10,8,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(-0.04, 0, 0.45, 0, TAU);
    ctx.fill();
  } else {
    // Two stacked passes are enough of a blur for a contact shadow.
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

/**
 * Draw a fly of body length `scale` CSS px, facing `heading` radians, centred
 * on the current origin.  `dpr` is only used to pick the level of detail.
 */
export function drawFly(ctx, scale, heading, pose, dpr = 1, detailMode = 'auto') {
  const g = geometry();
  ctx.save();
  ctx.rotate(heading);
  // Height reads as perspective: a fly near your eye is a bigger fly.
  const persp = scale * (1 + pose.height * 0.16);
  ctx.scale(persp * pose.bodySquash, persp * (1 + (1 - pose.bodySquash) * 0.35));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const detail = detailMode === 'high' || (detailMode === 'auto' && scale * dpr >= DETAIL_PX);
  for (let i = 0; i < pose.feet.length; i++) drawLeg(ctx, i, pose.feet[i], pose.lift[i] ?? 0, detail);
  drawBody(ctx, g, pose);
  drawWings(ctx, g, pose, detail);
  for (let i = 0; i < pose.feet.length; i++) {
    if (pose.over[i]) drawLeg(ctx, i, pose.feet[i], pose.lift[i] ?? 0, detail, true);
  }
  ctx.restore();
}

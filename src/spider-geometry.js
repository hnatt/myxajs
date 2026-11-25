// The jumping spider's skeleton, shared by its behaviour and its renderer.
//
// One unit is the body length (carapace front to abdomen tip), the origin sits
// at the centre of the carapace and +X points forward.

/**
 * [coxa, restingFoot, femur, tibia, tarsus, kneeFoldSide].  Front pair, then
 * second, third and hind pairs; even index = left.  A salticid carries leg I
 * forward and leg IV back, with II and III out to the sides.  Legs I and II
 * fold their knees forward-outboard, III and IV backward-outboard, which keeps
 * neighbouring legs from crossing over one another.
 */
export const LEGS = [
  [[0.30, -0.15], [0.88, -0.55], 0.320, 0.335, 0.13, -1.0],
  [[0.30, 0.15], [0.88, 0.55], 0.320, 0.335, 0.13, 1.0],
  [[0.18, -0.19], [0.37, -0.92], 0.340, 0.355, 0.14, 1.0],
  [[0.18, 0.19], [0.37, 0.92], 0.340, 0.355, 0.14, -1.0],
  [[0.04, -0.19], [-0.26, -0.88], 0.340, 0.355, 0.14, -1.0],
  [[0.04, 0.19], [-0.26, 0.88], 0.340, 0.355, 0.14, 1.0],
  [[-0.08, -0.17], [-0.79, -0.72], 0.415, 0.435, 0.15, 1.0],
  [[-0.08, 0.17], [-0.79, 0.72], 0.415, 0.435, 0.15, -1.0],
];

/** Legs gathered in under the body, as when crouched to jump. */
export const CROUCHED = [
  [0.62, -0.42], [0.62, 0.42],
  [0.30, -0.68], [0.30, 0.68],
  [-0.18, -0.66], [-0.18, 0.66],
  [-0.60, -0.55], [-0.60, 0.55],
];

/** Height of the hips (coxae) above the page, in body lengths. */
export const HIP_HEIGHT = 0.12;
/** How high a foot is raised at the top of a step. */
export const STEP_HEIGHT = 0.14;
/** The tarsus comes down to the page at this angle from the horizontal. */
const TARSUS_PITCH = (50 * Math.PI) / 180;
/** How far a knee bows sideways off the hip-to-foot line, per unit of its
 * height.  A spider's knee bends *upwards*: seen from above, a leg is nearly
 * a straight spoke from body to foot, with only a slight curve.  Folding the
 * knee flat on the page instead (as a 2D solve does) pulls the knees of legs
 * I and II towards each other, and of III and IV, so the legs read as pairs. */
const KNEE_BOW = 0.45;

/**
 * Joints of leg `i` with its foot at `foot` (body-local x, y) raised by
 * `lift` (0..1): [hip, knee, ankle, foot], each [x, y, z] with z the height
 * above the page in body lengths.
 *
 * The leg is solved in the vertical plane through hip and foot -- femur up to
 * a raised knee, tibia down to the ankle, tarsus down to the page -- and the
 * knee then bowed a little to the side its leg naturally curves.
 */
export function legJoints(i, foot, lift = 0) {
  const [coxa, , femur, tibia, tarsus, kneeSign] = LEGS[i];
  const dx = foot[0] - coxa[0];
  const dy = foot[1] - coxa[1];
  const d = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / d;
  const uy = dy / d;
  const fz = STEP_HEIGHT * lift;
  // Ankle: back along the leg from the foot and up, along the tarsus.
  const ar = d - tarsus * Math.cos(TARSUS_PITCH);
  const az = fz + tarsus * Math.sin(TARSUS_PITCH);
  // Two-bone solve from hip (0, HIP_HEIGHT) to ankle (ar, az) in the plane,
  // taking the knee-up solution.
  const vr = ar;
  const vz = az - HIP_HEIGHT;
  const reach = Math.max(1e-5, Math.min(Math.hypot(vr, vz), (femur + tibia) * 0.995));
  const cosK = Math.max(-1, Math.min(1, (femur * femur + reach * reach - tibia * tibia) / (2 * femur * reach)));
  const base = Math.atan2(vz, vr);
  const up = base + Math.acos(cosK);
  const kr = femur * Math.cos(up);
  const kz = HIP_HEIGHT + femur * Math.sin(up);
  // Bow the knee sideways a little, the way the leg's own joints curve it.
  const bow = KNEE_BOW * (kz - HIP_HEIGHT) * kneeSign;
  const knee = [coxa[0] + ux * kr - uy * bow, coxa[1] + uy * kr + ux * bow, kz];
  const ankle = [coxa[0] + ux * ar, coxa[1] + uy * ar, az];
  return [[coxa[0], coxa[1], HIP_HEIGHT], knee, ankle, [foot[0], foot[1], fz]];
}

export function makeSpiderPose() {
  return {
    feet: LEGS.map((l) => [l[1][0], l[1][1]]),
    lift: [0, 0, 0, 0, 0, 0, 0, 0],
    palp: 0, // pedipalp waggle
    palpSplit: 0, // how far the two palps are out of step
    bite: 0, // chelicerae working, 0 = closed, 1 = spread
    height: 0, // body lengths above the surface, mid-leap
    light: [-0.6, -0.8],
  };
}

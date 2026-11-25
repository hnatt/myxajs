// The fly's skeleton, shared by its behaviour and its renderer.
//
// All geometry is in *body lengths*: one unit is the fly's head-to-abdomen-tip
// length, the origin sits at the centre of the thorax, and +X points forward.

/**
 * Attachment of each leg on the thorax, its relaxed foot placement, and the
 * lengths of femur / tibia / tarsus.  0,1 = front pair, 2,3 = middle pair,
 * 4,5 = hind pair; even = left, odd = right.
 * [coxa, restingFoot, femur, tibia, tarsus, kneeFoldSide]
 */
export const LEGS = [
  [[0.20, -0.10], [0.56, -0.40], 0.195, 0.202, 0.13, -1.0],
  [[0.20, 0.10], [0.56, 0.40], 0.195, 0.202, 0.13, 1.0],
  [[0.07, -0.13], [0.06, -0.58], 0.178, 0.185, 0.14, 1.0],
  [[0.07, 0.13], [0.06, 0.58], 0.178, 0.185, 0.14, -1.0],
  [[-0.07, -0.12], [-0.50, -0.52], 0.251, 0.260, 0.15, 1.0],
  [[-0.07, 0.12], [-0.50, 0.52], 0.251, 0.260, 0.15, -1.0],
];

/**
 * Legs drawn up under the body, the way an insect's curl when it is seized.
 * Kept above half extension: a foot folded against its own coxa leaves the
 * two-bone IK no room and the knee spikes out.
 */
export const CURLED = [
  [0.416, -0.280], [0.416, 0.280],
  [0.064, -0.400], [0.064, 0.400],
  [-0.328, -0.360], [-0.328, 0.360],
];

/**
 * Legs trailing back under the body, the way a fly carries them in the air.
 * They must not fold double, or the knee spikes out into a star.
 */
export const TUCKED = [
  [-0.02, -0.36], [-0.02, 0.36],
  [-0.18, -0.38], [-0.18, 0.38],
  [-0.44, -0.40], [-0.44, 0.40],
];

/** The two alternating tripods: front-left, middle-right and hind-left swing
 * together, then the opposite three. */
export const TRIPOD_A = [0, 3, 4];
export const TRIPOD_B = [1, 2, 5];

/** Everything the renderer needs to draw one frame of one fly. */
export function makePose(feet, lift) {
  return {
    feet: feet ?? LEGS.map((l) => [l[1][0], l[1][1]]),
    lift: lift ?? [0, 0, 0, 0, 0, 0],
    wingSpread: 0, // 0 = folded at rest, 1 = out
    wingBlur: 0, // 0 = still, 1 = beating
    wingPhase: 0,
    headYaw: 0,
    abdomenBend: 0,
    bodySquash: 1, // crouch before take-off
    height: 0, // body lengths above the surface
    light: [-0.6, -0.8], // unit vector, body-local
  };
}

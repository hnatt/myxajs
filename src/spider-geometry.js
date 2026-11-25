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

/** Spiders walk an alternating tetrapod: legs 1 and 3 of one side swing with
 * legs 2 and 4 of the other. */
export const TETRAPOD_A = [0, 4, 3, 7];
export const TETRAPOD_B = [1, 5, 2, 6];

/** Legs gathered in under the body, as when crouched to jump. */
export const CROUCHED = [
  [0.62, -0.42], [0.62, 0.42],
  [0.30, -0.68], [0.30, 0.68],
  [-0.18, -0.66], [-0.18, 0.66],
  [-0.60, -0.55], [-0.60, 0.55],
];

export function makeSpiderPose() {
  return {
    feet: LEGS.map((l) => [l[1][0], l[1][1]]),
    lift: [0, 0, 0, 0, 0, 0, 0, 0],
    palp: 0, // pedipalp waggle
    bite: 0, // chelicerae working, 0 = closed, 1 = spread
    crouch: 0, // 0 = standing, 1 = gathered to jump
    height: 0, // body lengths above the surface, mid-leap
    light: [-0.6, -0.8],
  };
}

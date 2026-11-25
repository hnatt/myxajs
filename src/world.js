// The region the animals live in.
//
// A web page has one region -- the viewport, or the host's own canvas -- in
// CSS pixels, at the CSS reference density of 96 px per inch unless told
// otherwise.  Sizes and speeds are given in millimetres and converted through
// it, so the animals are real-sized.

export const CSS_PX_PER_MM = 96 / 25.4;

export class World {
  constructor(width = 1280, height = 800, pxPerMm = CSS_PX_PER_MM) {
    this.x = 0;
    this.y = 0;
    this.width = width;
    this.height = height;
    this.pxPerMm = pxPerMm;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
  }

  contains(x, y) {
    return x >= this.x && x < this.x + this.width && y >= this.y && y < this.y + this.height;
  }

  /** Clamp a point into the region, keeping `margin` px of headroom. */
  clamp(x, y, margin = 0) {
    const m = Math.min(margin, this.width / 2 - 1, this.height / 2 - 1);
    return [
      Math.min(Math.max(x, this.x + m), this.x + this.width - m),
      Math.min(Math.max(y, this.y + m), this.y + this.height - m),
    ];
  }

  distanceTo(x, y) {
    const dx = Math.max(this.x - x, 0, x - (this.x + this.width));
    const dy = Math.max(this.y - y, 0, y - (this.y + this.height));
    return Math.hypot(dx, dy);
  }
}

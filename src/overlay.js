// The canvas the animals are drawn on.
//
// By default a transparent canvas fixed over the whole viewport, on top of
// everything, and completely intangible: `pointer-events: none` lets every
// click, scroll and drag through, it is hidden from assistive technology, and
// it has no tabindex so it can never take focus.  A host page may pass its
// own canvas instead.
//
// Only the boxes the animals occupied last frame are cleared, never the whole
// canvas: a full-viewport clear every frame would be most of the cost.

const STYLE = [
  'position:fixed',
  'inset:0',
  'width:100%',
  'height:100%',
  'margin:0',
  'padding:0',
  'border:0',
  'background:transparent',
  'pointer-events:none',
  'user-select:none',
  '-webkit-user-select:none',
  'touch-action:none',
  'contain:strict',
].join(';');

export class Overlay {
  /**
   * @param {object} opts  canvas, container, zIndex, maxDpr
   */
  constructor(opts = {}) {
    this.owned = !opts.canvas;
    this.maxDpr = opts.maxDpr ?? 2;
    let canvas = opts.canvas;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.setAttribute('style', `${STYLE};z-index:${opts.zIndex ?? 2147483647}`);
      (opts.container || document.body).appendChild(canvas);
    } else {
      canvas.style.pointerEvents = 'none';
    }
    canvas.setAttribute('aria-hidden', 'true');
    canvas.setAttribute('role', 'presentation');
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this._dirty = [];
    /** An offscreen canvas of the same size, restored into every cleared
     * box: what is drawn on it stays put under the animals. */
    this.underlay = null;
    this._onResize = () => this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(canvas);
    }
    window.addEventListener('resize', this._onResize, { passive: true });
    this.resize();
  }

  /** Match the backing store to the element's size and the device pixel
   * ratio.  Returns true if anything changed (the canvas is then blank). */
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(this.maxDpr, window.devicePixelRatio || 1);
    if (w === this.width && h === this.height && dpr === this.dpr) return false;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this._dirty = [];
    if (this.onresize) this.onresize(w, h);
    return true;
  }

  /** Where the canvas sits in the viewport, for mapping pointer coordinates.
   * A fixed overlay we created is always at the origin. */
  origin() {
    if (this.owned) return [0, 0];
    const r = this.canvas.getBoundingClientRect();
    return [r.left, r.top];
  }

  /** Clear what was drawn last frame and start a new frame in CSS pixels. */
  begin() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const [x0, y0, x1, y1] of this._dirty) {
      const ax = Math.max(0, Math.floor(x0 * dpr));
      const ay = Math.max(0, Math.floor(y0 * dpr));
      const bx = Math.min(this.canvas.width, Math.ceil(x1 * dpr));
      const by = Math.min(this.canvas.height, Math.ceil(y1 * dpr));
      if (bx <= ax || by <= ay) continue;
      ctx.clearRect(ax, ay, bx - ax, by - ay);
      if (this.underlay) ctx.drawImage(this.underlay, ax, ay, bx - ax, by - ay, ax, ay, bx - ax, by - ay);
    }
    this._dirty = [];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Note a box about to be drawn into, so the next frame clears it.
   * Returns false if it is entirely off the canvas: nothing to draw. */
  mark(x, y, r) {
    const x0 = x - r, y0 = y - r, x1 = x + r, y1 = y + r;
    if (x1 < 0 || y1 < 0 || x0 > this.width || y0 > this.height) return false;
    this._dirty.push([x0 - 1, y0 - 1, x1 + 1, y1 + 1]);
    return true;
  }

  /** Have the next frame clear this box (CSS px) and restore the underlay
   * there, after something on the underlay changed. */
  invalidate(x0, y0, x1, y1) {
    if (x1 < 0 || y1 < 0 || x0 > this.width || y0 > this.height) return;
    this._dirty.push([x0 - 1, y0 - 1, x1 + 1, y1 + 1]);
  }

  clearAll() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._dirty = [];
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
    if (this.owned) this.canvas.remove();
    else this.clearAll();
  }
}

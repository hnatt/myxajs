// Where the pointer is, without ever getting in its way.
//
// Listens on the window in the capture phase so nothing the page does can hide
// the pointer from the fly, but only ever *reads*: every listener is passive
// and none calls preventDefault or stopPropagation, so the page sees exactly
// the events it would have seen anyway.

const OPTS = { passive: true, capture: true };

export class Pointer {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.present = false;
    this._touchTimer = 0;

    this._move = (e) => {
      this.x = e.clientX;
      this.y = e.clientY;
      this.present = true;
      if (e.pointerType === 'touch' || e.pointerType === 'pen') this._lingerThenLeave();
    };
    this._leave = (e) => {
      // Leaving the document: relatedTarget is null when the pointer exits
      // the window itself rather than moving between elements.
      if (!e.relatedTarget) this.present = false;
    };
    this._gone = () => {
      this.present = false;
    };
    window.addEventListener('pointermove', this._move, OPTS);
    window.addEventListener('pointerdown', this._move, OPTS);
    document.addEventListener('pointerout', this._leave, OPTS);
    window.addEventListener('blur', this._gone, OPTS);
  }

  /** A finger lifted from the glass is no longer looming over anything. */
  _lingerThenLeave() {
    clearTimeout(this._touchTimer);
    this._touchTimer = setTimeout(() => {
      this.present = false;
    }, 600);
  }

  /** Position relative to an origin, or null when there is no pointer. */
  at(originX = 0, originY = 0) {
    return this.present ? [this.x - originX, this.y - originY] : null;
  }

  destroy() {
    clearTimeout(this._touchTimer);
    window.removeEventListener('pointermove', this._move, OPTS);
    window.removeEventListener('pointerdown', this._move, OPTS);
    document.removeEventListener('pointerout', this._leave, OPTS);
    window.removeEventListener('blur', this._gone, OPTS);
  }
}

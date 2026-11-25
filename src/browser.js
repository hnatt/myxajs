// Classic-script entry point: exposes window.Myxa, and starts by itself when
// the script tag carries `data-autostart`.  Any other data attribute is an
// option, e.g. <script src="myxa.min.js" data-autostart data-flies="2"
// data-spider="false"></script>.  The running toy is window.myxa.

import { Myxa } from './myxa.js';
import { optionsFromDataset } from './dataset.js';

const script = typeof document !== 'undefined' ? document.currentScript : null;
window.Myxa = Myxa;
if (script && script.hasAttribute('data-autostart')) {
  window.myxa = Myxa.start(optionsFromDataset(script.dataset));
}

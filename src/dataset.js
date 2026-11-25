// Options from a script tag's data attributes, for the classic-script build.

import { DEFAULTS } from './myxa.js';

function parse(value) {
  if (value === '' || value === 'true') return true;
  if (value === 'false') return false;
  if (value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** `data-fly-size-mm="10"` arrives as dataset.flySizeMm = "10" and comes out
 * as { flySizeMm: 10 }.  Unknown names are ignored. */
export function optionsFromDataset(dataset) {
  const out = {};
  for (const [key, value] of Object.entries(dataset)) {
    if (key === 'autostart') continue;
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) out[key] = parse(value);
  }
  return out;
}

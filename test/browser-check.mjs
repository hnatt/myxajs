// End-to-end check in a real browser: drives headless Chromium over the
// DevTools protocol.  Not part of `npm test`; run with `npm run check:browser`
// while `npm run demo` is serving on port 8000 (or pass a URL).
//
//   node test/browser-check.mjs [url] [screenshot.png]

import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:8000/demo/';
const shot = process.argv[3];
const chrome = process.env.CHROME || 'chromium';
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'myxa-'));
const proc = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--hide-scrollbars', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`, '--window-size=1280,800', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = list.find((t) => t.type === 'page');
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch { await sleep(100); }
}
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(JSON.stringify(msg.params.args));
});
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
  return r.result.result.value;
};
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });

const results = [];
const check = (name, ok, detail = '') => { results.push([ok, name, detail]); };

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  // Wait for the toy itself rather than a fixed time: over the network the
  // demo's modules can take a few seconds to arrive.
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    try {
      if (await evaluate(`!!(window.toy && window.toy.running && window.toy.overlay)`)) break;
    } catch { /* page still loading */ }
  }
  await sleep(300);

  // The toy's own overlay: the demo page has a canvas of its own as well.
  const canvas = await evaluate(`(() => { const c = toy.overlay.canvas;
    const s = getComputedStyle(c);
    return { pe: s.pointerEvents, pos: s.position, z: s.zIndex, aria: c.getAttribute('aria-hidden'),
             tab: c.tabIndex, w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight }; })()`);
  check('canvas is pointer-events:none', canvas.pe === 'none', JSON.stringify(canvas));
  const vp = await evaluate('[innerWidth, innerHeight]');
  check('canvas is fixed over the viewport', canvas.pos === 'fixed' && canvas.cw === vp[0] && canvas.ch === vp[1], JSON.stringify(vp));
  check('canvas is aria-hidden and not tabbable', canvas.aria === 'true' && canvas.tab < 0);

  // Park the fly on the button, still, and click through it.
  const btn = await evaluate(`(() => { const r = document.getElementById('btn').getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await evaluate(`(() => { toy.set({ spider: false, cursor: false }); const f = toy.flies[0];
    f.x = ${btn[0]}; f.y = ${btn[1]}; f.height = 0; f._enter('groom_front'); f.stateDur = 30; })()`);
  await sleep(200);
  const top = await evaluate(`document.elementFromPoint(${btn[0]}, ${btn[1]}).id`);
  check('hit-testing under the fly finds the page', top === 'btn', top);
  await mouse('mousePressed', btn[0], btn[1]);
  await mouse('mouseReleased', btn[0], btn[1]);
  await sleep(100);
  const clicks = await evaluate(`document.getElementById('clicks').textContent`);
  check('a click on the fly reaches the button', clicks.startsWith('1 click'), clicks);

  // Focus stays where the user put it.
  await evaluate(`document.getElementById('field').focus()`);
  await send('Input.insertText', { text: 'buzz' });
  await sleep(500);
  const focus = await evaluate(`[document.activeElement.id, document.getElementById('field').value]`);
  check('focus and typing are undisturbed', focus[0] === 'field' && focus[1] === 'buzz', JSON.stringify(focus));

  // Cursor fear: rest the fly in open space, then sweep the pointer at it.
  await evaluate(`(() => { toy.set({ cursor: true }); const f = toy.flies[0];
    f.x = 640; f.y = 420; f.height = 0; f._enter('idle'); f.stateDur = 30; })()`);
  await mouse('mouseMoved', 100, 420);
  await sleep(300);
  const before = await evaluate(`toy.flies[0].state`);
  for (let x = 100; x <= 600; x += 25) { await mouse('mouseMoved', x, 420); await sleep(16); }
  await sleep(100);
  const after = await evaluate(`toy.flies[0].state`);
  check('a pointer swept at the fly spooks it', before === 'idle' && after !== 'idle', `${before} -> ${after}`);

  // A parked pointer close by makes it scurry.
  await evaluate(`(() => { const f = toy.flies[0]; f.x = 900; f.y = 300; f.height = 0;
    f._cursorCd = 0; f._enter('idle'); f.stateDur = 30; })()`);
  await mouse('mouseMoved', 900 + 15 * 3.78, 300);
  await sleep(300);
  const scurry = await evaluate(`[toy.flies[0].state, toy.flies[0]._fleeT > 0 || toy.flies[0].state !== 'idle']`);
  check('a pointer parked 15 mm away makes it walk off', scurry[1], scurry[0]);

  // Droppings stay on the canvas until the pointer rubs them off.
  await evaluate(`(() => { const f = toy.flies[0]; f.x = 1100; f.y = 150; f._enter('idle'); f.stateDur = 30;
    toy.set({ cursor: false }); toy.droppings.add(300, 500, f.length); })()`);
  await sleep(150);
  const pixel = `(() => { const c = toy.overlay.canvas, d = toy.overlay.dpr;
    // The most ink in a small box: a small speck may straddle pixels.
    const px = c.getContext('2d').getImageData(Math.round(296 * d), Math.round(496 * d), Math.round(9 * d), Math.round(9 * d)).data;
    let most = 0; for (let i = 3; i < px.length; i += 4) most = Math.max(most, px[i]); return most; })()`;
  const inked = await evaluate(pixel);
  await mouse('mouseMoved', 260, 500);
  let strokes = 0;
  for (; strokes < 80 && await evaluate('toy.droppings.count'); strokes++) {
    for (let x = 260; x <= 340; x += 16) await mouse('mouseMoved', strokes % 2 ? 600 - x : x, 500);
    await sleep(20);
  }
  await sleep(100);
  const cleaned = await evaluate(pixel);
  check('a dropping shows, and scrubbing rubs it off', inked > 100 && cleaned === 0,
    `alpha ${inked} -> ${cleaned} after ${strokes} strokes`);
  await evaluate(`toy.set({ cursor: true })`);

  // Cost of a frame with everything on, measured in-page.
  await evaluate(`(() => { toy.set({ spider: true, flies: 3, cursor: true });
    // Some droppings about, so the frame cost includes restoring them.
    for (let i = 0; i < 40; i++) toy.droppings.add(40 + (i * 97) % 1200, 40 + (i * 53) % 600, 26); })()`);
  await mouse('mouseMoved', 5, 5);
  const cost = await evaluate(`new Promise((res) => {
    const t = toy, tick = t.tick.bind(t), draw = t.draw.bind(t);
    let sum = 0, n = 0, worst = 0;
    t.tick = (dt) => { const a = performance.now(); tick(dt); draw(); const d = performance.now() - a;
      sum += d; n++; worst = Math.max(worst, d); };
    t.draw = () => {};
    setTimeout(() => res({ mean: sum / n, worst, frames: n }), 3000);
  })`);
  check('mean frame cost under 2 ms (3 flies + spider)', cost.mean < 2, `${cost.mean.toFixed(3)} ms mean, ${cost.worst.toFixed(2)} ms worst over ${cost.frames} frames`);

  if (shot) {
    await evaluate(`(() => { const s = toy.spider, f = toy.flies[0];
      if (s && f) { s.x = f.x - 120; s.y = 790; } })()`);
    await sleep(100);
    const img = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(shot, Buffer.from(img.result.data, 'base64'));
  }
  const stopped = await evaluate(`(() => { const c = toy.overlay.canvas; toy.stop(); return c.isConnected; })()`);
  check('stop() removes the overlay', stopped === false, String(stopped));

  // The demo page keeps its panel settings across a reload.
  const ready = async () => {
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      try {
        if (await evaluate(`!!(window.toy && window.toy.running)`)) return;
      } catch { /* still loading */ }
    }
  };
  await send('Page.navigate', { url });
  await ready();
  await evaluate(`(() => { const f = document.getElementById('flies'); f.value = 3;
    f.dispatchEvent(new Event('input', { bubbles: true }));
    const s = document.getElementById('spider'); s.checked = false;
    s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await send('Page.navigate', { url });
  await ready();
  const kept = await evaluate(`[toy.options.flies, toy.options.spider, document.getElementById('flies').value,
    document.getElementById('spider').checked]`);
  await evaluate(`document.getElementById('defaults').click()`);
  await send('Page.navigate', { url });
  await ready();
  const reset = await evaluate(`[toy.options.flies, toy.options.spider, localStorage.getItem('myxa-demo-options')]`);
  check('the demo keeps its settings across a reload', JSON.stringify(kept) === '[3,false,"3",false]'
    && JSON.stringify(reset) === '[1,true,null]', `${JSON.stringify(kept)} then ${JSON.stringify(reset)}`);
  // The one-tag build, and respect for prefers-reduced-motion.
  const base = new URL('.', url).href;
  await send('Page.navigate', { url: `${base}script-tag.html` });
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    try {
      if (await evaluate(`!!(window.myxa && document.querySelector('canvas'))`)) break;
    } catch { /* page still loading */ }
  }
  const tag = await evaluate(`[typeof Myxa, myxa.running, myxa.flies.length, document.querySelectorAll('canvas').length]`);
  check('the script tag autostarts with data-attribute options', tag[0] === 'function' && tag[1] && tag[2] === 2 && tag[3] === 1, JSON.stringify(tag));
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.reload');
  await sleep(1200);
  const calm = await evaluate(`[myxa.running, myxa.reducedMotion, document.querySelectorAll('canvas').length]`);
  check('prefers-reduced-motion keeps it from starting', !calm[0] && calm[1] && calm[2] === 0, JSON.stringify(calm));

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  ws.close();
  proc.kill();
}

let failed = 0;
for (const [ok, name, detail] of results) {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
process.exit(failed ? 1 : 0);

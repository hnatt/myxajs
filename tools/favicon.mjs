// Render tools/favicon.html in headless Chromium and save the icons to demo/.
//
//   npm run demo &   # serving the repo on :8000
//   node tools/favicon.mjs [http://127.0.0.1:8000/tools/favicon.html]

import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] || 'http://127.0.0.1:8000/tools/favicon.html';
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo');
const port = 9850 + Math.floor(Math.random() * 100);
const proc = spawn(process.env.CHROME || 'chromium', [
  '--headless=new', '--no-sandbox', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'myxa-'))}`,
  `--remote-debugging-port=${port}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let ws;
  for (let i = 0; i < 50 && !ws; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch { await sleep(100); }
  }
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
  });
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Page.navigate', { url });
  let icons = null;
  for (let i = 0; i < 100 && !icons; i++) {
    await sleep(100);
    const r = await send('Runtime.evaluate', { expression: 'window.ICONS', returnByValue: true });
    icons = r.result?.result?.value;
  }
  if (!icons) throw new Error('the icon page never finished drawing');
  const names = { 16: 'favicon-16.png', 32: 'favicon-32.png', 64: 'favicon-64.png', 180: 'apple-touch-icon.png' };
  for (const [size, data] of Object.entries(icons)) {
    writeFileSync(join(out, names[size]), Buffer.from(data.split(',')[1], 'base64'));
    console.log(`demo/${names[size]}`);
  }
  ws.close();
} finally {
  proc.kill();
}

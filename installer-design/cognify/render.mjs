// Merender dmg.html, sidebar.html, header.html menjadi PNG lewat Brave tanpa jendela, lalu BMP untuk installer Windows.
//   node installer-design/cognify/render.mjs
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const JOBS = [['dmg', 1320, 800], ['sidebar', 328, 628], ['header', 300, 114], ['splash', 600, 400]];
const PORT = 9500 + Math.floor(Math.random() * 300);
const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'inst-brave-'));
const browser = spawn(BRAVE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--force-device-scale-factor=1', '--allow-file-access-from-files', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res, rej) => { const n = ++id; pending.set(n, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result))); ws.send(JSON.stringify({ id: n, method, params })); });
try {
  for (const [name, w, h] of JOBS) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: pathToFileURL(join(here, `${name}.html`)).href });
    await sleep(900);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
    writeFileSync(join(here, `${name}.png`), Buffer.from(data, 'base64'));
  }
  // Installer Windows (NSIS): sidebar 164x314 dan header 150x57, BMP 24-bit.
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(here, 'sidebar.png'), '-vf', 'scale=164:314:flags=lanczos', '-pix_fmt', 'bgr24', join(here, 'sidebar.bmp')]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(here, 'header.png'), '-vf', 'scale=150:57:flags=lanczos', '-pix_fmt', 'bgr24', join(here, 'header.bmp')]);
  console.log('ok');
} finally { ws.close(); browser.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true }); }

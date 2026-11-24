// Headless screenshots of the digital twin (uses the installed Microsoft Edge, GPU on).
//   node tools/screenshot.mjs <url> <outDir> [script.json]
// script.json = [{ "name": "overview", "js": "app.cameraPreset('overview', 0.01)", "wait": 1500 }, ...]
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [url = 'http://127.0.0.1:5288/', outDir = 'shots', scriptPath] = process.argv.slice(2);
const W = +(process.env.W ?? 1920), H = +(process.env.H ?? 1080);
mkdirSync(outDir, { recursive: true });
const steps = scriptPath ? JSON.parse(readFileSync(scriptPath, 'utf8')) : [{ name: 'default', wait: 2500 }];

const browser = await chromium.launch({
  channel: 'msedge',
  headless: process.env.HEADED ? false : true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', `--window-size=${W},${H}`],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: +(process.env.DPR ?? 1) });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.__ready === true, null, { timeout: +(process.env.READY_MS ?? 60000) });
} catch (e) {
  console.log('NOT READY:', e.message.split(String.fromCharCode(10))[0]);
  console.log(logs.slice(0, 30).join(String.fromCharCode(10)));
  await browser.close();
  process.exit(2);
}
await page.waitForTimeout(+(process.env.SETTLE ?? 2500));
const info = await page.evaluate(() => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a', bench: window.__twin?.benchMs, quality: window.__twin?.state.quality };
});
console.log('GPU:', info.renderer, '| RF kernel ms:', info.bench?.toFixed?.(1), '| quality:', info.quality);
for (const s of steps) {
  if (s.js) await page.evaluate(`(async () => { const app = window.__twin; ${s.js} })()`);
  await page.waitForTimeout(s.wait ?? 1500);
  const file = resolve(outDir, `${s.name}.png`);
  await page.screenshot({ path: file });
  console.log('saved', file);
}
if (process.env.STATS) console.log(JSON.stringify(await page.evaluate(() => ({ stats: window.__twin.stats, base: window.__twin.baseStats, ev: { rss: window.__twin.ev?.rss, margin: window.__twin.ev?.eav.margin } })), null, 1));
await browser.close();
const errs = logs.filter((l) => /error|warn/i.test(l));
if (errs.length) console.log('--- console ---\n' + errs.slice(0, 40).join('\n'));

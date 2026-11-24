// UI smoke test: clicks every control with real mouse events, drags the attacker and an AP,
// uses the keyboard, and reports console errors.   node tools/ui_qa.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://127.0.0.1:5288/?lang=en&quality=high';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
await page.waitForTimeout(1200);
const log = [];
const step = async (name, fn) => { try { await fn(); await page.waitForTimeout(350); log.push('ok   ' + name); } catch (e) { log.push('FAIL ' + name + ' — ' + e.message.split('\n')[0]); } };
const state = () => page.evaluate(() => ({ ...window.__twin.state, layers: undefined }));

for (const m of ['signal', 'sionna', 'diff', 'attack']) await step('mode ' + m, () => page.click(`#seg-mode button[data-mode="${m}"]`));
for (const f of ['0', '1', '2', 'explode', 'explode', 'all']) await step('floor ' + f, () => page.click(`#seg-floor button[data-floor="${f}"]`));
await step('open AP / attacker / layers sections', async () => { for (const s of ['ap', 'attacker', 'layers']) await page.click(`section[data-sec="${s}"] .sec-h`); });
for (const p of ['lowPower', 'directional', 'relocate', 'microcells', 'shieldWindows', 'shieldPaint', 'band5', 'pmf', 'wpa3']) {
  await step('protection on  ' + p, () => page.click(`[data-prot="${p}"]`));
  await step('protection off ' + p, () => page.click(`[data-prot="${p}"]`));
}
await step('optimize power', () => page.click('[data-act="optimize"]'));
await step('band chips', async () => { await page.click('[data-group="freq"] .chip[data-v="5"]'); await page.click('[data-group="freq"] .chip[data-v="2.4"]'); });
await step('antenna chips', async () => { await page.click('[data-group="antenna"] .chip[data-v="patch"]'); await page.click('[data-group="antenna"] .chip[data-v="dipole"]'); });
await step('mount chips', async () => { for (const v of ['ceiling', 'micro', 'wall']) await page.click(`[data-group="mount"] .chip[data-v="${v}"]`); });
await step('tx slider', async () => { const s = page.locator('[data-input="txDbm"]'); await s.fill('15'); await s.dispatchEvent('change'); });
for (const e of ['phone', 'yagi', 'usb']) await step('equipment ' + e, () => page.click(`[data-eq="${e}"]`));
for (const sp of ['goParking', 'goLawn', 'goSide', 'goCafe']) await step('spot ' + sp, () => page.click(`[data-spot="${sp}"]`));
for (const l of ['zones', 'indoor', 'contours', 'ghost', 'rays', 'waves', 'labels']) { await step('layer off ' + l, () => page.click(`[data-layer="${l}"]`)); await step('layer on  ' + l, () => page.click(`[data-layer="${l}"]`)); }
await step('cut slider', async () => { const s = page.locator('[data-input="cut"]'); await s.fill('2.4'); });
for (const q of ['low', 'ultra', 'high']) await step('quality ' + q, () => page.click(`[data-group="quality"] .chip[data-v="${q}"]`));
await step('apply all', async () => { await page.click('[data-act="apply"]'); await page.waitForTimeout(6000); });
await step('reset', () => page.click('[data-act="reset"]'));
for (const c of ['overview', 'top', 'street', 'floor', 'follow', 'overview']) await step('camera ' + c, async () => { await page.click('#btn-cam'); await page.click(`#cam-pop button[data-cam="${c}"]`); await page.waitForTimeout(900); });
await step('mood x3', async () => { for (let i = 0; i < 3; i++) await page.click('#btn-mood'); });
await step('language ar', () => page.click('#btn-lang'));
await step('about open/close (ar)', async () => { await page.click('#btn-about'); await page.click('#about [data-close]'); });
await step('language en', () => page.click('#btn-lang'));
await step('keyboard 1-4, M, H, H', async () => { for (const k of ['1', '2', '3', '4', 'm', 'h', 'h', '1']) await page.keyboard.press(k); });

// drag the attacker (screen position from the 3-D scene)
await step('drag attacker', async () => {
  await page.evaluate(() => window.__twin.cameraPreset('top', 0.01));
  await page.waitForTimeout(600);
  const p = await page.evaluate(() => { const a = window.__twin.attacker.group.position.clone(); a.y += 1.5; a.project(window.__twin.world.camera); const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.left + (a.x + 1) / 2 * r.width, y: r.top + (1 - a.y) / 2 * r.height }; });
  const before = await page.evaluate(() => [...window.__twin.attacker.pos]);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 80, p.y - 60, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => [...window.__twin.attacker.pos]);
  if (Math.hypot(after[0] - before[0], after[1] - before[1]) < 1) throw new Error('attacker did not move');
  log.push(`     attacker ${before.map((v) => v.toFixed(1))} → ${after.map((v) => v.toFixed(1))}`);
});
await step('drag AP', async () => {
  const p = await page.evaluate(() => { const r0 = window.__twin.routers[0]; const a = r0.group.getWorldPosition(r0.group.position.clone()); a.project(window.__twin.world.camera); const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.left + (a.x + 1) / 2 * r.width, y: r.top + (1 - a.y) / 2 * r.height }; });
  const before = await page.evaluate(() => [...window.__twin.rf.pos]);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 60, p.y + 40, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(800);
  const st = await state();
  const after = await page.evaluate(() => [...window.__twin.rf.pos]);
  if (st.mount !== 'custom') throw new Error('AP drag did not set custom mount');
  log.push(`     AP ${before.map((v) => v.toFixed(1))} → ${after.map((v) => v.toFixed(1))}`);
});
await step('double-click walk', async () => { await page.mouse.dblclick(500, 500); await page.waitForTimeout(800); });
await step('WASD', async () => { await page.keyboard.down('w'); await page.waitForTimeout(500); await page.keyboard.up('w'); });
await step('tour T + arrows + Esc', async () => { await page.keyboard.press('t'); await page.waitForTimeout(800); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(800); await page.keyboard.press('Escape'); });
await step('mobile viewport', async () => { await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(800); await page.screenshot({ path: process.env.SHOT ?? 'qa_mobile.png' }); await page.setViewportSize({ width: 1600, height: 900 }); });

console.log(log.join('\n'));
console.log('errors:', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();

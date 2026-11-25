// Drives the running dev server headlessly and records
//   • the KPIs of every protection scenario as computed by the web app (GPU real-time model)
//   • verification: JS model vs Python reference links, GPU field vs CPU model
// → sim/out/app_stats.json
//   npm run dev   (in another terminal)   then   node tools/measure.mjs [url]
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://127.0.0.1:5288/?lang=en&quality=high&view=expert';
const out = fileURLToPath(new URL('../../sim/out/app_stats.json', import.meta.url));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
await page.waitForTimeout(1500);

const result = await page.evaluate(async () => {
  const app = window.__twin;
  const M = await import('/src/rf/model.js');
  const D = await import('/src/data.js');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const res = { generated: new Date().toISOString(), gpu: null, scenarios: {}, verification: {} };
  const gl = document.querySelector('canvas').getContext('webgl2');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  res.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a';
  res.grid = { outdoor_cell_m: app.field.go.cell, floor_cell_m: app.field.gf.cell, outdoor_cells: app.field.go.nx * app.field.go.ny, floor_cells: app.field.gf.nx * app.field.gf.ny * 3 };

  // ── scenario KPIs ──
  const pack = (s) => ({ area_eavesdrop: Math.round(s.areaE), area_deauth: Math.round(s.areaD), area_eviltwin: Math.round(s.areaT), area_danger: Math.round(s.areaU), max_leak_m: +s.maxLeak.toFixed(1), leak_reaches_edge: s.edge, street_exposure: +s.street.toFixed(2), coverage: +s.coverage.toFixed(2), tx_dbm: app.state.txDbm, freq_ghz: app.state.freq });
  const run = async (key, fn) => { app.resetAll(true); if (fn) fn(); await sleep(250); await app.flushStats(); res.scenarios[key] = pack(app.stats); };
  await run('baseline');
  for (const k of ['lowPower', 'directional', 'relocate', 'microcells', 'shieldWindows', 'shieldPaint', 'band5']) await run(k, () => app.toggleProtection(k, true));
  await run('allRF', () => ['relocate', 'shieldWindows', 'shieldPaint', 'band5'].forEach((k) => app.toggleProtection(k, true)));
  app.resetAll(true);
  await app.applyAll();
  await sleep(400);
  await app.flushStats();
  res.scenarios.applyAll = pack(app.stats);
  res.scenarios.applyAll.pmf = app.state.pmf; res.scenarios.applyAll.wpa3 = app.state.wpa3;

  // ── link budget at the café (baseline) ──
  app.resetAll(true); await sleep(250); await app.flushStats();
  const ev = app.ev;
  res.link = { d_m: +ev.d.toFixed(2), path_loss_distance_db: +ev.spread.toFixed(2), gain_tx_dbi: +ev.gTx.toFixed(2), walls: ev.walls.map((w) => [w.mat, w.loss]), rss_dbm: +ev.rss.toFixed(2), margin_db: +ev.eav.margin.toFixed(2), deauth_devices: ev.deauth.count, hijack_floor_pct: +(app.hijack ?? 0).toFixed(2) };

  return res;
});

// JS vs Python links (fetched by Node, evaluated in the page)
const tp = JSON.parse((await import('node:fs')).readFileSync(fileURLToPath(new URL('../../sim/out/mwm_testpoints.json', import.meta.url)), 'utf8'));
result.verification = await page.evaluate(async ({ links, other, prots }) => {
  const app = window.__twin;
  const M = await import('/src/rf/model.js');
  const D = await import('/src/data.js');
  let maxErr = 0, n = 0, skipped = 0;
  for (const L of links) {
    if (L.rss_dbm == null) { skipped++; continue; }
    const s = { freq: L.freq_ghz, txDbm: L.tx_dbm, antenna: L.antenna === 'patch' ? 'patch' : 'dipole', mount: 'wall', shieldWindows: false, shieldPaint: false, aps: [L.tx_pos] };
    const rf = M.rfParams(s);
    const rss = L.tx === 'AP' ? M.rssFromAP(L.rx_pos, rf) : L.tx_dbm + (L.gain_tx_dbi || 0) - M.pathLoss(L.tx_pos, L.rx_pos, rf);
    maxErr = Math.max(maxErr, Math.abs(rss - L.rss_dbm)); n++;
  }
  // links of the protection scenarios (one AP per link; mount found from the AP position)
  const same = (a, b) => a && b && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  const mountOf = (pos) => Object.keys(D.B.router.mounts).find((k) => { const m = D.B.router.mounts[k]; return same(m.pos, pos) || (m.positions ?? []).some((q) => same(q, pos)); }) ?? 'wall';
  let maxErr2 = 0, n2 = 0, multiAp = 0, nMulti = 0; const perScenario = {};
  for (const L of other) {
    if (L.rss_dbm == null) continue;
    const prot = prots[L.scenario] ?? [];
    const s = { freq: L.freq_ghz, txDbm: L.tx_dbm, antenna: L.antenna === 'patch' ? 'patch' : 'dipole', mount: mountOf(L.tx_pos),
      az: L.antenna_az_deg ?? undefined, tilt: L.antenna_tilt_deg ?? undefined,
      shieldWindows: prot.includes('shieldWindows'), shieldPaint: prot.includes('shieldPaint'), aps: [L.tx_pos] };
    const rss = M.rssFromAP(L.rx_pos, M.rfParams(s));
    const e = Math.abs(rss - L.rss_dbm);
    maxErr2 = Math.max(maxErr2, e); n2++;
    perScenario[L.scenario] = Math.max(perScenario[L.scenario] ?? 0, +e.toFixed(6));
    if (L.rss_max_over_aps_dbm != null) {   // multi-AP: RSS = max over all APs of the scenario
      const aps = other.filter((o) => o.scenario === L.scenario && o.rx === L.rx && same(o.rx_pos, L.rx_pos)).map((o) => o.tx_pos);
      const rm = M.rssFromAP(L.rx_pos, M.rfParams({ ...s, aps }));
      multiAp = Math.max(multiAp, Math.abs(rm - L.rss_max_over_aps_dbm)); nMulti++;
    }
  }
  // GPU vs CPU
  app.resetAll(true);
  await new Promise((r) => setTimeout(r, 300));
  await app.flushStats();
  const f = app.field, go = f.go, gf = f.gf, rf = app.rf, eq = M.equipment(app.state.equipment), cr = M.clientRss(rf);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let e0 = 0, e1 = 0, e2 = 0;
  for (let t = 0; t < 5000; t++) {
    const i = Math.floor(rnd() * go.nx), j = Math.floor(rnd() * go.ny);
    const p = [go.x0 + (i + 0.5) * go.cell, go.y0 + (j + 0.5) * go.cell, go.z];
    const k = (j * go.nx + i) * 4;
    let de = -1e4, et = -1e4;
    D.CLIENTS.forEach((c, ci) => { const sA = eq.tx_dbm + eq.gain_dbi - M.pathLoss(c.pos, p, rf); de = Math.max(de, sA - D.B.attack.client.sens_dbm); et = Math.max(et, Math.min(sA - cr[ci] - D.B.attack.evil_twin.margin_db, sA - D.B.attack.evil_twin.min_rss_dbm)); });
    e0 = Math.max(e0, Math.abs(f.bufOut[k] - M.rssFromAP(p, rf))); e1 = Math.max(e1, Math.abs(f.bufOut[k + 1] - de)); e2 = Math.max(e2, Math.abs(f.bufOut[k + 2] - et));
  }
  let bad = 0, tot = 0;
  for (let fl = 0; fl < 3; fl++) for (let j = 0; j < gf.ny; j++) for (let i = 0; i < gf.nx; i++) {
    const p = [gf.x0 + (i + 0.5) * gf.cell, gf.y0 + (j + 0.5) * gf.cell, gf.zs[fl]];
    const k = ((fl * gf.ny + j) * gf.nx + i) * 4;
    tot++; if (Math.abs(f.bufFlo[k] - M.rssFromAP(p, rf)) > 0.01) bad++;
  }
  return {
    js_vs_python: { links: n, skipped_pathloss_only: skipped, max_abs_diff_db: +maxErr.toFixed(6) },
    js_vs_python_protections: { links: n2, max_abs_diff_db: +maxErr2.toFixed(6), per_scenario: perScenario, multi_ap_links: nMulti, multi_ap_max_abs_diff_db: +multiAp.toFixed(6) },
    gpu_vs_cpu_outdoor: { cells: 5000, max_abs_diff_rss_db: +e0.toFixed(4), max_abs_diff_deauth_db: +e1.toFixed(4), max_abs_diff_eviltwin_db: +e2.toFixed(4) },
    gpu_vs_cpu_floors: { cells: tot, differing_over_0_01_db: bad },
  };
}, { links: tp.links, other: tp.links_other_scenarios ?? [], prots: tp.scenario_protections ?? {} });

// timing of the RF kernel (warm)
result.timing_ms = await page.evaluate(() => {
  const app = window.__twin;
  const ts = [];
  for (let i = 0; i < 5; i++) ts.push(app.field.benchmark(app.rf, app.state, app.attacker.pos));
  ts.sort((a, b) => a - b);
  return +ts[2].toFixed(1);
});
result.page_errors = errors;
writeFileSync(out, JSON.stringify(result, null, 1));
console.log('wrote', out);
console.log(JSON.stringify({ applyAll: result.scenarios.applyAll, verification: result.verification, timing_ms: result.timing_ms, errors }, null, 1));
await browser.close();

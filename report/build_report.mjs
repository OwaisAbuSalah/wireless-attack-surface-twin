// Builds the written report from the project's result files → report/report.html + docs/REPORT.pdf
//   node report/build_report.mjs            (needs Microsoft Edge for the PDF step)
// Every number in the report is read from: data/building.json, sim/out/app_stats.json (web app),
// sim/out/*_stats.csv + compare_metrics.csv (Python reference model and NVIDIA Sionna RT).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const J = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const csv = (p) => {
  if (!existsSync(join(ROOT, p))) return [];
  const [head, ...rows] = readFileSync(join(ROOT, p), 'utf8').trim().split(/\r?\n/);
  const h = head.split(',');
  return rows.map((r) => Object.fromEntries(r.split(',').map((v, i) => [h[i], isNaN(+v) || v === '' ? v : +v])));
};

const B = J('data/building.json');
const APP = J('sim/out/app_stats.json');
const NUM = J('presentation/numbers.json');
const SION = existsSync(join(ROOT, 'web/src/data/sionna.json')) ? J('web/src/data/sionna.json') : null;
const SST = csv('sim/out/sionna_stats.csv');
const MST = csv('sim/out/mwm_stats.csv');
const CMP = csv('sim/out/compare_metrics.csv');

const S = APP.scenarios;
const fmt = (x, d = 0) => (x == null || Number.isNaN(x) ? '–' : Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (a, b) => `${a <= b ? '−' : '+'}${Math.abs(Math.round((1 - a / b) * 100))} %`;
const leak = (s) => (s.leak_reaches_edge ? '> 100 m' : `${fmt(s.max_leak_m, 1)} m`);
const base = S.baseline, fin = S.applyAll;
const label = (k) => B.scenarios[k]?.label.en ?? ({ microcells: 'Two ceiling micro-cells', applyAll: '“Apply protection” (all combined)' }[k] ?? k);
const mats = Object.entries(B.materials).filter(([k]) => k !== 'air');

// ───────────────────────── inline SVG charts ─────────────────────────
function barChart(rows, { w = 640, h = 300, max, unit = '', color = '#d94a5a', hl = '#2a9d6f', title = '' }) {
  const L = 210, R = 70, T = 30, bh = (h - T - 10) / rows.length;
  const m = max ?? Math.max(...rows.map((r) => r[1]));
  const bars = rows.map(([name, v, c], i) => {
    const y = T + i * bh, bw = ((w - L - R) * v) / m;
    return `<text x="${L - 8}" y="${y + bh * 0.62}" text-anchor="end" font-size="11" fill="#333">${name}</text>
      <rect x="${L}" y="${y + bh * 0.18}" width="${Math.max(bw, 1.5)}" height="${bh * 0.64}" rx="2" fill="${c ?? color}"/>
      <text x="${L + bw + 5}" y="${y + bh * 0.62}" font-size="11" fill="#222">${fmt(v, unit === '%' ? 1 : 0)}${unit}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI, Calibri, sans-serif">
    <text x="${L}" y="16" font-size="12" font-weight="600" fill="#111">${title}</text>${bars}</svg>`;
}

const archSvg = `<svg viewBox="0 0 700 250" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI, Calibri, sans-serif">
  <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#667"/></marker></defs>
  <rect x="10" y="85" width="150" height="80" rx="10" fill="#eef6fb" stroke="#2b7bb9"/>
  <text x="85" y="115" text-anchor="middle" font-size="14" font-weight="700" fill="#134">building.json</text>
  <text x="85" y="135" text-anchor="middle" font-size="10.5" fill="#345">165 walls · 11 materials</text>
  <text x="85" y="150" text-anchor="middle" font-size="10.5" fill="#345">AP mounts · clients · scenarios</text>
  ${[['Blender 5.2', '3-D model, Cycles renders', '#f6efe6', '#b9772b', 20], ['NVIDIA Sionna RT 2.2', 'ray tracing — physics reference', '#f3edf9', '#7a4bb3', 95], ['Three.js + GLSL', 'real-time model, interactive twin', '#e9f8f7', '#1d968f', 170]].map(([t, d, f, s, y]) => `
  <line x1="160" y1="125" x2="250" y2="${y + 30}" stroke="#667" stroke-width="1.5" marker-end="url(#ar)"/>
  <rect x="255" y="${y}" width="210" height="60" rx="10" fill="${f}" stroke="${s}"/>
  <text x="360" y="${y + 26}" text-anchor="middle" font-size="13" font-weight="700" fill="#222">${t}</text>
  <text x="360" y="${y + 45}" text-anchor="middle" font-size="10.5" fill="#444">${d}</text>`).join('')}
  ${[['renders (slides, report)', 50], ['validation + calibration', 125], ['live twin (GitHub Pages)', 200]].map(([t, y]) => `
  <line x1="465" y1="${y}" x2="525" y2="${y}" stroke="#667" stroke-width="1.5" marker-end="url(#ar)"/>
  <rect x="530" y="${y - 18}" width="160" height="36" rx="8" fill="#fff" stroke="#99a"/>
  <text x="610" y="${y + 4}" text-anchor="middle" font-size="11" fill="#222">${t}</text>`).join('')}
</svg>`;

// ───────────────────────── tables ─────────────────────────
const appOrder = ['baseline', 'lowPower', 'directional', 'relocate', 'microcells', 'shieldWindows', 'shieldPaint', 'band5', 'allRF', 'applyAll'];
const appTable = `<table class="wide"><thead><tr><th>Configuration</th><th>TX</th><th>Band</th><th>Danger zone</th><th>Δ</th><th>Evil Twin zone</th><th>Street exp.</th><th>Max leak</th><th>Coverage</th></tr></thead><tbody>
${appOrder.filter((k) => S[k]).map((k) => { const s = S[k]; return `<tr class="${k === 'applyAll' ? 'hl' : ''}"><td>${label(k)}</td><td>${s.tx_dbm} dBm</td><td>${s.freq_ghz} GHz</td><td>${fmt(s.area_danger)} m²</td><td>${k === 'baseline' ? '' : pct(s.area_danger, base.area_danger)}</td><td>${fmt(s.area_eviltwin)} m²</td><td>${fmt(s.street_exposure, 1)} %</td><td>${leak(s)}</td><td>${fmt(s.coverage, 1)} %</td></tr>`; }).join('')}
</tbody></table>`;

const matTable = `<table class="narrow"><thead><tr><th>Material</th><th>Thickness</th><th>ITU-R P.2040 type</th><th>Loss 2.4 GHz</th><th>Loss 5 GHz</th></tr></thead><tbody>
${mats.map(([, m]) => `<tr><td>${m.name.en}</td><td>${m.t ? fmt(m.t * 100, 1) + ' cm' : '–'}</td><td>${m.itu ?? '–'}</td><td>${m.loss['2.4']} dB</td><td>${m.loss['5']} dB</td></tr>`).join('')}
</tbody></table>`;

const eqTable = `<table class="narrow"><thead><tr><th>Attacker equipment</th><th>Antenna gain</th><th>Sensitivity</th><th>TX power</th></tr></thead><tbody>
${Object.values(B.attack.equipment).map((e) => `<tr><td>${e.name.en}</td><td>${e.gain_dbi} dBi</td><td>${e.sens_dbm} dBm</td><td>${e.tx_dbm} dBm</td></tr>`).join('')}
</tbody></table>`;

const L = APP.link;
const sB = SST.find((r) => r.scenario === 'baseline'), sA = SST.find((r) => r.scenario === 'applied');
const rtLine = sB && sA ? `Ray-traced with Sionna RT, the same configuration leaves ${fmt(sA.area_eavesdrop)} m² (${pct(sA.area_eavesdrop, sB.area_eavesdrop)} relative to the ray-traced baseline) and ${fmt(sA.street_exposure, 0)} % of the street exposed` : '';
const linkTable = `<table class="narrow"><tbody>
<tr><td>AP transmit power</td><td class="r">+20.0 dBm</td></tr>
<tr><td>AP antenna gain towards the attacker (half-wave dipole)</td><td class="r">+${fmt(L.gain_tx_dbi, 2)} dBi</td></tr>
<tr><td>Free-space path loss over ${fmt(L.d_m, 1)} m</td><td class="r">−${fmt(L.path_loss_distance_db, 2)} dB</td></tr>
${L.walls.map(([m, l]) => `<tr><td>${B.materials[m].name.en}</td><td class="r">−${fmt(l, 1)} dB</td></tr>`).join('')}
<tr><td>Attacker antenna (USB adapter)</td><td class="r">+5.0 dBi</td></tr>
<tr class="hl"><td>Received power</td><td class="r">${fmt(L.rss_dbm, 1)} dBm</td></tr>
<tr><td>Adapter sensitivity</td><td class="r">−92.0 dBm</td></tr>
<tr class="hl"><td>Eavesdropping margin</td><td class="r">+${fmt(L.margin_db, 1)} dB</td></tr>
</tbody></table>`;

// Sionna vs MWM (1 m grid)
const scenKeys = Object.keys(B.scenarios);
const pick = (rows, k, model) => rows.find((r) => r.scenario === k && (model ? r.grid === model : true));
const svm = `<table><thead><tr><th rowspan="2">Scenario</th><th colspan="3">Eavesdropping zone [m²]</th><th colspan="2">Street exposure [%]</th><th colspan="2">Coverage [%]</th></tr>
<tr><th>MWM</th><th>Sionna RT</th><th>Sionna Δ vs baseline</th><th>MWM</th><th>Sionna</th><th>MWM</th><th>Sionna</th></tr></thead><tbody>
${scenKeys.map((k) => { const m = pick(MST, k, 'sionna'), s = pick(SST, k); const sb = pick(SST, 'baseline'); if (!m && !s) return ''; return `<tr><td>${label(k)}</td><td>${fmt(m?.area_eavesdrop)}</td><td>${fmt(s?.area_eavesdrop)}</td><td>${s && sb && k !== 'baseline' ? pct(s.area_eavesdrop, sb.area_eavesdrop) : ''}</td><td>${fmt(m?.street_exposure, 1)}</td><td>${fmt(s?.street_exposure, 1)}</td><td>${fmt(m?.coverage, 1)}</td><td>${fmt(s?.coverage, 1)}</td></tr>`; }).join('')}
</tbody></table>`;

const planes = [...new Set(CMP.map((r) => r.plane))];
const nominal = CMP.filter((r) => r.mwm === 'nominal');
const metTable = `<table><thead><tr><th>Scenario</th>${planes.map((p) => `<th>${p} RMSE / bias</th>`).join('')}</tr></thead><tbody>
${[...new Set(nominal.map((r) => r.scenario))].map((k) => `<tr><td>${label(k)}</td>${planes.map((p) => { const r = nominal.find((x) => x.scenario === k && x.plane === p); return `<td>${r ? `${fmt(r.rmse, 1)} / ${fmt(r.bias, 1)} dB` : '–'}</td>`; }).join('')}</tr>`).join('')}
</tbody></table>`;
const baseOut = nominal.find((r) => r.scenario === 'baseline' && r.plane === 'outdoor');
const baseFloors = nominal.filter((r) => r.scenario === 'baseline' && /^floor/.test(r.plane));
const floorsRmse = baseFloors.length ? Math.sqrt(baseFloors.reduce((a, r) => a + r.rmse * r.rmse * r.n, 0) / baseFloors.reduce((a, r) => a + r.n, 0)) : null;

const chart1 = barChart(appOrder.filter((k) => S[k] && k !== 'allRF').map((k) => [label(k).replace('“Apply protection” (all combined)', 'All combined (applied)'), S[k].area_danger, k === 'baseline' ? '#8a93a3' : k === 'applyAll' ? '#2a9d6f' : '#d94a5a']), { title: 'Danger zone outside the building (m²)', h: 300 });
const chart2 = barChart(appOrder.filter((k) => S[k] && k !== 'allRF').map((k) => [label(k).replace('“Apply protection” (all combined)', 'All combined (applied)'), S[k].coverage, S[k].coverage >= 95 ? '#2a9d6f' : S[k].coverage >= 85 ? '#d8a31a' : '#e07b22']), { title: 'Indoor coverage ≥ −67 dBm (%)', h: 300, max: 100, unit: '%' });

const st = SION?.settings ?? {};
const V = APP.verification;

// ───────────────────────── document ─────────────────────────
const fig = (src, cap, n, cls = '') => `<figure class="${cls}"><img src="${src}"><figcaption><b>Figure ${n}.</b> ${cap}</figcaption></figure>`;
let F = 0;
const f = (src, cap, cls) => fig(src, cap, ++F, cls);

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Wireless Attack Surface Digital Twin — Report</title>
<style>
@page { size: A4; margin: 18mm 17mm 20mm 17mm; }
* { box-sizing: border-box; }
body { font-family: Cambria, Georgia, serif; font-size: 10.6pt; line-height: 1.5; color: #1b1f24; margin: 0; }
h1, h2, h3, .sans { font-family: "Segoe UI", Calibri, Arial, sans-serif; }
h2 { font-size: 15pt; margin: 22px 0 8px; color: #0f3550; border-bottom: 1.5px solid #cfdbe6; padding-bottom: 4px; break-after: avoid; }
h3 { font-size: 12pt; margin: 16px 0 6px; color: #17486c; break-after: avoid; }
p { margin: 0 0 8px; text-align: justify; hyphens: auto; }
ul, ol { margin: 4px 0 10px 18px; padding: 0; }
li { margin: 2px 0; }
figure { margin: 10px 0 14px; break-inside: avoid; text-align: center; }
figure img { width: 100%; border-radius: 4px; border: 1px solid #d9dee5; }
figure.half img { width: 78%; }
figcaption { font-size: 9.2pt; color: #444; margin-top: 4px; text-align: left; }
table { width: 100%; border-collapse: collapse; font-family: "Segoe UI", Calibri, sans-serif; font-size: 8.9pt; margin: 6px 0 12px; break-inside: avoid; }
th { background: #eaf1f7; color: #0f3550; font-weight: 600; text-align: left; padding: 4px 6px; border-bottom: 1px solid #b9cbdb; }
td { padding: 3.5px 6px; border-bottom: 1px solid #e3e8ee; vertical-align: top; }
td.r { text-align: right; font-family: Consolas, monospace; white-space: nowrap; }
td { font-variant-numeric: tabular-nums; }
.two table.narrow { width: 100%; }
table.wide td:not(:first-child) { white-space: nowrap; }
tr.hl td { background: #eef8f3; font-weight: 600; }
table.narrow { width: 80%; }
.eq { font-family: "Cambria Math", Cambria, serif; background: #f5f8fb; border-left: 3px solid #2b7bb9; padding: 8px 12px; margin: 8px 0 10px; font-size: 11pt; break-inside: avoid; }
.eq small { display: block; font-family: Cambria, serif; font-size: 9.2pt; color: #555; margin-top: 2px; }
.box { background: #f7f9fb; border: 1px solid #dde5ee; border-radius: 6px; padding: 8px 12px; margin: 8px 0 12px; break-inside: avoid; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 8px 0 14px; break-inside: avoid; }
.kpi { border: 1px solid #dbe3ec; border-radius: 6px; padding: 7px 9px; font-family: "Segoe UI", Calibri, sans-serif; }
.kpi b { display: block; font-size: 15pt; color: #0f3550; }
.kpi span { font-size: 8.5pt; color: #555; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.cover { height: 257mm; display: flex; flex-direction: column; break-after: page; }
.cover .img { flex: 1; background: url('../docs/figures/blender_hero.png') center/cover; border-radius: 6px; margin-bottom: 18px; }
.cover h1 { font-size: 27pt; margin: 0 0 6px; color: #0f3550; line-height: 1.15; }
.cover .sub { font-family: "Segoe UI", Calibri, sans-serif; font-size: 13pt; color: #333; margin-bottom: 18px; }
.cover .meta { font-family: "Segoe UI", Calibri, sans-serif; font-size: 11pt; color: #222; line-height: 1.6; }
.toc { break-after: page; }
.toc li { font-family: "Segoe UI", Calibri, sans-serif; }
code { font-family: Consolas, monospace; font-size: 9pt; background: #f1f4f7; padding: 0 3px; border-radius: 3px; }
.refs li { font-size: 9.5pt; }
.pb { break-before: page; }
</style></head><body>

<section class="cover">
  <div class="img"></div>
  <h1>Wireless Attack Surface Digital Twin</h1>
  <div class="sub">Mapping where an outside attacker can reach a building’s Wi-Fi — and how far protections shrink that zone</div>
  <div class="meta"><b>Owais Abu Salah</b> · Student ID 12610830<br>Course project — Wireless Communication Systems &amp; Security<br>November 2026<br>
  Live twin: <span style="color:#2b7bb9">owaisabusalah.github.io/wireless-attack-surface-twin</span> · Code: <span style="color:#2b7bb9">github.com/OwaisAbuSalah/wireless-attack-surface-twin</span></div>
</section>

<section class="toc">
<h2>Abstract</h2>
<p>Wi-Fi does not stop at the walls of a building, so the security of a wireless network depends not only on <i>how</i> an attack works but on <i>where</i> an attacker can stand to launch it. This project builds a three-dimensional digital twin of a three-storey faculty building with its street, café, parking lot and neighbouring buildings, simulates the propagation of the access point’s signal through walls, windows, doors and floor slabs, and converts the received power into a map of the <b>attack surface</b>: the outdoor area from which passive eavesdropping, deauthentication or an Evil-Twin rogue access point is feasible. A real-time COST-231 multi-wall model with three-dimensional wall/opening/slab intersection and antenna patterns runs on the GPU (≈ ${fmt(APP.grid.outdoor_cells + APP.grid.floor_cells)} map cells in about ${fmt(APP.timing_ms, 0)} ms) and is verified against independent CPU and Python implementations; NVIDIA Sionna RT ray tracing of the same geometry serves as the physics reference. In the baseline configuration (one access point next to a street window, 20 dBm, 2.4 GHz) an attacker with a USB adapter can eavesdrop on <b>${fmt(base.area_danger)} m²</b> of the 200 m × 140 m study area, including ${fmt(base.street_exposure, 0)} % of the street; from the café across the street he receives ${fmt(L.rss_dbm, 1)} dBm, a margin of ${fmt(L.margin_db, 1)} dB. No single countermeasure closes the leak and several of them reduce indoor coverage. A combination of RF-shielding film and paint, two ceiling micro-cells, the 5 GHz band and an automatically tuned transmit power of ${fin.tx_dbm} dBm reduces the danger zone to <b>${fmt(fin.area_danger)} m² (${pct(fin.area_danger, base.area_danger)})</b>, removes the street from it entirely and keeps ${fmt(fin.coverage, 1)} % indoor coverage. Ray tracing confirms the baseline finding but shows that reflections make several protections markedly less effective than the engineering model predicts${rtLine ? ' — ' + rtLine.charAt(0).toLowerCase() + rtLine.slice(1) : ''} — which is why the protocol layer (802.11w, WPA3-SAE) remains necessary.</p>
<h2>Contents</h2>
<ol>
<li>Introduction</li><li>Background</li><li>System architecture</li><li>The digital twin</li><li>Propagation model</li><li>Attack-surface model</li><li>Implementation and verification</li><li>Results</li><li>Validation with NVIDIA Sionna RT</li><li>Discussion and limitations</li><li>Conclusion</li><li>References</li><li>Appendix — reproducing the results</li>
</ol>
</section>

<h2>1. Introduction</h2>
<p>Most coursework on wireless security studies an attack itself — how a WPA2 handshake is captured, how forged deauthentication frames disconnect a client, how a rogue access point lures victims. The question this project asks is complementary and spatial: <b>from where can these attacks be launched?</b> A Wi-Fi access point radiates in all directions; walls attenuate the signal but rarely stop it, and a street, a café or a parking lot next to an office building can receive the network at levels that are perfectly usable for an attacker. The physical extent of this exposure — the <i>wireless attack surface</i> — is invisible to administrators and to users.</p>
<p>The project makes it visible with a <b>digital twin</b>: a three-dimensional model of a building and its surroundings in which the propagation of the signal is simulated and translated, cell by cell, into the attacks that are feasible there. The contributions are:</p>
<ul>
<li>a single parametric description of the building (165 walls with openings, 11 materials, access-point mounts, client devices) that drives three engines — Blender for rendering, NVIDIA Sionna RT for ray tracing and a browser-based real-time twin;</li>
<li>a real-time multi-wall propagation model on the GPU with exact three-dimensional wall, window, door and slab intersections and realistic antenna patterns, verified against two independent implementations;</li>
<li>an attack-feasibility model for eavesdropping, deauthentication and Evil Twin that uses path-loss reciprocity to evaluate the attacker’s own transmissions;</li>
<li>an interactive study of eight countermeasures and their side effect on indoor coverage, including an optimiser for transmit power and a micro-cell design;</li>
<li>a validation of the engineering model against ray tracing, with cell-wise error statistics and a calibration of the material losses.</li>
</ul>

<h2>2. Background</h2>
<h3>2.1 Indoor-to-outdoor propagation</h3>
<p>In free space the received power falls with the square of the distance; the free-space path loss at 1 m is 20·log₁₀ f + 32.44 dB (f in GHz), i.e. 40.0 dB at 2.4 GHz and 46.4 dB at 5 GHz. Inside and around buildings the dominant additional effect is the attenuation of the walls and floors that the signal must cross. The <b>COST-231 multi-wall model</b> [1] adds the loss of every crossed wall and floor to the free-space loss; it is the standard engineering model for WLAN planning and underlies ITU-R P.1238 [2]. The losses of individual building materials depend on their permittivity, conductivity and thickness and increase with frequency; ITU-R P.2040 [3] tabulates the electrical properties. Real propagation also includes reflection, diffraction and scattering, which a ray tracer such as NVIDIA Sionna RT [5] models explicitly.</p>
<h3>2.2 Wi-Fi attacks considered</h3>
<ul>
<li><b>Passive eavesdropping.</b> A receiver in monitor mode captures every frame it can decode, including the WPA2-PSK four-way handshake, which allows an offline dictionary attack on the pre-shared key; even encrypted traffic leaks metadata (MAC addresses, volumes, timing).</li>
<li><b>Deauthentication.</b> Without 802.11w Protected Management Frames, management frames are unauthenticated; forged deauthentication frames disconnect clients, as a denial of service or to force a re-association that the attacker can capture.</li>
<li><b>Evil Twin.</b> A rogue access point advertises the same SSID; a client that receives it more strongly than the legitimate access point may associate with it, exposing credentials or traffic.</li>
</ul>
<h3>2.3 Countermeasures</h3>
<p>Radio-layer measures change <i>where</i> an attack is possible: lower transmit power, directional antennas, placement of the access point away from the façade, RF-shielding window films and conductive paints, and the 5 GHz band, which loses more in walls and in free space. Protocol-layer measures change <i>what</i> an attacker can do: 802.11w protects management frames, WPA3-SAE removes offline dictionary attacks on captured handshakes and prevents a clone without the password from completing the handshake [6].</p>

<h2>3. System architecture</h2>
<p>All engines read one data file, <code>data/building.json</code>, generated by a small script. It contains the geometry (floors, walls with their three-dimensional extent and openings, rooms, neighbouring buildings, the site), the radio parameters (material losses per band, access-point mounts and antennas, client devices) and the security parameters (attacker equipment, thresholds, protections and pre-defined scenarios).</p>
${f('data:image/svg+xml;base64,' + Buffer.from(archSvg).toString('base64'), 'One data file drives three engines: Blender builds the visual model and renders, NVIDIA Sionna RT ray-traces the same geometry as the physics reference, and the browser twin evaluates the real-time model on the GPU.', 'half')}

<h2>4. The digital twin</h2>
<p>The building is a 36 m × 16 m faculty block with three storeys of 3.6 m. A double-loaded corridor separates street-facing rooms in the south from the north rooms and a concrete stair-and-elevator core. Exterior walls are 30 cm reinforced concrete with a regular pattern of double-glazed windows (one 1.8 m window per 3 m bay); the ground-floor lobby has a glass curtain wall. Corridor walls are 20 cm blocks with wooden doors, partitions are drywall, the elevator shaft and the server-room door are steel. The department’s access point hangs on the first floor next to a window that faces University Street; eight client devices (laptops, phones, a lab workstation, a network printer) are placed in the rooms. The site includes the street with a zebra crossing, sidewalks, a café terrace across the street, a parking lot and five neighbouring buildings, whose façades also attenuate the signal.</p>
${f('../docs/figures/blender_cutaway.png', 'Cut-away of the first floor (Blender, Cycles): the access point next to the street window, the rooms and corridor, and the simulated received power on the floor and the street.')}
${matTable}
<p class="sans" style="font-size:9pt;color:#555;margin-top:-6px">Table 1. Through-wall losses (normal incidence) used by the real-time model — typical WLAN-planning values consistent with ITU-R P.2040; they are calibrated against Sionna RT in section 9.</p>

<h2>5. Propagation model</h2>
<p>The received signal strength from a transmitter T at a receiver R is</p>
<div class="eq">RSS = P<sub>tx</sub> + G<sub>tx</sub>(θ, φ) + G<sub>rx</sub> − PL(T, R)<small>with</small>
PL = 20·log₁₀ f<sub>GHz</sub> + 32.44 + 10·n·log₁₀ d + Σ L<sub>wall</sub> + Σ L<sub>slab</sub>, &nbsp; n = ${B.rf.pathloss_exponent}, d ≥ ${B.rf.min_distance_m} m</div>
<p><b>Wall crossings in three dimensions.</b> Each wall is a vertical rectangle defined by a plan segment and a height range. The plan projection of the ray T→R is intersected with the segment; for a crossing the height of the ray at that point is interpolated and compared with the wall’s height range, so a ray from the first floor to the street crosses only the walls of the storeys it actually passes through. If the crossing point lies inside an opening (a window, a door or the curtain wall — described by sill, head, width, offset and an optional period), the opening’s material is used instead of the wall’s. <b>Floor slabs</b> are crossed when the ray passes a slab plane inside the building footprint. Because the geometry and the map grids lie on a regular lattice, rays can pass exactly through wall junctions or opening edges; all boundary tests therefore use small symmetric tolerances (10⁻⁵ in the line parameters, 0.1 mm in lengths), which makes the float32 GPU and float64 CPU implementations decide every such case identically.</p>
<p><b>Antennas.</b> The default access-point antenna is a vertical half-wave dipole, G = 2.15 + 10·log₁₀[cos(π/2·sin el)/cos el]² dBi. The directional option is the 3GPP TR 38.901 element pattern [4], G = G<sub>max</sub> − min(12(φ′/φ<sub>3dB</sub>)² + 12(θ′/θ<sub>3dB</sub>)², SLA) in the antenna’s local frame (8 dBi, 65°, 30 dB for the wall mount; a 5.5 dBi, 110° ceiling panel for the ceiling mount). Receivers are isotropic; the attacker’s antenna gain is added as if it were pointed at the target. With several access points, every receiver uses the strongest one.</p>
<p><b>Maps.</b> The model is evaluated on an outdoor plane of 200 m × 140 m at 1.5 m (hand height, ${APP.grid.outdoor_cell_m} m cells) and on one plane per storey at 1.2 m above the floor (${APP.grid.floor_cell_m} m cells).</p>

<h2>6. Attack-surface model</h2>
<p>For an attacker standing at X with antenna gain G<sub>att</sub>, receiver sensitivity S<sub>att</sub> and transmit power P<sub>att</sub> (Table 2), and for the client devices c:</p>
<div class="eq">Eavesdropping: RSS(AP→X) + G<sub>att</sub> ≥ S<sub>att</sub><br>
Deauthentication: eavesdropping feasible and max<sub>c</sub> [P<sub>att</sub> + G<sub>att</sub> − PL(X, c)] ≥ ${B.attack.client.sens_dbm} dBm<br>
Evil Twin: eavesdropping feasible and ∃c: P<sub>att</sub> + G<sub>att</sub> − PL(X, c) ≥ RSS(AP→c) + ${B.attack.evil_twin.margin_db} dB and ≥ ${B.attack.evil_twin.min_rss_dbm} dBm
<small>Path loss is reciprocal, so PL(X, c) is computed with the client as the source. Active attacks require the attacker to hear the network (BSSID, channel, client addresses), so the tiers are nested.</small></div>
${eqTable}
<p class="sans" style="font-size:9pt;color:#555;margin-top:-6px">Table 2. Attacker equipment. The default analysis uses the USB adapter with a 5 dBi antenna.</p>
<p>From the maps the twin derives four indicators: the <b>danger zone</b> (outdoor area outside the building where at least one attack is feasible), the <b>maximum leak distance</b> from the building, the <b>street exposure</b> (share of the street and its sidewalks inside the eavesdropping zone) and the <b>indoor coverage</b> on the access point’s floor (share of cells, excluding the stair core, with at least −67 dBm, the usual requirement for voice-grade Wi-Fi). For the attacker’s current position the twin additionally shows the <b>hijack map</b>: the cells inside the building where a client would prefer the attacker’s rogue access point.</p>

<h2>7. Implementation and verification</h2>
<p>The interactive twin is a browser application (three.js, WebGL 2) built into a single self-contained HTML file that runs offline. The propagation model is implemented as a fragment shader: each fragment of a floating-point render target is one map cell, the 165 walls are stored in a data texture, and every outdoor cell evaluates the path from the access point(s) and from the eight clients (for the deauthentication and Evil-Twin channels) — about ${fmt(APP.grid.outdoor_cells + APP.grid.floor_cells)} cells per update in ${fmt(APP.timing_ms, 1)} ms on an NVIDIA GeForce RTX 3060 (WebGL 2 via Direct3D 11). The results are read back asynchronously for the indicators and morphed smoothly on screen when a protection is toggled. The attacker can be dragged or walked with the keyboard; his link budget, the ray to the access point with the loss of every crossed wall, and the status of each client are updated continuously. The application opens in a simple view that tells the story in four steps — the leak, the attacker, the protection and the result — each with one short explanation, a few live numbers and a plain-language status of the attacker; a detailed mode exposes every protection, the signal, attack-surface and Sionna maps, single floors and the full link budget. A guided demonstration, Arabic and English interfaces and several lighting moods support the presentation.</p>
<p><b>Verification.</b> The model is implemented three times — GLSL on the GPU, JavaScript for single links and statistics, and NumPy as the batch reference — following one written specification. The automated checks (script <code>web/tools/measure.mjs</code>) give:</p>
<ul>
<li>JavaScript vs NumPy on ${V.js_vs_python.links} reference links (access point to clients, to the attacker and to random indoor and outdoor points): maximum difference <b>${fmt(V.js_vs_python.max_abs_diff_db, 3)} dB</b>;</li>
${V.js_vs_python_protections ? `<li>JavaScript vs NumPy on ${V.js_vs_python_protections.links} further links covering every protection scenario (patch antennas, relocated and ceiling access points, shielding, 5 GHz), including ${V.js_vs_python_protections.multi_ap_links} two-AP links where the received power is the maximum over both micro-cells: maximum difference <b>${fmt(V.js_vs_python_protections.max_abs_diff_db, 3)} dB</b>;</li>` : ''}
<li>GPU vs JavaScript on ${fmt(V.gpu_vs_cpu_outdoor.cells)} random outdoor cells: maximum difference ${fmt(V.gpu_vs_cpu_outdoor.max_abs_diff_rss_db, 4)} dB (received power), ${fmt(V.gpu_vs_cpu_outdoor.max_abs_diff_deauth_db, 4)} dB (deauthentication channel) and ${fmt(V.gpu_vs_cpu_outdoor.max_abs_diff_eviltwin_db, 4)} dB (Evil-Twin channel);</li>
<li>GPU vs JavaScript on all ${fmt(V.gpu_vs_cpu_floors.cells)} floor cells: ${fmt(V.gpu_vs_cpu_floors.differing_over_0_01_db)} cells differ by more than 0.01 dB.</li>
</ul>

<h2>8. Results</h2>
<h3>8.1 Baseline: the street is inside the attack surface</h3>
${f('../presentation/assets/shot_overview_baseline.jpg', 'Baseline attack surface in the twin. Amber: eavesdropping; orange: deauthentication; hatched red: Evil Twin. The café terrace, the street, the parking lot and the campus lawn all lie inside the danger zone.')}
<div class="kpis"><div class="kpi"><b>${fmt(base.area_danger)} m²</b><span>danger zone outside</span></div><div class="kpi"><b>${leak(base)}</b><span>maximum leak distance</span></div><div class="kpi"><b>${fmt(base.street_exposure, 0)} %</b><span>street exposure</span></div><div class="kpi"><b>${fmt(base.coverage, 1)} %</b><span>indoor coverage</span></div></div>
<p>With the access point next to the street window, essentially the whole 200 m × 140 m study area lies inside the eavesdropping zone of a USB adapter; the zone is only interrupted behind the neighbouring buildings. The Evil-Twin zone (${fmt(base.area_eviltwin)} m²) covers the plaza in front of the façade and part of the parking lot, where a rogue access point is received more strongly than the real one by devices near the windows. The link budget of an attacker on the café terrace explains why: a single wall separates him from the access point.</p>
<div class="two"><div>${linkTable}<p class="sans" style="font-size:9pt;color:#555;margin-top:-6px">Table 3. Link budget from the access point to the café terrace.</p></div>
<div>${fig('../presentation/assets/shot_floor_hijack.jpg', `Hijack map on the first floor for the attacker on the café terrace: purple cells (${fmt(L.hijack_floor_pct, 0)} % of the floor) would prefer his rogue access point; ${L.deauth_devices} of 8 devices can be deauthenticated.`, ++F)}</div></div>

<h3>8.2 Individual countermeasures</h3>
${appTable}
<p class="sans" style="font-size:9pt;color:#555;margin-top:-6px">Table 4. Indicators of each configuration (real-time model, USB attacker). Δ = change of the danger zone relative to the baseline.</p>
<div class="two"><div>${chart1}</div><div>${chart2}</div></div>
<p>No individual measure comes close to closing the street. Shielding the façade helps where it is applied, but the zone remains far larger than the study area in most directions; the 5 GHz band has the largest single effect because both the free-space loss and every wall loss increase. Several measures reduce indoor coverage: a lower transmit power, a single access point relocated behind the concrete core, and 5 GHz all fall far below the 95 % target. Two ceiling micro-cells at full power cover the whole floor but radiate more energy and enlarge the danger zone. The directional antenna aimed away from the street shrinks the zone but leaves the ends of the floor in its weak side lobes.</p>

<h3>8.3 Micro-cells and transmit-power optimisation</h3>
<p>Because the received power is linear in the transmit power (in dB), the minimum power that keeps 95 % of the floor above −67 dBm follows directly from the 5th percentile p₅ of the floor map computed at the current power P: P<sub>min</sub> = P + (−67 − p₅) + 0.5 dB. On 5 GHz a single access point cannot reach the target from any ceiling position (best of a GPU search over 60 positions: ${NUM.micro.singleBest} %), so the design moves to two micro-cells. A GPU search over ${NUM.micro.pairs} placements selected two corridor-ceiling positions at x = −12 m and x = +9 m (${NUM.micro.pairBest} % at 20 dBm), after which the optimiser reduces the power to <b>${fin.tx_dbm} dBm</b>.</p>

<h3>8.4 Combined result</h3>
<div class="two">${fig('../presentation/assets/shot_overview_baseline.jpg', 'Before.', ++F)}${fig('../presentation/assets/shot_protected_overview.jpg', 'After “Apply protection”: shielding film and paint, two micro-cells, 5 GHz, ' + fin.tx_dbm + ' dBm, 802.11w and WPA3-SAE.', ++F)}</div>
<div class="kpis"><div class="kpi"><b>${fmt(fin.area_danger)} m²</b><span>danger zone (${pct(fin.area_danger, base.area_danger)})</span></div><div class="kpi"><b>${leak(fin)}</b><span>maximum leak distance</span></div><div class="kpi"><b>${fmt(fin.street_exposure, 0)} %</b><span>street exposure</span></div><div class="kpi"><b>${fmt(fin.coverage, 1)} %</b><span>indoor coverage</span></div></div>
<p>The combination is effective because its parts complement each other: shielding raises the loss of the façade, micro-cells create coverage headroom indoors, 5 GHz increases every loss, and the optimiser converts the headroom into a lower transmit power. The remaining eavesdropping zone is a narrow band around the building; no deauthentication or Evil-Twin cells remain. ${rtLine ? rtLine + ' (section 9): the real-time model is optimistic, and the protocol layer covers the remaining margin.' : ''}</p>

<h3>8.5 The protocol layer</h3>
<table><thead><tr><th>Attack</th><th>RF measures</th><th>802.11w PMF</th><th>WPA3-SAE</th></tr></thead><tbody>
<tr><td>Eavesdropping</td><td>zone ${pct(fin.area_eavesdrop, base.area_eavesdrop)}</td><td>no effect</td><td>only encrypted frames remain</td></tr>
<tr><td>Offline password cracking</td><td>fewer places to capture the handshake</td><td>no effect</td><td>blocked (SAE resists dictionary attacks)</td></tr>
<tr><td>Deauthentication</td><td>zone removed</td><td>blocked (forged frames rejected)</td><td>PMF is mandatory in WPA3</td></tr>
<tr><td>Evil Twin</td><td>rogue AP cannot out-shout the real one</td><td>no forced disconnects</td><td>blocked (a clone cannot complete SAE)</td></tr>
</tbody></table>
<p>Radio measures limit <i>where</i> an attack can be launched; protocol measures limit <i>what</i> it can achieve inside the area that is left. Neither is sufficient alone — section 9 shows why this matters.</p>

<h2>9. Validation with NVIDIA Sionna RT</h2>
<p><b>Setup.</b> The same building was ray-traced with ${SION?.generator ?? 'Sionna RT'} (Mitsuba ${st.mitsuba ?? ''}, Dr.Jit ${st.drjit ?? ''}, variant <code>${st.variant ?? ''}</code>, ${st.gpu ?? ''}). Walls are zero-thickness quads carrying ITU-R P.2040 single-slab materials with the wall’s thickness (closed boxes would apply the slab transmission twice); openings are split into separate quads of glass or wood; slabs, a ground plane and the neighbouring buildings are included; the shielding measures are modelled as conductive layers whose normal-incidence loss matches Table 1 plus the specified increase. The radio maps use ${fmt(st.samples_per_tx ?? 0)} rays per transmitter, a maximum depth of ${st.max_depth ?? '–'} interactions, line of sight, specular reflection and refraction (transmission through walls); diffuse scattering and diffraction are disabled. The client-to-attacker maps needed for the deauthentication and Evil-Twin conditions are traced with the clients as sources (reciprocity).</p>
${f('../docs/figures/sionna_baseline.png', 'NVIDIA Sionna RT: baseline received power on the outdoor plane (top) and the three floors (bottom).')}
${f('../docs/figures/mwm_baseline.png', 'Real-time multi-wall model on the same grid, for comparison with Figure ' + F + '.')}
${metTable}
<p class="sans" style="font-size:9pt;color:#555;margin-top:-6px">Table 5. Cell-wise difference between the multi-wall model and Sionna RT (RMSE / mean bias, dB, cells above −120 dBm; outdoor cells outside and floor cells inside the footprint).</p>
<p>Indoors the two models agree well (baseline floors RMSE ≈ ${fmt(floorsRmse, 1)} dB). Outdoors the error is larger (RMSE ${fmt(baseOut?.rmse, 1)} dB): the ray tracer fills the multi-wall model’s geometric shadows with reflections from the ground and the neighbouring façades, while in the direct beams the two agree.</p>
${svm}
<p class="sans" style="font-size:9pt;color:#555;margin-top:-6px">Table 6. Attack-surface indicators of both models on the same 1 m / 0.25 m grid.</p>
<p><b>Finding.</b> Both models agree on the central security finding: at baseline the eavesdropping zone covers practically the whole study area and the street. They disagree on how well the radio countermeasures work. In the ray tracer the shielding measures, the directional antenna and the 5 GHz band remove a much smaller share of the zone than in the multi-wall model, because energy that escapes through the remaining openings is reflected around the shielded parts of the façade. The engineering model is therefore optimistic about radio countermeasures; its value lies in speed and interactivity, while the ray tracer provides the reference. This is the strongest argument for treating radio measures as only one layer of defence.</p>
${existsSync(join(ROOT, 'docs/figures/compare_calibration.png')) ? f('../docs/figures/compare_calibration.png', 'Calibration of the multi-wall material losses to Sionna RT (bounded least squares, see sim/out/calibration.json).') : ''}

<h2>10. Discussion and limitations</h2>
<ul>
<li><b>Material losses</b> are planning values. They were calibrated against the ray tracer, but not yet against measurements in a real building; the repository contains a template and a script for an RSSI survey with a phone (<code>sim/measure/</code>), which is the natural next step.</li>
<li><b>The real-time model has no reflections or diffraction.</b> It is accurate indoors and in the direct beams, optimistic in shadows and about shielding (section 9).</li>
<li><b>Attack thresholds</b> are deliberately simple (sensitivities, a 3 dB margin for the Evil Twin). Real attacks also depend on traffic, channel load, client roaming behaviour and the user.</li>
<li><b>Scope.</b> One building, one band at a time, receivers at hand height; elevated attackers (upper floors next door, drones) and moving attackers are not modelled.</li>
</ul>
<p><b>Recommendations for a real building.</b> Place access points away from façades and prefer several low-power cells to one powerful one; use 5 GHz (or 6 GHz) for staff networks; tune the transmit power to the coverage that is actually needed; shield the façade only where an exposure map shows that it matters, remembering the windows; and in every case enable WPA3-SAE with Protected Management Frames, because some leakage always remains.</p>

<h2>11. Conclusion</h2>
<p>The digital twin turns an invisible property of a wireless network — how far it reaches beyond the walls — into a map that can be explored, explained and acted upon. For the studied building the result is clear: without protection, the whole street is attack surface. A combination of measures that complement each other shrinks the danger zone by ${pct(fin.area_danger, base.area_danger).replace('−', '')} while keeping indoor coverage, and ray tracing reminds us that radio measures alone are never the whole answer. The method is general: the same data file, model and tools can describe any building whose plan and materials are known.</p>

<h2>12. References</h2>
<ol class="refs">
<li>COST Action 231, <i>Digital mobile radio towards future generation systems</i>, Final Report, ch. 4 (Multi-Wall Model), European Commission, 1999.</li>
<li>ITU-R Recommendation P.1238, <i>Propagation data and prediction methods for the planning of indoor radiocommunication systems</i>.</li>
<li>ITU-R Recommendation P.2040, <i>Effects of building materials and structures on radiowave propagation above about 100 MHz</i>.</li>
<li>3GPP TR 38.901, <i>Study on channel model for frequencies from 0.5 to 100 GHz</i> (antenna element pattern).</li>
<li>J. Hoydis et al., “Sionna RT: Differentiable Ray Tracing for Radio Propagation Modeling,” 2023; NVIDIA Sionna RT documentation.</li>
<li>IEEE Std 802.11-2020 (receiver minimum sensitivity, Protected Management Frames); Wi-Fi Alliance, <i>WPA3 Specification</i>.</li>
</ol>

<h2>Appendix — reproducing the results</h2>
<div class="box sans" style="font-size:9.5pt">
<b>Interactive twin:</b> open <code>docs/index.html</code> (or the live link). Development: <code>cd web &amp;&amp; npm install &amp;&amp; npm run dev</code>; build: <code>npm run build</code>.<br>
<b>Indicators and verification of the twin:</b> <code>node web/tools/measure.mjs</code> → <code>sim/out/app_stats.json</code>.<br>
<b>Reference model and ray tracing:</b> <code>sim/run_mwm.py</code>, <code>sim/run_sionna.py</code>, <code>sim/compare.py</code> → <code>sim/out/RESULTS.md</code> (see <code>sim/README.md</code>).<br>
<b>Renders:</b> <code>blender -b --factory-startup -P blender/build_twin.py -- --out docs/figures</code>.<br>
<b>Slides and this report:</b> <code>node presentation/build_deck.js</code>, <code>node report/build_report.mjs</code>.<br>
<b>Model specification:</b> <code>docs/MODEL.md</code>.
</div>
</body></html>`;

writeFileSync(join(HERE, 'report.html'), html);
console.log('wrote report/report.html');

if (!process.argv.includes('--html-only')) {
  const { chromium } = await import(pathToFileURL(join(ROOT, 'web/node_modules/playwright-core/index.mjs')).href);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  await page.goto(pathToFileURL(join(HERE, 'report.html')).href, { waitUntil: 'networkidle' });
  await page.pdf({
    path: join(ROOT, 'docs/REPORT.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font-size:8px;color:#888;font-family:Segoe UI,Arial;padding:0 17mm;display:flex;justify-content:space-between"><span>Wireless Attack Surface Digital Twin — Owais Abu Salah</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  });
  await browser.close();
  console.log('wrote docs/REPORT.pdf');
}

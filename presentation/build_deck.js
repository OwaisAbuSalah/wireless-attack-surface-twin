// Builds presentation/Wireless_Attack_Surface_Digital_Twin.pptx
//   cd presentation && npm install && node build_deck.js
// Numbers come from the web app (real-time model) and sim/out (Sionna RT) — see NUM below.
const fs = require('fs');
const path = require('path');
const pptxgen = require('pptxgenjs');
const sharp = require('sharp');
const QRCode = require('qrcode');

const ROOT = path.resolve(__dirname, '..');
const A = (f) => path.join(__dirname, 'assets', f);
const FIG = (f) => path.join(ROOT, 'docs', 'figures', f);
const BUILD = path.join(__dirname, '.build');
fs.mkdirSync(BUILD, { recursive: true });
const OUT = path.join(__dirname, 'Wireless_Attack_Surface_Digital_Twin.pptx');

const REPO = 'https://github.com/OwaisAbuSalah/wireless-attack-surface-twin';
const LIVE = 'https://owaisabusalah.github.io/wireless-attack-surface-twin/';
const NUM = JSON.parse(fs.readFileSync(path.join(__dirname, 'numbers.json'), 'utf8'));
const r1 = (x) => (Math.round(x * 10 + 1e-6) / 10).toFixed(1);   // half-up, as in the report
// live numbers: web app (sim/out/app_stats.json) and the Python / Sionna runs (sim/out/*.csv)
const APP = JSON.parse(fs.readFileSync(path.join(ROOT, 'sim/out/app_stats.json'), 'utf8'));
const csv = (f) => {
  const p = path.join(ROOT, 'sim/out', f);
  if (!fs.existsSync(p)) return [];
  const [h, ...rows] = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);
  const k = h.split(',');
  return rows.map((r) => Object.fromEntries(r.split(',').map((v, i) => [k[i], isNaN(+v) || v === '' ? v : +v])));
};
const SST = csv('sionna_stats.csv'), MST = csv('mwm_stats.csv').filter((r) => r.grid === 'sionna'), CMP = csv('compare_metrics.csv');
{
  const S = APP.scenarios, b = S.baseline, a = S.applyAll, L = APP.link;
  NUM.base = { areaU: b.area_danger, areaT: b.area_eviltwin, street: b.street_exposure, cov: b.coverage, hijack: L.hijack_floor_pct };
  NUM.link = { ptx: 20, d: L.d_m, spread: L.path_loss_distance_db, gTx: L.gain_tx_dbi, wall: L.walls[0]?.[1] ?? 0, gRx: 5, rss: L.rss_dbm, sens: -92, margin: L.margin_db, deauth: L.deauth_devices };
  NUM.after = { tx: a.tx_dbm, areaU: a.area_danger, street: a.street_exposure, leak: a.max_leak_m, cov: a.coverage };
  const names = { baseline: 'Baseline', lowPower: 'Reduce TX power (12 dBm)', directional: 'Directional antenna', relocate: 'Relocate AP to ceiling', microcells: 'Micro-cells (2 APs, 20 dBm)', shieldWindows: 'Shielding window film', shieldPaint: 'Shielding paint', band5: 'Move to 5 GHz', applyAll: 'All combined' };
  NUM.measures = Object.keys(names).filter((k) => S[k]).map((k) => [names[k], S[k].area_danger, +r1(S[k].coverage)]);
  { const V = APP.verification, P = V.js_vs_python_protections ?? { links: 0, max_abs_diff_db: 0 };
    NUM.unit = { maxErr: Math.max(V.js_vs_python.max_abs_diff_db, P.max_abs_diff_db).toFixed(3), links: V.js_vs_python.links + P.links }; }
  NUM.gpuMs = String(Math.round(APP.timing_ms));
  const nom = CMP.filter((r) => r.mwm === 'nominal' && r.scenario === 'baseline');
  const out = nom.find((r) => r.plane === 'outdoor'), fl = nom.filter((r) => /^floor\d/.test(r.plane)), all = nom.find((r) => r.plane === 'all');
  if (out) NUM.validation.outRmse = out.rmse.toFixed(1);
  if (fl.length) NUM.validation.floorsRmse = Math.sqrt(fl.reduce((s2, r) => s2 + r.rmse * r.rmse * r.n, 0) / fl.reduce((s2, r) => s2 + r.n, 0)).toFixed(1);
  if (all) NUM.validation.bias = (all.bias < 0 ? '−' : '+') + Math.abs(all.bias).toFixed(1);
}
const reduction = (rows, k) => { const b = rows.find((r) => r.scenario === 'baseline'), r = rows.find((x) => x.scenario === k); return b && r ? Math.round((1 - r.area_eavesdrop / b.area_eavesdrop) * 100) : null; };

// ───────────────────────── theme ─────────────────────────
const THEME = {
  name: 'Attack Surface Dark',
  headFontFace: 'Calibri',
  bodyFontFace: 'Calibri',
  colors: {
    dk1: '0A0F1C', lt1: 'FFFFFF', dk2: '141C2F', lt2: 'C3CDDD',
    accent1: '22D3EE', accent2: 'FF2D55', accent3: 'FFD60A', accent4: 'FF8A00', accent5: '34D399', accent6: 'B14CFF',
    hlink: '22D3EE', folHlink: '7DD3FC',
  },
};
const HEX = THEME.colors;
const MUTED = '8A97AD';
const CARD = '141C2F';
const CARD2 = '1B2540';

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = 'Wireless Attack Surface Digital Twin';
pres.author = 'Owais Abu Salah';
pres.subject = 'Wireless Communication Systems and Security — course project';
pres.company = 'Wireless Communication Systems and Security';
const C = pres.SchemeColor;
const W = 13.333, H = 7.5;

// ───────────────────────── layouts ─────────────────────────
const FOOT = 'Wireless Attack Surface Digital Twin  ·  Owais Abu Salah';
pres.defineSlideMaster({
  title: 'TITLE',
  background: { color: C.text1 },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.7, y: 2.05, w: 7.6, h: 1.7, fontSize: 46, bold: true, color: C.background1, valign: 'bottom', align: 'left', margin: 0 }, text: '' } },
    { placeholder: { options: { name: 'body', type: 'body', x: 0.7, y: 3.95, w: 7.0, h: 1.0, fontSize: 19, color: C.background2, valign: 'top', align: 'left', margin: 0 }, text: '' } },
  ],
});
pres.defineSlideMaster({
  title: 'CONTENT',
  background: { color: C.text1 },
  margin: [0.5, 0.6, 0.6, 0.6],
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 0.32, w: 12.1, h: 0.8, fontSize: 32, bold: true, color: C.background1, valign: 'middle', align: 'left', margin: 0 }, text: '' } },
    { text: { text: FOOT, options: { x: 0.6, y: 7.0, w: 8, h: 0.3, fontSize: 10, color: MUTED, margin: 0 } } },
  ],
  slideNumber: { x: 12.2, y: 7.0, w: 0.5, h: 0.3, fontSize: 10, color: MUTED, align: 'right' },
});
pres.defineSlideMaster({
  title: 'FULL_IMAGE',
  background: { color: C.text1 },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 0.32, w: 11.5, h: 0.8, fontSize: 32, bold: true, color: C.background1, valign: 'middle', align: 'left', margin: 0 }, text: '' } },
  ],
  slideNumber: { x: 12.2, y: 7.0, w: 0.5, h: 0.3, fontSize: 10, color: 'C3CDDD', align: 'right' },
});

// ───────────────────────── helpers ─────────────────────────
const ICONS = {
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.7 15.8a5 5 0 0 1 6.6 0"/><circle cx="12" cy="19.3" r="1"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.6 8.2-8 9.3C7.6 20.2 4 17 4 12V6z"/><path d="M8.6 12.2l2.4 2.4 4.6-4.8"/>',
  file: '<path d="M6 2.5h8l5 5V21.5H6z"/><path d="M14 2.5v5h5M9 13h7M9 17h7"/>',
  cube: '<path d="M12 2.5l8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3z"/><path d="M12 21.5V12M20.5 7.3L12 12 3.5 7.3"/>',
  ray: '<path d="M3 20L21 4"/><circle cx="3.5" cy="19.5" r="1.6"/><path d="M9 14.5l2 2M13 11l2 2M17 7.5l2 2"/>',
  bolt: '<path d="M13 2.5L4.5 13.5h6.5l-1 8 8.5-11h-6.5z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  wifiOff: '<path d="M2.5 9a14 14 0 0 1 5.5-3.4M21.5 9a14 14 0 0 0-8.3-4.1M5.5 12.5a9.5 9.5 0 0 1 3.8-2.2M18.5 12.5a9.5 9.5 0 0 0-2.4-1.8M8.7 15.8a5 5 0 0 1 6.6 0"/><path d="M3 3l18 18"/>',
  twin: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  laptop: '<rect x="4" y="6" width="16" height="10.5" rx="1.5"/><path d="M2 19.5h20"/><path d="M18.5 6V2"/>',
  yagi: '<path d="M3 21L21 3"/><path d="M7.5 20.5l-4-4M11.5 16.5l-4-4M15.5 12.5l-4-4M19.5 8.5l-4-4"/>',
  ruler: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  antenna: '<path d="M12 21V9"/><path d="M8.5 5.5a5 5 0 0 1 7 0M6 3a8.5 8.5 0 0 1 12 0"/><circle cx="12" cy="8" r="1.4"/><path d="M8 21h8"/>',
  drone: '<rect x="9" y="10" width="6" height="4" rx="1"/><path d="M9 11L5 7M15 11l4-4M9 13l-4 4M15 13l4 4"/><circle cx="5" cy="7" r="2"/><circle cx="19" cy="7" r="2"/><circle cx="5" cy="17" r="2"/><circle cx="19" cy="17" r="2"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z"/>',
  router: '<rect x="3" y="12.5" width="18" height="7.5" rx="2"/><path d="M7 12.5V6.5M17 12.5V6.5M7 16.3h.01M10.5 16.3h.01"/>',
};
async function iconPng(name, color = '#FFFFFF') {
  const f = path.join(BUILD, `icon_${name}_${color.replace('#', '')}.png`);
  if (!fs.existsSync(f)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="256" height="256"><g fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</g></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(f);
  }
  return f;
}
/** Crop an image to the exact aspect of its frame (focus = 0..1 position of the crop window). */
async function cropTo(src, w, h, fx = 0.5, fy = 0.5, tag = '') {
  const key = path.basename(src).replace(/\.\w+$/, '') + `_${Math.round(w * 100)}x${Math.round(h * 100)}_${fx}_${fy}${tag}.jpg`;
  const f = path.join(BUILD, key);
  if (!fs.existsSync(f)) {
    const img = sharp(src);
    const m = await img.metadata();
    const ar = w / h;
    let cw = m.width, ch = Math.round(m.width / ar);
    if (ch > m.height) { ch = m.height; cw = Math.round(m.height * ar); }
    const left = Math.round((m.width - cw) * fx), top = Math.round((m.height - ch) * fy);
    await sharp(src).extract({ left, top, width: cw, height: ch }).resize({ width: Math.min(cw, 2400) }).jpeg({ quality: 86 }).toFile(f);
  }
  return f;
}
async function gradient(name, stops, dir = 'h') {
  const f = path.join(BUILD, `grad_${name}.png`);
  if (!fs.existsSync(f)) {
    const [x2, y2] = dir === 'h' ? ['1', '0'] : ['0', '1'];
    const st = stops.map(([o, a]) => `<stop offset="${o}" stop-color="#0A0F1C" stop-opacity="${a}"/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="${x2}" y2="${y2}">${st}</linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(f);
  }
  return f;
}
const fileExists = (f) => fs.existsSync(f);

function iconCircle(slide, icon, x, y, d, fill, name) {
  slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill }, objectName: `${name} circle` });
  slide.addImage({ path: icon, x: x + d * 0.22, y: y + d * 0.22, w: d * 0.56, h: d * 0.56, objectName: `${name} icon`, altText: name });
}
function card(slide, x, y, w, h, name, fill = CARD) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: 0.12, fill: { color: fill }, line: { color: '24304D', width: 0.75 }, objectName: name,
    shadow: { type: 'outer', color: '000000', blur: 10, offset: 3, angle: 90, opacity: 0.35 },
  });
}
function txt(slide, text, o) {
  slide.addText(text, { isTextBox: true, margin: 0, fontFace: THEME.bodyFontFace, ...o });
}
function frame(slide, file, x, y, w, h, name) {
  slide.addImage({ path: file, x, y, w, h, objectName: name, altText: name, shadow: { type: 'outer', color: '000000', blur: 14, offset: 4, angle: 90, opacity: 0.45 } });
}

// ───────────────────────── slides ─────────────────────────
async function build() {
  const heroSrc = fileExists(FIG('blender_hero.png')) ? FIG('blender_hero.png') : A('shot_overview_baseline.jpg');
  const closeSrc = fileExists(FIG('blender_street.png')) ? FIG('blender_street.png') : A('shot_protected_overview.jpg');
  const gLeft = await gradient('left', [[0, 0.96], [0.38, 0.86], [0.62, 0.35], [0.85, 0]]);
  const gTop = await gradient('top', [[0, 0.88], [0.2, 0.55], [0.38, 0]], 'v');
  const gBottom = await gradient('bottom', [[0.55, 0], [0.78, 0.7], [1, 0.95]], 'v');

  // 1 ─ Title
  pres.addSection({ title: 'Introduction' });
  let s = pres.addSlide({ masterName: 'TITLE', sectionTitle: 'Introduction' });
  s.addImage({ path: await cropTo(heroSrc, W, H, 0.6, 0.5), x: 0, y: 0, w: W, h: H, objectName: 'Hero render', altText: '3-D digital twin of the building with the Wi-Fi danger zone on the street' });
  s.addImage({ path: gLeft, x: 0, y: 0, w: W, h: H, objectName: 'Readability gradient', altText: 'Decorative gradient overlay' });
  txt(s, 'COURSE PROJECT  ·  WIRELESS COMMUNICATION SYSTEMS & SECURITY', { x: 0.7, y: 1.55, w: 8, h: 0.35, fontSize: 12, bold: true, color: HEX.accent1, charSpacing: 2 });
  s.addText('Wireless Attack Surface Digital Twin', { placeholder: 'title' });
  s.addText('Where can an outside attacker reach a building’s Wi-Fi from — and how far can we shrink that zone?', { placeholder: 'body' });
  txt(s, [
    { text: 'Owais Abu Salah', options: { bold: true, color: 'FFFFFF', breakLine: true } },
    { text: 'Student ID 12610830  ·  November 2026', options: { color: HEX.lt2 } },
  ], { x: 0.7, y: 5.55, w: 6, h: 0.8, fontSize: 16, valign: 'top' });
  s.addNotes('Introduce yourself and the question: Wi-Fi radiates beyond the walls of a building, so the real question for security is not only HOW an attack works but WHERE an attacker can stand to launch it. This project builds a 3-D digital twin of a faculty building, simulates the radio propagation and turns it into a map of the attack surface.');

  // 2 ─ The problem
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Introduction' });
  s.addText('Wi-Fi does not stop at the wall', { placeholder: 'title' });
  const stats2 = [
    [NUM.link.rss.toFixed(0) + ' dBm', 'received at the café across the street, ' + NUM.link.d.toFixed(0) + ' m from the AP, through a single wall', HEX.accent2],
    ['+' + NUM.link.margin.toFixed(0) + ' dB', 'margin above what an attacker’s USB Wi-Fi adapter needs to capture traffic', HEX.accent3],
    [Math.floor(NUM.base.street) + ' %', 'of University Street and its sidewalks lies inside the eavesdropping zone', HEX.accent4],
  ];
  stats2.forEach(([big, small, col], i) => {
    const y = 1.45 + i * 1.75;
    txt(s, big, { x: 0.6, y, w: 4.6, h: 0.85, fontSize: 48, bold: true, color: col, objectName: `Stat ${i + 1}` });
    txt(s, small, { x: 0.6, y: y + 0.85, w: 4.4, h: 0.7, fontSize: 15, color: HEX.lt2, valign: 'top' });
  });
  frame(s, await cropTo(A('shot_street.jpg'), 7.3, 5.45, 0.5, 0.45), 5.45, 1.3, 7.3, 5.45, 'Street view from the café');
  s.addNotes('This is the view from the café terrace across the street. The access point of the department office hangs next to a window. Between it and the attacker there is exactly one wall. The received power at the café is about -58 dBm — stronger than in many offices. A cheap USB adapter needs about -92 dBm, so the attacker has a margin of 34 dB.');

  // 3 ─ Idea
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Introduction' });
  s.addText('Studying where an attack can be launched from', { placeholder: 'title' });
  const pillars = [
    ['wifi', HEX.accent1, 'Radio physics', 'How the signal penetrates walls, windows and floor slabs — and how far it leaks outdoors.'],
    ['target', HEX.accent2, 'Attack feasibility', 'Turn received power into capability: where eavesdropping, deauthentication or an Evil Twin actually work.'],
    ['shield', HEX.accent5, 'Countermeasures', 'Apply protections live, watch the danger zone shrink and keep an eye on indoor coverage.'],
  ];
  for (const [i, [ic, col, t, d]] of pillars.entries()) {
    const x = 0.6 + i * 4.1;
    card(s, x, 1.55, 3.85, 3.6, `Pillar ${t}`);
    iconCircle(s, await iconPng(ic, '#0A0F1C'), x + 0.35, 1.9, 0.85, col, t);
    txt(s, t, { x: x + 0.35, y: 2.95, w: 3.2, h: 0.5, fontSize: 22, bold: true, color: 'FFFFFF' });
    txt(s, d, { x: x + 0.35, y: 3.5, w: 3.2, h: 1.5, fontSize: 15, color: HEX.lt2, valign: 'top' });
  }
  card(s, 0.6, 5.5, 12.1, 1.1, 'Statement', CARD2);
  txt(s, [
    { text: 'Typical projects study the attack itself. ', options: { color: HEX.lt2 } },
    { text: 'This one studies the attack surface in space — and how to shrink it.', options: { color: 'FFFFFF', bold: true } },
  ], { x: 0.95, y: 5.5, w: 11.5, h: 1.1, fontSize: 18, valign: 'middle' });
  s.addNotes('Three parts: the physics of propagation, the translation into attack feasibility, and the countermeasures with their trade-offs.');

  // 4 ─ Architecture
  pres.addSection({ title: 'Method' });
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Method' });
  s.addText('One data file drives three engines', { placeholder: 'title' });
  card(s, 0.6, 2.35, 2.9, 2.6, 'Data file card', CARD2);
  iconCircle(s, await iconPng('file', '#0A0F1C'), 0.9, 2.6, 0.7, HEX.accent1, 'Data');
  txt(s, 'building.json', { x: 0.9, y: 3.4, w: 2.5, h: 0.45, fontSize: 20, bold: true, color: 'FFFFFF' });
  txt(s, `${NUM.model.walls} walls · ${NUM.model.materials} materials · ${NUM.model.rooms} rooms · AP mounts · ${NUM.model.clients} clients · protections`, { x: 0.9, y: 3.85, w: 2.45, h: 1.0, fontSize: 13, color: HEX.lt2, valign: 'top' });
  const engines = [
    ['cube', 'Blender', '3-D model and photoreal renders', HEX.accent4],
    ['ray', 'NVIDIA Sionna RT', 'Ray tracing: reflection + transmission on ITU-R P.2040 materials — the physics reference', HEX.accent6],
    ['bolt', 'Three.js + GLSL', 'Real-time multi-wall model on the GPU, interactive twin in the browser', HEX.accent1],
  ];
  const outs = ['Renders for slides and report', 'Validation and calibration', 'Live demo — GitHub Pages'];
  for (const [i, [ic, t, d, col]] of engines.entries()) {
    const y = 1.45 + i * 1.8;
    // shapes need non-negative extents: an upward arrow is a flipped line
    const dy = y + 0.75 - 3.65;
    s.addShape(pres.shapes.LINE, {
      x: 3.5, y: dy < 0 ? y + 0.75 : 3.65, w: 0.9, h: Math.max(Math.abs(dy), 0.001), flipV: dy < 0,
      line: { color: '3A4766', width: 1.5, endArrowType: 'triangle' }, objectName: `Arrow to ${t}`,
    });
    card(s, 4.45, y, 4.6, 1.5, `Engine ${t}`);
    iconCircle(s, await iconPng(ic, '#0A0F1C'), 4.7, y + 0.35, 0.8, col, t);
    txt(s, t, { x: 5.7, y: y + 0.18, w: 3.2, h: 0.45, fontSize: 19, bold: true, color: 'FFFFFF' });
    txt(s, d, { x: 5.7, y: y + 0.62, w: 3.25, h: 0.8, fontSize: 13, color: HEX.lt2, valign: 'top' });
    s.addShape(pres.shapes.LINE, { x: 9.05, y: y + 0.75, w: 0.6, h: 0, line: { color: '3A4766', width: 1.5, endArrowType: 'triangle' }, objectName: `Arrow from ${t}` });
    card(s, 9.7, y + 0.2, 3.0, 1.1, `Output ${i + 1}`, CARD2);
    txt(s, outs[i], { x: 9.95, y: y + 0.2, w: 2.6, h: 1.1, fontSize: 15, bold: true, color: col, valign: 'middle' });
  }
  s.addNotes('Everything is generated from one JSON file: walls with their 3-D extent, openings and material, the access point mounts, the client devices and the protections. Blender builds the visual model, Sionna RT ray-traces the same geometry as the physics reference, and the browser twin evaluates an engineering model in real time on the GPU.');

  // 5 ─ The twin
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Method' });
  s.addText('The twin: a three-storey faculty building', { placeholder: 'title' });
  frame(s, await cropTo(A('shot_explode.jpg'), 6.6, 5.4, 0.55, 0.55), 0.6, 1.35, 6.6, 5.4, 'Exploded floors with the heat map');
  const rows = [
    [{ text: 'Material', options: { bold: true, color: HEX.accent1 } }, { text: '2.4 GHz', options: { bold: true, color: HEX.accent1, align: 'right' } }, { text: '5 GHz', options: { bold: true, color: HEX.accent1, align: 'right' } }],
    ...NUM.materials.map(([m, a, b]) => [{ text: m }, { text: `${a} dB`, options: { align: 'right' } }, { text: `${b} dB`, options: { align: 'right' } }]),
  ];
  txt(s, '36 × 16 m · 3 floors · 37 rooms · 8 client devices · AP on floor 1 next to a street window', { x: 7.55, y: 1.35, w: 5.15, h: 0.75, fontSize: 15, color: 'FFFFFF', valign: 'top' });
  s.addTable(rows, {
    x: 7.55, y: 2.25, w: 5.15, colW: [3.15, 1.0, 1.0], fontSize: 13, color: HEX.lt2, fontFace: THEME.bodyFontFace,
    border: { type: 'solid', pt: 0.5, color: '24304D' }, fill: { color: CARD }, rowH: 0.36, margin: [0.03, 0.1, 0.03, 0.1], objectName: 'Material loss table',
  });
  txt(s, 'Through-wall losses (dB) — typical planning values consistent with ITU-R P.2040; calibrated later against Sionna RT.', { x: 7.55, y: 5.95, w: 5.15, h: 0.7, fontSize: 11, color: MUTED, valign: 'top' });
  s.addNotes('The building has a south facade on University Street, a concrete stair and elevator core, brick corridor walls and drywall partitions. Each wall carries its openings: windows, doors and the glass curtain wall of the lobby. The table lists the through-wall losses used by the real-time model.');

  // 6 ─ Propagation model
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Method' });
  s.addText('Propagation model: multi-wall, evaluated on the GPU', { placeholder: 'title' });
  card(s, 0.6, 1.4, 6.3, 1.45, 'Equation card', CARD2);
  txt(s, 'PL = 20 log₁₀ f + 32.44 + 10 n log₁₀ d + ΣL_wall + ΣL_slab', { x: 0.85, y: 1.5, w: 5.95, h: 0.7, fontSize: 14.5, bold: true, color: 'FFFFFF', valign: 'middle', fontFace: 'Cambria' });
  txt(s, 'RSS = P_tx + G_tx(θ, φ) + G_rx − PL      (COST-231 multi-wall, n = 2)', { x: 0.85, y: 2.25, w: 5.9, h: 0.45, fontSize: 14, color: HEX.lt2 });
  const bul6 = [
    '3-D ray–wall intersection: windows, doors and curtain walls are cut-outs with their own material',
    'Floor slabs crossed only inside the building footprint',
    'Antennas: half-wave dipole or 3GPP TR 38.901 patch (8 dBi, 65°)',
    `≈ 200 000 map cells per update in about ${NUM.gpuMs} ms on an RTX 3060`,
    `Same model in GLSL, JavaScript and NumPy — identical to ${NUM.unit.maxErr} dB over ${NUM.unit.links} test links`,
  ];
  txt(s, bul6.map((b, i) => ({ text: b, options: { bullet: { indent: 18 }, breakLine: i < bul6.length - 1, paraSpaceAfter: 8 } })), { x: 0.75, y: 3.15, w: 6.1, h: 3.5, fontSize: 15, color: HEX.lt2, valign: 'top' });
  frame(s, await cropTo(A('shot_top_signal.jpg'), 5.55, 5.3, 0.5, 0.42), 7.15, 1.4, 5.55, 5.3, 'Signal strength map from above');
  s.addNotes('The real-time model is the COST-231 multi-wall model on top of free-space path loss. For every map cell the shader intersects the direct ray with every wall in 3-D: if the crossing point lies inside a window or door opening, the opening material is used. Slabs are added when the ray crosses a floor inside the footprint. The same model exists three times — in the shader, in JavaScript for single links and in Python for batch maps — and the implementations agree exactly.');

  // 7 ─ Attack feasibility
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Method' });
  s.addText('From received power to attack feasibility', { placeholder: 'title' });
  const att = [
    ['eye', HEX.accent3, 'Eavesdropping', 'Passive capture of frames and the WPA2 4-way handshake', 'RSS_AP + G_att ≥ S_att'],
    ['wifiOff', HEX.accent4, 'Deauthentication', 'Forged management frames knock clients offline', 'hears the network and reaches a client at ≥ −88 dBm'],
    ['twin', HEX.accent2, 'Evil Twin', 'Rogue AP with the same SSID lures clients', 'hears the network and beats the real AP at a client by 3 dB (≥ −75 dBm)'],
  ];
  for (const [i, [ic, col, t, d, cond]] of att.entries()) {
    const y = 1.4 + i * 1.42;
    card(s, 0.6, y, 7.6, 1.25, `Attack ${t}`);
    iconCircle(s, await iconPng(ic, '#0A0F1C'), 0.85, y + 0.25, 0.75, col, t);
    txt(s, t, { x: 1.8, y: y + 0.14, w: 2.6, h: 0.45, fontSize: 18, bold: true, color: 'FFFFFF' });
    txt(s, d, { x: 1.8, y: y + 0.58, w: 2.7, h: 0.6, fontSize: 12, color: HEX.lt2, valign: 'top' });
    txt(s, cond, { x: 4.6, y: y + 0.12, w: 3.45, h: 1.0, fontSize: 14, color: col, bold: true, valign: 'middle' });
  }
  txt(s, 'Tiers are nested: an active attack also needs the attacker to hear the network (BSSID, channel, client MACs).', { x: 0.6, y: 5.75, w: 7.6, h: 0.7, fontSize: 13, color: MUTED, valign: 'top' });
  const eqs = [['phone', 'Smartphone', '0 dBi · −85 dBm'], ['laptop', 'USB adapter', '5 dBi · −92 dBm · 27 dBm'], ['yagi', 'Yagi antenna', '15 dBi · −92 dBm · 27 dBm']];
  txt(s, 'Attacker equipment', { x: 8.6, y: 1.4, w: 4.1, h: 0.4, fontSize: 16, bold: true, color: 'FFFFFF' });
  for (const [i, [ic, t, d]] of eqs.entries()) {
    const y = 1.95 + i * 1.2;
    card(s, 8.6, y, 4.1, 1.0, `Equipment ${t}`, CARD2);
    iconCircle(s, await iconPng(ic, '#FFFFFF'), 8.8, y + 0.17, 0.66, '2B3756', t);
    txt(s, t, { x: 9.65, y: y + 0.12, w: 2.9, h: 0.4, fontSize: 16, bold: true, color: 'FFFFFF' });
    txt(s, d, { x: 9.65, y: y + 0.52, w: 2.9, h: 0.38, fontSize: 13, color: HEX.lt2 });
  }
  txt(s, 'Default analysis: USB adapter with a 5 dBi antenna.', { x: 8.6, y: 5.6, w: 4.1, h: 0.5, fontSize: 13, color: MUTED });
  s.addNotes('Signal strength alone is not a security statement, so each outdoor cell is classified. Eavesdropping needs the attacker to hear the access point above the sensitivity of his receiver. Deauthentication needs his forged frames to reach a client. An Evil Twin needs his rogue access point to be stronger than the real one at a client. Path loss is reciprocal, so the GPU computes the client-to-attacker paths with the same model.');

  // 8 ─ Baseline full image
  pres.addSection({ title: 'Results' });
  s = pres.addSlide({ masterName: 'FULL_IMAGE', sectionTitle: 'Results' });
  s.addImage({ path: await cropTo(A('shot_overview_baseline.jpg'), W, H, 0.5, 0.5), x: 0, y: 0, w: W, h: H, objectName: 'Baseline attack surface', altText: 'Danger zone covering the whole street' });
  s.addImage({ path: gTop, x: 0, y: 0, w: W, h: H, objectName: 'Top gradient', altText: 'Decorative gradient overlay' });
  s.addImage({ path: gBottom, x: 0, y: 0, w: W, h: H, objectName: 'Bottom gradient', altText: 'Decorative gradient overlay' });
  s.addText('Baseline: the whole street is attack surface', { placeholder: 'title' });
  const k8 = [
    [NUM.base.areaU.toLocaleString('en-US') + ' m²', 'danger zone outside', HEX.accent2],
    ['> 100 m', 'eavesdropping reach (study area edge)', HEX.accent4],
    [Math.floor(NUM.base.street) + ' %', 'of the street exposed', HEX.accent3],
    [NUM.base.areaT.toLocaleString('en-US') + ' m²', 'Evil Twin zone', HEX.accent2],
  ];
  k8.forEach(([v, l, col], i) => {
    const x = 0.6 + i * 3.08;
    card(s, x, 5.55, 2.85, 1.25, `KPI ${l}`, '0F1729');
    txt(s, v, { x: x + 0.25, y: 5.65, w: 2.5, h: 0.6, fontSize: 28, bold: true, color: col });
    txt(s, l, { x: x + 0.25, y: 6.25, w: 2.5, h: 0.45, fontSize: 13, color: HEX.lt2 });
  });
  s.addNotes('Without any protection, essentially the whole study area of 200 by 140 metres lies in the danger zone of a USB adapter: amber is eavesdropping, orange deauthentication, red hatched the Evil Twin zone near the facade and in the parking lot.');

  // 9 ─ Link budget
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Results' });
  s.addText('The attacker’s link budget from the café', { placeholder: 'title' });
  frame(s, await cropTo(A('shot_street.jpg'), 6.4, 5.35, 0.42, 0.5), 0.6, 1.35, 6.4, 5.35, 'Ray from the AP to the attacker');
  const L = NUM.link;
  const lb = [
    ['AP transmit power', `+${L.ptx.toFixed(1)} dBm`, 'FFFFFF'],
    ['AP antenna gain towards the attacker', `+${L.gTx.toFixed(1)} dBi`, HEX.accent5],
    [`Path loss over ${L.d.toFixed(1)} m`, `−${L.spread.toFixed(1)} dB`, 'FF8FA3'],
    ['Exterior concrete wall (30 cm)', `−${L.wall.toFixed(1)} dB`, 'FF8FA3'],
    ['Attacker antenna (USB, 5 dBi)', `+${L.gRx.toFixed(1)} dBi`, HEX.accent5],
    ['Received power', `${L.rss.toFixed(1)} dBm`, 'FFFFFF'],
    ['Adapter sensitivity', `${L.sens.toFixed(1)} dBm`, HEX.lt2],
    ['Margin', `+${L.margin.toFixed(1)} dB`, HEX.accent2],
  ];
  s.addTable(lb.map(([a, b, col], i) => [
    { text: a, options: { color: i === 5 || i === 7 ? 'FFFFFF' : HEX.lt2, bold: i === 5 || i === 7 } },
    { text: b, options: { color: col, bold: true, align: 'right', fontFace: 'Consolas' } },
  ]), {
    x: 7.35, y: 1.45, w: 5.35, colW: [3.65, 1.7], fontSize: 15, fontFace: THEME.bodyFontFace,
    border: { type: 'solid', pt: 0.5, color: '24304D' }, fill: { color: CARD }, rowH: 0.5, margin: [0.04, 0.12, 0.04, 0.12], objectName: 'Link budget table',
  });
  txt(s, `The only obstacle is one wall. Even a phone (−85 dBm) keeps a margin of ${(L.rss - L.gRx + 85).toFixed(0)} dB.`, { x: 7.35, y: 5.75, w: 5.35, h: 0.8, fontSize: 14, color: HEX.lt2, valign: 'top' });
  s.addNotes('The twin shows the complete link budget for the attacker’s position: transmit power, antenna gain towards him, path loss over 24 metres and one exterior concrete wall of 17 dB. He receives about -58 dBm with a 5 dBi adapter that needs -92 dBm: 34 dB of margin.');

  // 10 ─ Evil twin inside
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Results' });
  s.addText('Evil Twin: the rogue AP wins near the street windows', { placeholder: 'title' });
  frame(s, await cropTo(A('shot_floor_hijack.jpg'), 8.1, 5.35, 0.45, 0.55), 0.6, 1.35, 8.1, 5.35, 'Floor 1 cut-away with hijack zone');
  const s10 = [
    [`${Math.round(NUM.base.hijack)} %`, 'of floor 1 would associate with the rogue AP (purple)', HEX.accent6],
    [`${NUM.link.deauth} / 8`, 'devices can be knocked offline by forged deauthentication', HEX.accent4],
    ['1 wall', 'is all that separates the street from the department office', HEX.accent2],
  ];
  s10.forEach(([v, l, col], i) => {
    const y = 1.45 + i * 1.75;
    txt(s, v, { x: 9.05, y, w: 3.7, h: 0.75, fontSize: 40, bold: true, color: col });
    txt(s, l, { x: 9.05, y: y + 0.75, w: 3.65, h: 0.8, fontSize: 14, color: HEX.lt2, valign: 'top' });
  });
  s.addNotes('Inside, the twin computes where a client would prefer the attacker’s rogue access point: wherever his signal is at least 3 dB stronger than the real one. That is the purple region along the south windows. Diamonds mark the client devices; orange ones can be deauthenticated from the café.');

  // 11 ─ Single measures chart
  pres.addSection({ title: 'Protection' });
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Protection' });
  s.addText('No single measure is enough — and each one has a cost', { placeholder: 'title' });
  const meas = NUM.measures;
  const labels = meas.map((m) => m[0]);
  const chartBase = {
    barDir: 'bar', catAxisOrientation: 'maxMin', valAxisHidden: true, valGridLine: { style: 'none' }, catGridLine: { style: 'none' },
    catAxisLabelColor: 'C3CDDD', catAxisLabelFontSize: 12, catAxisLabelFontFace: '+mn-lt', catAxisLineShow: false,
    showValue: true, dataLabelPosition: 'outEnd', dataLabelColor: 'E9EEF6', dataLabelFontSize: 12, dataLabelFontFace: '+mn-lt',
    showLegend: false, showTitle: true, titleColor: 'FFFFFF', titleFontSize: 15, titleFontFace: '+mn-lt', barGapWidthPct: 45,
  };
  s.addChart(pres.charts.BAR, [{ name: 'Danger zone', labels, values: meas.map((m) => m[1]) }], {
    ...chartBase, x: 0.5, y: 1.3, w: 6.9, h: 5.5, title: 'Danger zone outside (m²)', dataLabelFormatCode: '#,##0',
    chartColors: meas.map((m, i) => (i === 0 ? '6B778F' : i === meas.length - 1 ? '34D399' : 'FF4D6D')), objectName: 'Danger zone chart',
  });
  s.addChart(pres.charts.BAR, [{ name: 'Coverage', labels, values: meas.map((m) => m[2]) }], {
    ...chartBase, x: 7.55, y: 1.3, w: 5.25, h: 5.5, title: 'Indoor coverage ≥ −67 dBm (%)', dataLabelFormatCode: '0.0', valAxisMinVal: 0, valAxisMaxVal: 115,
    chartColors: meas.map((m) => (m[2] >= 95 ? '34D399' : m[2] >= 85 ? 'FFD60A' : 'FF8A00')), objectName: 'Coverage chart', catAxisHidden: true,
  });
  s.addNotes('Each protection on its own: shielding the facade helps, 5 GHz helps the most, but none comes close to closing the street. And several measures hurt indoor coverage: low power, relocation behind the concrete core and 5 GHz all drop coverage well below 95 percent. Two access points at full power cover everything but leak even more. Only the combination works — bottom green bar.');

  // 12 ─ Micro-cells
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Protection' });
  s.addText('Micro-cells: two quiet APs beat one loud one', { placeholder: 'title' });
  frame(s, await cropTo(A('shot_protected_floor.jpg'), 7.6, 5.35, 0.5, 0.5), 0.6, 1.35, 7.6, 5.35, 'Two ceiling APs on floor 1');
  const s12 = [
    [`${NUM.micro.singleBest} %`, 'best coverage a single AP reaches on 5 GHz, at any ceiling position (GPU search)', HEX.accent4],
    [`${NUM.micro.pairBest} %`, `two corridor-ceiling APs on 5 GHz — best of ${NUM.micro.pairs} placements`, HEX.accent5],
    [`${NUM.after.tx} dBm`, 'auto-tuned power that still keeps ≥ 95 % coverage (was 20 dBm)', HEX.accent1],
  ];
  s12.forEach(([v, l, col], i) => {
    const y = 1.45 + i * 1.75;
    txt(s, v, { x: 8.55, y, w: 4.2, h: 0.75, fontSize: 40, bold: true, color: col });
    txt(s, l, { x: 8.55, y: y + 0.75, w: 4.15, h: 0.85, fontSize: 14, color: HEX.lt2, valign: 'top' });
  });
  s.addNotes('5 GHz loses more in every wall, so one access point cannot cover this floor: the best single position reaches 79 percent. The answer from network design is micro-cells — two access points on the corridor ceiling. A GPU search over 450 placements picked the best pair. Because the cells are small, the power can then be cut to ' + NUM.after.tx + ' dBm.');

  // 13 ─ Result
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Protection' });
  s.addText(`Result: −${Math.round((1 - NUM.after.areaU / NUM.base.areaU) * 100)} % attack surface, coverage kept`, { placeholder: 'title' });
  frame(s, await cropTo(A('shot_protected_overview.jpg'), 6.2, 5.35, 0.5, 0.5), 6.5, 1.35, 6.2, 5.35, 'Protected building');
  const ba = [
    ['Danger zone outside', `${NUM.base.areaU.toLocaleString('en-US')} m²`, `${NUM.after.areaU.toLocaleString('en-US')} m²`],
    ['Street exposure', `${Math.floor(NUM.base.street)} %`, `${NUM.after.street.toFixed(0)} %`],
    ['Max leak distance', '> 100 m', `${NUM.after.leak.toFixed(0)} m`],
    ['Indoor coverage', `${r1(NUM.base.cov)} %`, `${r1(NUM.after.cov)} %`],
  ];
  ba.forEach(([l, a, b], i) => {
    const y = 1.35 + i * 1.12;
    card(s, 0.6, y, 5.6, 0.98, `Result ${l}`);
    txt(s, l, { x: 0.85, y: y + 0.08, w: 3, h: 0.35, fontSize: 13, color: HEX.lt2 });
    txt(s, a, { x: 0.85, y: y + 0.4, w: 2.1, h: 0.5, fontSize: 22, bold: true, color: '9AA5B8' });
    txt(s, '→', { x: 2.95, y: y + 0.4, w: 0.5, h: 0.5, fontSize: 22, color: MUTED, align: 'center' });
    txt(s, b, { x: 3.5, y: y + 0.4, w: 2.55, h: 0.5, fontSize: 24, bold: true, color: i === 3 ? HEX.accent5 : HEX.accent1 });
  });
  {
    const sb = SST.find((r) => r.scenario === 'baseline'), sa = SST.find((r) => r.scenario === 'applied');
    if (sb && sa) {
      card(s, 0.6, 5.85, 5.6, 0.95, 'Ray-traced check', '2A1F3D');
      txt(s, [
        { text: 'Ray-traced check (Sionna RT): ', options: { bold: true, color: 'D9B8FF' } },
        { text: `−${Math.round((1 - sa.area_eavesdrop / sb.area_eavesdrop) * 100)} % zone, street ${Math.round(sa.street_exposure)} % — reflections leave a margin the protocol layer must cover.`, options: { color: HEX.lt2 } },
      ], { x: 0.85, y: 5.87, w: 5.2, h: 0.9, fontSize: 13, valign: 'middle' });
    } else {
      txt(s, `Applied: shielding film + paint, two micro-cells, 5 GHz, ${NUM.after.tx} dBm, 802.11w PMF, WPA3-SAE.`, { x: 0.6, y: 5.95, w: 5.6, h: 0.75, fontSize: 13, color: MUTED, valign: 'top' });
    }
  }
  s.addNotes('Combined (shielding film and paint, two ceiling micro-cells, 5 GHz, auto-tuned power, 802.11w and WPA3): in the real-time model the danger zone falls from about 22 500 to under 300 square metres, the street is no longer exposed, and indoor coverage stays above 95 percent. Be honest about the check: the ray tracer, which includes reflections, still finds about 2 700 square metres and part of the street — a reduction of 88 percent rather than 99. That remaining margin is exactly what the protocol layer is for.');

  // 14 ─ Defence in depth
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Protection' });
  s.addText('Defence in depth: RF limits where, protocols limit what', { placeholder: 'title' });
  const ok = (t) => ({ text: t, options: { color: HEX.accent5, bold: true } });
  const part = (t) => ({ text: t, options: { color: HEX.accent3 } });
  const no = (t) => ({ text: t, options: { color: '6B778F' } });
  const hdr = (t) => ({ text: t, options: { bold: true, color: HEX.accent1 } });
  const matrix = [
    [hdr('Attack'), hdr('RF measures (shielding, micro-cells, 5 GHz, power)'), hdr('802.11w PMF'), hdr('WPA3-SAE')],
    [{ text: 'Eavesdropping', options: { bold: true, color: 'FFFFFF' } }, ok(reduction(SST, 'applied') != null ? `Zone shrinks by ${reduction(SST, 'applied')}–${Math.round((1 - NUM.after.areaU / NUM.base.areaU) * 100)} %` : 'Zone shrinks by 99 %'), no('no effect'), part('only encrypted frames remain')],
    [{ text: 'Offline password cracking', options: { bold: true, color: 'FFFFFF' } }, part('fewer places to capture the handshake'), no('no effect'), ok('blocked — SAE resists dictionary attacks')],
    [{ text: 'Deauthentication', options: { bold: true, color: 'FFFFFF' } }, ok('zone shrinks'), ok('blocked — forged frames rejected'), part('PMF is mandatory in WPA3')],
    [{ text: 'Evil Twin', options: { bold: true, color: 'FFFFFF' } }, ok('rogue AP cannot out-shout the real one'), part('no forced disconnects'), ok('blocked — clone cannot complete SAE')],
  ];
  s.addTable(matrix, {
    x: 0.6, y: 1.45, w: 12.1, colW: [2.6, 4.2, 2.5, 2.8], fontSize: 15, color: HEX.lt2, fontFace: THEME.bodyFontFace,
    border: { type: 'solid', pt: 0.5, color: '24304D' }, fill: { color: CARD }, rowH: 0.78, valign: 'middle', margin: [0.05, 0.14, 0.05, 0.14], objectName: 'Defence matrix',
  });
  txt(s, 'Radio measures shrink the area an attacker can use; protocol measures neutralise what he can still do there. Neither is enough alone.', { x: 0.6, y: 5.6, w: 12.1, h: 0.8, fontSize: 16, color: 'FFFFFF', valign: 'top' });
  s.addNotes('Radio measures and protocol measures are complementary. RF shrinks the zone; 802.11w makes forged deauthentication useless; WPA3-SAE removes offline dictionary attacks on captured handshakes and prevents a clone from completing the handshake.');

  // 15 ─ Validation
  pres.addSection({ title: 'Validation' });
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Validation' });
  s.addText('Validation against NVIDIA Sionna RT', { placeholder: 'title' });
  frame(s, await cropTo(A('fig_sionna_baseline_dark.jpg'), 4.25, 3.55, 0.5, 0.5), 0.6, 1.35, 4.25, 3.55, 'Sionna RT radio map');
  frame(s, await cropTo(A('fig_mwm_baseline_dark.jpg'), 4.25, 3.55, 0.5, 0.5), 5.05, 1.35, 4.25, 3.55, 'Multi-wall model radio map');
  txt(s, 'Sionna RT — ray tracing', { x: 0.6, y: 4.98, w: 4.25, h: 0.35, fontSize: 13, bold: true, color: HEX.accent6 });
  txt(s, 'Real-time multi-wall model', { x: 5.05, y: 4.98, w: 4.25, h: 0.35, fontSize: 13, bold: true, color: HEX.accent1 });
  const v = NUM.validation;
  const vstats = [[`${v.floorsRmse} dB`, 'RMSE indoors (floors)'], [`${v.outRmse} dB`, 'RMSE outdoors'], [`${v.bias} dB`, 'mean bias (all cells)']];
  vstats.forEach(([a, b], i) => {
    const y = 1.35 + i * 1.2;
    card(s, 9.6, y, 3.1, 1.05, `Validation ${b}`);
    txt(s, a, { x: 9.85, y: y + 0.08, w: 2.7, h: 0.55, fontSize: 26, bold: true, color: 'FFFFFF' });
    txt(s, b, { x: 9.85, y: y + 0.62, w: 2.7, h: 0.35, fontSize: 13, color: HEX.lt2 });
  });
  txt(s, v.note, { x: 0.6, y: 5.45, w: 12.1, h: 1.2, fontSize: 14, color: HEX.lt2, valign: 'top' });
  s.addNotes('To check the engineering model, the same geometry was ray-traced with NVIDIA Sionna RT on ITU-R P.2040 materials, with reflections and transmission through walls, on the RTX 3060. Indoors the two agree within about 7 dB RMS; outdoors the ray tracer fills the multi-wall shadows with reflections, so the RMSE is larger. Both models agree on the key security finding: at baseline the eavesdropping zone extends beyond the study area.');

  // 15b ─ Ray tracing vs fast model on protections
  {
    const keys = [['shieldWindows', 'Window film'], ['shieldPaint', 'Shielding paint'], ['directional', 'Directional'], ['band5', '5 GHz'], ['allRF', 'Combined RF'], ['applied', 'Applied (app)']]
      .filter(([k]) => reduction(SST, k) != null && reduction(MST, k) != null);
    s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Validation' });
    s.addText('Ray tracing: protections work less well than the fast model says', { placeholder: 'title' });
    s.addChart(pres.charts.BAR, [
      { name: 'Real-time multi-wall model', labels: keys.map((k) => k[1]), values: keys.map(([k]) => reduction(MST, k)) },
      { name: 'NVIDIA Sionna RT', labels: keys.map((k) => k[1]), values: keys.map(([k]) => reduction(SST, k)) },
    ], {
      x: 0.5, y: 1.3, w: 7.6, h: 5.4, barDir: 'col', barGrouping: 'clustered', barGapWidthPct: 60,
      chartColors: ['22D3EE', 'B14CFF'], showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: '0"%"', dataLabelColor: 'E9EEF6', dataLabelFontSize: 11, dataLabelFontFace: '+mn-lt',
      catAxisLabelColor: 'C3CDDD', catAxisLabelFontSize: 12, catAxisLabelFontFace: '+mn-lt', valAxisHidden: true, valAxisMinVal: 0, valAxisMaxVal: 110,
      valGridLine: { style: 'none' }, catGridLine: { style: 'none' }, catAxisLineShow: false,
      showLegend: true, legendPos: 't', legendColor: 'E9EEF6', legendFontSize: 12, legendFontFace: '+mn-lt',
      showTitle: true, title: 'Eavesdropping zone reduction vs baseline', titleColor: 'FFFFFF', titleFontSize: 15, titleFontFace: '+mn-lt', objectName: 'Reduction comparison chart',
    });
    const pts = [
      ['Both agree on the baseline', 'the whole street and > 100 m are exposed in both models.'],
      ['Reflections bypass shielding', 'energy leaving through the windows is reflected around shielded walls and off the ground and the neighbours.'],
      ['Use both tools', 'the fast model to explore and explain, the ray tracer to confirm a design.'],
      ['Hence the protocol layer', 'radio measures alone never close the zone — enable WPA3-SAE and 802.11w everywhere.'],
    ];
    pts.forEach(([t, d], i) => {
      const y = 1.4 + i * 1.32;
      card(s, 8.45, y, 4.25, 1.15, `Finding ${i + 1}`);
      txt(s, t, { x: 8.7, y: y + 0.1, w: 3.85, h: 0.36, fontSize: 15, bold: true, color: i === 3 ? HEX.accent5 : 'FFFFFF' });
      txt(s, d, { x: 8.7, y: y + 0.46, w: 3.9, h: 0.65, fontSize: 12, color: HEX.lt2, valign: 'top' });
    });
    s.addNotes('This is the most important scientific result of the validation. The ray tracer agrees that the unprotected building exposes the whole street, but it shows that several protections shrink the zone much less than the fast multi-wall model predicts, because reflections carry energy around shielded parts of the facade. The fast model is the right tool for interaction and explanation; the ray tracer is the reference for a final design — and the protocol layer remains essential.');
  }

  // 16 ─ Live demo
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Validation' });
  s.addText('Live demo — open it in any browser', { placeholder: 'title' });
  frame(s, await cropTo(A('shot_ui_simple.jpg'), 7.9, 4.45, 0.5, 0.5), 0.6, 1.35, 7.9, 4.45, 'Simple view of the twin: step 2, the attacker');
  const qr = path.join(BUILD, 'qr_live.png');
  await QRCode.toFile(qr, LIVE, { width: 700, margin: 1, color: { dark: '#0A0F1C', light: '#FFFFFF' } });
  card(s, 8.85, 1.35, 3.85, 4.45, 'QR card', CARD2);
  s.addImage({ path: qr, x: 9.5, y: 1.6, w: 2.55, h: 2.55, objectName: 'QR code to live demo', altText: 'QR code: ' + LIVE });
  txt(s, 'Scan to open the twin', { x: 8.85, y: 4.3, w: 3.85, h: 0.4, fontSize: 16, bold: true, color: 'FFFFFF', align: 'center' });
  txt(s, 'owaisabusalah.github.io/wireless-attack-surface-twin', { x: 9.0, y: 4.75, w: 3.55, h: 0.8, fontSize: 12, color: HEX.accent1, align: 'center', valign: 'top', hyperlink: { url: LIVE } });
  const feats = ['Opens as a four-step story: leak → attacker → protection → result', 'One click “Apply protection” · drag the attacker to any spot', 'Detailed mode: 9 protections, map modes, floors · Arabic / English · offline'];
  txt(s, feats.map((f, i) => ({ text: f, options: { bullet: { indent: 18 }, breakLine: i < feats.length - 1, paraSpaceAfter: 4 } })), { x: 0.75, y: 5.95, w: 11.9, h: 0.9, fontSize: 15, color: HEX.lt2, valign: 'top' });
  s.addNotes('Switch to the browser now. The twin opens as a four-step story: the leak, the attacker, the protection and the result, each with a short explanation and live numbers. Press Apply protection in step 3 and watch the zone shrink; drag the attacker to any spot. Detailed mode, top right, opens every control: all protections, map modes, floors and the full link budget. The whole app is a single ' + (fs.statSync(path.join(ROOT, 'docs/index.html')).size / 1048576).toFixed(1) + ' MB HTML file that also works offline.');

  // 17 ─ Limitations
  pres.addSection({ title: 'Conclusion' });
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Conclusion' });
  s.addText('Limitations and next steps', { placeholder: 'title' });
  const nx = [
    ['ruler', HEX.accent3, 'Measure, then calibrate', 'Walk the site with a phone Wi-Fi analyser, log RSSI at known points and fit wall losses and the exponent (scripts included).'],
    ['ray', HEX.accent6, 'Richer real-time physics', 'Add first-order reflections and diffraction to the GPU model, or import Sionna-calibrated material losses.'],
    ['router', HEX.accent1, 'Network-wide optimisation', 'Optimise AP count, positions, power and channels for several floors at once — leak vs coverage as one objective.'],
    ['drone', HEX.accent2, 'New attacker models', 'Elevated attackers (drones, upper floors next door), moving vehicles, Wi-Fi 6E/7 at 6 GHz.'],
  ];
  for (const [i, [ic, col, t, d]] of nx.entries()) {
    const x = 0.6 + (i % 2) * 6.15, y = 1.4 + Math.floor(i / 2) * 2.65;
    card(s, x, y, 5.95, 2.4, `Next ${t}`);
    iconCircle(s, await iconPng(ic, '#0A0F1C'), x + 0.35, y + 0.35, 0.8, col, t);
    txt(s, t, { x: x + 1.4, y: y + 0.38, w: 4.3, h: 0.5, fontSize: 19, bold: true, color: 'FFFFFF' });
    txt(s, d, { x: x + 1.4, y: y + 0.92, w: 4.3, h: 1.35, fontSize: 14, color: HEX.lt2, valign: 'top' });
  }
  s.addNotes('Limitations: the material losses are planning values and the real-time model has no reflections, which is exactly why Sionna RT was used as a reference. The natural next step is a phone survey around the real building to calibrate the twin.');

  // 18 ─ Closing
  s = pres.addSlide({ masterName: 'TITLE', sectionTitle: 'Conclusion' });
  s.addImage({ path: await cropTo(closeSrc, W, H, 0.55, 0.5), x: 0, y: 0, w: W, h: H, objectName: 'Closing image', altText: 'Protected digital twin at dusk' });
  s.addImage({ path: gLeft, x: 0, y: 0, w: W, h: H, objectName: 'Readability gradient', altText: 'Decorative gradient overlay' });
  s.addText('Thank you', { placeholder: 'title' });
  s.addText('Questions?', { placeholder: 'body' });
  txt(s, [
    { text: 'Live demo  ', options: { color: HEX.lt2 } }, { text: 'owaisabusalah.github.io/wireless-attack-surface-twin', options: { color: HEX.accent1, hyperlink: { url: LIVE }, breakLine: true } },
    { text: 'Code  ', options: { color: HEX.lt2 } }, { text: 'github.com/OwaisAbuSalah/wireless-attack-surface-twin', options: { color: HEX.accent1, hyperlink: { url: REPO }, breakLine: true } },
    { text: 'Owais Abu Salah  ·  12610830', options: { color: 'FFFFFF', bold: true } },
  ], { x: 0.7, y: 5.2, w: 7.5, h: 1.3, fontSize: 15, valign: 'top', paraSpaceAfter: 4 });
  s.addNotes('Thank you. Happy to show any part of the twin live.');

  await pres.writeFile({ fileName: OUT });
  const { applyTheme } = require('./theme.js');
  await applyTheme(OUT, THEME);
  console.log('wrote', OUT);
}

build().catch((e) => { console.error(e); process.exit(1); });

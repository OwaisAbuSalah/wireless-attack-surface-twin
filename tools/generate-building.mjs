#!/usr/bin/env node
/**
 * Generates data/building.json — the single source of truth of the digital twin.
 *
 * Every consumer reads this one file:
 *   - web/      Three.js digital twin (geometry + real-time GPU propagation model)
 *   - sim/      Python reference model + NVIDIA Sionna RT ray-traced radio maps
 *   - blender/  Blender scene builder used for the high-quality renders
 *
 * Frame: plan x → east, y → north, z ↑ (metres). Origin = building centre at ground level.
 *
 *   node tools/generate-building.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ───────────────────────────── constants ─────────────────────────────
const FH = 3.6;              // floor-to-floor height
const SLAB = 0.3;            // slab thickness (slab k occupies [z_k - SLAB, z_k])
const X0 = -18, X1 = 18, Y0 = -8, Y1 = 8;
const CS = -1.2, CN = 1.2;   // corridor walls (south / north)

// Through-wall losses (dB, normal incidence) — typical WLAN-planning values, consistent with
// ITU-R P.2040 material properties. They are assumptions of the model and can be calibrated.
const materials = {
  air:          { id: 0,  loss: { '2.4': 0,  '5': 0 },  itu: null,           t: 0,     color: '#000000', name: { en: 'Opening (air)', ar: 'فتحة (هواء)' } },
  ext_concrete: { id: 1,  loss: { '2.4': 17, '5': 26 }, itu: 'concrete',     t: 0.30,  color: '#dcd8cf', name: { en: 'Exterior reinforced concrete, 30 cm', ar: 'خرسانة مسلّحة خارجية 30 سم' } },
  concrete:     { id: 2,  loss: { '2.4': 15, '5': 23 }, itu: 'concrete',     t: 0.25,  color: '#c9c5bc', name: { en: 'Concrete core / shear wall, 25 cm', ar: 'جدار خرساني (نواة) 25 سم' } },
  brick:        { id: 3,  loss: { '2.4': 6,  '5': 10 }, itu: 'brick',        t: 0.20,  color: '#e7e1d6', name: { en: 'Block / brick wall, 20 cm', ar: 'جدار طوب/بلوك 20 سم' } },
  drywall:      { id: 4,  loss: { '2.4': 3,  '5': 4 },  itu: 'plasterboard', t: 0.12,  color: '#f1efe9', name: { en: 'Gypsum drywall partition', ar: 'قاطع جبس (دراي وول)' } },
  ext_glass:    { id: 5,  loss: { '2.4': 3,  '5': 5 },  itu: 'glass',        t: 0.024, color: '#9fc6d8', name: { en: 'Exterior double glazing', ar: 'زجاج خارجي مزدوج' } },
  glass:        { id: 6,  loss: { '2.4': 2,  '5': 3 },  itu: 'glass',        t: 0.012, color: '#bcdbe6', name: { en: 'Interior glass partition', ar: 'قاطع زجاجي داخلي' } },
  wood:         { id: 7,  loss: { '2.4': 3,  '5': 5 },  itu: 'wood',         t: 0.045, color: '#9a6b43', name: { en: 'Wooden door', ar: 'باب خشبي' } },
  metal:        { id: 8,  loss: { '2.4': 26, '5': 32 }, itu: 'metal',        t: 0.003, color: '#8d939b', name: { en: 'Steel (elevator shaft, server-room door)', ar: 'فولاذ (بئر المصعد، باب غرفة الخوادم)' } },
  slab:         { id: 9,  loss: { '2.4': 18, '5': 26 }, itu: 'concrete',     t: 0.30,  color: '#bfbab0', name: { en: 'Reinforced concrete floor slab, 30 cm', ar: 'بلاطة خرسانية 30 سم' } },
  ctx_wall:     { id: 10, loss: { '2.4': 10, '5': 15 }, itu: 'concrete',     t: 0.25,  color: '#a9afb8', name: { en: 'Neighbouring façade (effective)', ar: 'واجهة مبنى مجاور (قيمة فعّالة)' } },
};

const floors = [
  { id: 0, z: 0.0, height: FH, name: { en: 'Ground floor', ar: 'الطابق الأرضي' }, short: 'G' },
  { id: 1, z: 3.6, height: FH, name: { en: 'First floor', ar: 'الطابق الأول' }, short: '1' },
  { id: 2, z: 7.2, height: FH, name: { en: 'Second floor', ar: 'الطابق الثاني' }, short: '2' },
];

// ───────────────────────────── openings ─────────────────────────────
// opening = { sill, head (relative to the wall base), period (0 = single), width, offset, mat }
// u = distance along a→b. Inside the opening when  m = (u - offset) [mod period]  ∈ [0, width]
const WIN  = { sill: 0.9, head: 2.7, period: 3.0, width: 1.8, offset: 0.6, mat: 'ext_glass' };
const CURT = { sill: 0.1, head: 3.25, period: 1.5, width: 1.38, offset: 0.06, mat: 'ext_glass' };
const single = (offset, width, sill, head, mat) => ({ sill, head, period: 0, width, offset, mat });

const walls = [];
const counters = {};
function W(floor, a, b, mat, opening = null, extra = {}) {
  const f = floors[floor];
  const key = `F${floor}`;
  counters[key] = (counters[key] || 0) + 1;
  walls.push({
    id: `${key}-${String(counters[key]).padStart(3, '0')}`,
    floor, a, b,
    z0: f.z, z1: +(f.z + f.height).toFixed(3),
    mat, t: materials[mat].t,
    opening,
    exterior: !!extra.exterior,
    facade: extra.facade ?? null,
  });
}

/** Wall with doors: splits [a,b] (axis aligned) into solid pieces + door pieces. */
function doorWall(floor, a, b, mat, doors) {
  const horizontal = a[1] === b[1];
  const c0 = horizontal ? a[0] : a[1];
  const c1 = horizontal ? b[0] : b[1];
  const pt = (c) => (horizontal ? [c, a[1]] : [a[0], c]);
  const ds = [...doors].sort((p, q) => p.at - q.at);
  let cur = c0;
  for (const d of ds) {
    const w = d.w ?? 1.0;
    const s = d.at - w / 2, e = d.at + w / 2;
    if (s > cur + 1e-6) W(floor, pt(cur), pt(s), mat);
    W(floor, pt(s), pt(e), mat, single(0, w, 0, d.head ?? 2.1, d.mat ?? 'wood'));
    cur = e;
  }
  if (c1 > cur + 1e-6) W(floor, pt(cur), pt(c1), mat);
}

function exteriorShell(floor) {
  const EXT = 'ext_concrete';
  // South façade (street side)
  if (floor === 0) {
    W(floor, [X0, Y0], [-6, Y0], EXT, WIN, { exterior: true, facade: 'S' });
    W(floor, [-6, Y0], [6, Y0], EXT, CURT, { exterior: true, facade: 'S' });   // glass curtain wall + entrance
    W(floor, [6, Y0], [X1, Y0], EXT, WIN, { exterior: true, facade: 'S' });
  } else {
    W(floor, [X0, Y0], [X1, Y0], EXT, WIN, { exterior: true, facade: 'S' });
  }
  // North façade (campus side) — no windows on the stair/elevator core except a stair window
  W(floor, [X0, Y1], [-3, Y1], EXT, WIN, { exterior: true, facade: 'N' });
  W(floor, [-3, Y1], [3, Y1], EXT, single(3.0, 2.2, 0.8, 3.0, 'ext_glass'), { exterior: true, facade: 'N' });
  W(floor, [3, Y1], [X1, Y1], EXT, WIN, { exterior: true, facade: 'N' });
  // East & west façades: one window per room + a tall window at the corridor end
  for (const [x, fac] of [[X1, 'E'], [X0, 'W']]) {
    W(floor, [x, Y0], [x, CS], EXT, single(2.2, 2.4, 0.9, 2.7, 'ext_glass'), { exterior: true, facade: fac });
    W(floor, [x, CS], [x, CN], EXT, single(0.4, 1.6, 0.3, 3.0, 'ext_glass'), { exterior: true, facade: fac });
    W(floor, [x, CN], [x, Y1], EXT, single(2.2, 2.4, 0.9, 2.7, 'ext_glass'), { exterior: true, facade: fac });
  }
}

function core(floor) {
  // Stair + elevator core between x = -3 and x = 3 on the north side
  W(floor, [-3, CN], [-3, Y1], 'concrete');
  W(floor, [3, CN], [3, Y1], 'concrete');
  W(floor, [-3, CN], [-0.8, CN], 'metal');                                   // elevator doors
  W(floor, [-0.8, CN], [3, CN], 'concrete', single(0.3, 3.2, 0, 2.4, 'air')); // open stair entry
  W(floor, [-3, 3.8], [-0.8, 3.8], 'metal');                                 // elevator shaft
  W(floor, [-0.8, CN], [-0.8, 3.8], 'metal');
}

// ── Ground floor ──
exteriorShell(0);
for (const x of [-12, -6, 6, 12]) W(0, [x, Y0], [x, CS], 'brick');
doorWall(0, [X0, CS], [-6, CS], 'brick', [{ at: -15 }, { at: -9 }]);
doorWall(0, [6, CS], [X1, CS], 'brick', [{ at: 9 }, { at: 15 }]);
for (const x of [-12, -6, 12]) W(0, [x, CN], [x, Y1], 'brick');
doorWall(0, [X0, CN], [-3, CN], 'brick', [{ at: -15 }, { at: -9 }, { at: -4.5 }]);
doorWall(0, [3, CN], [X1, CN], 'brick', [{ at: 7.5, w: 1.6 }, { at: 15 }]);
core(0);

// ── First floor (the access point lives here) ──
exteriorShell(1);
W(1, [-6, Y0], [-6, CS], 'brick');
for (const x of [0, 6, 12]) W(1, [x, Y0], [x, CS], 'drywall');
doorWall(1, [X0, CS], [-6, CS], 'brick', [{ at: -16 }, { at: -8 }]);
doorWall(1, [-6, CS], [0, CS], 'brick', [{ at: -1.5 }]);
W(1, [0, CS], [6, CS], 'glass');                                            // glazed meeting room
doorWall(1, [6, CS], [X1, CS], 'brick', [{ at: 10.5 }, { at: 13.5 }]);
W(1, [-12, CN], [-12, Y1], 'concrete');                                     // server room
W(1, [-6, CN], [-6, Y1], 'drywall');
W(1, [12, CN], [12, Y1], 'drywall');
doorWall(1, [X0, CN], [-3, CN], 'brick', [{ at: -15, mat: 'metal' }, { at: -9 }, { at: -4.5 }]);
doorWall(1, [3, CN], [X1, CN], 'brick', [{ at: 7.5 }, { at: 15 }]);
core(1);

// ── Second floor ──
exteriorShell(2);
for (const x of [-12, -6, 0, 6, 12]) W(2, [x, Y0], [x, CS], 'drywall');
doorWall(2, [X0, CS], [X1, CS], 'brick', [-15, -9, -3, 3, 9, 15].map((at) => ({ at })));
for (const x of [-12, -6, 12]) W(2, [x, CN], [x, Y1], 'drywall');
doorWall(2, [X0, CN], [-3, CN], 'brick', [{ at: -15 }, { at: -9 }, { at: -4.5 }]);
doorWall(2, [3, CN], [X1, CN], 'brick', [{ at: 7.5 }, { at: 15 }]);
core(2);

// ───────────────────────────── rooms ─────────────────────────────
const R = (floor, rect, type, en, ar) => ({ floor, rect, type, name: { en, ar } });
const rooms = [
  // Ground
  R(0, [X0, Y0, -12, CS], 'office', 'Security Office', 'مكتب الأمن'),
  R(0, [-12, Y0, -6, CS], 'lab', 'Lab G-02', 'مختبر G-02'),
  R(0, [-6, Y0, 6, CS], 'lobby', 'Main Lobby', 'الردهة الرئيسية'),
  R(0, [6, Y0, 12, CS], 'cafeteria', 'Cafeteria', 'الكافتيريا'),
  R(0, [12, Y0, X1, CS], 'lab', 'Electronics Lab', 'مختبر الإلكترونيات'),
  R(0, [X0, CN, -12, Y1], 'classroom', 'Classroom G-11', 'قاعة G-11'),
  R(0, [-12, CN, -6, Y1], 'classroom', 'Classroom G-12', 'قاعة G-12'),
  R(0, [-6, CN, -3, Y1], 'wc', 'Restrooms', 'دورات المياه'),
  R(0, [-3, CN, 3, Y1], 'core', 'Stairs & Elevator', 'الدرج والمصعد'),
  R(0, [3, CN, 12, Y1], 'workshop', 'Workshop', 'الورشة'),
  R(0, [12, CN, X1, Y1], 'storage', 'Storage', 'المستودع'),
  R(0, [X0, CS, X1, CN], 'corridor', 'Corridor', 'الممر'),
  // First
  R(1, [X0, Y0, -6, CS], 'lecture', 'Lecture Hall 1-01', 'قاعة المحاضرات 1-01'),
  R(1, [-6, Y0, 0, CS], 'office', 'Department Office', 'مكتب القسم'),
  R(1, [0, Y0, 6, CS], 'meeting', 'Meeting Room', 'غرفة الاجتماعات'),
  R(1, [6, Y0, 12, CS], 'lab', 'Network Lab', 'مختبر الشبكات'),
  R(1, [12, Y0, X1, CS], 'office', 'Staff Office', 'مكتب الموظفين'),
  R(1, [X0, CN, -12, Y1], 'server', 'Server Room', 'غرفة الخوادم'),
  R(1, [-12, CN, -6, Y1], 'office', 'Faculty Office', 'مكتب أعضاء الهيئة'),
  R(1, [-6, CN, -3, Y1], 'print', 'Print Room', 'غرفة الطباعة'),
  R(1, [-3, CN, 3, Y1], 'core', 'Stairs & Elevator', 'الدرج والمصعد'),
  R(1, [3, CN, 12, Y1], 'lab', 'Computer Lab', 'مختبر الحاسوب'),
  R(1, [12, CN, X1, Y1], 'office', 'Head of Department', 'رئيس القسم'),
  R(1, [X0, CS, X1, CN], 'corridor', 'Corridor', 'الممر'),
  // Second
  ...[-18, -12, -6, 0, 6, 12].map((x, i) => R(2, [x, Y0, x + 6, CS], 'office', `Office 2-0${i + 1}`, `مكتب 2-0${i + 1}`)),
  R(2, [X0, CN, -12, Y1], 'office', 'Office 2-11', 'مكتب 2-11'),
  R(2, [-12, CN, -6, Y1], 'office', 'Office 2-12', 'مكتب 2-12'),
  R(2, [-6, CN, -3, Y1], 'kitchen', 'Kitchenette', 'مطبخ صغير'),
  R(2, [-3, CN, 3, Y1], 'core', 'Stairs & Elevator', 'الدرج والمصعد'),
  R(2, [3, CN, 12, Y1], 'seminar', 'Seminar Room', 'قاعة السمينار'),
  R(2, [12, CN, X1, Y1], 'lab', 'Graduate Lab', 'مختبر الدراسات العليا'),
  R(2, [X0, CS, X1, CN], 'corridor', 'Corridor', 'الممر'),
];

// ───────────────────────────── context buildings ─────────────────────────────
const context = [
  { id: 'library', rect: [-32, 26, 8, 42], height: 14, name: { en: 'Central Library', ar: 'المكتبة المركزية' }, style: 'campus' },
  { id: 'shops_w', rect: [-46, -46, -9, -32], height: 5.5, name: { en: 'Shops & Café', ar: 'محلات ومقهى' }, style: 'retail' },
  { id: 'shops_e', rect: [11, -46, 48, -32], height: 7, name: { en: 'Commercial Block', ar: 'مجمّع تجاري' }, style: 'retail' },
  { id: 'housing', rect: [-66, -12, -42, 18], height: 12, name: { en: 'Student Housing', ar: 'سكن الطلاب' }, style: 'residential' },
  { id: 'research', rect: [64, -6, 86, 22], height: 9, name: { en: 'Research Centre', ar: 'مركز الأبحاث' }, style: 'campus' },
];
const ctxWalls = [];
for (const c of context) {
  const [x0, y0, x1, y1] = c.rect;
  const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  for (let i = 0; i < 4; i++) {
    ctxWalls.push({
      id: `CTX-${c.id}-${i}`, floor: null, a: pts[i], b: pts[(i + 1) % 4],
      z0: 0, z1: c.height, mat: 'ctx_wall', t: materials.ctx_wall.t,
      opening: null, exterior: true, facade: null, context: c.id,
    });
  }
}

// ───────────────────────────── site (visual context) ─────────────────────────────
const site = {
  ground: { rect: [-100, -70, 100, 70] },
  roads: [
    { id: 'main_street', rect: [-100, -26, 100, -17], lanes: 2, dir: 'x', name: { en: 'University Street', ar: 'شارع الجامعة' } },
    { id: 'side_street', rect: [-38, -17, -30, 70], lanes: 2, dir: 'y', name: { en: 'Campus Road', ar: 'طريق الحرم' } },
    { id: 'parking_access', rect: [31, -17, 37, -12], lanes: 1, dir: 'y' },
  ],
  sidewalks: [
    [-100, -17, -38, -14], [-30, -17, 31, -14], [37, -17, 100, -14],
    [-100, -29, 100, -26],
    [-41, -14, -38, 70], [-30, -14, -27, 70],
  ],
  plaza: [-24, -14, 22, -8],
  walkway: [X0 - 2, Y0 - 2, X1 + 2, Y1 + 2],
  parking: { rect: [24, -12, 58, 18], rows: [
    { y0: -11.5, y1: -6.5, x0: 25.5, x1: 56.5, facing: 'N' },
    { y0: -0.5, y1: 4.5, x0: 25.5, x1: 56.5, facing: 'S' },
    { y0: 4.5, y1: 9.5, x0: 25.5, x1: 56.5, facing: 'N' },
  ], stall: 2.6 },
  cafe_terrace: { rect: [-8, -32, 10, -29], name: { en: 'Café Terrace', ar: 'جلسة المقهى' } },
  lawns: [[-24, 8, 22, 26], [-27, -14, -24, 26], [22, 18, 60, 30]],
};

// Deterministic pseudo-random for reproducible scenery
let seed = 1337;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const trees = [];
for (let x = -96; x <= 96; x += 9) if (!(x > 28 && x < 40) && !(x > -42 && x < -26)) trees.push({ p: [x + rnd() * 1.5, -15.5], s: 0.85 + rnd() * 0.35 });
for (let x = -96; x <= 96; x += 11) if (!(x > -42 && x < -26) && !(x > -10 && x < 12)) trees.push({ p: [x + rnd() * 2, -27.6], s: 0.8 + rnd() * 0.3 });
for (let y = -8; y <= 66; y += 9) { trees.push({ p: [-39.5, y + rnd()], s: 0.9 + rnd() * 0.3 }); trees.push({ p: [-28.5, y + rnd()], s: 0.9 + rnd() * 0.3 }); }
for (const p of [[-22, -11], [-15, -12], [12, -12], [19, -11], [-22, -3], [-22, 5], [20, 2], [20, 10]]) trees.push({ p, s: 0.9 + rnd() * 0.4 });
for (let i = 0; i < 26; i++) {
  const x = -22 + rnd() * 42, y = 11 + rnd() * 13;
  if (Math.abs(x) < 4 && y < 16) continue;
  trees.push({ p: [x, y], s: 0.8 + rnd() * 0.6 });
}
for (let i = 0; i < 10; i++) trees.push({ p: [24 + rnd() * 34, 20 + rnd() * 8], s: 0.8 + rnd() * 0.5 });

const carColors = ['#e8e8ea', '#1f2329', '#9aa3ad', '#b3202a', '#1d4f91', '#2f6b4f', '#d8b25a', '#5a6470', '#f2f2f2', '#11161c'];
const cars = [];
for (const row of site.parking.rows) {
  for (let x = row.x0 + 1.3; x < row.x1; x += site.parking.stall) {
    if (rnd() < 0.68) cars.push({ p: [x, (row.y0 + row.y1) / 2], yaw: row.facing === 'N' ? 90 : -90, color: carColors[Math.floor(rnd() * carColors.length)] });
  }
}
for (let x = -90; x < 95; x += 7 + rnd() * 9) if (!(x > -42 && x < -26) && !(x > 28 && x < 40)) {
  if (rnd() < 0.55) cars.push({ p: [x, -18.2], yaw: 0, color: carColors[Math.floor(rnd() * carColors.length)], parked: true });
}
const traffic = [
  { lane: -20.0, dir: 1, speed: 9, offset: 0 },
  { lane: -20.0, dir: 1, speed: 9, offset: 70 },
  { lane: -23.2, dir: -1, speed: 11, offset: 20 },
  { lane: -23.2, dir: -1, speed: 11, offset: 110 },
];

const lamps = [];
for (let x = -95; x <= 95; x += 18) { lamps.push({ p: [x, -16.6], yaw: -90 }); lamps.push({ p: [x + 9, -26.4], yaw: 90 }); }
for (let y = -6; y <= 66; y += 18) lamps.push({ p: [-29.4, y], yaw: 180 });
for (const p of [[30, -3], [44, -3], [30, 13], [44, 13], [56, 6]]) lamps.push({ p, yaw: 0, kind: 'parking' });
for (const p of [[-10, -10], [10, -10], [-2, 18], [8, 22]]) lamps.push({ p, yaw: 0, kind: 'bollard' });

const cafeTables = [];
for (let x = -6; x <= 8; x += 3.5) cafeTables.push({ p: [x, -30.6], umbrella: true });

// ───────────────────────────── radio scene ─────────────────────────────
const MICRO_POSITIONS = [[-12.0, 0.0, 6.75], [9.0, 0.0, 6.75]];

const router = {
  name: 'Dept-Office AP', ssid: 'ENG-Staff', bssid: '3c:84:6a:1e:52:07',
  floor: 1,
  tx_dbm: 20,
  freq_ghz: 2.4,
  antenna: 'dipole',
  mount: 'wall',
  mounts: {
    // `patch` = the directional antenna used on this mount (3GPP TR 38.901 element pattern)
    wall:    { pos: [-3.0, -7.55, 5.8], az_deg: 90, tilt_deg: -10, patch: { gmax_dbi: 8, hpbw_deg: 65, sla_db: 30 }, name: { en: 'Wall, next to the street window', ar: 'على الجدار بجانب نافذة الشارع' } },
    ceiling: { pos: [0.0, 0.0, 6.75], az_deg: 90, tilt_deg: -90, patch: { gmax_dbi: 5.5, hpbw_deg: 110, sla_db: 25 }, name: { en: 'Ceiling, building centre', ar: 'السقف في منتصف المبنى' } },
    // micro-cell design: two ceiling APs (positions chosen by a GPU search that maximises the 5th-percentile RSS)
    micro:   { positions: MICRO_POSITIONS, pos: MICRO_POSITIONS[0], az_deg: 90, tilt_deg: -90, patch: { gmax_dbi: 5.5, hpbw_deg: 110, sla_db: 25 }, name: { en: 'Two ceiling micro-cells', ar: 'خليّتان صغيرتان في السقف' } },
  },
};

const clients = [
  { id: 'c1', name: { en: 'Staff laptop', ar: 'حاسوب موظف' }, kind: 'laptop', pos: [-4.2, -4.6, 4.4] },
  { id: 'c2', name: { en: 'Meeting tablet', ar: 'جهاز لوحي' }, kind: 'tablet', pos: [3.0, -5.2, 4.4] },
  { id: 'c3', name: { en: 'Lab workstation', ar: 'حاسوب المختبر' }, kind: 'desktop', pos: [9.2, -4.0, 4.4] },
  { id: 'c4', name: { en: 'Staff phone', ar: 'هاتف موظف' }, kind: 'phone', pos: [15.6, -5.6, 4.4] },
  { id: 'c5', name: { en: 'Student laptop', ar: 'حاسوب طالب' }, kind: 'laptop', pos: [7.6, 5.0, 4.4] },
  { id: 'c6', name: { en: 'Faculty laptop', ar: 'حاسوب عضو هيئة' }, kind: 'laptop', pos: [-9.0, 5.2, 4.4] },
  { id: 'c7', name: { en: 'Lecturer laptop', ar: 'حاسوب المحاضر' }, kind: 'laptop', pos: [-12.0, -3.2, 4.4] },
  { id: 'c8', name: { en: 'Network printer (IoT)', ar: 'طابعة شبكية (IoT)' }, kind: 'printer', pos: [-4.6, 6.4, 4.5] },
];

const rf = {
  model: 'COST-231 Multi-Wall + log-distance, 3-D wall/slab intersection, antenna patterns',
  pathloss_exponent: 2.0,
  min_distance_m: 0.5,
  freqs_ghz: [2.4, 5.0],
  rx_height_outdoor: 1.5,
  rx_height_indoor: 1.2,
  slab_planes: floors.slice(1).map((f) => +(f.z - SLAB / 2).toFixed(3)).concat([+(floors.at(-1).z + FH - SLAB / 2).toFixed(3)]),
  slab_extent: [X0, Y0, X1, Y1],
  grids: {
    outdoor: { x0: -100, y0: -70, x1: 100, y1: 70, z: 1.5, cell_realtime: 0.4, cell_sionna: 1.0 },
    floor:   { x0: -18.5, y0: -8.5, x1: 18.5, y1: 8.5, dz: 1.2, cell_realtime: 0.2, cell_sionna: 0.25 },
  },
};

const attack = {
  equipment: {
    phone: { name: { en: 'Smartphone', ar: 'هاتف ذكي' }, gain_dbi: 0, sens_dbm: -85, tx_dbm: 15 },
    usb:   { name: { en: 'USB adapter + 5 dBi antenna', ar: 'محوّل USB + هوائي 5 dBi' }, gain_dbi: 5, sens_dbm: -92, tx_dbm: 27 },
    yagi:  { name: { en: 'Yagi directional, 15 dBi', ar: 'هوائي ياجي اتجاهي 15 dBi' }, gain_dbi: 15, sens_dbm: -92, tx_dbm: 27 },
  },
  default_equipment: 'usb',
  client: { gain_dbi: 0, sens_dbm: -88 },
  evil_twin: { margin_db: 3, min_rss_dbm: -75 },
  coverage_dbm: -67,
  start: [1.0, -30.8],
};

const protections = {
  lowPower:      { tx_dbm: 12 },
  directional:   { antenna: 'patch', gmax_dbi: 8, hpbw_deg: 65, sla_db: 30 },
  relocate:      { mount: 'ceiling' },
  microcells:    { mount: 'micro' },
  shieldWindows: { material: 'ext_glass', extra_db: { '2.4': 25, '5': 28 } },
  shieldPaint:   { material: 'ext_concrete', extra_db: { '2.4': 20, '5': 24 } },
  band5:         { freq_ghz: 5.0 },
  pmf:           { blocks: ['deauth'] },
  wpa3:          { blocks: ['offline_crack', 'evil_twin'] },
};

// Scenarios pre-computed with Sionna RT (and the Python reference model)
const scenarios = {
  baseline:      { label: { en: 'Baseline', ar: 'الوضع الحالي' }, protections: [] },
  lowPower:      { label: { en: 'Reduced TX power', ar: 'تقليل قدرة الإرسال' }, protections: ['lowPower'] },
  directional:   { label: { en: 'Directional antenna', ar: 'هوائي اتجاهي' }, protections: ['directional'] },
  relocate:      { label: { en: 'Relocated AP', ar: 'نقل الراوتر' }, protections: ['relocate'] },
  shieldWindows: { label: { en: 'Shielding window film', ar: 'عازل النوافذ' }, protections: ['shieldWindows'] },
  shieldPaint:   { label: { en: 'Shielding paint', ar: 'دهان عازل' }, protections: ['shieldPaint'] },
  band5:         { label: { en: '5 GHz band', ar: 'نطاق 5 GHz' }, protections: ['band5'] },
  allRF:         { label: { en: 'Combined RF measures', ar: 'إجراءات الحماية مجتمعة' }, protections: ['relocate', 'shieldWindows', 'shieldPaint', 'band5'] },
  // exactly what "Apply protection" in the web app ends with (RF part): 2 micro-cells, 5 GHz, shielding, auto-tuned 13 dBm
  applied:       { label: { en: 'Applied protection (app)', ar: 'الحماية المطبّقة في التطبيق' }, protections: ['microcells', 'shieldWindows', 'shieldPaint', 'band5'], tx_dbm: 13 },
};

const out = {
  $schema_version: 1,
  generated_by: 'tools/generate-building.mjs',
  name: { en: 'Faculty of Engineering — Block C', ar: 'كلية الهندسة — المبنى C' },
  frame: 'plan x→east, y→north, z↑ up, metres; origin = building centre at ground level; azimuth measured from +x towards +y',
  footprint: [X0, Y0, X1, Y1],
  slab_thickness: SLAB,
  floors,
  materials,
  walls: [...walls, ...ctxWalls],
  rooms,
  context,
  site: { ...site, trees, cars, traffic, lamps, cafe_tables: cafeTables },
  router,
  clients,
  rf,
  attack,
  protections,
  scenarios,
};

mkdirSync(resolve(root, 'data'), { recursive: true });
writeFileSync(resolve(root, 'data/building.json'), JSON.stringify(out, null, 1));
console.log(`building.json: ${walls.length} building walls + ${ctxWalls.length} context walls, ${rooms.length} rooms, ${clients.length} clients, ${trees.length} trees, ${cars.length} cars`);

// Procedural building from data/building.json: walls with cut openings, glass, frames,
// doors, slabs, roof, stairs and light furnishing. One group per floor so floors can be
// isolated, cut away (clipping plane) or exploded.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { B, WALLS, FLOORS, FOOT, SLAB_T } from '../data.js';
import { P } from './world.js';
import { tex, boxMapUV } from './textures.js';

const FINISH = {
  corridor: '#d8d3c9', office: '#c8b292', lab: '#b9c0c6', lecture: '#b59f84', lobby: '#ebe7df', cafeteria: '#c3a37d',
  server: '#8f98a1', wc: '#cdd6d8', core: '#bdb6ab', classroom: '#c0aa8a', workshop: '#a7a8a6', storage: '#b1aaa0',
  meeting: '#c8b292', print: '#c6c0b6', kitchen: '#d2c8ba', seminar: '#bda687',
};

// texture tile size (metres) per material key for world-space box mapping
const TILE = { ext_concrete: [3, 3.6], band: [3, 3.6], plinth: [1.2, 1.2], slab: [3, 3.6], roof: [2, 2], floor: [1.2, 1.2], concrete: [2, 2], brick: [2, 2], drywall: [2, 2] };

function makeMats(plane) {
  const clip = plane ? { clippingPlanes: [plane], clipShadows: true } : {};
  const std = (o) => new THREE.MeshStandardMaterial({ ...o, ...clip });
  const C = tex('concrete'), PL = tex('plaster'), RF = tex('roof'), FL = tex('floor'), ST = tex('stone');
  const nScale = (k) => new THREE.Vector2(k, k);
  const glassLit = new THREE.MeshPhysicalMaterial({
    color: '#5d7a8c', roughness: 0.03, metalness: 0.35, transparent: true, opacity: 0.55,
    envMapIntensity: 1.8, emissive: '#ffcf8f', emissiveIntensity: 0.0, depthWrite: false, side: THREE.DoubleSide,
    specularIntensity: 1, ...clip,
  });
  // per-pane "lit room behind the window" factor (vertex attribute `lit`)
  glassLit.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float lit;\nvarying float vLit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLit = lit;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLit;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vLit;\ndiffuseColor.a = mix(diffuseColor.a, 0.82, step(0.5, vLit) * step(0.01, emissive.r));');
  };
  glassLit.customProgramCacheKey = () => 'glassLit';
  return {
    ext_concrete: std({ map: C.map, normalMap: C.normalMap, roughnessMap: C.roughnessMap, normalScale: nScale(0.9), color: '#ffffff', roughness: 1 }),
    band: std({ map: C.map, normalMap: C.normalMap, color: '#f4efe6', roughness: 0.75 }),
    plinth: std({ map: ST.map, normalMap: ST.normalMap, roughnessMap: ST.roughnessMap, color: '#8d867c', roughness: 1 }),
    concrete: std({ map: PL.map, normalMap: PL.normalMap, color: '#d9d4cb', roughness: 0.9 }),
    brick: std({ map: PL.map, normalMap: PL.normalMap, color: '#efe9df', roughness: 0.9 }),
    drywall: std({ map: PL.map, normalMap: PL.normalMap, color: '#f7f5f0', roughness: 0.92 }),
    metal: std({ color: '#a3aab2', roughness: 0.32, metalness: 0.8 }),
    frame: std({ color: '#262b33', roughness: 0.4, metalness: 0.7 }),
    shade: std({ color: '#c9ced3', roughness: 0.35, metalness: 0.75 }),
    wood: std({ color: '#9b6b44', roughness: 0.55 }),
    slab: std({ map: C.map, normalMap: C.normalMap, color: '#e2ddd3', roughness: 0.88 }),
    roof: std({ map: RF.map, normalMap: RF.normalMap, roughnessMap: RF.roughnessMap, color: '#ffffff', roughness: 1 }),
    ext_glass: glassLit,
    glass: new THREE.MeshPhysicalMaterial({
      color: '#c4e2ee', roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.2,
      envMapIntensity: 1.0, depthWrite: false, side: THREE.DoubleSide, ...clip,
    }),
    desk: std({ color: '#cdb38f', roughness: 0.6 }),
    dark: std({ color: '#30353d', roughness: 0.6 }),
    screen: std({ color: '#0b1220', roughness: 0.3, emissive: '#5fb7ff', emissiveIntensity: 0.6 }),
    rack: std({ color: '#1c2026', roughness: 0.5, metalness: 0.4, emissive: '#00ffa0', emissiveIntensity: 0.0 }),
    floor: std({ vertexColors: true, map: FL.map, normalMap: FL.normalMap, roughnessMap: FL.roughnessMap, roughness: 1 }),
  };
}

let paneSeed = 99;
const paneRnd = () => ((paneSeed = (paneSeed * 16807) % 2147483647) / 2147483647);

class Accum {
  constructor() { this.by = new Map(); }
  box(key, w, h, d, m4, color) {
    if (w < 1e-3 || h < 1e-3 || d < 1e-3) return;
    const g = new THREE.BoxGeometry(w, h, d);
    g.applyMatrix4(m4);
    if (color) {
      const c = new THREE.Color(color);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    if (key === 'ext_glass') {
      const lit = new Float32Array(g.attributes.position.count).fill(paneRnd() < 0.62 ? 0.55 + paneRnd() * 0.9 : 0.04);
      g.setAttribute('lit', new THREE.BufferAttribute(lit, 1));
    }
    if (!this.by.has(key)) this.by.set(key, []);
    this.by.get(key).push(g);
  }
  build(mats, group, { cast = true } = {}) {
    for (const [key, list] of this.by) {
      const geo = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (TILE[key]) boxMapUV(geo, ...TILE[key]);
      const mesh = new THREE.Mesh(geo, mats[key]);
      const transparent = key.includes('glass');
      mesh.castShadow = cast && !transparent;
      mesh.receiveShadow = !transparent;
      mesh.name = key;
      if (transparent) mesh.renderOrder = 2;
      group.add(mesh);
    }
  }
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);

/** Matrix for a piece on wall w: along-wall [s0,s1], height [h0,h1] (relative to z0), offset across. */
function wallMatrix(w, s0, s1, h0, h1, across = 0) {
  const dx = (w.b[0] - w.a[0]) / w.len, dy = (w.b[1] - w.a[1]) / w.len;
  const sc = (s0 + s1) / 2;
  const x = w.a[0] + dx * sc - dy * across, y = w.a[1] + dy * sc + dx * across;
  _q.setFromAxisAngle(_up, Math.atan2(dy, dx));
  return _m.compose(P(x, y, w.z0 + (h0 + h1) / 2), _q, _s).clone();
}

function openIntervals(o, sStart, sEnd) {
  const out = [];
  const push = (a, b) => { a = Math.max(a, sStart); b = Math.min(b, sEnd); if (b - a > 1e-3) out.push([a, b]); };
  if (o.period > 0) {
    const k0 = Math.floor((sStart - o.offset) / o.period) - 1, k1 = Math.ceil((sEnd - o.offset) / o.period) + 1;
    for (let k = k0; k <= k1; k++) push(o.offset + k * o.period, o.offset + k * o.period + o.width);
  } else push(o.offset, o.offset + o.width);
  return out.sort((p, q) => p[0] - q[0]);
}

function addWall(acc, w) {
  const H = w.z1 - w.z0, t = Math.max(w.t, 0.06);
  let sStart = 0, sEnd = w.len;
  if (w.exterior && w.floor !== null) {
    const corner = (p) => (p[0] === FOOT[0] || p[0] === FOOT[2]) && (p[1] === FOOT[1] || p[1] === FOOT[3]);
    if (corner(w.a)) sStart = -t / 2;
    if (corner(w.b)) sEnd = w.len + t / 2;
  }
  const base = w.mat === 'metal' ? 'metal' : w.mat;
  if (!w.open) { acc.box(base, sEnd - sStart, H, t, wallMatrix(w, sStart, sEnd, 0, H)); return; }
  const o = w.open;
  const ivs = openIntervals(o, sStart, sEnd);
  const curtain = o.period > 0 && o.width / o.period > 0.8;
  let cur = sStart;
  for (const [a, b] of ivs) {
    if (a > cur + 1e-3) acc.box(curtain ? 'frame' : base, a - cur, H, curtain ? 0.14 : t, wallMatrix(w, cur, a, 0, H));
    if (o.sill > 0.01) acc.box(base, b - a, o.sill, t, wallMatrix(w, a, b, 0, o.sill));
    if (o.head < H - 0.01) acc.box(base, b - a, H - o.head, t, wallMatrix(w, a, b, o.head, H));
    const hh = o.head - o.sill;
    if (o.mat === 'ext_glass' || o.mat === 'glass') {
      acc.box(o.mat, b - a, hh, 0.03, wallMatrix(w, a, b, o.sill, o.head));
      const f = 0.055, fd = Math.min(t, 0.12);
      acc.box('frame', b - a, f, fd, wallMatrix(w, a, b, o.sill, o.sill + f));
      acc.box('frame', b - a, f, fd, wallMatrix(w, a, b, o.head - f, o.head));
      acc.box('frame', f, hh, fd, wallMatrix(w, a, a + f, o.sill, o.head));
      acc.box('frame', f, hh, fd, wallMatrix(w, b - f, b, o.sill, o.head));
      if (!curtain && b - a > 1.5) acc.box('frame', f * 0.8, hh, fd * 0.8, wallMatrix(w, (a + b) / 2 - f / 2, (a + b) / 2 + f / 2, o.sill, o.head));
    } else if (o.mat === 'wood' || o.mat === 'metal') {
      acc.box(o.mat, b - a - 0.04, hh - 0.02, 0.05, wallMatrix(w, a + 0.02, b - 0.02, 0, hh - 0.02, 0.03));
      acc.box('frame', b - a, 0.05, t + 0.02, wallMatrix(w, a, b, hh - 0.05, hh));
    }
    cur = b;
  }
  if (sEnd > cur + 1e-3) acc.box(curtain ? 'frame' : base, sEnd - cur, H, curtain ? 0.14 : t, wallMatrix(w, cur, sEnd, 0, H));
}

/** Architectural detail on the exterior (visual only — the RF model uses the wall planes). */
function facadeDetails(acc, floor) {
  const [X0, Y0, X1, Y1] = FOOT;
  const z0 = floor.z, z1 = floor.z + floor.height, k = floor.id;
  const o = 0.15; // half wall thickness
  // pier fins every 3 m on the long façades
  for (let i = 1; i < 12; i++) {
    const x = X0 + 3 * i;
    const lobby = k === 0 && x > -6 && x < 6;
    if (!lobby) boxAt(acc, 'band', x - 0.13, Y0 - o - 0.2, x + 0.13, Y0 - o, z0, z1);
    if (!(x > -3.5 && x < 3.5)) boxAt(acc, 'band', x - 0.13, Y1 + o, x + 0.13, Y1 + o + 0.2, z0, z1);
  }
  // corner pilasters
  for (const [x, y] of [[X0, Y0], [X1, Y0], [X0, Y1], [X1, Y1]]) boxAt(acc, 'band', x - 0.32, y - 0.32, x + 0.32, y + 0.32, z0, z1);
  // floor band at the slab line (top of this storey)
  const bz = z1 - 0.38, bt = z1 + 0.02;
  if (k < 2) {
    boxAt(acc, 'band', X0 - 0.25, Y0 - o - 0.08, X1 + 0.25, Y0 - o, bz, bt);
    boxAt(acc, 'band', X0 - 0.25, Y1 + o, X1 + 0.25, Y1 + o + 0.08, bz, bt);
    boxAt(acc, 'band', X0 - o - 0.08, Y0 - 0.25, X0 - o, Y1 + 0.25, bz, bt);
    boxAt(acc, 'band', X1 + o, Y0 - 0.25, X1 + o + 0.08, Y1 + 0.25, bz, bt);
  }
  // plinth
  if (k === 0) {
    boxAt(acc, 'plinth', X0 - 0.22, Y0 - 0.22, -6, Y0 + 0.1, 0, 0.5);
    boxAt(acc, 'plinth', 6, Y0 - 0.22, X1 + 0.22, Y0 + 0.1, 0, 0.5);
    boxAt(acc, 'plinth', X0 - 0.22, Y1 - 0.1, X1 + 0.22, Y1 + 0.22, 0, 0.5);
    boxAt(acc, 'plinth', X0 - 0.22, Y0, X0 + 0.1, Y1, 0, 0.5);
    boxAt(acc, 'plinth', X1 - 0.1, Y0, X1 + 0.22, Y1, 0, 0.5);
  }
  // window sills + south sun-shades on the regular window bays
  for (let i = 0; i < 12; i++) {
    const xa = X0 + 3 * i + 0.6, xb = xa + 1.8;
    const lobby = k === 0 && xb > -6 && xa < 6;
    if (!lobby) {
      boxAt(acc, 'band', xa - 0.06, Y0 - o - 0.14, xb + 0.06, Y0 - o + 0.02, z0 + 0.84, z0 + 0.9);
      boxAt(acc, 'shade', xa - 0.15, Y0 - o - 0.62, xb + 0.15, Y0 - o, z0 + 2.86, z0 + 2.92);
      for (let f = 0; f < 3; f++) boxAt(acc, 'shade', xa - 0.15, Y0 - o - 0.6 + f * 0.2, xb + 0.15, Y0 - o - 0.55 + f * 0.2, z0 + 2.96, z0 + 2.99);
    }
    if (!(xb > -3 && xa < 3)) boxAt(acc, 'band', xa - 0.06, Y1 + o - 0.02, xb + 0.06, Y1 + o + 0.14, z0 + 0.84, z0 + 0.9);
  }
}

const boxAt = (acc, key, x0, y0, x1, y1, z0, z1, color) => {
  _q.identity();
  const m = _m.compose(P((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), _q, _s).clone();
  acc.box(key, Math.abs(x1 - x0), Math.abs(z1 - z0), Math.abs(y1 - y0), m, color);
};

function furnish(acc, room, z) {
  const [x0, y0, x1, y1] = room.rect;
  const w = x1 - x0, d = y1 - y0, cx = (x0 + x1) / 2;
  const south = y1 <= -1.2 + 1e-6;              // south rooms: windows at y0 (street)
  const inset = 0.7;
  const rows = (n, depth, deskW, gap, withScreen) => {
    for (let r = 0; r < n; r++) {
      const yy = south ? y1 - 1.6 - r * gap : y0 + 1.6 + r * gap;
      for (let xx = x0 + inset + deskW / 2; xx < x1 - inset - deskW / 2 + 1e-6; xx += deskW + 0.5) {
        boxAt(acc, 'desk', xx - deskW / 2, yy - depth / 2, xx + deskW / 2, yy + depth / 2, z + 0.72, z + 0.76);
        boxAt(acc, 'dark', xx - deskW / 2 + 0.05, yy - depth / 2 + 0.05, xx + deskW / 2 - 0.05, yy + depth / 2 - 0.05, z, z + 0.72);
        if (withScreen) boxAt(acc, 'screen', xx - 0.28, yy - 0.03, xx + 0.28, yy + 0.03, z + 0.8, z + 1.15);
      }
    }
  };
  switch (room.type) {
    case 'office': case 'meeting': {
      if (room.type === 'meeting' || w >= 6) {
        boxAt(acc, 'desk', cx - 1.4, (y0 + y1) / 2 - 0.6, cx + 1.4, (y0 + y1) / 2 + 0.6, z + 0.72, z + 0.77);
        boxAt(acc, 'dark', cx - 1.3, (y0 + y1) / 2 - 0.5, cx + 1.3, (y0 + y1) / 2 + 0.5, z, z + 0.72);
      }
      const yy = south ? y0 + 1.2 : y1 - 1.2;
      boxAt(acc, 'desk', x0 + 0.6, yy - 0.4, x0 + 2.2, yy + 0.4, z + 0.72, z + 0.76);
      boxAt(acc, 'dark', x0 + 0.7, yy - 0.3, x0 + 2.1, yy + 0.3, z, z + 0.72);
      boxAt(acc, 'dark', x1 - 0.5, y0 + 0.6, x1 - 0.15, y1 - 0.6, z, z + 1.9); // shelf
      break;
    }
    case 'lab': rows(Math.max(1, Math.floor((d - 2.2) / 1.9)), 0.8, 1.6, 1.9, true); break;
    case 'lecture': case 'classroom': case 'seminar': rows(Math.max(1, Math.floor((d - 2.4) / 1.3)), 0.55, 1.4, 1.3, false); break;
    case 'workshop': rows(2, 1.0, 2.2, 2.4, false); break;
    case 'server':
      for (let xx = x0 + 1.2; xx < x1 - 1.0; xx += 0.75)
        for (const yy of [y0 + 2.2, y0 + 4.4]) boxAt(acc, 'rack', xx - 0.3, yy - 0.5, xx + 0.3, yy + 0.5, z, z + 2.0);
      break;
    case 'cafeteria':
      for (let xx = x0 + 1.4; xx < x1 - 0.8; xx += 2.0)
        for (let yy = y0 + 1.4; yy < y1 - 0.8; yy += 2.0) {
          boxAt(acc, 'desk', xx - 0.45, yy - 0.45, xx + 0.45, yy + 0.45, z + 0.72, z + 0.76);
          boxAt(acc, 'dark', xx - 0.08, yy - 0.08, xx + 0.08, yy + 0.08, z, z + 0.72);
        }
      break;
    case 'lobby':
      boxAt(acc, 'desk', cx - 2.2, y1 - 2.4, cx + 2.2, y1 - 1.7, z, z + 1.1);
      for (const xx of [x0 + 2, x1 - 2]) boxAt(acc, 'dark', xx - 1.0, y0 + 1.6, xx + 1.0, y0 + 2.4, z, z + 0.45);
      break;
    case 'storage': case 'print': case 'kitchen': case 'wc':
      boxAt(acc, 'dark', x0 + 0.3, y0 + 0.4, x0 + 0.75, y1 - 0.4, z, z + 1.4);
      break;
    default: break;
  }
}

function stairs(acc, z) {
  const steps = 12, rise = 1.8 / steps, run = 0.3;
  for (let i = 0; i < steps; i++) {
    boxAt(acc, 'concrete', -0.6, 2.6 + i * run, 1.05, 2.6 + (i + 1) * run, z, z + (i + 1) * rise);
    boxAt(acc, 'concrete', 1.25, 6.2 - (i + 1) * run, 2.9, 6.2 - i * run, z + 1.8, z + 1.8 + (i + 1) * rise);
  }
  boxAt(acc, 'concrete', -0.6, 6.2, 2.9, 7.85, z + 1.62, z + 1.8);
}

export class BuildingView {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'building';
    scene.add(this.group);
    this.floors = FLOORS.map((f) => {
      const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e4);
      const g = new THREE.Group();
      g.name = `floor-${f.id}`;
      this.group.add(g);
      return { f, plane, group: g, mats: makeMats(plane), offset: 0, offsetTarget: 0, cut: 1e4, cutTarget: 1e4, visible: true, labels: [] };
    });
    this.roofMats = makeMats(null);
    this.roof = new THREE.Group();
    this.group.add(this.roof);
    this._build();
    this.view = { focus: 'all', explode: false, cut: 1.7 };
  }

  _build() {
    const [fx0, fy0, fx1, fy1] = FOOT;
    for (const fl of this.floors) {
      const acc = new Accum(), fin = new Accum();
      const z = fl.f.z;
      for (const w of WALLS) if (w.floor === fl.f.id) addWall(acc, w);
      // slab below this floor (ground floor: thin plinth)
      if (fl.f.id === 0) boxAt(acc, 'slab', fx0 - 0.6, fy0 - 0.6, fx1 + 0.6, fy1 + 0.6, -0.18, 0.0);
      else boxAt(acc, 'slab', fx0 - 0.15, fy0 - 0.15, fx1 + 0.15, fy1 + 0.15, z - SLAB_T, z - 0.004);
      for (const room of B.rooms.filter((r) => r.floor === fl.f.id)) {
        const [x0, y0, x1, y1] = room.rect;
        boxAt(fin, 'floor', x0, y0, x1, y1, z - 0.004, z + 0.004, FINISH[room.type] ?? '#cccccc');
        furnish(acc, room, z);
        if (room.type !== 'corridor' && room.type !== 'core') {
          const el = document.createElement('div');
          el.className = 'room-label';
          el.dataset.en = room.name.en; el.dataset.ar = room.name.ar;
          el.textContent = room.name.en;
          const lab = new CSS2DObject(el);
          lab.position.copy(P((x0 + x1) / 2, (y0 + y1) / 2 + (y1 < 0 ? 1.4 : -1.4), z + 0.35));
          lab.visible = false;
          fl.group.add(lab);
          fl.labels.push(lab);
        }
      }
      stairs(acc, z);
      facadeDetails(acc, fl.f);
      boxAt(acc, 'metal', -2.9, 1.35, -0.95, 3.65, z + 0.05, z + 0.25); // elevator car floor
      acc.build(fl.mats, fl.group);
      fin.build(fl.mats, fl.group, { cast: false });
    }
    // roof: slab, parapet, plant
    const acc = new Accum();
    const zt = FLOORS.at(-1).z + FLOORS.at(-1).height;
    boxAt(acc, 'slab', fx0 - 0.15, fy0 - 0.15, fx1 + 0.15, fy1 + 0.15, zt - SLAB_T, zt - 0.02);
    boxAt(acc, 'roof', fx0 + 0.05, fy0 + 0.05, fx1 - 0.05, fy1 - 0.05, zt - 0.02, zt + 0.03);
    const pt = 0.22, ph = 1.0;
    // parapet coping
    boxAt(acc, 'band', fx0 - 0.25, fy0 - 0.25, fx1 + 0.25, fy0 - 0.1 + pt, zt + ph, zt + ph + 0.12);
    boxAt(acc, 'band', fx0 - 0.25, fy1 + 0.1 - pt, fx1 + 0.25, fy1 + 0.25, zt + ph, zt + ph + 0.12);
    boxAt(acc, 'band', fx0 - 0.25, fy0 - 0.25, fx0 - 0.1 + pt, fy1 + 0.25, zt + ph, zt + ph + 0.12);
    boxAt(acc, 'band', fx1 + 0.1 - pt, fy0 - 0.25, fx1 + 0.25, fy1 + 0.25, zt + ph, zt + ph + 0.12);
    boxAt(acc, 'ext_concrete', fx0 - 0.15, fy0 - 0.15, fx1 + 0.15, fy0 - 0.15 + pt, zt, zt + ph);
    boxAt(acc, 'ext_concrete', fx0 - 0.15, fy1 + 0.15 - pt, fx1 + 0.15, fy1 + 0.15, zt, zt + ph);
    boxAt(acc, 'ext_concrete', fx0 - 0.15, fy0 - 0.15, fx0 - 0.15 + pt, fy1 + 0.15, zt, zt + ph);
    boxAt(acc, 'ext_concrete', fx1 + 0.15 - pt, fy0 - 0.15, fx1 + 0.15, fy1 + 0.15, zt, zt + ph);
    boxAt(acc, 'ext_concrete', -3.1, 1.1, 3.1, 8.1, zt, zt + 2.9);                    // stair/lift overrun
    for (const [x, y] of [[-12, 2.5], [-8.5, 2.5], [9, 3], [12.5, 3]]) boxAt(acc, 'metal', x - 1.3, y - 1, x + 1.3, y + 1, zt, zt + 1.3);
    boxAt(acc, 'frame', 10, -5, 16, -2.8, zt + 0.1, zt + 0.25);                           // PV rack
    boxAt(acc, 'ext_glass', 10.05, -4.95, 15.95, -2.85, zt + 0.25, zt + 0.32);
    // entrance canopy + steps
    boxAt(acc, 'band', -5, fy0 - 3.0, 5, fy0, 3.25, 3.5);
    for (const x of [-4.4, 4.4]) boxAt(acc, 'shade', x - 0.12, fy0 - 2.75, x + 0.12, fy0 - 2.51, 0, 3.25);
    boxAt(acc, 'slab', -4, fy0 - 1.6, 4, fy0 - 0.6, -0.18, -0.06);
    acc.build(this.roofMats, this.roof);
    this._sign();
  }

  _sign() {
    const c = document.createElement('canvas');
    c.width = 2048; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#1b2029'; g.fillRect(0, 0, 2048, 128);
    g.fillStyle = '#f4f1ea';
    g.font = '600 66px "Segoe UI", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('FACULTY OF ENGINEERING  ·  BLOCK C', 1024, 66);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    this.signMat = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.6, roughness: 0.5 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 0.6), this.signMat);
    m.position.copy(P(0, FOOT[1] - 3.012, 3.375));
    this.roof.add(m);
  }

  setLang(lang) {
    for (const fl of this.floors) for (const l of fl.labels) l.element.textContent = l.element.dataset[lang];
  }

  /** focus: 'all' | 0 | 1 | 2 ; explode: bool ; cut: metres above floor level */
  setView(v) {
    Object.assign(this.view, v);
    const { focus, explode, cut } = this.view;
    for (const fl of this.floors) {
      const k = fl.f.id;
      fl.offsetTarget = explode ? k * 7.0 : 0;
      if (explode) { fl.visible = true; fl.cutTarget = cut; }
      else if (focus === 'all') { fl.visible = true; fl.cutTarget = 50; }
      else { fl.visible = k <= focus; fl.cutTarget = k === focus ? cut : 50; }
    }
    this.roofVisible = !explode && focus === 'all';
  }

  setLabels(on) { this.labelsOn = on; }

  get roofShown() { return this.roof.visible; }

  update(dt) {
    const a = 1 - Math.exp(-dt * 6);
    for (const fl of this.floors) {
      fl.offset += (fl.offsetTarget - fl.offset) * a;
      fl.cut += (fl.cutTarget - fl.cut) * a;
      fl.group.position.y = fl.offset;
      fl.group.visible = fl.visible;
      fl.plane.constant = fl.offset + fl.f.z + Math.min(fl.cut, 50);
      const focused = !this.view.explode && this.view.focus === fl.f.id;
      for (const l of fl.labels) l.visible = !!this.labelsOn && fl.visible && focused;
    }
    this.roof.visible = this.roofVisible ?? true;
  }

  setWindowGlow(k) {
    for (const fl of this.floors) fl.mats.ext_glass.emissiveIntensity = 0.85 * k;
    this.roofMats.ext_glass.emissiveIntensity = 0.0;
    if (this.signMat) this.signMat.emissiveIntensity = 0.25 + 0.6 * Math.min(1, k);
  }

  /** Visual hint for applied shielding (tint windows / walls). */
  setShielding({ windows, paint }) {
    for (const m of [...this.floors.map((f) => f.mats), this.roofMats]) {
      m.ext_glass.color.set(windows ? '#6f7f62' : '#5d7a8c');
      m.ext_glass.metalness = windows ? 0.8 : 0.35;
      m.ext_glass.opacity = windows ? 0.72 : 0.55;
      m.ext_concrete.color.set(paint ? '#dfe6e3' : '#ffffff');
    }
  }

  setRackGlow(t) {
    for (const fl of this.floors) fl.mats.rack.emissiveIntensity = 0.25 + 0.15 * Math.sin(t * 3.1);
  }
}

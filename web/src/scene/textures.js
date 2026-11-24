// Procedural PBR textures (colour + normal + roughness), generated at start-up so the app
// stays a single self-contained file. Every texture tiles seamlessly.
import * as THREE from 'three';

// ───────────── tileable value noise ─────────────
function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, period, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = (a) => ((a % period) + period) % period;
  const x0 = m(xi), x1 = m(xi + 1), y0 = m(yi), y1 = m(yi + 1);
  const a = hash(x0, y0, s), b = hash(x1, y0, s), c = hash(x0, y1, s), d = hash(x1, y1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** fBm in [0,1]; (u,v) in [0,1) tile space, base = number of cells across the tile */
function fbm(u, v, base, oct, s, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, f = base;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(u * f, v * f, f, s + o * 17);
    norm += amp; amp *= gain; f *= 2;
  }
  return sum / norm;
}
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const mix = (a, b, t) => a + (b - a) * t;
const hex = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b].map((x) => Math.pow(x, 1 / 2.2)); }; // sRGB 0..1

/**
 * Build colour/normal/roughness textures from per-texel functions.
 * fn(u, v) → { c: [r,g,b] sRGB 0..1, h: height 0..1, r: roughness 0..1 }
 */
function bake(size, fn, { normalStrength = 2.0 } = {}) {
  const n = size * size;
  const col = new Uint8Array(n * 4), hgt = new Float32Array(n), rgh = new Uint8Array(n * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const o = fn(i / size, j / size);
      const k = j * size + i;
      col[k * 4] = clamp01(o.c[0]) * 255; col[k * 4 + 1] = clamp01(o.c[1]) * 255; col[k * 4 + 2] = clamp01(o.c[2]) * 255; col[k * 4 + 3] = 255;
      hgt[k] = o.h;
      const r = clamp01(o.r) * 255;
      rgh[k * 4] = 255; rgh[k * 4 + 1] = r; rgh[k * 4 + 2] = 255; rgh[k * 4 + 3] = 255; // three reads roughness from G
    }
  }
  const nrm = new Uint8Array(n * 4);
  const H = (i, j) => hgt[((j + size) % size) * size + ((i + size) % size)];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const dx = (H(i + 1, j) - H(i - 1, j)) * normalStrength;
      const dy = (H(i, j + 1) - H(i, j - 1)) * normalStrength;
      const l = Math.hypot(dx, dy, 1);
      const k = (j * size + i) * 4;
      nrm[k] = ((-dx / l) * 0.5 + 0.5) * 255; nrm[k + 1] = ((-dy / l) * 0.5 + 0.5) * 255; nrm[k + 2] = ((1 / l) * 0.5 + 0.5) * 255; nrm[k + 3] = 255;
    }
  }
  const mk = (data, srgb) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(col, true), normalMap: mk(nrm, false), roughnessMap: mk(rgh, false) };
}

// distance to the nearest grid line (in texels-relative units) for joints
const jointDist = (t, cells) => { const x = t * cells; return Math.abs(x - Math.round(x)) / cells; };

// ───────────── recipes ─────────────
const R = {
  /** precast concrete panel — tile = 3.0 m × 3.6 m (one window bay × one storey) */
  concrete(size = 512) {
    const base = hex('#d6d0c5'), stain = hex('#b9b2a6');
    return bake(size, (u, v) => {
      const large = fbm(u, v, 3, 4, 11);
      const fine = fbm(u, v, 48, 2, 23);
      const streak = Math.pow(fbm(u * 0.2, v, 64, 2, 41), 3) * (1 - v) * 0.8;
      const pore = hash(Math.floor(u * 900), Math.floor(v * 900), 7) > 0.996 ? 1 : 0;
      const jU = Math.min(jointDist(u, 1) * 3.0, 1), jV = Math.min(jointDist(v, 1) * 3.6, 1); // metres to joint
      const joint = Math.min(jU, jV) < 0.012 ? 1 : 0;
      const t = clamp01(large * 0.55 + streak);
      const c = base.map((x, i) => mix(x, stain[i], t) * (0.94 + fine * 0.1) * (1 - pore * 0.25) * (1 - joint * 0.45));
      return { c, h: 0.5 + fine * 0.15 - pore * 0.4 - joint * 0.8, r: 0.82 + fine * 0.12 - joint * 0.1 };
    }, { normalStrength: 3 });
  },
  /** interior plaster — tile 2 m */
  plaster(size = 256) {
    const base = hex('#f1eee8');
    return bake(size, (u, v) => {
      const n = fbm(u, v, 8, 4, 5);
      return { c: base.map((x) => x * (0.95 + n * 0.07)), h: n * 0.3, r: 0.9 };
    }, { normalStrength: 1.2 });
  },
  /** roof membrane with gravel — tile 2 m */
  roof(size = 512) {
    const a = hex('#8d8f92'), b = hex('#6d7075');
    return bake(size, (u, v) => {
      const g = hash(Math.floor(u * 260), Math.floor(v * 260), 3);
      const n = fbm(u, v, 6, 3, 9);
      const t = clamp01(n * 0.7 + (g > 0.7 ? 0.35 : 0));
      return { c: a.map((x, i) => mix(x, b[i], t)), h: g * 0.6 + n * 0.2, r: 0.95 };
    }, { normalStrength: 2.2 });
  },
  /** asphalt — tile 4 m */
  asphalt(size = 1024) {
    const base = hex('#30333a'), light = hex('#5d6068'), dark = hex('#1d1f23');
    return bake(size, (u, v) => {
      const large = fbm(u, v, 4, 4, 51);
      const agg = hash(Math.floor(u * 700), Math.floor(v * 700), 13);
      const agg2 = hash(Math.floor(u * 350), Math.floor(v * 350), 29);
      let c = base.map((x, i) => mix(x, dark[i], large * 0.55));
      if (agg > 0.93) c = c.map((x, i) => mix(x, light[i], 0.55));
      else if (agg2 < 0.06) c = c.map((x, i) => mix(x, dark[i], 0.6));
      const crack = Math.abs(fbm(u, v, 5, 3, 77) - 0.5) < 0.006 ? 1 : 0;
      c = c.map((x) => x * (1 - crack * 0.35));
      return { c, h: (agg > 0.93 ? 0.7 : 0.4) + large * 0.1 - crack * 0.5, r: 0.78 + large * 0.18 };
    }, { normalStrength: 2.5 });
  },
  /** sidewalk concrete pavers 0.6 m — tile 1.2 m (2 × 2 pavers) */
  pavers(size = 512) {
    const base = hex('#b9b4ab');
    return bake(size, (u, v) => {
      const cu = Math.floor(u * 2), cv = Math.floor(v * 2);
      const tint = 0.92 + hash(cu, cv, 91) * 0.12;
      const n = fbm(u, v, 24, 3, 15);
      const jd = Math.min(jointDist(u, 2), jointDist(v, 2)) * 1.2; // metres to joint
      const joint = jd < 0.006 ? 1 : jd < 0.012 ? 0.4 : 0;
      return { c: base.map((x) => x * tint * (0.94 + n * 0.1) * (1 - joint * 0.5)), h: 0.6 + n * 0.12 - joint * 0.6, r: 0.88 };
    }, { normalStrength: 3 });
  },
  /** light stone plaza tiles 1.2 m — tile 2.4 m */
  stone(size = 512) {
    const base = hex('#d8d1c4'), vein = hex('#b9ae9c');
    return bake(size, (u, v) => {
      const cu = Math.floor(u * 2), cv = Math.floor(v * 2);
      const tint = 0.94 + hash(cu, cv, 33) * 0.1;
      const n = fbm(u, v, 6, 4, 19);
      const vn = Math.pow(1 - Math.abs(fbm(u, v, 3, 4, 57) * 2 - 1), 12);
      const jd = Math.min(jointDist(u, 2), jointDist(v, 2)) * 2.4;
      const joint = jd < 0.005 ? 1 : 0;
      const c = base.map((x, i) => mix(x, vein[i], vn * 0.6) * tint * (0.96 + n * 0.06) * (1 - joint * 0.45));
      return { c, h: 0.6 - joint * 0.6 + n * 0.05, r: 0.55 + n * 0.2 };
    }, { normalStrength: 2.5 });
  },
  /** grass — tile 3 m */
  grass(size = 512) {
    const a = hex('#4b6b33'), b = hex('#6f8c3f'), c2 = hex('#3a5428'), dry = hex('#8a8a4f');
    return bake(size, (u, v) => {
      const large = fbm(u, v, 3, 4, 61);
      const blades = fbm(u * 1.0, v * 1.0, 96, 2, 67);
      const dryP = Math.pow(fbm(u, v, 2, 3, 71), 3);
      let c = a.map((x, i) => mix(x, b[i], large));
      c = c.map((x, i) => mix(x, c2[i], (1 - blades) * 0.45));
      c = c.map((x, i) => mix(x, dry[i], dryP * 0.5));
      return { c, h: blades * 0.8, r: 0.92 };
    }, { normalStrength: 2.0 });
  },
  /** interior floor finish (multiplied by the room colour) — tile 1.2 m */
  floor(size = 256) {
    return bake(size, (u, v) => {
      const plank = Math.floor(v * 6);
      const n = fbm(u * 0.25, v, 32, 3, 81 + plank);
      const tint = 0.9 + hash(plank, Math.floor(u * 2 + plank * 0.5), 5) * 0.1;
      const seam = jointDist(v, 6) * 1.2 < 0.003 ? 1 : 0;
      const g = (0.9 + n * 0.12) * tint * (1 - seam * 0.3);
      return { c: [g, g, g], h: 0.5 - seam * 0.5, r: 0.6 + n * 0.2 };
    }, { normalStrength: 1.5 });
  },
};

const cache = new Map();
export function tex(name) {
  if (!cache.has(name)) cache.set(name, R[name]());
  return cache.get(name);
}

/**
 * World-space box mapping: rewrite UVs of an (already transformed) geometry so a texture of
 * tileW × tileH metres tiles continuously across merged boxes. three.js y-up world.
 */
export function boxMapUV(geo, tileW = 3, tileH = 3.6) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ay >= ax && ay >= az) uv.setXY(i, x / tileW, z / tileW);
    else if (ax >= az) uv.setXY(i, z / tileW, y / tileH);
    else uv.setXY(i, x / tileW, y / tileH);
  }
  uv.needsUpdate = true;
}

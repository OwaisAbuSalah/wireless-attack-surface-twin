// Pre-computed NVIDIA Sionna RT radio maps (written by sim/run_sionna.py, format: docs/MODEL.md §8).
import * as THREE from 'three';
import { B, FOOT, FLOORS, STREET_BAND, CORE_RECT } from '../data.js';
import { equipment } from './model.js';

// Optional file: the app works without it (Sionna modes are then disabled).
const found = import.meta.glob('../data/sionna.json', { eager: true, import: 'default' });
const RAW = Object.values(found)[0] ?? null;

function decode(b64, n) {
  const bin = atob(b64);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = bin.charCodeAt(i);
    out[i] = v === 0 ? -200 : -130 + v / 2;
  }
  return out;
}

export function loadSionna(renderer) {
  if (!RAW || !RAW.scenarios) return { available: false };
  const linear = renderer.extensions.has('OES_texture_float_linear');
  const filt = linear ? THREE.LinearFilter : THREE.NearestFilter;
  const go = RAW.grids.outdoor;
  const gf = RAW.grids.floor0;
  const tex = (data, w, h) => {
    const t = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.FloatType);
    t.minFilter = t.magFilter = filt;
    t.needsUpdate = true;
    return t;
  };
  const scenarios = {};
  for (const [key, sc] of Object.entries(RAW.scenarios)) {
    const out = decode(sc.outdoor, go.nx * go.ny);
    const flo = new Float32Array(gf.nx * gf.ny * 3);
    for (let k = 0; k < 3; k++) flo.set(decode(sc[`floor${k}`], gf.nx * gf.ny), k * gf.nx * gf.ny);
    scenarios[key] = { ...sc, out, flo, outTex: tex(out, go.nx, go.ny), floTex: tex(flo, gf.nx, gf.ny * 3) };
  }
  return { available: true, raw: RAW, go, gf, scenarios, generator: RAW.generator, settings: RAW.settings };
}

/** Which pre-computed scenario (if any) matches the current RF settings. */
export function matchScenario(s) {
  const P = B.protections;
  const on = {
    directional: s.antenna === 'patch',
    relocate: s.mount === 'ceiling',
    microcells: s.mount === 'micro',
    shieldWindows: !!s.shieldWindows,
    shieldPaint: !!s.shieldPaint,
    band5: s.freq >= 4,
  };
  if (s.mount === 'custom') return null;
  if (s.antenna === 'patch') {
    const m = B.router.mounts[s.mount];
    if (Math.abs(s.az - m.az_deg) > 0.1 || Math.abs(s.tilt - m.tilt_deg) > 0.1) return null;
  }
  for (const [key, sc] of Object.entries(B.scenarios)) {
    const set = new Set(sc.protections);
    const tx = sc.tx_dbm ?? (set.has('lowPower') ? P.lowPower.tx_dbm : B.router.tx_dbm);
    if (s.txDbm !== tx) continue;
    if (Object.entries(on).every(([k, v]) => v === set.has(k))) return key;
  }
  return null;
}

/** Same statistics as FieldEngine.stats but from Sionna's RSS only (eavesdropping tier). */
export function sionnaStats(S, sc, s, routerZ) {
  const eq = equipment(s.equipment);
  const thr = eq.sens_dbm - eq.gain_dbi;
  const [fx0, fy0, fx1, fy1] = FOOT;
  const go = S.go;
  let nE = 0, maxLeak = 0, edge = false, stN = 0, stE = 0;
  for (let j = 0; j < go.ny; j++) {
    const y = go.y0 + (j + 0.5) * go.dx;
    for (let i = 0; i < go.nx; i++) {
      const x = go.x0 + (i + 0.5) * go.dx;
      if (x >= fx0 && x <= fx1 && y >= fy0 && y <= fy1) continue;
      const e = sc.out[j * go.nx + i] >= thr;
      if (e) {
        nE++;
        const d = Math.hypot(Math.max(fx0 - x, 0, x - fx1), Math.max(fy0 - y, 0, y - fy1));
        if (d > maxLeak) maxLeak = d;
        if (i === 0 || j === 0 || i === go.nx - 1 || j === go.ny - 1) edge = true;
      }
      if (y >= STREET_BAND[1] && y <= STREET_BAND[3]) { stN++; if (e) stE++; }
    }
  }
  const gf = S.gf;
  let fk = FLOORS.findIndex((f) => routerZ >= f.z && routerZ < f.z + f.height);
  if (fk < 0) fk = 1;
  let cov = 0, tot = 0;
  for (let j = 0; j < gf.ny; j++) {
    const y = gf.y0 + (j + 0.5) * gf.dx;
    if (y < fy0 || y > fy1) continue;
    for (let i = 0; i < gf.nx; i++) {
      const x = gf.x0 + (i + 0.5) * gf.dx;
      if (x < fx0 || x > fx1) continue;
      if (x > CORE_RECT[0] && x < CORE_RECT[2] && y > CORE_RECT[1] && y < CORE_RECT[3]) continue;
      tot++;
      if (sc.flo[(fk * gf.ny + j) * gf.nx + i] >= B.attack.coverage_dbm) cov++;
    }
  }
  const A = go.dx * go.dx;
  return {
    areaE: nE * A, areaD: 0, areaT: 0, areaU: nE * A, maxLeak, edge,
    street: stN ? (100 * stE) / stN : 0, coverage: tot ? (100 * cov) / tot : 0, hijack: 0, p5: -100, floor: fk,
  };
}

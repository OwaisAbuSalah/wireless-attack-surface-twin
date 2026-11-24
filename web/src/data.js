// Shared, pre-processed view of data/building.json (the single source of truth).
import building from '@data/building.json';

export const B = building;
export const MATERIALS = building.materials;
export const MAT_BY_ID = Object.entries(MATERIALS)
  .sort((a, b) => a[1].id - b[1].id)
  .map(([key, m]) => ({ key, ...m }));
export const FLOORS = building.floors;
export const FOOT = building.footprint; // [x0, y0, x1, y1]
export const SLAB_PLANES = building.rf.slab_planes;
export const SLAB_T = building.slab_thickness;
export const CLIENTS = building.clients;
export const EQUIP = building.attack.equipment;

export const WALLS = building.walls.map((w) => {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  return {
    ...w,
    len,
    matId: MATERIALS[w.mat].id,
    open: w.opening ? { ...w.opening, matId: MATERIALS[w.opening.mat].id } : null,
  };
});

/** Wall table for the GPU: 4 RGBA texels per wall. */
export function wallTexels() {
  const n = WALLS.length;
  const a = new Float32Array(n * 16);
  WALLS.forEach((w, i) => {
    const o = i * 16;
    a.set([w.a[0], w.a[1], w.b[0], w.b[1]], o);
    a.set([w.z0, w.z1, w.matId, w.open ? w.len : -1], o + 4);
    if (w.open) {
      a.set([w.open.sill, w.open.head, w.open.period, w.open.width], o + 8);
      a.set([w.open.offset, w.open.matId, 0, 0], o + 12);
    }
  });
  return { data: a, count: n };
}

export const fKey = (freq) => (freq >= 4 ? '5' : '2.4');

/** Material loss table (dB) indexed by material id, including protection modifiers. */
export function lossTable(freq, { shieldWindows = false, shieldPaint = false } = {}) {
  const f = fKey(freq);
  const t = new Float32Array(16);
  for (const m of MAT_BY_ID) t[m.id] = m.loss[f];
  const P = building.protections;
  if (shieldWindows) t[MATERIALS[P.shieldWindows.material].id] += P.shieldWindows.extra_db[f];
  if (shieldPaint) t[MATERIALS[P.shieldPaint.material].id] += P.shieldPaint.extra_db[f];
  return t;
}

export const gridOutdoor = (cell) => {
  const g = building.rf.grids.outdoor;
  const nx = Math.round((g.x1 - g.x0) / cell), ny = Math.round((g.y1 - g.y0) / cell);
  return { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, cell, nx, ny, z: g.z };
};
export const gridFloor = (cell) => {
  const g = building.rf.grids.floor;
  const nx = Math.round((g.x1 - g.x0) / cell), ny = Math.round((g.y1 - g.y0) / cell);
  return { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, cell, nx, ny, zs: FLOORS.map((f) => f.z + g.dz) };
};

// Main street + its two sidewalks (for the street-exposure KPI)
export const STREET_BAND = [-100, -29, 100, -14];
// Stair/elevator core is excluded from the service-coverage KPI
export const CORE_RECT = [-3, 1.2, 3, 8];

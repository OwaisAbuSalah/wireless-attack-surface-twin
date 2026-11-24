// CPU implementation of docs/MODEL.md — used for single links (attacker, clients),
// the link-budget panel and statistics. The GLSL shader in ./glsl.js mirrors it 1:1.
import { B, WALLS, SLAB_PLANES, FOOT, MAT_BY_ID, lossTable, EQUIP, CLIENTS } from '../data.js';

const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export const pl0 = (freq) => 20 * Math.log10(freq) + 32.44;

/** Antenna frame for the 3GPP patch (boresight b, local y', z'). */
export function patchFrame(azDeg, tiltDeg) {
  const a = azDeg * DEG, t = tiltDeg * DEG;
  const b = [Math.cos(t) * Math.cos(a), Math.cos(t) * Math.sin(a), Math.sin(t)];
  const y = [-Math.sin(a), Math.cos(a), 0];
  const z = cross(b, y);
  return { b, y, z };
}

/** Gain (dBi) of the router antenna in unit direction v. */
export function antennaGain(v, ant) {
  if (ant.type !== 'patch') {
    const el = Math.asin(clamp(v[2], -1, 1));
    const c = Math.cos(el);
    const F = c >= 1e-3 ? Math.cos((Math.PI / 2) * Math.sin(el)) / c : 0;
    return 2.15 + 10 * Math.log10(Math.max(F * F, 1e-3));
  }
  const fr = ant.frame ?? patchFrame(ant.az, ant.tilt);
  const H = ant.hpbw_deg * DEG;
  const phi = Math.atan2(dot(v, fr.y), dot(v, fr.b));
  const th = Math.asin(clamp(dot(v, fr.z), -1, 1));
  const AH = -Math.min(12 * (phi / H) ** 2, ant.sla_db);
  const AV = -Math.min(12 * (th / H) ** 2, ant.sla_db);
  return ant.gmax_dbi - Math.min(-(AH + AV), ant.sla_db);
}

/**
 * Path loss between a and b ([x,y,z]). If `detail` is an object it receives the breakdown:
 * { d, spread, walls:[{wall, mat, loss, p:[x,y,z], t}], slabs:[{z, p, loss, t}] }.
 */
export function pathLoss(a, b, rf, detail = null) {
  const rx = b[0] - a[0], ry = b[1] - a[1], rz = b[2] - a[2];
  const d = Math.max(Math.hypot(rx, ry, rz), B.rf.min_distance_m);
  const spread = rf.pl0 + 10 * rf.n * Math.log10(d);
  const zmin = Math.min(a[2], b[2]), zmax = Math.max(a[2], b[2]);
  let walls = 0;
  for (const w of WALLS) {
    if (zmax < w.z0 - 1e-4 || zmin > w.z1 + 1e-4) continue;
    const sx = w.b[0] - w.a[0], sy = w.b[1] - w.a[1];
    const rxs = rx * sy - ry * sx;
    if (Math.abs(rxs) < 1e-9) continue;
    const qx = w.a[0] - a[0], qy = w.a[1] - a[1];
    const t = (qx * sy - qy * sx) / rxs;
    const u = (qx * ry - qy * rx) / rxs;
    if (t <= 1e-5 || t >= 1 - 1e-5 || u < -1e-5 || u > 1 + 1e-5) continue;   // MODEL.md §2.1 tolerances
    const zc = a[2] + t * rz;
    if (zc < w.z0 - 1e-4 || zc > w.z1 + 1e-4) continue;
    let mat = w.matId;
    if (w.open) {
      const o = w.open;
      let m = u * w.len - o.offset;
      if (o.period > 0) { m = ((m % o.period) + o.period) % o.period; if (m > o.period - 1e-4) m -= o.period; }
      const h = zc - w.z0;
      if (m >= -1e-4 && m <= o.width + 1e-4 && h >= o.sill - 1e-4 && h <= o.head + 1e-4) mat = o.matId;
    }
    const loss = rf.loss[mat];
    walls += loss;
    if (detail) detail.walls.push({ wall: w, mat: MAT_BY_ID[mat].key, loss, t, p: [a[0] + t * rx, a[1] + t * ry, zc] });
  }
  let slabs = 0;
  for (const zs of SLAB_PLANES) {
    if ((a[2] - zs) * (b[2] - zs) < 0) {
      const t = (zs - a[2]) / rz;
      const x = a[0] + t * rx, y = a[1] + t * ry;
      if (x >= FOOT[0] - 1e-4 && x <= FOOT[2] + 1e-4 && y >= FOOT[1] - 1e-4 && y <= FOOT[3] + 1e-4) {
        slabs += rf.slabLoss;
        if (detail) detail.slabs.push({ z: zs, p: [x, y, zs], loss: rf.slabLoss, t });
      }
    }
  }
  if (detail) {
    detail.d = d; detail.spread = spread; detail.wallLoss = walls; detail.slabLoss = slabs;
    detail.walls.sort((p, q) => p.t - q.t);
  }
  return spread + walls + slabs;
}

export function unit(a, b) {
  const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(...v);
  return l > 1e-6 ? v.map((x) => x / l) : [1, 0, 0];
}

/** RSS (dBm, 0 dBi receiver) at point p from the strongest AP. */
export function rssFromAP(p, rf, detail = null) {
  let best = -Infinity, bi = 0;
  for (let i = 0; i < rf.txs.length; i++) {
    const v = rf.ptx + antennaGain(unit(rf.txs[i], p), rf.ant) - pathLoss(rf.txs[i], p, rf);
    if (v > best) { best = v; bi = i; }
  }
  if (detail) { pathLoss(rf.txs[bi], p, rf, detail); detail.tx = bi; }
  return best;
}

/** Effective RF parameters from the app state (see MODEL.md §5). */
export function rfParams(s) {
  const mount = B.router.mounts[s.mount] ?? B.router.mounts.wall;
  const txs = (s.aps && s.aps.length ? s.aps : mount.positions ?? [mount.pos]).slice(0, 4);
  const pos = txs[0];
  const ant = s.antenna === 'patch'
    ? { type: 'patch', az: s.az ?? mount.az_deg, tilt: s.tilt ?? mount.tilt_deg, ...(mount.patch ?? B.router.mounts.wall.patch) }
    : { type: 'dipole' };
  if (ant.type === 'patch') ant.frame = patchFrame(ant.az, ant.tilt);
  const loss = lossTable(s.freq, { shieldWindows: s.shieldWindows, shieldPaint: s.shieldPaint });
  return {
    freq: s.freq,
    ptx: s.txDbm,
    pos,
    txs,
    ant,
    loss,
    slabLoss: loss[B.materials.slab.id],
    pl0: pl0(s.freq),
    n: B.rf.pathloss_exponent,
  };
}

export const equipment = (key) => EQUIP[key] ?? EQUIP[B.attack.default_equipment];

/** Client RSS from the AP (needed for the Evil-Twin comparison). */
export function clientRss(rf) {
  return CLIENTS.map((c) => rssFromAP(c.pos, rf));
}

/**
 * Full attack evaluation for an attacker standing at plan position (x, y).
 * Returns link budget + per-attack feasibility + per-client status.
 */
export function evaluateAttacker(xy, rf, s) {
  const eq = equipment(s.equipment);
  const X = [xy[0], xy[1], B.rf.rx_height_outdoor];
  const det = { walls: [], slabs: [] };
  // the eavesdropper listens to the strongest AP
  let ti = 0, best = -Infinity;
  rf.txs.forEach((t, i) => { const r = rf.ptx + antennaGain(unit(t, X), rf.ant) - pathLoss(t, X, rf); if (r > best) { best = r; ti = i; } });
  const txPos = rf.txs[ti];
  const v = unit(txPos, X);
  const gTx = antennaGain(v, rf.ant);
  const pl = pathLoss(txPos, X, rf, det);
  const rss0 = rf.ptx + gTx - pl;
  const rss = rss0 + eq.gain_dbi;
  const eav = rss - eq.sens_dbm;

  const A = B.attack;
  const cr = clientRss(rf);
  const hears = eav >= 0;   // active attacks need the attacker to hear the network (BSSID, channel, clients)
  const clients = CLIENTS.map((c, i) => {
    const plc = pathLoss(c.pos, X, rf);
    const sAtt = eq.tx_dbm + eq.gain_dbi - plc;          // attacker's signal at the client
    const deauthM = sAtt - A.client.sens_dbm;
    const etM = Math.min(sAtt - cr[i] - A.evil_twin.margin_db, sAtt - A.evil_twin.min_rss_dbm);
    return {
      id: c.id, client: c, rssAP: cr[i], sAtt,
      deauth: hears && deauthM >= 0 && !s.pmf, deauthM: Math.min(deauthM, eav),
      evilTwin: hears && etM >= 0 && !s.wpa3, etM: Math.min(etM, eav),
    };
  });
  return {
    pos: X, txPos, txIndex: ti, eq, d: det.d, spread: det.spread, walls: det.walls, slabs: det.slabs,
    gTx, pl, rss0, rss, eav: { margin: eav, ok: eav >= 0, crackable: eav >= 0 && !s.wpa3 },
    deauth: { ok: clients.some((c) => c.deauth), count: clients.filter((c) => c.deauth).length, blocked: !!s.pmf },
    evilTwin: { ok: clients.some((c) => c.evilTwin), count: clients.filter((c) => c.evilTwin).length, blocked: !!s.wpa3 },
    clients,
  };
}

// Site context: ground, streets, sidewalks, plaza, parking, lawns, trees, cars (incl. live
// traffic), street lamps with light pools, café terrace and neighbouring buildings.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { B } from '../data.js';
import { P } from './world.js';
import { tex, boxMapUV } from './textures.js';
import { Vegetation } from './vegetation.js';
import { StreetLife } from './streetlife.js';

const S = B.site;

function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const noise = (g, n, base, spread, count, size = 2) => {
  g.fillStyle = base; g.fillRect(0, 0, n, n);
  for (let i = 0; i < count; i++) {
    const l = Math.random() * spread - spread / 2;
    g.fillStyle = `rgba(${l > 0 ? 255 : 0},${l > 0 ? 255 : 0},${l > 0 ? 255 : 0},${Math.abs(l)})`;
    g.fillRect(Math.random() * n, Math.random() * n, size, size);
  }
};

function planeAt(mat, x0, y0, x1, y1, z, uvScale = 0) {
  const w = x1 - x0, d = y1 - y0;
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  if (uvScale) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / uvScale, uv.getY(i) * d / uvScale);
  }
  const m = new THREE.Mesh(g, mat);
  m.position.copy(P((x0 + x1) / 2, (y0 + y1) / 2, z));
  m.receiveShadow = true;
  return m;
}
function slabAt(mat, x0, y0, x1, y1, z0, z1, cast = false, tile = 3) {
  const g = new THREE.BoxGeometry(x1 - x0, z1 - z0, y1 - y0);
  g.translate(...P((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).toArray());
  boxMapUV(g, tile, tile);
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  m.castShadow = cast;
  return m;
}

function facadeTextures(style, lit) {
  const W = 512;
  const base = { campus: '#d8d2c6', retail: '#cbb9a2', residential: '#b9876a' }[style] ?? '#cccccc';
  const draw = (emit) => (g) => {
    g.fillStyle = emit ? '#000' : base;
    g.fillRect(0, 0, W, W);
    const cols = 4, rows = 4, bw = W / cols, bh = W / rows;
    let seed = style.length * 97 + (lit ? 13 : 7);
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const storefront = style === 'retail' && r === rows - 1;
      const x = c * bw + bw * (storefront ? 0.06 : 0.18), y = r * bh + bh * (storefront ? 0.12 : 0.25);
      const w = bw * (storefront ? 0.88 : 0.64), h = bh * (storefront ? 0.82 : 0.5);
      const on = rnd() < (storefront ? 0.85 : 0.42);
      if (emit) {
        if (on) { g.fillStyle = storefront ? '#ffd9a0' : rnd() < 0.5 ? '#ffcf8a' : '#fff1d6'; g.fillRect(x, y, w, h); }
      } else {
        g.fillStyle = '#1d2a36'; g.fillRect(x, y, w, h);
        g.fillStyle = 'rgba(160,200,230,0.25)'; g.fillRect(x, y, w, h * 0.35);
        g.strokeStyle = '#3b4148'; g.lineWidth = 4; g.strokeRect(x, y, w, h);
        if (style === 'residential' && !storefront) { g.fillStyle = '#7c5845'; g.fillRect(x - 6, y + h, w + 12, 10); }
      }
    }
    if (!emit && style === 'retail') { g.fillStyle = '#8b2f2a'; g.fillRect(0, bh * 3 - 6, W, 14); }
  };
  return { map: canvasTex(W, draw(false)), emissive: canvasTex(W, draw(true)) };
}

export class SiteView {
  constructor(scene, overlayUniforms, inject) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'site';
    scene.add(this.group);
    this.groundMats = [];
    this._ground(inject, overlayUniforms);
    this._context();
    this.veg = new Vegetation(this.group, S.trees);
    this.life = new StreetLife(this.group);
    this._cars();
    this._lamps();
    this._cafe();
  }

  _ground(inject, U) {
    const g = this.group;
    const mk = (opts) => { const m = new THREE.MeshStandardMaterial(opts); inject(m, U); this.groundMats.push(m); return m; };
    const G = tex('grass'), AS = tex('asphalt'), PV = tex('pavers'), ST = tex('stone');
    const pbr = (t, extra = {}) => ({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1, ...extra });
    const grass = mk(pbr(G, { color: '#b9c8a6', normalScale: new THREE.Vector2(0.6, 0.6) }));
    const lawn = mk(pbr(G, { color: '#dcebc4', normalScale: new THREE.Vector2(0.8, 0.8) }));
    const asphalt = mk(pbr(AS, { normalScale: new THREE.Vector2(0.7, 0.7) }));
    const sidewalk = mk(pbr(PV, { normalScale: new THREE.Vector2(0.9, 0.9) }));
    const paving = mk(pbr(ST, { normalScale: new THREE.Vector2(0.8, 0.8) }));
    const curb = new THREE.MeshStandardMaterial({ color: '#d9d5cd', roughness: 0.8 });
    const paint = new THREE.MeshStandardMaterial({ color: '#e9e6dc', roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0.03 });
    const yellow = new THREE.MeshStandardMaterial({ color: '#e7b53c', roughness: 0.6 });

    g.add(planeAt(grass, -350, -350, 350, 350, 0, 5.3));
    for (const r of S.lawns) g.add(planeAt(lawn, r[0], r[1], r[2], r[3], 0.012, 3));
    for (const r of S.roads) g.add(planeAt(asphalt, r.rect[0], r.rect[1], r.rect[2], r.rect[3], 0.02, 4));
    const pk = S.parking.rect;
    g.add(planeAt(asphalt, pk[0], pk[1], pk[2], pk[3], 0.02, 4));
    for (const r of S.sidewalks) {
      g.add(slabAt(sidewalk, r[0], r[1], r[2], r[3], 0, 0.1, false, 1.2));
    }
    g.add(slabAt(paving, ...S.plaza, 0, 0.06, false, 2.4));
    g.add(slabAt(paving, ...S.walkway, 0, 0.06, false, 2.4));
    // cafe terrace deck
    const ct = S.cafe_terrace.rect;
    g.add(slabAt(new THREE.MeshStandardMaterial({ color: '#8c6a4e', roughness: 0.7 }), ct[0], ct[1], ct[2], ct[3], 0, 0.12));

    // lane markings
    const marks = [];
    const dash = (x0, y0, x1, y1, mat = paint) => marks.push(slabAt(mat, x0, y0, x1, y1, 0.021, 0.032));
    const ms = S.roads.find((r) => r.id === 'main_street').rect;
    const cy = (ms[1] + ms[3]) / 2;
    for (let x = ms[0]; x < ms[2]; x += 6) if (!(x > -40 && x < -28)) dash(x, cy - 0.07, x + 3, cy + 0.07);
    dash(ms[0], ms[1] + 0.35, -38.5, ms[1] + 0.47); dash(-29.5, ms[1] + 0.35, ms[2], ms[1] + 0.47);
    dash(ms[0], ms[3] - 0.47, -38.5, ms[3] - 0.35); dash(-29.5, ms[3] - 0.47, 30.5, ms[3] - 0.35); dash(37.5, ms[3] - 0.47, ms[2], ms[3] - 0.35);
    for (let i = 0; i < 9; i++) dash(-4 + i * 0.95, ms[1] + 0.8, -4 + i * 0.95 + 0.5, ms[3] - 0.8);           // zebra crossing
    const ss = S.roads.find((r) => r.id === 'side_street').rect;
    const cx = (ss[0] + ss[2]) / 2;
    for (let y = ss[1]; y < ss[3]; y += 6) dash(cx - 0.07, y, cx + 0.07, y + 3, yellow);
    for (const row of S.parking.rows) {
      for (let x = row.x0; x <= row.x1 + 1e-6; x += S.parking.stall) dash(x - 0.06, row.y0, x + 0.06, row.y1);
    }
    marks.forEach((m) => g.add(m));
    // curbs along the main street
    for (const [y0, y1] of [[ms[3] - 0.02, ms[3] + 0.18], [ms[1] - 0.18, ms[1] + 0.02]]) {
      g.add(slabAt(curb, ms[0], y0, -38, y1, 0, 0.14));
      g.add(slabAt(curb, -30, y0, ms[2], y1, 0, 0.14));
    }
    // benches & planters on the plaza
    const wood = new THREE.MeshStandardMaterial({ color: '#8a5f3c', roughness: 0.7 });
    const planter = new THREE.MeshStandardMaterial({ color: '#7d7a73', roughness: 0.9 });
    for (const x of [-16, -9, 9, 16]) { g.add(slabAt(wood, x - 1, -12.4, x + 1, -11.9, 0.06, 0.5, true)); }
    for (const x of [-12.5, 12.5]) g.add(slabAt(planter, x - 1.2, -13, x + 1.2, -10.6, 0.06, 0.6, true));
  }

  _context() {
    this.ctxEmissive = [];
    for (const c of B.context) {
      const [x0, y0, x1, y1] = c.rect, h = c.height;
      const ft = facadeTextures(c.style, true);
      const mat = new THREE.MeshStandardMaterial({ map: ft.map, emissiveMap: ft.emissive, emissive: '#ffffff', emissiveIntensity: 1, roughness: 0.75 });
      this.ctxEmissive.push(mat);
      const grp = new THREE.Group();
      const faces = [
        [[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]],
      ];
      for (const [a, b] of faces) {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const geo = new THREE.PlaneGeometry(len, h);
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 12, uv.getY(i) * h / 14);
        const m = new THREE.Mesh(geo, mat);
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        m.position.copy(P(mid[0], mid[1], h / 2));
        // outward normal = right of a→b for a counter-clockwise outline: (dy, −dx)
        const dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len;
        m.rotation.y = Math.atan2(dy, dx);
        m.castShadow = true; m.receiveShadow = true;
        grp.add(m);
      }
      // roof: gravel membrane, parapet with coping, rooftop plant
      const RF = tex('roof');
      const roofGeo = new THREE.BoxGeometry(x1 - x0, 0.3, y1 - y0);
      roofGeo.translate(...P((x0 + x1) / 2, (y0 + y1) / 2, h + 0.15).toArray());
      boxMapUV(roofGeo, 2, 2);
      const roof = new THREE.Mesh(roofGeo, this.ctxRoofMat ??= new THREE.MeshStandardMaterial({ map: RF.map, normalMap: RF.normalMap, roughnessMap: RF.roughnessMap, color: '#c9c6c0', roughness: 1 }));
      roof.receiveShadow = true;
      grp.add(roof);
      const para = this.ctxParaMat ??= new THREE.MeshStandardMaterial({ color: '#d8d2c6', roughness: 0.8 });
      const t = 0.25, ph = 0.9;
      for (const [ax0, ay0, ax1, ay1] of [[x0 - 0.1, y0 - 0.1, x1 + 0.1, y0 + t], [x0 - 0.1, y1 - t, x1 + 0.1, y1 + 0.1], [x0 - 0.1, y0, x0 + t, y1], [x1 - t, y0, x1 + 0.1, y1]]) {
        grp.add(slabAt(para, ax0, ay0, ax1, ay1, h, h + ph, true));
      }
      const plant = this.ctxPlantMat ??= new THREE.MeshStandardMaterial({ color: '#9aa1a8', roughness: 0.4, metalness: 0.6 });
      const cx = (x0 + x1) / 2, cyy = (y0 + y1) / 2;
      for (const [dx, dy, w, d, hh] of [[-0.25, -0.15, 3.2, 2.2, 1.4], [0.2, 0.2, 2.4, 2.4, 1.1], [0.05, -0.3, 1.6, 1.6, 2.2]]) {
        const px = cx + dx * (x1 - x0), py = cyy + dy * (y1 - y0);
        grp.add(slabAt(plant, px - w / 2, py - d / 2, px + w / 2, py + d / 2, h + 0.3, h + 0.3 + hh, true));
      }
      const inner = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 - 0.2, h, y1 - y0 - 0.2), new THREE.MeshStandardMaterial({ color: '#1a1e24' }));
      inner.position.copy(P((x0 + x1) / 2, (y0 + y1) / 2, h / 2));
      grp.add(inner);
      // name label
      const el = document.createElement('div');
      el.className = 'ctx-label';
      el.dataset.en = c.name.en; el.dataset.ar = c.name.ar;
      el.textContent = c.name.en;
      const lab = new CSS2DObject(el);
      lab.position.copy(P((x0 + x1) / 2, (y0 + y1) / 2, h + 2.2));
      grp.add(lab);
      this.ctxLabels = [...(this.ctxLabels ?? []), lab];
      this.group.add(grp);
    }
  }

  _cars() {
    const parked = S.cars;
    const moving = S.traffic;
    const N = parked.length + moving.length;
    const body = new THREE.InstancedMesh(new RoundedBoxGeometry(4.3, 0.72, 1.82, 3, 0.2), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.32, metalness: 0.55 }), N);
    const cabin = new THREE.InstancedMesh(new RoundedBoxGeometry(2.3, 0.64, 1.62, 3, 0.22), new THREE.MeshStandardMaterial({ color: '#141b25', roughness: 0.12, metalness: 0.7 }), N);
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 16);
    wheelGeo.rotateX(Math.PI / 2);
    const wheels = new THREE.InstancedMesh(wheelGeo, new THREE.MeshStandardMaterial({ color: '#15171a', roughness: 0.8 }), N * 4);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.14, 0.42), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff6dd', emissiveIntensity: 2.5 }), N * 2);
    const tail = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.12, 0.38), new THREE.MeshStandardMaterial({ color: '#600', emissive: '#ff1a1a', emissiveIntensity: 2.2 }), N * 2);
    const rimGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.27, 14);
    rimGeo.rotateX(Math.PI / 2);
    const rims = new THREE.InstancedMesh(rimGeo, new THREE.MeshStandardMaterial({ color: '#c3c8ce', roughness: 0.25, metalness: 0.9 }), N * 4);
    const mirrors = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.1, 0.2), new THREE.MeshStandardMaterial({ color: '#1c2128', roughness: 0.4 }), N * 2);
    this.cars = { body, cabin, wheels, head, tail, rims, mirrors, parked, moving };
    const colors = parked.map((c) => new THREE.Color(c.color));
    const palette = ['#e8e8ea', '#b3202a', '#1d4f91', '#d8b25a'];
    moving.forEach((_, i) => colors.push(new THREE.Color(palette[i % palette.length])));
    colors.forEach((c, i) => body.setColorAt(i, c));
    parked.forEach((c, i) => this._placeCar(i, c.p[0], c.p[1], c.yaw));
    for (const im of [body, cabin, wheels]) { im.castShadow = true; im.receiveShadow = true; }
    for (const im of [body, cabin, wheels, head, tail, rims, mirrors]) { im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(im); }
  }

  _placeCar(i, x, y, yawDeg) {
    const { body, cabin, wheels, head, tail, rims, mirrors } = this.cars;
    const base = new THREE.Matrix4().compose(P(x, y, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(yawDeg)), new THREE.Vector3(1, 1, 1));
    const local = (lx, ly, lz) => new THREE.Matrix4().multiplyMatrices(base, new THREE.Matrix4().makeTranslation(lx, ly, lz));
    body.setMatrixAt(i, local(0, 0.68, 0));
    cabin.setMatrixAt(i, local(-0.25, 1.28, 0));
    [[1.35, 0.85], [1.35, -0.85], [-1.35, 0.85], [-1.35, -0.85]].forEach(([a, b], k) => { wheels.setMatrixAt(i * 4 + k, local(a, 0.34, b)); rims.setMatrixAt(i * 4 + k, local(a, 0.34, b * 1.02)); });
    [0.95, -0.95].forEach((b, k) => mirrors.setMatrixAt(i * 2 + k, local(0.75, 1.02, b)));
    [0.6, -0.6].forEach((b, k) => { head.setMatrixAt(i * 2 + k, local(2.15, 0.78, b)); tail.setMatrixAt(i * 2 + k, local(-2.15, 0.8, b)); });
  }

  _lamps() {
    const L = S.lamps;
    const street = L.filter((l) => l.kind !== 'bollard');
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.1, 6.5, 8); poleGeo.translate(0, 3.25, 0);
    const armGeo = new THREE.BoxGeometry(1.5, 0.08, 0.08); armGeo.translate(0.7, 6.4, 0);
    const headGeo = new THREE.BoxGeometry(0.6, 0.12, 0.28); headGeo.translate(1.35, 6.32, 0);
    const metal = new THREE.MeshStandardMaterial({ color: '#3a3f46', roughness: 0.5, metalness: 0.6 });
    this.lampMat = new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#ffd59a', emissiveIntensity: 3 });
    const pole = new THREE.InstancedMesh(poleGeo, metal, street.length);
    const arm = new THREE.InstancedMesh(armGeo, metal, street.length);
    const head = new THREE.InstancedMesh(headGeo, this.lampMat, street.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    street.forEach((l, i) => {
      // arm points towards yaw (plan degrees)
      m.compose(P(l.p[0], l.p[1], 0), q.setFromAxisAngle(up, THREE.MathUtils.degToRad(l.yaw ?? 0)), one);
      pole.setMatrixAt(i, m); arm.setMatrixAt(i, m); head.setMatrixAt(i, m);
    });
    pole.castShadow = true;
    this.group.add(pole, arm, head);
    const bol = L.filter((l) => l.kind === 'bollard');
    const bGeo = new THREE.CylinderGeometry(0.12, 0.14, 1.0, 10); bGeo.translate(0, 0.5, 0);
    const bTop = new THREE.CylinderGeometry(0.13, 0.13, 0.12, 10); bTop.translate(0, 1.0, 0);
    const bm = new THREE.InstancedMesh(bGeo, metal, bol.length), bt = new THREE.InstancedMesh(bTop, this.lampMat, bol.length);
    bol.forEach((l, i) => { m.compose(P(l.p[0], l.p[1], 0), q.identity(), one); bm.setMatrixAt(i, m); bt.setMatrixAt(i, m); });
    this.group.add(bm, bt);
    // warm light pools (additive decals)
    const pool = canvasTex(256, (g, n) => {
      const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
      gr.addColorStop(0, 'rgba(255,214,150,0.55)'); gr.addColorStop(0.5, 'rgba(255,190,120,0.18)'); gr.addColorStop(1, 'rgba(255,180,110,0)');
      g.fillStyle = gr; g.fillRect(0, 0, n, n);
    });
    this.poolMat = new THREE.MeshBasicMaterial({ map: pool, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 1 });
    const pg = new THREE.PlaneGeometry(11, 11); pg.rotateX(-Math.PI / 2);
    const pools = new THREE.InstancedMesh(pg, this.poolMat, street.length);
    street.forEach((l, i) => {
      const a = THREE.MathUtils.degToRad(l.yaw ?? 0);
      m.compose(P(l.p[0] + Math.cos(a) * 1.35, l.p[1] + Math.sin(a) * 1.35, 0.15), q.identity(), one);
      pools.setMatrixAt(i, m);
    });
    pools.renderOrder = 3;
    this.pools = pools;
    this.group.add(pools);
  }

  _cafe() {
    const T = S.cafe_tables;
    const top = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 18), new THREE.MeshStandardMaterial({ color: '#e9e4da', roughness: 0.5 }), T.length);
    const leg = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.04, 0.75, 6), new THREE.MeshStandardMaterial({ color: '#333' }), T.length * 2);
    const umb = new THREE.InstancedMesh(new THREE.ConeGeometry(1.5, 0.55, 16, 1, true), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, side: THREE.DoubleSide }), T.length);
    const chair = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.45, 0.42), new THREE.MeshStandardMaterial({ color: '#2f3a44', roughness: 0.7 }), T.length * 2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    const cols = ['#c9503f', '#efe3c8'].map((c) => new THREE.Color(c));
    T.forEach((t, i) => {
      const [x, y] = t.p;
      m.compose(P(x, y, 0.12 + 0.75), q, one); top.setMatrixAt(i, m);
      m.compose(P(x, y, 0.12 + 0.375), q, one); leg.setMatrixAt(i * 2, m);
      m.compose(P(x, y, 0.12 + 1.3), q, new THREE.Vector3(0.6, 3.5, 0.6)); leg.setMatrixAt(i * 2 + 1, m);
      m.compose(P(x, y, 0.12 + 2.45), q, one); umb.setMatrixAt(i, m); umb.setColorAt(i, cols[i % 2]);
      m.compose(P(x - 0.75, y, 0.12 + 0.23), q, one); chair.setMatrixAt(i * 2, m);
      m.compose(P(x + 0.75, y, 0.12 + 0.23), q, one); chair.setMatrixAt(i * 2 + 1, m);
    });
    for (const im of [top, leg, umb, chair]) { im.castShadow = true; im.receiveShadow = true; this.group.add(im); }
  }

  setMood(m) {
    this.lampMat.emissiveIntensity = 2.2 * m.lamp;
    this.poolMat.opacity = m.lamp > 0 ? Math.min(1, 0.6 * m.lamp) : 0;
    this.pools.visible = m.lamp > 0;
    for (const mat of this.ctxEmissive) mat.emissiveIntensity = 0.9 * m.windowGlow;
    this.life?.setMood(m);
    this.cars.head.material.emissiveIntensity = m.lamp > 0 ? 2.5 : 0.4;
    this.cars.tail.material.emissiveIntensity = m.lamp > 0 ? 2.2 : 0.4;
  }

  setLang(lang) { for (const l of this.ctxLabels) l.element.textContent = l.element.dataset[lang]; }
  setLabels(on) { for (const l of this.ctxLabels) l.visible = on; }

  update(dt, t) {
    const { moving, parked, body, cabin, wheels, head, tail, rims, mirrors } = this.cars;
    moving.forEach((c, k) => {
      const span = 230;
      let x = ((c.offset + c.speed * t * c.dir) % span + span) % span - span / 2;
      this._placeCar(parked.length + k, x, c.lane, c.dir > 0 ? 0 : 180);
    });
    for (const im of [body, cabin, wheels, head, tail, rims, mirrors]) im.instanceMatrix.needsUpdate = true;
    this.life.update(dt, t);
  }
}

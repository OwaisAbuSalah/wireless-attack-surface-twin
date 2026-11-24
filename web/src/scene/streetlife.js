// Life and context around the site: pedestrians, bus shelter, traffic lights, bins, bike racks
// and a distant city skyline. Visual only (not part of the radio model).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { P } from './world.js';
import { boxMapUV } from './textures.js';

const rng = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
const colorize = (g, hex) => {
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
};
const keep = (g) => { g.deleteAttribute('uv'); return g; };

/** person ~1.72 m, origin at the feet, facing +z. Returns {fixed (vertex colours), shirt}. */
function personGeo(skin, pants, hair) {
  const legL = keep(new THREE.CapsuleGeometry(0.07, 0.74, 3, 8)); legL.translate(-0.09, 0.44, 0);
  const legR = keep(new THREE.CapsuleGeometry(0.07, 0.74, 3, 8)); legR.translate(0.09, 0.44, 0);
  const head = keep(new THREE.SphereGeometry(0.105, 14, 10)); head.translate(0, 1.6, 0);
  const hairG = keep(new THREE.SphereGeometry(0.11, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55)); hairG.translate(0, 1.615, -0.01);
  const shoes = keep(new THREE.BoxGeometry(0.34, 0.07, 0.24)); shoes.translate(0, 0.035, 0.03);
  const fixed = mergeGeometries([colorize(legL, pants), colorize(legR, pants), colorize(head, skin), colorize(hairG, hair), colorize(shoes, '#2a2a2a')]);
  const torso = keep(new THREE.CapsuleGeometry(0.17, 0.42, 4, 10)); torso.scale(1, 1, 0.68); torso.translate(0, 1.16, 0);
  const armL = keep(new THREE.CapsuleGeometry(0.052, 0.55, 3, 8)); armL.rotateZ(0.08); armL.translate(-0.235, 1.13, 0);
  const armR = keep(new THREE.CapsuleGeometry(0.052, 0.55, 3, 8)); armR.rotateZ(-0.08); armR.translate(0.235, 1.13, 0);
  const shirt = mergeGeometries([torso, armL, armR]);
  return { fixed, shirt };
}

export class StreetLife {
  constructor(group) {
    this.group = group;
    const rnd = rng(9001);
    this._people(rnd);
    this._furniture(rnd);
    this._skyline(rnd);
  }

  _people(rnd) {
    const skins = ['#e0b99b', '#c99b78', '#a8785a', '#f0cdb4', '#8d5f45'];
    const shirts = ['#1f4e79', '#a23b3b', '#e8e6e1', '#2e6b4f', '#d9a441', '#5b4a7a', '#2b2f36', '#c96f4a', '#6c8fb3', '#7a7f87'];
    // walkers: [x, y, dirX, dirY, speed, min, max]  ·  standers: [x, y, yawDeg]
    const walkers = [];
    for (let i = 0; i < 9; i++) walkers.push({ lane: 'N', x: -90 + rnd() * 180, y: -15.6 + rnd() * 1.0, dir: rnd() < 0.5 ? 1 : -1, v: 1.1 + rnd() * 0.5 });
    for (let i = 0; i < 7; i++) walkers.push({ lane: 'S', x: -90 + rnd() * 180, y: -27.9 + rnd() * 0.9, dir: rnd() < 0.5 ? 1 : -1, v: 1.1 + rnd() * 0.5 });
    for (let i = 0; i < 4; i++) walkers.push({ lane: 'W', x: -39.6 + rnd() * 0.6, y: -10 + rnd() * 70, dir: rnd() < 0.5 ? 1 : -1, v: 1.1 + rnd() * 0.4 });
    const standers = [[-3.5, -11.4, 160], [-2.6, -11.0, 230], [5.2, -12.3, 15], [-14, -9.6, 90], [17.8, -27.6, 0], [18.6, -27.7, -20], [-6.8, -31.6, 70], [8.6, -30.1, 200], [26.5, -4.5, 120], [3.8, 13.5, 300], [4.6, 13.2, 120]];
    this.walkers = walkers;
    const N = walkers.length + standers.length;
    const variants = skins.map((sk, i) => personGeo(sk, ['#2c3e5a', '#3b3b3b', '#5a4a3a', '#1f2a3a', '#6b6b6b'][i], ['#1b1612', '#3a2a1e', '#0e0e0e', '#5a4026', '#141414'][i]));
    // one instanced pair per variant (keeps draw calls low)
    this.people = variants.map((v) => ({
      fixed: new THREE.InstancedMesh(v.fixed, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), N),
      shirt: new THREE.InstancedMesh(v.shirt, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }), N),
      count: 0,
    }));
    this.slots = [];
    const all = [...walkers.map((w) => ({ w })), ...standers.map(([x, y, yaw]) => ({ x, y, yaw }))];
    all.forEach((a, i) => {
      const v = this.people[i % variants.length];
      const idx = v.count++;
      v.shirt.setColorAt(idx, new THREE.Color(shirts[Math.floor(rnd() * shirts.length)]));
      this.slots.push({ v, idx, ...a, h: 0.94 + rnd() * 0.1, ph: rnd() * 6 });
    });
    for (const v of this.people) {
      v.fixed.count = v.count; v.shirt.count = v.count;
      for (const im of [v.fixed, v.shirt]) { im.castShadow = true; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(im); }
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);
    this.update(0, 0);
  }

  _furniture(rnd) {
    const g = this.group;
    const metal = new THREE.MeshStandardMaterial({ color: '#3a3f46', roughness: 0.45, metalness: 0.7 });
    const steel = new THREE.MeshStandardMaterial({ color: '#a7adb4', roughness: 0.3, metalness: 0.85 });
    const glass = new THREE.MeshPhysicalMaterial({ color: '#b9d4e0', transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.1, depthWrite: false });
    const add = (geo, mat, x, y, z, cast = true) => { const m = new THREE.Mesh(geo, mat); m.position.copy(P(x, y, z)); m.castShadow = cast; m.receiveShadow = true; g.add(m); return m; };

    // bus shelter on the south sidewalk
    const bx = 18.2, by = -28.4;
    add(new THREE.BoxGeometry(4.2, 0.12, 1.7), metal, bx, by, 2.55);
    add(new THREE.BoxGeometry(4.0, 2.2, 0.03), glass, bx, by - 0.75, 1.35, false);
    add(new THREE.BoxGeometry(0.03, 2.2, 1.4), glass, bx + 2.0, by, 1.35, false);
    for (const dx of [-2.0, 2.0]) for (const dy of [-0.78, 0.7]) add(new THREE.BoxGeometry(0.08, 2.5, 0.08), metal, bx + dx, by + dy, 1.25);
    add(new THREE.BoxGeometry(2.6, 0.08, 0.45), new THREE.MeshStandardMaterial({ color: '#8a5f3c', roughness: 0.7 }), bx - 0.4, by - 0.45, 0.48);
    const ad = add(new THREE.BoxGeometry(0.06, 1.7, 1.15), new THREE.MeshStandardMaterial({ color: '#0d2a3a', emissive: '#4fb6e6', emissiveIntensity: 0.9 }), bx - 2.0, by, 1.25);
    this.adMat = ad.material;

    // traffic lights at the zebra crossing
    this.lightMats = [];
    for (const [x, y, yaw] of [[-4.8, -16.7, 0], [4.8, -26.3, 180]]) {
      add(new THREE.CylinderGeometry(0.07, 0.09, 3.2, 10), metal, x, y, 1.6);
      const head = add(new RoundedBoxGeometry(0.32, 0.9, 0.3, 2, 0.04), metal, x, y, 3.55);
      head.rotation.y = THREE.MathUtils.degToRad(yaw);
      const red = new THREE.MeshStandardMaterial({ color: '#300', emissive: '#ff2a1a', emissiveIntensity: 2.5 });
      const green = new THREE.MeshStandardMaterial({ color: '#030', emissive: '#22ff66', emissiveIntensity: 0.0 });
      this.lightMats.push({ red, green });
      for (const [dz, mat] of [[0.24, red], [-0.24, green]]) {
        const l = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), mat);
        l.position.set(0, dz, 0.16);
        head.add(l);
      }
    }

    // bins along the sidewalks
    const binGeo = new THREE.CylinderGeometry(0.28, 0.25, 0.95, 14);
    binGeo.translate(0, 0.475, 0);
    const bins = [];
    for (let x = -85; x < 90; x += 27) { bins.push([x + 4, -14.6]); bins.push([x + 13, -28.6]); }
    const bm = new THREE.InstancedMesh(binGeo, new THREE.MeshStandardMaterial({ color: '#2f4a3a', roughness: 0.6, metalness: 0.3 }), bins.length);
    const m = new THREE.Matrix4();
    bins.forEach(([x, y], i) => { m.makeTranslation(P(x, y, 0.1)); bm.setMatrixAt(i, m); });
    bm.castShadow = true;
    g.add(bm);

    // bike racks near the east walkway
    const hoop = new THREE.TorusGeometry(0.38, 0.03, 8, 20, Math.PI);
    const racks = new THREE.InstancedMesh(hoop, steel, 7);
    for (let i = 0; i < 7; i++) {
      m.compose(P(21.2, -4.5 + i * 0.75, 0.06), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      racks.setMatrixAt(i, m);
    }
    racks.castShadow = true;
    g.add(racks);
  }

  _skyline(rnd) {
    // distant city: merged boxes on a ring beyond the study area, faded by fog
    const parts = [];
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 150 + rnd() * 170;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (Math.abs(x) < 115 && Math.abs(y) < 85) continue;
      const w = 12 + rnd() * 26, d = 12 + rnd() * 22, h = 7 + Math.pow(rnd(), 1.7) * 38;
      const g = new THREE.BoxGeometry(w, h, d);
      g.rotateY(rnd() * Math.PI);
      g.translate(x, h / 2, -y);
      parts.push(g);
    }
    const geo = mergeGeometries(parts);
    boxMapUV(geo, 12, 14);
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x2 = c.getContext('2d');
    const em = document.createElement('canvas');
    em.width = em.height = 256;
    const e2 = em.getContext('2d');
    x2.fillStyle = '#b9b3a8'; x2.fillRect(0, 0, 256, 256);
    e2.fillStyle = '#000'; e2.fillRect(0, 0, 256, 256);
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) {
      x2.fillStyle = '#2b3642'; x2.fillRect(k * 64 + 12, r * 64 + 16, 40, 30);
      if (rnd() < 0.45) { e2.fillStyle = rnd() < 0.5 ? '#ffd39a' : '#fff1d8'; e2.fillRect(k * 64 + 12, r * 64 + 16, 40, 30); }
    }
    const map = new THREE.CanvasTexture(c), emissiveMap = new THREE.CanvasTexture(em);
    for (const t of [map, emissiveMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; }
    this.skyMat = new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: '#ffffff', emissiveIntensity: 0.8, roughness: 0.85 });
    const mesh = new THREE.Mesh(geo, this.skyMat);
    mesh.receiveShadow = false;
    this.group.add(mesh);
  }

  setMood(m) {
    if (this.skyMat) this.skyMat.emissiveIntensity = 0.85 * m.windowGlow;
    if (this.adMat) this.adMat.emissiveIntensity = m.lamp > 0 ? 1.1 : 0.35;
  }

  update(dt, t) {
    const { _m: m, _q: q, _s: s, _up: up } = this;
    for (const sl of this.slots) {
      let x, y, yaw, bob = 0;
      if (sl.w) {
        const w = sl.w;
        if (w.lane === 'W') { w.y += w.dir * w.v * dt; if (w.y > 62) w.y = -12; if (w.y < -12) w.y = 62; x = w.x; y = w.y; yaw = w.dir > 0 ? Math.PI : 0; }
        else { w.x += w.dir * w.v * dt; if (w.x > 95) w.x = -95; if (w.x < -95) w.x = 95; x = w.x; y = w.y; yaw = w.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
        bob = Math.abs(Math.sin(t * 5.5 * w.v + sl.ph)) * 0.035;
      } else { x = sl.x; y = sl.y; yaw = THREE.MathUtils.degToRad(sl.yaw); bob = Math.sin(t * 1.3 + sl.ph) * 0.006; }
      q.setFromAxisAngle(up, yaw);
      m.compose(P(x, y, 0.1 + bob), q, s.set(sl.h, sl.h, sl.h));
      sl.v.fixed.setMatrixAt(sl.idx, m);
      sl.v.shirt.setMatrixAt(sl.idx, m);
    }
    for (const v of this.people) { v.fixed.instanceMatrix.needsUpdate = true; v.shirt.instanceMatrix.needsUpdate = true; }
    // traffic-light cycle (12 s)
    if (this.lightMats) {
      const ph = (t % 12) / 12;
      this.lightMats.forEach((l, i) => {
        const greenOn = i === 0 ? ph < 0.5 : ph >= 0.5;
        l.green.emissiveIntensity = greenOn ? 2.4 : 0.0;
        l.red.emissiveIntensity = greenOn ? 0.0 : 2.4;
      });
    }
  }
}

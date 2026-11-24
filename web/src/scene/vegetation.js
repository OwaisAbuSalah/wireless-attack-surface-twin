// Organic trees (3 broadleaf variants), date palms with alpha-textured fronds, cypresses and hedges.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { P } from './world.js';

const rng = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

function leafTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const rnd = rng(77);
  for (let i = 0; i < 95; i++) {
    const x = 20 + rnd() * 216, y = 20 + rnd() * 216;
    const dx = x - 128, dy = y - 128;
    if (dx * dx + dy * dy > 118 * 118) continue;
    const l = 14 + rnd() * 12, w = 6 + rnd() * 4, a = rnd() * Math.PI;
    const shade = 0.7 + rnd() * 0.45;
    g.fillStyle = `rgb(${Math.round(70 * shade)},${Math.round(112 * shade)},${Math.round(48 * shade)})`;
    g.save(); g.translate(x, y); g.rotate(a);
    g.beginPath(); g.ellipse(0, 0, l, w, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(30,50,20,0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-l, 0); g.lineTo(l, 0); g.stroke();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** leaf cards scattered over the canopy blobs; normals point outwards for soft volumetric shading */
function leafCards(blobs, seed) {
  const rnd = rng(seed);
  const pos = [], nor = [], uv = [], col = [];
  const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const { c, r } of blobs) {
    const n = Math.round(26 * r * r);
    for (let i = 0; i < n; i++) {
      v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
      if (v.lengthSq() < 1e-3) continue;
      v.normalize();
      const center = v.clone().multiplyScalar(r * (0.78 + rnd() * 0.32)).add(c);
      a.crossVectors(v, up); if (a.lengthSq() < 1e-3) a.set(1, 0, 0); a.normalize();
      b.crossVectors(v, a).normalize();
      const rot = rnd() * Math.PI, sz = 0.55 + rnd() * 0.35;
      const ax = a.clone().multiplyScalar(Math.cos(rot) * sz).add(b.clone().multiplyScalar(Math.sin(rot) * sz));
      const bx = a.clone().multiplyScalar(-Math.sin(rot) * sz).add(b.clone().multiplyScalar(Math.cos(rot) * sz));
      const q = [center.clone().sub(ax).sub(bx), center.clone().add(ax).sub(bx), center.clone().add(ax).add(bx), center.clone().sub(ax).add(bx)];
      const shade = 0.55 + 0.45 * (v.y * 0.5 + 0.5);
      const tri = [0, 1, 2, 0, 2, 3], uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (const k of tri) { pos.push(q[k].x, q[k].y, q[k].z); nor.push(v.x, v.y, v.z); uv.push(...uvs[k]); col.push(shade, shade, shade); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** lumpy inner canopy made of displaced blobs; vertex colours darken the underside (fake AO) */
function canopyGeo(seed) {
  const rnd = rng(seed);
  const parts = [], blobs = [];
  const n = 7 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const r = i === 0 ? 1.55 : 0.85 + rnd() * 0.6;
    let g = new THREE.IcosahedronGeometry(r, 3);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    g = mergeVertices(g);
    const p = g.attributes.position;
    const ph = rnd() * 10;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const d = 1 + 0.13 * Math.sin(x * 3.1 + ph) * Math.sin(y * 2.9 + ph * 0.7) * Math.sin(z * 3.4 + ph * 1.3)
        + 0.06 * Math.sin(x * 7.3 + z * 6.1 + ph);
      p.setXYZ(k, x * d, y * d * 0.82, z * d);
    }
    const ang = rnd() * Math.PI * 2, rad = i === 0 ? 0 : 0.7 + rnd() * 0.9;
    const cy = i === 0 ? 4.0 : 3.3 + rnd() * 1.5;
    const cx = Math.cos(ang) * rad, cz = Math.sin(ang) * rad;
    g.scale(0.84, 0.84, 0.84);
    g.translate(cx, cy, cz);
    blobs.push({ c: new THREE.Vector3(cx, cy, cz), r });
    parts.push(g);
  }
  const m = mergeGeometries(parts);
  m.computeVertexNormals();
  const nrm = m.attributes.normal, pos = m.attributes.position;
  const col = new Float32Array(nrm.count * 3);
  for (let k = 0; k < nrm.count; k++) {
    const up = nrm.getY(k) * 0.5 + 0.5;
    const hgt = Math.min(1, Math.max(0, (pos.getY(k) - 2.4) / 3.5));
    const v = 0.3 + 0.4 * (0.55 * up + 0.45 * hgt);
    col.set([v, v, v], k * 3);
  }
  m.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return { inner: m, cards: leafCards(blobs, seed * 7 + 1) };
}

function trunkGeo() {
  const t = new THREE.CylinderGeometry(0.1, 0.19, 3.3, 8);
  t.translate(0, 1.65, 0);
  const b1 = new THREE.CylinderGeometry(0.05, 0.09, 1.5, 6);
  b1.translate(0, 0.75, 0); b1.rotateZ(0.7); b1.translate(0.05, 2.3, 0);
  const b2 = new THREE.CylinderGeometry(0.05, 0.08, 1.3, 6);
  b2.translate(0, 0.65, 0); b2.rotateX(-0.75); b2.translate(0, 2.6, 0.05);
  return mergeGeometries([t, b1, b2]);
}

function frondTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 512;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 512);
  g.strokeStyle = '#6f6a3a'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 512); g.stroke();
  for (let y = 14; y < 505; y += 5) {
    const len = 60 * Math.sin((y / 512) * Math.PI) + 5;
    for (const s of [-1, 1]) {
      const grad = g.createLinearGradient(64, y, 64 + s * len, y + 30);
      grad.addColorStop(0, '#355c24'); grad.addColorStop(1, '#5e8a36');
      g.strokeStyle = grad; g.lineWidth = 5.5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(64, y); g.quadraticCurveTo(64 + s * len * 0.6, y + 8, 64 + s * len, y + 30); g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function palmGeo() {
  // gently curved trunk with ring texture via vertex colours
  const trunk = new THREE.CylinderGeometry(0.17, 0.25, 7, 10, 28);
  trunk.translate(0, 3.5, 0);
  const p = trunk.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let k = 0; k < p.count; k++) {
    const y = p.getY(k);
    p.setX(k, p.getX(k) + 0.012 * y * y);
    const ring = 0.75 + 0.25 * Math.abs(Math.sin(y * 9));
    col.set([0.48 * ring, 0.4 * ring, 0.31 * ring], k * 3);
  }
  trunk.setAttribute('color', new THREE.BufferAttribute(col, 3));
  trunk.computeVertexNormals();
  // fronds: bent strips around the crown
  const fronds = [];
  const top = new THREE.Vector3(0.012 * 49, 7, 0);
  for (let i = 0; i < 15; i++) {
    const f = new THREE.PlaneGeometry(1.7, 3.8, 1, 10);
    const fp = f.attributes.position;
    for (let k = 0; k < fp.count; k++) {
      const yy = fp.getY(k) + 1.8;                  // 0..3.6 along the frond
      fp.setXYZ(k, fp.getX(k), yy, -0.11 * yy * yy); // droop
    }
    f.rotateX(-Math.PI / 2 + 0.45 + (i % 3) * 0.22);
    f.rotateY((i / 15) * Math.PI * 2 + (i % 2) * 0.2);
    f.translate(top.x, top.y, top.z);
    f.computeVertexNormals();
    fronds.push(f);
  }
  // fibrous crown where the fronds meet
  const crown = new THREE.SphereGeometry(0.42, 12, 8);
  crown.scale(1, 0.7, 1); crown.translate(top.x, top.y - 0.1, top.z);
  crown.setAttribute('color', new THREE.BufferAttribute(new Float32Array(crown.attributes.position.count * 3).fill(0.38), 3));
  crown.deleteAttribute('uv');
  trunk.deleteAttribute('uv');
  return { trunk: mergeGeometries([trunk, crown]), fronds: mergeGeometries(fronds) };
}

export class Vegetation {
  constructor(group, trees) {
    const leafy = trees.filter((t) => !(t.p[1] > -14.2 && t.p[1] < -8 && Math.abs(t.p[0]) < 24));
    const palms = trees.filter((t) => t.p[1] > -14.2 && t.p[1] < -8 && Math.abs(t.p[0]) < 24);
    // extra palms flanking the entrance and along the plaza edge
    for (const x of [-8.2, 8.2, -20.5, 20.5]) palms.push({ p: [x, -13.1], s: 1 + (Math.abs(x) % 3) * 0.06 });
    const rnd = rng(4242);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

    // broadleaf trees: 3 canopy variants
    const canopyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, color: '#ffffff' });
    const cardMat = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.85, color: '#ffffff' });
    const barkMat = new THREE.MeshStandardMaterial({ color: '#5a4636', roughness: 0.95 });
    const tg = trunkGeo();
    const variants = [canopyGeo(11), canopyGeo(23), canopyGeo(37)];
    const greens = ['#9fbf86', '#b3cc8f', '#8fb07a', '#c2d39a', '#a7c28a', '#b9c98e'].map((c) => new THREE.Color(c));
    const buckets = variants.map(() => []);
    leafy.forEach((t, i) => buckets[i % 3].push(t));
    const trunks = new THREE.InstancedMesh(tg, barkMat, leafy.length);
    let ti = 0;
    buckets.forEach((list, v) => {
      const im = new THREE.InstancedMesh(variants[v].inner, canopyMat, list.length);
      const ic = new THREE.InstancedMesh(variants[v].cards, cardMat, list.length);
      list.forEach((t, i) => {
        const k = t.s * (0.95 + rnd() * 0.2);
        q.setFromAxisAngle(up, rnd() * Math.PI * 2);
        m.compose(P(t.p[0], t.p[1], 0), q, s.set(k, k * (0.92 + rnd() * 0.2), k));
        im.setMatrixAt(i, m);
        ic.setMatrixAt(i, m);
        const tint = greens[Math.floor(rnd() * greens.length)];
        im.setColorAt(i, tint);
        ic.setColorAt(i, tint);
        trunks.setMatrixAt(ti++, m);
      });
      for (const x of [im, ic]) { x.castShadow = true; x.receiveShadow = true; group.add(x); }
    });
    trunks.castShadow = true;
    group.add(trunks);

    // palms
    const pg = palmGeo();
    const trunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const frondMat = new THREE.MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8, color: '#dfe9cf' });
    const pt = new THREE.InstancedMesh(pg.trunk, trunkMat, palms.length);
    const pf = new THREE.InstancedMesh(pg.fronds, frondMat, palms.length);
    palms.forEach((t, i) => {
      const k = 0.85 + t.s * 0.2;
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      m.compose(P(t.p[0], t.p[1], 0), q, s.set(k, k * (0.9 + rnd() * 0.25), k));
      pt.setMatrixAt(i, m); pf.setMatrixAt(i, m);
    });
    for (const im of [pt, pf]) { im.castShadow = true; im.receiveShadow = true; group.add(im); }

    // cypresses on the campus lawn
    const cy = [[-23, 12], [-23, 16], [-23, 20], [21, 12], [21, 16], [21, 20]];
    const cyGeo = (() => { let g = new THREE.IcosahedronGeometry(1, 3); g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g); g.scale(0.8, 3.4, 0.8); g.translate(0, 3.6, 0); g.computeVertexNormals(); return g; })();
    const cyp = new THREE.InstancedMesh(cyGeo, new THREE.MeshStandardMaterial({ color: '#2f4f2a', roughness: 0.9 }), cy.length);
    cy.forEach(([x, y], i) => { m.compose(P(x, y, 0), q.identity(), s.set(1, 0.9 + rnd() * 0.25, 1)); cyp.setMatrixAt(i, m); });
    cyp.castShadow = true; cyp.receiveShadow = true;
    group.add(cyp);

    // hedges around the building walkway (leaving the entrance free)
    const hedges = [
      [-20.4, -9.9, -10, -9.3], [10, -9.9, 20.4, -9.3], [-20.4, 9.3, 20.4, 9.9], [-20.4, -6, -19.8, 9.3], [19.8, -6, 20.4, 9.3],
    ];
    const hg = new RoundedBoxGeometry(1, 1, 1, 3, 0.35);
    const hm = new THREE.InstancedMesh(hg, new THREE.MeshStandardMaterial({ color: '#3d6230', roughness: 0.95 }), hedges.length);
    hedges.forEach(([x0, y0, x1, y1], i) => { m.compose(P((x0 + x1) / 2, (y0 + y1) / 2, 0.45), q.identity(), s.set(x1 - x0, 0.9, y1 - y0)); hm.setMatrixAt(i, m); });
    hm.castShadow = true; hm.receiveShadow = true;
    group.add(hm);
  }
}

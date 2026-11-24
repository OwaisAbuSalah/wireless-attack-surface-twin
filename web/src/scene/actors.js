// Interactive actors: the access point (with signal waves), the attacker and the client devices.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { B, CLIENTS, FLOORS } from '../data.js';
import { P } from './world.js';
import { COLORS } from './overlays.js';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...o });
const glow = (color, intensity = 2.5) => new THREE.MeshStandardMaterial({ color: '#000', emissive: color, emissiveIntensity: intensity, toneMapped: false });
export const floorOfZ = (z) => Math.max(0, FLOORS.findIndex((f) => z >= f.z && z < f.z + f.height));

function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const HALO = radialTexture();

// ───────────────────────────── Access point ─────────────────────────────
export class RouterView {
  constructor(floorGroups) {
    this.floorGroups = floorGroups;
    this.group = new THREE.Group();
    this.group.name = 'router';
    this.model = new THREE.Group();
    this.model.scale.setScalar(2.4);
    this.group.add(this.model);

    // omni AP
    this.omni = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.05, 0.2, 3, 0.02), std('#f4f6f8', { roughness: 0.25, metalness: 0.1 }));
    body.castShadow = true;
    this.omni.add(body);
    const antMat = std('#1f2329', { roughness: 0.4 });
    for (const [x, z, r] of [[-0.12, -0.08, -0.18], [-0.04, -0.09, -0.06], [0.04, -0.09, 0.06], [0.12, -0.08, 0.18]]) {
      const a = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.2, 8), antMat);
      a.position.set(x, 0.12, z); a.rotation.z = r;
      this.omni.add(a);
    }
    this.led = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.012), glow(COLORS.defense, 4));
    this.led.position.set(0, 0.012, 0.101);
    this.omni.add(this.led);
    this.model.add(this.omni);

    // directional patch panel
    this.patch = new THREE.Group();
    const panel = new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.32, 0.06, 3, 0.02), std('#eef1f4', { roughness: 0.3 }));
    panel.castShadow = true;
    this.patch.add(panel);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), std('#cfd6dd', { roughness: 0.4 }));
    face.position.z = 0.031;
    this.patch.add(face);
    const pled = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, 0.01), glow(COLORS.defense, 4));
    pled.position.set(0, -0.12, 0.033);
    this.patch.add(pled);
    this.patchLed = pled;
    this.model.add(this.patch);
    this.patch.visible = false;

    // halo + waves
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: HALO, color: COLORS.defense, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9 }));
    this.halo.scale.setScalar(2.6);
    this.group.add(this.halo);
    this.waveMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(COLORS.defense) }, uAlpha: { value: 0.5 } },
      vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.2); gl_FragColor = vec4(uColor * 1.6, f * uAlpha); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.waves = [0, 1, 2].map((i) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), this.waveMat.clone());
      m.userData.phase = i / 3;
      this.group.add(m);
      return m;
    });

    // pick target
    this.hit = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.hit.userData.pick = 'router';
    this.group.add(this.hit);

    const el = document.createElement('div');
    el.className = 'ap-label';
    this.labelEl = el;
    this.label = new CSS2DObject(el);
    this.label.position.set(0, 2.7, 0);
    this.group.add(this.label);
    this.wavesOn = true;
  }

  place(pos, ant) {
    const k = floorOfZ(pos[2]);
    if (this.group.parent !== this.floorGroups[k]) this.floorGroups[k].add(this.group);
    this.group.position.copy(P(...pos));
    const isPatch = ant.type === 'patch';
    this.omni.visible = !isPatch;
    this.patch.visible = isPatch;
    if (isPatch) {
      const f = ant.frame;
      const bore = P(f.b[0], f.b[1], f.b[2]);
      this.patch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), bore.normalize());
    }
  }

  setLabel(html) { this.labelEl.innerHTML = html; }

  update(dt, t, strength = 1) {
    this.led.material.emissiveIntensity = 3 + 2.5 * (Math.sin(t * 9) > 0.6 ? 1 : 0);
    this.patchLed.material.emissiveIntensity = this.led.material.emissiveIntensity;
    this.halo.material.opacity = 0.65 + 0.25 * Math.sin(t * 2.5);
    for (const w of this.waves) {
      w.visible = this.wavesOn;
      const ph = (t * 0.33 + w.userData.phase) % 1;
      const r = 0.6 + ph * 11 * strength;
      w.scale.setScalar(r);
      w.material.uniforms.uAlpha.value = 0.3 * (1 - ph) ** 1.8 * (this.waveFade ?? 1);
    }
  }
}

// ───────────────────────────── Attacker ─────────────────────────────
export class AttackerView {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'attacker';
    scene.add(this.group);
    this.body = new THREE.Group();
    this.body.scale.setScalar(1.35);
    this.group.add(this.body);

    const hoodie = std('#16191f', { roughness: 0.85 });
    const denim = std('#28324a', { roughness: 0.8 });
    const shoe = std('#e9e9ea', { roughness: 0.6 });
    const dark = std('#050608', { roughness: 1 });

    this.legs = [-0.1, 0.1].map((x) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.93, 0);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.7, 4, 10), denim);
      leg.position.y = -0.43; leg.castShadow = true;
      const s = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.08, 0.27, 2, 0.03), shoe);
      s.position.set(0, -0.89, 0.05); s.castShadow = true;
      pivot.add(leg, s);
      this.body.add(pivot);
      return pivot;
    });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.42, 6, 14), hoodie);
    torso.position.y = 1.3; torso.scale.z = 0.75; torso.castShadow = true;
    const pocket = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.1, 0.05, 2, 0.02), std('#1d2129'));
    pocket.position.set(0, 1.16, 0.145);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 16), hoodie);
    head.position.y = 1.73; head.scale.set(1, 1.08, 1.05); head.castShadow = true;
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.088, 24), dark);
    face.position.set(0, 1.71, 0.152);
    this.eyes = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.012), glow(COLORS.et, 3));
    this.eyes.position.set(0, 1.725, 0.154);
    this.body.add(torso, pocket, head, face, this.eyes);

    const arm = (side) => {
      const sh = new THREE.Group();
      sh.position.set(side * 0.25, 1.5, 0);
      const up = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.26, 4, 8), hoodie);
      up.position.set(0, -0.15, 0.04); up.rotation.x = 0.35; up.castShadow = true;
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.24, 4, 8), hoodie);
      fore.position.set(-side * 0.05, -0.33, 0.2); fore.rotation.x = 1.35; fore.rotation.z = side * 0.25; fore.castShadow = true;
      sh.add(up, fore);
      this.body.add(sh);
      return sh;
    };
    this.arms = [arm(-1), arm(1)];

    // laptop
    this.laptop = new THREE.Group();
    const base = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.022, 0.25, 2, 0.008), std('#2b2f36', { metalness: 0.6, roughness: 0.35 }));
    const lid = new THREE.Group();
    lid.position.set(0, 0.011, -0.12);
    lid.rotation.x = -1.75 + Math.PI / 2;
    const back = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.24, 0.012, 2, 0.006), std('#2b2f36', { metalness: 0.6, roughness: 0.35 }));
    back.position.y = 0.12;
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.21), glow('#3cff9e', 2.2));
    this.screen.position.set(0, 0.12, 0.007);
    lid.add(back, this.screen);
    this.laptop.add(base, lid);
    this.laptop.position.set(0, 1.12, 0.36);
    this.body.add(this.laptop);
    this.usbAnt = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.2, 8), std('#111'));
    this.usbAnt.position.set(0.2, 1.22, 0.3);
    this.body.add(this.usbAnt);

    // phone
    this.phone = new THREE.Group();
    const pb = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.15, 0.01, 2, 0.006), std('#111'));
    const ps = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.135), glow('#7cc7ff', 2));
    ps.position.z = 0.006; ps.rotation.y = 0;
    this.phone.add(pb, ps);
    this.phone.position.set(0.05, 1.3, 0.34);
    this.phone.rotation.x = -0.9;
    this.phone.rotation.y = Math.PI;
    this.body.add(this.phone);

    // yagi antenna
    this.yagi = new THREE.Group();
    const boomMat = std('#c9ced6', { metalness: 0.8, roughness: 0.3 });
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 8), boomMat);
    boom.rotation.x = Math.PI / 2; boom.position.z = 0.5;
    this.yagi.add(boom);
    for (let i = 0; i < 9; i++) {
      const e = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.3 - i * 0.012, 6), boomMat);
      e.rotation.z = Math.PI / 2; e.position.z = 0.08 + i * 0.11;
      this.yagi.add(e);
    }
    this.yagi.position.set(0.28, 1.35, 0.2);
    this.body.add(this.yagi);

    // status ring + beam
    this.ringMat = new THREE.MeshBasicMaterial({ color: COLORS.et, transparent: true, opacity: 0.95, toneMapped: false, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.12, 64), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.16;
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.MeshBasicMaterial({ map: HALO, color: COLORS.et, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.disc.rotation.x = -Math.PI / 2; this.disc.position.y = 0.15;
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(COLORS.et) }, uAlpha: { value: 0.5 } },
      vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uAlpha; varying float vY; void main(){ gl_FragColor = vec4(uColor * 1.8, uAlpha * pow(clamp(1.0 - vY, 0.0, 1.0), 2.0)); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.95, 26, 32, 1, true), this.beamMat);
    this.beam.position.y = 13;
    this.group.add(this.ring, this.disc, this.beam);

    this.hit = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 3, 12), new THREE.MeshBasicMaterial({ visible: false }));
    this.hit.position.y = 1.5;
    this.hit.userData.pick = 'attacker';
    this.group.add(this.hit);

    const el = document.createElement('div');
    el.className = 'att-label';
    this.labelEl = el;
    this.label = new CSS2DObject(el);
    this.label.position.set(0, 3.3, 0);
    this.group.add(this.label);

    this.pos = [...B.attack.start];
    this.walkPhase = 0;
    this.speed = 0;
    this.target = null;
    this.status = 'et';
    this.group.position.copy(P(this.pos[0], this.pos[1], 0));
  }

  setEquipment(key) {
    this.laptop.visible = key !== 'phone';
    this.phone.visible = key === 'phone';
    this.yagi.visible = key === 'yagi';
    this.usbAnt.visible = key === 'usb';
  }

  setStatus(level) {
    this.status = level;
    const c = { et: COLORS.et, deauth: COLORS.deauth, eav: COLORS.eav, safe: COLORS.safe }[level];
    this.ringMat.color.set(c).multiplyScalar(1.6);
    this.disc.material.color.set(c);
    this.beamMat.uniforms.uColor.value.set(c);
    this.beam.visible = level !== 'safe';
    this.eyes.material.emissive.set(level === 'safe' ? '#334155' : c);
  }

  setLabel(html) { this.labelEl.innerHTML = html; }

  faceTowards(planXY) {
    const dx = planXY[0] - this.pos[0], dy = planXY[1] - this.pos[1];
    // three: x = plan x, z = −plan y
    this.faceYaw = Math.atan2(dx, -dy);
  }

  /** returns true if the plan position changed */
  update(dt, t) {
    let moved = false;
    if (this.target) {
      const dx = this.target[0] - this.pos[0], dy = this.target[1] - this.pos[1];
      const d = Math.hypot(dx, dy);
      const v = Math.min(d, (this.target[2] ?? 4.2) * dt);
      if (d < 0.02) { this.target = null; }
      else { this.pos[0] += (dx / d) * v; this.pos[1] += (dy / d) * v; moved = true; this.speed = v / dt; }
    }
    if (!moved) this.speed *= Math.exp(-dt * 10);
    this.group.position.copy(P(this.pos[0], this.pos[1], 0));
    if (this.faceYaw !== undefined) {
      let d = this.faceYaw - this.body.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.body.rotation.y += d * (1 - Math.exp(-dt * 8));
    }
    const walk = Math.min(1, this.speed / 2.5);
    this.walkPhase += dt * (4 + this.speed * 2.2);
    const sw = Math.sin(this.walkPhase) * 0.55 * walk;
    this.legs[0].rotation.x = sw; this.legs[1].rotation.x = -sw;
    this.body.position.y = Math.abs(Math.cos(this.walkPhase)) * 0.04 * walk;
    const pulse = 1 + 0.08 * Math.sin(t * 5);
    this.ring.scale.setScalar(pulse);
    this.disc.material.opacity = 0.45 + 0.2 * Math.sin(t * 5);
    this.beamMat.uniforms.uAlpha.value = (0.35 + 0.12 * Math.sin(t * 3)) * (this.beamFade ?? 1);
    this.screen.material.emissiveIntensity = 2 + 0.4 * Math.sin(t * 13) * Math.sin(t * 7);
    return moved;
  }
}

// ───────────────────────────── Clients ─────────────────────────────
function deviceModel(kind) {
  const g = new THREE.Group();
  const shell = std('#d7dce2', { metalness: 0.4, roughness: 0.35 });
  const darkM = std('#1d2229');
  const scr = glow('#9ad7ff', 1.4);
  if (kind === 'laptop') {
    const base = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.02, 0.24, 2, 0.006), shell);
    const lid = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.22, 0.012, 2, 0.005), shell);
    lid.position.set(0, 0.115, -0.115); lid.rotation.x = -0.25;
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.19), scr);
    s.position.set(0, 0.115, -0.107); s.rotation.x = -0.25;
    g.add(base, lid, s);
  } else if (kind === 'tablet' || kind === 'phone') {
    const w = kind === 'phone' ? 0.08 : 0.26, d = kind === 'phone' ? 0.16 : 0.19;
    const b = new THREE.Mesh(new RoundedBoxGeometry(w, 0.012, d, 2, 0.005), darkM);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, d * 0.88), scr);
    s.rotation.x = -Math.PI / 2; s.position.y = 0.007;
    g.add(b, s);
  } else if (kind === 'desktop') {
    const mon = new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.34, 0.03, 2, 0.01), darkM);
    mon.position.y = 0.32;
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.51, 0.3), scr);
    s.position.set(0, 0.32, 0.016);
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.05), darkM);
    st.position.y = 0.08;
    g.add(mon, s, st);
  } else {
    const b = new THREE.Mesh(new RoundedBoxGeometry(0.45, 0.32, 0.4, 2, 0.03), std('#eceff2'));
    b.position.y = 0.16;
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.18), darkM);
    t.position.set(0, 0.34, 0.12);
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.01), glow('#34d399', 3));
    l.position.set(0.15, 0.27, 0.201);
    g.add(b, t, l);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export class ClientsView {
  constructor(floorGroups) {
    this.items = new Map();
    for (const c of CLIENTS) {
      const k = floorOfZ(c.pos[2]);
      const grp = new THREE.Group();
      grp.position.copy(P(c.pos[0], c.pos[1], c.pos[2] - 0.35));
      const model = deviceModel(c.kind);
      model.scale.setScalar(1.8);
      grp.add(model);
      const mk = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), new THREE.MeshBasicMaterial({ color: COLORS.safe, toneMapped: false }));
      mk.position.y = 1.35;
      mk.scale.y = 1.4;
      grp.add(mk);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.68, 40), new THREE.MeshBasicMaterial({ color: COLORS.safe, transparent: true, opacity: 0.9, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
      grp.add(ring);
      const el = document.createElement('div');
      el.className = 'client-label';
      el.dataset.en = c.name.en; el.dataset.ar = c.name.ar;
      el.textContent = c.name.en;
      const lab = new CSS2DObject(el);
      lab.position.y = 1.85;
      lab.visible = false;
      grp.add(lab);
      floorGroups[k].add(grp);
      this.items.set(c.id, { grp, mk, ring, lab, el, state: 'safe' });
    }
    this.markerAnchor = new Map([...this.items].map(([id, it]) => [id, it.mk]));
  }

  setStates(evClients) {
    for (const c of evClients) {
      const it = this.items.get(c.id);
      const st = c.evilTwin ? 'et' : c.deauth ? 'deauth' : 'safe';
      it.state = st;
      const col = { et: COLORS.et, deauth: COLORS.deauth, safe: COLORS.safe }[st];
      it.mk.material.color.set(col).multiplyScalar(st === 'safe' ? 1.2 : 2.2);
      it.ring.material.color.set(col).multiplyScalar(1.5);
      it.el.dataset.state = st;
    }
  }

  setLang(lang) { for (const it of this.items.values()) it.el.textContent = it.el.dataset[lang]; }
  setLabels(on) { for (const it of this.items.values()) it.lab.visible = on; }

  update(dt, t) {
    for (const it of this.items.values()) {
      it.mk.rotation.y += dt * 1.6;
      const s = it.state === 'safe' ? 1 : 1 + 0.18 * Math.sin(t * 7);
      it.mk.scale.set(s, 1.4 * s, s);
      it.mk.position.y = 1.35 + 0.08 * Math.sin(t * 2 + it.grp.position.x);
    }
  }
}

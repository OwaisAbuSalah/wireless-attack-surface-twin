// Field visualisation. The maps are "painted" directly onto ground and floor materials by
// injecting GLSL into their standard shaders (so cars, trees and furniture stay on top),
// plus rays (AP → attacker), wall-crossing markers and attacker → client links.
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PALETTE_GLSL } from '../rf/glsl.js';
import { FOOT } from '../data.js';
import { P } from './world.js';

export const COLORS = {
  eav: '#ffd60a', deauth: '#ff8a00', et: '#ff2d55', hijack: '#b14cff', safe: '#34d399', defense: '#22d3ee',
};
const lin = (hex) => new THREE.Color(hex); // THREE.Color stores linear values (ColorManagement on)

/** Uniforms shared by every material that shows the field. */
export function makeOverlayUniforms() {
  return {
    tOutPrev: { value: null }, tOutCur: { value: null }, tOutBase: { value: null },
    tFloPrev: { value: null }, tFloCur: { value: null },
    tSionO: { value: null }, tSionF: { value: null },
    uMix: { value: 1 },
    uGridO: { value: new THREE.Vector4(-100, -70, 200, 140) },
    uGridF: { value: new THREE.Vector4(-18.5, -8.5, 37, 17) },
    uFootO: { value: new THREE.Vector4(...FOOT) },
    uGatt: { value: 5 }, uSatt: { value: -92 },
    uPmf: { value: 0 }, uWpa3: { value: 0 },
    uOvMode: { value: 1 },          // 0 off · 1 attack surface · 2 signal · 3 Sionna RT · 4 Sionna − real-time
    uTime: { value: 0 },
    uGhost: { value: 0 }, uContours: { value: 1 }, uWaves: { value: 1 },
    uRouterPlan: { value: new THREE.Vector2() },
    uFloorHeat: { value: 1 }, uHijack: { value: 1 }, uIntensity: { value: 1 }, uZones: { value: 1 }, uAttOk: { value: 1 },
    cEav: { value: lin(COLORS.eav) }, cDeauth: { value: lin(COLORS.deauth) }, cEt: { value: lin(COLORS.et) }, cHij: { value: lin(COLORS.hijack) },
  };
}

const OVERLAY_GLSL = /* glsl */ `
varying vec2 vPlan;
uniform sampler2D tOutPrev, tOutCur, tOutBase, tFloPrev, tFloCur, tSionO, tSionF;
uniform float uMix;
uniform vec4 uGridO, uGridF, uFootO;
uniform float uGatt, uSatt, uPmf, uWpa3, uTime, uGhost, uContours, uWaves, uFloorHeat, uHijack, uIntensity, uZones, uAttOk;
uniform int uOvMode;
uniform vec2 uRouterPlan;
uniform vec3 cEav, cDeauth, cEt, cHij;
${PALETTE_GLSL}

float hatch(vec2 p, float s, float w) { return step(1.0 - w, fract((p.x + p.y) * s + uTime * 0.35)); }

// NOTE: every derivative (fwidth) and texture fetch below runs in uniform control flow —
// derivatives after divergent early-returns are undefined on Direct3D and produced NaNs.

vec4 signalColor(float rss, float g10, float g5) {
  vec3 col = toLinear(turbo((rss + 100.0) / 70.0)) * 0.82;
  float a = smoothstep(-108.0, -96.0, rss) * 0.82;
  col = mix(col, vec3(0.0), max(g10 * 0.55, g5 * 0.4) * uContours);
  return vec4(col, a);
}

vec4 outdoorOverlay(vec2 p) {
  vec2 uv = (p - uGridO.xy) / uGridO.zw;
  vec2 uvc = clamp(uv, vec2(0.0), vec2(1.0));
  vec4 v = mix(textureLod(tOutPrev, uvc, 0.0), textureLod(tOutCur, uvc, 0.0), uMix);
  float srss = textureLod(tSionO, uvc, 0.0).r;
  float vb = textureLod(tOutBase, uvc, 0.0).r;
  bool sion = uOvMode == 3 || uOvMode == 4;
  float rss = uOvMode == 3 ? srss : v.r;
  float dd = srss - v.r;
  float mE = rss + uGatt - uSatt;
  // nested tiers: active attacks also need the attacker to hear the network (continuous min → clean iso-lines)
  float mD = (uPmf > 0.5 || sion) ? -1e3 : min(v.g, mE);
  float mT = (uWpa3 > 0.5 || sion) ? -1e3 : min(v.b, mE);
  float mB = vb + uGatt - uSatt;
  float lE = isoLine(mE, 1.6), lD = isoLine(mD, 1.6), lT = isoLine(mT, 1.6), lB = isoLine(mB, 1.4);
  float g10 = gridLines(rss, 10.0, 1.1), g5 = gridLines(rss, 5.0, 0.9), gd = gridLines(dd, 5.0, 1.0);

  float inGrid = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
  float inFoot = step(uFootO.x, p.x) * step(p.x, uFootO.z) * step(uFootO.y, p.y) * step(p.y, uFootO.w);
  float edge = smoothstep(0.0, 0.035, min(min(uvc.x, uvc.y), min(1.0 - uvc.x, 1.0 - uvc.y)));
  float mask = inGrid * (1.0 - inFoot) * edge * step(0.5, uZones) * (uOvMode == 0 ? 0.0 : 1.0);

  vec3 col = vec3(0.0);
  float a = 0.0;
  if (uOvMode == 2 || uOvMode == 3) {
    vec4 c = signalColor(rss, g10, g5);
    col = c.rgb; a = c.a;
    if (uOvMode == 3) { col = mix(col, cEav * 2.6, lE); a = max(a, lE * 0.9); }
  } else if (uOvMode == 4) {
    col = toLinear(diverging(dd / 20.0));
    col = mix(col, vec3(0.0), gd * 0.35 * uContours);
    a = (srss > -125.0 && v.r > -125.0) ? 0.85 : 0.0;
  } else {
    // ── attack surface ──
    float dist = length(p - uRouterPlan);
    float wave = uWaves > 0.5 ? 0.82 + 0.18 * sin(dist * 0.9 - uTime * 3.2) : 1.0;
    // intensity follows the attacker's margin: faint where the attack is marginal, solid near the building
    float kE = smoothstep(0.0, 55.0, mE), kD = smoothstep(0.0, 55.0, mD), kT = smoothstep(0.0, 25.0, mT);
    float hE = step(0.0, mE), hD = step(0.0, mD), hT = step(0.0, mT);
    col = cEav * (0.35 + 0.75 * kE) * hE;
    a = (0.05 + 0.27 * kE) * hE;
    col = mix(col, cDeauth * (0.35 + 0.8 * kD), 0.85 * hD);
    a = max(a, (0.06 + 0.29 * kD) * hD);
    col = mix(col, cEt * (0.7 + 0.8 * kT), hT);
    a = mix(a, 0.34 + 0.2 * kT + 0.14 * hatch(p, 0.55, 0.32), hT);
    col *= wave;
    // tier boundaries — glowing lines (bloom picks them up)
    col = mix(col, cEav * 2.6, lE); a = max(a, lE * 0.9);
    col = mix(col, cDeauth * 2.6, lD); a = max(a, lD * 0.9);
    col = mix(col, cEt * 3.0, lT); a = max(a, lT * 0.95);
    // baseline "ghost" contour (dashed) to show how much the zone shrank
    float g = lB * step(0.45, fract((p.x - p.y) * 0.35)) * step(0.5, uGhost);
    col = mix(col, vec3(1.6), g); a = max(a, g * 0.9);
    // faint "safe but receivable" haze so the viewer still sees the signal fall off
    float haze = (1.0 - step(0.01, a)) * step(-112.0, rss);
    col = mix(col, vec3(0.05, 0.28, 0.42) * 0.6, haze);
    a = mix(a, 0.16 * smoothstep(-112.0, -95.0, rss), haze);
  }
  return vec4(col * uIntensity, clamp(a, 0.0, 1.0) * mask);
}

vec4 floorOverlay(vec2 p, int k) {
  vec2 uv = (p - uGridF.xy) / uGridF.zw;
  vec2 uvc = clamp(uv, vec2(0.0), vec2(1.0));
  vec2 st = vec2(uvc.x, (clamp(uvc.y, 0.002, 0.998) + float(k)) / 3.0);
  vec4 v = mix(textureLod(tFloPrev, st, 0.0), textureLod(tFloCur, st, 0.0), uMix);
  float s = textureLod(tSionF, st, 0.0).r;
  float rss = uOvMode == 3 ? s : v.r;
  float dd = s - v.r;
  float h = min(v.g - v.r - 3.0, v.g + 75.0);
  float g10 = gridLines(rss, 10.0, 1.1), g5 = gridLines(rss, 5.0, 0.9), lH = isoLine(h, 1.5);
  float inGrid = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
  float mask = inGrid * step(0.5, uFloorHeat) * (uOvMode == 0 ? 0.0 : 1.0);

  vec4 c;
  if (uOvMode == 4) {
    c = vec4(toLinear(diverging(dd / 20.0)), s > -125.0 ? 0.9 : 0.0);
  } else {
    c = signalColor(rss, g10, g5);
    c.a = max(c.a, 0.25) * 0.95;
    // coverage hole marker (below −67 dBm)
    float hole = step(rss, -67.0);
    c.rgb = mix(c.rgb, c.rgb * 0.45, hole * hatch(p, 1.6, 0.5));
    // rogue-AP hijack zone (attacker signal ≥ AP + 3 dB and ≥ −75 dBm)
    float on = step(0.5, uHijack) * step(0.5, uAttOk) * (1.0 - step(0.5, uWpa3)) * (uOvMode == 3 ? 0.0 : 1.0);
    float inH = step(0.0, h) * on;
    c.rgb = mix(c.rgb, cHij * (1.2 + 0.6 * hatch(p, 0.9, 0.45)), 0.78 * inH);
    c.a = mix(c.a, 0.92, inH);
    c.rgb = mix(c.rgb, cHij * 3.5, lH * on);
  }
  return vec4(c.rgb, clamp(c.a, 0.0, 1.0) * mask);
}
`;

/** Inject the overlay into a MeshStandardMaterial. floor = -1 → outdoor ground. */
export function injectOverlay(mat, U, floor = -1) {
  mat.onBeforeCompile = (sh) => {
    for (const k of Object.keys(U)) sh.uniforms[k] = U[k];
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPlan;')
      .replace('#include <project_vertex>', `#include <project_vertex>
      {
        vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
        wp = modelMatrix * wp;
        vPlan = vec2(wp.x, -wp.z);
      }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${OVERLAY_GLSL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec4 ov = ${floor < 0 ? 'outdoorOverlay(vPlan)' : `floorOverlay(vPlan, ${floor})`};
        ov = clamp(ov, vec4(0.0), vec4(8.0, 8.0, 8.0, 1.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * ${floor < 0 ? '0.55' : '0.22'}, ov.a);
        totalEmissiveRadiance += ov.rgb * ov.a;
      }`);
  };
  mat.customProgramCacheKey = () => `overlay${floor}`;
  mat.needsUpdate = true;
}

// ───────────────────────── rays & links ─────────────────────────

function chip(cls) {
  const el = document.createElement('div');
  el.className = cls;
  return el;
}

export class RayView {
  constructor(scene, world) {
    this.world = world;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.mat = new LineMaterial({ linewidth: 3.2, vertexColors: true, transparent: true, opacity: 0.95, depthTest: true, worldUnits: false, toneMapped: false });
    this.geo = new LineGeometry();
    this.geo.setPositions([0, 0, 0, 1, 1, 1]);
    this.geo.setColors([1, 1, 1, 1, 1, 1]);
    this.line = new Line2(this.geo, this.mat);
    this.line.renderOrder = 5;
    this.group.add(this.line);
    this.glowMat = new LineMaterial({ linewidth: 11, color: 0xffffff, transparent: true, opacity: 0.14, depthTest: true, worldUnits: false, blending: THREE.AdditiveBlending, depthWrite: false });
    this.glow = new Line2(this.geo, this.glowMat);
    this.group.add(this.glow);
    this.markerGeo = new THREE.TorusGeometry(0.42, 0.06, 8, 32);
    this.markers = [];
    this.tags = [];
    this.linkMat = new LineMaterial({ linewidth: 2.4, color: 0xff2d55, dashed: true, dashSize: 0.7, gapSize: 0.45, transparent: true, opacity: 0.95, worldUnits: false, toneMapped: false });
    this.links = [];
    this.showTags = true;
  }

  setResolution(w, h) { for (const m of [this.mat, this.glowMat, this.linkMat]) m.resolution.set(w, h); for (const l of this.links) l.material.resolution.set(w, h); }

  /** ev = evaluateAttacker() result, rf = rf params. offsets: function(z) → extra y (explode) */
  update(ev, rf, visible) {
    this.group.visible = visible;
    if (!visible || !ev) return;
    const pts = [], cols = [];
    const turbo = (x) => {                       // tiny JS turbo for vertex colours
      x = Math.min(1, Math.max(0, x));
      const r = 0.13572138 + x * (4.6153926 + x * (-42.66032258 + x * (132.13108234 + x * (-152.94239396 + x * 59.28637943))));
      const g = 0.09140261 + x * (2.19418839 + x * (4.84296658 + x * (-14.18503333 + x * (4.27729857 + x * 2.82956604))));
      const b = 0.1066733 + x * (12.64194608 + x * (-60.58204836 + x * (110.36276771 + x * (-89.90310912 + x * 27.34824973))));
      return new THREE.Color().setRGB(Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b)), THREE.SRGBColorSpace);
    };
    const a = ev.txPos ?? rf.pos, b = ev.pos;
    const lvl = (t, wallsBefore) => {
      const d = Math.max(t * ev.d, 0.5);
      return rf.ptx + ev.gTx - (rf.pl0 + 10 * rf.n * Math.log10(d)) - wallsBefore;
    };
    const push = (p, rss) => { const v = P(p[0], p[1], p[2]); pts.push(v.x, v.y, v.z); const c = turbo((rss + 100) / 70).multiplyScalar(1.6); cols.push(c.r, c.g, c.b); };
    push(a, lvl(0.02, 0));
    let acc = 0;
    const crossings = [...ev.walls.map((w) => ({ ...w, kind: 'wall' })), ...ev.slabs.map((s) => ({ ...s, kind: 'slab', mat: 'slab' }))].sort((p, q) => p.t - q.t);
    // two vertices per crossing (before/after the wall), slightly apart: zero-length segments make
    // the fat-line shader normalise a zero vector
    const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const eps = 0.06 / Math.max(ev.d, 1);
    for (const c of crossings) {
      push(at(Math.max(0.0, c.t - eps)), lvl(c.t, acc));
      acc += c.loss;
      push(at(Math.min(1.0, c.t + eps)), lvl(c.t, acc));
    }
    push(b, lvl(1, acc));
    this.geo.dispose();
    this.geo = new LineGeometry();
    this.geo.setPositions(pts);
    this.geo.setColors(cols);
    this.line.geometry = this.geo;
    this.glow.geometry = this.geo;
    this.line.computeLineDistances();

    // markers + tags
    while (this.markers.length < crossings.length) {
      const m = new THREE.Mesh(this.markerGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, toneMapped: false }));
      const tagEl = chip('wall-tag');
      const tag = new CSS2DObject(tagEl);
      m.add(tag);
      tag.position.set(0, -1.05, 0);
      this.group.add(m);
      this.markers.push(m);
      this.tags.push(tag);
    }
    const dir = P(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    this.markers.forEach((m, i) => {
      const c = crossings[i];
      m.visible = !!c;
      m.children[0].visible = !!c && this.showTags;
      if (!c) return;
      m.position.copy(P(...c.p));
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      const sev = c.loss >= 15 ? COLORS.et : c.loss >= 6 ? COLORS.deauth : COLORS.eav;
      m.material.color.set(sev).multiplyScalar(2.2);
      const el = this.tags[i].element;
      el.dataset.mat = c.mat;
      el.dataset.loss = c.loss.toFixed(0);
      el.style.setProperty('--sev', sev);
      el.innerHTML = `<b>−${c.loss.toFixed(0)} dB</b><span>${this.matName?.(c.mat) ?? c.mat}</span>`;
    });
  }

  /** dashed links attacker → affected clients */
  updateLinks(ev, clientViews, visible) {
    const want = visible && ev ? ev.clients.filter((c) => c.deauth || c.evilTwin) : [];
    while (this.links.length < want.length) {
      const g = new LineGeometry();
      g.setPositions([0, 0, 0, 1, 1, 1]);
      const l = new Line2(g, this.linkMat.clone());
      l.material.resolution.copy(this.linkMat.resolution);
      this.group.add(l);
      this.links.push(l);
    }
    this.links.forEach((l, i) => {
      const c = want[i];
      l.visible = !!c;
      if (!c) return;
      const cv = clientViews.get(c.id);
      const p0 = P(ev.pos[0], ev.pos[1], ev.pos[2] + 0.4);
      const p1 = cv ? cv.getWorldPosition(new THREE.Vector3()) : P(...c.client.pos);
      l.geometry.dispose();
      l.geometry = new LineGeometry();
      l.geometry.setPositions([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z]);
      l.computeLineDistances();
      l.material.color.set(c.evilTwin ? COLORS.et : COLORS.deauth).multiplyScalar(1.8);
    });
  }

  tick(t) {
    for (const l of this.links) if (l.visible) l.material.dashOffset = -t * 2.2;
    this.glowMat.opacity = 0.1 + 0.06 * Math.sin(t * 4);
  }
}

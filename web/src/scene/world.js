// Renderer, camera, controls, sky/lighting moods, post-processing and camera flights.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

/** plan (x east, y north, z up) → three.js (x, y-up, z south) */
export const P = (x, y, z = 0) => new THREE.Vector3(x, z, -y);

const MOODS = {
  dusk: {
    sunElev: 7.5, sunAz: 318, turbidity: 6.5, rayleigh: 2.6, mieC: 0.006, mieG: 0.86,
    sunColor: 0xffd6b0, sunI: 1.05, hemiSky: 0xa9bdf5, hemiGround: 0x2a2421, hemiI: 0.5,
    exposure: 0.9, fog: 0x2d3446, fogD: 0.0014, envI: 0.32, windowGlow: 1, lamp: 1, bg: null, bloom: 0.45, ovI: 0.72,
  },
  day: {
    sunElev: 48, sunAz: 330, turbidity: 3.2, rayleigh: 1.2, mieC: 0.004, mieG: 0.8,
    sunColor: 0xfff1e0, sunI: 1.5, hemiSky: 0xcfe3ff, hemiGround: 0x6b6150, hemiI: 0.42,
    exposure: 0.62, fog: 0xc9dcef, fogD: 0.0006, envI: 0.35, windowGlow: 0.05, lamp: 0, bg: null, bloom: 0.12, ovI: 1,
  },
  night: {
    sunElev: -4, sunAz: 228, turbidity: 2, rayleigh: 0.6, mieC: 0.003, mieG: 0.8,
    sunColor: 0xa9b8ff, sunI: 0.85, hemiSky: 0x8193c4, hemiGround: 0x1c2029, hemiI: 1.05,
    exposure: 1.3, fog: 0x0b0f1a, fogD: 0.0014, envI: 0.35, windowGlow: 1.4, lamp: 1.4, bg: 0x070a12, bloom: 0.5, ovI: 0.5,
  },
};

export class World {
  constructor(container) {
    this.container = container;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    r.setSize(container.clientWidth, container.clientHeight);
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 0.95;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.localClippingEnabled = true;
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight, 0.25, 3000);
    this.camera.position.copy(P(70, -95, 62));

    const c = (this.controls = new OrbitControls(this.camera, r.domElement));
    c.target.copy(P(2, -10, 2));
    c.enableDamping = true;
    c.dampingFactor = 0.075;
    c.maxPolarAngle = Math.PI * 0.485;
    c.minDistance = 4;
    c.maxDistance = 420;
    c.screenSpacePanning = true;
    c.zoomToCursor = true;
    c.update();

    // labels
    this.labels = new CSS2DRenderer();
    this.labels.setSize(container.clientWidth, container.clientHeight);
    Object.assign(this.labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    container.appendChild(this.labels.domElement);

    this._lights();
    this._post();
    this.setMood('dusk');

    this.timer = new THREE.Timer();
    this.onFrame = [];
    this.flight = null;
    window.addEventListener('resize', () => this.resize());
  }

  _lights() {
    const s = this.scene;
    this.sky = new Sky();
    this.sky.scale.setScalar(4000);
    s.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 10; sc.far = 520;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 3;
    s.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1);
    s.add(this.hemi);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);
    s.fog = new THREE.FogExp2(0x2d3446, 0.0016);
  }

  setMood(name) {
    const m = MOODS[name];
    this.mood = name;
    this.moodParams = m;
    for (const sky of [this.sky, this.envSky]) {
      const u = sky.material.uniforms;
      u.turbidity.value = m.turbidity; u.rayleigh.value = m.rayleigh;
      u.mieCoefficient.value = m.mieC; u.mieDirectionalG.value = m.mieG;
    }
    const phi = THREE.MathUtils.degToRad(90 - m.sunElev);
    const theta = THREE.MathUtils.degToRad(m.sunAz);
    const dir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms.sunPosition.value.copy(dir);
    this.envSky.material.uniforms.sunPosition.value.copy(dir);
    const sunDir = dir.clone();
    if (sunDir.y < 0.12) sunDir.y = 0.12; // keep a usable shadow direction at dusk / night
    this.sun.position.copy(sunDir.normalize().multiplyScalar(260));
    this.sun.target.position.set(0, 0, 0);
    this.sun.color.set(m.sunColor); this.sun.intensity = m.sunI;
    this.hemi.color.set(m.hemiSky); this.hemi.groundColor.set(m.hemiGround); this.hemi.intensity = m.hemiI;
    this.renderer.toneMappingExposure = m.exposure;
    this.scene.fog.color.set(m.fog); this.scene.fog.density = m.fogD;
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = m.envI;
    this.sky.visible = !m.bg;
    if (this.bloom) this.bloom.strength = m.bloom ?? 0.45;
    this.scene.background = m.bg ? new THREE.Color(m.bg) : null;
    this.onMood?.(m);
  }

  _post() {
    const r = this.renderer, w = this.container.clientWidth, h = this.container.clientHeight;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.setPixelRatio(r.getPixelRatio());
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.gtao = new GTAOPass(this.scene, this.camera, w, h);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.6, thickness: 1.5, scale: 1.0, samples: 12 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.gtao.enabled = false;
    this.composer.addPass(this.gtao);
    // Guard: one NaN/Inf pixel would be smeared over the whole frame by the bloom blur.
    this.sanitize = new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          // bit-level test (the D3D compiler may optimise isnan()/isinf() away): exponent all ones = Inf/NaN
          uvec3 e = floatBitsToUint(c.rgb) & uvec3(0x7f800000u);
          bool bad = any(equal(e, uvec3(0x7f800000u)));
          gl_FragColor = bad ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(clamp(c.rgb, 0.0, 64.0), c.a);
        }`,
    });
    this.composer.addPass(this.sanitize);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), this.moodParams?.bloom ?? 0.45, 0.5, 1.45);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    // gentle film grade: saturation, contrast, vignette (display space)
    this.grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uSat: { value: 1.08 }, uCon: { value: 1.05 }, uVig: { value: 0.5 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat, uCon, uVig; varying vec2 vUv;
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          vec3 col = c.rgb;
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(l), col, uSat);
          col = (col - 0.5) * uCon + 0.5;
          vec2 d = vUv - 0.5;
          col *= clamp(1.0 - uVig * dot(d, d) * 1.7, 0.0, 1.0);
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
        }`,
    });
    this.composer.addPass(this.grade);
  }

  setQuality(q) {
    this.quality = q;
    const r = this.renderer;
    const pr = q === 'ultra' ? Math.min(window.devicePixelRatio, 2) : q === 'high' ? Math.min(window.devicePixelRatio, 1.5) : 1;
    r.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    this.gtao.enabled = q !== 'low';
    this.bloom.enabled = q !== 'low';
    r.shadowMap.enabled = true;
    const ms = q === 'low' ? 1024 : q === 'high' ? 2048 : 4096;
    if (this.sun.shadow.mapSize.x !== ms) {
      this.sun.shadow.mapSize.set(ms, ms);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.resize();
  }

  /** Shift the rendered frame up by px (keeps the scene clear of a bottom card). */
  setFrameShift(px) {
    this.frameShift = px;
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    if (this.frameShift) this.camera.setViewOffset(w, h, 0, this.frameShift, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.gtao.setSize(w, h);
    this.labels.setSize(w, h);
  }

  /** Smooth camera flight to (position, target) in three.js coordinates. */
  flyTo(pos, target, duration = 1.8) {
    this.flight = {
      p0: this.camera.position.clone(), t0: this.controls.target.clone(),
      p1: pos.clone(), t1: target.clone(), t: 0, d: Math.max(0.01, duration),
    };
  }

  start() {
    const loop = (ts) => {
      requestAnimationFrame(loop);
      this.timer.update(ts);
      const dt = Math.min(this.timer.getDelta(), 0.05);
      const time = this.timer.getElapsed();
      if (this.flight) {
        const f = this.flight;
        f.t += dt / f.d;
        const k = f.t >= 1 ? 1 : f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
        // arc the camera slightly upwards mid-flight for a cinematic move
        const lift = Math.sin(Math.PI * Math.min(f.t, 1)) * Math.min(18, f.p0.distanceTo(f.p1) * 0.12);
        this.camera.position.lerpVectors(f.p0, f.p1, k).y += lift;
        this.controls.target.lerpVectors(f.t0, f.t1, k);
        if (f.t >= 1) this.flight = null;
      }
      this.controls.update();
      for (const fn of this.onFrame) fn(dt, time);
      this.composer.render(dt);
      this.labels.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }
}

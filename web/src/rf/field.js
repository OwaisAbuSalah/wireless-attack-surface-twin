// GPU field engine: renders the propagation model into float render targets
// (one fragment per map cell), keeps prev/current/baseline maps for smooth morphing,
// and reads results back asynchronously for the statistics (MODEL.md §7).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { COMPUTE_VERT, COMPUTE_FRAG, MAX_WALLS } from './glsl.js';
import { B, FOOT, FLOORS, SLAB_PLANES, CLIENTS, STREET_BAND, CORE_RECT, wallTexels, gridOutdoor, gridFloor } from '../data.js';
import { clientRss, equipment } from './model.js';

const DEG = Math.PI / 180;

export class FieldEngine {
  constructor(renderer) {
    this.r = renderer;
    const { data, count } = wallTexels();
    if (count > MAX_WALLS) console.warn(`walls (${count}) > MAX_WALLS`);
    this.wallTex = new THREE.DataTexture(data, count * 4, 1, THREE.RGBAFormat, THREE.FloatType);
    this.wallTex.minFilter = this.wallTex.magFilter = THREE.NearestFilter;
    this.wallTex.needsUpdate = true;
    this.linear = renderer.extensions.has('OES_texture_float_linear');

    const P = B.protections.directional;
    this.u = {
      uWalls: { value: this.wallTex }, uWallCount: { value: count },
      uMatLoss: { value: new Float32Array(16) },
      uSlabZ: { value: new Float32Array([...SLAB_PLANES, 0, 0, 0, 0].slice(0, 4)) }, uSlabCount: { value: SLAB_PLANES.length },
      uSlabLoss: { value: 0 }, uFoot: { value: new THREE.Vector4(...FOOT) },
      uPL0: { value: 40 }, uN: { value: B.rf.pathloss_exponent }, uDmin: { value: B.rf.min_distance_m },
      uAntType: { value: 0 }, uBore: { value: new THREE.Vector3(1, 0, 0) }, uAntY: { value: new THREE.Vector3(0, 1, 0) }, uAntZ: { value: new THREE.Vector3(0, 0, 1) },
      uGmax: { value: P.gmax_dbi }, uHpbw: { value: P.hpbw_deg * DEG }, uSla: { value: P.sla_db },
      uMode: { value: 0 }, uOrigin: { value: new THREE.Vector2() }, uCell: { value: 1 }, uZ: { value: 1.5 },
      uFloorZ: { value: new Float32Array(3) }, uFloorRows: { value: 1 },
      uTxs: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) }, uTxCount: { value: 1 }, uPtx: { value: 20 },
      uClients: { value: CLIENTS.map((c) => new THREE.Vector3(...c.pos)) }, uClientRss: { value: new Float32Array(8) }, uClientCount: { value: CLIENTS.length },
      uAttEirp: { value: 32 }, uEtMargin: { value: B.attack.evil_twin.margin_db }, uEtMin: { value: B.attack.evil_twin.min_rss_dbm },
      uClientSens: { value: B.attack.client.sens_dbm }, uAttacker: { value: new THREE.Vector3() },
    };
    this.mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: this.u, vertexShader: COMPUTE_VERT, fragmentShader: COMPUTE_FRAG, depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.mat);
    this.mix = 1;
    this.setResolution(B.rf.grids.outdoor.cell_realtime, B.rf.grids.floor.cell_realtime);
  }

  setResolution(cellOut, cellFloor = this.gf?.cell ?? 0.2) {
    for (const g of [this.out, this.flo]) if (g) Object.values(g).forEach((rt) => rt.dispose());
    this.go = gridOutdoor(cellOut);
    this.gf = gridFloor(cellFloor);
    const filter = this.linear ? THREE.LinearFilter : THREE.NearestFilter;
    const mk = (w, h) => new THREE.WebGLRenderTarget(w, h, {
      type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: filter, magFilter: filter,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    });
    const { nx, ny } = this.go, f = this.gf;
    this.out = { a: mk(nx, ny), b: mk(nx, ny), base: mk(nx, ny) };
    this.flo = { a: mk(f.nx, f.ny * 3), b: mk(f.nx, f.ny * 3), base: mk(f.nx, f.ny * 3) };
    this.cur = 'b'; this.prev = 'a';
    this.bufOut = new Float32Array(nx * ny * 4);
    this.bufFlo = new Float32Array(f.nx * f.ny * 3 * 4);
    this.bufOutBase = new Float32Array(nx * ny * 4);
    this.bufFloBase = new Float32Array(f.nx * f.ny * 3 * 4);
    this.version = (this.version ?? 0) + 1;
  }

  get textures() {
    return {
      outPrev: this.out[this.prev].texture, outCur: this.out[this.cur].texture, outBase: this.out.base.texture,
      floPrev: this.flo[this.prev].texture, floCur: this.flo[this.cur].texture, floBase: this.flo.base.texture,
    };
  }

  setParams(rf, s, attackerXY) {
    const u = this.u;
    u.uMatLoss.value.set(rf.loss);
    u.uSlabLoss.value = rf.slabLoss;
    u.uPL0.value = rf.pl0;
    rf.txs.forEach((t, k) => u.uTxs.value[k].set(...t));
    u.uTxCount.value = rf.txs.length;
    u.uPtx.value = rf.ptx;
    if (rf.ant.type === 'patch') {
      u.uAntType.value = 1;
      u.uBore.value.set(...rf.ant.frame.b); u.uAntY.value.set(...rf.ant.frame.y); u.uAntZ.value.set(...rf.ant.frame.z);
      u.uGmax.value = rf.ant.gmax_dbi; u.uHpbw.value = rf.ant.hpbw_deg * DEG; u.uSla.value = rf.ant.sla_db;
    } else u.uAntType.value = 0;
    u.uClientRss.value.set(clientRss(rf));
    const eq = equipment(s.equipment);
    u.uAttEirp.value = eq.tx_dbm + eq.gain_dbi;
    if (attackerXY) u.uAttacker.value.set(attackerXY[0], attackerXY[1], B.rf.rx_height_outdoor);
  }

  _render(rt, mode) {
    const u = this.u;
    u.uMode.value = mode;
    if (mode === 0) {
      u.uOrigin.value.set(this.go.x0, this.go.y0); u.uCell.value = this.go.cell; u.uZ.value = this.go.z;
    } else {
      u.uOrigin.value.set(this.gf.x0, this.gf.y0); u.uCell.value = this.gf.cell;
      u.uFloorZ.value.set(this.gf.zs); u.uFloorRows.value = this.gf.ny;
    }
    const r = this.r;
    const prevRT = r.getRenderTarget();
    // tile into horizontal strips so a single draw never runs long (avoids GPU watchdog on weak GPUs)
    const strips = mode === 0 ? 4 : 1;
    const h = rt.height, step = Math.ceil(h / strips);
    rt.scissorTest = strips > 1;
    for (let y = 0; y < h; y += step) {
      rt.scissor.set(0, y, rt.width, Math.min(step, h - y));
      r.setRenderTarget(rt);
      this.quad.render(r);
    }
    rt.scissorTest = false;
    r.setRenderTarget(prevRT);
  }

  /**
   * Compute maps for the given parameters.
   * opts: { outdoor, floors, animate, base }
   */
  compute(rf, s, attackerXY, { outdoor = true, floors = true, animate = false, base = false } = {}) {
    this.setParams(rf, s, attackerXY);
    if (base) {
      if (outdoor) this._render(this.out.base, 0);
      if (floors) this._render(this.flo.base, 1);
      return;
    }
    if (animate) {
      // new result goes into the older buffer, then swap
      [this.cur, this.prev] = [this.prev, this.cur];
      if (!outdoor) this._copy(this.out[this.prev], this.out[this.cur]);
      if (!floors) this._copy(this.flo[this.prev], this.flo[this.cur]);
      this.mix = 0;
    }
    if (outdoor) this._render(this.out[this.cur], 0);
    if (floors) this._render(this.flo[this.cur], 1);
  }

  _copy(src, dst) {
    if (!this._copyQuad) {
      this._copyMat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: { t: { value: null } },
        vertexShader: COMPUTE_VERT,
        fragmentShader: 'precision highp float; precision highp sampler2D; uniform sampler2D t; layout(location = 0) out highp vec4 outC; void main(){ outC = texelFetch(t, ivec2(gl_FragCoord.xy), 0); }',
        depthTest: false, depthWrite: false,
      });
      this._copyQuad = new FullScreenQuad(this._copyMat);
    }
    this._copyMat.uniforms.t.value = src.texture;
    const prevRT = this.r.getRenderTarget();
    this.r.setRenderTarget(dst); this._copyQuad.render(this.r); this.r.setRenderTarget(prevRT);
  }

  /** Synchronous timing probe (used once to pick a quality level). */
  benchmark(rf, s, xy) {
    const px0 = new Float32Array(4);
    this.compute(rf, s, xy, { outdoor: true, floors: true });          // warm-up (shader compile)
    this.r.readRenderTargetPixels(this.out[this.cur], 0, 0, 1, 1, px0);
    const t0 = performance.now();
    this.compute(rf, s, xy, { outdoor: true, floors: true });
    const px = new Float32Array(4);
    this.r.readRenderTargetPixels(this.out[this.cur], 0, 0, 1, 1, px);
    return performance.now() - t0;
  }

  async readCurrent() {
    const { nx, ny } = this.go, f = this.gf;
    await this.r.readRenderTargetPixelsAsync(this.out[this.cur], 0, 0, nx, ny, this.bufOut);
    await this.r.readRenderTargetPixelsAsync(this.flo[this.cur], 0, 0, f.nx, f.ny * 3, this.bufFlo);
    return { out: this.bufOut, flo: this.bufFlo };
  }
  async readFloorsOnly() {
    const f = this.gf;
    await this.r.readRenderTargetPixelsAsync(this.flo[this.cur], 0, 0, f.nx, f.ny * 3, this.bufFlo);
    return this.bufFlo;
  }
  async readBase() {
    const { nx, ny } = this.go, f = this.gf;
    await this.r.readRenderTargetPixelsAsync(this.out.base, 0, 0, nx, ny, this.bufOutBase);
    await this.r.readRenderTargetPixelsAsync(this.flo.base, 0, 0, f.nx, f.ny * 3, this.bufFloBase);
    return { out: this.bufOutBase, flo: this.bufFloBase };
  }

  /** Statistics of MODEL.md §7 from read-back buffers. */
  stats(out, flo, s, routerZ) {
    const go = this.go, gf = this.gf, eq = equipment(s.equipment);
    const thrE = eq.sens_dbm - eq.gain_dbi;
    const [fx0, fy0, fx1, fy1] = FOOT;
    let nE = 0, nD = 0, nT = 0, nU = 0, maxLeak = 0, edge = false, stN = 0, stE = 0;
    for (let j = 0; j < go.ny; j++) {
      const y = go.y0 + (j + 0.5) * go.cell;
      for (let i = 0; i < go.nx; i++) {
        const x = go.x0 + (i + 0.5) * go.cell;
        if (x >= fx0 && x <= fx1 && y >= fy0 && y <= fy1) continue;
        const k = (j * go.nx + i) * 4;
        const e = out[k] >= thrE, d = e && !s.pmf && out[k + 1] >= 0, t = e && !s.wpa3 && out[k + 2] >= 0;
        if (e) {
          nE++;
          const dx = Math.max(fx0 - x, 0, x - fx1), dy = Math.max(fy0 - y, 0, y - fy1);
          const dist = Math.hypot(dx, dy);
          if (dist > maxLeak) maxLeak = dist;
          if (i === 0 || j === 0 || i === go.nx - 1 || j === go.ny - 1) edge = true;
        }
        if (d) nD++;
        if (t) nT++;
        if (e || d || t) nU++;
        if (y >= STREET_BAND[1] && y <= STREET_BAND[3] && x >= STREET_BAND[0] && x <= STREET_BAND[2]) { stN++; if (e) stE++; }
      }
    }
    const A = go.cell * go.cell;
    // service coverage on the router's floor
    let fk = FLOORS.findIndex((f) => routerZ >= f.z && routerZ < f.z + f.height);
    if (fk < 0) fk = 1;
    const vals = [];
    let cov = 0, tot = 0, hij = 0;
    const [cx0, cy0, cx1, cy1] = CORE_RECT;   // stair/elevator core is not a service area
    for (let j = 0; j < gf.ny; j++) {
      const y = gf.y0 + (j + 0.5) * gf.cell;
      if (y < fy0 || y > fy1) continue;
      for (let i = 0; i < gf.nx; i++) {
        const x = gf.x0 + (i + 0.5) * gf.cell;
        if (x < fx0 || x > fx1) continue;
        if (x > cx0 && x < cx1 && y > cy0 && y < cy1) continue;
        const k = ((fk * gf.ny + j) * gf.nx + i) * 4;
        const r = flo[k];
        tot++; vals.push(r);
        if (r >= B.attack.coverage_dbm) cov++;
        const att = flo[k + 1];
        if (!s.wpa3 && att >= r + B.attack.evil_twin.margin_db && att >= B.attack.evil_twin.min_rss_dbm) hij++;
      }
    }
    vals.sort((p, q) => p - q);
    const p5 = vals.length ? vals[Math.floor(vals.length * 0.05)] : -100;
    return {
      areaE: nE * A, areaD: nD * A, areaT: nT * A, areaU: nU * A,
      maxLeak, edge,
      street: stN ? (100 * stE) / stN : 0,
      coverage: tot ? (100 * cov) / tot : 0,
      hijack: tot ? (100 * hij) / tot : 0,
      p5, floor: fk,
    };
  }
}

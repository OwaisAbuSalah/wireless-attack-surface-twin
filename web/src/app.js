// Application controller: state, recomputation scheduling, interaction and glue between
// the RF engine, the 3-D scene and the UI.
import * as THREE from 'three';
import { World, P } from './scene/world.js';
import { BuildingView } from './scene/building.js';
import { SiteView } from './scene/site.js';
import { RouterView, AttackerView, ClientsView } from './scene/actors.js';
import { makeOverlayUniforms, injectOverlay, RayView, COLORS } from './scene/overlays.js';
import { FieldEngine } from './rf/field.js';
import { rfParams, evaluateAttacker, equipment } from './rf/model.js';
import { loadSionna, matchScenario, sionnaStats } from './rf/sionna.js';
import { B, FOOT } from './data.js';
import { UI } from './ui/ui.js';
import { Tour } from './ui/tour.js';
import { t } from './ui/i18n.js';

const PROT = B.protections;
const MOUNTS = B.router.mounts;

export const defaultState = () => ({
  lang: 'en', mode: 'attack', focus: 'all', explode: false, cut: 1.7,
  freq: B.router.freq_ghz, txDbm: B.router.tx_dbm, antenna: 'dipole', mount: 'wall',
  aps: [[...MOUNTS.wall.pos]], az: MOUNTS.wall.az_deg, tilt: MOUNTS.wall.tilt_deg,
  shieldWindows: false, shieldPaint: false, pmf: false, wpa3: false,
  equipment: B.attack.default_equipment,
  layers: { zones: true, indoor: true, contours: true, ghost: true, rays: true, waves: true, labels: true },
  mood: 'dusk', quality: 'high', follow: false,
});

const RF_KEYS = ['freq', 'txDbm', 'antenna', 'mount', 'aps', 'az', 'tilt', 'shieldWindows', 'shieldPaint', 'equipment'];

export class App {
  constructor() {
    const q = new URLSearchParams(location.search);
    this.state = defaultState();
    const saved = localStorage.getItem('twin.lang');
    this.state.lang = q.get('lang') ?? saved ?? 'en';
    if (q.get('quality')) this.state.quality = q.get('quality');
    if (q.get('ui') === '0') document.body.classList.add('clean');

    this.world = new World(document.getElementById('viewport'));
    const scene = this.world.scene;
    this.U = makeOverlayUniforms();
    this.building = new BuildingView(scene);
    this.building.floors.forEach((fl, k) => injectOverlay(fl.mats.floor, this.U, k));
    this.site = new SiteView(scene, this.U, injectOverlay);
    const fg = this.building.floors.map((f) => f.group);
    this.routers = [0, 1, 2, 3].map((i) => { const r = new RouterView(fg); r.index = i; r.hit.userData.index = i; return r; });
    this.router = this.routers[0];
    this.attacker = new AttackerView(scene);
    this.clients = new ClientsView(fg);
    this.rays = new RayView(scene, this.world);
    this.rays.matName = (k) => B.materials[k]?.name[this.state.lang] ?? k;
    this.field = new FieldEngine(this.world.renderer);
    this.sionna = loadSionna(this.world.renderer);
    this.ui = new UI(this);
    this.tour = new Tour(this);

    this.world.onMood = (m) => { this.site?.setMood(m); this.building?.setWindowGlow(m.windowGlow); };
    this.world.setMood(this.state.mood);
    this._resizeLines();
    window.addEventListener('resize', () => this._resizeLines());
    this._input();
    this.keys = new Set();
    this.dirty = { rf: { animate: false }, att: true, display: true };
    this.statsBusy = false;
    this.world.onFrame.push((dt, time) => this.frame(dt, time));
  }

  async init() {
    const msg = document.getElementById('loader-msg');
    msg.textContent = t('loadingRF', this.state.lang);
    await new Promise((r) => setTimeout(r, 30));
    this.rf = rfParams(this.state);
    // pick a quality level from a timing probe of the RF kernel
    const ms = this.field.benchmark(this.rf, this.state, this.attacker.pos);
    this.benchMs = ms;
    if (!new URLSearchParams(location.search).get('quality')) this.state.quality = ms < 45 ? 'ultra' : ms > 220 ? 'low' : 'high';
    this.setQuality(this.state.quality, true);
    this.building.setLang(this.state.lang);
    this.site.setLang(this.state.lang);
    this.clients.setLang(this.state.lang);
    this.attacker.setEquipment(this.state.equipment);
    this.computeBaseline();
    this.applyDisplay();
    this.applyView();
    this.world.start();
    this.cameraPreset('overview', 0.01);
    setTimeout(() => document.getElementById('loader').classList.add('done'), 350);
    window.__twin = this;
    window.__ready = true;
    if (new URLSearchParams(location.search).get('tour')) setTimeout(() => this.tour.start(), 900);
  }

  // ───────────── state helpers ─────────────
  protections() {
    const s = this.state;
    return {
      lowPower: s.txDbm <= PROT.lowPower.tx_dbm, directional: s.antenna === 'patch', relocate: s.mount === 'ceiling', microcells: s.mount === 'micro',
      shieldWindows: s.shieldWindows, shieldPaint: s.shieldPaint, band5: s.freq >= 4, pmf: s.pmf, wpa3: s.wpa3,
    };
  }
  anyProtection() { return Object.values(this.protections()).some(Boolean); }

  set(patch, { animate = true, live = false } = {}) {
    const rfChanged = RF_KEYS.some((k) => k in patch && JSON.stringify(patch[k]) !== JSON.stringify(this.state[k]));
    const eqChanged = 'equipment' in patch && patch.equipment !== this.state.equipment;
    Object.assign(this.state, patch);
    if (eqChanged) { this.attacker.setEquipment(this.state.equipment); this.computeBaseline(); }
    if (rfChanged) this.dirty.rf = { animate: animate && !live, live };
    else if ('pmf' in patch || 'wpa3' in patch) this.scheduleStats();
    this.dirty.att = true;
    this.dirty.display = true;
    this.ui.sync();
  }

  setAntenna(a) {
    const m = MOUNTS[this.state.mount] ?? MOUNTS.wall;
    this.set({ antenna: a, az: m.az_deg, tilt: m.tilt_deg });
  }
  setMount(m) {
    const M = MOUNTS[m];
    if (!M) return;
    this.set({ mount: m, aps: (M.positions ?? [M.pos]).map((p) => [...p]), az: M.az_deg, tilt: M.tilt_deg });
  }

  toggleProtection(k, silent = false) {
    const on = this.protections()[k];
    const L = this.state.lang;
    switch (k) {
      case 'lowPower': this.set({ txDbm: on ? B.router.tx_dbm : PROT.lowPower.tx_dbm }); break;
      case 'directional': this.setAntenna(on ? 'dipole' : 'patch'); break;
      case 'relocate': this.setMount(on ? 'wall' : 'ceiling'); break;
      case 'microcells': this.setMount(on ? 'wall' : 'micro'); break;
      case 'band5': this.set({ freq: on ? B.router.freq_ghz : PROT.band5.freq_ghz }); break;
      default: this.set({ [k]: !on });
    }
    if (!silent) this.ui.toast(`${t('p.' + k, L)} — ${on ? (L === 'ar' ? 'أُلغي' : 'off') : t('p.' + k + '.d', L)}`, on ? 'bad' : 'good');
  }

  async applyAll() {
    // the directional antenna is left to the user: it trades indoor coverage for less leakage
    if (this.state.antenna === 'patch') this.setAntenna('dipole');
    const seq = ['shieldWindows', 'shieldPaint', 'microcells', 'band5'];
    for (const k of seq) {
      if (!this.protections()[k]) { this.toggleProtection(k); await new Promise((r) => setTimeout(r, 750)); }
    }
    await this.optimizePower();
    await new Promise((r) => setTimeout(r, 500));
    for (const k of ['pmf', 'wpa3']) if (!this.protections()[k]) { this.toggleProtection(k); await new Promise((r) => setTimeout(r, 450)); }
  }

  resetAll(silent = false) {
    const d = defaultState();
    this.set({
      freq: d.freq, txDbm: d.txDbm, antenna: d.antenna, mount: d.mount, aps: d.aps, az: d.az, tilt: d.tilt,
      shieldWindows: false, shieldPaint: false, pmf: false, wpa3: false,
    });
    if (!silent) this.ui.toast(this.state.lang === 'ar' ? 'عاد المبنى إلى وضعه الأصلي' : 'Back to the unprotected baseline', 'bad');
  }

  /** Minimum TX power that keeps ≥ 95 % of the AP floor at ≥ −67 dBm (RSS is linear in P_tx). */
  async optimizePower() {
    await this.flushStats();
    const s = this.stats;
    if (!s) return;
    const need = this.state.txDbm + (B.attack.coverage_dbm - s.p5) + 0.5;
    const p = Math.max(0, Math.min(23, Math.ceil(need)));
    this.set({ txDbm: p });
    const L = this.state.lang;
    this.ui.toast(L === 'ar' ? `ضُبطت القدرة على <b>${p} dBm</b> مع الحفاظ على تغطية 95%` : `TX power tuned to <b>${p} dBm</b> — 95 % indoor coverage kept`);
    await this.flushStats();
  }

  setMode(m) {
    if ((m === 'sionna' || m === 'diff') && !this.sionna.available) return;
    this.state.mode = m;
    this.dirty.display = true;
    this.dirty.att = true;
    this.ui.sync();
    this.scheduleStats();
  }
  setView(v) {
    Object.assign(this.state, v);
    this.applyView();
    this.ui.sync();
  }
  setLayer(k, on) {
    this.state.layers[k] = on;
    this.dirty.display = true;
    this.dirty.att = true;
    this.applyView();
    this.ui.sync();
  }
  setLang(l) {
    this.state.lang = l;
    localStorage.setItem('twin.lang', l);
    this.ui.build();
    this.building.setLang(l);
    this.site.setLang(l);
    this.clients.setLang(l);
    this.dirty.att = true;
    if (this.tour.i >= 0) this.tour.render();
  }
  cycleMood() {
    const order = ['dusk', 'night', 'day'];
    this.state.mood = order[(order.indexOf(this.state.mood) + 1) % order.length];
    this.world.setMood(this.state.mood);
    this.ui.sync();
  }
  setQuality(q, init = false) {
    this.state.quality = q;
    this.world.setQuality(q);
    const cell = q === 'low' ? 0.8 : B.rf.grids.outdoor.cell_realtime;
    if (this.field.go.cell !== cell) {
      this.field.setResolution(cell);
      this.dirty.rf = { animate: false };
      if (!init) this.computeBaseline();
    }
    this.ui.sync();
  }

  walkTo(xy) {
    this.attacker.target = [xy[0], xy[1], Math.hypot(xy[0] - this.attacker.pos[0], xy[1] - this.attacker.pos[1]) > 25 ? 9 : 4.2];
  }

  // ───────────── views & camera ─────────────
  applyView() {
    const s = this.state;
    this.building.setView({ focus: s.focus, explode: s.explode, cut: s.cut });
    this.building.setLabels(s.layers.labels);
    this.clients.setLabels(s.layers.labels && s.focus !== 'all' && !s.explode);
    this.site.setLabels(s.layers.labels);
    for (const r of this.routers) r.wavesOn = s.layers.waves;
    this.dirty.display = true;
  }

  cameraPreset(name, dur = 1.8) {
    const s = this.state;
    const a = this.attacker.pos;
    if (name !== 'follow') this.state.follow = false;
    switch (name) {
      case 'overview':
        if (s.focus !== 'all' || s.explode) this.setView({ focus: 'all', explode: false });
        this.world.flyTo(P(30, -62, 70), P(-1, -12, 0), dur); break;
      case 'top':
        this.world.flyTo(P(0.5, -16.5, 172), P(0.5, -16, 0), dur); break;
      case 'street':
        this.world.flyTo(P(a[0] + 2.6, a[1] - 5.2, 3.4), P(-2, -7, 5.2), dur); break;
      case 'floor':
        this.setView({ focus: 1, explode: false });
        this.world.flyTo(P(5, -20, 31), P(-0.5, -0.5, 3.6), dur); break;
      case 'follow': {
        this.state.follow = !this.state.follow;
        const r = this.rf.pos;
        const d = Math.hypot(r[0] - a[0], r[1] - a[1]) || 1;
        const ux = (r[0] - a[0]) / d, uy = (r[1] - a[1]) / d;
        this.world.flyTo(P(a[0] - ux * 9, a[1] - uy * 9, 5.5), P(a[0] + ux * 4, a[1] + uy * 4, 2), dur); break;
      }
      default: break;
    }
  }

  // ───────────── RF / stats ─────────────
  computeBaseline() {
    const d = defaultState();
    const base = { ...d, equipment: this.state.equipment };
    this.field.compute(rfParams(base), base, this.attacker.pos, { base: true });
    this.U.tOutBase.value = this.field.textures.outBase;
    const go = this.field.version;
    this.field.readBase().then(({ out, flo }) => {
      if (go !== this.field.version) return;
      this.baseStats = this.field.stats(out, flo, base, MOUNTS.wall.pos[2]);
      this.ui.updateKPIs(this.stats, this.baseStats);
    });
  }

  scheduleStats() {
    if (this.statsBusy) { this.statsAgain = true; return; }
    this.statsBusy = true;
    const done = () => { this.statsBusy = false; if (this.statsAgain) { this.statsAgain = false; this.scheduleStats(); } else this._statsWaiters?.splice(0).forEach((f) => f()); };
    const s = { ...this.state };
    const routerZ = this.rf.pos[2];
    if ((s.mode === 'sionna' || s.mode === 'diff') && this.sionna.available) {
      const key = matchScenario(s);
      if (key && s.mode === 'sionna') {
        this.stats = sionnaStats(this.sionna, this.sionna.scenarios[key], s, routerZ);
        this.ui.updateKPIs(this.stats, this.baseSionna());
        return done();
      }
    }
    const ver = this.field.version;
    this.field.readCurrent().then(({ out, flo }) => {
      if (ver === this.field.version) {
        this.stats = this.field.stats(out, flo, s, routerZ);
        this.hijack = this.ev?.eav.ok ? this.stats.hijack : 0;
        this.ui.updateKPIs(this.stats, this.baseStats);
        this.ui.updateAttacker(this.ev, this.hijack);
      }
      done();
    }).catch(done);
  }
  baseSionna() {
    const sc = this.sionna.scenarios.baseline;
    return sc ? sionnaStats(this.sionna, sc, { ...this.state, ...defaultState(), equipment: this.state.equipment }, MOUNTS.wall.pos[2]) : this.baseStats;
  }
  flushStats() {
    return new Promise((res) => {
      (this._statsWaiters ??= []).push(res);
      if (!this.statsBusy && !this.dirty.rf) this.scheduleStats();
    });
  }

  bindTextures() {
    const T = this.field.textures;
    Object.assign(this.U, {});
    this.U.tOutPrev.value = T.outPrev; this.U.tOutCur.value = T.outCur; this.U.tOutBase.value = T.outBase;
    this.U.tFloPrev.value = T.floPrev; this.U.tFloCur.value = T.floCur;
    const gO = this.field.go, gF = this.field.gf;
    this.U.uGridO.value.set(gO.x0, gO.y0, gO.x1 - gO.x0, gO.y1 - gO.y0);
    this.U.uGridF.value.set(gF.x0, gF.y0, gF.x1 - gF.x0, gF.y1 - gF.y0);
  }

  applyDisplay() {
    const s = this.state, U = this.U;
    const eq = equipment(s.equipment);
    U.uOvMode.value = { attack: 1, signal: 2, sionna: 3, diff: 4 }[s.mode];
    U.uZones.value = s.layers.zones ? 1 : 0;
    U.uFloorHeat.value = s.layers.indoor ? 1 : 0;
    U.uContours.value = s.layers.contours ? 1 : 0;
    U.uWaves.value = s.layers.waves ? 1 : 0;
    U.uGhost.value = s.layers.ghost && this.anyProtection() && s.mode === 'attack' ? 1 : 0;
    U.uGatt.value = eq.gain_dbi; U.uSatt.value = eq.sens_dbm;
    U.uPmf.value = s.pmf ? 1 : 0; U.uWpa3.value = s.wpa3 ? 1 : 0;
    U.uAttOk.value = this.ev?.eav.ok ? 1 : 0;
    if (this.rf) U.uRouterPlan.value.set(this.rf.pos[0], this.rf.pos[1]);
    // Sionna textures
    if ((s.mode === 'sionna' || s.mode === 'diff') && this.sionna.available) {
      const key = matchScenario(s);
      this.sionnaKey = key;
      this.sionnaScenarioLabel = key ? B.scenarios[key].label[s.lang] : null;
      if (key) {
        U.tSionO.value = this.sionna.scenarios[key].outTex;
        U.tSionF.value = this.sionna.scenarios[key].floTex;
      } else {
        if (this._lastNa !== JSON.stringify([s.freq, s.txDbm, s.antenna, s.mount, s.shieldWindows, s.shieldPaint])) {
          this._lastNa = JSON.stringify([s.freq, s.txDbm, s.antenna, s.mount, s.shieldWindows, s.shieldPaint]);
          this.ui.toast(t('sionna.na', s.lang), 'bad', 4200);
        }
        U.uOvMode.value = 2;   // fall back to the real-time model
      }
      this.ui.buildLegend();
    }
    this.building.setShielding({ windows: s.shieldWindows, paint: s.shieldPaint });
  }

  _labels() {
    const s = this.state, ev = this.ev, rf = this.rf;
    const L = s.lang;
    this.routers.forEach((r, i) => r.setLabel(`<b>AP${rf.txs.length > 1 ? i + 1 : ''}</b> ${B.router.ssid} · <span class="num">${rf.ptx} dBm · ${rf.freq} GHz</span>`));
    if (!ev) return;
    const sion = s.mode === 'sionna';
    const lvl = !sion && ev.evilTwin.ok ? 'et' : !sion && ev.deauth.ok ? 'deauth' : ev.eav.ok ? 'eav' : 'safe';
    const c = { et: COLORS.et, deauth: COLORS.deauth, eav: COLORS.eav, safe: COLORS.safe }[lvl];
    this.attacker.setStatus(lvl);
    const chip = (ok, txt) => `<span class="${ok ? 'ok' : ''}">${txt}</span>`;
    this.attacker.setLabel(`<div class="t" style="--c:${c}">${lvl === 'safe' ? t('att.safe', L) : t('att.danger', L)}<span class="num">${ev.rss.toFixed(0)} dBm</span></div>
      <div class="cs" style="--c:${c}">${chip(ev.eav.ok, 'EAVESDROP')}${sion ? '' : chip(ev.deauth.ok, 'DEAUTH') + chip(ev.evilTwin.ok, 'EVIL TWIN')}</div>`);
  }

  _resizeLines() {
    const w = this.world.container.clientWidth, h = this.world.container.clientHeight;
    this.rays.setResolution(w, h);
  }

  // ───────────── per-frame ─────────────
  frame(dt, time) {
    // keyboard walking
    if (this.keys.size && !document.activeElement?.matches?.('input, select, textarea')) {
      const cam = this.world.camera;
      const fwd = new THREE.Vector3();
      cam.getWorldDirection(fwd);
      fwd.y = 0; fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
      const v = new THREE.Vector3();
      if (this.keys.has('w') || this.keys.has('arrowup')) v.add(fwd);
      if (this.keys.has('s') || this.keys.has('arrowdown')) v.sub(fwd);
      if (this.keys.has('d') || this.keys.has('arrowright')) v.add(right);
      if (this.keys.has('a') || this.keys.has('arrowleft')) v.sub(right);
      if (v.lengthSq() > 0) {
        v.normalize().multiplyScalar((this.keys.has('shift') ? 9 : 4.2) * dt);
        this.attacker.target = null;
        this._moveAttacker(this.attacker.pos[0] + v.x, this.attacker.pos[1] - v.z);
        this.attacker.speed = v.length() / dt;
      }
    }
    const before = [...this.attacker.pos];
    const moved = this.attacker.update(dt, time);
    if (moved) this._clampAttacker();
    if (moved || before[0] !== this.attacker.pos[0] || before[1] !== this.attacker.pos[1]) this.dirty.att = true;

    // RF recompute (coalesced, at most once per frame)
    if (this.dirty.rf) {
      const { animate, live } = this.dirty.rf;
      this.dirty.rf = null;
      this.rf = rfParams(this.state);
      this.field.compute(this.rf, this.state, this.attacker.pos, { animate });
      this.bindTextures();
      this.routers.forEach((r, i) => {
        const p = this.rf.txs[i];
        r.group.visible = !!p;
        if (p) r.place(p, this.rf.ant);
      });
      this.dirty.att = true;
      this.dirty.display = true;
      if (live) { clearTimeout(this._liveT); this._liveT = setTimeout(() => this.scheduleStats(), 220); }
      else this.scheduleStats();
    }
    if (this.dirty.att) {
      this.dirty.att = false;
      // attacker-dependent floor field (rogue-AP capture map) — cheap
      this.field.compute(this.rf, this.state, this.attacker.pos, { outdoor: false, floors: true });
      this.ev = evaluateAttacker(this.attacker.pos, this.rf, this.state);
      this.attacker.faceTowards(this.ev.txPos ?? this.rf.pos);
      const showRays = this.state.layers.rays && !this.state.explode;
      this.rays.update(this.ev, this.rf, showRays);
      this.rays.updateLinks(this.ev, this.clients.markerAnchor, showRays && this.state.mode !== 'sionna');
      this.clients.setStates(this.ev.clients);
      this.U.uAttOk.value = this.ev.eav.ok ? 1 : 0;
      this._labels();
      const now = performance.now();
      if (now - (this._uiT ?? 0) > 120) { this._uiT = now; this.ui.updateAttacker(this.ev, this.hijack); }
      else { clearTimeout(this._uiTimer); this._uiTimer = setTimeout(() => this.ui.updateAttacker(this.ev, this.hijack), 130); }
      clearTimeout(this._hijT);
      this._hijT = setTimeout(() => this._readHijack(), 180);
    }
    if (this.dirty.display) { this.dirty.display = false; this.applyDisplay(); }

    // morph animation between previous and new maps
    if (this.field.mix < 1) {
      this.field.mix = Math.min(1, this.field.mix + dt / 1.25);
      const k = this.field.mix;
      this.U.uMix.value = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
    } else this.U.uMix.value = 1;
    this.U.uTime.value = time;

    // follow cam
    if (this.state.follow && !this.world.flight) {
      const a = this.attacker.pos;
      const cur = P(a[0], a[1], 1.6);
      if (this._followLast) {
        const d = cur.clone().sub(this._followLast);
        this.world.camera.position.add(d);
        this.world.controls.target.add(d);
      }
      this._followLast = cur;
    } else this._followLast = null;

    // fade the attacker's sky beam and the AP waves when the camera is close to them
    const camP = this.world.camera.position;
    const ag = this.attacker.group.position;
    this.attacker.beamFade = Math.min(1, Math.max(0, (camP.distanceTo(ag) - 12) / 25));
    for (const r of this.routers) {
      if (!r.group.visible) continue;
      const rp = r.group.getWorldPosition(this._tmpV ??= new THREE.Vector3());
      r.waveFade = Math.min(1, Math.max(0.15, (camP.distanceTo(rp) - 8) / 40));
      r.update(dt, time, this.rf ? Math.max(0.35, (this.rf.ptx + 10) / 30) : 1);
    }
    this.clients.update(dt, time);
    this.site.update(dt, time);
    this.building.update(dt);
    this.building.setRackGlow(time);
    this.rays.tick(time);
  }

  async _readHijack() {
    if (!this.rf) return;
    const ver = this.field.version;
    const flo = await this.field.readFloorsOnly();
    if (ver !== this.field.version) return;
    const s = this.field.stats(this.field.bufOut, flo, this.state, this.rf.pos[2]);
    this.hijack = this.ev?.eav.ok ? s.hijack : 0;
    this.ui.updateAttacker(this.ev, this.hijack);
  }

  _moveAttacker(x, y) {
    const g = B.rf.grids.outdoor;
    this.attacker.pos[0] = Math.min(g.x1 - 1, Math.max(g.x0 + 1, x));
    this.attacker.pos[1] = Math.min(g.y1 - 1, Math.max(g.y0 + 1, y));
    this._clampAttacker();
    this.dirty.att = true;
  }

  /** keep the attacker outside the building and the neighbours */
  _clampAttacker() {
    const p = this.attacker.pos;
    const rects = [[FOOT[0] - 0.6, FOOT[1] - 0.6, FOOT[2] + 0.6, FOOT[3] + 0.6], ...B.context.map((c) => [c.rect[0] - 0.5, c.rect[1] - 0.5, c.rect[2] + 0.5, c.rect[3] + 0.5])];
    for (const [x0, y0, x1, y1] of rects) {
      if (p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1) {
        const d = [p[0] - x0, x1 - p[0], p[1] - y0, y1 - p[1]];
        const i = d.indexOf(Math.min(...d));
        if (i === 0) p[0] = x0; else if (i === 1) p[0] = x1; else if (i === 2) p[1] = y0; else p[1] = y1;
        if (this.attacker.target) this.attacker.target = null;
      }
    }
  }

  // ───────────── input ─────────────
  _input() {
    const dom = this.world.renderer.domElement;
    const vp = document.getElementById('viewport');
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitAt = (e, plane) => {
      const r = dom.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.world.camera);
      if (!plane) return ray.intersectObjects([this.attacker.hit, ...this.routers.filter((r) => r.group.visible).map((r) => r.hit)], false)[0];
      const v = new THREE.Vector3();
      return ray.ray.intersectPlane(plane, v) ? v : null;
    };
    let drag = null;
    dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const h = hitAt(e);
      if (!h) return;
      const kind = h.object.userData.pick;
      const ri = h.object.userData.index ?? 0;
      if (kind === 'router' && !this.routers[ri].group.parent?.visible) return;
      drag = { kind, id: e.pointerId, ri };
      if (kind === 'router') {
        const wp = this.routers[ri].group.getWorldPosition(new THREE.Vector3());
        drag.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -wp.y);
        drag.z = this.rf.txs[ri][2];
      } else drag.plane = ground;
      this.world.controls.enabled = false;
      this.state.follow = false;
      dom.setPointerCapture(e.pointerId);
      vp.classList.add('grabbing');
      e.preventDefault();
    });
    dom.addEventListener('pointermove', (e) => {
      if (!drag) {
        if (e.buttons) return;
        const h = hitAt(e);
        vp.classList.toggle('grab', !!h);
        return;
      }
      const p = hitAt(e, drag.plane);
      if (!p) return;
      const x = p.x, y = -p.z;
      if (drag.kind === 'attacker') {
        this.attacker.target = [x, y, 16];
      } else {
        const m = 0.45;
        const nx = Math.min(FOOT[2] - m, Math.max(FOOT[0] + m, x));
        const ny = Math.min(FOOT[3] - m, Math.max(FOOT[1] + m, y));
        const aps = this.rf.txs.map((p) => [...p]);
        aps[drag.ri] = [nx, ny, drag.z];
        this.set({ mount: 'custom', aps }, { live: true, animate: false });
      }
    });
    const end = (e) => {
      if (!drag) return;
      if (drag.kind === 'router') this.scheduleStats();
      drag = null;
      this.world.controls.enabled = true;
      vp.classList.remove('grabbing');
      try { dom.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener('dblclick', (e) => {
      const p = hitAt(e, ground);
      if (p) this.walkTo([p.x, -p.z]);
    });
    window.addEventListener('keydown', (e) => {
      if (e.target.matches?.('input, select, textarea')) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
        if (this.tour.i >= 0 && k.startsWith('arrow')) return;
        this.keys.add(k);
        if (k.startsWith('arrow')) e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === 't') this.tour.i >= 0 ? this.tour.stop() : this.tour.start();
      else if (k === 'p') this.applyAll();
      else if (k === 'r') this.resetAll();
      else if (k === 'l') this.setLang(this.state.lang === 'ar' ? 'en' : 'ar');
      else if (k === 'f') this.cameraPreset('follow');
      else if (k === '1') this.cameraPreset('overview');
      else if (k === '2') this.cameraPreset('top');
      else if (k === '3') this.cameraPreset('street');
      else if (k === '4') this.cameraPreset('floor');
      else if (k === 'm') this.cycleMood();
      else if (k === 'h') document.body.classList.toggle('clean');
      else if (k === 'escape') document.getElementById('about').hidden = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }
}

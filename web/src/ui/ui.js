// DOM user interface: top bar, KPI column, attacker card, control panel, legend, about.
import { t } from './i18n.js';
import { icon, hydrateIcons } from './icons.js';
import { B, EQUIP } from '../data.js';

const $ = (s, r = document) => r.querySelector(s);
const fmt0 = (x) => Math.round(x).toLocaleString('en-US');
const fmtArea = (m2) => (m2 >= 100000 ? `${(m2 / 1000).toFixed(0)}k` : fmt0(m2));
const sgn = (x, d = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(d)}`;

export const PROTECTIONS = {
  rf: [
    ['lowPower', 'zap'], ['directional', 'dish'], ['relocate', 'move'], ['microcells', 'router'],
    ['shieldWindows', 'window'], ['shieldPaint', 'paint'], ['band5', 'bars'],
  ],
  proto: [['pmf', 'lock'], ['wpa3', 'key']],
};

export const SPOTS = {
  goCafe: [1.0, -30.8], goSide: [-25.6, 4.0], goParking: [41.5, 1.5], goLawn: [6.0, 19.5],
};

export class UI {
  constructor(app) {
    this.app = app;
    this.tw = new Map();
    this.build();
  }
  get lang() { return this.app.state.lang; }
  T(k) { return t(k, this.lang); }

  build() {
    const L = this.lang;
    document.documentElement.lang = L;
    document.documentElement.dir = L === 'ar' ? 'rtl' : 'ltr';
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = this.T(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = this.T(el.dataset.i18nTitle);
    this.buildSegs();
    this.buildCamMenu();
    this.buildKPIs();
    this.buildPanel();
    this.buildLegend();
    this.buildAbout();
    hydrateIcons();
    this.sync();
    if (this.lastStats) this.updateKPIs(this.lastStats, this.lastBase, true);
    if (this.lastEv) this.updateAttacker(this.lastEv, this.lastHijack);
  }

  // ───────────── top bar ─────────────
  buildSegs() {
    const m = $('#seg-mode');
    const hasS = this.app.sionna.available;
    m.innerHTML = [
      ['attack', 'target', 'att'], ['signal', 'wifi', ''], ['sionna', 'cube', ''], ['diff', 'diff', ''],
    ].map(([k, ic, cls]) => `<button data-mode="${k}" class="${cls}" ${!hasS && (k === 'sionna' || k === 'diff') ? 'disabled' : ''} title="${hasS || (k !== 'sionna' && k !== 'diff') ? '' : this.T('sionna.missing')}"><span class="ico" data-icon="${ic}"></span>${this.T('mode.' + k)}</button>`).join('');
    m.onclick = (e) => { const b = e.target.closest('button[data-mode]'); if (b && !b.disabled) this.app.setMode(b.dataset.mode); };
    const f = $('#seg-floor');
    f.innerHTML = `<button data-floor="all">${this.T('floor.all')}</button>${[0, 1, 2].map((k) => `<button data-floor="${k}">${this.T('floor.' + k)}</button>`).join('')}<span class="sep"></span><button data-floor="explode"><span class="ico" data-icon="floors"></span>${this.T('floor.explode')}</button>`;
    f.onclick = (e) => {
      const b = e.target.closest('button[data-floor]');
      if (!b) return;
      const v = b.dataset.floor;
      if (v === 'explode') this.app.setView({ explode: !this.app.state.explode });
      else this.app.setView({ focus: v === 'all' ? 'all' : +v, explode: false });
    };
    $('#btn-tour').onclick = () => this.app.tour.start();
    $('#btn-lang').onclick = () => this.app.setLang(this.lang === 'ar' ? 'en' : 'ar');
    $('#btn-mood').onclick = () => this.app.cycleMood();
    $('#btn-full').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
    $('#btn-about').onclick = () => ($('#about').hidden = false);
    $('#btn-panel').onclick = () => document.body.classList.toggle('panel-open');
    $('#btn-view').onclick = () => this.app.setSimple(!this.app.state.simple);
  }

  buildCamMenu() {
    const pop = $('#cam-pop');
    pop.innerHTML = [
      ['overview', 'map', '1'], ['top', 'plan', '2'], ['street', 'coffee', '3'], ['floor', 'floors', '4'], ['follow', 'target', 'F'],
    ].map(([k, ic, kb]) => `<button data-cam="${k}"><span class="ico" data-icon="${ic}"></span>${this.T('cam.' + k)}<kbd>${kb}</kbd></button>`).join('');
    const menu = $('#menu-cam');
    $('#btn-cam').onclick = (e) => { e.stopPropagation(); menu.classList.toggle('open'); };
    pop.onclick = (e) => { const b = e.target.closest('button[data-cam]'); if (b) { this.app.cameraPreset(b.dataset.cam); menu.classList.remove('open'); } };
    document.addEventListener('click', () => menu.classList.remove('open'));
  }

  // ───────────── KPIs ─────────────
  buildKPIs() {
    const k = $('#kpis');
    k.innerHTML = `
      <div class="kpi" style="--accent: var(--red)" id="k-danger">
        <div class="kpi-head"><span class="kpi-label">${this.T('kpi.danger')}</span><span class="kpi-delta flat" data-r="delta">—</span></div>
        <div class="kpi-row"><span class="kpi-value" data-r="val">—</span><span class="kpi-unit">${this.T('unit.m2')}</span></div>
        <div class="kpi-bar"><span data-r="bar" style="width:100%;background:linear-gradient(90deg,var(--amber),var(--orange),var(--red))"></span></div>
        <div class="kpi-tiers" data-r="tiers"></div>
        <div class="kpi-base" data-r="base"></div>
      </div>
      <div class="row2">
        <div class="kpi" style="--accent: var(--orange)" id="k-leak">
          <div class="kpi-label">${this.T('kpi.leak')}</div>
          <div class="kpi-row"><span class="kpi-value" data-r="val" style="font-size:22px">—</span><span class="kpi-unit" data-r="unit">${this.T('unit.m')}</span></div>
          <div class="kpi-base" data-r="base"></div>
        </div>
        <div class="kpi" style="--accent: var(--amber)" id="k-street">
          <div class="kpi-label">${this.T('kpi.street')}</div>
          <div class="kpi-row"><span class="kpi-value" data-r="val" style="font-size:22px">—</span><span class="kpi-unit">%</span></div>
          <div class="progress"><span data-r="bar" style="width:0;background:var(--red)"></span></div>
        </div>
      </div>
      <div class="kpi" style="--accent: var(--green)" id="k-cov">
        <div class="kpi-head"><span class="kpi-label">${this.T('kpi.coverage')}</span><span class="kpi-delta flat" data-r="delta">—</span></div>
        <div class="kpi-row"><span class="kpi-value" data-r="val">—</span><span class="kpi-unit">%</span></div>
        <div class="progress"><span data-r="bar" style="width:0"></span><i class="target" style="inset-inline-start:95%"></i></div>
        <div class="kpi-note" data-r="note"></div>
      </div>
      <div class="kpi att-card" id="k-att" style="--accent: var(--red)"></div>`;
    this.k = {
      danger: $('#k-danger'), leak: $('#k-leak'), street: $('#k-street'), cov: $('#k-cov'), att: $('#k-att'),
    };
  }

  tween(key, el, to, fmt, dur = 700) {
    const cur = this.tw.get(key) ?? { v: to };
    const from = Number.isFinite(cur.v) ? cur.v : to;
    const t0 = performance.now();
    const st = { v: from, raf: 0 };
    cancelAnimationFrame(cur.raf);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      st.v = from + (to - from) * e;
      el.textContent = fmt(st.v);
      if (k < 1) st.raf = requestAnimationFrame(step);
    };
    st.raf = requestAnimationFrame(step);
    this.tw.set(key, st);
  }

  updateKPIs(s, base, instant = false) {
    this.lastStats = s; this.lastBase = base;
    if (!s) return;
    const r = (card, name) => card.querySelector(`[data-r="${name}"]`);
    const sion = this.app.state.mode === 'sionna';
    // danger zone (union of feasible attacks)
    const d = this.k.danger;
    this.tween('danger', r(d, 'val'), s.areaU, fmtArea, instant ? 1 : 700);
    if (base && base.areaU > 0) {
      const rel = (s.areaU / base.areaU - 1) * 100;
      const dl = r(d, 'delta');
      dl.textContent = Math.abs(rel) < 0.5 ? '0 %' : `${sgn(rel, 0)} %`;
      dl.className = `kpi-delta ${rel < -0.5 ? 'good' : rel > 0.5 ? 'bad' : 'flat'}`;
      r(d, 'bar').style.width = `${Math.min(100, (100 * s.areaU) / base.areaU)}%`;
      r(d, 'base').textContent = `${this.T('kpi.baseline')}: ${fmtArea(base.areaU)} ${this.T('unit.m2')}`;
    }
    r(d, 'tiers').innerHTML = sion
      ? `<span>${this.T('kpi.sionnaNote')}</span>`
      : `<span><i style="background:var(--amber)"></i>${this.T('legend.eav')} <b class="num">${fmtArea(s.areaE)}</b></span>
         <span><i style="background:var(--orange)"></i>${this.T('legend.deauth')} <b class="num">${fmtArea(s.areaD)}</b></span>
         <span><i style="background:var(--red)"></i>${this.T('legend.et')} <b class="num">${fmtArea(s.areaT)}</b></span>`;
    // leak distance
    const l = this.k.leak;
    if (s.edge) { cancelAnimationFrame(this.tw.get('leak')?.raf); r(l, 'val').textContent = this.T('kpi.beyond'); r(l, 'unit').textContent = ''; this.tw.set('leak', { v: 100 }); }
    else { r(l, 'unit').textContent = this.T('unit.m'); this.tween('leak', r(l, 'val'), s.maxLeak, (v) => v.toFixed(1), instant ? 1 : 700); }
    r(l, 'base').textContent = base ? `${this.T('kpi.baseline')}: ${base.edge ? this.T('kpi.beyond') : base.maxLeak.toFixed(1) + ' ' + this.T('unit.m')}` : '';
    // street
    const st = this.k.street;
    this.tween('street', r(st, 'val'), s.street, (v) => v.toFixed(0), instant ? 1 : 700);
    const sb = r(st, 'bar');
    sb.style.width = `${s.street}%`;
    sb.style.background = s.street > 50 ? 'var(--red)' : s.street > 10 ? 'var(--orange)' : 'var(--green)';
    // coverage
    const c = this.k.cov;
    this.tween('cov', r(c, 'val'), s.coverage, (v) => v.toFixed(1), instant ? 1 : 700);
    const cb = r(c, 'bar');
    cb.style.width = `${s.coverage}%`;
    const col = s.coverage >= 95 ? 'var(--green)' : s.coverage >= 85 ? 'var(--amber)' : 'var(--red)';
    cb.style.background = col;
    c.style.setProperty('--accent', col);
    if (base) {
      const dc = s.coverage - base.coverage;
      const dl = r(c, 'delta');
      dl.textContent = Math.abs(dc) < 0.05 ? '0' : `${sgn(dc)} pp`;
      dl.className = `kpi-delta ${dc < -2 ? 'bad' : dc > 0.05 ? 'good' : 'flat'}`;
    }
    r(c, 'note').textContent = `${this.T('kpi.target')} · ${this.T('floor.' + s.floor)} · ${this.T('kpi.baseline')}: ${base ? base.coverage.toFixed(1) : '—'} %`;
    if (s.edge) r(l, 'base').title = this.T('kpi.beyondNote');
    this.app.story?.refresh();
  }

  updateAttacker(ev, hijack = null) {
    this.lastEv = ev; this.lastHijack = hijack;
    if (!ev) return;
    const s = this.app.state;
    const eq = EQUIP[s.equipment];
    const sion = s.mode === 'sionna';
    const lvl = ev.evilTwin.ok ? 'et' : ev.deauth.ok ? 'deauth' : ev.eav.ok ? 'eav' : 'safe';
    const accent = { et: 'var(--red)', deauth: 'var(--orange)', eav: 'var(--amber)', safe: 'var(--green)' }[lvl];
    const row = (cls, c, ic, name, sub, state) => `<div class="attack ${cls}" style="--c:${c}"><span class="a-ico">${icon(ic)}</span><div><div class="a-name">${name}</div><div class="a-sub">${sub}</div></div><span class="a-state">${state}</span></div>`;
    const st = (ok, blocked) => (blocked ? ['blocked', this.T('att.blocked')] : ok ? ['ok', this.T('att.ok')] : ['no', this.T('att.no')]);
    const [c1, s1] = st(ev.eav.ok, false);
    const [c2, s2] = st(ev.deauth.ok || (ev.deauth.blocked && ev.clients.some((c) => c.deauthM >= 0)), ev.deauth.blocked && ev.clients.some((c) => c.deauthM >= 0));
    const etReach = ev.clients.some((c) => c.etM >= 0);
    const [c3, s3] = st(ev.evilTwin.ok, ev.evilTwin.blocked && etReach);
    const nDe = ev.clients.filter((c) => c.deauthM >= 0).length;
    const nEt = ev.clients.filter((c) => c.etM >= 0).length;
    const N = ev.clients.length;
    const eavSub = ev.eav.ok ? (s.wpa3 ? this.T('att.encOnly') : this.T('att.crack')) : `${sgn(ev.eav.margin)} dB`;
    const etSub = `${nEt}/${N} ${this.T('att.devices')}${hijack !== null && !s.wpa3 ? ` · ${hijack.toFixed(0)}% ${this.T('att.hijack')}` : ''}`;
    // link budget rows
    const walls = ev.walls.map((w) => `<tr class="wall"><td>${this.matName(w.mat)}</td><td class="neg">−${w.loss.toFixed(1)}</td></tr>`).join('')
      + ev.slabs.map((w) => `<tr class="wall"><td>${this.T('lb.slab')}</td><td class="neg">−${w.loss.toFixed(1)}</td></tr>`).join('');
    this.k.att.style.setProperty('--accent', accent);
    this.k.att.innerHTML = `
      <div class="kpi-head"><span class="kpi-label">${icon('hood').replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px;stroke:currentColor;fill:none;stroke-width:2"')} ${this.T('att.title')} · ${eq.name[this.lang]}</span><span class="att-pos num">${ev.pos[0].toFixed(1)}, ${ev.pos[1].toFixed(1)}</span></div>
      <div class="kpi-row"><span class="kpi-value" style="color:${accent}">${ev.rss.toFixed(1)}</span><span class="kpi-unit">dBm</span><span class="kpi-delta ${ev.eav.ok ? 'bad' : 'good'}">${sgn(ev.eav.margin)} dB</span></div>
      <div class="attacks">
        ${row(c1, 'var(--amber)', 'eye', this.T('att.eav'), eavSub, s1)}
        ${sion ? '' : row(c2, 'var(--orange)', 'wifiOff', this.T('att.deauth'), `${nDe}/${N} ${this.T('att.devices')}`, s2)}
        ${sion ? '' : row(c3, 'var(--red)', 'twin', this.T('att.et'), etSub, s3)}
      </div>
      <details class="lb" ${this.lbOpen ? 'open' : ''}><summary>${this.T('lb.title')}</summary>
        <table class="lb-table">
          <tr><td>${this.T('lb.ptx')}</td><td>${this.app.rf.ptx.toFixed(1)} dBm</td></tr>
          <tr><td>${this.T('lb.gtx')}</td><td class="${ev.gTx >= 0 ? 'pos' : 'neg'}">${sgn(ev.gTx)} dBi</td></tr>
          <tr><td>${this.T('lb.fspl')} ${ev.d.toFixed(1)} ${this.T('unit.m')}</td><td class="neg">−${ev.spread.toFixed(1)}</td></tr>
          <tr><td>${this.T('lb.walls')} (${ev.walls.length + ev.slabs.length})</td><td class="neg">${ev.walls.length + ev.slabs.length ? '−' + (ev.pl - ev.spread).toFixed(1) : '0'}</td></tr>
          ${walls || `<tr class="wall"><td>${this.T('lb.none')}</td><td></td></tr>`}
          <tr><td>${this.T('lb.grx')}</td><td class="pos">+${eq.gain_dbi.toFixed(1)} dBi</td></tr>
          <tr class="total"><td>${this.T('lb.rss')}</td><td>${ev.rss.toFixed(1)} dBm</td></tr>
          <tr><td>${this.T('lb.sens')}</td><td>${eq.sens_dbm} dBm</td></tr>
          <tr class="total"><td>${this.T('lb.margin')}</td><td class="${ev.eav.margin >= 0 ? 'neg' : 'pos'}">${sgn(ev.eav.margin)} dB</td></tr>
        </table>
      </details>`;
    this.k.att.querySelector('details').addEventListener('toggle', (e) => (this.lbOpen = e.target.open));
    this.app.story?.refresh();
  }

  matName(key) {
    const m = B.materials[key];
    return m ? m.name[this.lang] : key;
  }

  // ───────────── control panel ─────────────
  buildPanel() {
    const p = $('#panel');
    const sec = (id, ic, title, body, closed = false) => `<section class="sec ${closed || this.closed?.[id] ? 'closed' : ''}" data-sec="${id}"><button class="sec-h" data-act="sec"><span class="ico">${icon(ic)}</span>${title}<span class="chev ico">${icon('chevron')}</span></button><div class="sec-b">${body}</div></section>`;
    const tog = (k, ic) => `<div class="ptog" data-prot="${k}"><span class="p-ico">${icon(ic)}</span><div><div class="p-t">${this.T('p.' + k)}</div><div class="p-d">${this.T('p.' + k + '.d')}</div></div><span class="switch"></span></div>`;
    const protect = `
      <div class="row2"><button class="btn shield" data-act="apply"><span class="ico">${icon('shieldCheck')}</span>${this.T('btn.apply')}</button><button class="btn" data-act="reset" style="justify-content:center"><span class="ico">${icon('reset')}</span>${this.T('btn.reset')}</button></div>
      <div class="sub-h">${this.T('prot.rf')}</div>
      ${PROTECTIONS.rf.map(([k, ic]) => tog(k, ic)).join('')}
      <button class="btn small" data-act="optimize" style="justify-content:center"><span class="ico">${icon('sparkles')}</span>${this.T('btn.optimize')}</button>
      <div class="sub-h">${this.T('prot.proto')}</div>
      ${PROTECTIONS.proto.map(([k, ic]) => tog(k, ic)).join('')}`;
    const ap = `
      <div class="field"><div class="field-h"><span>${this.T('ap.band')}</span></div><div class="chips" data-group="freq"><button class="chip" data-v="2.4">2.4 GHz</button><button class="chip" data-v="5">5 GHz</button></div></div>
      <div class="field"><div class="field-h"><span>${this.T('ap.power')}</span><b data-out="txDbm"></b></div><input type="range" min="0" max="23" step="1" data-input="txDbm"></div>
      <div class="field"><div class="field-h"><span>${this.T('ap.antenna')}</span></div><div class="chips" data-group="antenna"><button class="chip" data-v="dipole">${this.T('ap.omni')}</button><button class="chip" data-v="patch">${this.T('ap.patch')}</button></div></div>
      <div class="field" data-show="patch"><div class="field-h"><span>${this.T('ap.az')}</span><b data-out="az"></b></div><input type="range" min="0" max="355" step="5" data-input="az"></div>
      <div class="field" data-show="patch"><div class="field-h"><span>${this.T('ap.tilt')}</span><b data-out="tilt"></b></div><input type="range" min="-90" max="30" step="5" data-input="tilt"></div>
      <div class="field"><div class="field-h"><span>${this.T('ap.mount')}</span></div><div class="chips" data-group="mount"><button class="chip" data-v="wall">${this.T('ap.wall')}</button><button class="chip" data-v="ceiling">${this.T('ap.ceiling')}</button><button class="chip" data-v="micro">${this.T('ap.micro')}</button><button class="chip" data-v="custom" disabled>${this.T('ap.custom')}</button></div></div>
      <div class="muted-note">${this.T('ap.hint')}</div>`;
    const eqIcons = { phone: 'phone', usb: 'laptop', yagi: 'yagi' };
    const att = `
      <div class="field"><div class="field-h"><span>${this.T('att.equipment')}</span></div>
        <div class="equip">${Object.entries(EQUIP).map(([k, e]) => `<button class="eq" data-eq="${k}">${icon(eqIcons[k])}<span class="eq-n">${e.name[this.lang]}</span><span class="eq-s">${e.gain_dbi} dBi · ${e.sens_dbm} dBm</span></button>`).join('')}</div></div>
      <div class="chips">${Object.keys(SPOTS).map((k) => `<button class="chip" data-spot="${k}"><span class="ico" style="width:14px;height:14px;vertical-align:-3px">${icon('pin')}</span> ${this.T('att.' + k)}</button>`).join('')}</div>
      <div class="muted-note">${this.T('att.hint')}</div>`;
    const lay = (k) => `<label class="tgl" data-layer="${k}"><span>${this.T('layer.' + k)}</span><span class="switch"></span></label>`;
    const layers = `
      ${['zones', 'indoor', 'contours', 'ghost', 'rays', 'waves', 'labels'].map(lay).join('')}
      <div class="field"><div class="field-h"><span>${this.T('view.cut')}</span><b data-out="cut"></b></div><input type="range" min="0.6" max="3.4" step="0.1" data-input="cut"></div>
      <div class="field"><div class="field-h"><span>${this.T('view.quality')}</span></div><div class="chips" data-group="quality"><button class="chip" data-v="ultra">${this.T('q.ultra')}</button><button class="chip" data-v="high">${this.T('q.high')}</button><button class="chip" data-v="low">${this.T('q.low')}</button></div></div>`;
    p.innerHTML = sec('protect', 'shield', this.T('panel.protect'), protect)
      + sec('ap', 'router', this.T('panel.ap'), ap, true)
      + sec('attacker', 'hood', this.T('panel.attacker'), att, true)
      + sec('layers', 'layers', this.T('panel.layers'), layers, true);

    p.onclick = (e) => {
      const a = e.target.closest('[data-act]');
      if (a) {
        const act = a.dataset.act;
        if (act === 'sec') { const s = a.closest('.sec'); s.classList.toggle('closed'); this.closed = { ...this.closed, [s.dataset.sec]: s.classList.contains('closed') }; return; }
        if (act === 'apply') return this.app.applyAll();
        if (act === 'reset') return this.app.resetAll();
        if (act === 'optimize') return this.app.optimizePower();
      }
      const pt = e.target.closest('[data-prot]');
      if (pt) return this.app.toggleProtection(pt.dataset.prot);
      const ch = e.target.closest('[data-group] .chip');
      if (ch && !ch.disabled) {
        const g = ch.parentElement.dataset.group, v = ch.dataset.v;
        if (g === 'freq') return this.app.set({ freq: +v });
        if (g === 'antenna') return this.app.setAntenna(v);
        if (g === 'mount') return this.app.setMount(v);
        if (g === 'quality') return this.app.setQuality(v);
      }
      const eq = e.target.closest('[data-eq]');
      if (eq) return this.app.set({ equipment: eq.dataset.eq });
      const sp = e.target.closest('[data-spot]');
      if (sp) return this.app.walkTo(SPOTS[sp.dataset.spot]);
      const ly = e.target.closest('[data-layer]');
      if (ly) { e.preventDefault(); return this.app.setLayer(ly.dataset.layer, !this.app.state.layers[ly.dataset.layer]); }
    };
    p.oninput = (e) => {
      const k = e.target.dataset.input;
      if (!k) return;
      const v = +e.target.value;
      if (k === 'cut') this.app.setView({ cut: v });
      else this.app.set({ [k]: v }, { animate: false, live: true });
      this.syncRange(e.target);
    };
    p.onchange = (e) => {
      const k = e.target.dataset.input;
      if (k && k !== 'cut') this.app.set({ [k]: +e.target.value }, { animate: false });
    };
  }

  syncRange(el) {
    const min = +el.min, max = +el.max, v = +el.value;
    el.style.setProperty('--p', `${((v - min) / (max - min)) * 100}%`);
  }

  /** reflect state in all controls */
  sync() {
    const s = this.app.state;
    for (const b of document.querySelectorAll('#seg-mode button')) b.classList.toggle('on', b.dataset.mode === s.mode);
    for (const b of document.querySelectorAll('#seg-floor button')) {
      const v = b.dataset.floor;
      b.classList.toggle('on', v === 'explode' ? s.explode : !s.explode && String(s.focus) === v);
    }
    const prot = this.app.protections();
    for (const el of document.querySelectorAll('[data-prot]')) el.classList.toggle('on', !!prot[el.dataset.prot]);
    const grp = (g, v) => { for (const c of document.querySelectorAll(`[data-group="${g}"] .chip`)) c.classList.toggle('on', c.dataset.v === String(v)); };
    grp('freq', s.freq); grp('antenna', s.antenna); grp('mount', s.mount); grp('quality', s.quality);
    for (const el of document.querySelectorAll('[data-show="patch"]')) el.style.display = s.antenna === 'patch' ? '' : 'none';
    const outs = { txDbm: `${s.txDbm} dBm`, az: `${Math.round(s.az)}°`, tilt: `${Math.round(s.tilt)}°`, cut: `${s.cut.toFixed(1)} m` };
    for (const [k, txt] of Object.entries(outs)) {
      const o = document.querySelector(`[data-out="${k}"]`); if (o) o.textContent = txt;
      const i = document.querySelector(`[data-input="${k}"]`);
      if (i && document.activeElement !== i) { i.value = k === 'cut' ? s.cut : s[k]; this.syncRange(i); }
    }
    for (const b of document.querySelectorAll('[data-eq]')) b.classList.toggle('on', b.dataset.eq === s.equipment);
    for (const l of document.querySelectorAll('[data-layer]')) l.querySelector('.switch').classList.toggle('on', !!s.layers[l.dataset.layer]);
    const mood = { dusk: 'sunset', day: 'sun', night: 'moon' }[s.mood];
    $('#btn-mood').innerHTML = `<span class="ico">${icon(mood)}</span>`;
    $('#btn-mood').title = this.T('mood.' + s.mood);
    this.buildLegend();
  }

  // ───────────── legend ─────────────
  buildLegend() {
    const s = this.app.state;
    const lg = $('#legend');
    if (s.mode === 'signal' || s.mode === 'sionna') {
      lg.innerHTML = `<h4>${this.T('legend.signal')}${s.mode === 'sionna' ? ' · Sionna RT' : ''}</h4><div class="colorbar"></div><div class="cb-ticks"><span>−100</span><span>−86</span><span>−72</span><span>−58</span><span>−44</span><span>−30</span></div><div class="lg-note">${this.T('legend.hole')}${s.mode === 'sionna' && this.app.sionnaScenarioLabel ? ' · ' + this.T('sionna.scenario') + ': ' + this.app.sionnaScenarioLabel : ''}</div>`;
    } else if (s.mode === 'diff') {
      lg.innerHTML = `<h4>${this.T('legend.diff')}</h4><div class="colorbar div"></div><div class="cb-ticks"><span>−20</span><span>−10</span><span>0</span><span>+10</span><span>+20</span></div>`;
    } else {
      lg.innerHTML = `<h4>${this.T('legend.attack')}</h4><div class="lg-items">
        <div class="lg-item"><span class="lg-sw" style="background:var(--amber)"></span>${this.T('legend.eav')}</div>
        <div class="lg-item"><span class="lg-sw" style="background:var(--orange)"></span>${this.T('legend.deauth')}</div>
        <div class="lg-item"><span class="lg-sw" style="background:repeating-linear-gradient(45deg,var(--red) 0 4px,#c0173d 4px 7px)"></span>${this.T('legend.et')}</div>
        <div class="lg-item"><span class="lg-sw" style="background:var(--purple)"></span>${this.T('legend.hijack')}</div>
        <div class="lg-item"><span class="lg-ghost"></span>${this.T('legend.ghost')}</div>
      </div>`;
    }
  }

  // ───────────── about ─────────────
  buildAbout() {
    const ar = this.lang === 'ar';
    const a = $('#about');
    a.innerHTML = `<div class="modal-card">
      <button class="btn small modal-close" data-close>${this.T('about.close')}</button>
      <h2>${this.T('title')}</h2>
      <p style="margin-top:4px;color:var(--muted)">${this.T('subtitle')}</p>
      <div class="who">
        <div><b>${ar ? 'إعداد' : 'Student'}</b>${ar ? 'أويس أبو صلاح' : 'Owais Abu Salah'}</div>
        <div><b>${ar ? 'الرقم الجامعي' : 'Student ID'}</b><span class="num">12610830</span></div>
        <div><b>${ar ? 'المساق' : 'Course'}</b>${ar ? 'نظم الاتصالات اللاسلكية وأمنها' : 'Wireless Communication Systems & Security'}</div>
      </div>
      ${ar ? `
      <h3>الفكرة</h3>
      <p>مجسّم ثلاثي الأبعاد لمبنى من ثلاثة طوابق، يحاكي انتشار إشارة Wi‑Fi داخله: كيف تخترق الجدران والبلاطات، وإلى أي مدى تتسرّب إلى الشارع. ثم يرسم «منطقة الخطر»: كل مكان خارج المبنى يكفي فيه مستوى الإشارة لهجوم تنصّت أو Deauth أو Evil Twin. يمكنك تحريك المهاجم والراوتر بنفسك، وتطبيق إجراءات الحماية لترى المنطقة تنكمش لحظياً.</p>
      <h3>النموذج</h3>
      <ul><li>نموذج COST‑231 متعدد الجدران فوق فقد المسار اللوغاريتمي، مع تقاطع ثلاثي الأبعاد للجدران والنوافذ والأبواب والبلاطات، ونمط هوائي ثنائي القطب أو هوائي رقعي حسب 3GPP TR 38.901.</li>
      <li>يُحسب على كرت الشاشة (GLSL) لنحو 200 ألف خلية في كل تحديث، مع ميزانية وصلة مفصّلة للمهاجم.</li>
      <li>يُتحقّق منه بمقارنته مع تتبّع الأشعة في NVIDIA Sionna RT على المجسّم نفسه.</li></ul>
      <h3>الأدوات</h3><p>Three.js · NVIDIA Sionna RT · Blender · Python/NumPy · Vite</p>` : `
      <h3>Idea</h3>
      <p>A 3-D digital twin of a three-storey building that simulates how Wi-Fi propagates through it — penetrating walls and slabs and leaking onto the street — and maps the <b>danger zone</b>: every outdoor spot where the signal is strong enough for eavesdropping, deauthentication or an Evil Twin. Move the attacker and the access point yourself and apply protections to watch the zone shrink in real time.</p>
      <h3>Model</h3>
      <ul><li>COST-231 Multi-Wall model on top of log-distance path loss, with 3-D intersection of walls, windows, doors and slabs, and a half-wave-dipole or 3GPP TR 38.901 patch antenna pattern.</li>
      <li>Evaluated on the GPU (GLSL) for ≈ 200 k cells per update, plus a detailed link budget for the attacker.</li>
      <li>Validated against NVIDIA Sionna RT ray tracing on the same geometry.</li></ul>
      <h3>Tools</h3><p>Three.js · NVIDIA Sionna RT · Blender · Python/NumPy · Vite</p>`}
      <h3>${ar ? 'اختصارات' : 'Shortcuts'}</h3>
      <p><kbd>T</kbd> ${ar ? 'العرض الموجّه' : 'guided demo'} · <kbd>P</kbd> ${ar ? 'طبّق الحماية' : 'apply protection'} · <kbd>R</kbd> ${ar ? 'إعادة' : 'reset'} · <kbd>1–4</kbd> ${ar ? 'الكاميرات' : 'cameras'} · <kbd>F</kbd> ${ar ? 'تتبّع المهاجم' : 'follow attacker'} · <kbd>L</kbd> ${ar ? 'اللغة' : 'language'} · <kbd>H</kbd> ${ar ? 'إخفاء الواجهة' : 'hide the UI'} · <kbd>M</kbd> ${ar ? 'الإضاءة' : 'lighting'} · <kbd>W A S D</kbd> ${ar ? 'تحريك المهاجم' : 'move attacker'}</p>
    </div>`;
    a.onclick = (e) => { if (e.target === a || e.target.closest('[data-close]')) a.hidden = true; };
  }

  toast(html, kind = 'good', ms = 2600) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = `toast ${kind === 'bad' ? 'bad' : ''}`;
    el.innerHTML = `<span class="ico">${icon(kind === 'bad' ? 'info' : 'shieldCheck')}</span><span>${html}</span>`;
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, ms);
  }
}

// Simple view: the whole project as a four-step story (leak → attacker → protection → result),
// one explanation card with live numbers, and one plain-language status card for the attacker.
// The detailed interface (all modes, floors, switches and KPIs) stays one click away.
import { icon } from './icons.js';
import { B } from '../data.js';

const area = (m2) => (m2 == null ? '…' : Math.round(m2).toLocaleString('en-US'));
const pct0 = (x) => (x == null ? '…' : Math.round(x).toString());
const CAFE = [1.0, -30.8];
const iso = (x) => `<bdi dir="ltr" class="nb">${x}</bdi>`;   // numbers with signs and units stay left-to-right (and on one line) inside Arabic text
const minus = (x) => (x < 0 ? '−' : '') + Math.abs(x).toFixed(0);

const W = {
  stepOf: ['Step {i} of 4', 'الخطوة {i} من 4'],
  next: ['Next', 'التالي'],
  back: ['Back', 'السابق'],
  again: ['Start again', 'من البداية'],
  apply: ['Apply protection', 'طبّق الحماية'],
  applying: ['Applying…', 'جارٍ التطبيق…'],
  applied: ['Protected', 'تمّت الحماية'],
  hint: ['Drag the attacker, or double-click the street, to try another spot.', 'اسحب المهاجم أو انقر مرتين على الشارع لتجرّب مكاناً آخر.'],
  steps: [['The leak', 'الإشارة تتسرّب'], ['The attacker', 'المهاجم'], ['Protection', 'الحماية'], ['The result', 'النتيجة']],
  weak: ['weak', 'ضعيفة'],
  strong: ['strong', 'قوية'],
  lgSignal: ['Signal strength', 'قوة الإشارة'],
  eav: ['Eavesdrop', 'تنصّت'],
  deauth: ['Disconnect devices', 'فصل الأجهزة'],
  et: ['Fake network', 'شبكة مزيّفة'],
  before: ['Before protection', 'قبل الحماية'],
  // status card
  stDanger: ['The attacker can attack from here', 'المهاجم يستطيع الهجوم من مكانه'],
  stEnc: ['He only sees encrypted traffic', 'لا يرى إلا بيانات مشفّرة'],
  stSafe: ['The attacker is out of reach', 'المهاجم خارج منطقة الخطر'],
  stZone: ['Danger zone outside', 'منطقة الخطر خارج المبنى'],
  m2: ['m²', 'م²'],
  view: [['Detailed mode', 'الوضع المفصّل'], ['Simple view', 'العرض المبسّط']],
};

const BADGES = [
  ['shieldWindows', 'window', ['Window film', 'عازل النوافذ']],
  ['shieldPaint', 'paint', ['Shielding paint', 'دهان عازل']],
  ['microcells', 'router', ['2 small APs', 'راوتران صغيران']],
  ['band5', 'bars', ['5 GHz band', 'نطاق 5 GHz']],
  ['power', 'zap', ['Lower power', 'قدرة أقل']],
  ['protocol', 'lock', ['WPA3 + 802.11w', 'WPA3 + 802.11w']],
];

export class Story {
  constructor(app) {
    this.app = app;
    this.i = 0;
    this.applying = false;
    this.steps = this.define();
    this.$steps = document.getElementById('story-steps');
    this.$card = document.getElementById('story-card');
    this.$status = document.getElementById('status');
    this.$steps.addEventListener('click', (e) => { const b = e.target.closest('[data-step]'); if (b) this.go(+b.dataset.step); });
    this.$card.addEventListener('click', (e) => {
      const a = e.target.closest('[data-s]');
      if (!a || a.disabled) return;
      const k = a.dataset.s;
      if (k === 'next') this.go(this.i + 1);
      else if (k === 'back') this.go(this.i - 1);
      else if (k === 'again') this.go(0);
      else if (k === 'apply') this.apply();
    });
  }

  get L() { return this.app.state.lang === 'ar' ? 1 : 0; }
  w(k) { return W[k][this.L]; }
  get on() { return document.body.classList.contains('simple'); }

  // ───────────── state helpers ─────────────
  badgeOn(k) {
    const p = this.app.protections(), s = this.app.state;
    if (k === 'power') return s.txDbm < B.router.tx_dbm;
    if (k === 'protocol') return s.pmf && s.wpa3;
    return !!p[k];
  }
  protectedAll() { return BADGES.every(([k]) => this.badgeOn(k)); }

  async apply() {
    if (this.applying) return;
    this.applying = true;
    this.render();
    try { await this.app.applyAll(); } finally { this.applying = false; }
    this.render();
    if (this.i === 2) setTimeout(() => { if (this.i === 2 && this.on) this.go(3); }, 1600);
  }

  define() {
    const app = this.app;
    const st = () => app.stats ?? {};
    const bs = () => app.baseStats ?? {};
    const ev = () => app.ev;
    const reduction = () => (bs().areaU ? Math.round((1 - (st().areaU ?? bs().areaU) / bs().areaU) * 100) : null);
    const baseline = () => { if (app.anyProtection()) app.resetAll(true); };
    return [
      {
        tone: 'cyan', legend: 'signal',
        title: () => ['Wi-Fi does not stop at the wall', 'الإشارة لا تتوقف عند الجدار'],
        text: () => [
          'The department access point hangs next to a street window on the first floor. Its signal passes through the wall and the glass and spreads over the whole street. Colours show signal strength — red is strongest.',
          'راوتر القسم معلّق بجانب نافذة في الطابق الأول تطلّ على الشارع. إشارته تعبر الجدار والزجاج وتنتشر في الشارع كله. الألوان تُظهر قوة الإشارة — الأحمر هو الأقوى.',
        ],
        stats: () => [
          [`${pct0(st().street)}`, '%', ['of the street is within reach', 'من الشارع في متناول المهاجم'], 'bad'],
          [st().edge ? '> 100' : (st().maxLeak ?? 0).toFixed(0), this.L ? 'م' : 'm', ['how far the signal leaks', 'مدى تسرّب الإشارة'], 'warn'],
        ],
        run: () => {
          baseline();
          app.setMode('signal');
          app.setView({ focus: 'all', explode: false });
          app.setLayer('rays', false);
          app.cameraPreset('overview', 2.2);
        },
      },
      {
        tone: 'red', legend: 'attack', hint: true,
        title: () => ['An attacker across the street', 'مهاجم في المقهى المقابل'],
        text: () => {
          const e = ev();
          const rss = e ? minus(e.rss) : '…';
          const m = e ? Math.max(0, e.eav.margin).toFixed(0) : '…';
          const can = e && e.deauth.ok;
          return [
            `He sits at the café with a cheap USB Wi-Fi adapter. The line is the direct path to the access point — only one wall is in the way. He receives ${iso(rss + ' dBm')}, ${iso(m + ' dB')} more than he needs, so he can listen in${can ? ' and knock devices off the network' : ''}.`,
            `يجلس في المقهى ومعه محوّل Wi‑Fi رخيص. الخط هو المسار المباشر إلى الراوتر — جدار واحد فقط في الطريق. يستقبل ${iso(rss + ' dBm')}، أي أكثر مما يحتاج بـ ${iso(m + ' dB')}، فيستطيع التنصّت${can ? ' وفصل الأجهزة عن الشبكة' : ''}.`,
          ];
        },
        stats: () => {
          const e = ev();
          return [
            [e ? minus(e.rss) : '…', 'dBm', ['signal at the attacker', 'الإشارة عند المهاجم'], e?.eav.ok ? 'bad' : 'good'],
            [e ? `${e.eav.margin >= 0 ? '+' : '−'}${Math.abs(e.eav.margin).toFixed(0)}` : '…', 'dB', ['more than he needs', 'فائض عن حاجته'], e?.eav.ok ? 'bad' : 'good'],
            [area(st().areaU), this.w('m2'), ['danger zone outside', 'منطقة الخطر خارج المبنى'], 'bad'],
          ];
        },
        run: () => {
          baseline();
          app.setMode('attack');
          app.setView({ focus: 'all', explode: false });
          if (app.state.equipment !== 'usb') app.set({ equipment: 'usb' });
          const a = app.attacker.pos;
          if (Math.hypot(a[0] - CAFE[0], a[1] - CAFE[1]) > 2) app.walkTo(CAFE);
          app.setLayer('rays', true);
          app.cameraPreset('attacker', 2.4);
        },
      },
      {
        tone: 'green', legend: 'ghost', badges: true, action: true,
        title: () => ['Six layers of protection', 'ست طبقات من الحماية'],
        text: () => [
          'No single measure is enough, so they work together: shielding on the windows and the walls, two small ceiling access points instead of one loud one, the 5 GHz band, power lowered automatically, and WPA3 with protected management frames.',
          'لا يكفي إجراء واحد، لذلك تعمل معاً: عزل النوافذ والجدران، وراوتران صغيران في السقف بدل راوتر واحد عالي القدرة، ونطاق 5 GHz، وخفض القدرة تلقائياً، ثم WPA3 مع حماية إطارات الإدارة.',
        ],
        stats: () => [
          [area(st().areaU), this.w('m2'), ['danger zone outside', 'منطقة الخطر خارج المبنى'], (st().areaU ?? 1e9) < 1000 ? 'good' : 'bad'],
          [(st().coverage ?? 0).toFixed(0), '%', ['coverage inside', 'التغطية داخل المبنى'], (st().coverage ?? 0) >= 95 ? 'good' : 'warn'],
        ],
        run: () => {
          app.setMode('attack');
          app.setView({ focus: 'all', explode: false });
          app.setLayer('rays', false);
          app.cameraPreset('overview', 2.2);
        },
      },
      {
        tone: 'green', legend: 'ghost', last: true,
        title: () => {
          const r = reduction();
          return [`${r == null ? '' : '−' + r + ' % '}attack surface`, `سطح الهجوم ${r == null ? '' : iso('−' + r + '%')}`];
        },
        text: () => {
          const b = area(bs().areaU), n = area(st().areaU), c = (st().coverage ?? 0).toFixed(0);
          return [
            `The danger zone shrank from ${b} m² to ${n} m², the street is no longer exposed, and coverage inside stays at ${c} %. What is left is covered by WPA3 and 802.11w: no offline password cracking, no forced disconnects, no fake twin network.`,
            `انكمشت منطقة الخطر من ${iso(b)} م² إلى ${iso(n)} م²، ولم يعد الشارع مكشوفاً، وبقيت التغطية داخل المبنى ${iso(c + '%')}. وما تبقّى تحميه WPA3 و802.11w: لا كسر لكلمة المرور، ولا فصل قسري للأجهزة، ولا شبكة مزيّفة.`,
          ];
        },
        note: () => [
          'Checked with NVIDIA Sionna ray tracing: reflections leave more (about −88 %), which is why the protocol layer matters.',
          `تحقّقنا بتتبّع الأشعة (NVIDIA Sionna): الانعكاسات تُبقي أكثر (نحو ${iso('−88%')})، ولهذا طبقة البروتوكول ضرورية.`,
        ],
        stats: () => [
          [`${area(bs().areaU)} → ${area(st().areaU)}`, this.w('m2'), ['danger zone outside', 'منطقة الخطر خارج المبنى'], 'good'],
          [`${pct0(bs().street)} → ${pct0(st().street)}`, '%', ['street exposed', 'الشارع المكشوف'], 'good'],
          [(st().coverage ?? 0).toFixed(1), '%', ['coverage inside', 'التغطية داخل المبنى'], 'good'],
        ],
        run: async () => {
          app.setMode('attack');
          app.setView({ focus: 'all', explode: false });
          app.setLayer('rays', false);
          app.cameraPreset('overview', 2.2);
          if (!this.protectedAll()) await this.apply();
        },
      },
    ];
  }

  go(i) {
    this.i = Math.max(0, Math.min(this.steps.length - 1, i));
    this.render();
    Promise.resolve(this.steps[this.i].run()).then(() => this.render());
  }

  // ───────────── rendering ─────────────
  refresh() {
    if (this._raf || !this.on) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.renderCard(true); this.renderStatus(); });
  }

  render() {
    this.renderSteps();
    this.renderCard(false);
    this.renderStatus();
    const vb = document.getElementById('btn-view');
    if (vb) { vb.innerHTML = `<span class="ico">${icon(this.on ? 'sliders' : 'sparkles')}</span><span>${W.view[this.on ? 0 : 1][this.L]}</span>`; vb.title = W.view[this.on ? 0 : 1][this.L]; }
  }

  renderSteps() {
    this.$steps.innerHTML = W.steps.map((s, k) => `${k ? '<i class="conn"></i>' : ''}<button class="sstep ${k === this.i ? 'on' : k < this.i ? 'done' : ''}" data-step="${k}"><span class="n">${k < this.i ? icon('check') : k + 1}</span><span class="l">${s[this.L]}</span></button>`).join('');
  }

  legendHTML(kind) {
    if (kind === 'signal') {
      return `<div class="s-lg"><span class="s-lg-t">${this.w('lgSignal')}</span><span>${this.w('weak')}</span><i class="s-cbar"></i><span>${this.w('strong')}</span></div>`;
    }
    const sw = (c, k) => `<span class="s-sw"><i style="background:${c}"></i>${this.w(k)}</span>`;
    return `<div class="s-lg">${sw('var(--amber)', 'eav')}${sw('var(--orange)', 'deauth')}${sw('repeating-linear-gradient(45deg,var(--red) 0 4px,#c0173d 4px 7px)', 'et')}${kind === 'ghost' && this.app.anyProtection() ? `<span class="s-sw"><i class="dash"></i>${this.w('before')}</span>` : ''}</div>`;
  }

  renderCard(soft) {
    const s = this.steps[this.i], L = this.L;
    const stats = s.stats().map(([v, u, lbl, tone]) => `<div class="s-stat ${tone}"><div class="s-v"><b class="num">${v}</b><span>${u}</span></div><div class="s-l">${lbl[L]}</div></div>`).join('');
    if (soft && this.$card.dataset.step === String(this.i) && this.$card.dataset.lang === String(L)) {
      // live update: numbers, text and badges only (no re-layout of the buttons)
      this.$card.querySelector('.s-title').innerHTML = s.title()[L];
      this.$card.querySelector('.s-text').innerHTML = s.text()[L];
      this.$card.querySelector('.s-stats').innerHTML = stats;
      const lg = this.$card.querySelector('.s-lg-wrap');
      if (lg) lg.innerHTML = this.legendHTML(s.legend);
      for (const b of this.$card.querySelectorAll('[data-badge]')) b.classList.toggle('on', this.badgeOn(b.dataset.badge));
      return;
    }
    const badges = s.badges ? `<div class="s-badges">${BADGES.map(([k, ic, lbl]) => `<span class="s-badge ${this.badgeOn(k) ? 'on' : ''}" data-badge="${k}"><span class="ico">${icon(ic)}</span>${lbl[L]}<span class="tick ico">${icon('check')}</span></span>`).join('')}</div>` : '';
    const done = this.protectedAll();
    const action = s.action
      ? `<button class="btn shield s-apply ${done ? 'done' : ''}" data-s="apply" ${this.applying || done ? 'disabled' : ''}><span class="ico">${icon(done ? 'check' : 'shieldCheck')}</span>${this.w(this.applying ? 'applying' : done ? 'applied' : 'apply')}</button>`
      : '';
    const nav = `
      ${this.i > 0 ? `<button class="btn s-nav" data-s="back"><span class="ico flip-back">${icon('arrow')}</span>${this.w('back')}</button>` : ''}
      ${s.last
        ? `<button class="btn primary s-nav" data-s="again"><span class="ico">${icon('reset')}</span>${this.w('again')}</button>`
        : `<button class="btn primary s-nav" data-s="next">${this.w('next')}<span class="ico flip">${icon('arrow')}</span></button>`}`;
    this.$card.dataset.step = String(this.i);
    this.$card.dataset.lang = String(L);
    this.$card.dataset.tone = s.tone;
    this.$card.innerHTML = `
      <div class="s-top"><span class="s-eyebrow">${W.stepOf[L].replace('{i}', this.i + 1)}</span><div class="s-lg-wrap">${this.legendHTML(s.legend)}</div></div>
      <h2 class="s-title">${s.title()[L]}</h2>
      <p class="s-text">${s.text()[L]}</p>
      ${badges}
      <div class="s-stats">${stats}</div>
      ${s.note ? `<p class="s-note">${s.note()[L]}</p>` : ''}
      <div class="s-foot">${s.hint ? `<span class="s-hint">${this.w('hint')}</span>` : '<span></span>'}<div class="s-btns">${action}${nav}</div></div>`;
    this.$card.classList.remove('enter');
    void this.$card.offsetWidth;
    this.$card.classList.add('enter');
  }

  renderStatus() {
    const ev = this.app.ev, s = this.app.stats, b = this.app.baseStats;
    if (!ev) return;
    const chip = (k, ok, blocked) => `<span class="st-chip ${ok ? 'on' : blocked ? 'blocked' : 'off'}" data-k="${k}">${ok ? icon('alert') : blocked ? icon('lock') : ''}${this.w(k)}</span>`;
    const anyActive = ev.deauth.ok || ev.evilTwin.ok;
    const encOnly = ev.eav.ok && !anyActive && this.app.state.wpa3;
    const lvl = !ev.eav.ok ? 'safe' : encOnly ? 'enc' : 'danger';
    const head = { safe: this.w('stSafe'), enc: this.w('stEnc'), danger: this.w('stDanger') }[lvl];
    const rel = s && b && b.areaU ? Math.min(100, (100 * s.areaU) / b.areaU) : 100;
    const red = s && b && b.areaU ? Math.round((1 - s.areaU / b.areaU) * 100) : 0;
    this.$status.dataset.lvl = lvl;
    this.$status.innerHTML = `
      <div class="st-head"><span class="st-dot ico">${icon(lvl === 'safe' ? 'shieldCheck' : lvl === 'enc' ? 'lock' : 'alert')}</span><b>${head}</b></div>
      <div class="st-chips">${chip('eav', ev.eav.ok && !encOnly, encOnly)}${chip('deauth', ev.deauth.ok, ev.deauth.blocked && ev.clients.some((c) => c.deauthM >= 0))}${chip('et', ev.evilTwin.ok, ev.evilTwin.blocked && ev.clients.some((c) => c.etM >= 0))}</div>
      <div class="st-zone"><span>${this.w('stZone')}</span><b class="num">${area(s?.areaU)} <small>${this.w('m2')}</small></b>${red > 0 ? `<em class="num">−${red}%</em>` : ''}</div>
      <div class="st-bar"><span style="width:${rel}%"></span></div>`;
  }
}

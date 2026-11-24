// Guided demo: a scripted walkthrough used live in the presentation.
// Each step sets the scene (camera, layers, protections) and narrates with live numbers.
import { t } from './i18n.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const f1 = (x) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(0);
const area = (m2) => Math.round(m2).toLocaleString('en-US');

function steps(app) {
  const ev = () => app.ev;
  const st = () => app.stats ?? {};
  const base = () => app.baseStats ?? {};
  const pct = () => (base().areaU ? Math.round((1 - st().areaU / base().areaU) * 100) : 0);
  return [
    {
      title: ['A digital twin of Block C', 'توأم رقمي للمبنى C'],
      text: [
        () => `A three-storey faculty building with its street, café, parking and neighbours, rebuilt in 3-D from one data file. The department's Wi-Fi access point hangs on the <b>first floor</b> — right next to a window that faces <b>University Street</b>.`,
        () => `مبنى كلية من ثلاثة طوابق مع الشارع والمقهى والموقف والمباني المجاورة، مبنيّ ثلاثي الأبعاد من ملف بيانات واحد. راوتر القسم معلّق في <b>الطابق الأول</b> بجانب نافذة تطلّ على <b>شارع الجامعة</b>.`,
      ],
      run: async () => { app.resetAll(true); app.setMode('signal'); app.setView({ focus: 'all', explode: false }); app.cameraPreset('overview', 2.6); },
    },
    {
      title: ['How the signal travels inside', 'كيف تنتشر الإشارة داخل المبنى'],
      text: [
        () => `Every wall costs decibels: drywall ≈ <b>3 dB</b>, brick ≈ <b>6</b>, concrete ≈ <b>15–17</b>, steel ≈ <b>26</b>, each floor slab ≈ <b>18</b>. The GPU evaluates this multi-wall model with 3-D wall, window and slab intersections for ~<b>200 000 points</b> in milliseconds.`,
        () => `كل جدار يكلّف ديسيبلات: الجبس ≈ <b>3 dB</b>، الطوب ≈ <b>6</b>، الخرسانة ≈ <b>15–17</b>، الفولاذ ≈ <b>26</b>، وكل بلاطة طابق ≈ <b>18</b>. كرت الشاشة يحسب هذا النموذج متعدّد الجدران مع تقاطعات ثلاثية الأبعاد للجدران والنوافذ والبلاطات لنحو <b>200 ألف نقطة</b> في أجزاء من الثانية.`,
      ],
      run: async () => { app.setMode('signal'); app.cameraPreset('floor', 2.4); },
    },
    {
      title: ['…and how it leaks outside', '…وكيف تتسرّب إلى الخارج'],
      text: [
        () => `Towards the street there is only one exterior wall — and much of it is glass. The colours show the received power at hand height; the signal still reaches the far side of the street and beyond.`,
        () => `باتجاه الشارع لا يوجد إلا جدار خارجي واحد، ومعظمه زجاج. الألوان تُظهر القدرة المستقبَلة على ارتفاع اليد؛ والإشارة تصل إلى الرصيف المقابل وما بعده.`,
      ],
      run: async () => { app.setView({ focus: 'all', explode: false }); app.setMode('signal'); app.cameraPreset('top', 2.6); },
    },
    {
      title: ['From signal to attack surface', 'من الإشارة إلى سطح الهجوم'],
      text: [
        () => `Now the map answers a security question: <span class="a">amber</span> — an attacker can capture traffic and the WPA2 handshake; <span style="color:#ff8a00;font-weight:700">orange</span> — he can forge deauthentication frames; <span class="r">red</span> — his rogue AP out-shouts the real one for some devices (<b>Evil Twin</b>). Danger zone: <b>${area(st().areaU)} m²</b>.`,
        () => `الآن تجيب الخريطة عن سؤال أمني: <span class="a">الأصفر</span> — يستطيع المهاجم التقاط البيانات ومصافحة WPA2؛ <span style="color:#ff8a00;font-weight:700">البرتقالي</span> — يستطيع تزوير إطارات Deauth؛ <span class="r">الأحمر</span> — نقطته المزيّفة تتفوّق على الحقيقية لبعض الأجهزة (<b>Evil Twin</b>). مساحة منطقة الخطر: <b>${area(st().areaU)} م²</b>.`,
      ],
      run: async () => { app.setMode('attack'); app.cameraPreset('overview', 2.4); },
    },
    {
      title: ['Meet the attacker', 'تعرّف على المهاجم'],
      text: [
        () => `He sits on the café terrace across the street with a USB Wi-Fi adapter. The ray shows the direct path and every wall it crosses. He receives <b>${ev()?.rss.toFixed(0)} dBm</b> — a margin of <span class="r">${f1(ev()?.eav.margin ?? 0)} dB</span> above what his adapter needs. All three attacks are feasible.`,
        () => `يجلس في المقهى المقابل ومعه محوّل Wi‑Fi عبر USB. الشعاع يُظهر المسار المباشر وكل جدار يخترقه. يستقبل <b>${ev()?.rss.toFixed(0)} dBm</b> — أي بهامش <span class="r">${f1(ev()?.eav.margin ?? 0)} dB</span> فوق ما يحتاجه جهازه. الهجمات الثلاثة ممكنة.`,
      ],
      run: async () => { app.setMode('attack'); app.setView({ focus: 'all', explode: false }); app.walkTo([1.0, -30.8]); app.set({ equipment: 'usb' }); app.cameraPreset('street', 2.4); },
    },
    {
      title: ['Evil Twin — inside view', 'التوأم الشرير — من الداخل'],
      text: [
        () => `<span style="color:#b14cff;font-weight:700">Purple</span> marks where devices on floor 1 would rather join his rogue AP (${(app.hijack ?? 0).toFixed(0)} % of the floor). Red diamonds are devices he can capture, orange ones he can knock offline.`,
        () => `<span style="color:#b14cff;font-weight:700">البنفسجي</span> يحدّد أين تفضّل أجهزة الطابق الأول الاتصال بنقطته المزيّفة (${(app.hijack ?? 0).toFixed(0)}% من الطابق). المعيّنات الحمراء أجهزة يستطيع الاستيلاء عليها، والبرتقالية يستطيع فصلها.`,
      ],
      run: async () => { app.setMode('attack'); app.cameraPreset('floor', 2.4); },
    },
    {
      title: ['Protection 1 — shield the façade', 'الحماية 1 — عزل الواجهة'],
      text: [
        () => `Metallised <b>RF-shielding window film</b> (+25 dB) and <b>conductive paint</b> (+20 dB) on the exterior. The dashed white line is where the zone used to end. Danger zone now <span class="g">−${pct()} %</span>.`,
        () => `<b>غشاء عازل للنوافذ</b> (+25 dB) و<b>دهان موصل</b> (+20 dB) على الواجهة الخارجية. الخط الأبيض المتقطع هو حدّ المنطقة قبل الحماية. منطقة الخطر الآن <span class="g">−${pct()}%</span>.`,
      ],
      run: async () => {
        app.setMode('attack'); app.cameraPreset('overview', 2.2);
        await wait(900); if (!app.state.shieldWindows) app.toggleProtection('shieldWindows');
        await wait(1500); if (!app.state.shieldPaint) app.toggleProtection('shieldPaint');
      },
    },
    {
      title: ['Protection 2 — micro-cells instead of one loud AP', 'الحماية 2 — خلايا صغيرة بدل راوتر واحد عالٍ'],
      text: [
        () => `Moving the AP away from the window helps, but a single AP behind the concrete stair core leaves rooms uncovered. Two <b>ceiling micro-cells</b> cover the whole floor (<span class="g">${(st().coverage ?? 0).toFixed(0)} %</span>) — at full power they still leak, but now there is coverage to spare, so the power can be cut in the next step. (If an AP must stay at a window, a <b>directional antenna</b> aimed inwards — back lobe −30 dB — is the alternative.)`,
        () => `نقل الراوتر بعيداً عن النافذة يساعد، لكن راوتراً واحداً خلف نواة الدرج الخرسانية يترك غرفاً بلا تغطية. <b>خليّتان صغيرتان في السقف</b> تغطّيان الطابق كاملاً (<span class="g">${(st().coverage ?? 0).toFixed(0)}%</span>) — وبالقدرة الكاملة ما زالتا تسرّبان، لكن صار لدينا فائض في التغطية يسمح بخفض القدرة في الخطوة التالية. (وإن لزم بقاء الراوتر عند النافذة فالبديل <b>هوائي اتجاهي</b> موجّه للداخل — فصّه الخلفي −30 dB.)`,
      ],
      run: async () => {
        app.cameraPreset('overview', 2);
        await wait(700); if (app.state.mount !== 'ceiling') app.toggleProtection('relocate');
        await wait(1800); if (app.state.mount !== 'micro') app.toggleProtection('microcells');
      },
    },
    {
      title: ['Protection 3 — band & power', 'الحماية 3 — النطاق والقدرة'],
      text: [
        () => `<b>5 GHz</b> loses more in air and in every wall. Then the TX power is <b>auto-tuned</b> to the minimum that still covers 95 % of the floor: now <b>${app.state.txDbm} dBm</b>, indoor coverage <span class="g">${(st().coverage ?? 0).toFixed(0)} %</span>.`,
        () => `نطاق <b>5 GHz</b> يفقد أكثر في الهواء وفي كل جدار. ثم تُضبط القدرة <b>تلقائياً</b> على أقل قيمة تحافظ على تغطية 95% من الطابق: الآن <b>${app.state.txDbm} dBm</b>، والتغطية الداخلية <span class="g">${(st().coverage ?? 0).toFixed(0)}%</span>.`,
      ],
      run: async () => {
        await wait(400); if (app.state.freq < 4) app.toggleProtection('band5');
        await wait(1600); await app.optimizePower();
      },
    },
    {
      title: ['Protocol layer — defence in depth', 'طبقة البروتوكول — الدفاع المتعدّد'],
      text: [
        () => `Radio measures shrink <i>where</i> an attack can happen; protocol measures change <i>what</i> it can do. <b>802.11w PMF</b> makes forged deauth frames useless and <b>WPA3-SAE</b> stops offline password cracking and rogue clones. What still leaks is only encrypted noise.`,
        () => `إجراءات الطبقة الراديوية تقلّص <i>مكان</i> الهجوم، وإجراءات البروتوكول تغيّر <i>ما يستطيعه</i>. <b>802.11w</b> يجعل إطارات Deauth المزوّرة بلا أثر، و<b>WPA3-SAE</b> يمنع كسر كلمة المرور دون اتصال واستنساخ الشبكة. ما يتسرّب بعد ذلك ضجيج مشفّر فقط.`,
      ],
      run: async () => {
        app.cameraPreset('street', 2.2);
        await wait(900); if (!app.state.pmf) app.toggleProtection('pmf');
        await wait(1100); if (!app.state.wpa3) app.toggleProtection('wpa3');
      },
    },
    {
      title: ['Result', 'النتيجة'],
      text: [
        () => `Danger zone <b>${area(base().areaU)} → ${area(st().areaU)} m²</b> (<span class="g">−${pct()} %</span>), street exposure <b>${(base().street ?? 0).toFixed(0)} % → ${(st().street ?? 0).toFixed(0)} %</b>, while indoor coverage stays at <span class="g">${(st().coverage ?? 0).toFixed(0)} %</span>. Your turn: drag the attacker, move the AP, switch protections on and off.`,
        () => `منطقة الخطر <b>${area(base().areaU)} ← ${area(st().areaU)} م²</b> (<span class="g">−${pct()}%</span>)، وتعرّض الشارع <b>${(base().street ?? 0).toFixed(0)}% ← ${(st().street ?? 0).toFixed(0)}%</b>، مع بقاء التغطية الداخلية <span class="g">${(st().coverage ?? 0).toFixed(0)}%</span>. جرّب بنفسك: حرّك المهاجم والراوتر، وشغّل الحمايات وأطفئها.`,
      ],
      run: async () => { app.setMode('attack'); app.cameraPreset('overview', 2.4); },
    },
    {
      title: ['Validation with NVIDIA Sionna RT', 'التحقّق باستخدام NVIDIA Sionna RT'],
      when: () => app.sionna.available,
      text: [
        () => `The same geometry, ray-traced with <b>Sionna RT</b> (reflection + transmission on ITU-R P.2040 materials). Switch between <b>Sionna RT</b> and <b>Δ Sionna</b> at the top to compare the physics reference with the real-time model.`,
        () => `المجسّم نفسه بتتبّع الأشعة في <b>Sionna RT</b> (انعكاس واختراق على مواد ITU-R P.2040). بدّل بين <b>Sionna RT</b> و<b>الفرق مع Sionna</b> في الأعلى لمقارنة المرجع الفيزيائي بالنموذج اللحظي.`,
      ],
      run: async () => { app.resetAll(true); app.setMode('sionna'); app.cameraPreset('top', 2.4); },
    },
  ];
}

export class Tour {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('tour');
    this.i = -1;
    window.addEventListener('keydown', (e) => {
      if (this.i < 0) return;
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); this.app.state.lang === 'ar' && e.key === 'ArrowRight' ? this.prev() : this.next(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); this.app.state.lang === 'ar' && e.key === 'ArrowLeft' ? this.next() : this.prev(); }
      else if (e.key === 'Escape') this.stop();
    });
  }
  get list() { return (this._list ??= steps(this.app)).filter((s) => !s.when || s.when()); }

  start() {
    this.i = -1;
    document.body.classList.add('touring');
    this.el.hidden = false;
    this.next();
  }
  stop() {
    this.i = -1;
    this.el.hidden = true;
    document.body.classList.remove('touring');
  }
  async go(i) {
    const L = this.list;
    if (i < 0 || i >= L.length) return;
    this.i = i;
    const step = L[i];
    this.render();
    clearInterval(this.refresh);
    await step.run?.();
    // keep live numbers fresh while the step animates
    let n = 0;
    this.refresh = setInterval(() => { this.render(); if (++n > 12) clearInterval(this.refresh); }, 450);
  }
  next() { if (this.i >= this.list.length - 1) return this.stop(); this.go(this.i + 1); }
  prev() { this.go(Math.max(0, this.i - 1)); }

  render() {
    if (this.i < 0) return;
    const L = this.list, s = L[this.i], ar = this.app.state.lang === 'ar';
    const k = ar ? 1 : 0;
    const last = this.i === L.length - 1;
    this.el.innerHTML = `<div class="tour-card">
      <div class="tour-top"><span class="tour-step">${this.i + 1} / ${L.length}</span><h3 class="tour-title">${s.title[k]}</h3></div>
      <p class="tour-text">${s.text[k]()}</p>
      <div class="tour-foot">
        <div class="tour-dots">${L.map((_, j) => `<i class="${j === this.i ? 'on' : j < this.i ? 'done' : ''}"></i>`).join('')}</div>
        <button class="btn small ghost" data-t="exit">${t('tour.exit', this.app.state.lang)}</button>
        <button class="btn small" data-t="prev" ${this.i === 0 ? 'disabled' : ''}>${t('tour.prev', this.app.state.lang)}</button>
        <button class="btn small primary" data-t="next">${t(last ? 'tour.done' : 'tour.next', this.app.state.lang)}</button>
      </div></div>`;
    this.el.onclick = (e) => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      ({ exit: () => this.stop(), prev: () => this.prev(), next: () => this.next() })[b.dataset.t]();
    };
  }
}

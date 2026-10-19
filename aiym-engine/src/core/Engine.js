import { EventBus } from './EventBus.js';
import { Config } from './Config.js';
import { ModuleRegistry } from './ModuleRegistry.js';
import { textToVisemes } from './lipsync.js';
import { Avatar } from '../avatar/Avatar.js';
import { Shell } from '../ui/Shell.js';
import { SpeechSim } from './SpeechSim.js';
import { Diagnostics } from './Diagnostics.js';
import { DEFAULT_DISPLAY, LEGACY_DISPLAY, variants, mentions, spoken, summons } from './Names.js';
import { commandOf, stopAck } from './Commands.js';

export const ENGINE_VERSION = '0.1.0';
// имена персонажей и их написания по языкам — в Names.js

// Качество графики: разрешение рендера (множитель и потолок), сглаживание. Меняется перезагрузкой страницы.
export const QUALITY = {
  high: { ratio: 2, max: [2560, 1440], aa: true },
  medium: { ratio: 1.25, max: [1920, 1080], aa: true },
  eco: { ratio: 1, max: [1280, 720], aa: false },
};

export class Engine {
  bus = new EventBus();
  util = { lipsync: { textToVisemes } };
  #frameCbs = new Set();

  async boot() {
    let base = {};
    try { const r = await fetch('config/engine.json', { cache: 'no-store' }); if (r.ok) base = await r.json(); } catch { /* файл необязателен */ }
    this.config = new Config(base);

    this.ui = new Shell(this);
    const q = QUALITY[this.config.get('avatar.quality', 'medium')] ?? QUALITY.medium;
    this.avatar = new Avatar(this.ui.avatarMount, { pixelRatioMax: this.config.get('avatar.renderRatio', q.ratio), maxRender: this.config.get('avatar.renderMax', q.max), antialias: q.aa, gender: this.config.get('avatar.gender', 'female') });
    this.#syncName();
    this.avatar.setOptions({ idle: this.config.get('avatar.idle', true), physics: this.config.get('avatar.physics', true), guides: this.config.get('avatar.guides', false), mosquito: this.config.get('avatar.mosquito', true), mosquitoSound: this.config.get('avatar.mosquitoSound', true) });
    this.config.onChange((path, v) => {
      if (path === 'avatar.gender') { this.#genderAt = performance.now(); this.#swapAvatar(v); this.#syncName(); this.bus.emit('avatar.gender', { gender: v }); }
      if (path === 'avatar.quality') setTimeout(() => location.reload(), 200);          // разрешение и сглаживание применяются при старте
      if (path === 'avatar.idle') this.avatar.setOptions({ idle: v });
      if (path === 'avatar.physics') this.avatar.setOptions({ physics: v });
      if (path === 'avatar.mosquito') this.avatar.setOptions({ mosquito: v });
      if (path === 'avatar.mosquitoSound') this.avatar.setOptions({ mosquitoSound: v });
      if (path === 'avatar.guides') this.avatar.setOptions({ guides: v });
    });

    this.diagnostics = new Diagnostics(this);
    this.bus.on('hearing.transcript', (p) => this.#onHeard(p));          // раньше всех модулей: переключение персонажа до ответа «Мозга»
    this.speechSim = new SpeechSim(this);
    this.modules = new ModuleRegistry(this);
    await this.modules.loadAll('src/modules/manifest.json');
    await this.#autoUpdateModules();
    this.ui.buildSettings();
    this.#loop();
    this.bus.emit('engine.ready', { version: ENGINE_VERSION });
    await this.modules.startEnabled();
  }

  // ───────── Имена: у каждого персонажа своё (редактируется в настройках), плюс написания по языкам для синтеза речи ─────────
  #names() {
    const n = { ...DEFAULT_DISPLAY, ...(this.config.get('assistant.names', null) ?? {}) };
    for (const g of ['female', 'male']) if (!n[g] || LEGACY_DISPLAY.includes(n[g])) n[g] = DEFAULT_DISPLAY[g];
    return n;
  }

  #syncName() {
    const g = this.config.get('avatar.gender', 'female'), names = this.#names();
    if (!this.config.get('assistant.names', null)) {                        // перенос своего имени из прежней версии — текущему персонажу
      const old = this.config.get('assistant.name', '');
      if (old && !LEGACY_DISPLAY.includes(old) && !Object.values(DEFAULT_DISPLAY).includes(old)) names[g] = old;
    }
    const cur = names[g];
    this.config.set('assistant.names', names); this.config.set('assistant.name', cur);
    this.config.set('assistant.spoken', { kk: spoken(g, cur, 'kk'), ru: spoken(g, cur, 'ru'), en: spoken(g, cur, 'en') });   // как произносить имя на каждом языке
    this.config.set('assistant.variants', variants(g, cur));
    this.config.set('assistant.allVariants', [...variants('female', names.female), ...variants('male', names.male)]);        // оба персонажа: для подстановки имени в свой текст характера
    const el = document.querySelector('#name'); if (el) el.textContent = cur;
  }

  /** Сменить имя текущего персонажа (поле «Имя» в настройках). */
  setName(value) {
    value = String(value ?? '').trim(); if (!value) return;
    const g = this.config.get('avatar.gender', 'female');
    this.config.set('assistant.names', { ...this.#names(), [g]: value });
    this.#syncName();
  }

  // Обращение по имени: назвали другого персонажа — он «выходит» (переключаем) и отвечает; помечаем реплику, чтобы «Мозг» знал, что обратились
  #lastStop = -99; #genderAt = -1e9;
  #onHeard(p) {
    if (!p?.text) return;
    // «стоп» / «остановись» / «тоқта» / «не то»: сразу прерываем речь и генерацию (работает и пока она говорит сама)
    const cmd = commandOf(p.text);
    if (cmd) {
      p.command = cmd;
      if (performance.now() - this.#lastStop > 700) {                    // один и тот же «стоп» из нескольких окон — реагируем один раз
        this.#lastStop = performance.now();
        const lang = p.lang || (/[әіңғүұқөһ]/i.test(p.text) ? 'kk' : /[а-яё]/i.test(p.text) ? 'ru' : 'en');
        this.bus.emit('assistant.stop', { reason: cmd, text: p.text });
        this.bus.emit('speech.stop', {});
        this.avatar.trigger('nod');
        if (cmd === 'stop') this.ui.setCaption(stopAck(lang, this.config.get('avatar.gender', 'female')), { role: 'assistant', hold: 2 });
      }
      if (cmd === 'stop') p.handled = true;                                // чистое «стоп» модели не отправляем
    } else if (p.selfSpeaking) p.ignore = true;                           // услышано во время её речи и не команда — скорее всего эхо
    if (!p.final || p.ignore) return;
    const g = this.config.get('avatar.gender', 'female'), names = this.#names();
    p.addressed = mentions(p.text, g, names[g]) || mentions(p.text, g === 'female' ? 'male' : 'female', names[g === 'female' ? 'male' : 'female'], 3);
    const to = !p.selfSpeaking && this.config.get('assistant.switchByName', true) ? summons(p.text, names) : null;        // только «позови …», а не просто имя
    if (to && to !== g && performance.now() - this.#genderAt > 2500) {
      this.bus.emit('assistant.switch', { from: g, to, text: p.text });
      this.ui.toast(`Позвали «${names[to]}» — меняемся`);
      this.config.set('avatar.gender', to); p.switchedTo = to; p.addressed = true;
    } else if (to === g) p.addressed = true;
  }

  // Смена персонажа: старый растворяется, новый проявляется
  #swapTok = 0;
  #swapAvatar(g) {
    const cv = this.avatar.renderer?.domElement ?? this.ui.avatarMount.querySelector('canvas'), tok = ++this.#swapTok;
    if (!cv || this.avatar.gender === g) { this.avatar.setGender(g); return; }
    cv.style.transition = 'opacity .35s ease'; cv.style.opacity = '0';
    setTimeout(() => {
      if (tok !== this.#swapTok) return;
      this.avatar.setGender(g); cv.style.opacity = '1';
    }, 380);
  }

  // Модули из папки движка (Слух, Зрение, Речь, Мозг) обновляются сами, если на сервере версия новее: кнопку «Обновить» жать не нужно
  async #autoUpdateModules() {
    const ver = (t) => t.match(/version:\s*'([\d.]+)'/)?.[1];
    const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
    for (const e of [...this.modules.entries.values()]) {
      if (e.source !== 'user' || !e.dist) continue;
      try {
        const text = await (await fetch(e.dist, { cache: 'no-store' })).text(), v = ver(text);
        if (!v || !e.version || !newer(v, String(e.version))) continue;
        await this.modules.installFiles([new File([text], e.dist.split('/').pop(), { type: 'text/javascript' })]);
        this.ui.toast(`Модуль «${e.name}» обновлён до v${v}`);
      } catch { /* нет связи с сервером или файла нет — остаёмся на установленной версии */ }
    }
  }

  onFrame(fn) { this.#frameCbs.add(fn); return () => this.#frameCbs.delete(fn); }

  #loop() {
    let last = performance.now();
    const tick = (now) => {
      // ограничение кадров: по умолчанию 30 (вдвое легче для видеокарты), в фоне (окно без фокуса, например игра) — 12
      const cfg = this.config, bg = cfg.get('avatar.saveInBackground', true) && !document.hasFocus();
      const limit = bg ? 12 : cfg.get('avatar.fpsLimit', 30);
      if (limit > 0 && now - last < 1000 / limit - 2) { requestAnimationFrame(tick); return; }
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const t = now / 1000;
      for (const fn of this.#frameCbs) { try { fn(dt, t); } catch (e) { console.error('[frame]', e); } }
      this.avatar.update(dt, t);
      this.avatar.render();
      this.ui.frame(dt, t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

// Диагностика: одна кнопка собирает ВСЁ состояние ассистента в текст (модули, настройки, сервисы, устройства, лог).
// Нужна, чтобы просто прислать отчёт разработчику, ничего не объясняя.
const ring = [];                          // лог консоли и ошибок с момента загрузки страницы
const T0 = Date.now();
const stamp = () => new Date().toTimeString().slice(0, 8) + '.' + String(Date.now() % 1000).padStart(3, '0');
const short = (v, n = 400) => { let s; try { s = typeof v === 'string' ? v : v instanceof Error ? `${v.name}: ${v.message}` : JSON.stringify(v); } catch { s = String(v); } return (s ?? '').length > n ? s.slice(0, n) + '…' : s; };
const push = (lvl, ...args) => { ring.push(`${stamp()} ${lvl} ${args.map((a) => short(a)).join(' ')}`); if (ring.length > 400) ring.shift(); };

/** Вызвать как можно раньше (до запуска движка): начинает записывать console и ошибки. */
export function installLogCapture() {
  for (const lvl of ['log', 'info', 'warn', 'error']) {
    const orig = console[lvl].bind(console);
    console[lvl] = (...a) => { push(lvl.toUpperCase(), ...a); orig(...a); };
  }
  addEventListener('error', (e) => push('ERROR', `${e.message} (${(e.filename ?? '').split('/').pop()}:${e.lineno})`));
  addEventListener('unhandledrejection', (e) => push('REJECT', e.reason));
}

const SECRET = /key|token|secret|password|auth/i;
const redact = (o) => JSON.parse(JSON.stringify(o ?? {}, (k, v) => (SECRET.test(k) && v ? '***скрыто***' : v)));
const timeout = (ms) => AbortSignal.timeout(ms);

export class Diagnostics {
  events = [];
  constructor(engine) {
    this.e = engine;
    engine.bus.on('*', (p, name) => {
      if (/^(hearing\.level|hearing\.speaker|vision\.faces|vision\.speaker|camera\.)/.test(name)) return;   // слишком частые
      this.events.push(`${stamp()} ${name} ${short(p, 120)}`); if (this.events.length > 120) this.events.shift();
    });
    const toast = engine.ui.toast.bind(engine.ui);                       // плашки-уведомления тоже в отчёт
    engine.ui.toast = (text, kind, ms) => { push(kind === 'err' ? 'TOAST-ERR' : 'TOAST', text); toast(text, kind, ms); };
  }

  async #probe(name, url, init = {}) {
    const t = performance.now();
    try {
      const r = await fetch(url, { ...init, signal: timeout(3000) });
      let body = ''; try { body = short(await r.text(), 300); } catch { /* ignore */ }
      return `${name}: ${r.ok ? 'OK' : 'ОШИБКА'} HTTP ${r.status} за ${Math.round(performance.now() - t)} мс — ${body}`;
    } catch (e) { return `${name}: НЕТ СВЯЗИ (${e.name}: ${e.message}) — ${url}`; }
  }

  async #fps() {
    return new Promise((res) => { let n = 0; const off = this.e.onFrame(() => n++); setTimeout(() => { off(); res(n); }, 1500); });
  }

  async collect() {
    const e = this.e, cfg = e.config, L = [];
    const sec = (t) => L.push('', `## ${t}`);
    L.push('# Отчёт диагностики ассистента Адина', `Время: ${new Date().toString()}`, `Работает со старта страницы: ${Math.round((Date.now() - T0) / 1000)} с`);

    sec('Система');
    const gl = (() => { try { const g = e.avatar.renderer.getContext(); const x = g.getExtension('WEBGL_debug_renderer_info'); return x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); } catch { return '?'; } })();
    L.push(`Браузер: ${navigator.userAgent}`, `Платформа: ${navigator.platform}, ядер CPU: ${navigator.hardwareConcurrency}, память: ${navigator.deviceMemory ?? '?'} ГБ`,
      `Экран: ${screen.width}x${screen.height}, окно: ${innerWidth}x${innerHeight}, масштаб: ${devicePixelRatio}`, `Видеокарта (WebGL): ${gl}`,
      `Персонаж: ${e.avatar.gender === 'male' ? 'парень' : 'девушка'}, имя: ${cfg.get('assistant.name')}, произношение: ${short(cfg.get('assistant.spoken'), 120)}`, `Рендер: ${e.avatar.renderer.domElement.width}x${e.avatar.renderer.domElement.height}, лимит кадров: ${cfg.get('avatar.fpsLimit', 30)}, качество: ${cfg.get('avatar.quality', 'medium')}`,
      `Фокус окна: ${document.hasFocus() ? 'да' : 'НЕТ (тогда 12 к/с)'}`, `Безопасный контекст: ${isSecureContext}`, `Адрес страницы: ${location.href}`);
    const frames = await this.#fps(); L.push(`Реальный FPS движка: ${(frames / 1.5).toFixed(1)}`);

    sec('Модули');
    for (const m of e.modules.entries.values()) L.push(`- ${m.id} «${m.name}» v${m.meta?.version ?? '?'}: ${m.state}${m.enabled === false ? ' (выключен)' : ''}${m.error ? `  ОШИБКА: ${short(m.error, 300)}` : ''}${m.loadMs != null ? `  (запуск ${Math.round(m.loadMs)} мс)` : ''}`);

    sec('Что видно на экране (статусы и подсказки панелей)');
    L.push(...[...document.querySelectorAll('.chip, #drawer .hint, .drawer .hint')].map((n) => n.textContent.trim()).filter(Boolean).map((t) => `- ${t}`));

    sec('Сервисы');
    L.push(await this.#probe('Сервер движка /api/voices (Piper)', '/api/voices'));
    const hc = cfg.get('modules.hearing.config', {}), bc = cfg.get('modules.brain.config', {});
    L.push(`Слух: режим=${hc.sttMode ?? 'browser (по умолчанию)'}, язык=${hc.lang ?? 'ru-RU'}, встроенное распознавание браузера: ${globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition ? 'есть' : 'НЕТ'}`);
    L.push(await this.#probe('Whisper', `${(hc.sttUrl ?? 'http://localhost:8000/v1').replace(/\/+$/, '')}/models`));
    L.push(await this.#probe('Whisper журнал (последние строки и ошибки сервера)', `${(hc.sttUrl ?? 'http://localhost:8000/v1').replace(/\/+$/, '')}/log`));
    L.push(`Мозг: модель=${bc.model ?? 'auto (из LM Studio)'}`);
    L.push(await this.#probe('LLM-сервер', `${(bc.url ?? 'http://localhost:1235/v1').replace(/\/+$/, '')}/models`, bc.apiKey ? { headers: { Authorization: `Bearer ${bc.apiKey}` } } : {}));

    sec('Устройства и разрешения');
    for (const n of ['camera', 'microphone']) { try { L.push(`Разрешение ${n}: ${(await navigator.permissions.query({ name: n })).state}`); } catch { L.push(`Разрешение ${n}: ?`); } }
    try { const d = await navigator.mediaDevices.enumerateDevices(); for (const x of d.filter((q) => q.kind !== 'audiooutput')) L.push(`- ${x.kind}: ${x.label || '(название скрыто — нет разрешения)'}`); } catch (er) { L.push(`Устройства: ${er.message}`); }

    sec('Аватар');
    const s = e.avatar.s;
    L.push(`Эмоция (цель): ${short(Object.fromEntries(Object.entries(s.emoTarget).map(([k, v]) => [k, +v.toFixed(2)])), 300)}`, `Жест руки: ${s.armG?.name ?? 'нет'}; речь: ${s.speech.toFixed(2)}; внимание: ${(s.t - s.gaze.set) < 2.5 ? 'да' : 'нет'}`,
      `Комар: ${e.avatar.mosquito.phase}; опции: ${short(e.avatar.opts, 200)}`);

    sec('Настройки (ключи скрыты)');
    L.push('```json', JSON.stringify(redact(cfg.dump?.() ?? {}), null, 1), '```');

    sec('Последние события шины');
    L.push(...(this.events.length ? this.events.slice(-60) : ['(нет)']));

    sec('Лог консоли и ошибки (последние 150)');
    L.push(...(ring.length ? ring.slice(-150) : ['(пусто)']));
    return L.join('\n');
  }

  async copy() {
    const text = await this.collect();
    try { await navigator.clipboard.writeText(text); this.e.ui.toast('Отчёт скопирован — вставьте его в чат (Ctrl+V)'); }
    catch { this.download(text); this.e.ui.toast('Не удалось скопировать — скачала файлом', 'err'); }
    return text;
  }

  async downloadReport() { this.download(await this.collect()); }

  download(text) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), download: `adina-diagnostics-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
}

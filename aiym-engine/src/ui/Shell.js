import { MatrixField } from './matrix.js';
import { filesFromDrop } from '../core/package.js';

const $ = (sel, root = document) => root.querySelector(sel);
const h = (tag, attrs = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), {});
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) el.append(k);
  return el;
};
export { h };

const TABS = [['modules', 'Модули'], ['avatar', 'Аватар'], ['engine', 'Движок']];
const CATEGORY = { input: 'Ввод', output: 'Вывод', brain: 'Мозг', dev: 'Разработка', user: 'Мои модули' };
const STATE_LABEL = { on: 'Работает', off: 'Выключен', loading: 'Загрузка…', error: 'Ошибка', planned: 'Запланирован' };

export class Shell {
  panels = [];
  statuses = new Map();

  constructor(engine) {
    this.engine = engine;
    this.h = h;
    this.toastBox = Object.assign(document.createElement('div'), { className: 'toasts' });
    document.body.append(this.toastBox);
    this.#wireInstall();
    this.avatarMount = $('#avatar-mount');
    this.drawer = $('#drawer');
    this.tab = 'modules';
    this.matrix = new MatrixField($('#matrix'), { cell: 14 });
    const overlay = $('#viewport-overlay'), label = $('#viewport-label');
    this.viewport = {
      overlay,
      setSource: (video, mirror = true) => { this.matrix.setSource(video, mirror); label.dataset.live = video ? '1' : '0'; label.textContent = video ? 'КАМЕРА · LIVE' : 'ОЖИДАНИЕ СИГНАЛА'; },
    };
    this.viewport.setSource(null);
    this.setMatrixFilter(this.engine.config.get('ui.matrixFilter', true), false);
    this.fps = { frames: 0, acc: 0, el: $('#fps') };
    this.caption = { el: $('#caption'), timer: 0 };
    this.#wireChrome();
    const scale = () => document.documentElement.style.setProperty('--ui', Math.min(Math.max(innerHeight / 1080, 0.8), 2).toFixed(3));
    addEventListener('resize', scale); scale();
  }

  #wireChrome() {
    const eng = this.engine;
    $('#btn-settings').addEventListener('click', () => this.toggleDrawer());
    $('#btn-filter').addEventListener('click', () => { this.setMatrixFilter(!this.matrix.filter); this.#renderEngine(); });
    $('#drawer-close').addEventListener('click', () => this.toggleDrawer(false));
    addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea')) return;
      if (e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы') this.toggleDrawer();
      if (e.key === 'Escape') this.toggleDrawer(false);
      if (e.key === 'm' || e.key === 'M' || e.key === 'ь' || e.key === 'Ь') { this.setMatrixFilter(!this.matrix.filter); this.#renderEngine(); }
      if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    });
    // в киоске: курсор и панель сами прячутся, когда никто не трогает мышь
    let idle;
    const wake = () => {
      document.body.classList.remove('idle'); clearTimeout(idle);
      if (eng.config.get('ui.autoHideChrome', true) && !this.drawer.classList.contains('open')) idle = setTimeout(() => document.body.classList.add('idle'), 5000);
    };
    addEventListener('pointermove', wake); addEventListener('keydown', wake); wake();
    $('#name').textContent = eng.config.get('assistant.name', 'Адина');
  }

  // ───────── «Открыть модуль» (как документ в Word) ─────────
  toast(text, kind = 'ok', ms = 5000) {
    const t = h('div', { class: `toast ${kind}` }, text);
    this.toastBox.append(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, ms);
  }

  /** Установка готового модуля из папки движка одним нажатием (то же, что «Открыть файл…»). */
  async installFromServer(path) {
    try {
      const r = await fetch(path, { cache: 'no-store' });
      if (!r.ok) throw new Error(`файл ${path} не найден (${r.status})`);
      await this.install([new File([await r.text()], path.split('/').pop(), { type: 'text/javascript' })]);
    } catch (e) { this.toast(`Не удалось установить: ${e.message}`, 'err', 8000); }
  }

  async install(files) {
    try {
      const e = await this.engine.modules.installFiles(files);
      if (e.state === 'on') this.toast(`Модуль «${e.name}» ${e.record?.prev ? 'обновлён' : 'загружен'} и запущен`);
      else this.toast(`Модуль «${e.name}» загружен, но не запустился: ${e.error}`, 'err', 9000);
    } catch (err) { this.toast(`Не удалось открыть модуль: ${err.message}`, 'err', 9000); }
  }

  #wireInstall() {
    const pick = (attrs) => {
      const input = Object.assign(document.createElement('input'), { type: 'file', hidden: true, multiple: true, ...attrs });
      input.addEventListener('change', () => { if (input.files.length) this.install([...input.files]); input.value = ''; });
      document.body.append(input); return input;
    };
    this.fileInput = pick({ accept: '.js,.mjs,.json' });
    this.dirInput = pick({}); this.dirInput.setAttribute('webkitdirectory', '');
    const veil = h('div', { class: 'dropveil' }, h('div', {}, h('b', {}, 'Отпустите, чтобы открыть модуль'), h('span', {}, 'файл .js или папка с module.json')));
    document.body.append(veil);
    let depth = 0;
    addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types ?? [])].includes('Files')) { depth++; veil.classList.add('on'); } });
    addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; veil.classList.remove('on'); } });
    addEventListener('dragover', (e) => e.preventDefault());
    addEventListener('drop', async (e) => {
      e.preventDefault(); depth = 0; veil.classList.remove('on');
      const files = await filesFromDrop(e.dataTransfer);
      if (files.length) this.install(files);
    });
  }

  /** Матричный фильтр на картинке с камеры: вкл — символы, выкл — обычное видео. */
  setMatrixFilter(on, save = true) {
    this.matrix.filter = on;
    document.body.classList.toggle('no-matrix', !on);
    const b = $('#btn-filter'); if (b) { b.textContent = on ? 'Фильтр «Матрица»: вкл' : 'Фильтр «Матрица»: выкл'; b.setAttribute('aria-pressed', on); }
    if (save) this.engine.config.set('ui.matrixFilter', on);
  }

  applyViewport(on) { document.body.classList.toggle('no-view', !on); }

  applySplit(r) { document.documentElement.style.setProperty('--split', `${Math.round(r * 1000) / 10}%`); }

  frame(dt) {
    if (!document.body.classList.contains('no-view')) this.matrix.frame(dt);
    const f = this.fps; f.frames++; f.acc += dt;
    if (f.acc >= 0.5) {
      f.el.textContent = this.engine.config.get('ui.showFps') ? `${Math.round(f.frames / f.acc)} FPS` : '';
      f.frames = 0; f.acc = 0;
    }
  }

  setCaption(text, { role = 'assistant', hold = 6 } = {}) {
    const c = this.caption; clearTimeout(c.timer);
    if (!text || !this.engine.config.get('ui.captions', true)) { c.el.classList.remove('show'); return; }
    c.el.dataset.role = role; c.el.querySelector('.text').textContent = text; c.el.classList.add('show');
    if (hold) c.timer = setTimeout(() => c.el.classList.remove('show'), hold * 1000);
  }

  setStatus(id, text) { text ? this.statuses.set(id, text) : this.statuses.delete(id); this.#renderChips(); }

  addPanel(def) {
    const panel = { tab: 'avatar', ...def };
    this.panels.push(panel);
    this.#renderPanels();
    return () => { this.panels = this.panels.filter((p) => p !== panel); panel.dispose?.(); this.#renderPanels(); };
  }

  toggleDrawer(force) {
    const open = force ?? !this.drawer.classList.contains('open');
    this.drawer.classList.toggle('open', open);
    document.body.classList.toggle('drawer-open', open);
    if (open) document.body.classList.remove('idle');
  }

  // ───────── Настройки ─────────
  buildSettings() {
    const tabs = $('#drawer-tabs');
    tabs.replaceChildren(...TABS.map(([id, label]) => h('button', { class: 'tab', 'data-tab': id, onclick: () => { this.tab = id; this.#renderTabs(); } }, label)));
    this.engine.bus.on('module.state', () => { this.#renderModules(); this.#renderChips(); });
    this.engine.bus.on('module.installed', () => this.#renderModules());
    this.#renderTabs(); this.#renderChips();
    this.applySplit(this.engine.config.get('ui.splitRatio', 0.5));
    this.applyViewport(this.engine.config.get('ui.showViewport', false));
  }

  #renderTabs() {
    for (const b of $('#drawer-tabs').children) b.classList.toggle('active', b.dataset.tab === this.tab);
    const body = $('#drawer-body');
    body.dataset.tab = this.tab;
    body.replaceChildren(h('div', { id: 'pane-modules' }), h('div', { id: 'pane-avatar' }), h('div', { id: 'pane-engine' }));
    this.#renderModules(); this.#renderEngine(); this.#renderPanels();
  }

  #renderModules() {
    const pane = $('#pane-modules'); if (!pane) return;
    const groups = new Map();
    for (const e of this.engine.modules.entries.values()) {
      if (!groups.has(e.category)) groups.set(e.category, []);
      groups.get(e.category).push(e);
    }
    pane.replaceChildren(
      h('div', { class: 'dropzone' },
        h('b', {}, 'Открыть модуль'),
        h('p', { class: 'hint' }, 'Как документ в Word: перетащите файл модуля (.js) или папку прямо в окно — либо нажмите кнопку. Модуль запомнится и будет работать после перезагрузки.'),
        h('div', { class: 'chiprow' }, h('button', { class: 'btn primary sm', onclick: () => this.fileInput.click() }, 'Открыть файл…'), h('button', { class: 'btn sm', onclick: () => this.dirInput.click() }, 'Открыть папку…'))),
      ...[...groups].map(([cat, list]) => h('section', { class: 'group' }, h('h3', {}, CATEGORY[cat] ?? cat),
        list.map((e) => h('div', { class: 'module', 'data-state': e.state },
          h('div', { class: 'module-main' },
            h('div', { class: 'module-name' }, h('span', { class: 'dot' }), e.name, e.version ? h('span', { class: 'ver' }, `v${e.version}`) : null),
            h('div', { class: 'module-desc' }, e.error ? `Ошибка: ${e.error}` : e.description),
            h('div', { class: 'module-meta' }, e.state === 'planned' && e.meta.dist ? 'Не установлен' : STATE_LABEL[e.state], e.loadMs != null && e.state === 'on' ? ` · ${e.loadMs} мс` : '')),
          e.state === 'planned' ? (e.meta.dist ? h('button', { class: 'btn primary sm', onclick: () => this.installFromServer(e.meta.dist) }, 'Установить') : h('span', { class: 'badge' }, 'скоро'))
            : h('div', { class: 'module-actions' },
              e.source === 'user' ? h('div', { class: 'mini' },
                e.dist ? h('button', { class: 'link', title: 'Взять свежий файл из движка', onclick: () => this.installFromServer(e.dist) }, 'Обновить') : null,
                e.record?.prev ? h('button', { class: 'link', title: 'Вернуть прежнюю версию', onclick: () => this.engine.modules.rollback(e.id) }, 'Откатить') : null,
                h('button', { class: 'link danger', onclick: () => confirm(`Удалить модуль «${e.name}»?`) && this.engine.modules.remove(e.id).then(() => this.#renderModules()) }, 'Удалить')) : null,
              h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: e.enabled, onchange: (ev) => this.engine.modules.setEnabled(e.id, ev.target.checked) }), h('span', {}))))))));
  }

  #renderEngine() {
    const pane = $('#pane-engine'); if (!pane) return;
    const cfg = this.engine.config;
    const toggle = (label, path, def, hint) => h('label', { class: 'row' }, h('span', { class: 'row-text' }, h('b', {}, label), hint ? h('small', {}, hint) : null),
      h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: cfg.get(path, def), onchange: (e) => cfg.set(path, e.target.checked) }), h('span', {})));
    pane.replaceChildren(
      h('section', { class: 'group' }, h('h3', {}, 'Интерфейс'),
        h('label', { class: 'row' }, h('span', { class: 'row-text' }, h('b', {}, 'Имя персонажа'), h('small', {}, 'У девушки и парня имена свои; на них ассистент откликается. Стандартные имена произносятся правильно на каждом языке')),
          h('input', { class: 'text-input', value: cfg.get('assistant.name'), onchange: (e) => { this.engine.setName(e.target.value); $('#name').textContent = cfg.get('assistant.name'); } })),
        h('label', { class: 'row' }, h('span', { class: 'row-text' }, h('b', {}, 'Правая панель'), h('small', {}, 'Камера в стиле «Матрицы»; без неё аватар на весь экран')),
          h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: cfg.get('ui.showViewport', false), onchange: (e) => { cfg.set('ui.showViewport', e.target.checked); this.applyViewport(e.target.checked); } }), h('span', {}))),
        h('label', { class: 'row' }, h('span', { class: 'row-text' }, h('b', {}, 'Ширина аватара'), h('small', {}, 'Доля экрана слева')),
          h('input', { type: 'range', min: 30, max: 70, value: cfg.get('ui.splitRatio', 0.5) * 100, oninput: (e) => { cfg.set('ui.splitRatio', e.target.value / 100); this.applySplit(e.target.value / 100); } })),
        h('label', { class: 'row' }, h('span', { class: 'row-text' }, h('b', {}, 'Фильтр «Матрица» на камере'), h('small', {}, 'Выкл — обычное видео с камеры (клавиша M)')),
          h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: cfg.get('ui.matrixFilter', true), onchange: (e) => this.setMatrixFilter(e.target.checked) }), h('span', {}))),
        toggle('Субтитры', 'ui.captions', true, 'Показывать реплики внизу экрана'),
        toggle('Счётчик FPS', 'ui.showFps', false),
        toggle('Прятать панель в простое', 'ui.autoHideChrome', true, 'Для режима киоска')),
      h('section', { class: 'group' }, h('h3', {}, 'Аватар'),
        h('label', { class: 'row' }, h('span', { class: 'row-text' }, h('b', {}, 'Качество графики'), h('small', {}, 'Ниже — легче для видеокарты (страница перезагрузится)')),
          (() => { const s = h('select', { class: 'text-input' }, [['high', 'Высокое (2К, сглаживание)'], ['medium', 'Среднее'], ['eco', 'Экономное (720p, без сглаживания)']].map(([v, t]) => h('option', { value: v }, t))); s.value = cfg.get('avatar.quality', 'medium'); s.onchange = () => cfg.set('avatar.quality', s.value); return s; })()),
        h('label', { class: 'row' }, h('span', { class: 'row-text' }, h('b', {}, 'Лимит кадров в секунду'), h('small', {}, '30 — вдвое легче, чем 60; движения аватара остаются плавными')),
          (() => { const s = h('select', { class: 'text-input' }, [[15, '15'], [24, '24'], [30, '30'], [60, '60'], [0, 'Без лимита']].map(([v, t]) => h('option', { value: v }, t))); s.value = String(cfg.get('avatar.fpsLimit', 30)); s.onchange = () => cfg.set('avatar.fpsLimit', Number(s.value)); return s; })()),
        toggle('Экономить, когда окно не в фокусе', 'avatar.saveInBackground', true, 'Например, когда вы играете: аватар рисуется в 12 к/с и почти не грузит видеокарту'),
        h('label', { class: 'row' }, h('span', { class: 'row-text' }, h('b', {}, 'Персонаж'), h('small', {}, 'Девушка (Адина) или парень (Адиль): мимика, жесты и речь одинаковые; имя и голос подстраиваются')),
          (() => { const s = h('select', { class: 'text-input' }, [['female', 'Девушка'], ['male', 'Парень']].map(([v, t]) => h('option', { value: v }, t))); s.value = cfg.get('avatar.gender', 'female'); s.onchange = () => { cfg.set('avatar.gender', s.value); setTimeout(() => this.#renderEngine(), 50); }; return s; })()),
        toggle('Переключать персонажа по имени', 'assistant.switchByName', true, 'Назвали по имени парня или девушку — выходит тот, кого позвали'),
        toggle('Живая анимация', 'avatar.idle', true, 'Дыхание, моргание, блуждающий взгляд'),
        toggle('Комар', 'avatar.mosquito', true, 'Изредка залетает комар: она провожает его взглядом и поворачивает голову'),
        toggle('Писк комара', 'avatar.mosquitoSound', true, 'Характерный звук, громче когда он рядом'),
        toggle('Физика украшений', 'avatar.physics', true, 'Подвески, коса, помпон, вуаль'),
        toggle('Линия подбородка', 'avatar.guides', false, 'Тонкий пунктир-подсказка (отладка)')),
      h('section', { class: 'group' }, h('h3', {}, 'Диагностика'),
        h('p', { class: 'hint' }, 'Один отчёт со всем: что включено, какие настройки, связь с Whisper/LLM/Piper, камера и микрофон, лог ошибок. Нажмите и вставьте в чат.'),
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
          h('button', { class: 'btn primary', onclick: () => this.engine.diagnostics.copy() }, 'Скопировать отчёт'),
          h('button', { class: 'btn', onclick: () => this.engine.diagnostics.downloadReport() }, 'Скачать файлом'))),
      h('section', { class: 'group' }, h('h3', {}, 'Сброс'),
        h('button', { class: 'btn danger', onclick: () => confirm('Сбросить все настройки движка?') && cfg.reset() }, 'Сбросить настройки')),
      h('p', { class: 'hint' }, 'Горячие клавиши: S — настройки, F — полный экран, M — фильтр «Матрица».'));
  }

  #renderPanels() {
    for (const tab of ['avatar', 'engine']) {
      const pane = $(`#pane-${tab}`); if (!pane) continue;
      for (const old of pane.querySelectorAll('[data-panel]')) old.remove();
      for (const p of this.panels.filter((x) => x.tab === tab)) {
        const el = h('section', { class: 'group', 'data-panel': p.owner }, h('h3', {}, p.title));
        pane.prepend(el); p.render(el);
      }
    }
  }

  #renderChips() {
    const wrap = $('#chips'); if (!wrap) return;
    const items = [...this.engine.modules.entries.values()].filter((e) => e.state === 'on' || e.state === 'error' || e.state === 'loading');
    wrap.replaceChildren(...items.map((e) => h('span', { class: 'chip', 'data-state': e.state, title: e.name }, h('i', {}), this.statuses.get(e.id) ?? e.name)));
  }
}

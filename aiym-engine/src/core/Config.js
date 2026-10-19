// Настройки движка: defaults → config/engine.json (для киоска) → localStorage (из панели настроек).
const LS_KEY = 'adina.config.v1';
const LS_LEGACY = 'aiym.config.v1';      // прежний ключ: настройки переносятся автоматически

export const DEFAULTS = {
  assistant: { name: 'Адина', language: 'ru' },
  ui: { showViewport: false, matrixFilter: true, splitRatio: 0.5, showFps: false, captions: true, autoHideChrome: true },
  avatar: { physics: true, idle: true, gender: 'female' },
  modules: {}, // { <id>: { enabled: bool, config: {...} } }
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : v;
  return out;
}

export class Config {
  #data;
  #listeners = new Set();

  constructor(base) {
    this.#data = merge(DEFAULTS, base);
    try { this.#data = merge(this.#data, JSON.parse(localStorage.getItem(LS_KEY) ?? localStorage.getItem(LS_LEGACY) ?? '{}')); }
    catch { /* localStorage недоступен — работаем с дефолтами */ }
    if (this.#data.assistant?.name === 'Айым') this.#data.assistant.name = 'Адина';      // старое сохранённое имя
  }

  get(path, fallback) {
    let cur = this.#data;
    for (const key of path.split('.')) {
      if (cur == null || typeof cur !== 'object') return fallback;
      cur = cur[key];
    }
    return cur === undefined ? fallback : cur;
  }

  set(path, value) {
    const keys = path.split('.');
    let cur = this.#data;
    for (const key of keys.slice(0, -1)) cur = isObj(cur[key]) ? cur[key] : (cur[key] = {});
    cur[keys.at(-1)] = value;
    this.#save();
    for (const fn of this.#listeners) fn(path, value);
  }

  /** Копия всех настроек (для диагностики). */
  dump() { return JSON.parse(JSON.stringify(this.#data)); }

  onChange(fn) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  reset() {
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
    location.reload();
  }

  #save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.#data)); } catch { /* ignore */ }
  }
}

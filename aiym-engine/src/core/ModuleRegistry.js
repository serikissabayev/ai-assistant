import * as THREE from 'three';
import { ModuleStore } from './ModuleStore.js';
import { buildBundle, readPackage } from './package.js';

// Версия контракта «движок ↔ модуль» (то, что модуль получает через ctx).
// Меняется только при несовместимых изменениях. Модули объявляют её в module.json: "engine": 1
export const CONTRACT = 1;

/**
 * Реестр модулей — «Word», открывающий «документы». Источники модулей:
 *   builtin — идут с движком (src/modules/<id>/module.json)
 *   server  — папки в modules/ рядом с движком (подхватываются автоматически)
 *   user    — открытые пользователем из файлов (хранятся в браузере терминала)
 * Каждый грузится отдельно (import()), ошибка модуля не роняет движок,
 * а при выключении всё, что он зарегистрировал, снимается автоматически.
 */
export class ModuleRegistry {
  /** @type {Map<string, any>} */ entries = new Map();
  #engine;

  constructor(engine) { this.#engine = engine; }

  // ───────── загрузка списка ─────────
  async loadAll(manifestUrl) {
    const base = new URL(manifestUrl, location.href);
    const manifest = await (await fetch(manifestUrl)).json();

    for (const id of manifest.builtin ?? []) {
      const dir = new URL(`${id}/`, base);
      try {
        const meta = await (await fetch(new URL('module.json', dir))).json();
        this.#register(meta, { source: 'builtin', base: dir });
      } catch (e) { console.error(`[modules] не прочитан module.json у «${id}»`, e); }
    }
    this.dist = {};   // id → путь готового файла модуля в папке движка (для кнопок «Установить / Обновить»)
    for (const p of manifest.planned ?? []) { if (p.dist) this.dist[p.id] = p.dist; this.#register(p, { source: 'builtin', planned: true }); }

    try {   // модули из папки modules/ на сервере (если сервер это умеет)
      const list = await (await fetch('api/modules', { cache: 'no-store' })).json();
      for (const m of list) if (!this.entries.has(m.id)) this.#register(m, { source: 'server', base: new URL(`modules/${m.id}/`, location.href) });
    } catch { /* простой статический сервер — ок */ }

    for (const rec of await ModuleStore.all()) {
      const ex = this.entries.get(rec.id);
      if (ex && ex.source !== 'user' && !ex.planned) continue;
      this.#register(rec.meta, { source: 'user', record: rec });
    }
  }

  #register(meta, extra) {
    const saved = this.#engine.config.get(`modules.${meta.id}`, {});
    const e = {
      id: meta.id, name: meta.name ?? meta.id, category: meta.category ?? 'user', version: meta.version, description: meta.description ?? '',
      meta, defaults: meta.defaults, entry: meta.entry ?? 'index.js', dist: this.dist?.[meta.id],
      enabled: saved.enabled ?? meta.enabled ?? false,
      state: extra.planned ? 'planned' : 'off', error: null, loadMs: null, instance: null, cleanup: [], bundle: null,
      ...extra,
    };
    this.entries.set(meta.id, e);
    return e;
  }

  async startEnabled() {
    await Promise.allSettled([...this.entries.values()].filter((e) => e.enabled && e.state === 'off').map((e) => this.#start(e)));
  }

  // ───────── управление ─────────
  async setEnabled(id, on) {
    const e = this.entries.get(id);
    if (!e || e.state === 'planned') return;
    this.#engine.config.set(`modules.${id}.enabled`, on);
    e.enabled = on;
    if (on && e.state !== 'on' && e.state !== 'loading') await this.#start(e);
    else if (!on && (e.state === 'on' || e.state === 'error')) await this.#stop(e);
  }

  async reload(id) {
    const e = this.entries.get(id);
    if (!e || e.state === 'planned') return;
    await this.#stop(e);
    await this.#start(e, true);
  }

  // ───────── «Открыть документ» ─────────
  async installFiles(files) {
    const pkg = await readPackage(files);
    const old = this.entries.get(pkg.id);
    if (old && old.source !== 'user' && !old.planned) throw new Error(`Имя «${pkg.id}» занято модулем из состава движка. Переименуйте id.`);
    const prevOf = old?.record ? { meta: old.record.meta, entry: old.record.entry, files: old.record.files } : null;
    const rec = { ...pkg, installedAt: Date.now(), prev: prevOf };
    await ModuleStore.put(rec);
    if (old) { await this.#stop(old); old.bundle?.dispose(); this.entries.delete(pkg.id); }
    const e = this.#register(pkg.meta, { source: 'user', record: rec });
    e.enabled = true; this.#engine.config.set(`modules.${pkg.id}.enabled`, true);
    this.#engine.bus.emit('module.installed', { id: pkg.id, updated: !!old });
    await this.#start(e);
    return e;
  }

  async remove(id) {
    const e = this.entries.get(id);
    if (!e || e.source !== 'user') return;
    await this.#stop(e);
    e.bundle?.dispose();
    await ModuleStore.remove(id);
    this.entries.delete(id);
    this.#engine.bus.emit('module.state', { id, state: 'removed' });
  }

  /** Вернуть прежнюю версию модуля (хранится одна предыдущая). */
  async rollback(id) {
    const e = this.entries.get(id);
    if (!e?.record?.prev) return;
    const prev = e.record.prev;
    const rec = { id, meta: prev.meta, entry: prev.entry, files: prev.files, installedAt: Date.now(), prev: null };
    await ModuleStore.put(rec);
    await this.#stop(e); e.bundle?.dispose(); this.entries.delete(id);
    const ne = this.#register(rec.meta, { source: 'user', record: rec });
    ne.enabled = true;
    await this.#start(ne);
  }

  // ───────── жизненный цикл ─────────
  async #start(e, bust = false) {
    e.state = 'loading'; e.error = null; this.#changed(e);
    const t0 = performance.now();
    try {
      this.#checkContract(e.meta);
      let url, asset;
      if (e.source === 'user') {
        e.bundle?.dispose(); e.bundle = await buildBundle(e.record);
        url = e.bundle.entryUrl; asset = (p) => e.bundle.assetUrl(p);
      } else {
        url = new URL(e.entry, e.base).href; if (bust) url += `?v=${Date.now()}`;
        asset = (p) => new URL(p, e.base).href;
      }
      const mod = await import(/* @vite-ignore */ url);
      const instance = (mod.default ?? mod.create)();
      e.cleanup = [];
      await instance.start(this.#context(e, asset));
      e.instance = instance; e.state = 'on'; e.loadMs = Math.round(performance.now() - t0);
    } catch (err) {
      console.error(`[module:${e.id}]`, err);
      e.error = String(err?.message ?? err); e.state = 'error';
      this.#runCleanup(e);
    }
    this.#changed(e);
  }

  #checkContract(meta) {
    const major = Number(String(meta.engine ?? CONTRACT).match(/\d+/)?.[0] ?? CONTRACT);
    if (major !== CONTRACT) throw new Error(`Модуль написан для движка версии ${major}, а этот движок — версии ${CONTRACT}. Нужна другая версия модуля.`);
  }

  async #stop(e) {
    try { await e.instance?.stop?.(); } catch (err) { console.error(`[module:${e.id}] stop`, err); }
    this.#runCleanup(e);
    e.instance = null; e.state = 'off'; e.error = null; this.#changed(e);
  }

  #runCleanup(e) {
    for (const fn of e.cleanup.splice(0).reverse()) { try { fn(); } catch (err) { console.error(err); } }
  }

  #changed(e) { this.#engine.bus.emit('module.state', { id: e.id, state: e.state, error: e.error }); }

  // Всё, что модуль получает от движка («контракт v1»). Зарегистрированное учитывается для автоочистки.
  #context(e, asset) {
    const eng = this.#engine, track = (off) => { e.cleanup.push(off); return off; };
    const cfgKey = `modules.${e.id}.config`;
    return {
      contract: CONTRACT,
      id: e.id,
      log: (...a) => console.log(`%c[${e.id}]`, 'color:#d9a566', ...a),
      asset,
      libs: { three: THREE },
      avatar: eng.avatar,
      util: eng.util,
      bus: {
        emit: (evt, p) => eng.bus.emit(evt, p),
        on: (evt, fn) => track(eng.bus.on(evt, fn)),
        once: (evt, fn) => track(eng.bus.once(evt, fn)),
      },
      config: {
        get: (k, d) => eng.config.get(`${cfgKey}.${k}`, e.defaults?.[k] ?? d),
        set: (k, v) => eng.config.set(`${cfgKey}.${k}`, v),
      },
      engineConfig: { get: (k, d) => eng.config.get(k, d) },
      onFrame: (fn) => track(eng.onFrame(fn)),
      defer: (fn) => track(fn),
      ui: {
        h: eng.ui.h,
        addPanel: (def) => track(eng.ui.addPanel({ ...def, owner: e.id })),
        setCaption: (text, opts) => eng.ui.setCaption(text, opts),
        setStatus: (text) => eng.ui.setStatus(e.id, text),
        toast: (text, kind) => eng.ui.toast(text, kind),
        viewport: eng.ui.viewport,
      },
    };
  }
}

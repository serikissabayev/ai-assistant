import { EventBus } from './EventBus.js';
import { Config } from './Config.js';
import { ModuleRegistry } from './ModuleRegistry.js';
import { textToVisemes } from './lipsync.js';
import { Avatar } from '../avatar/Avatar.js';
import { Shell } from '../ui/Shell.js';
import { SpeechSim } from './SpeechSim.js';

export const ENGINE_VERSION = '0.1.0';

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
    this.avatar = new Avatar(this.ui.avatarMount, { pixelRatioMax: this.config.get('avatar.pixelRatioMax', q.ratio), maxRender: this.config.get('avatar.maxRender', q.max), antialias: q.aa });
    this.avatar.setOptions({ idle: this.config.get('avatar.idle', true), physics: this.config.get('avatar.physics', true), guides: this.config.get('avatar.guides', false), mosquito: this.config.get('avatar.mosquito', true), mosquitoSound: this.config.get('avatar.mosquitoSound', true) });
    this.config.onChange((path, v) => {
      if (path === 'avatar.quality') setTimeout(() => location.reload(), 200);          // разрешение и сглаживание применяются при старте
      if (path === 'avatar.idle') this.avatar.setOptions({ idle: v });
      if (path === 'avatar.physics') this.avatar.setOptions({ physics: v });
      if (path === 'avatar.mosquito') this.avatar.setOptions({ mosquito: v });
      if (path === 'avatar.mosquitoSound') this.avatar.setOptions({ mosquitoSound: v });
      if (path === 'avatar.guides') this.avatar.setOptions({ guides: v });
    });

    this.speechSim = new SpeechSim(this);
    this.modules = new ModuleRegistry(this);
    await this.modules.loadAll('src/modules/manifest.json');
    this.ui.buildSettings();
    this.#loop();
    this.bus.emit('engine.ready', { version: ENGINE_VERSION });
    await this.modules.startEnabled();
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

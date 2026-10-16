import { Engine } from './core/Engine.js';

const engine = new Engine();
window.aiym = engine;          // для отладки из консоли: aiym.avatar.setEmotion('happy')
engine.boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:20px;color:#ff8a8a;font:13px monospace;z-index:99">Ошибка запуска движка:\n${e.stack ?? e}</pre>`);
});

import { Engine } from './core/Engine.js';
import { installLogCapture } from './core/Diagnostics.js';

installLogCapture();                // запись console и ошибок для отчёта диагностики

const engine = new Engine();
window.adina = engine;         // для отладки из консоли: adina.avatar.setEmotion('happy')
engine.boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:20px;color:#ff8a8a;font:13px monospace;z-index:99">Ошибка запуска движка:\n${e.stack ?? e}</pre>`);
});

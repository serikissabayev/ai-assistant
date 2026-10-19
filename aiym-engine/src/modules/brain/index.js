// Модуль «Мозг»: любой OpenAI-совместимый сервер (LM Studio, Ollama, OpenRouter, vLLM…).
// Вход:  bus 'brain.ask' {text}  и  'hearing.transcript' {text, final:true}
// Выход: 'brain.state', 'brain.delta' {text}, 'brain.sentence' {text, index}, 'brain.reply' {text}, 'speech.say' {text}
export const PROVIDERS = {
  lmstudio: { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
  ollama: { name: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  custom: { name: 'Другой', baseUrl: '' },
};

const DEFAULT_PROMPT = `Ты — Адина, голосовой ассистент IT/AI-хаба. Ты стоишь перед гостями и разговариваешь с ними вживую.
Отвечай по-человечески, тепло и коротко: 1–3 предложения. Язык — как у собеседника (русский, казахский или английский).
Твой ответ озвучивается голосом, поэтому не используй markdown, списки, эмодзи и ссылки. Не выдумывай факты — если не знаешь, скажи об этом.`;

const SENTENCE_END = /([.!?…]+["»)]?)(\s+|$)|\n+/;

export default function create() {
  let ctx, h, abort = null, history = [], busy = false;

  const cfg = (k, d) => ctx.config.get(k, d);
  const baseUrl = () => (cfg('baseUrl', PROVIDERS.lmstudio.baseUrl) || '').replace(/\/+$/, '');
  const headers = () => ({ 'Content-Type': 'application/json', ...(cfg('apiKey', '') ? { Authorization: `Bearer ${cfg('apiKey')}` } : {}) });
  const setState = (state, extra = {}) => { ctx.bus.emit('brain.state', { state, ...extra }); };

  async function listModels() {
    const r = await fetch(`${baseUrl()}/models`, { headers: headers(), signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return (j.data ?? j.models ?? []).map((m) => m.id ?? m.name).filter(Boolean);
  }

  // убирает <think>…</think> (Qwen3 и др.) из потока — это не для озвучки
  function makeFilter() {
    let inThink = false, buf = '';
    return (chunk) => {
      buf += chunk; let out = '';
      for (;;) {
        if (inThink) {
          const i = buf.indexOf('</think>');
          if (i < 0) { buf = buf.slice(-8); return out; }
          buf = buf.slice(i + 8); inThink = false;
        } else {
          const i = buf.indexOf('<think>');
          if (i >= 0) { out += buf.slice(0, i); buf = buf.slice(i + 7); inThink = true; continue; }
          const keep = Math.max(0, buf.length - 6);        // хвост мог быть началом тега
          const cut = buf.lastIndexOf('<') >= keep ? buf.lastIndexOf('<') : buf.length;
          out += buf.slice(0, cut); buf = buf.slice(cut); return out;
        }
      }
    };
  }

  async function ask(text) {
    text = (text ?? '').trim();
    if (!text) return;
    cancel();
    const model = cfg('model', '');
    if (!model) { ctx.bus.emit('brain.error', { message: 'Не выбрана модель (Настройки → Движок → Мозг)' }); setState('error'); return; }

    history.push({ role: 'user', content: text });
    const keep = cfg('historyTurns', 8) * 2;
    if (history.length > keep) history = history.slice(-keep);

    const ac = abort = new AbortController();
    busy = true; setState('thinking'); ctx.avatar.setEmotion('thinking', 0.8);
    const messages = [{ role: 'system', content: cfg('systemPrompt', DEFAULT_PROMPT) }, ...history];
    const connectTimer = setTimeout(() => ac.abort(new Error('Сервер не отвечает')), 20000);

    let full = '', pending = '', idx = 0, first = true;
    const flush = (final) => {
      for (;;) {
        const m = SENTENCE_END.exec(pending);
        if (!m || (!final && m.index + m[0].length >= pending.length && !/\s/.test(m[0]))) break;
        const end = m.index + m[0].length;
        const s = pending.slice(0, end).trim(); pending = pending.slice(end);
        if (s.length >= 2) { ctx.bus.emit('brain.sentence', { text: s, index: idx++ }); if (cfg('speak', true)) ctx.bus.emit('speech.say', { text: s }); }
      }
      if (final && pending.trim().length >= 2) {
        const s = pending.trim(); pending = '';
        ctx.bus.emit('brain.sentence', { text: s, index: idx++ }); if (cfg('speak', true)) ctx.bus.emit('speech.say', { text: s });
      }
    };

    try {
      const r = await fetch(`${baseUrl()}/chat/completions`, {
        method: 'POST', headers: headers(), signal: ac.signal,
        body: JSON.stringify({ model, messages, stream: true, temperature: cfg('temperature', 0.7), max_tokens: cfg('maxTokens', 400) }),
      });
      clearTimeout(connectTimer);
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const reader = r.body.getReader(), dec = new TextDecoder(), filter = makeFilter();
      let sse = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        sse += dec.decode(value, { stream: true });
        const lines = sse.split('\n'); sse = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          let delta; try { delta = JSON.parse(data).choices?.[0]?.delta?.content; } catch { continue; }
          if (!delta) continue;
          const clean = filter(delta);
          if (!clean) continue;
          if (first) { first = false; setState('streaming'); ctx.avatar.setEmotion('neutral'); }
          full += clean; pending += clean;
          ctx.bus.emit('brain.delta', { text: clean, full });
          ctx.ui.setCaption(full, { role: 'assistant', hold: 0 });
          flush(false);
        }
      }
      flush(true);
      full = full.trim();
      if (full) history.push({ role: 'assistant', content: full });
      ctx.bus.emit('brain.reply', { text: full });
      ctx.ui.setCaption(full, { role: 'assistant', hold: 4 + full.length * 0.06 });
      setState('idle');
    } catch (e) {
      clearTimeout(connectTimer);
      if (ac.signal.aborted && !(ac.signal.reason instanceof Error)) return;        // отмена пользователем
      const message = ac.signal.reason?.message ?? e.message;
      ctx.log('ошибка', message);
      ctx.bus.emit('brain.error', { message }); setState('error', { message });
      ctx.ui.setCaption('Не могу связаться с мозгом: ' + message, { role: 'user', hold: 6 });
      ctx.avatar.setEmotion('sad', 0.5); setTimeout(() => ctx.avatar.setEmotion('neutral'), 3000);
    } finally { if (abort === ac) { abort = null; busy = false; } }
  }

  function cancel() {
    if (abort) { abort.abort(); abort = null; }
    busy = false;
  }

  return {
    async start(c) {
      ctx = c; h = ctx.ui.h;
      ctx.bus.on('brain.ask', ({ text }) => ask(text));
      ctx.bus.on('brain.cancel', cancel);
      ctx.bus.on('brain.reset', () => { history = []; });
      ctx.bus.on('hearing.transcript', ({ text, final }) => { if (final && cfg('listen', true)) ask(text); });
      ctx.bus.on('brain.state', ({ state }) => ctx.ui.setStatus({ idle: `Мозг · ${cfg('model', '—')}`, thinking: 'Мозг · думает…', streaming: 'Мозг · отвечает', error: 'Мозг · ошибка' }[state] ?? null));
      ctx.ui.setStatus(`Мозг · ${cfg('model', 'модель не выбрана') || 'модель не выбрана'}`);
      ctx.defer(() => ctx.ui.setStatus(null));

      ctx.ui.addPanel({
        tab: 'engine', title: 'Мозг (LLM)',
        render(el) {
          const status = h('div', { class: 'hint', style: 'margin:6px 0 10px' }, 'Связь не проверялась');
          const field = (label, node, hint) => h('label', { class: 'row', style: 'flex-wrap:wrap' }, h('span', { class: 'row-text' }, h('b', {}, label), hint ? h('small', {}, hint) : null), node);

          const provider = h('select', { class: 'text-input' }, Object.entries(PROVIDERS).map(([id, p]) => h('option', { value: id }, p.name)));
          provider.value = cfg('provider', 'lmstudio');
          const url = h('input', { class: 'text-input', style: 'width:100%', value: baseUrl(), placeholder: 'http://192.168.1.50:1234/v1' });
          const key = h('input', { class: 'text-input', style: 'width:100%', type: 'password', value: cfg('apiKey', ''), placeholder: 'не нужен для LM Studio / Ollama' });
          const model = h('select', { class: 'text-input', style: 'width:100%' });
          const prompt = h('textarea', { class: 'text-input', style: 'width:100%;height:150px;resize:vertical;font:12.5px/1.4 var(--font)' });
          prompt.value = cfg('systemPrompt', DEFAULT_PROMPT);

          const fillModels = (list, selected) => {
            model.replaceChildren(...(list.length ? list : ['']).map((m) => h('option', { value: m }, m || '— нет моделей —')));
            model.value = list.includes(selected) ? selected : (list[0] ?? '');
            if (model.value !== selected) ctx.config.set('model', model.value);
          };
          fillModels(cfg('model', '') ? [cfg('model')] : [], cfg('model', ''));

          const refresh = async () => {
            status.textContent = 'Проверяю связь…';
            const t0 = performance.now();
            try {
              const list = await listModels();
              fillModels(list, cfg('model', ''));
              status.textContent = `✓ Связь есть · ${list.length} мод. · ${Math.round(performance.now() - t0)} мс`;
              status.style.color = 'var(--ok)';
              if (!busy) setState('idle');
            } catch (e) {
              status.textContent = `✗ ${e.message}. Проверьте адрес, что сервер запущен и включён CORS (lms server start --cors).`;
              status.style.color = 'var(--err)';
            }
          };

          provider.onchange = () => {
            ctx.config.set('provider', provider.value);
            if (PROVIDERS[provider.value].baseUrl) { url.value = PROVIDERS[provider.value].baseUrl; ctx.config.set('baseUrl', url.value); }
          };
          url.onchange = () => ctx.config.set('baseUrl', url.value.trim());
          key.onchange = () => ctx.config.set('apiKey', key.value.trim());
          model.onchange = () => { ctx.config.set('model', model.value); ctx.ui.setStatus(`Мозг · ${model.value}`); };
          prompt.onchange = () => ctx.config.set('systemPrompt', prompt.value);

          const temp = h('input', { type: 'range', min: 0, max: 15, value: cfg('temperature', 0.7) * 10, oninput: (e) => ctx.config.set('temperature', e.target.value / 10) });
          const test = h('input', { class: 'text-input', style: 'flex:1;width:auto', placeholder: 'Напишите вопрос…', onkeydown: (e) => { if (e.key === 'Enter') send.click(); } });
          const send = h('button', { class: 'btn primary sm', onclick: () => { if (test.value.trim()) { ctx.bus.emit('brain.ask', { text: test.value }); test.value = ''; } } }, 'Спросить');

          el.append(
            field('Провайдер', provider),
            field('Адрес API', url, 'Любой OpenAI-совместимый, оканчивается на /v1'),
            field('API-ключ', key, 'Хранится в браузере терминала'),
            h('div', { class: 'chiprow' }, h('button', { class: 'btn sm', onclick: refresh }, 'Проверить связь и загрузить модели')),
            status,
            field('Модель', model),
            field('Креативность', temp),
            h('label', { class: 'row' }, h('span', { class: 'row-text' }, h('b', {}, 'Озвучивать ответы'), h('small', {}, 'Отправлять фразы в модуль речи')),
              h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: cfg('speak', true), onchange: (e) => ctx.config.set('speak', e.target.checked) }), h('span', {}))),
            h('div', { class: 'row-text', style: 'margin-top:12px' }, h('b', {}, 'Системный промпт')), prompt,
            h('div', { class: 'chiprow' }, h('button', { class: 'btn sm', onclick: () => { prompt.value = DEFAULT_PROMPT; ctx.config.set('systemPrompt', DEFAULT_PROMPT); } }, 'Вернуть стандартный'),
              h('button', { class: 'btn sm', onclick: () => { history = []; } }, 'Забыть диалог')),
            h('div', { class: 'row-text', style: 'margin-top:12px' }, h('b', {}, 'Проверка')),
            h('div', { class: 'say' }, test, send),
          );
          if (cfg('model', '')) refresh();
        },
      });
      ctx.defer(cancel);
    },
    async stop() { cancel(); history = []; },
  };
}

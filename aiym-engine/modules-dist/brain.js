// «Мозг» — разговор с языковой моделью (LM Studio / Ollama / OpenRouter / любой OpenAI-совместимый сервер).
// Один файл: перетащите в окно движка или «Установить» в Настройках → Модули.
//
// Слушает: hearing.transcript {text, final} — ответ на фразу человека; brain.ask {text} — вопрос «из кода»;
//          speech.stop — прервать.
// Выдаёт:  speech.say {text} — по мере генерации, фраза за фразой (озвучивает модуль «Речь»);
//          brain.thinking {on}, brain.reply {text}.
export const meta = {
  id: 'brain', name: 'Мозг (LLM)', version: '0.3', engine: 1, category: 'brain',
  description: 'Языковая модель: LM Studio / Ollama / OpenRouter. Потоковый ответ, озвучка по фразам.',
};

const DEFAULT_PROMPT = `Ты — Айым, голосовой ассистент IT/AI-хаба в Казахстане. Ты вежливая, добрая, с лёгким юмором.
Отвечай на том языке, на котором к тебе обратились (қазақша, русский или English). Говори коротко: 1–3 предложения, как в живом разговоре.
Не используй markdown, списки, эмодзи и ссылки — твой ответ озвучивается голосом. Если не знаешь или не уверена — честно скажи, не выдумывай. Не повторяй вопрос и не пиши бессмысленных слов.`;

// чистим то, что нельзя произносить
const clean = (t) => t.replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>~]+/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1')
  .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim();

// позиция конца первой «достаточно длинной» фразы (≥14 знаков, чтобы «Да.» и «1.» не озвучивались отдельно) или -1
function sentenceEnd(buf) {
  const re = /[.!?…]+(?=\s)|\n/g;
  for (let m; (m = re.exec(buf)); ) { const end = m.index + m[0].length; if (end >= 14) return end; }
  return -1;
}

export default function create() {
  let ctx, h, cfg, history = [], abort = null, busy = false, viaProxy = false;
  const ui = {};

  const base = () => cfg('url', 'http://localhost:1235/v1').replace(/\/+$/, '');
  const headers = () => ({ 'Content-Type': 'application/json', ...(cfg('apiKey', '') ? { Authorization: `Bearer ${cfg('apiKey', '')}` } : {}) });

  // прямой запрос; если браузер блокирует (CORS) — через мини-прокси движка (/api/proxy)
  async function request(path, init) {
    const url = `${base()}${path}`;
    if (!viaProxy) {
      try { return await fetch(url, init); }
      catch (e) { if (e.name === 'AbortError') throw e; viaProxy = true; ctx.log('прямой запрос не прошёл (CORS?), перехожу на прокси движка'); }
    }
    return fetch('/api/proxy', { ...init, headers: { ...init.headers, 'X-Target-Url': url } });
  }

  async function ask(text) {
    text = text?.trim(); if (!text) return;
    abort?.abort();
    ctx.bus.emit('speech.stop', {});
    const my = abort = new AbortController();
    busy = true; status('думает…');
    ctx.bus.emit('brain.thinking', { on: true });
    ctx.avatar.setEmotion('thinking', 0.8);
    ctx.ui.setCaption(text, { role: 'user', hold: 3 });
    history.push({ role: 'user', content: text });
    history = history.slice(-cfg('history', 8) * 2);
    let full = '', buf = '', first = true; const t0 = performance.now(); let tFirst = 0;
    const say = (s) => { s = clean(s); if (s.length > 1) { ctx.bus.emit('speech.say', { text: s }); } };
    try {
      const r = await request('/chat/completions', {
        method: 'POST', signal: my.signal, headers: headers(),
        body: JSON.stringify({ model: cfg('model', 'llama-3.1-kazllm-1.0-8b4'), stream: true, temperature: cfg('temperature', 0.4), max_tokens: cfg('maxTokens', 220),
          messages: [{ role: 'system', content: cfg('system', DEFAULT_PROMPT) }, ...history] }),
      });
      if (!r.ok) throw new Error(`${r.status} ${(await r.text().catch(() => '')).slice(0, 160)}`);
      const rd = r.body.getReader(), dec = new TextDecoder(); let line = '';
      for (;;) {
        const { done, value } = await rd.read(); if (done) break;
        line += dec.decode(value, { stream: true });
        const rows = line.split('\n'); line = rows.pop();
        for (const row of rows) {
          if (!row.startsWith('data:')) continue;
          const d = row.slice(5).trim(); if (d === '[DONE]') continue;
          let tok = ''; try { tok = JSON.parse(d).choices?.[0]?.delta?.content ?? ''; } catch { continue; }
          if (!tok) continue;
          if (first) { first = false; tFirst = performance.now() - t0; ctx.avatar.setEmotion('neutral'); }
          full += tok; buf += tok;
          for (let cut; (cut = sentenceEnd(buf)) > 0; ) { say(buf.slice(0, cut)); buf = buf.slice(cut); }      // целая фраза готова — сразу озвучиваем
        }
      }
      if (buf.trim()) say(buf);
      if (full.trim()) { history.push({ role: 'assistant', content: full.trim() }); ctx.bus.emit('brain.reply', { text: clean(full), ms_first_token: Math.round(tFirst), ms_total: Math.round(performance.now() - t0), chars: full.length }); }
      status(`готов (первый токен ${Math.round(tFirst)} мс, всего ${Math.round(performance.now() - t0)} мс)`);
    } catch (e) {
      if (e.name === 'AbortError') return;
      history.pop();
      status(`ошибка: ${e.message}`);
      ctx.ui.toast(`Мозг: ${e.message}. Проверьте, что сервер модели запущен: ${base()}`, 'err', 8000);
      ctx.avatar.setEmotion('neutral');
    } finally {
      if (abort === my) { busy = false; abort = null; ctx.bus.emit('brain.thinking', { on: false }); }
    }
  }

  function status(t) { if (ui.status) ui.status.textContent = `${cfg('model', '—')} · ${t}`; ctx?.ui.setStatus(`Мозг: ${t}`); }

  async function loadModels() {
    try {
      const r = await request('/models', { headers: headers() });
      const j = await r.json(); const ids = (j.data ?? []).map((m) => m.id);
      ui.models?.replaceChildren(...ids.map((id) => h('option', { value: id })));
      ui.info && (ui.info.textContent = ids.length ? `Связь есть. Моделей: ${ids.length}${viaProxy ? ' (через прокси движка)' : ''}` : 'Сервер ответил, но моделей нет — загрузите модель');
    } catch (e) { ui.info && (ui.info.textContent = `Нет связи с ${base()}: ${e.message}`); }
  }

  function buildPanel(el) {
    const field = (label, node, hint) => h('label', { class: 'row', style: 'flex-wrap:wrap' }, h('span', { class: 'row-text' }, h('b', {}, label), hint ? h('small', {}, hint) : null), node);
    const input = (key, def, attrs = {}) => { const i = h('input', { class: 'text-input', value: cfg(key, def), ...attrs }); i.onchange = () => { ctx.config.set(key, attrs.type === 'number' ? Number(i.value) : i.value.trim()); if (key === 'url') { viaProxy = false; loadModels(); } }; return i; };
    ui.info = h('div', { class: 'hint', style: 'margin:6px 0' }, '…'); ui.status = h('div', { class: 'hint' }, '');
    ui.models = h('datalist', { id: 'brain-models' });
    const model = input('model', 'llama-3.1-kazllm-1.0-8b4', { style: 'width:100%', list: 'brain-models' });
    const sys = h('textarea', { class: 'text-input', rows: 6, style: 'width:100%;resize:vertical' }); sys.value = cfg('system', DEFAULT_PROMPT); sys.onchange = () => ctx.config.set('system', sys.value);
    const test = h('input', { class: 'text-input', style: 'width:100%', value: 'Сәлем! Өзіңді таныстыршы.' });
    el.append(ui.info, ui.status, ui.models,
      field('Адрес сервера', input('url', 'http://localhost:1235/v1', { style: 'width:100%' }), 'LM Studio: Developer → Start Server. Ollama: http://localhost:11434/v1. OpenRouter: https://openrouter.ai/api/v1'),
      field('Модель', model), field('API-ключ', input('apiKey', '', { type: 'password', style: 'width:100%' }), 'Для LM Studio/Ollama не нужен'),
      field('Температура', input('temperature', 0.4, { type: 'number', step: '0.1', style: 'width:80px' })),
      field('Длина ответа (токенов)', input('maxTokens', 220, { type: 'number', style: 'width:80px' }), 'Короче — быстрее отвечает'),
      field('Память диалога (реплик)', input('history', 8, { type: 'number', style: 'width:80px' })),
      field('Характер и правила (system prompt)', sys),
      h('button', { class: 'btn', onclick: loadModels }, 'Проверить связь'), ' ',
      h('button', { class: 'btn', onclick: () => { history = []; ctx.ui.toast('Память диалога очищена'); } }, 'Забыть разговор'),
      field('Проверка', test), h('button', { class: 'btn primary', onclick: () => ask(test.value) }, 'Спросить'));
    loadModels();
  }

  return {
    async start(c) {
      ctx = c; h = ctx.ui.h; cfg = ctx.config.get; history = []; viaProxy = false;
      ctx.bus.on('hearing.transcript', ({ text, final }) => { if (final && cfg('auto', true) && text?.trim().length > 1) ask(text); });
      ctx.bus.on('brain.ask', ({ text }) => ask(text));
      ctx.bus.on('speech.stop', () => { /* прерывание речи не отменяет мысль: новый вопрос сам прервёт прошлый */ });
      ctx.ui.addPanel({ tab: 'engine', title: 'Мозг', render: buildPanel });
      status('готов');
    },
    async stop() { abort?.abort(); abort = null; busy = false; },
  };
}

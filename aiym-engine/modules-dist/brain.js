// «Мозг» — разговор с языковой моделью (LM Studio / Ollama / OpenRouter / любой OpenAI-совместимый сервер).
// Один файл: перетащите в окно движка или «Установить» в Настройках → Модули.
//
// Слушает: hearing.transcript {text, final} — ответ на фразу человека; brain.ask {text} — вопрос «из кода»;
//          speech.stop — прервать.
// Выдаёт:  speech.say {text} — по мере генерации, фраза за фразой (озвучивает модуль «Речь»);
//          brain.thinking {on}, brain.reply {text}.
export const meta = {
  id: 'brain', name: 'Мозг (LLM)', version: '0.16', engine: 1, category: 'brain',
  description: 'Языковая модель: LM Studio / Ollama / OpenRouter. Потоковый ответ, озвучка по фразам.',
};

const MARK = 'аталған дауыстық көмекшісің';       // по этому фрагменту узнаём наш стандартный характер (а не свой текст пользователя)
const NAMES_MARK = 'Өз атыңды жауап тіліне';
// «хвост» характера: как писать своё имя на каждом языке + в каком роде говорить по-русски
const suffixFor = (sp, gender) => `${sp ? ` ${NAMES_MARK} қарай былай жаз: қазақша — "${sp.kk}", орысша — "${sp.ru}", ағылшынша — "${sp.en}".` : ''}${gender === 'male' ? ' Орысша сөйлегенде өзің туралы ер адам ретінде айт (я рад, я готов).' : ' Орысша сөйлегенде өзің туралы әйел ретінде айт (я рада, я готова).'}`;
const promptFor = (name, gender, sp) => `Сен Қазақстандағы ақпараттық технологиялар мен жасанды зерде орталығының "${name}" ${MARK}. Әдепті, мейірімді, әзіл-қалжыңың жеңіл болсын. Қай тілде сөйлесе, сол тілде жауап бер: қазақша, орысша немесе ағылшынша. Қысқа әрі табиғи сөйле, жауаптарың бір-үш сөйлемнен аспасын. Белгілеу тілін, тізімдерді, көңіл күй белгілерін және сілтемелерді қолданба, өйткені жауаптарың дауыстап оқылады. Білмесең, оны ашық айт.${suffixFor(sp, gender)}`;

// язык по тексту: казахские буквы → kk, кириллица → ru, латиница → en
const KK_LETTERS = /[әіңғүұқөһӘІҢҒҮҰҚӨҺ]/;
const guessLang = (t) => (KK_LETTERS.test(t) ? 'kk' : /[а-яё]/i.test(t) ? 'ru' : /[a-z]/i.test(t) ? 'en' : 'ru');
// казахские слова, которые пишутся без особых букв (Whisper иногда пишет казахскую речь «по-русски» и ставит язык ru)
const KK_WORDS = new Set(['мен', 'сен', 'сиз', 'биз', 'олар', 'бар', 'жок', 'жоқ', 'бе', 'ма', 'ме', 'па', 'пе', 'ба', 'кім', 'ким', 'неге', 'кайда', 'калай', 'канша', 'кашан', 'деп', 'жане', 'туралы', 'керек', 'айтшы', 'айтып', 'бер', 'беріңіз', 'рахмет', 'салем', 'салеметсиз', 'иа', 'жаксы', 'атын', 'атың', 'атынды', 'сенин', 'менин', 'бизге', 'маган', 'саган', 'осы', 'бул', 'анау', 'кандай', 'нешe', 'болады', 'емес', 'гой', 'шы', 'ши']);
/** Язык реплики: казахские буквы и слова важнее метки распознавателя (он путает kk и ru). */
function langOf(text, hint) {
  const words = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  if (KK_LETTERS.test(text)) {
    const cyr = words.filter((w) => /[а-яёәіңғүұқөһ]/.test(w)), kkw = cyr.filter((w) => KK_LETTERS.test(w) || KK_WORDS.has(w));
    return cyr.length >= 4 && kkw.length / cyr.length < 0.3 ? 'ru' : 'kk';      // одно казахское слово в русской фразе — фраза всё равно русская
  }
  const kk = words.filter((w) => KK_WORDS.has(w)).length;
  if (/[а-яё]/i.test(text) && (kk >= 2 || (kk >= 1 && words.length <= 4))) return 'kk';
  if (hint === 'ru' && !/[а-яё]/i.test(text) && /[a-z]/i.test(text)) return 'en';
  return hint || guessLang(text);
}
const KK2RU = { ә: 'а', і: 'и', ң: 'н', ғ: 'г', ү: 'у', ұ: 'у', қ: 'к', ө: 'о', һ: 'х', Ә: 'А', І: 'И', Ң: 'Н', Ғ: 'Г', Ү: 'У', Ұ: 'У', Қ: 'К', Ө: 'О', Һ: 'Х' };
const toRu = (t) => t.replace(/[әіңғүұқөһӘІҢҒҮҰҚӨҺ]/g, (c) => KK2RU[c]);
// подсказка прямо в последней реплике: маленькие модели слушаются её лучше, чем системного текста (в историю не пишется)
const LANG_HINT = { kk: '(Қазақша жауап бер.)', ru: '(Ответь по-русски.)', en: '(Answer in English.)' };
const LANG_LINE = { kk: 'Пайдаланушы қазір қазақша сөйлеп тұр — қазақша жауап бер.', ru: 'Пользователь сейчас говорит по-русски — отвечай по-русски.', en: 'The user is speaking English now — reply in English.' };
// пользователь прервал: ответ был не по теме — не продолжать, извиниться и уточнить
const REDIRECT_LINE = "The user just interrupted you because your previous answer was off-topic or wrong. Do NOT continue or repeat it. Apologize in one short sentence and ask what exactly they need. Reply in the user's language.";
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// чистим то, что нельзя произносить
// модели, которые не умеют вести диалог (речь, эмбеддинги, реранкеры) — для «auto» пропускаем
const NOT_CHAT = /voxtral|whisper|embed|tts|rerank|speech|asr|wav2vec/i;
const clean = (t) => t.replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>~]+/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1')
  .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim();

// позиция конца первой «достаточно длинной» фразы (≥14 знаков, чтобы «Да.» и «1.» не озвучивались отдельно) или -1
function sentenceEnd(buf) {
  const re = /[.!?…]+(?=\s)|\n/g;
  for (let m; (m = re.exec(buf)); ) { const end = m.index + m[0].length; if (end >= 14) return end; }
  return -1;
}

export default function create() {
  let ctx, h, cfg, history = [], abort = null, busy = false, viaProxy = false, lastModel = '', loadedList = [];
  const ui = {};

  const base = () => cfg('url', 'http://localhost:1235/v1').replace(/\/+$/, '');
  const headers = () => ({ 'Content-Type': 'application/json', ...(cfg('apiKey', '') ? { Authorization: `Bearer ${cfg('apiKey', '')}` } : {}) });

  // прямой запрос; если браузер блокирует (CORS) — через мини-прокси движка (/api/proxy)
  async function request(path, init) {
    const url = /^https?:/.test(path) ? path : `${base()}${path}`;
    if (!viaProxy) {
      try { return await fetch(url, init); }
      catch (e) { if (e.name === 'AbortError') throw e; viaProxy = true; ctx.log('прямой запрос не прошёл (CORS?), перехожу на прокси движка'); }
    }
    return fetch('/api/proxy', { ...init, headers: { ...init.headers, 'X-Target-Url': url } });
  }

  // Модель «auto» = та, что сейчас загружена в LM Studio (родной эндпоинт /api/v0/models), иначе первая из списка /v1/models
  let autoModel = { id: '', at: -99 };
  // список моделей сервера (кэш 30 с): [{id, loaded}]
  let models = { at: -99, list: [] };
  // ───────── LM Studio: список, загрузка и выгрузка моделей (родной REST API: /api/v1 в LM Studio 0.4+, иначе /api/v0 — только список) ─────────
  const lmRoot = () => base().replace(/\/v1$/, '');
  async function lmList() {
    try {
      const r = await request(`${lmRoot()}/api/v1/models`, { headers: headers() });
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j.models)) return { v: 1, list: j.models.map((m) => ({ key: m.key, name: m.display_name || m.key, type: m.type ?? 'llm', quant: m.quantization?.name ?? '', size: m.size_bytes ?? 0, inst: (m.loaded_instances ?? []).map((i) => i.id), maxCtx: m.max_context_length })) };
      }
    } catch { /* старая LM Studio или не LM Studio */ }
    try {
      const j = await (await request(`${lmRoot()}/api/v0/models`, { headers: headers() })).json();
      if (Array.isArray(j.data)) return { v: 0, list: j.data.map((m) => ({ key: m.id, name: m.id, type: m.type ?? 'llm', quant: m.quantization ?? '', size: 0, inst: m.state === 'loaded' ? [m.id] : [], maxCtx: m.max_context_length })) };
    } catch { /* не LM Studio */ }
    return { v: -1, list: [] };
  }
  async function lmPost(path, body) {
    const r = await request(`${lmRoot()}/api/v1/models/${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message ?? j.error ?? `HTTP ${r.status}`);
    return j;
  }
  // всё на видеокарте: KV-кэш в видеопамяти, Flash Attention (слои модели LM Studio кладёт на GPU сама — «GPU Offload: Max» в её настройках)
  const lmLoad = (key) => lmPost('load', { model: key, context_length: Number(cfg('ctxLen', 8192)) || 8192, flash_attention: true, offload_kv_cache_to_gpu: true });
  const lmUnload = (id) => lmPost('unload', { instance_id: id });
  const isChat = (m) => /llm|vlm/.test(m.type) && !NOT_CHAT.test(m.key);
  /** Сделать модель рабочей: (по желанию) выгрузить остальные чат-модели, загрузить её, записать в настройки. */
  async function useModel(key) {
    const { v, list } = await lmList();
    if (v !== 1) { ctx.config.set('model', key); throw new Error('загрузка по API нужна LM Studio 0.4+ — модель записана в настройки, загрузите её в LM Studio вручную'); }
    if (cfg('unloadOthers', true)) for (const m of list) if (m.key !== key && isChat(m)) for (const id of m.inst) await lmUnload(id);     // освобождаем видеопамять
    const me = list.find((m) => m.key === key);
    if (!me?.inst.length) await lmLoad(key);
    ctx.config.set('model', key); models.at = -99; autoModel = { id: '', at: -99 }; warnedModel = '';
  }

  async function modelList() {
    if (performance.now() / 1000 - models.at < 30) return models.list;
    let list = (await lmList()).list.map((m) => ({ id: m.key, loaded: m.inst.length > 0, type: m.type }));
    if (!list.length) { try { list = ((await (await request('/models', { headers: headers() })).json()).data ?? []).map((x) => ({ id: x.id, loaded: true })); } catch { /* нет связи */ } }
    models = { at: performance.now() / 1000, list };
    return list;
  }
  const squash = (x) => String(x).toLowerCase().replace(/^.*\//, '').replace(/[^a-z0-9]/g, '');
  // имя из настроек → настоящий id на сервере: «Gemma4-26B-A4B-…-Q3_K_M» ↔ «gemma4-26b-a4b-…»; иначе LM Studio молча отвечает загруженной моделью (KazLLM)
  function matchModel(m, list) {
    if (list.some((x) => x.id === m)) return m;
    const q = squash(m), score = (id) => { const a = squash(id); if (a === q) return 1e9; if (a && (q.includes(a) || a.includes(q))) return 1e6 + Math.min(a.length, q.length); let k = 0; while (k < a.length && a[k] === q[k]) k++; return k; };
    const best = list.filter((x) => !NOT_CHAT.test(x.id)).map((x) => ({ ...x, s: score(x.id) + (x.loaded ? 0.5 : 0) })).sort((a, b) => b.s - a.s)[0];
    return best && best.s >= 6 ? best.id : null;
  }
  let warnedModel = '';
  function warnModel(key, msg) { if (warnedModel === key) return; warnedModel = key; ctx.ui.toast(msg, 'err', 12000); ctx.log(msg); }

  async function resolveModel() {
    const m = cfg('model', 'auto').trim();
    if (m && m !== 'auto') {
      const list = await modelList();
      if (!list.length) return m;
      const id = matchModel(m, list);
      if (!id) { warnModel(`nf:${m}`, `Мозг: модели «${m}» нет в LM Studio — сервер ответит той, что загружена. Выберите модель из списка в настройках Мозга.`); return m; }
      const e = list.find((x) => x.id === id);
      if (list.some((x) => 'loaded' in x) && e && !e.loaded) warnModel(`nl:${id}`, `Мозг: модель «${id}» не загружена в LM Studio — загрузите её (или включите JIT-загрузку), иначе ответит другая модель.`);
      return id;
    }
    if (autoModel.id && performance.now() / 1000 - autoModel.at < 20) return autoModel.id;
    let id = '';
    try { const { list } = await lmList(); loadedList = list.filter((m) => m.inst.length).map((m) => `${m.key} (${m.type})`); id = list.find((m) => m.inst.length && isChat(m))?.key ?? ''; } catch { /* дальше — старый способ */ }
    if (!id) try {
      const root = base().replace(/\/v1$/, '');
      const j = await (await request(`${root}/api/v0/models`, { headers: headers() })).json();
      const loaded = (j.data ?? []).filter((x) => x.state === 'loaded' && /llm|vlm/.test(x.type ?? 'llm') && !NOT_CHAT.test(x.id));
      loadedList = (j.data ?? []).filter((x) => x.state === 'loaded').map((x) => `${x.id} (${x.type})`);
      id = loaded[0]?.id ?? '';
    } catch { /* не LM Studio — пробуем стандартный список */ }
    if (!id) { try { id = ((await (await request('/models', { headers: headers() })).json()).data ?? []).map((x) => x.id).find((x) => !NOT_CHAT.test(x)) ?? ''; } catch { /* нет связи */ } }
    if (id) autoModel = { id, at: performance.now() / 1000 };
    return id || 'llama-3.1-kazllm-1.0-8b4';
  }

  // характер: свой текст из настроек главнее; если пусто или это наш прежний стандартный — подставляем по имени и полу персонажа
  const charName = () => ctx.engineConfig.get('assistant.name', 'Адина'), charGender = () => ctx.engineConfig.get('avatar.gender', 'female');
  const spokenNames = () => ctx.engineConfig.get('assistant.spoken', null);
  function effectiveSystem() {
    const s = (cfg('system', '') || '').trim();
    if (!s || s.includes(MARK)) return promptFor(charName(), charGender(), spokenNames());      // стандартный характер — по имени, полу и языку
    // свой текст главнее, но имена персонажей (Адина/Нұртуған…) в нём подставляем под того, кто сейчас на экране
    let t = s;
    for (const v of [...ctx.engineConfig.get('assistant.allVariants', [])].sort((x, y) => y.length - x.length)) t = t.replace(new RegExp(`(?<![\\p{L}])${esc(v)}`, 'giu'), charName());
    return t.includes(NAMES_MARK) ? t : t + suffixFor(spokenNames(), charGender());
  }


  // имя персонажа в ответе — в написании под язык ответа (для правильного произношения): Әдина / Адина / Adina, Нұртуған / Нуртуган / Nurtogee
  function fixName(text, userLang) {
    const sp = spokenNames(), vars = ctx.engineConfig.get('assistant.variants', []);
    if (!sp || !vars.length) { const l = /[а-яёa-z]/i.test(text) ? langOf(text, null) : userLang; return { text: l === 'ru' ? toRu(text) : text, lang: l }; }
    const re = (v) => new RegExp(`(?<![\\p{L}])${esc(v)}`, 'giu');
    const bare = vars.reduce((t, v) => t.replace(re(v), ' '), text);                      // язык определяем без самого имени (в нём бывают казахские буквы)
    const lang = /[а-яёa-z]/i.test(bare) || KK_LETTERS.test(bare) ? langOf(bare, null) : userLang;      // язык озвучки — по самому ответу: русский текст читает русский голос, даже если спрашивали по-казахски
    const to = sp[lang] ?? sp.ru;
    for (const v of vars) text = text.replace(re(v), to);
    return { text: lang === 'ru' ? toRu(text) : text, lang };
  }


  async function ask(text, lang, command) {
    text = text?.trim(); if (!text) return;
    lang = langOf(text, lang);
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
    const say = (s) => { s = clean(s); if (s.length > 1) { const f = fixName(s, lang); ctx.bus.emit('speech.say', { text: f.text, lang: f.lang }); } };
    try {
      const model = await resolveModel(); lastModel = model;
      const r = await request('/chat/completions', {
        method: 'POST', signal: my.signal, headers: headers(),
        body: JSON.stringify({ model, stream: true, temperature: cfg('temperature', 0.4), max_tokens: cfg('maxTokens', 220),
          messages: [{ role: 'system', content: `${effectiveSystem()}\n${LANG_LINE[lang] ?? ''}${command === 'redirect' ? `\n${REDIRECT_LINE}` : ''}` }, ...history.slice(0, -1), { role: 'user', content: `${text}\n${LANG_HINT[lang] ?? ''}` }] }),
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
          let tok = '', jd; try { jd = JSON.parse(d); tok = jd.choices?.[0]?.delta?.content ?? ''; } catch { continue; }
          if (jd?.model && squash(jd.model) !== squash(model) && !squash(jd.model).includes(squash(model)) && !squash(model).includes(squash(jd.model))) { lastModel = jd.model; warnModel(`sv:${jd.model}`, `Мозг: просили «${model}», а LM Studio отвечает моделью «${jd.model}». Загрузите нужную модель в LM Studio.`); }
          if (!tok) continue;
          if (first) { first = false; tFirst = performance.now() - t0; ctx.avatar.setEmotion('neutral'); }
          full += tok; buf += tok;
          for (let cut; (cut = sentenceEnd(buf)) > 0; ) { say(buf.slice(0, cut)); buf = buf.slice(cut); }      // целая фраза готова — сразу озвучиваем
        }
      }
      if (buf.trim()) say(buf);
      if (full.trim()) { history.push({ role: 'assistant', content: full.trim() }); ctx.bus.emit('brain.reply', { lang, text: fixName(clean(full), lang).text, ms_first_token: Math.round(tFirst), ms_total: Math.round(performance.now() - t0), chars: full.length }); }
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

  function status(t) { if (ui.status) ui.status.textContent = `${lastModel || cfg('model', 'auto')} · ${t}`; ctx?.ui.setStatus(`Мозг: ${t}`); }

  async function loadModels() {
    try {
      await resolveModel().catch(() => {});
      const r = await request('/models', { headers: headers() });
      const j = await r.json(); const ids = (j.data ?? []).map((m) => m.id);
      ui.models?.replaceChildren(h('option', { value: 'auto' }), ...ids.map((id) => h('option', { value: id })));
      ui.info && (ui.info.textContent = ids.length ? `Связь есть. Моделей: ${ids.length}${viaProxy ? ' (через прокси движка)' : ''}${loadedList.length ? ` · загружено в LM Studio: ${loadedList.join(', ')}` : ''}` : 'Сервер ответил, но моделей нет — загрузите модель');
    } catch (e) { ui.info && (ui.info.textContent = `Нет связи с ${base()}: ${e.message}`); }
  }

  const gb = (b) => (b ? `${(b / 1e9).toFixed(1)} ГБ` : '');
  let lmBusy = false, lmTok = 0;
  async function renderLm() {
    if (!ui.lm) return;
    const tok = ++lmTok, { v, list } = await lmList();
    if (tok !== lmTok) return;                                            // пришёл ответ на устаревший запрос — рисует более свежий
    if (ui.modelInput) ui.modelInput.value = cfg('model', 'auto');
    if (v < 0) { ui.lm.replaceChildren(h('div', { class: 'hint' }, 'LM Studio не отвечает (Developer → Start Server).')); return; }
    const cur = cfg('model', 'auto');
    const rows = list.filter((m) => m.type !== 'embedding' && m.type !== 'embeddings').sort((a, b) => (b.inst.length - a.inst.length) || a.name.localeCompare(b.name)).map((m) => {
      const on = m.inst.length > 0, chat = isChat(m), using = cur !== 'auto' ? cur === m.key : on && chat;
      const act = (label, fn, primary) => h('button', { class: `btn${primary ? ' primary' : ''}`, disabled: lmBusy || (v !== 1 && label !== 'Использовать'), onclick: async () => {
        lmBusy = true; renderLm(); status(`${label.toLowerCase()}: ${m.name}…`);
        try { await fn(); ctx.ui.toast(`${label}: ${m.name} — готово`); } catch (e) { ctx.ui.toast(`LM Studio: ${e.message}`, 'err', 9000); }
        lmBusy = false; models.at = -99; renderLm(); loadModels(); status('готов');
      } }, label);
      return h('div', { style: `display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 8px;border-radius:8px;border:1px solid ${using ? 'var(--accent, #d9a566)' : 'rgba(127,127,127,.25)'}` },
        h('span', { style: 'flex:1;min-width:160px' }, h('b', {}, m.name), h('small', { class: 'hint', style: 'display:block' }, [m.key, m.type, m.quant, gb(m.size)].filter(Boolean).join(' · '))),
        h('small', { style: `color:${on ? '#5fbf7a' : 'inherit'};opacity:${on ? 1 : 0.6}` }, on ? (using ? '● отвечает' : '● загружена') : '○ не загружена'),
        chat && !using ? act('Использовать', () => useModel(m.key), true) : null,
        v === 1 && !on ? act('Загрузить', () => lmLoad(m.key)) : null,
        v === 1 && on ? act('Выгрузить', async () => { for (const id of m.inst) await lmUnload(id); if (cur === m.key) ctx.config.set('model', 'auto'); }) : null);
    });
    ui.lm.replaceChildren(...rows, ...(v !== 1 ? [h('div', { class: 'hint' }, 'Загрузка и выгрузка по API — в LM Studio 0.4 и новее. Сейчас доступен только список.')] : []),
      h('button', { class: 'btn', style: 'align-self:flex-start', onclick: () => { models.at = -99; renderLm(); } }, 'Обновить список'));
  }

  function buildPanel(el) {
    const field = (label, node, hint) => h('label', { class: 'row', style: 'flex-wrap:wrap' }, h('span', { class: 'row-text' }, h('b', {}, label), hint ? h('small', {}, hint) : null), node);
    const input = (key, def, attrs = {}) => { const i = h('input', { class: 'text-input', value: cfg(key, def), ...attrs }); i.onchange = () => { ctx.config.set(key, attrs.type === 'number' ? Number(i.value) : i.value.trim()); if (key === 'url') { viaProxy = false; loadModels(); } }; return i; };
    ui.info = h('div', { class: 'hint', style: 'margin:6px 0' }, '…'); ui.status = h('div', { class: 'hint' }, '');
    ui.models = h('datalist', { id: 'brain-models' });
    const model = ui.modelInput = input('model', 'auto', { style: 'width:100%', list: 'brain-models' });
    ui.lm = h('div', { style: 'display:flex;flex-direction:column;gap:6px;margin:4px 0 10px' });
    const sys = h('textarea', { class: 'text-input', rows: 6, style: 'width:100%;resize:vertical' }); sys.value = effectiveSystem(); sys.onchange = () => ctx.config.set('system', sys.value);
    const test = h('input', { class: 'text-input', style: 'width:100%', value: 'Сәлем! Өзіңді таныстыршы.' });
    el.append(ui.info, ui.status, ui.models,
      field('Адрес сервера', input('url', 'http://localhost:1235/v1', { style: 'width:100%' }), 'LM Studio: Developer → Start Server. Ollama: http://localhost:11434/v1. OpenRouter: https://openrouter.ai/api/v1'),
h('div', { class: 'group-sub', style: 'margin:8px 0 2px' }, h('b', {}, 'Модели LM Studio'), h('small', { class: 'hint', style: 'display:block' }, '«Использовать» — загрузить модель в LM Studio и отвечать ею. Список берётся прямо из LM Studio.')),
      ui.lm,
      field('Выгружать остальные', h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: cfg('unloadOthers', true), onchange: (e) => ctx.config.set('unloadOthers', e.target.checked) }), h('span', {})), 'При выборе модели выгрузить другие чат-модели, чтобы не занимали видеопамять'),
      field('Контекст при загрузке (токенов)', input('ctxLen', 8192, { type: 'number', style: 'width:90px' }), 'Больше — помнит длиннее, но ест больше видеопамяти'),
      field('Модель', model, '«auto» — брать ту, что загружена в LM Studio сейчас (рекомендуется). Или выберите/впишите имя модели.'), field('API-ключ', input('apiKey', '', { type: 'password', style: 'width:100%' }), 'Для LM Studio/Ollama не нужен'),
      field('Температура', input('temperature', 0.4, { type: 'number', step: '0.1', style: 'width:80px' })),
      field('Длина ответа (токенов)', input('maxTokens', 220, { type: 'number', style: 'width:80px' }), 'Короче — быстрее отвечает'),
      field('Отвечать только когда назвали по имени', h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: cfg('wakeByName', false), onchange: (e) => ctx.config.set('wakeByName', e.target.checked) }), h('span', {})), 'Выкл — отвечает на всё, что слышит. Вкл — только на обращение: «Адина, …» или «Нұртуған, …»'),
      field('Память диалога (реплик)', input('history', 8, { type: 'number', style: 'width:80px' })),
      field('Характер и правила (system prompt)', sys),
      h('button', { class: 'btn', onclick: loadModels }, 'Проверить связь'), ' ',
      h('button', { class: 'btn', onclick: () => { history = []; ctx.ui.toast('Память диалога очищена'); } }, 'Забыть разговор'),
      ' ', h('button', { class: 'btn', onclick: () => { ctx.config.set('system', ''); sys.value = effectiveSystem(); ctx.ui.toast('Характер сброшен на значение по умолчанию'); } }, 'Характер по умолчанию'),
      field('Проверка', test), h('button', { class: 'btn primary', onclick: () => ask(test.value) }, 'Спросить'));
    loadModels(); renderLm();
  }

  return {
    async start(c) {
      ctx = c; h = ctx.ui.h; cfg = ctx.config.get; history = []; viaProxy = false;
      const oldSys = cfg('system', ''); if (oldSys.includes('Айым')) ctx.config.set('system', oldSys.replaceAll('Айым', 'Адина'));   // имя ассистента теперь Адина
      ctx.bus.on('hearing.transcript', (p) => {
        if (!p.final || p.handled || p.ignore || !cfg('auto', true) || (p.text?.trim().length ?? 0) < 2) return;
        if (cfg('wakeByName', false) && !p.addressed) return;                       // режим «отвечать только когда назвали по имени»
        ask(p.text, p.lang, p.command);
      });
      ctx.bus.on('assistant.stop', () => {                                           // «стоп»: бросаем генерацию, замолкаем
        abort?.abort(); abort = null; busy = false;
        ctx.bus.emit('brain.thinking', { on: false }); ctx.avatar.setEmotion('neutral'); status('остановлено');
      });
      ctx.bus.on('brain.ask', ({ text, lang }) => ask(text, lang));
      ctx.bus.on('speech.stop', () => { /* прерывание речи не отменяет мысль: новый вопрос сам прервёт прошлый */ });
      ctx.ui.addPanel({ tab: 'engine', title: 'Мозг', render: buildPanel });
      status('готов');
    },
    async stop() { abort?.abort(); abort = null; busy = false; },
  };
}

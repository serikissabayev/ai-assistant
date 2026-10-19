// «Слух» — стерео-микрофон, определение голоса и направления на говорящего, распознавание речи.
// Один файл: перетащите его в окно движка (Настройки → Модули → «Открыть файл…»).
//
// Выдаёт события:
//   hearing.level   {level, left, right}     ~10 раз/с — громкость
//   hearing.voice   {active}                  голос начался / закончился
//   hearing.speaker {x, confidence}           x ∈ [−1, 1]: −1 — слева на экране, +1 — справа
//   hearing.transcript {text, final}          распознанная речь (final=true — фраза закончена)
// Слушает: speech.start / speech.end (пока ассистент говорит — не распознаёт её же голос),
//          vision.speaker (если «Зрение» уже ведёт взгляд по лицу, слух взгляд не трогает).
export const meta = {
  id: 'hearing', name: 'Слух', version: '0.9', engine: 1, category: 'input',
  description: 'Стерео-микрофон, голос, направление на говорящего, распознавание речи (браузер или свой сервер Whisper).',
};

const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

const WORKLET = `class P extends AudioWorkletProcessor{process(i){const c=i[0];if(c&&c.length){const n=c[0].length,m=new Float32Array(n);for(let k=0;k<c.length;k++){const ch=c[k];for(let j=0;j<n;j++)m[j]+=ch[j]/c.length}this.port.postMessage(m,[m.buffer])}return true}}registerProcessor('adina-capture',P)`;

function wavFrom(chunks, sampleRate) {
  let n = 0; for (const c of chunks) n += c.length;
  const step = sampleRate / 16000, out = new Int16Array(Math.floor(n / step));
  const flat = new Float32Array(n); let o = 0; for (const c of chunks) { flat.set(c, o); o += c.length; }
  for (let i = 0; i < out.length; i++) {
    let s = 0, k = 0; for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step) && j < n; j++, k++) s += flat[j];
    out[i] = Math.max(-1, Math.min(1, s / (k || 1))) * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + out.length * 2), v = new DataView(buf);
  const w = (p, s) => [...s].forEach((ch, i) => v.setUint8(p + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + out.length * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, out.length * 2, true); new Int16Array(buf, 44).set(out);
  return new Blob([buf], { type: 'audio/wav' });
}

export default function create() {
  let ctx, h, cfg, audio, stream, src, nodes = [], bufL, bufR, workletUrl;
  let stopped = false, rec = null, restartTimer = 0, speakingSelf = false, lastVision = -99;
  // пока она говорит сама, слушаем короткими «окнами» ради команд «стоп»/«тоқта»; всё остальное движок отбросит
  let selfBuf = [], selfN = 0, selfPeak = 0, echoAvg = 0.02, selfTimer = 0, selfBusy = false;
  const S = { floor: 0.003, level: 0, left: 0, right: 0, voice: false, above: 0, below: 0, x: 0, conf: 0, frame: 0, lastEmit: 0, channels: 1 };
  let preroll = [], utter = null, ui = {};

  // ───────── микрофон и анализ ─────────
  async function openAudio() {
    const deviceId = cfg('deviceId', '');
    stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 2, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    S.channels = stream.getAudioTracks()[0].getSettings().channelCount ?? 1;
    audio = new AudioContext({ latencyHint: 'interactive' });
    const resume = () => audio?.state === 'suspended' && audio.resume().catch(() => {});
    resume(); addEventListener('pointerdown', resume, { once: true }); addEventListener('keydown', resume, { once: true });
    src = audio.createMediaStreamSource(stream);
    const split = audio.createChannelSplitter(2);
    src.connect(split);
    const mk = (i) => { const a = audio.createAnalyser(); a.fftSize = 2048; a.smoothingTimeConstant = 0; split.connect(a, Math.min(i, S.channels - 1)); return a; };
    const aL = mk(0), aR = mk(1);
    bufL = new Float32Array(2048); bufR = new Float32Array(2048);
    nodes = [split, aL, aR];
    S.aL = aL; S.aR = aR;
    if (cfg('sttMode', 'browser') === 'server') {
      workletUrl = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
      await audio.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(audio, 'adina-capture'), mute = audio.createGain(); mute.gain.value = 0;
      src.connect(node); node.connect(mute); mute.connect(audio.destination); nodes.push(node, mute);
      node.port.onmessage = (e) => {
        const c = e.data; if (!audio) return;
        if (speakingSelf) { selfBuf.push(c); selfN += c.length; while (selfN > 2.4 * audio.sampleRate) selfN -= selfBuf.shift().length; return; }
        selfBuf = []; selfN = 0;
        if (utter) utter.push(c); else { preroll.push(c); if (preroll.length > (0.5 * audio.sampleRate) / 128) preroll.shift(); }
      };
    }
    ctx.log(`микрофон: ${S.channels} кан., ${audio.sampleRate} Гц`);
  }

  function closeAudio() {
    try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { nodes.forEach((n) => n.disconnect()); src?.disconnect(); audio?.close(); } catch { /* ignore */ }
    if (workletUrl) URL.revokeObjectURL(workletUrl);
    stream = audio = src = null; nodes = []; workletUrl = null;
  }

  const rms = (b) => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length); };

  function itd() {              // сдвиг между каналами → направление (для двух разнесённых микрофонов)
    const maxLag = Math.max(2, Math.round((cfg('micSpacing', 0.17) / 343) * audio.sampleRate)), N = 1024;
    let best = -Infinity, bestLag = 0, e = 1e-9;
    for (let i = 0; i < N; i++) e += bufL[i] * bufL[i] + bufR[i] * bufR[i];
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      let c = 0; for (let i = maxLag; i < N - maxLag; i++) c += bufL[i] * bufR[i + lag];
      if (c > best) { best = c; bestLag = lag; }
    }
    return { x: -bestLag / maxLag, conf: Math.min(1, (2 * best) / e) };
  }

  function analyse(dt, t) {
    if (!audio) return;
    S.aL.getFloatTimeDomainData(bufL); S.aR.getFloatTimeDomainData(bufR);
    const swap = cfg('swap', false);
    const l = rms(swap ? bufR : bufL), r = rms(swap ? bufL : bufR);
    const level = Math.sqrt((l * l + r * r) / 2);
    S.left = l; S.right = r; S.level = level;
    if (speakingSelf) { echoAvg = echoAvg * 0.985 + level * 0.015; selfPeak = Math.max(selfPeak, level); }     // эхо собственного голоса — «фон», на него реагировать не надо

    // шумовой порог подстраивается сам
    S.floor += (level - S.floor) * (level < S.floor * 1.5 ? 0.03 : 0.0006);
    const ratio = 6.5 - cfg('sensitivity', 5) * 0.5;
    const thr = Math.max(S.floor * ratio, 0.006);
    if (level > thr) { S.above += dt; S.below = 0; } else { S.below += dt; S.above = 0; }
    if (!S.voice && S.above > 0.12) setVoice(true, t);
    if (S.voice && S.below > 0.7) setVoice(false, t);

    // направление
    if (S.voice && level > thr) {
      const method = cfg('method', 'level');
      const ild = Math.max(-1, Math.min(1, ((r - l) / (r + l + 1e-6)) * cfg('gain', 1.6)));
      let x = ild, conf = Math.min(1, level / (thr * 3));
      if (method !== 'level' && ++S.frame % 3 === 0) {
        const o = itd(); const xt = o.x * (swap ? -1 : 1);
        S.itd = { x: xt, conf: o.conf };
      }
      if (method === 'time' && S.itd) { x = S.itd.x; conf *= S.itd.conf; }
      if (method === 'both' && S.itd) { x = 0.5 * ild + 0.5 * S.itd.x; conf *= 0.5 + 0.5 * S.itd.conf; }
      S.x += (x * (cfg('mirror', false) ? -1 : 1) - S.x) * (1 - Math.exp(-dt * 8)); S.conf = conf;
    }

    if (t - S.lastEmit > 0.1) {
      S.lastEmit = t;
      ctx.bus.emit('hearing.level', { level, left: l, right: r });
      if (S.voice) {
        ctx.bus.emit('hearing.speaker', { x: S.x, confidence: S.conf });
        if (cfg('lookAtSpeaker', true) && t - lastVision > 1.5 && !speakingSelf) ctx.avatar.lookAtNormalized(S.x * cfg('gazeGain', 1), 0);
      }
    }
    draw();
  }

  function setVoice(on, t) {
    S.voice = on;
    ctx.bus.emit('hearing.voice', { active: on });
    if (cfg('sttMode', 'browser') === 'server') {
      if (speakingSelf) return;                      // во время своей речи обычные фразы не накапливаем (см. окна для «стоп»)
      if (on) utter = [...preroll];
      else if (!on && utter) { const chunks = utter; utter = null; preroll = []; sendToServer(chunks); }
    }
  }

  // ───────── распознавание речи ─────────
  function startStt() {
    stopStt();
    if (cfg('sttMode', 'browser') !== 'browser') return;
    if (!SR) { ctx.ui.toast('Этот браузер не умеет распознавать речь. Используйте Chrome или режим «Свой сервер».', 'err', 8000); return; }
    rec = new SR();
    rec.lang = { auto: 'kk-KZ', kk: 'kk-KZ', ru: 'ru-RU', en: 'en-US' }[cfg('langMode', 'auto')] ?? 'kk-KZ';          // встроенное распознавание браузера язык сам не определяет
    rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i], text = r[0].transcript.trim();
        if (!text || (speakingSelf && text.split(/\s+/).length > 3)) continue;          // во время своей речи — только короткие реплики (команды)
        emitText(text, r.isFinal, r[0].confidence, undefined, speakingSelf);
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stopped = true; ctx.ui.toast('Нет доступа к распознаванию речи — разрешите микрофон.', 'err', 8000); }
      else if (e.error === 'network') networkFallback();
    };
    rec.onend = () => { if (!stopped && rec) restartTimer = setTimeout(() => { try { rec?.start(); } catch { /* уже идёт */ } }, 300); };
    try { rec.start(); } catch (e) { ctx.log('stt start', e.message); }
  }

  // Встроенное распознавание браузера (особенно в Edge) часто отдаёт «network»: тогда сами переходим на локальный Whisper, если он запущен
  let netWarn = -99, switching = false;
  async function networkFallback() {
    if (switching) return; switching = true;
    try {
      const url = cfg('sttUrl', 'http://localhost:8000/v1').replace(/\/+$/, '');
      const ok = await fetch(`${url}/models`, { signal: AbortSignal.timeout(2500) }).then((r) => r.ok).catch(() => false);
      if (ok) {
        ctx.config.set('sttMode', 'server'); stopStt(); closeAudio(); await openAudio(); startStt();
        ctx.ui.toast('Браузерное распознавание недоступно — перешла на локальный Whisper.', 'ok', 6000);
      } else if (performance.now() / 1000 - netWarn > 60) {
        netWarn = performance.now() / 1000;
        ctx.ui.toast('Браузер не смог распознать речь (нет связи с сервисом). Запустите локальный Whisper: tools\\start_whisper.bat (установка: tools\\install_whisper.bat).', 'err', 12000);
      }
    } finally { switching = false; }
  }

  function stopStt() { clearTimeout(restartTimer); const r = rec; rec = null; try { r?.stop(); } catch { /* ignore */ } }

  function emitText(text, final, confidence, lang, selfSpeaking = false) {
    ctx.bus.emit('hearing.transcript', { text, final, confidence, lang, selfSpeaking });      // selfSpeaking — услышано, пока говорила она сама: движок учтёт только команды «стоп»
    ctx.ui.setCaption(text, { role: 'user', hold: final ? 3 : 0 });
    ui.last && (ui.last.textContent = text);
  }

  async function sendToServer(chunks, self = false) {
    if (!audio) return;
    const dur = chunks.reduce((n, c) => n + c.length, 0) / audio.sampleRate;
    if (dur < 0.4 || dur > 30 || (speakingSelf && !self)) return;
    const tSend = performance.now();
    try {
      const fd = new FormData();
      fd.append('file', wavFrom(chunks, audio.sampleRate), 'speech.wav');
      fd.append('model', cfg('sttModel', 'whisper-1')); fd.append('response_format', 'json');
      const lm = cfg('langMode', 'auto'); if (lm !== 'auto') fd.append('language', lm);          // «авто» — язык определяет сервер (kk / ru / en)
      const key = cfg('sttKey', '');
      const r = await fetch(`${cfg('sttUrl', 'http://localhost:8000/v1').replace(/\/+$/, '')}/audio/transcriptions`, { method: 'POST', body: fd, headers: key ? { Authorization: `Bearer ${key}` } : {} });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${((await r.json().catch(() => ({}))).error ?? '').slice(0, 200)}`);
      const j = await r.json(), text = (j.text ?? '').trim();
      if (text) { ctx.log(`распознано за ${Math.round(performance.now() - tSend)} мс [${j.language ?? '?'}]: ${text}`); emitText(text, true, 1, j.language, self); }
    } catch (e) { ctx.ui.toast(`Сервер распознавания не отвечает: ${e.message}`, 'err', 6000); }
  }

  // ───────── панель настроек ─────────
  function draw() {
    const c = ui.canvas; if (!c || !c.isConnected) return;
    const g = c.getContext('2d'), W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    const bar = (y, v, col) => { g.fillStyle = '#ffffff12'; g.fillRect(40, y, W - 50, 10); g.fillStyle = col; g.fillRect(40, y, (W - 50) * Math.min(1, Math.sqrt(v) * 2.4), 10); };
    g.fillStyle = '#8d8f98'; g.font = '11px sans-serif'; g.fillText('Л', 22, 18); g.fillText('П', 22, 36);
    bar(9, S.left, '#4fd69c'); bar(27, S.right, '#4fd69c');
    // направление
    const cx = 40 + (W - 50) / 2; g.fillStyle = '#ffffff12'; g.fillRect(40, 50, W - 50, 6);
    g.fillStyle = S.voice ? '#e0b070' : '#555'; g.beginPath(); g.arc(cx + S.x * ((W - 50) / 2 - 6), 53, 7, 0, 7); g.fill();
    g.fillStyle = S.voice ? '#e0b070' : '#8d8f98'; g.fillText(S.voice ? 'голос' : 'тишина', 40, 72);
  }

  function buildPanel(el) {
    const field = (label, node, hint) => h('label', { class: 'row', style: 'flex-wrap:wrap' }, h('span', { class: 'row-text' }, h('b', {}, label), hint ? h('small', {}, hint) : null), node);
    const sel = (key, def, options, after) => { const s = h('select', { class: 'text-input' }, options.map(([v, t]) => h('option', { value: v }, t))); s.value = cfg(key, def); s.onchange = () => { ctx.config.set(key, s.value); after?.(); }; return s; };
    const input = (key, def, attrs = {}, after) => { const i = h('input', { class: 'text-input', value: cfg(key, def), ...attrs }); i.onchange = () => { ctx.config.set(key, i.value.trim()); after?.(); }; return i; };
    const range = (key, def, min, max, step = 1) => h('input', { type: 'range', min, max, step, value: cfg(key, def), oninput: (e) => ctx.config.set(key, Number(e.target.value)) });
    const check = (key, def) => h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: cfg(key, def), onchange: (e) => ctx.config.set(key, e.target.checked) }), h('span', {}));

    ui.canvas = h('canvas', { width: 360, height: 80, style: 'width:100%;height:80px;border:1px solid var(--line-2);border-radius:10px;background:#0b0c0f' });
    ui.last = h('div', { class: 'hint', style: 'min-height:20px;margin:6px 0 10px' }, 'Скажите что-нибудь…');
    ui.mic = h('select', { class: 'text-input', style: 'width:100%' });
    navigator.mediaDevices.enumerateDevices().then((d) => {
      const list = d.filter((x) => x.kind === 'audioinput');
      ui.mic.replaceChildren(h('option', { value: '' }, 'По умолчанию'), ...list.map((x) => h('option', { value: x.deviceId }, x.label || 'Микрофон')));
      ui.mic.value = cfg('deviceId', '');
    });
    ui.mic.onchange = async () => { ctx.config.set('deviceId', ui.mic.value); closeAudio(); await openAudio().catch((e) => ctx.ui.toast(e.message, 'err')); };

    const serverBox = h('div', {}, field('Адрес сервера', input('sttUrl', 'http://localhost:8000/v1', { style: 'width:100%' }), 'Любой OpenAI-совместимый /audio/transcriptions (faster-whisper-server и др.)'), field('Модель', input('sttModel', 'whisper-1')), field('API-ключ', input('sttKey', '', { type: 'password' })));
    const modeSel = sel('sttMode', 'browser', [['browser', 'В браузере (Chrome, нужен интернет)'], ['server', 'Свой сервер Whisper'], ['off', 'Не распознавать']], async () => { serverBox.style.display = cfg('sttMode') === 'server' ? '' : 'none'; closeAudio(); await openAudio(); startStt(); });
    serverBox.style.display = cfg('sttMode', 'browser') === 'server' ? '' : 'none';

    el.append(
      ui.canvas, ui.last,
      field('Микрофон', ui.mic),
      field('Язык речи', sel('langMode', 'auto', [['auto', 'Авто — как говорю, так и ответит'], ['kk', 'Қазақша'], ['ru', 'Русский'], ['en', 'English']], startStt)),
      field('Распознавание', modeSel), serverBox,
      h('div', { class: 'row-text', style: 'margin-top:14px' }, h('b', {}, 'Направление на говорящего')),
      field('Способ', sel('method', 'level', [['level', 'По громкости каналов (стерео-пара)'], ['time', 'По задержке (два разнесённых микрофона)'], ['both', 'Оба']])),
      field('Расстояние между капсюлями, м', input('micSpacing', 0.17, { type: 'number', step: '0.01', style: 'width:90px' }, () => ctx.config.set('micSpacing', Number(ctx.config.get('micSpacing'))))),
      field('Усиление', range('gain', 1.6, 0.5, 4, 0.1)),
      field('Чувствительность к голосу', range('sensitivity', 5, 1, 10)),
      field('Поменять левый/правый', check('swap', false), 'Если взгляд отворачивается в другую сторону'),
      field('Взгляд на говорящего', check('lookAtSpeaker', true), 'Аватар поворачивается к тому, кто говорит'),
    );
  }

  return {
    async start(c) {
      ctx = c; h = ctx.ui.h; cfg = ctx.config.get; stopped = false;
      await openAudio();
      ctx.bus.on('speech.start', () => { speakingSelf = true; utter = null; selfPeak = 0; });
      ctx.bus.on('speech.end', () => { setTimeout(() => { speakingSelf = false; selfBuf = []; selfN = 0; }, 500); });
      selfTimer = setInterval(() => {              // раз в ~секунду: если громкость заметно выше эха — отправляем последние ~2 с на распознавание
        if (!speakingSelf || selfBusy || !selfBuf.length || cfg('sttMode', 'browser') !== 'server') return;
        const loud = selfPeak > echoAvg * 1.6 && selfPeak > 0.02; selfPeak = 0;
        if (!loud) return;
        selfBusy = true; sendToServer([...selfBuf], true).finally(() => { selfBusy = false; });
      }, 1100);
      ctx.bus.on('vision.speaker', () => { lastVision = performance.now() / 1000; });
      ctx.onFrame((dt, t) => analyse(dt, t));
      ctx.ui.addPanel({ tab: 'engine', title: 'Слух', render: buildPanel });
      startStt();
      ctx.ui.setStatus('Слух');
    },
    async stop() { stopped = true; clearInterval(selfTimer); stopStt(); closeAudio(); utter = null; preroll = []; selfBuf = []; },
  };
}

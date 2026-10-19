// «Речь» — голос Айым через Piper (локальный нейро-TTS на сервере движка), губы по звуку.
// Один файл: перетащите его в окно движка. Сервер: tools/install_piper.sh (ставит Piper и голоса в voices/).
//
// Слушает: speech.say {text}  — сказать (очередь), speech.stop — замолчать.
// Выдаёт:  speech.start {text}, speech.end — вокруг каждой фразы (модуль «Слух» в это время не слушает).
export const meta = {
  id: 'speech', name: 'Речь', version: '0.2', engine: 1, category: 'output',
  description: 'Голос через Piper (локально): казахский и русский, синхронизация губ по звуку.',
};

// огибающая громкости: RMS по окнам 20 мс
function envelope(buf) {
  const d = buf.getChannelData(0), win = Math.max(1, Math.round(buf.sampleRate * 0.02));
  const env = new Float32Array(Math.ceil(d.length / win));
  for (let i = 0; i < env.length; i++) {
    let s = 0, n = 0;
    for (let j = i * win; j < Math.min(d.length, (i + 1) * win); j++, n++) s += d[j] * d[j];
    env[i] = Math.sqrt(s / (n || 1));
  }
  const sorted = [...env].sort((a, b) => a - b), top = sorted[Math.floor(sorted.length * 0.95)] || 1e-4;
  for (let i = 0; i < env.length; i++) env[i] = Math.min(1, env[i] / top);
  return { env, step: 0.02 };
}

export default function create() {
  let ctx, h, cfg, audio, gain, queue = [], cur = null, busy = false, stopped = false;
  const ui = {};

  const split = (text) => text.replace(/\s+/g, ' ').trim().match(/[^.!?…]+[.!?…]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];

  async function fetchWav(text) {
    const r = await fetch(`${cfg('server', '')}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: cfg('voice', 'auto') }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    return audio.decodeAudioData(await r.arrayBuffer());
  }

  // ошибку озвучки показываем не чаще раза в минуту, с подсказкой под систему пользователя
  let lastWarn = -99;
  function warn(msg) {
    if (performance.now() / 1000 - lastWarn < 60) return;
    lastWarn = performance.now() / 1000;
    const win = /win/i.test(navigator.platform);
    const hint = /Piper|голос/i.test(msg) ? ` Установка голоса: ${win ? 'tools\\install_piper.bat' : './tools/install_piper.sh'}, затем перезапуск движка.` : '';
    ctx.ui.toast(`Речь: ${msg.replace(/: запустите tools\/install_piper\.sh/, '')}.${hint} Пока она двигает губами без звука.`, 'err', 9000);
  }

  async function run() {
    if (busy) return; busy = true;
    ctx.bus.emit('speech.start', { text: queue.join(' ') });
    let pre = null;                                   // {text, p} — следующая фраза синтезируется, пока играет текущая
    while (queue.length && !stopped) {
      const text = queue.shift();
      const buf = await (pre?.text === text ? pre.p : fetchWav(text).catch((e) => e));
      pre = queue.length ? { text: queue[0], p: fetchWav(queue[0]).catch((e) => e) } : null;
      if (stopped) break;
      if (buf instanceof Error) { warn(buf.message); await silent(text); continue; }   // хотя бы губами
      await play(text, buf);
    }
    ctx.avatar.endSpeech(); busy = false; cur = null;
    ctx.bus.emit('speech.end', {});
  }

  function play(text, buf) {
    return new Promise((resolve) => {
      if (audio.state === 'suspended') audio.resume().catch(() => {});
      const { env, step } = envelope(buf);
      let a = 0, b = env.length - 1;
      while (a < b && env[a] < 0.08) a++;
      while (b > a && env[b] < 0.08) b--;
      const { events, duration } = ctx.util.lipsync.textToVisemes(text);
      const src = audio.createBufferSource(); src.buffer = buf; src.connect(gain);
      const t0 = audio.currentTime + 0.05;
      cur = { events, scale: Math.max(0.1, (b - a) * step) / (duration || 1), lead: a * step, env, step, t0, end: t0 + buf.duration, src, resolve };
      src.onended = () => { if (cur?.src === src) { cur = null; } resolve(); };
      src.start(t0);
      ctx.avatar.setSpeaking(1);
      ctx.ui.setCaption(text, { role: 'assistant', hold: buf.duration + 2 });
    });
  }

  // запасной вариант без звука: губы по тексту
  function silent(text) {
    return new Promise((resolve) => {
      const { events, duration } = ctx.util.lipsync.textToVisemes(text);
      cur = { events, scale: 1, lead: 0, env: null, step: 0.02, t0: audio.currentTime, end: audio.currentTime + duration, resolve, fake: true };
      ctx.avatar.setSpeaking(1);
      ctx.ui.setCaption(text, { role: 'assistant', hold: duration + 2 });
    });
  }

  function tick() {
    if (!cur) return;
    const el = audio.currentTime - cur.t0;
    if (el < 0) return;
    if (cur.fake) { if (audio.currentTime > cur.end) { const r = cur.resolve; cur = null; r(); return; } }
    const e = cur.env ? cur.env[Math.min(cur.env.length - 1, Math.floor(el / cur.step))] ?? 0 : 1;
    const k = (el - cur.lead) / cur.scale;
    const ev = cur.events.find((x) => k >= x.at && k < x.at + x.dur);
    if (ev && ev.v !== 'sil' && e > 0.06) ctx.avatar.setViseme(ev.v, (ev.weight ?? 1) * Math.min(1, 0.35 + e));
    else if (e > 0.12) ctx.avatar.setMouthOpen(e * 0.5), ctx.avatar.setVisemes({});
    else ctx.avatar.setVisemes({});
  }

  function interrupt() {
    queue = []; stopped = true;
    try { cur?.src?.stop(); } catch { /* уже остановлен */ }
    cur?.resolve?.(); cur = null;
    setTimeout(() => { stopped = false; }, 0);
  }

  async function refreshVoices() {
    try {
      const r = await (await fetch(`${cfg('server', '')}/api/voices`)).json();
      ui.voice?.replaceChildren(h('option', { value: 'auto' }, 'Авто (по языку текста)'), ...r.voices.map((v) => h('option', { value: v }, v)));
      if (ui.voice) ui.voice.value = cfg('voice', 'auto');
      ui.info && (ui.info.textContent = !r.piper ? 'Piper не найден — запустите tools/install_piper.sh' : r.voices.length ? `Голосов: ${r.voices.length}` : 'Голосов нет — запустите tools/install_piper.sh');
    } catch { ui.info && (ui.info.textContent = 'Сервер не отвечает (нужен ./start.sh)'); }
  }

  function buildPanel(el) {
    const field = (label, node, hint) => h('label', { class: 'row', style: 'flex-wrap:wrap' }, h('span', { class: 'row-text' }, h('b', {}, label), hint ? h('small', {}, hint) : null), node);
    ui.info = h('div', { class: 'hint', style: 'margin:6px 0 10px' }, '…');
    ui.voice = h('select', { class: 'text-input', style: 'width:100%' });
    ui.voice.onchange = () => ctx.config.set('voice', ui.voice.value);
    const test = h('input', { class: 'text-input', style: 'width:100%', value: 'Сәлеметсіз бе! Мен Айыммын. Здравствуйте, чем могу помочь?' });
    el.append(
      ui.info, field('Голос', ui.voice),
      field('Громкость', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: cfg('volume', 1), oninput: (e) => { ctx.config.set('volume', Number(e.target.value)); if (gain) gain.gain.value = Number(e.target.value); } })),
      field('Проверка', test),
      h('button', { class: 'btn', onclick: () => ctx.bus.emit('speech.say', { text: test.value }) }, 'Сказать'),
    );
    refreshVoices();
  }

  return {
    async start(c) {
      ctx = c; h = ctx.ui.h; cfg = ctx.config.get; stopped = false;
      audio = new AudioContext(); gain = audio.createGain(); gain.gain.value = cfg('volume', 1); gain.connect(audio.destination);
      const resume = () => audio.state === 'suspended' && audio.resume().catch(() => {});
      resume(); addEventListener('pointerdown', resume, { once: true }); addEventListener('keydown', resume, { once: true });
      ctx.bus.on('speech.say', ({ text }) => { if (!text?.trim()) return; queue.push(...split(text)); run(); });
      ctx.bus.on('speech.stop', interrupt);
      ctx.onFrame(tick);
      ctx.ui.addPanel({ tab: 'engine', title: 'Речь', render: buildPanel });
      ctx.ui.setStatus('Речь');
    },
    async stop() { interrupt(); audio?.close().catch(() => {}); audio = null; },
  };
}

// «Зрение» — лица, кто говорит, движение, жесты (приветствие рукой). Один файл: перетащите в окно движка.
// Работает вместе с модулем «Веб-камера» (берёт его видеопоток) и, если есть, со «Слухом»
// (звук помогает понять, кто из людей в кадре говорит).
//
// Выдаёт события:
//   vision.faces   [{id, x, y, size, speaking}]   x,y ∈ [−1, 1] в координатах экрана (+x вправо, +y вверх)
//   vision.speaker {id, x, y, type}               куда сейчас смотрит ассистент (speaker | hand | motion | face)
//   vision.motion  {x, y, amount}
//   vision.gesture {name, x, y}                   wave | open_palm | fist | point_up | thumb_up | thumb_down | victory | love
//   speech.say     {text}                         ответное приветствие, когда помахали рукой (можно отключить)
// Библиотека распознавания (MediaPipe) лежит локально в vendor/mediapipe/ — интернет не нужен.
export const meta = {
  id: 'vision', name: 'Зрение', version: '0.1', engine: 1, category: 'input',
  description: 'Лица, говорящий, движение, жесты и приветствие в ответ. Требует модуль «Веб-камера».',
};

const GESTURES = { Open_Palm: 'open_palm', Closed_Fist: 'fist', Pointing_Up: 'point_up', Thumb_Up: 'thumb_up', Thumb_Down: 'thumb_down', Victory: 'victory', ILoveYou: 'love' };

export default function create() {
  let ctx, h, cfg, video = null, face = null, hands = null, acc = 0, lastVT = -1, loadState = 'idle', stopped = false;
  let tracks = [], nextId = 1, nowT = 0, heard = { x: 0, t: -99 }, current = null, lastLook = -99;
  const wave = [[], []], waveCool = { t: -99 }, gestureCool = {}, held = { wave: -99 };
  const motion = { prev: null, cv: null, g: null, x: 0, y: 0, amount: 0, emit: 0 };
  const stat = { hand: '—', fps: 0, frames: 0, acc: 0, faces: 0, speaker: '—', gesture: '—', model: '—' };
  let ui = {}, overlay = null, greeting = 0;

  const mirror = () => cfg('mirror', true);
  const toScreenX = (xi) => (mirror() ? 1 - xi : xi) * 2 - 1;

  // ───────── загрузка моделей ─────────
  async function loadModels() {
    loadState = 'loading'; stat.model = 'загрузка…'; refreshUi();
    try {
      const base = new URL(cfg('libBase', 'vendor/mediapipe/'), location.href).href;
      const { FilesetResolver, FaceLandmarker, GestureRecognizer } = await import(/* @vite-ignore */ `${base}vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${base}wasm`);
      const make = async (delegate) => {
        const f = await FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: `${base}face_landmarker.task`, delegate }, runningMode: 'VIDEO', numFaces: cfg('maxFaces', 4), outputFaceBlendshapes: true });
        const g = await GestureRecognizer.createFromOptions(fileset, { baseOptions: { modelAssetPath: `${base}gesture_recognizer.task`, delegate }, runningMode: 'VIDEO', numHands: 2 });
        return [f, g, delegate];
      };
      let r;
      try { r = await make(cfg('delegate', 'GPU')); } catch (e) { ctx.log('GPU недоступен, перехожу на CPU:', e.message); r = await make('CPU'); }
      if (stopped) { r[0].close(); r[1].close(); return; }
      [face, hands] = r; loadState = 'ready'; stat.model = `готово (${r[2]})`;
      ctx.log('модели загружены', r[2]);
    } catch (e) {
      loadState = 'error'; stat.model = `ошибка: ${e.message}`;
      ctx.ui.toast(`Зрение: не загрузились модели распознавания (${e.message}). Проверьте папку vendor/mediapipe/.`, 'err', 9000);
    }
    refreshUi();
  }

  // ───────── кадр ─────────
  function process(t) {
    const ts = performance.now();
    detectMotion(t);
    let faces = [];
    if (face) {
      const r = face.detectForVideo(video, ts);
      faces = trackFaces(r, t);
    }
    let handInfo = null;
    if (hands && cfg('gestures', true) && ++process.n % 2 === 0) {
      handInfo = readHands(hands.recognizeForVideo(video, ts), t);
      settleGestures(t, Math.max(0.02, t - (process.last ?? t))); process.last = t;
    }
    stat.faces = faces.length;
    ctx.bus.emit('vision.faces', faces.map((f) => ({ id: f.id, x: f.sx, y: f.sy, size: f.size, speaking: f.speaking })));
    decide(faces, handInfo, t);
    drawOverlay(faces);
  }
  process.n = 0;

  function trackFaces(r, t) {
    const found = (r.faceLandmarks ?? []).map((lm, i) => {
      let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
      for (const p of lm) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      const jaw = r.faceBlendshapes?.[i]?.categories?.find((c) => c.categoryName === 'jawOpen')?.score ?? 0;
      return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, jaw };
    });
    const used = new Set();
    for (const f of found) {                                  // привязываем к ближайшему прежнему лицу
      let best = null, bd = 0.18;
      for (const tr of tracks) { if (used.has(tr)) continue; const d = Math.hypot(tr.cx - f.cx, tr.cy - f.cy); if (d < bd) { bd = d; best = tr; } }
      if (!best) { best = { id: nextId++, act: 0, jaw: f.jaw, score: 0 }; tracks.push(best); }
      used.add(best);
      best.act = best.act * 0.8 + Math.abs(f.jaw - best.jaw) * 0.2;
      best.jaw = f.jaw; Object.assign(best, { cx: f.cx, cy: f.cy, w: f.w, h: f.h, seen: t });
      best.speaking = best.act > cfg('speakThreshold', 0.012) * 1;
      best.sx = toScreenX(best.cx); best.sy = 1 - best.cy * 2; best.size = Math.max(best.w, best.h);
    }
    tracks = tracks.filter((tr) => t - tr.seen < 1);
    return tracks.filter((tr) => tr.seen === t);
  }

  const holds = {}, seen = new Set(), seenPos = {};
  // Ответные жесты — только если человек ДЕРЖИТ жест около полусекунды (а не просто двигает рукой)
  const REPLY = { thumb_up: 'like', victory: 'peace' };
  function settleGestures(t, dt) {
    for (const name of new Set([...Object.keys(holds), ...seen])) {
      holds[name] = seen.has(name) ? (holds[name] ?? 0) + dt : 0;
      if (holds[name] > 0.5 && t - (gestureCool[name] ?? -99) > 6) {
        gestureCool[name] = t; holds[name] = 0;
        const p = seenPos[name] ?? { x: 0, y: 0 };
        ctx.bus.emit('vision.gesture', { name, x: p.x, y: p.y }); stat.gesture = name;
        if (cfg('replyGestures', true) && REPLY[name]) ctx.avatar.trigger(REPLY[name]);
      }
    }
    seen.clear();
  }

  // Раскрыта ли ладонь: кончики пальцев дальше от запястья, чем средние суставы (не зависит от того, как её назвал классификатор)
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  function palmOpen(lm) {
    let n = 0;
    for (const [tip, pip] of [[8, 6], [12, 10], [16, 14], [20, 18]]) if (dist(lm[tip], lm[0]) > dist(lm[pip], lm[0]) * 1.08) n++;
    return n >= 3;
  }

  const lastOpen = [-99, -99];
  function readHands(r, t) {
    let info = null; stat.hand = r.landmarks?.length ? 'рука в кадре' : 'руки нет';
    (r.landmarks ?? []).forEach((lm, i) => {
      const g = r.gestures?.[i]?.[0], cat = g?.categoryName, name = GESTURES[cat], wrist = lm[0];
      const x = toScreenX(wrist.x), y = 1 - wrist.y * 2;
      const open = palmOpen(lm) || (cat === 'Open_Palm' && g.score > 0.5);
      const w = wave[i] ?? (wave[i] = []);
      if (open) {
        lastOpen[i] = t; w.push([t, wrist.x]);
        while (w.length && t - w[0][0] > 1.6) w.shift();
        const m = waveMetrics(w);
        stat.hand = `ладонь открыта · размах ${(m.range * 100).toFixed(0)}% · смен направления ${m.flips}`;
        if (isWave(m) && t - waveCool.t > 4) {
          waveCool.t = t; held.wave = t; info = { name: 'wave', x, y }; w.length = 0;
          ctx.bus.emit('vision.gesture', { name: 'wave', x, y }); stat.gesture = 'помахали рукой';
          greet(t);
        }
      } else if (t - lastOpen[i] > 0.7) w.length = 0;       // одиночные промахи классификатора не сбрасывают взмах
      if (name && name !== 'open_palm' && g.score > 0.7) seen.add(name);
      if (name && g.score > 0.7) seenPos[name] = { x, y };
      if (t - held.wave < 1.5) info = info ?? { name: 'wave', x, y };
    });
    return info;
  }

  function waveMetrics(w) {
    let min = 1, max = 0, path = 0, flips = 0, dir = 0;
    for (let i = 0; i < w.length; i++) {
      min = Math.min(min, w[i][1]); max = Math.max(max, w[i][1]);
      if (i) { const d = w[i][1] - w[i - 1][1]; path += Math.abs(d); if (Math.abs(d) > 0.004) { const s2 = Math.sign(d); if (dir && s2 !== dir) flips++; dir = s2; } }
    }
    return { range: w.length ? max - min : 0, path, flips, n: w.length };
  }
  const isWave = (m) => m.n >= 5 && m.range > 0.05 && m.path > 0.14 && m.flips >= 2;

  function greet(t) {
    if (!cfg('greet', true)) return;
    const a = ctx.avatar;
    a.setEmotion('happy', 0.9); a.trigger('wave');          // машем в ответ — только когда помахали нам
    const text = cfg('greeting', 'Салеметсизбе');
    ctx.bus.emit('speech.say', { text });           // озвучка (или «немая речь» движка) сама двигает губами и покажет субтитр
    clearTimeout(greeting); greeting = setTimeout(() => a.setEmotion('neutral'), 3500);
  }

  // ───────── движение ─────────
  function detectMotion(t) {
    if (!cfg('trackMotion', true)) { motion.amount = 0; return; }
    const W = 48, H = 27;
    motion.cv ??= Object.assign(document.createElement('canvas'), { width: W, height: H });
    motion.g ??= motion.cv.getContext('2d', { willReadFrequently: true });
    motion.g.drawImage(video, 0, 0, W, H);
    const d = motion.g.getImageData(0, 0, W, H).data, gray = new Uint8Array(W * H);
    for (let i = 0; i < gray.length; i++) gray[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11);
    let n = 0, sx = 0, sy = 0;
    if (motion.prev) for (let i = 0; i < gray.length; i++) if (Math.abs(gray[i] - motion.prev[i]) > 28) { n++; sx += i % W; sy += (i / W) | 0; }
    motion.prev = gray;
    motion.amount = n / gray.length;
    if (n > 3) { motion.x = toScreenX(sx / n / W); motion.y = 1 - (sy / n / H) * 2; }
    if (motion.amount > 0.006 && t - motion.emit > 0.2) { motion.emit = t; ctx.bus.emit('vision.motion', { x: motion.x, y: motion.y, amount: motion.amount }); }
  }

  // ───────── куда смотреть ─────────
  function decide(faces, handInfo, t) {
    let target = null;
    const heardRecent = t - heard.t < 0.7;
    if (faces.length) {
      let best = null, bs = 0;
      for (const f of faces) {
        let s = f.speaking ? 1 : 0;
        if (heardRecent) s += (1 - Math.min(1, Math.abs(f.sx - heard.x))) * 0.9;      // совпадение со звуком
        if (current?.id === f.id) s += 0.25;                                          // не метаться
        if (s > bs) { bs = s; best = f; }
      }
      if (best && (best.speaking || (heardRecent && bs > 0.7))) target = { type: 'speaker', id: best.id, x: best.sx, y: best.sy };
    }
    if (!target && handInfo) target = { type: 'hand', id: 0, x: handInfo.x, y: handInfo.y };
    if (!target && cfg('trackMotion', true) && motion.amount > 0.012) target = { type: 'motion', id: 0, x: motion.x, y: motion.y };
    if (!target && faces.length && cfg('lookAtFaces', true)) {
      const nearest = faces.reduce((a, b) => (a.size > b.size ? a : b));
      target = { type: 'face', id: nearest.id, x: nearest.sx, y: nearest.sy };
    }
    current = target;
    if (target && cfg('followSpeaker', true)) {
      ctx.avatar.lookAtNormalized(target.x * cfg('gazeGain', 1), target.y * 0.6);
      lastLook = t;
      ctx.bus.emit('vision.speaker', target);
      stat.speaker = `${target.type}${target.id ? ` #${target.id}` : ''}`;
    } else if (!target) stat.speaker = '—';
  }

  // ───────── оверлей и панель ─────────
  function drawOverlay(faces) {
    const host = ctx.ui.viewport?.overlay;
    if (!cfg('overlay', true) || !host || !host.isConnected) return;
    if (!overlay) { overlay = document.createElement('canvas'); overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'; host.append(overlay); }
    const w = host.clientWidth, hh = host.clientHeight; if (overlay.width !== w) { overlay.width = w; overlay.height = hh; }
    const g = overlay.getContext('2d'); g.clearRect(0, 0, w, hh);
    g.lineWidth = 2; g.font = '12px monospace';
    for (const f of faces) {
      const px = (mirror() ? 1 - f.cx : f.cx) * w, py = f.cy * hh, s = f.size * Math.min(w, hh) * 1.3;
      g.strokeStyle = f.speaking ? '#ffd166' : '#55e79a';
      g.strokeRect(px - s / 2, py - s / 2, s, s);
      g.fillStyle = g.strokeStyle; g.fillText(`#${f.id}${f.speaking ? ' ГОВОРИТ' : ''}`, px - s / 2, py - s / 2 - 6);
    }
  }

  function refreshUi() {
    if (!ui.status?.isConnected) return;
    ui.status.textContent = `Модели: ${stat.model} · камера: ${video ? 'есть' : 'нет'} · ${stat.fps} к/с`;
    ui.info.textContent = `Лиц: ${stat.faces} · внимание: ${stat.speaker} · жест: ${stat.gesture} · рука: ${stat.hand}`;
  }

  function buildPanel(el) {
    const field = (label, node, hint) => h('label', { class: 'row', style: 'flex-wrap:wrap' }, h('span', { class: 'row-text' }, h('b', {}, label), hint ? h('small', {}, hint) : null), node);
    const check = (key, def) => h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: cfg(key, def), onchange: (e) => ctx.config.set(key, e.target.checked) }), h('span', {}));
    const text = (key, def, attrs = {}) => { const i = h('input', { class: 'text-input', value: cfg(key, def), ...attrs }); i.onchange = () => ctx.config.set(key, i.value.trim()); return i; };
    ui.status = h('div', { class: 'hint' }); ui.info = h('div', { class: 'hint', style: 'margin-top:2px' });
    el.append(ui.status, ui.info,
      field('Следить за говорящим', check('followSpeaker', true), 'Аватар поворачивается к тому, кто говорит'),
      field('Смотреть на ближайшее лицо', check('lookAtFaces', true), 'Когда никто не говорит'),
      field('Следить за движением', check('trackMotion', true), 'Для собраний: взгляд на того, кто двигается'),
      field('Жесты', check('gestures', true)),
      field('Здороваться в ответ на взмах руки', check('greet', true), 'Аватар машет рукой и здоровается — только в ответ на ваш жест'),
      field('Лайк на «класс», peace на «V»', check('replyGestures', true), 'Показывает тот же жест в ответ, если его подержать полсекунды'),
      field('Фраза приветствия', text('greeting', 'Салеметсизбе')),
      field('Зеркальное изображение камеры', check('mirror', true), 'Выключите, если аватар отворачивается в другую сторону'),
      field('Рамки лиц на картинке', check('overlay', true)),
      field('Чувствительность речи по губам', h('input', { type: 'range', min: 4, max: 40, value: cfg('speakThreshold', 0.012) * 1000, oninput: (e) => ctx.config.set('speakThreshold', e.target.value / 1000) })),
      field('Папка библиотеки', text('libBase', 'vendor/mediapipe/', { style: 'width:100%' }), 'Меняется после перезагрузки модуля'),
    );
    refreshUi();
  }

  // ───────── подключение камеры ─────────
  function attach(v) {
    video = v; lastVT = -1; stat.model = loadState === 'ready' ? stat.model : stat.model; refreshUi();
    if (loadState === 'idle') loadModels();
  }

  return {
    async start(c) {
      ctx = c; h = ctx.ui.h; cfg = ctx.config.get; stopped = false;
      ctx.bus.on('camera.ready', ({ video: v }) => attach(v));
      ctx.bus.on('camera.stopped', () => { video = null; tracks = []; stat.faces = 0; refreshUi(); });
      ctx.bus.on('hearing.speaker', ({ x }) => { heard = { x, t: performance.now() / 1000 }; });
      ctx.ui.addPanel({ tab: 'engine', title: 'Зрение', render: buildPanel });
      ctx.onFrame((dt, t) => {
        stat.acc += dt; stat.frames++;
        if (stat.acc >= 1) { stat.fps = Math.round(stat.frames / stat.acc); stat.frames = 0; stat.acc = 0; refreshUi(); }
        acc += dt; nowT = t;
        if (acc < 1 / cfg('fps', 15)) return; acc = 0;
        if (!video || video.readyState < 2 || !video.videoWidth || video.currentTime === lastVT) return;
        lastVT = video.currentTime;
        try { process(t); } catch (e) { ctx.log('кадр', e.message); }
      });
      ctx.defer(() => { overlay?.remove(); overlay = null; clearTimeout(greeting); });
      ctx.bus.emit('camera.request', {});
      setTimeout(() => { if (!video && !stopped) ctx.ui.toast('«Зрение» ждёт камеру: включите модуль «Веб-камера» в списке модулей.', 'err', 7000); }, 2500);
      loadModels();
      ctx.ui.setStatus('Зрение');
    },
    async stop() { stopped = true; try { face?.close(); hands?.close(); } catch { /* ignore */ } face = hands = null; loadState = 'idle'; video = null; },
  };
}

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
  id: 'vision', name: 'Зрение', version: '0.7', engine: 1, category: 'input',
  description: 'Лица, говорящий, движение, жесты, приветствие в ответ и реакция на недопустимые жесты. Требует модуль «Веб-камера».',
};

const GESTURES = { Open_Palm: 'open_palm', Closed_Fist: 'fist', Pointing_Up: 'point_up', Thumb_Up: 'thumb_up', Thumb_Down: 'thumb_down', Victory: 'victory', ILoveYou: 'love' };

export default function create() {
  let ctx, h, cfg, video = null, face = null, hands = null, pose = null, acc = 0, lastVT = -1, loadState = 'idle', stopped = false;
  let tracks = [], nextId = 1, nowT = 0, heard = { x: 0, t: -99 }, current = null, lastLook = -99;
  const wave = [[], []], waveCool = { t: -99 }, gestureCool = {}, held = { wave: -99 };
  const motion = { prev: null, cv: null, g: null, x: 0, y: 0, amount: 0, emit: 0 };
  const stat = { mood: '—', hand: '—', fps: 0, frames: 0, acc: 0, faces: 0, speaker: '—', gesture: '—', model: '—' };
  let ui = {}, overlay = null, greeting = 0, emoLock = -99;
  const mimic = { cur: 'neutral', cand: null, since: 0, off: 0 };

  // Строгость жестов 1–5 (по умолчанию 4): чем выше, тем сильнее и дольше надо махать/держать жест, чтобы она ответила
  const pick = (arr) => arr[Math.max(1, Math.min(5, Math.round(cfg('strictness', 4)))) - 1];
  const T = {
    waveRange: () => pick([0.06, 0.08, 0.10, 0.12, 0.15]), waveFlips: () => pick([2, 2, 3, 3, 4]), wavePath: () => pick([0.16, 0.22, 0.30, 0.40, 0.50]),
    waveDur: () => pick([0.4, 0.6, 0.8, 1.0, 1.2]), handSize: () => pick([0.03, 0.04, 0.05, 0.06, 0.07]),
    score: () => pick([0.70, 0.78, 0.85, 0.90, 0.93]), hold: () => pick([0.5, 0.6, 0.8, 1.0, 1.2]), saluteHold: () => pick([0.6, 0.8, 1.0, 1.2, 1.5]),
  };
  const mirror = () => cfg('mirror', true);
  const toScreenX = (xi) => (mirror() ? 1 - xi : xi) * 2 - 1;

  // ───────── загрузка моделей ─────────
  async function loadModels() {
    loadState = 'loading'; stat.model = 'загрузка…'; refreshUi();
    try {
      const base = new URL(cfg('libBase', 'vendor/mediapipe/'), location.href).href;
      const { FilesetResolver, FaceLandmarker, GestureRecognizer, PoseLandmarker } = await import(/* @vite-ignore */ `${base}vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${base}wasm`);
      const make = async (delegate) => {
        const f = await FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: `${base}face_landmarker.task`, delegate }, runningMode: 'VIDEO', numFaces: cfg('maxFaces', 4), outputFaceBlendshapes: true });
        const g = await GestureRecognizer.createFromOptions(fileset, { baseOptions: { modelAssetPath: `${base}gesture_recognizer.task`, delegate }, runningMode: 'VIDEO', numHands: 2 });
        let p = null;                                                   // поза тела нужна только для реакции на недопустимые жесты — без неё остальное работает
        try { p = await PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: `${base}pose_landmarker_lite.task`, delegate }, runningMode: 'VIDEO', numPoses: 2 }); }
        catch (e) { ctx.log('модель позы не загрузилась:', e.message); }
        return [f, g, delegate, p];
      };
      let r;
      try { r = await make(cfg('delegate', 'GPU')); } catch (e) { ctx.log('GPU недоступен, перехожу на CPU:', e.message); r = await make('CPU'); }
      if (stopped) { r[0].close(); r[1].close(); r[3]?.close(); return; }
      [face, hands] = r; pose = r[3]; loadState = 'ready'; stat.model = `готово (${r[2]})`;
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
    if (hands && cfg('gestures', true) && ++process.n % (cfg('fps', 10) <= 15 ? 1 : 2) === 0) {
      handInfo = readHands(hands.recognizeForVideo(video, ts), t);
      settleGestures(t, Math.max(0.02, t - (process.last ?? t))); process.last = t;
    }
    if (pose && cfg('salute', true) && ++process.m % 3 === 0) checkSalute(pose.detectForVideo(video, ts), t);
    stat.faces = faces.length;
    ctx.bus.emit('vision.faces', faces.map((f) => ({ id: f.id, x: f.sx, y: f.sy, size: f.size, speaking: f.speaking })));
    mirrorMood(faces, t, Math.max(0.02, Math.min(0.3, t - (process.lastM ?? t)))); process.lastM = t;
    decide(faces, handInfo, t);
    drawOverlay(faces);
  }
  process.n = 0; process.m = 0;

  function trackFaces(r, t) {
    const found = (r.faceLandmarks ?? []).map((lm, i) => {
      let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
      for (const p of lm) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      const jaw = r.faceBlendshapes?.[i]?.categories?.find((c) => c.categoryName === 'jawOpen')?.score ?? 0;
      const bs = Object.fromEntries((r.faceBlendshapes?.[i]?.categories ?? []).map((c) => [c.categoryName, c.score]));
      return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, jaw, mood: moodOf(bs) };
    });
    const used = new Set();
    for (const f of found) {                                  // привязываем к ближайшему прежнему лицу
      let best = null, bd = 0.18;
      for (const tr of tracks) { if (used.has(tr)) continue; const d = Math.hypot(tr.cx - f.cx, tr.cy - f.cy); if (d < bd) { bd = d; best = tr; } }
      if (!best) { best = { id: nextId++, act: 0, jaw: f.jaw, score: 0 }; tracks.push(best); }
      used.add(best);
      best.act = best.act * 0.8 + Math.abs(f.jaw - best.jaw) * 0.2;
      best.mood = best.mood ? { smile: best.mood.smile * 0.6 + f.mood.smile * 0.4, sad: best.mood.sad * 0.6 + f.mood.sad * 0.4, angry: best.mood.angry * 0.6 + f.mood.angry * 0.4, teeth: best.mood.teeth * 0.6 + f.mood.teeth * 0.4 } : f.mood;
      best.jaw = f.jaw; Object.assign(best, { cx: f.cx, cy: f.cy, w: f.w, h: f.h, seen: t });
      best.speaking = best.act > cfg('speakThreshold', 0.012) * 1;
      best.sx = toScreenX(best.cx); best.sy = 1 - best.cy * 2; best.size = Math.max(best.w, best.h);
    }
    tracks = tracks.filter((tr) => t - tr.seen < 1);
    return tracks.filter((tr) => tr.seen === t);
  }

  // ───────── мимика: отвечаем улыбкой на улыбку, грустью на грусть, злостью на злость ─────────
  const avg = (bs, a, b) => ((bs[a] ?? 0) + (bs[b] ?? 0)) / 2;
  function moodOf(bs) {
    const smile = avg(bs, 'mouthSmileLeft', 'mouthSmileRight');
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    return {
      smile: clamp01(smile * 1.1),
      teeth: clamp01(Math.max(avg(bs, 'mouthUpperUpLeft', 'mouthUpperUpRight') * 1.6, (bs.jawOpen ?? 0) * 2, avg(bs, 'mouthLowerDownLeft', 'mouthLowerDownRight') * 1.4)),   // видны ли зубы
      sad: clamp01(avg(bs, 'mouthFrownLeft', 'mouthFrownRight') * 1.8 + (bs.browInnerUp ?? 0) * 0.8 + (bs.mouthShrugLower ?? 0) * 0.3 - smile),
      angry: clamp01(avg(bs, 'browDownLeft', 'browDownRight') * 1.3 + avg(bs, 'noseSneerLeft', 'noseSneerRight') * 0.8 + avg(bs, 'eyeSquintLeft', 'eyeSquintRight') * 0.3 - smile),
    };
  }
  const MOOD_BASE = { smile: 0.35, sad: 0.3, angry: 0.3 }, MOOD_EMO = { smile: 'happy', sad: 'sad', angry: 'angry' }, MOOD_RU = { smile: 'улыбка', sad: 'грусть', angry: 'злость' };
  const grinOn = (m) => m.smile > 0.5 && m.teeth > (mimic.cur === 'grin' ? 0.2 : 0.3);   // с гистерезисом, чтобы не мигала          // широкая улыбка с зубами
  const emoFor = (name, m) => (name === 'smile' && grinOn(m) ? 'grin' : MOOD_EMO[name]);
  function mirrorMood(faces, t, dt) {
    if (ui.mood && (!faces.length || !cfg('mimic', true))) ui.mood.textContent = !cfg('mimic', true) ? 'Мимика выключена' : 'Мимика: лица в кадре нет';
    if (!cfg('mimic', true) || !faces.length || t < emoLock) return;
    const f = faces.reduce((a, b) => (b.size > a.size ? b : a));          // ближайшее лицо
    if (!f.mood) return;
    if (ui.mood) ui.mood.textContent = `Мимика (v2) → улыбка ${f.mood.smile.toFixed(2)}/${(MOOD_BASE.smile * (1.5 - cfg('mimicSens', 5) * 0.1)).toFixed(2)} · грусть ${f.mood.sad.toFixed(2)}/${(MOOD_BASE.sad * (1.5 - cfg('mimicSens', 5) * 0.1)).toFixed(2)} · зубы ${f.mood.teeth.toFixed(2)} · злость ${f.mood.angry.toFixed(2)}/${(MOOD_BASE.angry * (1.5 - cfg('mimicSens', 5) * 0.1)).toFixed(2)}  (значение/порог)`;
    const k = 1.5 - cfg('mimicSens', 5) * 0.1;                             // чувствительность 1–10 → порог ×1.4 … ×0.5
    let name = null, ratio = 0;
    for (const m of ['smile', 'sad', 'angry']) { const r = f.mood[m] / (MOOD_BASE[m] * k); if (r > 1 && r > ratio) { name = m; ratio = r; } }
    stat.mood = name ? MOOD_RU[name] : 'нейтрально';
    if (name) {
      mimic.off = 0;
      mimic.since = mimic.cand === name ? mimic.since + dt : 0; mimic.cand = name;
      const kind = emoFor(name, f.mood);
      if (mimic.since > 0.3 && mimic.cur !== kind) { mimic.cur = kind; ctx.avatar.setEmotion(emoFor(name, f.mood), Math.min(1, 0.6 + ratio * 0.2)); ctx.bus.emit('vision.emotion', { name: kind }); }
    } else {
      mimic.cand = null; mimic.since = 0;
      if (mimic.cur !== 'neutral' && (mimic.off += dt) > 0.7) { mimic.cur = 'neutral'; ctx.avatar.setEmotion('neutral'); ctx.bus.emit('vision.emotion', { name: 'neutral' }); }
    }
  }

  const holds = {}, seen = new Set(), seenPos = {};
  // Ответные жесты — только если человек ДЕРЖИТ жест около полусекунды (а не просто двигает рукой)
  const REPLY = { thumb_up: 'like', victory: 'peace' };
  function settleGestures(t, dt) {
    for (const name of new Set([...Object.keys(holds), ...seen])) {
      holds[name] = seen.has(name) ? (holds[name] ?? 0) + dt : 0;
      if (holds[name] > T.hold() && t - (gestureCool[name] ?? -99) > 6) {
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
  // «Лайк» по форме руки (запасной путь рядом с классификатором MediaPipe, который часто путает его с кулаком):
  // большой палец вытянут и смотрит вверх, остальные четыре пальца согнуты в кулак.
  function isThumbUp(lm) {
    const w = lm[0], hs = dist(w, lm[9]);
    if (hs < 1e-3) return false;
    const curled = [[6, 8], [10, 12], [14, 16], [18, 20]].filter(([pip, tip]) => dist(lm[tip], w) < dist(lm[pip], w) * 1.08).length;
    if (curled < 3) return false;                                                       // не кулак
    const ext = dist(lm[4], w) > dist(lm[2], w) * 1.15 && dist(lm[4], lm[5]) > hs * 0.45;   // большой палец вытянут и отведён
    const up = lm[2].y - lm[4].y > hs * 0.35 && (lm[2].y - lm[4].y) > Math.abs(lm[4].x - lm[2].x) * 0.7;   // вверх (в кадре y растёт вниз), наклон до ~55°
    return ext && up;
  }

  function readHands(r, t) {
    let info = null; stat.hand = r.landmarks?.length ? 'рука в кадре' : 'руки нет';
    (r.landmarks ?? []).forEach((lm, i) => {
      const g = r.gestures?.[i]?.[0], cat = g?.categoryName, name = GESTURES[cat], wrist = lm[0];
      const x = toScreenX(wrist.x), y = 1 - wrist.y * 2;
      const handSize = dist(lm[0], lm[9]);                                   // слишком маленькая (далёкая) рука не считается
      stat.cls = cat ? `${cat} ${g.score.toFixed(2)}` : '';
      const geomUp = cfg('geoLike', true) && handSize >= T.handSize() && isThumbUp(lm);
      if (geomUp) { seen.add('thumb_up'); seenPos.thumb_up = { x, y }; stat.hand = 'лайк (по форме руки)'; }
      const open = handSize >= T.handSize() && (palmOpen(lm) || (cat === 'Open_Palm' && g?.score > 0.5));
      const w = wave[i] ?? (wave[i] = []);
      if (open) {
        lastOpen[i] = t; w.push([t, wrist.x]);
        while (w.length && t - w[0][0] > 2.2) w.shift();
        const m = waveMetrics(w);
        stat.hand = `ладонь открыта · размах ${(m.range * 100).toFixed(0)}% · смен направления ${m.flips}`;
        if (isWave(m) && t - waveCool.t > 5) {
          waveCool.t = t; held.wave = t; info = { name: 'wave', x, y }; w.length = 0;
          ctx.bus.emit('vision.gesture', { name: 'wave', x, y }); stat.gesture = 'помахали рукой';
          greet(t);
        }
      } else if (t - lastOpen[i] > 0.7) w.length = 0;       // одиночные промахи классификатора не сбрасывают взмах
      if (name && name !== 'open_palm' && g.score > (name === 'thumb_up' ? T.score() * 0.8 : T.score())) seen.add(name);
      if (name && g.score > T.score()) seenPos[name] = { x, y };
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
    return { range: w.length ? max - min : 0, path, flips, n: w.length, dur: w.length ? w[w.length - 1][0] - w[0][0] : 0 };
  }
  const isWave = (m) => m.n >= 6 && m.dur >= T.waveDur() && m.range > T.waveRange() && m.path > T.wavePath() && m.flips >= T.waveFlips();

  // ───────── недопустимый жест (вытянутая вперёд-вверх прямая рука, «римский салют») ─────────
  // Считаем по 3D-позе тела (плечо → локоть → запястье): рука прямая, направлена к камере и вверх, держится дольше секунды.
  // Махание, поднятая вверх рука, пожатие или «дай пять» с согнутой рукой сюда не попадают.
  const saluteHold = {}; let saluteCool = -99;
  const sub3 = (a, b) => [a.x - b.x, a.y - b.y, a.z - b.z], len3 = (v) => Math.hypot(v[0], v[1], v[2]);
  function armIsSalute(sh, el, wr) {
    const v1 = sub3(el, sh), v2 = sub3(wr, el), v = sub3(wr, sh);
    const l1 = len3(v1), l2 = len3(v2), lv = len3(v);
    if (l1 < 0.15 || l2 < 0.15 || lv < 0.4) return false;                                // рука должна быть вытянута
    const bend = Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (l1 * l2))));
    if (bend > 0.5) return false;                                                         // локоть почти прямой (< ~29°)
    const elev = Math.atan2(-v[1], Math.hypot(v[0], v[2]));                               // угол над горизонталью (y вниз)
    return elev > 0.2 && elev < 1.2 && Math.abs(v[2]) / lv > 0.55;                        // вверх 12–70° и в основном вдоль оси камеры
  }
  function checkSalute(r, t) {
    const dt = Math.max(0.03, t - (checkSalute.last ?? t)); checkSalute.last = t;
    const seenKeys = new Set();
    (r.worldLandmarks ?? []).forEach((w, pi) => {
      const lm = r.landmarks?.[pi];
      for (const [side, [s, e, wr]] of [['L', [11, 13, 15]], ['R', [12, 14, 16]]]) {
        const vis = Math.min(lm?.[s]?.visibility ?? 0, lm?.[e]?.visibility ?? 0, lm?.[wr]?.visibility ?? 0);
        const key = `${pi}${side}`;
        if (vis < 0.5 || !armIsSalute(w[s], w[e], w[wr])) continue;
        seenKeys.add(key); saluteHold[key] = (saluteHold[key] ?? 0) + dt;
        stat.hand = `рука вытянута вперёд-вверх ${saluteHold[key].toFixed(1)} с`;
        if (saluteHold[key] >= T.saluteHold() && t - saluteCool > 10) {
          saluteCool = t; saluteHold[key] = 0;
          react('salute', { x: toScreenX(lm[0].x), y: 1 - lm[0].y * 2 }, t);
        }
      }
    });
    for (const k of Object.keys(saluteHold)) if (!seenKeys.has(k)) saluteHold[k] = 0;
  }

  // Реакция: шок — брови вверх, глаза шире, рот приоткрыт, отшатывается и смотрит на этого человека. Не здоровается, не улыбается.
  function react(kind, at, t) {
    const a = ctx.avatar;
    emoLock = t + 4.5; mimic.cur = 'shocked';
    waveCool.t = t + 3;                                                  // ближайшие секунды приветствие подавлено (чтобы не «ответить» на жест)
    clearTimeout(greeting);
    a.setEmotion('shocked', 1); a.trigger('flinch');
    a.lookAtNormalized((at?.x ?? 0) * cfg('gazeGain', 1), (at?.y ?? 0) * 0.6);
    ctx.bus.emit('vision.gesture', { name: kind, x: at?.x ?? 0, y: at?.y ?? 0 });
    ctx.bus.emit('vision.inappropriate', { type: kind, x: at?.x ?? 0, y: at?.y ?? 0 });
    stat.gesture = 'недопустимый жест';
    greeting = setTimeout(() => a.setEmotion('neutral'), 4500);
  }

  function greet(t) {
    if (!cfg('greet', true)) return;
    const a = ctx.avatar; emoLock = t + 3.5; mimic.cur = 'happy';
    a.setEmotion('happy', 0.9); a.trigger('wave');          // машем в ответ — только когда помахали нам
    const text = cfg('greeting', 'Сәлеметсіз бе!');
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
    ui.info.textContent = `Лиц: ${stat.faces} · внимание: ${stat.speaker} · мимика: ${stat.mood} · жест: ${stat.gesture} · рука: ${stat.hand}${stat.cls ? ` [модель: ${stat.cls}]` : ''}`;
  }

  function buildPanel(el) {
    const field = (label, node, hint) => h('label', { class: 'row', style: 'flex-wrap:wrap' }, h('span', { class: 'row-text' }, h('b', {}, label), hint ? h('small', {}, hint) : null), node);
    const check = (key, def) => h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: cfg(key, def), onchange: (e) => ctx.config.set(key, e.target.checked) }), h('span', {}));
    const text = (key, def, attrs = {}) => { const i = h('input', { class: 'text-input', value: cfg(key, def), ...attrs }); i.onchange = () => ctx.config.set(key, i.value.trim()); return i; };
    ui.status = h('div', { class: 'hint' }); ui.info = h('div', { class: 'hint', style: 'margin-top:2px' }); ui.mood = h('div', { class: 'hint', style: 'margin-top:2px;font-variant-numeric:tabular-nums' }, 'Мимика (v2): ждём лицо…');
    el.append(ui.status, ui.info, ui.mood,
      field('Следить за говорящим', check('followSpeaker', true), 'Аватар поворачивается к тому, кто говорит'),
      field('Смотреть на ближайшее лицо', check('lookAtFaces', true), 'Когда никто не говорит'),
      field('Следить за движением', check('trackMotion', true), 'Для собраний: взгляд на того, кто двигается'),
      field('Копировать мимику', check('mimic', true), 'Улыбка на улыбку, грусть на грусть, злость на злость (ближайшее лицо)'),
      field('Чувствительность мимики (1–10)', h('input', { type: 'range', min: 1, max: 10, step: 1, value: cfg('mimicSens', 5), oninput: (e) => ctx.config.set('mimicSens', Number(e.target.value)) }), 'Выше — реагирует на слабую мимику'),
      field('Частота анализа камеры (кадров/с)', h('input', { type: 'range', min: 4, max: 30, value: cfg('fps', 10), oninput: (e) => ctx.config.set('fps', Number(e.target.value)) }), 'Ниже — легче для видеокарты и процессора; 10 хватает для мимики и жестов'),
      field('Считать на', (() => { const s = h('select', { class: 'text-input' }, [['GPU', 'Видеокарте'], ['CPU', 'Процессоре (разгружает видеокарту)']].map(([v, t]) => h('option', { value: v }, t))); s.value = cfg('delegate', 'GPU'); s.onchange = () => ctx.config.set('delegate', s.value); return s; })(), 'Применится после перезагрузки страницы'),
      field('Жесты', check('gestures', true)),
      field('Лайк по форме руки', check('geoLike', true), 'Запасной способ: большой палец вверх, остальные в кулаке — работает, даже если модель путает лайк с кулаком'),
      field('Строгость жестов (1–5)', h('input', { type: 'range', min: 1, max: 5, step: 1, value: cfg('strictness', 4), oninput: (e) => ctx.config.set('strictness', Number(e.target.value)) }), 'Выше — надо махать сильнее и дольше, жест держать дольше'),
      field('Реакция на недопустимый жест', check('salute', true), 'Вытянутая вперёд-вверх прямая рука: она удивляется и не здоровается'),
      field('Здороваться в ответ на взмах руки', check('greet', true), 'Аватар машет рукой и здоровается — только в ответ на ваш жест'),
      field('Лайк на «класс», peace на «V»', check('replyGestures', true), 'Показывает тот же жест в ответ, если его подержать полсекунды'),
      field('Фраза приветствия', text('greeting', 'Сәлеметсіз бе!')),
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
        if (acc < 1 / cfg('fps', 10)) return; acc = 0;
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
    async stop() { stopped = true; try { face?.close(); hands?.close(); pose?.close(); } catch { /* ignore */ } face = hands = pose = null; loadState = 'idle'; video = null; },
  };
}

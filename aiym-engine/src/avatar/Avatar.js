import * as THREE from 'three';
import { buildGirl } from './buildGirl.js';
import { VISEMES } from './Mouth.js';

const clamp = THREE.MathUtils.clamp;
const smoothstep = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const rand = (a, b) => a + Math.random() * (b - a);

export const EMOTIONS = {
  neutral: { smile: 0.55, browUp: 0.1, browInner: 0, squint: 0.1, open: 0, wide: 1, teeth: 0 },
  happy: { smile: 0.95, browUp: 0.35, browInner: 0, squint: 0.35, open: 0.05 },
  grin: { smile: 1, browUp: 0.45, browInner: 0, squint: 0.55, open: 0.42, wide: 1.3, teeth: 1 },                // широкая улыбка: рот открыт, видны зубы
  surprised: { smile: 0.1, browUp: 1, browInner: 0, squint: 0, open: 0.35 },
  sad: { smile: -0.25, browUp: 0.1, browInner: 0.8, squint: 0, open: 0 },
  shocked: { smile: -0.3, browUp: 1, browInner: 0.55, squint: -0.45, open: 0.5 },     // шок: брови вверх, глаза широко, рот приоткрыт
  angry: { smile: -0.35, browUp: -0.75, browInner: -0.95, squint: 0.65, open: 0 },       // злость: брови опущены и сведены, прищур
  thinking: { smile: 0.05, browUp: 0.45, browInner: -0.4, squint: 0.15, open: 0 },
};

const VIEWS = { full: { h: 4.7, w: 4.0, cy: 0.5 }, face: { h: 2.5, w: 2.4, cy: 0.12 } };
const HAND_GESTURES = { wave: { pose: 'open', dur: 4.0 }, like: { pose: 'like', dur: 3.0 }, peace: { pose: 'peace', dur: 3.2 } };
const RAISE_T = 0.7, LOWER_T = 0.8;
const EYE_CONTACT_PITCH = 0.05;   // камера чуть выше линии глаз: поднимаем взгляд, чтобы смотрела «в глаза», а не на шею
const EYE_RANGE = 0.42;               // рад. — амплитуда взгляда глазами (gaze = ±1)
const LIMITS = { yaw: 0.75, pitch: 0.4 };

/**
 * Аватар: сцена three.js + «оживление». Публичное API — всё, что нужно модулям
 * (слух/речь/зрение), внутренности наружу не торчат.
 */
export class Avatar {
  constructor(container, { pixelRatioMax = 2, maxRender = [2560, 1440] } = {}) {
    this.container = container;
    this.pixelRatioMax = pixelRatioMax; this.maxRender = maxRender;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioMax));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'avatar-canvas';

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 60);
    this.#lights();

    this.rig = buildGirl();
    this.scene.add(this.rig.root);

    this.s = {
      t: 0,
      gaze: { yaw: 0, pitch: 0, set: -99 },       // желаемое направление взгляда (рад.)
      eye: { x: 0, y: 0 }, head: { yaw: 0, pitch: 0, roll: 0 },
      wander: { yaw: 0, pitch: 0, next: 0 },
      blink: { v: 0, next: 2.5, phase: -1 },
      emo: { ...EMOTIONS.neutral }, emoTarget: { ...EMOTIONS.neutral },
      visemes: {}, mouthOpen: 0, speech: 0,
      gesture: null,
      attention: 0,
      turn: { active: false, next: 5, yaw: 0, pitch: 0, until: 0 },   // редкие случайные повороты головы
    };
    this.opts = { idle: true, physics: true };
    this.viewCur = { ...VIEWS.full }; this.viewTarget = { ...VIEWS.full };

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
  }

  #lights() {
    this.scene.add(new THREE.HemisphereLight('#fff6ea', '#7a4a3c', 1.55));
    const key = new THREE.DirectionalLight('#fff1dd', 2.1); key.position.set(-2.5, 3.5, 5); this.scene.add(key);
    const rim = new THREE.DirectionalLight('#ffb27a', 0.9); rim.position.set(3, 2, -2); this.scene.add(rim);
  }

  resize() {
    const w = Math.max(this.container.clientWidth, 1), h = Math.max(this.container.clientHeight, 1);
    // Рендер не больше 2К (2560×1440): на 4К и выше картинка просто растягивается на весь экран (fit)
    const ratio = Math.min(window.devicePixelRatio, this.pixelRatioMax, this.maxRender[0] / w, this.maxRender[1] / h);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    const cam = this.camera;
    cam.aspect = w / h; cam.updateProjectionMatrix();
    this.#applyView();
  }

  #applyView() {
    const cam = this.camera, v = this.viewCur;
    const fov = THREE.MathUtils.degToRad(cam.fov);
    const dist = Math.max(v.h / 2 / Math.tan(fov / 2), v.w / 2 / (Math.tan(fov / 2) * cam.aspect));
    cam.position.set(v.cx ?? 0, v.cy, dist);
    cam.lookAt(v.cx ?? 0, v.cy, 0);
  }

  /** Кадрирование: 'full' (до груди) | 'face' (крупный план). Плавный переход. */
  focus(name = 'full') { this.viewTarget = { ...VIEWS[name] ?? VIEWS.full }; }

  // ───────── Публичное API ─────────

  /** Взгляд в углах (рад.): yaw — вправо(+)/влево(−) от зрителя, pitch — вверх(+). */
  lookAt({ yaw = 0, pitch = 0 }) {
    const g = this.s.gaze;
    g.yaw = clamp(yaw, -1.2, 1.2); g.pitch = clamp(pitch, -0.7, 0.7); g.set = this.s.t;
  }
  /** Взгляд в нормализованных координатах камеры/микрофона: x,y ∈ [−1, 1], 0 — центр. */
  lookAtNormalized(x, y) { this.lookAt({ yaw: x * 0.7, pitch: y * 0.38 }); }
  /** Отпустить внимание — вернуться к «живому» блужданию взгляда. */
  releaseLook() { this.s.gaze.set = -99; }

  /** Вес одной мимики-виземы (0..1). Имена: sil aa E I O U FV MBP SS. */
  setViseme(name, weight = 1) { this.s.visemes = { [name]: clamp(weight, 0, 1) }; }
  setVisemes(weights) { this.s.visemes = { ...weights }; }
  /** Простое «открывание рта» по громкости (0..1) — если фонем нет. */
  setMouthOpen(v) { this.s.mouthOpen = clamp(v, 0, 1); }
  /** Идёт речь (0..1): подключает кивки/жестикуляцию головой. */
  setSpeaking(v) { this.s.speech = clamp(v, 0, 1); }
  endSpeech() { this.s.visemes = {}; this.s.mouthOpen = 0; this.s.speech = 0; }

  setEmotion(name, weight = 1) {
    const e = EMOTIONS[name] ?? EMOTIONS.neutral;
    const n = EMOTIONS.neutral;
    for (const k of Object.keys(n)) this.s.emoTarget[k] = n[k] + ((e[k] ?? n[k]) - n[k]) * weight;
  }

  /** 'nod' | 'shake' | 'tilt' | 'blink' | 'flinch' (отшатнуться); жесты рукой: 'wave' | 'like' | 'peace' */
  trigger(name) {
    if (name === 'blink') { this.s.blink.phase = 0; return; }
    if (HAND_GESTURES[name]) {                       // жест рукой: wave | like | peace
      if (this.s.armG) return;                       // уже показывает жест
      const g = HAND_GESTURES[name];
      this.s.armG = { name, t0: this.s.t, ...g }; this.setEmotion('happy', 0.8);
      return;
    }
    this.s.gesture = { name, t0: this.s.t };
  }

  setOptions(o) { Object.assign(this.opts, o); this.rig.physics.enabled = this.opts.physics; this.rig.guides.visible = !!this.opts.guides; }
  get visemeNames() { return Object.keys(VISEMES); }

  // ───────── Кадр ─────────
  update(dt, t) {
    dt = Math.min(dt, 0.1);
    const s = this.s, rig = this.rig;
    s.t = t;

    const vc = this.viewCur, vt = this.viewTarget;
    if (Math.abs(vc.h - vt.h) + Math.abs(vc.cy - vt.cy) + Math.abs((vc.cx ?? 0) - (vt.cx ?? 0)) > 1e-3) {
      for (const k of ['h', 'w', 'cy', 'cx']) vc[k] = damp(vc[k] ?? 0, vt[k] ?? 0, 3.5, dt);
      this.#applyView();
    }

    // --- внимание и взгляд: ведут ГЛАЗА, голова почти всегда смотрит в центр
    const attending = t - s.gaze.set < 2.5;
    const tr = s.turn;
    // изредка — «живой» поворот головы в случайную сторону (глаза идут первыми), потом голова возвращается в центр
    if (this.opts.idle && !tr.active && t > tr.next && s.speech < 0.05 && !s.armG) {
      const side = Math.random() < 0.5 ? -1 : 1;
      Object.assign(tr, { active: true, yaw: side * rand(0.18, 0.42), pitch: rand(-0.04, 0.09), until: t + rand(1.4, 3.0) });
    }
    if (tr.active && t > tr.until) { tr.active = false; tr.next = t + rand(7, 18); }

    if (this.opts.idle && !attending && !tr.active && t > s.wander.next) {   // мелкие «бегающие» взгляды одними глазами
      const look = Math.random() < 0.6;           // большую часть времени — прямой взгляд (контакт глазами)
      s.wander.yaw = look ? rand(-0.04, 0.04) : rand(-0.2, 0.2); s.wander.pitch = look ? 0 : rand(-0.03, 0.09); s.wander.next = t + (look ? rand(2.5, 5) : rand(0.8, 1.8));
    }
    const idleYaw = this.opts.idle ? s.wander.yaw : 0, idlePitch = this.opts.idle ? s.wander.pitch : 0;
    let ty, tp, hyT, hpT;
    if (tr.active) {                              // взгляд идёт туда же, куда поворачивается голова
      ty = tr.yaw; tp = tr.pitch + EYE_CONTACT_PITCH; hyT = tr.yaw * 0.8; hpT = -tr.pitch * 0.6;
    } else {
      ty = attending ? s.gaze.yaw : idleYaw; tp = (attending ? s.gaze.pitch : idlePitch) + EYE_CONTACT_PITCH;
      // голова следует лишь чуть-чуть (≈10% угла) и берёт на себя только то, что глаза уже не достают
      const over = (v) => Math.sign(v) * Math.max(0, Math.abs(v) - EYE_RANGE * 0.95);
      hyT = clamp(ty * 0.10 + over(ty) * 0.7, -LIMITS.yaw, LIMITS.yaw);
      hpT = -clamp(tp * 0.08 + over(tp) * 0.5, -LIMITS.pitch, LIMITS.pitch);
    }
    const hRate = tr.active ? 3.2 : attending ? 3.0 : 1.8;
    s.head.yaw = damp(s.head.yaw, hyT, hRate, dt);
    s.head.pitch = damp(s.head.pitch, hpT, hRate, dt);
    const ex = clamp((ty - s.head.yaw) / EYE_RANGE, -1, 1), ey = clamp((tp + s.head.pitch) / EYE_RANGE, -1, 1);
    s.eye.x = damp(s.eye.x, ex, 22, dt); s.eye.y = damp(s.eye.y, ey, 22, dt);

    // --- эмоции
    for (const k of Object.keys(s.emo)) s.emo[k] = damp(s.emo[k], s.emoTarget[k], 6, dt);

    // --- моргание
    const b = s.blink;
    if (b.phase < 0 && t > b.next) b.phase = 0;
    if (b.phase >= 0) {
      b.phase += dt / 0.15;
      b.v = b.phase < 1 ? Math.sin((b.phase * Math.PI) / 2) ** 2 : Math.max(0, 1 - (b.phase - 1) * 1.3);
      if (b.phase > 1.8) { b.phase = -1; b.v = 0; b.next = t + (Math.random() < 0.15 ? 0.18 : rand(2.2, 5.5)); }
    }

    // --- голова: жесты, дыхание, речь
    let nod = 0, shake = 0, tilt = 0;
    if (s.gesture) {
      const u = (t - s.gesture.t0) / (s.gesture.name === 'flinch' ? 1.9 : 0.9);
      if (u >= 1) s.gesture = null;
      else {
        const env = Math.sin(u * Math.PI);
        if (s.gesture.name === 'nod') nod = Math.sin(u * Math.PI * 2.6) * 0.14 * env;
        if (s.gesture.name === 'shake') shake = Math.sin(u * Math.PI * 3.2) * 0.2 * env;
        if (s.gesture.name === 'tilt') tilt = 0.16 * env;
        if (s.gesture.name === 'flinch') { nod = -0.17 * Math.min(1, env * 2.2); tilt = 0.05 * env; }   // отшатнулась: голова назад
      }
    }
    const idle = this.opts.idle ? 1 : 0;
    const breathe = Math.sin(t * 1.35);
    const talk = s.speech;
    const pitch = s.head.pitch + nod + idle * (0.014 * Math.sin(t * 0.7) + 0.008 * Math.sin(t * 1.7 + 1) + 0.006 * breathe) + talk * 0.022 * Math.sin(t * 3.4) ;
    const yaw = s.head.yaw + shake + idle * (0.026 * Math.sin(t * 0.53) + 0.012 * Math.sin(t * 1.31 + 1)) + talk * 0.03 * Math.sin(t * 2.3 + 1);
    const roll = -s.head.yaw * 0.12 + tilt + idle * (0.02 * Math.sin(t * 0.61 + 2) + 0.01 * Math.sin(t * 1.4)) + talk * 0.015 * Math.sin(t * 1.9);
    rig.headPivot.rotation.set(pitch, yaw, roll, 'YXZ');
    rig.chestPivot.scale.set(1 + 0.004 * breathe * idle, 1 + 0.01 * breathe * idle, 1 + 0.006 * breathe * idle);
    rig.root.position.x = idle * 0.016 * Math.sin(t * 0.37);
    rig.chest.rotation.z = idle * 0.006 * Math.sin(t * 0.37 + 1) - s.head.yaw * 0.02;

    // --- лицо
    const e = s.emo;
    const answering0 = Math.max(talk, s.armG ? 1 : 0);
    rig.face.update({
      blink: b.v, gazeX: s.eye.x, gazeY: s.eye.y, squint: clamp(Math.max(e.squint, answering0 * 0.25), -0.5, 1),
      browUp: e.browUp + talk * 0.08 * (0.5 + 0.5 * Math.sin(t * 4.1)), browInner: e.browInner,
    });

    // --- рука-жест
    {
      const ag = s.armG; let r = 0, pose = 'open', swing = 0;
      if (ag) {
        const u = t - ag.t0; pose = ag.pose;
        if (u >= ag.dur) { s.armG = null; this.setEmotion('neutral'); }
        else {
          r = u < RAISE_T ? smoothstep(u / RAISE_T) : u > ag.dur - LOWER_T ? 1 - smoothstep((u - (ag.dur - LOWER_T)) / LOWER_T) : 1;
          if (ag.name === 'wave') swing = Math.sin((u - RAISE_T) * Math.PI * 2 * 2.4) * 0.42 * smoothstep((u - RAISE_T) / 0.3) * (u < ag.dur - LOWER_T ? 1 : r);
          if (ag.name === 'like') swing = Math.sin((u - RAISE_T) * Math.PI * 2 * 1.6) * 0.09 * smoothstep((u - RAISE_T) / 0.4);   // лёгкое «покачивание» кулаком
          pose = ag.pose;          // сначала поднимает раскрытую ладонь, потом складывает жест
        }
      }
      rig.arms.left.update(dt, t, r, pose, swing, ag?.name === 'like' ? 'like' : ag?.name === 'peace' ? 'peace' : 'open');
      rig.arms.right.update(dt, t, 0, 'open', 0);
    }

    // --- рот: смешение визем
    const w = { ...s.visemes };
    if (s.mouthOpen > 0) w.aa = Math.max(w.aa ?? 0, s.mouthOpen);
    const tgt = { o: e.open, w: e.wide, p: 0, t: e.teeth };
    let sum = 0;
    for (const [name, wt] of Object.entries(w)) {
      const v = VISEMES[name]; if (!v || wt <= 0) continue;
      tgt.o += (v.o - 0) * wt; tgt.w += (v.w - 1) * wt; tgt.p += v.p * wt; tgt.t += v.t * wt; sum += wt;
    }
    tgt.o = clamp(tgt.o, 0, 1.05); tgt.p = clamp(tgt.p, 0, 1); tgt.t = clamp(tgt.t, 0, 1);
    // в ответ она всегда улыбается: пока говорит или показывает жест — улыбка не меньше 0.75, и речь её почти не «съедает»
    const answering = Math.max(talk, s.armG ? 1 : 0);
    const smileBase = Math.max(e.smile, answering * 0.75);
    const smile = clamp(smileBase * (1 - Math.min(sum, 1) * 0.22), -0.6, 1);
    rig.mouth.update(dt, tgt, smile);

    // --- физика украшений и вуаль
    rig.root.updateMatrixWorld(true);
    for (const a of rig.anchors) {
      a.attach.getWorldPosition(this._v ??= new THREE.Vector3());
      rig.chest.worldToLocal(this._v);
      a.root.position.set(this._v.x, this._v.y, Math.max(this._v.z, a.minZ));
    }
    rig.root.updateMatrixWorld(true);
    rig.physics.update(dt, t);
    rig.headPivot.updateMatrix(); rig.head.updateMatrix();
    this._m = (this._m ?? new THREE.Matrix4()).copy(rig.headPivot.matrix).multiply(rig.head.matrix);
    rig.veil.update(t, this._m, this.opts.physics);
  }

  render() { this.renderer.render(this.scene, this.camera); }

  dispose() {
    this.ro.disconnect();
    this.scene.traverse((o) => { o.geometry?.dispose?.(); });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

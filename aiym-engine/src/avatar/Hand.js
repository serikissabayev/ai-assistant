import * as THREE from 'three';
import { flatToon, toon, addOutline, PAL } from './toon.js';

// Рука: тонкая ладонь, пять пальцев по три сустава, традиционные кольца.
// Система координат: пальцы смотрят в +y, ладонь — в +z (к зрителю), сгибание пальцев — положительный поворот вокруг x.
const FINGERS = {
  index: { u: 0.105, y: 0.125, len: [0.16, 0.095, 0.075], r: 0.03 },
  middle: { u: 0.035, y: 0.138, len: [0.175, 0.105, 0.08], r: 0.031 },
  ring: { u: -0.035, y: 0.128, len: [0.16, 0.095, 0.075], r: 0.029 },
  pinky: { u: -0.1, y: 0.1, len: [0.125, 0.075, 0.065], r: 0.026 },
};
const THUMB = { len: [0.095, 0.078, 0.066], r: 0.047 };

// Позы: curl — [основание, средний, кончик] в радианах, spread — разведение пальца
const OPEN = { index: { c: [0.06, 0.14, 0.08], s: 0.1 }, middle: { c: [0.04, 0.12, 0.08], s: 0.02 }, ring: { c: [0.06, 0.14, 0.08], s: -0.07 }, pinky: { c: [0.1, 0.16, 0.1], s: -0.18 }, thumb: { rz: 0.8, ry: 0.2, c: [0.1, 0.14, 0.06] } };
const CURL = [1.45, 1.75, 1.05];
const POSES = {
  open: OPEN,
  like: {                                   // кулак, большой палец вверх
    index: { c: CURL, s: 0 }, middle: { c: CURL, s: 0 }, ring: { c: CURL, s: 0 }, pinky: { c: CURL, s: 0 },
    // большой палец торчит вверх от боковой кромки кулака, чуть откинут к запястью; кончик слегка выгнут назад (в плоскости ладони)
    thumb: { rz: 1.15, ry: 0, c: [0.0, 0.0, 0.0], cz: [-0.02, -0.06, -0.16], ty: 0.085, tx: 0.065, sc: 1.0 },
  },
  peace: {                                  // «V»: указательный и средний вверх и в стороны
    index: { c: [0.02, 0.04, 0.02], s: 0.27 }, middle: { c: [0.02, 0.04, 0.02], s: -0.12 },
    ring: { c: CURL, s: 0 }, pinky: { c: CURL, s: 0 },
    thumb: { rz: -0.95, ry: 0.55, c: [0.75, 0.9, 0.5] },
  },
};

export function buildHand(thumbSide /* +1: большой палец в +x */) {
  const root = new THREE.Group();
  const skin = flatToon(PAL.skin), gold = toon(PAL.gold, { emissive: '#3b2a0c' }), gem = toon(PAL.gem, { emissive: '#4a0710' });
  const cap = (r, len, parent, y) => {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 5, 12), skin);
    m.position.y = y; addOutline(m, 0.0045); parent.add(m); return m;
  };

  // ладонь и основание кисти
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), skin);
  palm.scale.set(0.155, 0.16, 0.05); addOutline(palm, 0.03); root.add(palm);
  const heel = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), skin);
  heel.scale.set(0.1, 0.11, 0.055); heel.position.y = -0.1; addOutline(heel, 0.04); root.add(heel);

  const joints = {};      // joints[name] = [группа основания, средней, кончика]
  for (const [name, f] of Object.entries(FINGERS)) {
    const base = new THREE.Group(); base.position.set(thumbSide * f.u, f.y, 0); root.add(base);
    let parent = base; const js = [];
    f.len.forEach((L, i) => {
      const j = new THREE.Group(); if (i) j.position.y = f.len[i - 1];
      parent.add(j); js.push(j);
      cap(f.r * (1 - i * 0.08), L, j, L / 2);
      parent = j;
    });
    joints[name] = js;
    // кончик пальца — чуть светлее «ноготь»
    const nail = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), toon('#e9b48f'));
    nail.scale.set(f.r * 0.55, f.len[2] * 0.4, 0.004); nail.position.set(0, f.len[2] * 0.6, f.r * 0.9); js[2].add(nail);
  }

  // большой палец
  const tBase = new THREE.Group(); tBase.position.set(thumbSide * 0.095, -0.075, 0.05);
  const thenar = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), skin);   // мышца у основания большого пальца
  thenar.scale.set(0.075, 0.1, 0.05); thenar.position.set(thumbSide * 0.09, -0.04, 0.03); addOutline(thenar, 0.02); root.add(thenar); root.add(tBase);
  const tRot = new THREE.Group(); tBase.add(tRot);
  const tj = []; let tp = tRot;
  THUMB.len.forEach((L, i) => {
    const j = new THREE.Group(); if (i) j.position.y = THUMB.len[i - 1]; tp.add(j); tj.push(j);
    cap(THUMB.r * (1 - i * 0.08), L, j, L / 2); tp = j;
  });
  const tNail = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), toon('#e9b48f'));
  tNail.scale.set(THUMB.r * 0.6, THUMB.len[2] * 0.42, 0.005); tNail.position.set(0, THUMB.len[2] * 0.6, -THUMB.r * 0.85); tj[2].add(tNail);   // ноготь — с тыльной стороны

  // кольца: на указательном — с красным камнем, на безымянном — тонкое гладкое
  const band = (finger, seg, r, tube, withGem) => {
    const j = joints[finger][seg], L = FINGERS[finger].len[seg];
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 24), gold);
    ring.rotation.x = Math.PI / 2; ring.position.y = L * 0.55; j.add(ring);
    if (withGem) { const g = new THREE.Mesh(new THREE.SphereGeometry(tube * 1.7, 10, 8), gem); g.position.set(0, L * 0.55, r + tube * 0.6); g.scale.z = 0.7; j.add(g); }
  };
  band('index', 0, FINGERS.index.r * 1.14, 0.0085, true);
  band('ring', 0, FINGERS.ring.r * 1.12, 0.006, false);

  // состояние суставов (сглаживается к целевой позе)
  const keys = ['index', 'middle', 'ring', 'pinky'];
  const state = { thumb: { rz: 0.8, ry: 0.2, c: [0.1, 0.14, 0.06], cz: [0, 0, 0], ty: 0, tx: 0, sc: 1 } };
  for (const k of keys) state[k] = { c: [...OPEN[k].c], s: OPEN[k].s };
  let target = OPEN;

  return {
    group: root,
    setPose(name) { target = POSES[name] ?? OPEN; },
    update(dt) {
      const k = 1 - Math.exp(-dt * 13);
      for (const n of keys) {
        const s = state[n], t = target[n];
        s.s += (t.s - s.s) * k;
        for (let i = 0; i < 3; i++) { s.c[i] += (t.c[i] - s.c[i]) * k; joints[n][i].rotation.x = s.c[i]; }
        joints[n][0].rotation.z = -thumbSide * s.s;       // разведение
      }
      const s = state.thumb, t = target.thumb;
      s.rz += (t.rz - s.rz) * k; s.ry += (t.ry - s.ry) * k; s.ty += ((t.ty ?? 0) - s.ty) * k; s.tx += ((t.tx ?? 0) - s.tx) * k; s.sc += ((t.sc ?? 1) - s.sc) * k;
      tBase.position.y = -0.075 + s.ty; tBase.position.x = thumbSide * (0.095 + s.tx); tBase.scale.setScalar(s.sc);
      tRot.rotation.set(0, thumbSide * s.ry * 0, 0);
      tBase.rotation.z = -thumbSide * s.rz;
      tBase.rotation.y = thumbSide * s.ry;
      for (let i = 0; i < 3; i++) {
        s.c[i] += (t.c[i] - s.c[i]) * k; s.cz[i] += ((t.cz?.[i] ?? 0) - s.cz[i]) * k;
        tj[i].rotation.x = s.c[i]; tj[i].rotation.z = thumbSide * s.cz[i];
      }
    },
  };
}

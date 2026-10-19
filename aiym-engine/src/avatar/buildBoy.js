import * as THREE from 'three';
import { toon, flatToon, addOutline, PAL } from './toon.js';
import { tahiyaTexture } from './textures.js';
import { HEAD, faceZ, placeOnFace } from './face.js';
import { buildEyes } from './Eyes.js';
import { Mouth } from './Mouth.js';
import { Strand, Physics } from './Strand.js';
import { buildArm } from './Arm.js';

// Молодой мужчина в национальной одежде: шапан, тахия с пером (үкі), пояс (кемер).
// Тот же «скелет», что у девушки (root / chestPivot / chest / headPivot / head, face, mouth, arms, physics),
// поэтому всё — моргание, дыхание, губы, мимика, жесты руками, комар, речь — работает без изменений.
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const add = (parent, geo, mat, pos, rot, scl) => {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  if (scl) m.scale.set(...scl);
  parent.add(m);
  return m;
};

// Торс шире, чем у девушки: плечи ≈ 1.05
const TORSO = { sz: 0.55 };
const PROFILE = [[0.0, -1.1], [0.22, -1.12], [0.52, -1.16], [0.84, -1.22], [1.03, -1.32], [1.08, -1.42], [1.03, -1.6], [0.97, -2.0], [0.94, -2.7]];
const SHOULDER = 1.04;
const torsoR = (y) => {
  if (y >= PROFILE[1][1]) return PROFILE[1][0];
  for (let i = 1; i < PROFILE.length; i++) {
    const [r1, y1] = PROFILE[i - 1], [r2, y2] = PROFILE[i];
    if (y >= y2) return r1 + (r2 - r1) * ((y1 - y) / (y1 - y2));
  }
  return PROFILE.at(-1)[0];
};
const frontZ = (x, y) => TORSO.sz * Math.sqrt(Math.max(torsoR(y) ** 2 - x * x, 0));

// лицо: челюсть шире, чем у девушки (сужение к подбородку слабее)
const chinM = (y) => { const t = Math.max(0, -y / HEAD.ry); return 1 - 0.035 * t - 0.07 * Math.pow(t, 2.2); };

const COLORS = { cloth: '#1f4a78', clothDark: '#163757', leather: '#4a2a1c', hair: '#2a1a14', cap: '#8a1a27' };

function surfaceLine(chest, mat, pts2d, tube = 0.026, lift = 0.02) {
  const pts = pts2d.map(([x, y]) => V3(x, y, frontZ(x, y) + lift));
  return add(chest, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, tube, 6), mat);
}

function spiralCurve(cx, cy, r, dir, turns = 2.3, flipY = 1) {
  const pts = [];
  for (let i = 0; i <= 44; i++) {
    const t = i / 44, a = t * turns * Math.PI * 2, rr = r * (1 - t * 0.86);
    const x = cx + dir * rr * Math.cos(a), y = cy + flipY * rr * Math.sin(a);
    pts.push(V3(x, y, frontZ(x, y) + 0.016));
  }
  return new THREE.CatmullRomCurve3(pts);
}

export function buildBoy() {
  const mats = {
    skin: toon(PAL.skin), hair: toon(COLORS.hair), red: toon(COLORS.cloth, { side: THREE.DoubleSide }),     // «red» — ткань рукавов/шапана (для общего кода руки)
    redDark: toon(COLORS.clothDark), gold: toon(PAL.gold, { emissive: '#3b2a0c' }), cream: toon(PAL.cream),
    pearl: toon(PAL.pearl, { emissive: '#2c261b' }), gem: toon(PAL.gem, { emissive: '#4a0710' }),
    leather: toon(COLORS.leather), cap: toon(COLORS.cap),
  };

  const root = new THREE.Group();
  const chestPivot = new THREE.Group(); chestPivot.position.y = -2.5; root.add(chestPivot);
  const chest = new THREE.Group(); chest.position.y = 2.76; chestPivot.add(chest);
  const headPivot = new THREE.Group(); headPivot.position.set(0, -0.72, 0); root.add(headPivot);
  const head = new THREE.Group(); head.position.set(0, 0.72, 0); headPivot.add(head);
  const physics = new Physics();

  // ───────── Тело: шапан ─────────
  const torso = add(chest, new THREE.LatheGeometry(PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 40), mats.red, null, null, [1, 1, TORSO.sz]);
  addOutline(torso, 0.012);

  const restArms = {};
  for (const sx of [-1, 1]) {
    const cap = add(chest, new THREE.SphereGeometry(0.3, 24, 18), mats.red, [sx * (SHOULDER - 0.06), -1.4, 0], null, [1, 0.8, 0.88]);
    addOutline(cap, 0.012);
    const arm = new THREE.Group(); arm.position.set(sx * SHOULDER, -1.38, 0); arm.rotation.z = sx * 0.16; chest.add(arm); restArms[sx] = arm;
    add(arm, new THREE.CylinderGeometry(0.32, 0.46, 1.8, 28, 1, true), mats.red, [0, -0.88, 0], null, [1, 1, 0.92]);
    add(arm, new THREE.TorusGeometry(0.325, 0.028, 8, 32), mats.gold, [0, -0.1, 0], [Math.PI / 2, 0, 0], [1, 0.92, 1]);
    add(arm, new THREE.TorusGeometry(0.47, 0.03, 8, 32), mats.gold, [0, -1.76, 0], [Math.PI / 2, 0, 0], [1, 0.92, 1]);   // золотая окантовка манжеты
  }
  // руки крепче, браслет тёмный (воронёный металл)
  const armOpts = { thick: 1.32, handScale: 1.14, bracelet: toon('#2a2326'), trim: toon('#5a4a42'), pearl: toon('#8c8178') };
  const arms = { left: buildArm(-1, mats, chest, restArms[-1], SHOULDER, armOpts), right: buildArm(1, mats, chest, restArms[1], SHOULDER, armOpts) };

  // шея: толще, чем у девушки
  const neckProfile = [[0.14, -0.3], [0.145, -0.8], [0.155, -0.95], [0.17, -1.02], [0.2, -1.08], [0.26, -1.13], [0.36, -1.18]];
  const neckGeo = new THREE.LatheGeometry([...neckProfile].reverse().map(([r, y]) => new THREE.Vector2(r, y)), 28);
  {
    const pos = neckGeo.attributes.position, col = new Float32Array(pos.count * 3);
    const lit = new THREE.Color('#d0966a'), shade = new THREE.Color('#a8704c'), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) { c.copy(shade).lerp(lit, THREE.MathUtils.clamp((-0.86 - pos.getY(i)) / 0.2, 0, 1)); col.set([c.r, c.g, c.b], i * 3); }
    neckGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const neck = add(chest, neckGeo, flatToon('#ffffff', { vertexColors: true }), null, null, [1, 1, 0.9]);
  addOutline(neck, 0.006);

  // воротник-стойка: кремовая нижняя рубаха и золотой кант
  add(chest, new THREE.CylinderGeometry(0.2, 0.29, 0.16, 28, 1, true), toon(PAL.cream, { side: THREE.DoubleSide }), [0, -1.06, 0], null, [1, 1, 0.9]);
  { const ring = new THREE.Group(); ring.position.y = -0.985; ring.scale.set(1, 1, 0.9); chest.add(ring); add(ring, new THREE.TorusGeometry(0.202, 0.016, 8, 32), mats.gold, null, [Math.PI / 2, 0, 0]); }

  // V-вырез шапана (кремовая рубаха) с золотым кантом
  const V_TOP = -1.12, V_BOT = -1.85, V_HALF = 0.2, ROWS = 18, COLS = 6;
  const vpos = [], vidx = [];
  for (let r = 0; r <= ROWS; r++) {
    const t = r / ROWS, y = V_TOP + (V_BOT - V_TOP) * t, w = V_HALF * (1 - t);
    for (let c = 0; c <= COLS; c++) { const x = -w + (2 * w * c) / COLS; vpos.push(x, y, frontZ(x, y) + 0.012); }
  }
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const i = r * (COLS + 1) + c; vidx.push(i, i + COLS + 1, i + 1, i + 1, i + COLS + 1, i + COLS + 2); }
  const vGeo = new THREE.BufferGeometry();
  vGeo.setAttribute('position', new THREE.Float32BufferAttribute(vpos, 3)); vGeo.setIndex(vidx); vGeo.computeVertexNormals();
  add(chest, vGeo, toon(PAL.cream, { side: THREE.DoubleSide }));
  for (const sx of [-1, 1]) {
    const pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push([sx * V_HALF * (1 - t), V_TOP + (V_BOT - V_TOP) * t]); }
    surfaceLine(chest, mats.gold, pts, 0.032);
    // полосы золотой вышивки по бортам и «бараньи рога» на груди
    surfaceLine(chest, mats.gold, [[sx * 0.52, -1.28], [sx * 0.5, -1.7], [sx * 0.5, -2.2]], 0.024);
    add(chest, new THREE.TubeGeometry(spiralCurve(sx * 0.72, -1.62, 0.12, sx, 2.3, 1), 48, 0.024, 6), mats.gold);
    add(chest, new THREE.TubeGeometry(spiralCurve(sx * 0.72, -1.98, 0.12, -sx, 2.3, -1), 48, 0.024, 6), mats.gold);
  }
  surfaceLine(chest, mats.gold, [[0, V_BOT], [0, -2.2]], 0.02);

  // пояс (кемер): кожаный, золотая бляха и заклёпки
  const beltY = -2.3, beltR = torsoR(beltY) + 0.014;
  add(chest, new THREE.CylinderGeometry(beltR, beltR, 0.2, 36, 1, true), mats.leather, [0, beltY, 0], null, [1, 1, TORSO.sz]);
  for (const dy of [0.1, -0.1]) add(chest, new THREE.CylinderGeometry(beltR + 0.004, beltR + 0.004, 0.02, 36, 1, true), mats.gold, [0, beltY + dy, 0], null, [1, 1, TORSO.sz]);
  {
    const plaque = add(chest, new THREE.CylinderGeometry(0.17, 0.17, 0.03, 8), mats.gold, [0, beltY, frontZ(0, beltY) + 0.03], [Math.PI / 2, Math.PI / 8, 0]);
    void plaque;
    add(chest, new THREE.SphereGeometry(0.06, 14, 10), mats.gem, [0, beltY, frontZ(0, beltY) + 0.055], null, [1, 1, 0.55]);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; add(chest, new THREE.SphereGeometry(0.015, 8, 6), mats.pearl, [Math.cos(a) * 0.2, beltY + Math.sin(a) * 0.2 * 0.7, frontZ(0, beltY) + 0.03]); }
  }

  // ───────── Голова ─────────
  const hg = new THREE.SphereGeometry(1, 44, 34);
  const hp = hg.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i), y = hp.getY(i) * HEAD.ry;
    hp.setXYZ(i, x * HEAD.rx * 1.06 * chinM(y), y * 1.02, hp.getZ(i) * HEAD.rz);
  }
  hg.computeVertexNormals();
  const skull = new THREE.Mesh(hg, flatToon(PAL.skin)); head.add(skull); addOutline(skull, 0.013);
  // уши (у девушки закрыты подвесками)
  for (const sx of [-1, 1]) {
    const ear = add(head, new THREE.SphereGeometry(1, 16, 12), flatToon(PAL.skin), [sx * 0.49, -0.02, -0.02], [0, 0, sx * 0.15], [0.05, 0.11, 0.075]);
    addOutline(ear, 0.008);
  }

  // волосы: короткие, из-под тахии — сзади, у висков и небольшая чёлка
  const hairGeo = new THREE.SphereGeometry(1, 36, 20, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.5);
  const hair = add(head, hairGeo, mats.hair, [0, 0.01, -0.01], null, [HEAD.rx * 1.06 + 0.03, HEAD.ry + 0.025, HEAD.rz + 0.025]);
  addOutline(hair, 0.01);
  for (const sx of [-1, 1]) {
    const burn = add(head, new THREE.SphereGeometry(1, 16, 12), mats.hair, [sx * 0.44, 0.05, 0.2], [0, sx * -0.3, 0], [0.04, 0.14, 0.055]);   // бачки
    addOutline(burn, 0.008);
  }
  const fringe = add(head, new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.hair, [0, 0.265, 0.2], [0.1, 0, 0], [0.4, 0.08, 0.36]);  // чёлка из-под шапочки
  addOutline(fringe, 0.008);

  // лицо: гуще брови, тоньше ресницы
  const face = buildEyes(head, { browThick: 0.058, browArch: 0.008, lash: 0.7, wing: false });
  const mouth = new Mouth(head);
  const nose = new THREE.MeshBasicMaterial({ color: PAL.skinShade, transparent: true, opacity: 0.55, depthWrite: false });
  const n = new THREE.Mesh(new THREE.CircleGeometry(0.036, 16), nose); n.scale.y = 0.6; placeOnFace(n, 0, -0.165, 0.004); n.renderOrder = 3; head.add(n);
  const nostril = new THREE.MeshBasicMaterial({ color: '#7a3f2a', transparent: true, opacity: 0.6, depthWrite: false });
  for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.CircleGeometry(0.01, 10), nostril); m.scale.y = 0.7; placeOnFace(m, sx * 0.022, -0.188, 0.005); m.renderOrder = 4; head.add(m); }
  const bridge = new THREE.MeshBasicMaterial({ color: '#f3c9a0', transparent: true, opacity: 0.45, depthWrite: false });
  const bm2 = new THREE.Mesh(new THREE.CircleGeometry(0.016, 12), bridge); bm2.scale.set(0.8, 1.6, 1); placeOnFace(bm2, 0, -0.1, 0.004); bm2.renderOrder = 3; head.add(bm2);
  const shade = new THREE.MeshBasicMaterial({ color: '#b9774d', transparent: true, opacity: 0.22, depthWrite: false });      // лёгкая тень скул — мужские черты
  for (const sx of [-1, 1]) { const c = new THREE.Mesh(new THREE.CircleGeometry(0.07, 20), shade); c.scale.y = 1.5; placeOnFace(c, sx * 0.33, -0.28, 0.003); c.renderOrder = 3; head.add(c); }

  const guides = new THREE.Group(); guides.visible = false; head.add(guides);      // совместимость с отладкой

  // ───────── Тахия с пером (үкі) ─────────
  const capY = 0.27;
  const cap = new THREE.Group(); head.add(cap);
  const dome = add(cap, new THREE.SphereGeometry(1, 44, 22, 0, Math.PI * 2, 0, Math.PI * 0.5), toon('#ffffff', { map: tahiyaTexture() }),
    [0, capY, 0], [-0.07, 0, 0], [HEAD.rx + 0.075, 0.52, HEAD.rz + 0.07]);
  addOutline(dome, 0.012);
  const rimR = HEAD.rx + 0.075, rimZ = (HEAD.rz + 0.07) / rimR;
  const rim = (y, tube, mat) => {
    const g = new THREE.Group(); g.position.y = y; g.scale.set(1, 1, rimZ); g.rotation.x = -0.07; cap.add(g);
    add(g, new THREE.TorusGeometry(rimR, tube, 8, 56), mat, null, [Math.PI / 2, 0, 0]);
  };
  rim(capY + 0.005, 0.03, mats.gold); rim(capY + 0.075, 0.014, mats.gold);
  const pearlGeo = new THREE.SphereGeometry(0.02, 10, 8);
  for (let a = -80; a <= 80; a += 8) {
    const r = (a * Math.PI) / 180;
    add(cap, pearlGeo, mats.pearl, [Math.sin(r) * (rimR + 0.012), capY + 0.04, Math.cos(r) * (rimR + 0.012) * rimZ]);
  }
  {
    const m = new THREE.Group(); m.position.set(0, capY + 0.2, (HEAD.rz + 0.07) * 0.93); m.rotation.x = -0.45; cap.add(m);
    add(m, new THREE.CylinderGeometry(0.075, 0.075, 0.02, 8), mats.gold, [0, 0, 0], [Math.PI / 2, Math.PI / 8, 0]);
    add(m, new THREE.SphereGeometry(0.04, 14, 10), mats.gem, [0, 0, 0.012], null, [1, 1, 0.55]);
  }
  // перо филина (үкі): веер лёгких перьев на тонкой ножке, качается как помпон
  const featherRoot = new THREE.Group(); featherRoot.position.set(0, capY + 0.5, -0.02); cap.add(featherRoot);
  const featherLink = new THREE.Group(); featherRoot.add(featherLink);
  add(featherLink, new THREE.CylinderGeometry(0.03, 0.04, 0.1, 10), toon('#1b1210'), [0, 0.03, 0]);
  const plume = toon('#f6f0e4'), tip = toon('#2a1e1a');
  for (let i = 0; i < 17; i++) {
    const a = (i / 17) * Math.PI * 2, lean = 0.5 + (i % 3) * 0.12, len = 0.27 + (i % 4) * 0.03;
    const f = new THREE.Group(); f.rotation.set(Math.cos(a) * lean, 0, -Math.sin(a) * lean); f.position.y = 0.07; featherLink.add(f);
    add(f, new THREE.SphereGeometry(1, 10, 8), plume, [0, len / 2, 0], null, [0.028, len / 2, 0.014]);
    add(f, new THREE.SphereGeometry(1, 8, 6), tip, [0, len * 0.93, 0], null, [0.018, 0.03, 0.01]);
  }
  physics.add(new Strand(featherRoot, [featherLink], { k: 16, c: 2.2, gain: 0.7, max: 0.4, length: 0.35, noise: 0.15 }));

  // вуали нет — заглушка с тем же интерфейсом
  const veil = { mesh: new THREE.Group(), update() {} };
  root.add(veil.mesh);

  return { root, chestPivot, chest, headPivot, head, face, mouth, physics, veil, mats, guides, anchors: [], arms };
}

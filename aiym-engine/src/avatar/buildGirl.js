import * as THREE from 'three';
import { toon, flatToon, addOutline, PAL } from './toon.js';
import { hatTexture } from './textures.js';
import { HEAD, chinFactor, faceZ, placeOnFace } from './face.js';
import { buildEyes } from './Eyes.js';
import { Mouth } from './Mouth.js';
import { Strand, Physics } from './Strand.js';
import { Veil } from './Veil.js';
import { buildArm } from './Arm.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const add = (parent, geo, mat, pos, rot, scl) => {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  if (scl) m.scale.set(...scl);
  parent.add(m);
  return m;
};

// Торс — усечённый конус с плоским сечением по z; по этой поверхности раскладываем орнамент.
// Профиль торса (радиус по x, высота) с покатыми плечами; сечение по z сжато в sz раз.
const TORSO = { sz: 0.5 };
const PROFILE = [[0.0, -1.1], [0.2, -1.12], [0.45, -1.16], [0.72, -1.22], [0.9, -1.32], [0.95, -1.42], [0.9, -1.6], [0.84, -2.0], [0.82, -2.7]];
const torsoR = (y) => {
  if (y >= PROFILE[1][1]) return PROFILE[1][0];
  for (let i = 1; i < PROFILE.length; i++) {
    const [r1, y1] = PROFILE[i - 1], [r2, y2] = PROFILE[i];
    if (y >= y2) return r1 + (r2 - r1) * ((y1 - y) / (y1 - y2));
  }
  return PROFILE.at(-1)[0];
};
const frontZ = (x, y) => TORSO.sz * Math.sqrt(Math.max(torsoR(y) ** 2 - x * x, 0));

function spiralCurve(cx, cy, r, dir, turns = 2.3, flipY = 1) {
  const pts = [];
  for (let i = 0; i <= 44; i++) {
    const t = i / 44, a = t * turns * Math.PI * 2, rr = r * (1 - t * 0.86);
    const x = cx + dir * rr * Math.cos(a), y = cy + flipY * rr * Math.sin(a);
    pts.push(V3(x, y, frontZ(x, y) + 0.016));
  }
  return new THREE.CatmullRomCurve3(pts);
}

function medallion(mats, s = 1) {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.085 * s, 0.085 * s, 0.022 * s, 8), mats.gold, [0, 0, 0], [Math.PI / 2, Math.PI / 8, 0]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    add(g, new THREE.SphereGeometry(0.016 * s, 8, 6), mats.pearl, [Math.cos(a) * 0.1 * s, Math.sin(a) * 0.1 * s, 0.004]);
  }
  add(g, new THREE.SphereGeometry(0.045 * s, 14, 10), mats.gem, [0, 0, 0.012 * s], null, [1, 1, 0.55]);
  return g;
}

export function buildGirl() {
  const mats = {
    skin: toon(PAL.skin), hair: toon(PAL.hair), red: toon(PAL.red, { side: THREE.DoubleSide }),
    redDark: toon(PAL.redDark), gold: toon(PAL.gold, { emissive: '#3b2a0c' }), cream: toon(PAL.cream),
    pearl: toon(PAL.pearl, { emissive: '#2c261b' }), gem: toon(PAL.gem, { emissive: '#4a0710' }),
  };

  const root = new THREE.Group();
  const chestPivot = new THREE.Group(); chestPivot.position.y = -2.5; root.add(chestPivot);
  const chest = new THREE.Group(); chest.position.y = 2.76; chestPivot.add(chest);
  const headPivot = new THREE.Group(); headPivot.position.set(0, -0.72, 0); root.add(headPivot);
  const head = new THREE.Group(); head.position.set(0, 0.72, 0); headPivot.add(head);
  const physics = new Physics();
  const anchors = [];   // подвески висят на теле, но верхняя точка следует за шапкой (с запретом уходить в тело)

  // ───────── Тело ─────────
  const torso = add(chest, new THREE.LatheGeometry(PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 40), mats.red, null, null, [1, 1, TORSO.sz]);
  addOutline(torso, 0.012);

  const restArms = {};
  for (const sx of [-1, 1]) {
    // округлый «погон» плеча, из которого выходит широкий рукав
    const cap = add(chest, new THREE.SphereGeometry(0.31, 24, 18), mats.red, [sx * 0.86, -1.34, 0], null, [1, 0.95, 0.85]);
    addOutline(cap, 0.012);
    const arm = new THREE.Group(); arm.position.set(sx * 0.9, -1.38, 0); arm.rotation.z = sx * 0.2; chest.add(arm); restArms[sx] = arm;
    add(arm, new THREE.CylinderGeometry(0.29, 0.62, 1.8, 28, 1, true), mats.red, [0, -0.88, 0], null, [1, 1, 0.9]);
    add(arm, new THREE.TorusGeometry(0.315, 0.03, 8, 32), mats.gold, [0, -0.1, 0], [Math.PI / 2, 0, 0], [1, 0.9, 1]);
    add(arm, new THREE.TorusGeometry(0.37, 0.018, 8, 32), mats.gold, [0, -0.3, 0], [Math.PI / 2, 0, 0], [1, 0.9, 1]);
  }

  // шея: тонкая, сужается к подбородку и плавно расширяется к плечам; под подбородком — мягкая тень
  // руки для жестов (машут, «лайк», «peace») — прячутся, пока не нужны
  const arms = { left: buildArm(-1, mats, chest, restArms[-1]), right: buildArm(1, mats, chest, restArms[1]) };

  const neckProfile = [[0.105, -0.3], [0.108, -0.8], [0.115, -0.95], [0.125, -1.02], [0.15, -1.08], [0.2, -1.13], [0.3, -1.18]];
  const neckGeo = new THREE.LatheGeometry([...neckProfile].reverse().map(([r, y]) => new THREE.Vector2(r, y)), 28);  // снизу вверх — нормали наружу
  {
    const pos = neckGeo.attributes.position, col = new Float32Array(pos.count * 3);
    const lit = new THREE.Color('#d0966a'), shade = new THREE.Color('#a8704c'), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      c.copy(shade).lerp(lit, THREE.MathUtils.smoothstep(y, -1.06, -0.9) * 0 + THREE.MathUtils.clamp((-0.86 - y) / 0.2, 0, 1)); // тёмнее сразу под подбородком
      col.set([c.r, c.g, c.b], i * 3);
    }
    neckGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const neck = add(chest, neckGeo, flatToon('#ffffff', { vertexColors: true }), null, null, [1, 1, 0.86]);
  addOutline(neck, 0.006);

  // ворот: кремовая «подкладка» и V-образный вырез с золотой окантовкой
  // стойка-воротник: кремовая, с золотым кантом — отделяет подбородок от одежды
  add(chest, new THREE.CylinderGeometry(0.15, 0.22, 0.15, 28, 1, true), toon(PAL.cream, { side: THREE.DoubleSide }), [0, -1.07, 0], null, [1, 1, 0.86]);
  {
    const ring = new THREE.Group(); ring.position.y = -0.995; ring.scale.set(1, 1, 0.86); chest.add(ring);
    add(ring, new THREE.TorusGeometry(0.152, 0.014, 8, 32), mats.gold, null, [Math.PI / 2, 0, 0]);
  }
  // V-вырез: сетка, прижатая к кривой поверхности торса (плоский треугольник проваливался бы внутрь)
  const V_TOP = -1.12, V_BOT = -1.97, V_HALF = 0.2, ROWS = 20, COLS = 6;
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
    const pts = [];
    for (let i = 0; i <= 16; i++) { const t = i / 16, y = V_TOP + (V_BOT - V_TOP) * t, x = sx * V_HALF * (1 - t); pts.push(V3(x, y, frontZ(x, y) + 0.02)); }
    add(chest, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.034, 6), mats.gold);
    // орнамент «S»-завитков по бокам выреза
    for (const [cy, dir] of [[-1.4, 1], [-1.8, -1]]) {
      add(chest, new THREE.TubeGeometry(spiralCurve(sx * 0.37, cy, 0.115, sx * dir, 2.3, dir), 48, 0.026, 6), mats.gold);
    }
  }
  // ───────── Нагрудное украшение (алқа): три дуги жемчуга и камней + центральная подвеска ─────────
  {
    const pearlI = new THREE.InstancedMesh(new THREE.SphereGeometry(0.024, 10, 8), mats.pearl, 80);
    const gemI = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 10, 8), mats.gem, 24);
    const m4 = new THREE.Matrix4(); let np = 0, ng = 0;
    const ARCS = [[0.23, 0.2], [0.21, 0.36], [0.19, 0.52]];       // [полуширина, глубина]
    ARCS.forEach(([w, depth], k) => {
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const x = -w + (2 * w * i) / 24, y = -1.14 - depth * (1 - (x / w) ** 2);
        pts.push(V3(x, y, frontZ(x, y) + 0.04));
      }
      add(chest, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.006, 5), mats.gold);
      pts.forEach((p, i) => {
        if (i % 2) return;
        const isGem = i % 6 === 0 && k !== 1;
        m4.setPosition(p.x, p.y, p.z);
        if (isGem && ng < 24) gemI.setMatrixAt(ng++, m4); else if (np < 80) pearlI.setMatrixAt(np++, m4);
      });
    });
    pearlI.count = np; gemI.count = ng; chest.add(pearlI, gemI);
    const py = -1.14 - 0.52 - 0.07;
    const pend = medallion(mats, 0.95); pend.position.set(0, py, frontZ(0, py) + 0.045); chest.add(pend);
    for (const dx of [-0.075, 0, 0.075]) {
      const y = py - 0.12 - (dx === 0 ? 0.04 : 0);
      add(chest, new THREE.SphereGeometry(0.03, 10, 8), dx === 0 ? mats.gem : mats.pearl, [dx, y, frontZ(dx, y) + 0.045], null, [1, 1.9, 1]);
    }
  }
  // пояс
  const beltY = -2.3, beltR = torsoR(beltY) + 0.012;
  add(chest, new THREE.CylinderGeometry(beltR, beltR, 0.15, 36, 1, true), mats.gold, [0, beltY, 0], null, [1, 1, TORSO.sz]);
  const bm = medallion(mats, 1.5); bm.position.set(0, beltY, frontZ(0, beltY) + 0.03); chest.add(bm);

  // ───────── Голова ─────────
  const hg = new THREE.SphereGeometry(1, 44, 34);
  const hp = hg.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i), y = hp.getY(i) * HEAD.ry;
    hp.setXYZ(i, x * HEAD.rx * chinFactor(y), y, hp.getZ(i) * HEAD.rz);
  }
  hg.computeVertexNormals();
  const skull = new THREE.Mesh(hg, flatToon(PAL.skin)); head.add(skull); addOutline(skull, 0.013);

  // волосы: шапка сзади и по бокам (спереди окно под лицо) + боковые пряди
  const hairGeo = new THREE.SphereGeometry(1, 36, 20, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.62);
  const hair = add(head, hairGeo, mats.hair, [0, 0.01, -0.01], null, [HEAD.rx + 0.035, HEAD.ry + 0.03, HEAD.rz + 0.03]);
  addOutline(hair, 0.01);
  for (const sx of [-1, 1]) {
    const lock = add(head, new THREE.SphereGeometry(1, 20, 14), mats.hair, [sx * 0.43, -0.1, 0.14], [0, sx * -0.35, sx * 0.07], [0.08, 0.5, 0.12]);
    addOutline(lock, 0.012);
  }

  // лицо
  const face = buildEyes(head);
  const mouth = new Mouth(head);
  const blush = new THREE.MeshBasicMaterial({ color: '#e0705c', transparent: true, opacity: 0.4, depthWrite: false });
  const nose = new THREE.MeshBasicMaterial({ color: PAL.skinShade, transparent: true, opacity: 0.55, depthWrite: false });
  for (const sx of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.CircleGeometry(0.08, 20), blush); placeOnFace(b, sx * 0.275, -0.15, 0.003); b.renderOrder = 3; head.add(b);
  }
  const n = new THREE.Mesh(new THREE.CircleGeometry(0.032, 16), nose); n.scale.y = 0.6; placeOnFace(n, 0, -0.165, 0.004); n.renderOrder = 3; head.add(n);
  const nostril = new THREE.MeshBasicMaterial({ color: '#7a3f2a', transparent: true, opacity: 0.6, depthWrite: false });
  for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.CircleGeometry(0.009, 10), nostril); m.scale.y = 0.7; placeOnFace(m, sx * 0.02, -0.185, 0.005); m.renderOrder = 4; head.add(m); }
  const bridge = new THREE.MeshBasicMaterial({ color: '#f3c9a0', transparent: true, opacity: 0.5, depthWrite: false });
  const bm2 = new THREE.Mesh(new THREE.CircleGeometry(0.016, 12), bridge); bm2.scale.set(0.8, 1.6, 1); placeOnFace(bm2, 0, -0.1, 0.004); bm2.renderOrder = 3; head.add(bm2);

  // Отладочная подсказка: тонкий пунктир по линии подбородка/челюсти (включается в настройках)
  const guides = new THREE.Group(); guides.visible = false; head.add(guides);
  {
    const pts = [];
    for (let a = -1.3; a <= 1.3; a += 0.05) {
      let y = -HEAD.ry * 0.93 * Math.cos(a), x = 0;
      for (let k = 0; k < 2; k++) x = HEAD.rx * 0.93 * chinFactor(y) * Math.sin(a);
      pts.push(new THREE.Vector3(x, y, faceZ(x, y) + 0.006));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: '#7fe9ff', dashSize: 0.018, gapSize: 0.014, depthTest: false, transparent: true, opacity: 0.95 }));
    line.computeLineDistances(); line.renderOrder = 100;
    guides.add(line);
  }

  // ───────── Саукеле ─────────
  const hatY = 0.5, hatH = 1.9, hatR = 0.47, hatSz = 0.92;
  const hat = new THREE.Group(); head.add(hat);
  const hatTex = hatTexture();
  const cone = add(hat, new THREE.CylinderGeometry(0.012, hatR, hatH, 40, 1, true), toon('#ffffff', { map: hatTex, side: THREE.DoubleSide }),
    [0, hatY + hatH / 2, 0], [0, Math.PI, 0], [1, 1, hatSz]);
  addOutline(cone, 0.012);
  const bandMesh = add(hat, new THREE.CylinderGeometry(hatR + 0.012, hatR + 0.012, 0.13, 40, 1, true), mats.redDark, [0, hatY - 0.02, 0], null, [1, 1, hatSz]);
  const ring = (y, r, tube = 0.022) => {
    const g = new THREE.Group(); g.position.y = y; g.scale.set(1, 1, hatSz); hat.add(g);
    add(g, new THREE.TorusGeometry(r, tube, 8, 48), mats.gold, null, [Math.PI / 2, 0, 0]);
  };
  ring(hatY + 0.05, hatR + 0.014); ring(hatY - 0.085, hatR + 0.014); ring(hatY + 0.25, hatR * (1 - 0.25 / hatH) + 0.004, 0.016);
  void bandMesh;
  // жемчужный ряд по нижнему краю + красные капли-камни
  const pearlGeo = new THREE.SphereGeometry(0.026, 10, 8);
  for (let a = -84; a <= 84; a += 6) {
    const r = (a * Math.PI) / 180;
    add(hat, pearlGeo, mats.pearl, [Math.sin(r) * (hatR + 0.026), hatY - 0.085, Math.cos(r) * (hatR + 0.026) * hatSz]);
  }
  // медальоны по центру конуса
  for (const [h, s] of [[0.5, 1.15], [0.98, 1], [1.45, 0.85]]) {
    const r = hatR * (1 - h / hatH) * hatSz;
    const m = medallion(mats, s * 1.2);
    m.position.set(0, hatY + h, r + 0.012); m.rotation.x = -Math.atan(hatR / hatH);
    hat.add(m);
  }
  // помпон
  const pomRoot = new THREE.Group(); pomRoot.position.set(0, hatY + hatH + 0.01, 0); hat.add(pomRoot);
  const pomLink = new THREE.Group(); pomRoot.add(pomLink);
  const fur = toon('#f6f0e4');
  add(pomLink, new THREE.IcosahedronGeometry(0.17, 2), fur, [0, 0.16, 0]);
  const tuft = new THREE.SphereGeometry(0.085, 8, 6);
  for (let i = 0; i < 34; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    add(pomLink, tuft, fur, [r * Math.cos(a) * 0.2, 0.17 + u * 0.19, r * Math.sin(a) * 0.2], null, [1, 1.25, 1]);
  }
  physics.add(new Strand(pomRoot, [pomLink], { k: 22, c: 2.4, gain: 0.55, max: 0.35, length: 0.35, noise: 0.12 }));

  // ───────── Подвески (шашак) ─────────
  const pearlLong = new THREE.SphereGeometry(0.03, 10, 8);
  const drop = new THREE.SphereGeometry(0.036, 10, 8);
  function strand({ at, parent, count, link, k, gain = 1, medals = [], tailRed = true, noise = 0.3 }) {
    const rootG = new THREE.Group(); rootG.position.set(...at); parent.add(rootG);
    const links = []; let prev = rootG;
    for (let i = 0; i < count; i++) {
      const g = new THREE.Group(); g.position.y = i === 0 ? 0 : -link; prev.add(g); links.push(g);
      const last = i === count - 1;
      if (last) { add(g, drop, mats.pearl, [0, -0.045, 0], null, [1, 2.2, 1]); }
      else if (i % 4 === 2) add(g, new THREE.SphereGeometry(0.03, 10, 8), tailRed ? mats.gem : mats.pearl, [0, -link * 0.1, 0]);
      else add(g, pearlLong, mats.pearl, [0, -link * 0.15, 0], null, [1, 1.55, 1]);
      if (medals.includes(i)) { const m = medallion(mats, 0.95); m.position.z = 0.03; g.add(m); }
      prev = g;
    }
    return physics.add(new Strand(rootG, links, { k, c: 1.7, gain, length: count * link, noise }));
  }
  // лобные подвески
  for (let a = -78; a <= 78; a += 8.2) {
    const r = (a * Math.PI) / 180, edge = Math.abs(a) / 78;
    strand({ at: [Math.sin(r) * (hatR + 0.02), hatY - 0.1, Math.cos(r) * (hatR + 0.02) * hatSz], parent: hat, count: 2, link: 0.05 - edge * 0.008, k: 18 + Math.random() * 6, gain: 0.8, noise: 0.14 });
  }
  // центральная лобная подвеска
  {
    const r = strand({ at: [0, hatY - 0.1, (hatR + 0.02) * hatSz], parent: hat, count: 3, link: 0.055, k: 22, gain: 0.8, noise: 0.1 });
    const g = r.links.at(-1);
    add(g, new THREE.SphereGeometry(0.03, 10, 8), mats.gem, [0, -0.03, 0.012]);
  }
  // боковые «занавеси»
  for (const sx of [-1, 1]) {
    // золотая дужка от шапки к боковой подвеске
    add(head, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V3(sx * 0.44, 0.4, 0.2), V3(sx * 0.56, 0.4, 0.3), V3(sx * 0.72, 0.37, 0.33)]), 16, 0.024, 6), mats.gold);
    add(head, new THREE.SphereGeometry(0.075, 14, 10), mats.gold, [sx * 0.72, 0.36, 0.3], null, [0.7, 1.1, 0.5]);
    for (let i = 0; i < 6; i++) {
      const attach = new THREE.Object3D(); attach.position.set(sx * (0.66 + i * 0.04), 0.34, 0.3); head.add(attach);
      const st = strand({ at: [0, 0, 0], parent: chest, count: 15, link: 0.1,
        k: 10 + Math.random() * 4, gain: 1.0, medals: i === 2 || i === 3 ? [4, 9] : [], noise: 0.35 });
      anchors.push({ root: st.root, attach, minZ: 0.43 - i * 0.008 });
    }
    // коса
    // коса крепится к телу (а не к голове), чтобы при повороте головы не проваливаться в грудь
    const br = { at: [sx * 0.5, -0.45 - (chest.position.y - 2.5), 0.12], parent: chest };
    const rootG = new THREE.Group(); rootG.position.set(...br.at); br.parent.add(rootG);
    const links = []; let prev = rootG;
    const plait = new THREE.SphereGeometry(1, 12, 10);
    for (let i = 0; i < 17; i++) {
      const g = new THREE.Group(); g.position.y = i === 0 ? 0 : -0.1; prev.add(g); links.push(g);
      const taper = 1 - i * 0.022;
      const m = add(g, plait, mats.hair, [0, -0.04, 0], [0, 0, (i % 2 ? 1 : -1) * 0.5], [0.088 * taper, 0.108, 0.078 * taper]);
      addOutline(m, 0.01);
      prev = g;
    }
    add(prev, new THREE.SphereGeometry(0.05, 10, 8), mats.gold, [0, -0.1, 0]);
    add(prev, new THREE.SphereGeometry(0.035, 10, 8), mats.gem, [0, -0.18, 0.0], null, [1, 1.6, 1]);
    physics.add(new Strand(rootG, links, { k: 20, c: 3.0, gain: 0.55, max: 0.35, length: 1.7, noise: 0.1,
      // сначала коса выгибается вперёд — через плечо на грудь, потом висит вертикально по поверхности халата
      rest: [-0.12, -0.12, -0.12, -0.12, -0.12, 0.12, 0.12, 0.12, 0.12, 0.12],
      // и в сторону — косы лежат по краям груди, не перекрывая орнамент
      restZ: [0.04, 0.04, 0.04, 0.04, 0.04, -0.04, -0.04, -0.04, -0.04, -0.04].map((v) => v * sx) }));
  }

  const veil = new Veil({ tipY: hatY + hatH + 0.04 });
  root.add(veil.mesh);
  veil.mesh.renderOrder = -1;

  return { root, chestPivot, chest, headPivot, head, face, mouth, physics, veil, mats, guides, anchors, arms };
}

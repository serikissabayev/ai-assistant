import * as THREE from 'three';
import { flatToon, addOutline, PAL } from './toon.js';

const UPPER = 0.72, FOREARM = 0.8, LEAN = 0.18;

// Углы руки: A — плечо (0 = вниз, + наружу), T — итоговый поворот предплечья от «вниз».
// Привет и «V» — предплечье вертикально; «лайк» — предплечье отведено вбок-вверх, кулак виден сбоку, большой палец вверх.
const ARM_POSE = {
  open: { A: 1.62, T: Math.PI - LEAN },
  peace: { A: 1.62, T: Math.PI - LEAN },
  like: { A: 1.35, T: 2.0 },
};

// Кисть — готовый рисунок (спрайт), а не анимация пальцев: привет, лайк, пис (assets/hands/*.png).
// px — размер рисунка в пикселях; h — высота рисунка в единицах сцены (подобрана, чтобы рука была в масштабе тела);
// anchor — где на рисунке запястье (доли ширины/высоты от центра, y вверх); forward — куда «смотрит» кисть от запястья;
// facing — куда кулак смотрит на самом рисунке ('left': для руки слева на экране зеркалить не нужно); tint — цвет, подобранный замером:
// кожа кисти на экране = кожа лица и предплечья (≈ 234,153,95). Пересчитать: tools/cut_hands.py
const SPRITES = {
  open: { file: 'wave', px: [466, 616], h: 0.712, anchor: [0.004, -0.465], forward: [0, 1], tint: '#f7e0bd' },
  peace: { file: 'peace', px: [268, 612], h: 0.74, anchor: [0.017, -0.465], forward: [0, 1], tint: '#f9e5c2' },
  like: { file: 'like', px: [386, 523], h: 0.594, anchor: [0.442, -0.415], forward: [-0.879, 0.477], tint: '#fbe5c2', facing: 'left' },
};

const smooth = (x) => { x = Math.min(Math.max(x, 0), 1); return x * x * (3 - 2 * x); };
const _p = new THREE.Vector3();

// «Жестовая» рука: появляется только во время жеста (обычная опущенная рука при этом прячется).
// o: { thick } — толщина предплечья/кисти (у мужчины > 1); { bracelet, trim, pearl } — материалы браслета (у мужчины тёмные)
export function buildArm(sx, mats, chest, restArm, shoulderX = 0.9, o = {}) {
  const TK = o.thick ?? 1;
  const g = new THREE.Group(); g.position.set(sx * shoulderX, -1.38, 0.05); g.visible = false; chest.add(g);
  const upper = new THREE.Group(); g.add(upper);

  // широкий рукав до локтя с золотой отделкой
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.42, UPPER, 28, 1, true), mats.red);
  sleeve.position.y = -UPPER / 2; sleeve.scale.z = 0.9; upper.add(sleeve);
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.024, 8, 32), mats.gold);
  cuff.rotation.x = Math.PI / 2; cuff.position.y = -UPPER; cuff.scale.set(1, 0.9, 1); upper.add(cuff);

  const elbow = new THREE.Group(); elbow.position.y = -UPPER; upper.add(elbow);
  const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.068 * TK, 0.058 * TK, FOREARM, 24), flatToon(PAL.skin));
  fore.position.y = -FOREARM / 2; elbow.add(fore);
  // контур только по бокам предплечья (без торцов), иначе на запястье виден тёмный «срез»
  const foreOutline = new THREE.Mesh(new THREE.CylinderGeometry(0.068 * TK, 0.058 * TK, FOREARM, 24, 1, true), new THREE.MeshBasicMaterial({ visible: false }));
  foreOutline.position.y = -FOREARM / 2; addOutline(foreOutline, 0.005); elbow.add(foreOutline);

  const wrist = new THREE.Group(); wrist.position.y = -FOREARM; elbow.add(wrist);
  const joint = new THREE.Mesh(new THREE.SphereGeometry(0.05 * TK, 18, 14), flatToon(PAL.skin)); joint.position.y = -FOREARM; elbow.add(joint);   // скругляет стык предплечья и кисти

  // браслет в традиционном стиле (білезік): широкий золотой манжет с жемчужными кромками и красным камнем
  const cuffGroup = new THREE.Group(); elbow.add(cuffGroup);
  const H = 0.11 * (o.thick ? 1.1 : 1), R = 0.07 * TK;
  const gold = o.trim ?? mats.gold, pearlM = o.pearl ?? mats.pearl;
  // манжет закреплён на предплечье (не качается вместе с кистью) и сидит выше запястья — запястье остаётся свободным
  cuffGroup.position.y = -FOREARM + H / 2 + 0.05;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.05, H, 36, 1, true), (o.bracelet ?? mats.gold).clone());
  band.material.side = THREE.DoubleSide; cuffGroup.add(band);
  for (const y of [H / 2, -H / 2]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R * (y > 0 ? 1 : 1.05), 0.0085, 8, 36), gold);
    rim.rotation.x = Math.PI / 2; rim.position.y = y; cuffGroup.add(rim);
  }
  const pearl = new THREE.SphereGeometry(0.0075, 8, 6);
  for (const [y, rr] of [[H / 2 - 0.016, R], [-H / 2 + 0.016, R * 1.05]]) {
    for (let i = 0; i < 22; i++) {
      const an = (i / 22) * Math.PI * 2, m = new THREE.Mesh(pearl, pearlM);
      m.position.set(Math.cos(an) * rr * 1.01, y, Math.sin(an) * rr * 1.01); cuffGroup.add(m);
    }
  }
  const dot = new THREE.SphereGeometry(0.0045, 6, 5);
  for (let i = 0; i < 26; i++) {
    const an = (i / 26) * Math.PI * 2, m = new THREE.Mesh(dot, gold);
    m.position.set(Math.cos(an) * R * 1.03, 0, Math.sin(an) * R * 1.03); cuffGroup.add(m);
  }
  for (const side of [1, -1]) {
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.019, 12, 8), mats.gem);
    gem.position.set(0, 0, side * R * 1.06); gem.scale.set(1, 1.15, 0.55); cuffGroup.add(gem);
    for (let k = 0; k < 6; k++) {
      const an = (k / 6) * Math.PI * 2, petal = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 8, 6), gold);
      petal.position.set(Math.cos(an) * 0.03, Math.sin(an) * 0.03, side * R * 1.05); petal.scale.z = 0.6; cuffGroup.add(petal);
    }
  }

  // спрайты кисти (по одному на жест), одна плоскость на всех
  const loader = new THREE.TextureLoader(), tex = {};
  for (const [pose, def] of Object.entries(SPRITES)) {
    tex[pose] = loader.load(`assets/hands/${def.file}.png`, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; });
  }
  const spriteMat = new THREE.MeshBasicMaterial({ map: tex.open, transparent: true, alphaTest: 0.02, color: '#f7debd' });   // подобран замером: кожа кисти на экране = кожа лица и предплечья (≈ 234,153,95)
  const sprite = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), spriteMat);
  sprite.renderOrder = 20; g.add(sprite);

  return {
    group: g,
    update(dt, t, r, pose, swing, armPose = 'open') {
      const on = r > 0.01;
      g.visible = on; restArm.visible = !on;
      if (!on) return;
      const P = ARM_POSE[armPose] ?? ARM_POSE.open;
      upper.rotation.z = sx * P.A * r;
      elbow.rotation.z = sx * (P.T - P.A) * r;
      wrist.rotation.z = sx * swing;

      // кисть-спрайт: поворачиваем по направлению предплечья и ставим так, чтобы запястье рисунка совпало с запястьем руки
      const def = SPRITES[armPose] ?? SPRITES.open;
      spriteMat.map = tex[armPose] ?? tex.open;
      const th = sx * (P.T * r + swing);                                      // поворот предплечья от «вниз»
      const fAngle = Math.atan2(-Math.cos(th), Math.sin(th));                 // направление предплечья (от локтя к кисти)
      const mirror = def.facing === 'left' ? sx > 0 : false;                  // кулак «лайка» должен смотреть наружу (на рисунке — влево)
      const rot = fAngle - Math.atan2(def.forward[1], mirror ? -def.forward[0] : def.forward[0]);
      const k = (def.h * (o.handScale ?? 1) / def.px[1]) * smooth(r * 1.4), W = def.px[0] * k, Hh = def.px[1] * k;
      spriteMat.color.set(def.tint);
      sprite.scale.set((mirror ? -1 : 1) * W, Hh, 1);
      sprite.rotation.z = rot;
      const ax = (mirror ? -1 : 1) * def.anchor[0] * W, ay = def.anchor[1] * Hh;
      const c = Math.cos(rot), s = Math.sin(rot);
      wrist.getWorldPosition(_p); g.worldToLocal(_p);
      sprite.position.set(_p.x - (ax * c - ay * s), _p.y - (ax * s + ay * c), _p.z);
    },
  };
}
export { smooth };

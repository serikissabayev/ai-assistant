import * as THREE from 'three';
import { flatToon, toon, addOutline, PAL } from './toon.js';
import { buildHand } from './Hand.js';

const UPPER = 0.72, FOREARM = 0.8, LEAN = 0.18;
// Углы руки: A — плечо (0 = вниз, + наружу), T — итоговый поворот предплечья от «вниз».
// Маха́ние и «V» — предплечье вертикально. «Лайк» — предплечье отведено вбок-вверх (≈40°), кулак смотрит ладонью на зрителя,
// большой палец торчит вверх перпендикулярно предплечью — как в классическом 👍.
const ARM_POSE = {
  open: { A: 1.62, T: Math.PI - LEAN },
  peace: { A: 1.62, T: Math.PI - LEAN },
  like: { A: 1.35, T: 2.27 },
};
const smooth = (x) => { x = Math.min(Math.max(x, 0), 1); return x * x * (3 - 2 * x); };

// «Жестовая» рука: появляется только во время жеста (обычная опущенная рука при этом прячется).
// Все повороты — вокруг оси z, поэтому ладонь всегда смотрит на зрителя.
export function buildArm(sx, mats, chest, restArm) {
  const g = new THREE.Group(); g.position.set(sx * 0.9, -1.38, 0.05); g.visible = false; chest.add(g);
  const upper = new THREE.Group(); g.add(upper);

  // широкий рукав до локтя с золотой отделкой
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.42, UPPER, 28, 1, true), mats.red);
  sleeve.position.y = -UPPER / 2; sleeve.scale.z = 0.9; upper.add(sleeve);
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.024, 8, 32), mats.gold);
  cuff.rotation.x = Math.PI / 2; cuff.position.y = -UPPER; cuff.scale.set(1, 0.9, 1); upper.add(cuff);

  const elbow = new THREE.Group(); elbow.position.y = -UPPER; upper.add(elbow);
  const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.034, FOREARM, 18), flatToon(PAL.skin));
  fore.position.y = -FOREARM / 2; addOutline(fore, 0.005); elbow.add(fore);

  const wrist = new THREE.Group(); wrist.position.y = -FOREARM; elbow.add(wrist);
  // браслет в традиционном стиле (білезік): широкий золотой манжет с жемчужными кромками и красным камнем,
  // закрывает стык предплечья и кисти со всех сторон
  const cuffGroup = new THREE.Group(); cuffGroup.position.y = -0.012; cuffGroup.scale.set(1.32, 1, 0.84); wrist.add(cuffGroup);
  const H = 0.13, R = 0.058;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.05, H, 36, 1, true), mats.gold);
  band.material = mats.gold.clone(); band.material.side = THREE.DoubleSide; cuffGroup.add(band);
  for (const y of [H / 2, -H / 2]) {                          // золотые кромки
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R * (y > 0 ? 1 : 1.05), 0.0085, 8, 36), mats.gold);
    rim.rotation.x = Math.PI / 2; rim.position.y = y; cuffGroup.add(rim);
  }
  const pearl = new THREE.SphereGeometry(0.0075, 8, 6);
  for (const [y, rr] of [[H / 2 - 0.016, R], [-H / 2 + 0.016, R * 1.05]]) {   // жемчужные ряды у кромок
    for (let i = 0; i < 22; i++) {
      const an = (i / 22) * Math.PI * 2, m = new THREE.Mesh(pearl, mats.pearl);
      m.position.set(Math.cos(an) * rr * 1.01, y, Math.sin(an) * rr * 1.01); cuffGroup.add(m);
    }
  }
  const dot = new THREE.SphereGeometry(0.0045, 6, 5);                            // золотая «зернь» по центру
  for (let i = 0; i < 26; i++) {
    const an = (i / 26) * Math.PI * 2, m = new THREE.Mesh(dot, mats.gold);
    m.position.set(Math.cos(an) * R * 1.03, 0, Math.sin(an) * R * 1.03); cuffGroup.add(m);
  }
  for (const side of [1, -1]) {                                                 // красный камень с лепестками спереди и сзади
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.019, 12, 8), mats.gem);
    gem.position.set(0, 0, side * R * 1.06); gem.scale.set(1, 1.15, 0.55); cuffGroup.add(gem);
    for (let k = 0; k < 6; k++) {
      const an = (k / 6) * Math.PI * 2, petal = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 8, 6), mats.gold);
      petal.position.set(Math.cos(an) * 0.03, Math.sin(an) * 0.03, side * R * 1.05); petal.scale.z = 0.6; cuffGroup.add(petal);
    }
  }

  const hand = buildHand(-sx);               // у левой на экране руки (sx=−1) большой палец смотрит к центру
  const handMount = new THREE.Group(); handMount.rotation.z = Math.PI; handMount.scale.setScalar(0.78); handMount.add(hand.group);
  hand.group.position.y = 0.0; wrist.add(handMount);
  hand.group.position.y = 0.12;              // основание кисти заходит на запястье

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
      hand.setPose(pose); hand.update(dt);
    },
  };
}
export { smooth };

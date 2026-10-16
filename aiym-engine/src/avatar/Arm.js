import * as THREE from 'three';
import { flatToon, toon, addOutline, PAL } from './toon.js';
import { buildHand } from './Hand.js';

const UPPER = 0.72, FOREARM = 0.8, RAISE = 1.62, LEAN = 0.18;
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
  // браслет: тонкий золотой обруч и три красные бусины
  const bangle = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.009, 8, 24), mats.gold);
  bangle.rotation.x = Math.PI / 2; bangle.position.y = 0.05; wrist.add(bangle);
  for (const a of [-0.5, 0, 0.5]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), mats.gem);
    b.position.set(Math.sin(a) * 0.052, 0.05, Math.cos(a) * 0.052); wrist.add(b);
  }

  const hand = buildHand(-sx);               // у левой на экране руки (sx=−1) большой палец смотрит к центру
  const handMount = new THREE.Group(); handMount.rotation.z = Math.PI; handMount.scale.setScalar(0.78); handMount.add(hand.group);
  hand.group.position.y = 0.0; wrist.add(handMount);
  hand.group.position.y = 0.12;              // основание кисти заходит на запястье

  return {
    group: g,
    update(dt, t, r, pose, swing) {
      const on = r > 0.01;
      g.visible = on; restArm.visible = !on;
      if (!on) return;
      upper.rotation.z = sx * RAISE * r;
      elbow.rotation.z = sx * (Math.PI - LEAN - RAISE) * r;
      wrist.rotation.z = sx * swing;
      hand.setPose(pose); hand.update(dt);
    },
  };
}
export { smooth };

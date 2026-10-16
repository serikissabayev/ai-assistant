import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);

/**
 * Комар: изредка залетает, кружит у лица и улетает. Аватар провожает его глазами и головой.
 * Игрой в кадре управляет Avatar: update(dt, t, face) → { active, pos } .
 */
export class Mosquito {
  constructor(scene) {
    const g = this.group = new THREE.Group();
    g.visible = false; g.renderOrder = 20;
    const dark = new THREE.MeshBasicMaterial({ color: '#241a17' });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), dark); body.scale.set(0.7, 0.7, 2.4);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), dark); head.position.z = 0.05;
    const prob = new THREE.Mesh(new THREE.CylinderGeometry(0.0014, 0.0014, 0.05, 4), dark); prob.rotation.x = Math.PI / 2; prob.position.z = 0.08;
    const legs = [];
    for (const s of [-1, 1]) for (const z of [-0.025, 0, 0.025]) legs.push(0, 0, z, s * 0.04, -0.045, z + (z > 0 ? 0.03 : z < 0 ? -0.03 : 0));
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(legs, 3));
    const legMesh = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#241a17' }));
    const wingMat = new THREE.MeshBasicMaterial({ color: '#dfe9f2', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    const wingGeo = new THREE.PlaneGeometry(0.07, 0.02); wingGeo.translate(0.035, 0, 0);
    this.wings = [-1, 1].map((s) => { const w = new THREE.Mesh(wingGeo, wingMat); w.position.set(0, 0.012, -0.004); w.scale.x = s; g.add(w); return w; });
    g.add(body, head, prob, legMesh);
    scene.add(g);
    this.phase = 'idle'; this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.target = new THREE.Vector3();
    this.next = rand(25, 60); this.until = 0; this.retarget = 0; this.side = 1;
  }

  get active() { return this.phase !== 'idle'; }

  spawn(t, face) {
    if (this.active) return;
    this.side = Math.random() < 0.5 ? -1 : 1;
    this.pos.set(face.x + this.side * 2.8, face.y + rand(0.2, 0.9), face.z + rand(0.4, 0.8));
    this.vel.set(-this.side * 1.2, 0, 0);
    this.phase = 'enter'; this.until = t + rand(6, 10); this.retarget = 0; this.group.visible = true;
  }

  cancel(t) { this.phase = 'idle'; this.group.visible = false; this.next = t + rand(30, 80); }

  /** face — мировая точка у лица (центр, куда летит комар) */
  update(dt, t, face) {
    if (!this.active) return;
    const p = this.pos, v = this.vel, tg = this.target;
    if (this.phase === 'enter' && p.distanceTo(face) < 1.1) this.phase = 'hover';
    if (this.phase === 'hover' && t > this.until) { this.phase = 'exit'; this.side = -this.side; }
    if (this.phase === 'hover' || this.phase === 'enter') {
      if (t > this.retarget) {
        const near = Math.random() < 0.3;                                 // иногда подлетает совсем близко к лицу
        tg.set(face.x + rand(-0.7, 0.7), face.y + rand(-0.45, 0.55), face.z + (near ? rand(0.12, 0.3) : rand(0.35, 0.9)));
        this.retarget = t + rand(0.25, 0.7);
      }
    } else tg.set(face.x + this.side * 3.2, face.y + 0.7, face.z + 0.6);
    // пружина к цели + хаотичная дрожь
    const speed = this.phase === 'hover' ? 2.2 : 3.2;
    const acc = tg.clone().sub(p).multiplyScalar(5).sub(v.clone().multiplyScalar(2.6));
    acc.x += Math.sin(t * 13 + 1) * 3; acc.y += Math.sin(t * 17) * 3; acc.z += Math.sin(t * 11 + 2) * 1.5;
    v.addScaledVector(acc, dt);
    if (v.length() > speed) v.setLength(speed);
    p.addScaledVector(v, dt);
    if (this.phase === 'exit' && Math.abs(p.x - face.x) > 2.9) { this.cancel(t); return; }

    const g = this.group;
    g.position.copy(p);
    if (v.lengthSq() > 1e-4) g.lookAt(p.x + v.x, p.y + v.y, p.z + v.z);
    g.rotateZ(Math.sin(t * 9) * 0.25);
    const flap = Math.sin(t * 160) * 0.85;
    this.wings[0].rotation.set(0, 0, 0.5 + flap); this.wings[1].rotation.set(0, 0, -0.5 - flap);
  }
}

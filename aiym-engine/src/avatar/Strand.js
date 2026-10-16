import * as THREE from 'three';

// Свисающая цепочка (коса, нить жемчуга, помпон): один «маятник» на корне,
// его угол равномерно раскладывается по звеньям. Двигается от ускорения точки подвеса + шум.
export class Strand {
  constructor(root, links, { k = 14, c = 1.7, gain = 1, max = 0.75, length = 1, noise = 0.3, rest = null, restZ = null } = {}) {
    Object.assign(this, { root, links, k, c, gain, max, length, noise, rest, restZ });
    this.tx = 0; this.tz = 0; this.vx = 0; this.vz = 0;
    this.phase = Math.random() * 100;
    this.p1 = new THREE.Vector3(); this.p2 = new THREE.Vector3();
    this.primed = false;
  }

  step(dt, t, tmp, quat) {
    this.root.getWorldPosition(tmp.p);
    if (!this.primed) { this.p1.copy(tmp.p); this.p2.copy(tmp.p); this.primed = true; }
    // ускорение точки подвеса в мировых координатах → в систему родителя корня
    tmp.a.copy(tmp.p).sub(this.p1.multiplyScalar(2)).add(this.p2).divideScalar(Math.max(dt * dt, 1e-4));
    this.p2.copy(this.p1.multiplyScalar(0.5)); this.p1.copy(tmp.p);
    this.root.parent.getWorldQuaternion(quat).invert();
    tmp.a.clampLength(0, 40).applyQuaternion(quat);

    const L = this.length;
    const n1 = Math.sin(t * 1.3 + this.phase) + 0.5 * Math.sin(t * 2.9 + this.phase * 1.7);
    const n2 = Math.cos(t * 1.1 + this.phase * 0.7) + 0.5 * Math.sin(t * 2.3 + this.phase);
    const sub = 2, h = dt / sub;
    for (let i = 0; i < sub; i++) {
      const az = -this.k * this.tz - this.c * this.vz - (this.gain * tmp.a.x) / L + this.noise * n1;
      const ax = -this.k * this.tx - this.c * this.vx + (this.gain * tmp.a.z) / L + this.noise * n2;
      this.vz += az * h; this.vx += ax * h;
      this.tz = THREE.MathUtils.clamp(this.tz + this.vz * h, -this.max, this.max);
      this.tx = THREE.MathUtils.clamp(this.tx + this.vx * h, -this.max, this.max);
    }
    const n = this.links.length;
    this.links.forEach((link, i) => { link.rotation.z = this.tz / n + (this.restZ?.[i] ?? 0); link.rotation.x = this.tx / n + (this.rest?.[i] ?? 0); });
  }
}

export class Physics {
  constructor() { this.strands = []; this.enabled = true; this.tmp = { p: new THREE.Vector3(), a: new THREE.Vector3() }; this.q = new THREE.Quaternion(); }
  add(s) { this.strands.push(s); return s; }
  update(dt, t) {
    if (!this.enabled) { for (const s of this.strands) s.links.forEach((l, i) => l.rotation.set(s.rest?.[i] ?? 0, 0, s.restZ?.[i] ?? 0)); return; }
    dt = Math.min(dt, 1 / 30);
    for (const s of this.strands) s.step(dt, t, this.tmp, this.q);
  }
}

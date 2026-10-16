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
    // серая точка + размытый «ореол» от быстрых крыльев (мерцает и дрожит каждый кадр)
    const tex = (stops) => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); for (const [o, col] of stops) gr.addColorStop(o, col); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex([[0, 'rgba(110,110,110,0.6)'], [0.45, 'rgba(110,110,110,0.25)'], [1, 'rgba(110,110,110,0)']]), transparent: true, depthWrite: false }));
    this.core = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex([[0, 'rgba(70,70,70,1)'], [0.6, 'rgba(70,70,70,1)'], [1, 'rgba(70,70,70,0)']]), transparent: true, depthWrite: false }));
    this.halo.scale.set(0.11, 0.05, 1); this.core.scale.set(0.03, 0.03, 1);
    g.add(this.halo, this.core);
    scene.add(g);
    this.phase = 'idle'; this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.target = new THREE.Vector3();
    this.next = rand(25, 60); this.soundOn = true; this.until = 0; this.retarget = 0; this.side = 1;
  }

  get active() { return this.phase !== 'idle'; }

  spawn(t, face) {
    if (this.active) return;
    this.side = Math.random() < 0.5 ? -1 : 1;
    this.pos.set(face.x + this.side * 2.8, face.y + rand(0.2, 0.9), face.z + rand(0.4, 0.8));
    this.vel.set(-this.side * 1.2, 0, 0);
    this.phase = 'enter'; this.until = t + rand(6, 10); this.retarget = 0; this.group.visible = true;
  }

  cancel(t) { this.phase = 'idle'; this.group.visible = false; this.#mute(); this.next = t + rand(30, 80); }

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
    const m = this.halo.material;
    m.rotation = Math.random() * Math.PI;                              // крылья машут быстрее кадра — ореол «дрожит»
    const k = 0.8 + Math.random() * 0.5; this.halo.scale.set(0.17 * k, 0.065 * (2 - k), 1);
    m.opacity = 0.7 + Math.random() * 0.3;
    this.#sound(t, face);
  }

  // ───────── писк ─────────
  #audio() {
    if (this.ac) return this.ac;
    try {
      const ac = this.ac = new AudioContext();
      const osc = ac.createOscillator(); osc.type = 'sawtooth';
      const lfo = ac.createOscillator(), lfoG = ac.createGain(); lfo.frequency.value = 9; lfoG.gain.value = 22; lfo.connect(lfoG); lfoG.connect(osc.frequency);
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 2.2;
      const gain = ac.createGain(); gain.gain.value = 0;
      const pan = ac.createStereoPanner();
      osc.connect(bp); bp.connect(gain); gain.connect(pan); pan.connect(ac.destination);
      osc.start(); lfo.start();
      Object.assign(this, { osc, gain, pan });
      const resume = () => ac.state === 'suspended' && ac.resume().catch(() => {});
      addEventListener('pointerdown', resume, { once: true }); addEventListener('keydown', resume, { once: true }); resume();
    } catch { this.ac = null; }
    return this.ac;
  }

  #sound(t, face) {
    if (!this.soundOn) { this.#mute(); return; }
    const ac = this.#audio(); if (!ac) return;
    const d = this.pos.distanceTo(face), vol = Math.max(0, 1 - d / 3.2) ** 1.5 * (this.phase === 'exit' ? 0.6 : 1);
    const now = ac.currentTime;
    this.gain.gain.setTargetAtTime(vol * 0.09, now, 0.05);
    this.osc.frequency.setTargetAtTime(470 + this.vel.length() * 55 + Math.sin(t * 3.1) * 25, now, 0.06);
    this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, (this.pos.x - face.x) / 1.8)), now, 0.05);
  }

  #mute() { if (this.ac && this.gain) this.gain.gain.setTargetAtTime(0, this.ac.currentTime, 0.05); }
}

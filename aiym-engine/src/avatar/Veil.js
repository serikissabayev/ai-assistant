import * as THREE from 'three';
import { toon } from './toon.js';
import { veilTexture } from './textures.js';

const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// Длинная вуаль саукеле: верхушка следует за головой, низ остаётся у тела, по ткани идёт лёгкая волна.
export class Veil {
  constructor({ tipY = 2.46, bottomY = -2.8, halfW = 2.45, nu = 26, nv = 30 } = {}) {
    this.nu = nu; this.nv = nv;
    const count = (nu + 1) * (nv + 1);
    this.base = new Float32Array(count * 3);
    this.vv = new Float32Array(count);
    const uv = new Float32Array(count * 2);
    const idx = [];
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const n = j * (nu + 1) + i, v = j / nv, u = (i / nu) * 2 - 1;
        this.base.set([u * v * halfW, tipY - v * (tipY - bottomY), -0.3 + 0.36 * v * u * u], n * 3);
        this.vv[n] = v;
        uv.set([(u + 1) / 2, 1 - v], n * 2);
        if (i < nu && j < nv) { const a = n, b = n + 1, c = n + nu + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
      }
    }
    this.pos = new Float32Array(this.base);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, toon('#ffffff', { map: veilTexture(), side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.v = new THREE.Vector3();
  }

  update(t, headMatrix, wave = true) {
    const { base, pos, vv, v } = this;
    for (let n = 0; n < vv.length; n++) {
      const k = n * 3, s = vv[n];
      v.set(base[k], base[k + 1], base[k + 2]).applyMatrix4(headMatrix);
      const free = smooth(0.0, 0.42, s);
      const sway = wave ? Math.sin(t * 0.9 + base[k] * 1.3 + base[k + 1] * 0.8) * 0.035 * free : 0;
      pos[k] = v.x + (base[k] - v.x) * free;
      pos[k + 1] = v.y + (base[k + 1] - v.y) * free;
      pos[k + 2] = v.z + (base[k + 2] - v.z) * free + sway;
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
  }
}

import * as THREE from 'three';
import { faceZ } from './face.js';

const N = 28;           // точек контура
const CY = -0.318;      // центр рта по высоте лица

// Визема → параметры рта. o: раскрытие 0..1, w: ширина (множитель), p: вытягивание «трубочкой», t: зубы видны
export const VISEMES = {
  sil: { o: 0, w: 1, p: 0, t: 0 },
  aa: { o: 1, w: 1.02, p: 0, t: 1 },
  E: { o: 0.5, w: 1.2, p: 0, t: 1 },
  I: { o: 0.26, w: 1.28, p: 0, t: 1 },
  O: { o: 0.72, w: 0.7, p: 0.75, t: 0.2 },
  U: { o: 0.3, w: 0.56, p: 1, t: 0 },
  FV: { o: 0.14, w: 1, p: 0, t: 1 },
  MBP: { o: 0, w: 0.9, p: 0.25, t: 0 },
  SS: { o: 0.14, w: 1.22, p: 0, t: 1 },
};

const C = (hex) => new THREE.Color(hex);

export class Mouth {
  constructor(head) {
    this.cur = { o: 0, w: 1, p: 0, t: 0, smile: 0.55 };
    const lipMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.lips = this.#mesh(N * 2, this.#stripIndex(), lipMat, 6);
    this.fill = this.#mesh(N + 1, this.#fanIndex(), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), 5);
    this.teeth = this.#mesh((N / 2 + 1) * 2, this.#teethIndex(), new THREE.MeshBasicMaterial({ color: '#fbf3e6', side: THREE.DoubleSide }), 6);
    this.#paint();
    head.add(this.lips, this.fill, this.teeth);
    this.update(0, { o: 0, w: 1, p: 0, t: 0 }, 0.15);
  }

  #mesh(verts, index, mat, order) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    g.setIndex(index);
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false; m.renderOrder = order;
    return m;
  }

  #stripIndex() { const i = []; for (let k = 0; k < N; k++) { const a = k, b = (k + 1) % N, c = N + k, d = N + ((k + 1) % N); i.push(a, b, c, b, d, c); } return i; }
  #fanIndex() { const i = []; for (let k = 0; k < N; k++) i.push(N, k, (k + 1) % N); return i; }
  #teethIndex() { const i = []; for (let q = 0; q < N / 2; q++) { const a = q * 2; i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } return i; }

  #paint() {
    const upper = C('#a83a44'), lower = C('#cc5b62');
    const lc = this.lips.geometry.attributes.color;
    for (let k = 0; k < N; k++) {
      const col = Math.sin((2 * Math.PI * k) / N) >= 0 ? upper : lower;
      lc.setXYZ(k, col.r, col.g, col.b); lc.setXYZ(N + k, col.r, col.g, col.b);
    }
    const fc = this.fill.geometry.attributes.color;
    const dark = C('#3b0d14'), tongue = C('#b24452');
    for (let k = 0; k < N; k++) { const col = Math.sin((2 * Math.PI * k) / N) >= 0 ? dark : dark.clone().lerp(tongue, 0.75); fc.setXYZ(k, col.r, col.g, col.b); }
    fc.setXYZ(N, dark.r, dark.g, dark.b);
    // у зубов индексов нет цвета — материал однотонный
  }

  // p — целевые параметры, smile 0..1 (уголки вверх), dt — для сглаживания
  update(dt, p, smile) {
    const k = 1 - Math.exp(-dt * 26);
    const c = this.cur;
    c.o += (p.o - c.o) * k; c.w += (p.w - c.w) * k; c.p += (p.p - c.p) * k; c.t += (p.t - c.t) * k; c.smile += (smile - c.smile) * k;

    const w = 0.1 * c.w * (1 - 0.3 * c.p) * (1 + 0.12 * c.smile);
    const lipT = 1 + 0.9 * c.p;
    const hu = 0.0035 + 0.018 * c.o, hl = 0.0035 + 0.052 * c.o * (1 - 0.15 * c.p);
    const lift = c.smile * 0.03;
    const up = 0.02 * lipT, lo = 0.032 * lipT;
    const lp = this.lips.geometry.attributes.position, fp = this.fill.geometry.attributes.position;

    const put = (attr, i, x, y, off) => attr.setXYZ(i, x, y + CY, faceZ(x, y + CY) + off);
    const inner = [];
    for (let i = 0; i < N; i++) {
      const t = (2 * Math.PI * i) / N, cs = Math.cos(t), sn = Math.sin(t);
      const corner = lift * Math.pow(Math.abs(cs), 2.2);
      const yi = (sn >= 0 ? hu * sn : hl * sn) + corner - lift * 0.35;
      const xi = w * cs;
      const yo = (sn >= 0 ? (hu + up * (1 + 0.35 * Math.max(0, Math.cos(2 * t)))) * sn : (hl + lo) * sn) + corner - lift * 0.35;
      const xo = (w + 0.007) * cs * 1.0;
      put(lp, i, xo, yo, 0.009);
      put(lp, N + i, xi, yi, 0.009);
      put(fp, i, xi, yi, 0.005);
      inner.push([xi, yi]);
    }
    put(fp, N, 0, -hl * 0.35 - lift * 0.35, 0.005);

    // зубы: полоса вдоль верхнего внутреннего контура (t от 0 до π: x убывает от +w до -w)
    const td = Math.min(0.036 * c.o * c.t * 1.6, hl * 0.9);
    const tpos = this.teeth.geometry.attributes.position;
    for (let i = 0; i <= N / 2; i++) {
      const [x, y] = inner[i % N];
      const edge = Math.max(1 - Math.pow(Math.abs(x) / w, 4), 0);   // у уголков зубы сходят на нет
      put(tpos, i * 2, x, y, 0.007);
      put(tpos, i * 2 + 1, x, y - td * edge, 0.007);
    }
    tpos.needsUpdate = true;
    lp.needsUpdate = true; fp.needsUpdate = true;
    this.teeth.visible = td > 0.002;
  }
}

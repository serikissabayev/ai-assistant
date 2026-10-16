import * as THREE from 'three';
import { placeOnFace } from './face.js';
import { PAL } from './toon.js';

const W = 0.1, H = 0.05;
const DS = THREE.DoubleSide;
const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, side: DS, ...extra });
const stencilWrite = { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp };
const stencilRead = { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc, stencilZPass: THREE.KeepStencilOp };

function almondShape(s) {
  const sh = new THREE.Shape();
  sh.moveTo(-W * s, -0.004);
  sh.bezierCurveTo(-W * 0.55 * s, H * 2.05, W * 0.45 * s, H * 2.2, W * s, 0.03);
  sh.bezierCurveTo(W * 0.5 * s, -H * 1.0, -W * 0.5 * s, -H * 1.1, -W * s, -0.004);
  return sh;
}

function upperLid(s, wing = true) {
  const b = new THREE.CubicBezierCurve3(
    new THREE.Vector3(-W * s, -0.004, 0), new THREE.Vector3(-W * 0.55 * s, H * 2.05, 0),
    new THREE.Vector3(W * 0.45 * s, H * 2.2, 0), new THREE.Vector3(W * s, 0.03, 0));
  const pts = b.getPoints(24);
  if (wing) pts.push(new THREE.Vector3((W + 0.022) * s, 0.044, 0), new THREE.Vector3((W + 0.04) * s, 0.062, 0));
  return new THREE.CatmullRomCurve3(pts);
}

const tube = (curve, r, mat, seg = 40) => new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r, 5, false), mat);

function buildEye(s) {
  const g = new THREE.Group();
  const eye = new THREE.Group(); g.add(eye);
  const lash = new THREE.Group(); g.add(lash);

  const white = new THREE.Mesh(new THREE.ShapeGeometry(almondShape(s), 24), basic('#f8f4ee', stencilWrite));
  white.renderOrder = 10; eye.add(white);

  const iris = new THREE.Group(); iris.position.z = 0.002; eye.add(iris);
  const disc = (r, color, y = 0, z = 0, order = 11) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 28), basic(color, stencilRead));
    m.position.set(0, y, z); m.renderOrder = order; iris.add(m); return m;
  };
  disc(0.068, '#2c150d'); disc(0.052, '#6f3f22', -0.011, 0.0005, 12); disc(0.03, '#150b08', 0, 0.001, 13);
  const hl = (r, x, y) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 16), basic('#ffffff', stencilRead));
    m.position.set(x * s, y, 0.004); m.renderOrder = 14; eye.add(m);
  };
  hl(0.021, -0.026, 0.036); hl(0.011, 0.03, -0.022);

  const ink = basic(PAL.line);
  const top = tube(upperLid(s), 0.0105, ink); top.position.z = 0.004; top.renderOrder = 15; lash.add(top);
  const thick = tube(new THREE.CatmullRomCurve3(upperLid(s).getPoints(24).slice(14)), 0.0165, ink, 20);
  thick.position.z = 0.0042; thick.renderOrder = 15; lash.add(thick);
  const crease = tube(upperLid(s, false).clone(), 0.003, basic('#8a5233'), 24);
  crease.position.set(0, 0.026, 0.002); crease.scale.set(0.95, 1, 1); crease.renderOrder = 9; lash.add(crease);

  return {
    group: g, iris,
    set(blink, gx, gy, squint) {
      const sy = (1 - 0.93 * blink) * (1 - 0.22 * squint);
      eye.scale.y = Math.max(sy, 0.04);
      lash.position.y = -blink * 0.058 - squint * 0.006;
      lash.scale.y = 1 - blink * 0.35;
      iris.position.set(gx * 0.026, gy * 0.017 + 0.014, 0.002);   // +: центр радужки — по центру раскрытого глаза, а не ниже (иначе кажется, что смотрит вниз)
    },
  };
}

function browGeometry(len, arch, thick) {
  const pts = [], n = 14;
  const top = [], bot = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, x = (u - 0.5) * 2 * len;
    const e = Math.pow(1 - Math.abs(u - 0.38) / 0.62, 0.7);
    const th = thick * Math.max(e, 0.08);
    const y = arch * (1 - ((x / len) ** 2)) + 0.008 * u;
    top.push(new THREE.Vector2(x, y + th / 2)); bot.push(new THREE.Vector2(x, y - th / 2));
  }
  pts.push(...top, ...bot.reverse());
  return new THREE.ShapeGeometry(new THREE.Shape(pts));
}

export function buildEyes(head) {
  const eyes = [], brows = [];
  for (const s of [-1, 1]) {            // s = +1 — правый на экране, внешний уголок смотрит в +x
    const e = buildEye(s);
    placeOnFace(e.group, 0.2 * s, -0.005, 0.004); e.group.scale.setScalar(1.14);
    head.add(e.group); eyes.push(e);

    const bg = new THREE.Group();
    const bm = new THREE.Mesh(browGeometry(0.105, 0.014, 0.04), basic('#1a0f0b'));
    bg.add(bm);
    placeOnFace(bg, 0.215 * s, 0.158, 0.006);
    bm.scale.x = s;
    head.add(bg); brows.push({ g: bg, s, base: bg.position.clone(), baseQ: bg.quaternion.clone() });
  }
  const q = new THREE.Quaternion(), ax = new THREE.Vector3(0, 0, 1);
  return {
    update({ blink, gazeX, gazeY, squint, browUp, browInner }) {
      eyes.forEach((e) => e.set(blink, gazeX, gazeY, squint));
      brows.forEach((b) => {
        b.g.position.copy(b.base); b.g.position.y += browUp * 0.03 - squint * 0.008;
        // «внутренний» подъём/опускание (грусть/строгость): вращение вокруг оси z лица
        q.setFromAxisAngle(ax, -b.s * browInner * 0.35);
        b.g.quaternion.copy(b.baseQ).multiply(q);
      });
    },
  };
}

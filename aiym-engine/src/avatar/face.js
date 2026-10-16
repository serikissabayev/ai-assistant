import * as THREE from 'three';

// Форма головы: эллипсоид с сужением к подбородку. Все черты лица ставятся по этой поверхности.
export const HEAD = { rx: 0.465, ry: 0.62, rz: 0.5 };

// Сужение лица книзу: скулы тоньше (сужение начинается уже от линии глаз), подбородок мягкий
export const chinFactor = (y) => {
  const t = Math.max(0, -y / HEAD.ry);
  return 1 - 0.17 * t - 0.2 * Math.pow(t, 2.2);
};

export function faceZ(x, y) {
  const f = chinFactor(y);
  const q = 1 - (x / (HEAD.rx * f)) ** 2 - (y / HEAD.ry) ** 2;
  return HEAD.rz * Math.sqrt(Math.max(0, q));
}

const _n = new THREE.Vector3();
const _p = new THREE.Vector3();

export function placeOnFace(obj, x, y, offset = 0.006) {
  const f = chinFactor(y);
  const z = faceZ(x, y);
  _n.set(x / (HEAD.rx * f) ** 2, y / HEAD.ry ** 2, z / HEAD.rz ** 2).normalize();
  obj.position.set(x, y, z).addScaledVector(_n, offset);
  _p.copy(obj.position).add(_n);
  obj.lookAt(_p);
  return obj;
}

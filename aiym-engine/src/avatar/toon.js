import * as THREE from 'three';

export const PAL = {
  skin: '#d39a6c', skinShade: '#b9774d', hair: '#33201b', red: '#a01f2c', redDark: '#7a1520',
  gold: '#e3bd78', goldDeep: '#b98b3c', cream: '#f4e8cf', pearl: '#f8efdc', gem: '#c4202f',
  brown: '#5e3322', lip: '#a8504a', line: '#1c0f0d', outline: '#2b1411',
};

let gm;
function gradientMap() {
  if (gm) return gm;
  const steps = [182, 214, 240, 255]; // четыре ступени светотени — «мультяшный» вид
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  gm = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  gm.minFilter = gm.magFilter = THREE.NearestFilter;
  gm.generateMipmaps = false;
  gm.needsUpdate = true;
  return gm;
}

// Почти плоская светотень — для лица, чтобы тень не рисовала «второй подбородок»
let flatGm;
export function flatToon(color, opts = {}) {
  if (!flatGm) {
    const steps = [252, 253, 254, 255], data = new Uint8Array(steps.length * 4);
    steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
    flatGm = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
    flatGm.minFilter = flatGm.magFilter = THREE.NearestFilter; flatGm.generateMipmaps = false; flatGm.needsUpdate = true;
  }
  return new THREE.MeshToonMaterial({ color, gradientMap: flatGm, ...opts });
}

export const toon = (color, opts = {}) =>
  new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...opts });

// Контур «перевёрнутой оболочкой»: копия меша, раздутая вдоль нормалей, видна только изнутри.
const outlineCache = new Map();
function outlineMaterial(thick, color) {
  const key = `${thick}|${color}`;
  if (!outlineCache.has(key)) {
    outlineCache.set(key, new THREE.ShaderMaterial({
      uniforms: { t: { value: thick }, c: { value: new THREE.Color(color) } },
      vertexShader: `uniform float t;
        void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normalize(normal) * t, 1.0); }`,
      fragmentShader: `uniform vec3 c;
        void main(){
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
    }));
  }
  return outlineCache.get(key);
}

export function addOutline(mesh, thick = 0.012, color = PAL.outline) {
  const o = new THREE.Mesh(mesh.geometry, outlineMaterial(thick, color));
  o.name = 'outline';
  mesh.add(o);
  return mesh;
}

export const mesh = (geo, mat, parent) => {
  const m = new THREE.Mesh(geo, mat);
  parent?.add(m);
  return m;
};

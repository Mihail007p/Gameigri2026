// Помощники для сборки низкополигональной геометрии «на коленке»:
// без моделей, без текстур, без ассетов — только коробки/цилиндры + vertex colors.
// Это осознанный выбор под Mali-G52: ноль трафика памяти на текстуры и минимум draw call'ов.
import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/BufferGeometryUtils.js';

const D = new THREE.Object3D();
const _c = new THREE.Color();

/** Применить позицию/поворот/масштаб к геометрии (запекаем в вершины) */
export function place(geom, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  D.position.set(x, y, z); D.rotation.set(rx, ry, rz); D.scale.set(sx, sy, sz);
  D.updateMatrix();
  return geom.applyMatrix4(D.matrix);
}

/** Покрасить геометрию в один цвет (заменяет UV на color — UV нам не нужны) */
export function paint(geom, hex, jitter = 0) {
  _c.setHex(hex);
  geom.deleteAttribute('uv');
  const n = geom.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = jitter ? 1 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 - 0.5) * jitter : 1;
    arr[i * 3] = _c.r * j; arr[i * 3 + 1] = _c.g * j; arr[i * 3 + 2] = _c.b * j;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geom;
}

export const box = (w, h, d, hex, jitter = 0) => paint(new THREE.BoxGeometry(w, h, d), hex, jitter);
export const cyl = (rt, rb, h, seg, hex) => paint(new THREE.CylinderGeometry(rt, rb, h, seg), hex);
export const cone = (r, h, seg, hex) => {
  const g = new THREE.ConeGeometry(r, h, seg); g.translate(0, h / 2, 0); return paint(g, hex);
};
export const ico = (r, hex) => paint(new THREE.IcosahedronGeometry(r, 0), hex);

/** Слить список геометрий в одну (все должны иметь одинаковый набор атрибутов) */
export function merge(list) {
  const g = mergeGeometries(list, false);
  for (const l of list) l.dispose?.();
  return g;
}

/** Двускатная крыша: основание на y=0, конёк на y=1.5, длина вдоль Z = 1 */
export function gable(hex) {
  const g = new THREE.CylinderGeometry(1, 1, 1, 3);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.5, 0);
  return paint(g, hex);
}
export const ROOF_SX = 1 / 1.7320508;

/** Готовый меш: Lambert + vertex colors + плоское затенение (наш основной материал) */
export function vcMesh(geometry, opts = {}) {
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true, flatShading: true,
    emissive: 0x000000, ...opts,
  });
  const m = new THREE.Mesh(geometry, mat);
  m.castShadow = opts.castShadow !== false;
  m.receiveShadow = opts.receiveShadow !== false;
  return m;
}

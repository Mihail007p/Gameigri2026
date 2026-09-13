// Террейн: процедурная высота + стриминг чанков вокруг игрока.
// Никаких heightmap-текстур: высота считается функцией, поэтому мир весит 0 байт
// и бесшовен на любой дистанции.
import * as THREE from 'three';
import { WORLD } from '../config.js';
import { fbm, ridged, smoothstep, clamp, noise2 } from '../utils/noise.js';

const V = WORLD.village;          // деревня (плоское плато)
const L = { x: WORLD.lake.x, z: WORLD.lake.z, r: WORLD.lake.r };

/**
 * «Строительные площадки» — места, где рельеф принудительно выравнивается под постройки.
 * Единый источник правды: structures.js ставит дома ровно в эти координаты.
 */
export const PADS = [
  { x: V.x - 9,  z: V.z - 6,  r: 7, h: 5.4 },
  { x: V.x + 9,  z: V.z - 10, r: 7, h: 5.4 },
  { x: V.x + 14, z: V.z + 7,  r: 7, h: 5.4 },
  { x: V.x - 12, z: V.z + 9,  r: 7, h: 5.4 },
  { x: V.x + 1,  z: V.z - 22, r: 9, h: 5.4 },   // длинный дом
  { x: WORLD.ruins.x, z: WORLD.ruins.z, r: 15, h: 1.15 }, // затопленные руины (вровень с водой)
];

/** Высота поверхности в точке мира (метры). Используется и для рендера, и для физики. */
export function heightAt(x, z) {
  // 1. базовые холмы
  let h = 3.2 + (fbm(x * 0.0075, z * 0.0075, 4, WORLD.seed) - 0.5) * 15;
  // 2. крупные гряды
  h += ridged(x * 0.0033 + 5.1, z * 0.0033 - 3.7, 3, WORLD.seed + 71) * 16 - 4;
  // 3. котловина озера
  const ld = Math.hypot(x - L.x, z - L.z);
  h -= 11.5 * Math.exp(-(ld * ld) / (2 * L.r * L.r));
  // 4. плоское плато деревни (чтобы дома не висели в воздухе)
  const vd = Math.hypot(x - V.x, z - V.z);
  const flat = Math.exp(-(vd * vd) / (2 * 24 * 24));
  if (flat > 0.001) h = h * (1 - flat * 0.9) + 5.4 * (flat * 0.9);
  // 5. русло реки от озера к деревне — низина, по которой приятно идти
  const rd = Math.abs((x - (V.x + L.x) * 0.5) * 0.42 + (z - (V.z + L.z) * 0.5) * 0.9);
  h -= 3.2 * Math.exp(-(rd * rd) / (2 * 9 * 9)) * smoothstep(150, 20, Math.hypot(x - L.x, z - L.z));
  // 6. строительные площадки: выравниваем рельеф под дома и руины
  for (let i = 0; i < PADS.length; i++) {
    const p = PADS[i];
    const dx = x - p.x, dz = z - p.z;
    const d2 = dx * dx + dz * dz;
    const lim = p.r * p.r * 6.25;
    if (d2 < lim) {
      const w = Math.exp(-d2 / (2 * p.r * p.r)) * 0.96;
      h = h * (1 - w) + p.h * w;
    }
  }
  // 7. стена мира: горы по периметру (дальше идти некуда — как в Skyrim)
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const wall = smoothstep(WORLD.edgeWall, WORLD.half - 6, edge);
  h += wall * (34 + ridged(x * 0.012, z * 0.012, 2, WORLD.seed + 900) * 58);
  return h;
}

/** Уклон (0 — ровно, 1+ — отвесно). Нужен для цвета и для запрета деревьев. */
export function slopeAt(x, z) {
  const e = 0.9;
  const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
  const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  return Math.hypot(dx, dz);
}

/* ── палитра Севера ── */
const C_SAND = new THREE.Color(0x8a7a58);
const C_MUD  = new THREE.Color(0x5d5240);
const C_GRASS= new THREE.Color(0x4a6b34);
const C_GRASS2=new THREE.Color(0x5d7a3a);
const C_DRY  = new THREE.Color(0x7d7a4a);
const C_ROCK = new THREE.Color(0x6a675f);
const C_ROCK2= new THREE.Color(0x7d7a72);
const C_SNOW = new THREE.Color(0xe9eff4);
const tmpC = new THREE.Color();

function colorAt(x, z, h, slope) {
  const n = noise2(x * 0.09, z * 0.09, 4242);
  const n2 = noise2(x * 0.021, z * 0.021, 99);
  if (h < WORLD.water + 0.9) {
    tmpC.copy(C_MUD).lerp(C_SAND, smoothstep(WORLD.water - 1.4, WORLD.water + 0.8, h));
  } else if (h > 33) {
    tmpC.copy(C_ROCK2).lerp(C_SNOW, smoothstep(33, 44, h + n * 5));
  } else if (slope > 0.62) {
    tmpC.copy(C_ROCK).lerp(C_ROCK2, n);
    if (h > 26) tmpC.lerp(C_SNOW, smoothstep(26, 34, h) * 0.6);
  } else {
    tmpC.copy(C_GRASS).lerp(C_GRASS2, n2 * 0.85 + n * 0.15);
    // сухая трава на возвышенностях и проплешины
    tmpC.lerp(C_DRY, smoothstep(18, 27, h) * 0.55 + (n > 0.82 ? 0.25 : 0));
    if (slope > 0.34) tmpC.lerp(C_ROCK, smoothstep(0.34, 0.62, slope) * 0.7);
    if (h > 26) tmpC.lerp(C_SNOW, smoothstep(26, 33, h) * 0.5);
  }
  // лёгкий шум яркости, чтобы не было «пластиковых» пятен
  const j = 0.94 + n * 0.12;
  return [tmpC.r * j, tmpC.g * j, tmpC.b * j];
}

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();   // "cx,cz" -> Mesh
    this.pool = [];
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.base = new THREE.PlaneGeometry(WORLD.chunk, WORLD.chunk, WORLD.seg, WORLD.seg);
    this.base.rotateX(-Math.PI / 2);
    this.localX = Float32Array.from(this.base.attributes.position.array.filter((_, i) => i % 3 === 0));
    this.localZ = Float32Array.from(this.base.attributes.position.array.filter((_, i) => i % 3 === 2));
    this.viewChunks = 2;
    this.draws = 0;
  }

  _makeChunk() {
    const geom = this.base.clone();
    geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geom.attributes.position.count * 3), 3));
    const mesh = new THREE.Mesh(geom, this.material);
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    return mesh;
  }

  _fill(mesh, cx, cz) {
    const g = mesh.geometry;
    const pos = g.attributes.position;
    const col = g.attributes.color;
    const ox = cx * WORLD.chunk, oz = cz * WORLD.chunk;
    const arr = pos.array, carr = col.array;
    for (let i = 0; i < this.localX.length; i++) {
      const wx = ox + this.localX[i], wz = oz + this.localZ[i];
      const h = heightAt(wx, wz);
      arr[i * 3 + 1] = h;
      const c = colorAt(wx, wz, h, slopeAt(wx, wz));
      carr[i * 3] = c[0]; carr[i * 3 + 1] = c[1]; carr[i * 3 + 2] = c[2];
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    g.computeBoundingSphere();
    mesh.position.set(ox, 0, oz);
    mesh.updateMatrix();
    mesh.visible = true;
  }

  /** Стриминг: держим загруженными только чанки вокруг игрока */
  update(px, pz, viewChunks) {
    this.viewChunks = viewChunks;
    const ccx = Math.round(px / WORLD.chunk), ccz = Math.round(pz / WORLD.chunk);
    const need = new Set();
    for (let dz = -viewChunks; dz <= viewChunks; dz++) {
      for (let dx = -viewChunks; dx <= viewChunks; dx++) {
        const cx = ccx + dx, cz = ccz + dz;
        const key = cx + ',' + cz;
        need.add(key);
        if (this.chunks.has(key)) continue;
        const mesh = this.pool.pop() || this._makeChunk();
        this._fill(mesh, cx, cz);
        this.chunks.set(key, mesh);
        this.scene.add(mesh);
      }
    }
    // всё, что вышло из зоны видимости, — в пул (не уничтожаем: переиспользование дешевле)
    for (const [key, mesh] of this.chunks) {
      if (need.has(key)) continue;
      this.chunks.delete(key);
      this.scene.remove(mesh);
      mesh.visible = false;
      this.pool.push(mesh);
    }
    this.draws = this.chunks.size;
  }

  /** Высота под объектом (тот же источник правды, что и у рендера) */
  getHeight(x, z) { return heightAt(x, z); }

  /** Глубина воды в точке: >0 если объект в воде */
  waterDepth(x, z) { return WORLD.water - heightAt(x, z); }
}

// Стены слов — каменные плиты с рунами, у которых игрок учит новые крики.
// Дёшево для Mali-G52: каменная часть каждой стены слита в ОДИН меш
// (1 draw call), руны — второй меш с аддитивным материалом (ещё 1).
// Итого 4 draw call на две стены и ~150 треугольников.
import * as THREE from 'three';
import { WORD_WALLS, SHOUTS } from '../config.js';
import { heightAt } from './terrain.js';
import { mergeGeometries } from '../../vendor/BufferGeometryUtils.js';

const STONE = 0x6a6f77;
const STONE_DARK = 0x4e545c;

/** Камень стены: плита, два столба, перемычка и пара ступеней — всё в одну геометрию */
function buildStoneGeometry() {
  const parts = [];
  const add = (w, h, d, x, y, z, ry = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    parts.push(g);
  };
  add(3.4, 4.0, 0.7, 0, 2.0, 0);          // центральная плита с рунами
  add(0.7, 4.7, 1.0, -2.05, 2.35, 0);     // левый столб
  add(0.7, 4.7, 1.0, 2.05, 2.35, 0);      // правый столб
  add(4.9, 0.65, 1.15, 0, 4.95, 0);       // перемычка
  add(1.5, 0.5, 1.2, 0, 0.25, 0.95);      // нижний блок
  add(0.9, 1.3, 0.9, -2.9, 0.65, 0.7);    // обломок слева
  add(0.7, 0.9, 0.7, 2.7, 0.45, -0.6);    // обломок справа
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return merged;
}

/** Руны: три вертикальные «буквы» на плите — каждая из двух тонких коробок */
function buildRuneGeometry() {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 0.95;
    const a = new THREE.BoxGeometry(0.16, 1.5, 0.08); a.translate(x, 2.35, 0.4);
    const b = new THREE.BoxGeometry(0.5, 0.16, 0.08); b.translate(x, 2.85 + (i % 2) * 0.35, 0.4);
    const c = new THREE.BoxGeometry(0.16, 0.55, 0.08); c.translate(x + 0.22, 1.85, 0.4);
    parts.push(a, b, c);
  }
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return merged;
}

export class WordWalls {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.t = 0;

    const stoneGeo = buildStoneGeometry();
    const runeGeo = buildRuneGeometry();

    for (const w of WORD_WALLS) {
      const def = SHOUTS[w.word];
      const y = heightAt(w.x, w.z);
      const group = new THREE.Group();
      group.position.set(w.x, y - 0.15, w.z);
      group.rotation.y = w.yaw;

      const stone = new THREE.Mesh(stoneGeo, new THREE.MeshLambertMaterial({
        color: STONE, flatShading: true,
      }));
      stone.castShadow = false; stone.receiveShadow = true;

      const runeMat = new THREE.MeshBasicMaterial({
        color: 0x9fe8ff, transparent: true, opacity: 0.75,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      });
      const runes = new THREE.Mesh(runeGeo, runeMat);
      runes.renderOrder = 4;
      group.add(stone, runes);
      scene.add(group);

      this.list.push({
        id: w.id, word: w.word, def, where: w.where,
        pos: new THREE.Vector3(w.x, y, w.z),
        x: w.x, y, z: w.z, group, runes, runeMat,
        used: false, pulse: Math.random() * 6.28,
      });
    }
    this.triangles = (stoneGeo.attributes.position.count + runeGeo.attributes.position.count) / 3
      * WORD_WALLS.length;
  }

  /** Изучена ли стена (слово уже получено) */
  isUsed(id) { return !!this.list.find(w => w.id === id)?.used; }

  markUsed(id) {
    const w = this.list.find(x => x.id === id);
    if (!w) return;
    w.used = true;
    w.runeMat.color.setHex(STONE_DARK);
    w.runeMat.opacity = 0.3;
    w.runeMat.blending = THREE.NormalBlending;
  }

  /** Руны дышат ярче ночью и гаснут, когда слово уже взято */
  update(dt, night = 0) {
    this.t += dt;
    for (const w of this.list) {
      if (w.used) continue;
      w.pulse += dt;
      const k = 0.5 + 0.5 * Math.sin(w.pulse * 1.7);
      w.runeMat.opacity = Math.min(1, 0.4 + k * (0.25 + night * 0.35));
    }
  }

  /** Ближайшая доступная стена в радиусе maxDist (для подсказки взаимодействия) */
  nearest(pos, maxDist = 3.6) {
    let best = null, bd = maxDist;
    for (const w of this.list) {
      const d = Math.hypot(w.x - pos.x, w.z - pos.z);
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }

  serialize() { return this.list.map(w => w.used); }

  restore(arr) {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < Math.min(arr.length, this.list.length); i++) {
      if (arr[i]) this.markUsed(this.list[i].id);
    }
  }

  reset() {
    for (const w of this.list) {
      w.used = false;
      w.runeMat.color.setHex(0x9fe8ff);
      w.runeMat.opacity = 0.75;
      w.runeMat.blending = THREE.AdditiveBlending;
    }
  }
}

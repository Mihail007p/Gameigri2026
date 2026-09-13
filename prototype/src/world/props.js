// Растительность и камни. Ключевая оптимизация для Mali-G52:
//  • все объекты одного вида — ОДИН InstancedMesh (1 draw call на вид);
//  • список кандидатов хранится в пространственных корзинах 20×20 м;
//  • каждые 0.4 с инстансы пересобираются только в радиусе propRadius.
// Итог: 1200 деревьев в мире → ~150 в кадре → 3 draw call и ~6 тыс. треугольников.
import * as THREE from 'three';
import { WORLD } from '../config.js';
import { heightAt, slopeAt } from './terrain.js';
import { fbm, rng, clamp, smoothstep } from '../utils/noise.js';

const CELL = 20;
const key = (x, z) => ((Math.floor(x / CELL) + 512) << 10) | (Math.floor(z / CELL) + 512);

const T = { TREE: 0, ROCK: 1, BUSH: 2, DEAD: 3 };
const WHITE = new THREE.Color(1, 1, 1);

export class Props {
  constructor(scene) {
    this.scene = scene;
    this.items = [];           // {t,x,y,z,rot,s,c}
    this.buckets = new Map();
    this.timer = 0;

    // ВАЖНО: в three.js instanceColor умножается в diffuse ТОЛЬКО если у материала
    // включён vertexColors (см. шейдерный чанк color_fragment). Поэтому всем пропсам
    // добавляем белый атрибут color, а цветовые вариации задаём через setColorAt.
    const flat = { flatShading: true, vertexColors: true };
    const white = (g) => {
      const n = g.attributes.position.count;
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      return g;
    };
    /* ── геометрия (низкополигональная, без UV-развёртки) ── */
    const trunkG = new THREE.CylinderGeometry(0.15, 0.26, 1, 5, 1);
    trunkG.translate(0, 0.5, 0);
    const coneA = new THREE.ConeGeometry(1, 1, 6, 1);
    coneA.translate(0, 0.5, 0);
    const rockG = new THREE.IcosahedronGeometry(1, 0);
    // «обкалываем» камень, чтобы не был правильным
    const rp = rockG.attributes.position;
    const r = rng(31);
    for (let i = 0; i < rp.count; i++) {
      rp.setXYZ(i, rp.getX(i) * (0.72 + r() * 0.5), rp.getY(i) * (0.6 + r() * 0.5), rp.getZ(i) * (0.72 + r() * 0.5));
    }
    rockG.computeVertexNormals();
    const bushG = new THREE.IcosahedronGeometry(1, 0);
    bushG.scale(1, 0.72, 1);

    const M = {
      trunk: new THREE.MeshLambertMaterial({ color: 0xffffff, ...flat }),
      leafA: new THREE.MeshLambertMaterial({ color: 0xffffff, ...flat }),
      leafB: new THREE.MeshLambertMaterial({ color: 0xffffff, ...flat }),
      rock: new THREE.MeshLambertMaterial({ color: 0xffffff, ...flat }),
      bush: new THREE.MeshLambertMaterial({ color: 0xffffff, ...flat }),
    };

    // все геометрии получают белый color-атрибут
    for (const g of [trunkG, coneA, rockG, bushG]) white(g);

    const MAX = { tree: 260, rock: 90, bush: 190 };
    this.max = MAX;
    const mk = (g, m, n) => {
      const im = new THREE.InstancedMesh(g, m, n);
      im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
      im.count = 0;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // сразу аллоцируем instanceColor: иначе первый кадр скомпилирует программу
      // без USE_INSTANCING_COLOR, и цвета «включатся» только после перекомпиляции
      im.setColorAt(0, WHITE);
      scene.add(im);
      return im;
    };
    this.trunk = mk(trunkG, M.trunk, MAX.tree);
    this.leafA = mk(coneA, M.leafA, MAX.tree);
    this.leafB = mk(coneA.clone(), M.leafB, MAX.tree);
    this.rock = mk(rockG, M.rock, MAX.rock);
    this.bush = mk(bushG, M.bush, MAX.bush);
    // камни и кусты теней не отбрасывают: мелочь, а 2 draw call в теневом проходе экономим
    this.rock.castShadow = false; this.bush.castShadow = false;
    this.mats = M;
    this._dummy = new THREE.Object3D();
    this._col = new THREE.Color();
  }

  /** Однократная генерация списка объектов мира (без создания мешей) */
  generate() {
    const step = 4.2, R = 210, r = rng(WORLD.seed + 17);
    const vx = WORLD.village.x, vz = WORLD.village.z;
    const rx = WORLD.ruins.x, rz = WORLD.ruins.z;
    for (let x = -R; x <= R; x += step) {
      for (let z = -R; z <= R; z += step) {
        const jx = x + (r() - 0.5) * step * 1.5;
        const jz = z + (r() - 0.5) * step * 1.5;
        const h = heightAt(jx, jz);
        if (h < WORLD.water + 0.85) continue;                 // в воде не растёт
        const slope = slopeAt(jx, jz);
        if (slope > 0.62) continue;                           // на отвесных скалах тоже
        const dV = Math.hypot(jx - vx, jz - vz);
        const dR = Math.hypot(jx - rx, jz - rz);
        if (dV < 30) continue;                                // поляна деревни
        const forest = fbm(jx * 0.0062, jz * 0.0062, 3, 555); // пятна леса
        const alt = h;                                        // высота влияет на вид
        let t = -1, s = 1;

        if (dR < 30) {
          // у руин — мёртвые деревья и обломки, атмосфера «древнего зла»
          const q = r();
          if (q < 0.22) { t = T.DEAD; s = 0.8 + r() * 0.7; }
          else if (q < 0.42) { t = T.ROCK; s = 0.6 + r() * 1.5; }
        } else if (forest > 0.50 && alt < 25) {
          const q = r();
          if (q < 0.44) { t = T.TREE; s = 0.75 + r() * 0.85 + smoothstep(18, 4, alt) * 0.25; }
          else if (q < 0.52) { t = T.BUSH; s = 0.55 + r() * 0.7; }
          else if (q < 0.545) { t = T.ROCK; s = 0.4 + r() * 1.1; }
        } else if (forest <= 0.50) {
          const q = r();
          if (q < 0.045) { t = T.TREE; s = 0.8 + r() * 0.8; }   // редкие одиночные сосны
          else if (q < 0.13) { t = T.BUSH; s = 0.45 + r() * 0.6; }
          else if (q < 0.155) { t = T.ROCK; s = 0.35 + r() * 1.2; }
        }
        if (alt > 24 && r() < 0.14) { t = T.ROCK; s = 0.5 + r() * 1.4; } // осыпи на склонах
        if (t < 0) continue;

        const item = { t, x: jx, y: h - 0.12, z: jz, rot: r() * Math.PI * 2, s, c: r() };
        this.items.push(item);
        const k = key(jx, jz);
        let b = this.buckets.get(k); if (!b) { b = []; this.buckets.set(k, b); }
        b.push(this.items.length - 1);
      }
    }
    return this.items.length;
  }

  /** Пересборка видимых инстансов (не чаще 4 раз в секунду) */
  update(dt, px, pz, quality, force = false) {
    this.timer -= dt;
    if (!force && this.timer > 0) return;
    this.timer = 0.4;

    const R = quality.propRadius, R2 = R * R;
    const RB = quality.grassRadius;
    let nTree = 0, nRock = 0, nBush = 0;
    const d = this._dummy, c = this._col;
    const c0x = Math.floor((px - R) / CELL), c1x = Math.floor((px + R) / CELL);
    const c0z = Math.floor((pz - R) / CELL), c1z = Math.floor((pz + R) / CELL);

    for (let bx = c0x; bx <= c1x; bx++) {
      for (let bz = c0z; bz <= c1z; bz++) {
        const bucket = this.buckets.get(((bx + 512) << 10) | (bz + 512));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const it = this.items[bucket[i]];
          const dx = it.x - px, dz = it.z - pz;
          const d2 = dx * dx + dz * dz;
          const lim = it.t === T.BUSH ? RB * RB : R2;
          if (d2 > lim) continue;

          if (it.t === T.TREE || it.t === T.DEAD) {
            if (nTree >= this.max.tree) continue;
            const H = (it.t === T.TREE ? 4.6 : 5.4) * it.s;
            d.position.set(it.x, it.y, it.z);
            d.rotation.set(0, it.rot, 0);
            d.scale.set(it.s, H, it.s);
            d.updateMatrix();
            this.trunk.setMatrixAt(nTree, d.matrix);
            c.setHex(0x4a3a2a).offsetHSL(0, 0, (it.c - 0.5) * 0.08);
            this.trunk.setColorAt(nTree, c);

            if (it.t === T.TREE) {
              // нижняя крона
              d.position.set(it.x, it.y + H * 0.55, it.z);
              d.scale.set(1.95 * it.s, 3.5 * it.s, 1.95 * it.s);
              d.updateMatrix();
              this.leafA.setMatrixAt(nTree, d.matrix);
              const snow = smoothstep(15, 24, it.y);
              c.setHex(0x2f5230).offsetHSL((it.c - 0.5) * 0.03, 0, (it.c - 0.5) * 0.07 + snow * 0.16);
              this.leafA.setColorAt(nTree, c);
              // верхняя крона
              d.position.set(it.x, it.y + H * 0.55 + 2.5 * it.s, it.z);
              d.scale.set(1.25 * it.s, 2.7 * it.s, 1.25 * it.s);
              d.updateMatrix();
              this.leafB.setMatrixAt(nTree, d.matrix);
              c.setHex(0x3a6136).offsetHSL((it.c - 0.5) * 0.03, 0, (it.c - 0.5) * 0.08 + snow * 0.2);
              this.leafB.setColorAt(nTree, c);
            } else {
              // мёртвое дерево: «сломанная» верхушка
              d.position.set(it.x, it.y + H * 0.6, it.z);
              d.scale.set(0.5 * it.s, 2.2 * it.s, 0.5 * it.s);
              d.rotation.set(0.25, it.rot, 0.3);
              d.updateMatrix();
              this.leafA.setMatrixAt(nTree, d.matrix);
              c.setHex(0x3b3026);
              this.leafA.setColorAt(nTree, c);
              d.scale.set(0, 0, 0); d.rotation.set(0, 0, 0);
              d.position.set(it.x, it.y - 50, it.z);
              d.updateMatrix();
              this.leafB.setMatrixAt(nTree, d.matrix);
              this.leafB.setColorAt(nTree, c);
            }
            nTree++;
          } else if (it.t === T.ROCK) {
            if (nRock >= this.max.rock) continue;
            d.position.set(it.x, it.y + it.s * 0.18, it.z);
            d.rotation.set(it.c * 0.6, it.rot, it.c * 0.4);
            d.scale.set(it.s * 1.1, it.s * 0.8, it.s * 1.05);
            d.updateMatrix();
            this.rock.setMatrixAt(nRock, d.matrix);
            const snow = smoothstep(16, 26, it.y);
            c.setHex(0x6f6c64).offsetHSL(0, 0, (it.c - 0.5) * 0.12 + snow * 0.25);
            this.rock.setColorAt(nRock, c);
            nRock++;
          } else {
            if (nBush >= this.max.bush) continue;
            d.position.set(it.x, it.y + it.s * 0.22, it.z);
            d.rotation.set(0, it.rot, 0);
            d.scale.set(it.s * 1.25, it.s * 0.95, it.s * 1.2);
            d.updateMatrix();
            this.bush.setMatrixAt(nBush, d.matrix);
            c.setHex(0x3d5c31).offsetHSL((it.c - 0.5) * 0.05, 0, (it.c - 0.5) * 0.1);
            this.bush.setColorAt(nBush, c);
            nBush++;
          }
        }
      }
    }

    this.trunk.count = nTree; this.leafA.count = nTree; this.leafB.count = nTree;
    this.rock.count = nRock; this.bush.count = nBush;
    for (const m of [this.trunk, this.leafA, this.leafB, this.rock, this.bush]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.visible = { trees: nTree, rocks: nRock, bushes: nBush };
  }

  /** Ночью листва чуть темнее и холоднее — дешёвая атмосфера без лишнего света */
  applyNight(night) {
    const k = 1 - night * 0.35;
    this.mats.leafA.color.setRGB(k, k, k * 1.02);
    this.mats.leafB.color.setRGB(k, k, k * 1.02);
    this.mats.trunk.color.setRGB(k, k, k);
    this.mats.bush.color.setRGB(k, k, k * 1.02);
    this.mats.rock.color.setRGB(k, k, k * 1.04);
  }
}

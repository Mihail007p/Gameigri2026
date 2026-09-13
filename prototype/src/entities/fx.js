// Частицы: один InstancedMesh на все эффекты (искры, кровь, щепки) = 1 draw call.
// Затухание делаем через цвет при аддитивном смешивании — без прозрачности и сортировки.
import * as THREE from 'three';
import { clamp } from '../utils/noise.js';

const MAX = 96;

export class Fx {
  constructor(scene) {
    this.geo = new THREE.TetrahedronGeometry(0.1);
    // белый color-атрибут обязателен: без vertexColors three.js игнорирует instanceColor
    this.geo.setAttribute('color', new THREE.BufferAttribute(
      new Float32Array(this.geo.attributes.position.count * 3).fill(1), 3));
    this.mat = new THREE.MeshBasicMaterial({
      vertexColors: true, blending: THREE.AdditiveBlending, transparent: true,
      depthWrite: false, fog: false, toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, MAX);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.items = [];
    this._d = new THREE.Object3D();
    this._c = new THREE.Color();
  }

  /** Всплеск частиц из точки */
  burst(x, y, z, hex, count = 8, speed = 3.2, up = 1.6, life = 0.55, size = 1) {
    for (let i = 0; i < count; i++) {
      if (this.items.length >= MAX) this.items.shift();
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * 0.9;
      const s = speed * (0.45 + Math.random() * 0.75);
      this.items.push({
        x, y, z,
        vx: Math.cos(a) * s * (1 - e * 0.5),
        vy: up * (0.4 + Math.random() * 0.9) * s * 0.45,
        vz: Math.sin(a) * s * (1 - e * 0.5),
        life, max: life, size: size * (0.6 + Math.random() * 0.8),
        hex, rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 12, g: 1,
      });
    }
  }

  burstAt(vec, hex, count, speed, up, life, size) {
    this.burst(vec.x, vec.y, vec.z, hex, count, speed, up, life, size);
  }

  /**
   * Ударная волна крика: кольцо частиц, разлетающееся горизонтально БЕЗ гравитации.
   * dir — направление конуса (0 = во все стороны), spread — полуугол в радианах.
   */
  shockwave(x, y, z, hex, { count = 26, speed = 13, life = 0.5, size = 1.1, dir = null, spread = Math.PI } = {}) {
    for (let i = 0; i < count; i++) {
      if (this.items.length >= MAX) this.items.shift();
      // угол равномерно внутри конуса (или полный круг, если dir не задан)
      const a = dir
        ? Math.atan2(dir.x, dir.z) + (Math.random() * 2 - 1) * spread
        : Math.random() * Math.PI * 2;
      const s = speed * (0.6 + Math.random() * 0.7);
      this.items.push({
        x, y: y + Math.random() * 0.5, z,
        vx: Math.sin(a) * s, vy: 0.35 + Math.random() * 0.5, vz: Math.cos(a) * s,
        life, max: life, size: size * (0.6 + Math.random() * 0.7),
        hex, rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 8, g: 0,
      });
    }
  }

  /** След рывка «Вихрь»: редкие искры вдоль пути, тоже без гравитации */
  trail(x, y, z, hex, count = 2, speed = 1.1) {
    for (let i = 0; i < count; i++) {
      if (this.items.length >= MAX) this.items.shift();
      const a = Math.random() * Math.PI * 2;
      this.items.push({
        x: x + Math.cos(a) * 0.25, y: y + 0.4 + Math.random() * 1.0, z: z + Math.sin(a) * 0.25,
        vx: Math.cos(a) * speed, vy: 0.25, vz: Math.sin(a) * speed,
        life: 0.32, max: 0.32, size: 0.7 + Math.random() * 0.5,
        hex, rot: Math.random() * 6.28, spin: 2, g: 0,
      });
    }
  }

  update(dt) {
    const d = this._d, c = this._c;
    let n = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life -= dt;
      if (p.life <= 0) { this.items.splice(i, 1); continue; }
      if (p.g) p.vy -= 12 * dt;            // гравитация только у «материальных» частиц
      const drag = p.g ? 2.2 : 3.4;        // волна крика гаснет быстрее
      p.vx *= 1 - drag * dt; p.vz *= 1 - drag * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.spin * dt;
      const k = clamp(p.life / p.max, 0, 1);
      const s = p.size * (0.35 + k * 0.9);
      d.position.set(p.x, p.y, p.z);
      d.rotation.set(p.rot * 0.6, p.rot, p.rot * 0.3);
      d.scale.setScalar(s);
      d.updateMatrix();
      this.mesh.setMatrixAt(n, d.matrix);
      c.setHex(p.hex).multiplyScalar(k * 1.7);
      this.mesh.setColorAt(n, c);
      n++;
    }
    this.mesh.count = n;
    if (n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
}

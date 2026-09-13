// Вода: одна плоскость на весь мир, лёгкая волна на CPU (629 вершин — копейки).
// Lambert + emissive от неба: дёшево по fillrate и при этом вода «живая».
import * as THREE from 'three';
import { WORLD } from '../config.js';

const DEEP = new THREE.Color(0x0d2430); // без аллокаций в кадре: мобильный GC дорог

export class Water {
  constructor(scene) {
    const size = WORLD.size + 400;
    this.geom = new THREE.PlaneGeometry(size, size, 26, 26);
    this.geom.rotateX(-Math.PI / 2);
    this.base = Float32Array.from(this.geom.attributes.position.array);
    this.mat = new THREE.MeshLambertMaterial({
      color: 0x1e3d4d, transparent: true, opacity: 0.82,
      flatShading: true, depthWrite: false, emissive: 0x0a1a24,
    });
    this.mesh = new THREE.Mesh(this.geom, this.mat);
    this.mesh.position.y = WORLD.water;
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
    this._t = 0; this._skip = 0;
  }

  update(dt, sky, quality) {
    this._t += dt;
    // цвет воды тянем к небу — бесплатное «отражение»
    this.mat.emissive.copy(sky.hor).multiplyScalar(0.16 + sky.night * 0.05);
    this.mat.color.copy(sky.zen).lerp(DEEP, 0.72);
    if (!quality.waterWave) return;
    if ((this._skip = (this._skip + 1) % 2) !== 0) return; // волну считаем через кадр

    const pos = this.geom.attributes.position;
    const a = pos.array, b = this.base, t = this._t;
    for (let i = 0; i < a.length; i += 3) {
      const x = b[i], z = b[i + 2];
      a[i + 1] = Math.sin(x * 0.055 + t * 1.25) * 0.09 + Math.cos(z * 0.041 + t * 0.95) * 0.09;
    }
    pos.needsUpdate = true;
  }
}

// Постройки: деревня, затопленные руины, костёр, сундуки, колодец, указатель.
// Вся статика сливается в ОДИН меш (mergeGeometries) → 1 draw call на всю деревню.
import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/BufferGeometryUtils.js';
import { WORLD } from '../config.js';
import { PADS, heightAt } from './terrain.js';
import { rng } from '../utils/noise.js';
import { place, box, cyl, gable as gableRoof, ROOF_SX } from '../utils/geo.js';

/** локальное смещение → мировое (для повёрнутых домов) */
function off(p, rot, lx, lz) {
  return { x: p.x + Math.cos(rot) * lx + Math.sin(rot) * lz, z: p.z - Math.sin(rot) * lx + Math.cos(rot) * lz };
}

export class Structures {
  constructor(scene) {
    this.scene = scene;
    this.r = rng(9021);
    this.solid = [];
    this.glow = [];
    this.chests = [];

    this._village();
    this._ruins();
    this._dock();
    this._signpost();
    this._mergeInto(scene);
    this._fire(scene);
    this._chest(scene, WORLD.village.x + 13.5, WORLD.village.z + 4, 2.2, 'chest_village',
      [{ id: 'potion', q: 2 }, { id: 'bread', q: 1 }], 28);
    this._chest(scene, WORLD.ruins.x + 5.5, WORLD.ruins.z - 4.5, 0.6, 'chest_ruins',
      [{ id: 'potion', q: 1 }, { id: 'amulet', q: 1 }], 65);
  }

  /* ══════════════ ДЕРЕВНЯ ══════════════ */
  _village() {
    const S = this.solid, G = this.glow, r = this.r;
    const houses = [
      { p: PADS[0], w: 6.2, d: 5.0, wallH: 2.9, roofH: 2.2, rot: 0.35, wall: 0x6d573c },
      { p: PADS[1], w: 5.6, d: 5.4, wallH: 2.7, roofH: 2.0, rot: -0.55, wall: 0x63503a },
      { p: PADS[2], w: 5.2, d: 4.6, wallH: 2.6, roofH: 1.9, rot: 2.45, wall: 0x71593d },
      { p: PADS[3], w: 5.8, d: 4.8, wallH: 2.8, roofH: 2.1, rot: -2.6, wall: 0x5f4c37 },
      { p: PADS[4], w: 13.5, d: 6.4, wallH: 3.8, roofH: 3.1, rot: 0.12, wall: 0x6a5339 }, // длинный дом
    ];

    for (const h of houses) {
      const p = h.p, y = p.h, rot = h.rot;
      const base = 0.75;
      // цоколь из камня
      S.push(place(box(h.w + 0.6, base, h.d + 0.6, 0x6b6862, 0.12), p.x, y + base / 2, p.z, 0, rot, 0));
      // стены
      S.push(place(box(h.w, h.wallH, h.d, h.wall, 0.1), p.x, y + base + h.wallH / 2, p.z, 0, rot, 0));
      // вертикальные балки по углам — читаемый «северный» силуэт
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const o = off(p, rot, sx * h.w / 2, sz * h.d / 2);
        S.push(place(box(0.28, h.wallH + 0.2, 0.28, 0x463524), o.x, y + base + h.wallH / 2, o.z, 0, rot, 0));
      }
      // крыша
      const ry = y + base + h.wallH;
      S.push(place(gableRoof(0x3c4a42), p.x, ry, p.z, 0, rot, 0,
        (h.w + 1.1) * ROOF_SX, h.roofH / 1.5, h.d + 1.2));
      // конёк
      S.push(place(box(0.24, 0.2, h.d + 1.3, 0x2f3a34), p.x, ry + h.roofH, p.z, 0, rot, 0));
      // труба
      const ch = off(p, rot, h.w * 0.24, -h.d * 0.18);
      S.push(place(box(0.72, h.roofH + 1.5, 0.72, 0x6a675f), ch.x, ry + (h.roofH + 1.5) / 2 - 0.6, ch.z, 0, rot, 0));
      // дверь
      const dr = off(p, rot, 0, h.d / 2 + 0.06);
      S.push(place(box(1.15, 2.05, 0.14, 0x2d2318), dr.x, y + base + 1.02, dr.z, 0, rot, 0));
      S.push(place(box(1.35, 0.16, 0.2, 0x463524), dr.x, y + base + 2.12, dr.z, 0, rot, 0));
      // ступенька
      const st = off(p, rot, 0, h.d / 2 + 0.6);
      S.push(place(box(1.6, 0.22, 0.7, 0x6b6862), st.x, y + 0.32, st.z, 0, rot, 0));
      // окна (стекло светится ночью) + деревянный подоконник и притолока
      const wy = y + base + h.wallH * 0.58;
      for (const [lx, lz, side] of [[-h.w * 0.3, h.d / 2 + 0.08, 0], [h.w * 0.3, h.d / 2 + 0.08, 0],
                                    [h.w / 2 + 0.08, 0, 1], [-h.w / 2 - 0.08, 0, 1]]) {
        const o = off(p, rot, lx, lz);
        const pw = side ? 0.16 : 0.95, pd = side ? 0.95 : 0.16;
        G.push(place(box(pw, 0.8, pd, 0xffb45a), o.x, wy, o.z, 0, rot, 0));
        S.push(place(box(pw + 0.22, 0.13, pd + 0.22, 0x463524), o.x, wy - 0.47, o.z, 0, rot, 0));
        S.push(place(box(pw + 0.22, 0.13, pd + 0.22, 0x463524), o.x, wy + 0.47, o.z, 0, rot, 0));
      }
      // дрова у стены
      const wd = off(p, rot, -h.w / 2 - 0.9, h.d * 0.2);
      for (let i = 0; i < 4; i++) {
        S.push(place(cyl(0.11, 0.11, 1.1, 5, 0x59432c), wd.x, y + 0.55, wd.z + i * 0.24 - 0.36, 0, rot, Math.PI / 2));
      }
    }

    // ── колодец в центре ──
    const wx = WORLD.village.x - 1, wz = WORLD.village.z + 1, wy = heightAt(wx, wz);
    S.push(place(cyl(1.35, 1.5, 1.1, 8, 0x6f6c64), wx, wy + 0.55, wz, 0, 0.3, 0));
    S.push(place(cyl(1.15, 1.15, 0.2, 8, 0x2b3a44), wx, wy + 1.02, wz, 0, 0.3, 0));
    for (const s of [-1, 1]) S.push(place(box(0.18, 2.3, 0.18, 0x463524), wx + s * 1.05, wy + 2.1, wz, 0, 0.3, 0));
    S.push(place(gableRoof(0x3c4a42), wx, wy + 3.1, wz, 0, 0.3, 0, 2.9 * ROOF_SX, 0.9 / 1.5, 2.6));
    S.push(place(cyl(0.14, 0.14, 2.1, 6, 0x59432c), wx, wy + 2.5, wz, 0, 0, Math.PI / 2));
    this.well = { x: wx, z: wz, y: wy, label: 'Выпить воды' };

    // ── кострище (пламя и свет создаются отдельно) ──
    const fx = WORLD.village.x + 6, fz = WORLD.village.z + 5;
    this.firePos = { x: fx, z: fz, y: heightAt(fx, fz) };
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2;
      S.push(place(box(0.42, 0.34, 0.36, 0x6f6c64, 0.2),
        fx + Math.cos(a) * 1.15, this.firePos.y + 0.16, fz + Math.sin(a) * 1.15, 0, a, 0));
    }
    for (let i = 0; i < 4; i++) {
      S.push(place(cyl(0.1, 0.13, 1.5, 5, 0x3a2c1e), fx, this.firePos.y + 0.3, fz,
        Math.PI / 2 - 0.35, i * 1.4, 0));
    }
    // брёвна-сиденья вокруг костра
    for (const [lx, lz, rr] of [[-2.6, 1.2, 0.4], [1.4, -2.7, 1.9], [2.9, 1.6, -0.6]]) {
      S.push(place(cyl(0.26, 0.3, 2.1, 6, 0x4d3a26), fx + lx, this.firePos.y + 0.32, fz + lz, 0, rr, Math.PI / 2));
    }

    // ── забор с севера деревни ──
    for (let i = 0; i < 12; i++) {
      const a = Math.PI * (0.95 + i * 0.052);
      const px = WORLD.village.x + Math.cos(a) * 27, pz = WORLD.village.z + Math.sin(a) * 22;
      const py = heightAt(px, pz);
      S.push(place(box(0.17, 1.5, 0.17, 0x4d3a26), px, py + 0.75, pz, 0, a, 0));
      if (i % 3 === 0) S.push(place(box(0.1, 0.12, 3.1, 0x59432c), px, py + 1.15, pz, 0, a + Math.PI / 2, 0));
    }

    // ── ящики и бочки ──
    for (let i = 0; i < 5; i++) {
      const a = r() * Math.PI * 2, d = 8 + r() * 14;
      const px = WORLD.village.x + Math.cos(a) * d, pz = WORLD.village.z + Math.sin(a) * d;
      const py = heightAt(px, pz);
      if (r() < 0.5) S.push(place(box(0.85, 0.85, 0.85, 0x5c472e, 0.1), px, py + 0.42, pz, 0, r() * 3, 0));
      else S.push(place(cyl(0.42, 0.38, 1.0, 7, 0x4d3a26), px, py + 0.5, pz, 0, r() * 3, 0));
    }
  }

  /* ══════════════ ЗАТОПЛЕННЫЕ РУИНЫ ══════════════ */
  _ruins() {
    const S = this.solid, r = this.r;
    const p = PADS[5], y = p.h, rx = p.x, rz = p.z;
    const STONE = 0x6f726b, MOSS = 0x5f6b52;

    // платформа, уходящая в воду
    S.push(place(box(26, 0.8, 21, STONE, 0.08), rx, y - 0.1, rz, 0, 0.22, 0));
    S.push(place(box(20, 0.5, 15, 0x65685f, 0.08), rx, y + 0.5, rz, 0, 0.22, 0));

    // обломки стен
    const walls = [
      [-8, -6, 7.5, 3.4, 0.9, 0.22], [5, -7.5, 9, 2.2, 0.9, 0.22],
      [-9.5, 3, 6, 4.2, 0.9, 1.75], [7.5, 4, 5.5, 1.6, 0.9, 1.7],
      [0, 8.5, 11, 2.6, 0.9, 0.22],
    ];
    for (const [lx, lz, w, h, d, rot] of walls) {
      const o = off({ x: rx, z: rz }, 0.22, lx, lz);
      S.push(place(box(w, h, d, r() < 0.4 ? MOSS : STONE, 0.1), o.x, y + h / 2 - 0.35, o.z, (r() - 0.5) * 0.06, rot, (r() - 0.5) * 0.05));
      // зубчатый верх — «отломано»
      for (let i = 0; i < 3; i++) {
        const t = (i / 2 - 0.5) * w * 0.7;
        const oo = off({ x: o.x, z: o.z }, rot, t, 0);
        if (r() < 0.75) S.push(place(box(w * 0.22, h * (0.2 + r() * 0.3), d * 1.02, STONE, 0.1), oo.x, y + h - 0.2 + h * 0.1, oo.z, 0, rot, 0));
      }
    }

    // арка из двух колонн и перемычки
    for (const s of [-1, 1]) {
      const o = off({ x: rx, z: rz }, 0.22, s * 3.1, -2.5);
      S.push(place(cyl(0.62, 0.72, 5.4, 7, STONE), o.x, y + 2.4, o.z, 0, 0, 0));
      S.push(place(box(1.6, 0.4, 1.6, 0x7b7e75), o.x, y + 5.2, o.z, 0, 0.22, 0));
    }
    S.push(place(box(8.4, 0.75, 1.5, 0x767a70), rx, y + 5.75, rz - 2.5, 0, 0.22, 0.02));

    // поваленная колонна
    const fo = off({ x: rx, z: rz }, 0.22, 6.5, 6.5);
    S.push(place(cyl(0.55, 0.6, 5.2, 7, MOSS), fo.x, y + 0.55, fo.z, 0, 0.9, Math.PI / 2));

    // алтарь в центре
    S.push(place(box(2.6, 1.0, 1.6, 0x5f6259), rx, y + 0.9, rz + 1.2, 0, 0.22, 0));
    S.push(place(box(3.0, 0.24, 1.9, 0x7b7e75), rx, y + 1.5, rz + 1.2, 0, 0.22, 0));

    // менгиры по периметру — силуэт «древнего зла»
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2 + 0.4;
      const px = rx + Math.cos(a) * 14.5, pz = rz + Math.sin(a) * 12.5;
      const py = heightAt(px, pz);
      S.push(place(box(0.9, 2.4 + r() * 2.2, 0.7, MOSS, 0.12), px, py + 1.2, pz, (r() - 0.5) * 0.16, a, (r() - 0.5) * 0.14));
    }

    // затопленные ступени к воде
    for (let i = 0; i < 4; i++) {
      const o = off({ x: rx, z: rz }, 0.22, -12.5 - i * 1.1, 0);
      S.push(place(box(1.1, 0.35, 5.5, STONE, 0.06), o.x, y - 0.5 - i * 0.42, o.z, 0, 0.22, 0));
    }
    this.ruinsPos = { x: rx, z: rz, y };
  }

  /* ══════════════ ПРИСТАНЬ ══════════════ */
  _dock() {
    const S = this.solid;
    // ищем берег: идём от центра озера к деревне, пока не выйдем из воды
    const L = WORLD.lake, V = WORLD.village;
    const dx = V.x - L.x, dz = V.z - L.z, len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    let sx = 0, sz = 0, t = L.r * 0.35;
    for (; t < L.r * 1.25; t += 2) {
      sx = L.x + ux * t; sz = L.z + uz * t;
      if (heightAt(sx, sz) > WORLD.water + 0.35) break;
    }
    const y = WORLD.water + 0.55;
    for (let i = 0; i < 7; i++) {
      const px = sx - ux * i * 1.5, pz = sz - uz * i * 1.5;
      S.push(place(box(3.0, 0.16, 1.35, 0x59432c, 0.1), px, y, pz, 0, Math.atan2(ux, uz), 0));
      if (i % 2 === 0) for (const s of [-1, 1]) {
        const o = { x: px + uz * s * 1.3, z: pz - ux * s * 1.3 };
        S.push(place(cyl(0.14, 0.16, 2.6, 5, 0x463524), o.x, y - 1.1, o.z, 0, 0, 0));
      }
    }
    // столб с фонарём на конце
    S.push(place(cyl(0.12, 0.14, 3.2, 5, 0x463524), sx + uz * 1.2, y + 1.5, sz - ux * 1.2, 0, 0, 0));
    this.glow.push(place(box(0.42, 0.5, 0.42, 0xffc46a), sx + uz * 1.2, y + 3.05, sz - ux * 1.2, 0, 0, 0));
    this.dockPos = { x: sx, z: sz };
  }

  /* ══════════════ УКАЗАТЕЛЬ У МЕСТА ПОЯВЛЕНИЯ ══════════════ */
  _signpost() {
    const S = this.solid;
    const x = WORLD.spawn.x, z = WORLD.spawn.z - 2, y = heightAt(x, z);
    S.push(place(cyl(0.13, 0.16, 3.0, 6, 0x463524), x, y + 1.5, z, 0, 0, 0));
    S.push(place(box(2.2, 0.5, 0.12, 0x6a5339), x + 0.9, y + 2.5, z, 0, -0.35, 0.05));
    S.push(place(box(1.9, 0.44, 0.12, 0x6a5339), x + 0.7, y + 1.95, z, 0, 0.55, -0.04));
    this.signPos = { x, z };
  }

  /* ══════════════ СЛИЯНИЕ В ОДИН МЕШ ══════════════ */
  _mergeInto(scene) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.mesh = new THREE.Mesh(mergeGeometries(this.solid, false), mat);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false; this.mesh.updateMatrix();
    scene.add(this.mesh);

    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true });
    this.glowMesh = new THREE.Mesh(mergeGeometries(this.glow, false), this.glowMat);
    this.glowMesh.matrixAutoUpdate = false; this.glowMesh.updateMatrix();
    this.glowMesh.renderOrder = 1;
    scene.add(this.glowMesh);

    this.solid.length = 0; this.glow.length = 0; // освобождаем память после слияния
  }

  /* ══════════════ КОСТЁР: пламя + свет ══════════════ */
  _fire(scene) {
    const f = this.firePos;
    const fmat = new THREE.MeshBasicMaterial({
      color: 0xffa033, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
    });
    const fmat2 = new THREE.MeshBasicMaterial({
      color: 0xffdd77, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
    });
    const cone = new THREE.ConeGeometry(0.42, 1.5, 5, 1, true);
    cone.translate(0, 0.75, 0);
    this.flameA = new THREE.Mesh(cone, fmat);
    this.flameB = new THREE.Mesh(cone.clone().scale(0.6, 0.7, 0.6), fmat2);
    this.flameA.position.set(f.x, f.y + 0.25, f.z);
    this.flameB.position.set(f.x, f.y + 0.25, f.z);
    this.flameA.renderOrder = 3; this.flameB.renderOrder = 4;
    scene.add(this.flameA, this.flameB);

    // один точечный свет на всю игру: дешёвый, но даёт уют и читается ночью
    this.fireLight = new THREE.PointLight(0xff8a3a, 6, 30, 2);
    this.fireLight.position.set(f.x, f.y + 1.1, f.z);
    scene.add(this.fireLight);
    this._ft = 0;
  }

  /* ══════════════ СУНДУК (интерактивный) ══════════════ */
  _chest(scene, x, z, rot, id, loot, gold) {
    const y = heightAt(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z); g.rotation.y = rot;

    const baseG = mergeGeometries([
      place(box(1.0, 0.55, 0.68, 0x5c472e, 0.08), 0, 0.28, 0),
      place(box(1.04, 0.1, 0.72, 0x8a7a55), 0, 0.16, 0),
      place(box(1.04, 0.1, 0.72, 0x8a7a55), 0, 0.48, 0),
      place(box(0.14, 0.58, 0.72, 0x8a7a55), 0, 0.28, 0),
    ], false);
    const base = new THREE.Mesh(baseG, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    base.castShadow = true; base.receiveShadow = true;

    const lidPivot = new THREE.Object3D();
    lidPivot.position.set(0, 0.56, -0.34);
    const lidG = mergeGeometries([
      place(box(1.0, 0.2, 0.68, 0x5c472e, 0.08), 0, 0.1, 0.34),
      place(box(1.04, 0.08, 0.72, 0x8a7a55), 0, 0.19, 0.34),
      place(box(0.16, 0.24, 0.1, 0xc8a44a), 0, 0.02, 0.68),
    ], false);
    const lid = new THREE.Mesh(lidG, base.material);
    lid.castShadow = true;
    lidPivot.add(lid);
    g.add(base, lidPivot);
    scene.add(g);

    this.chests.push({ id, group: g, lidPivot, x, y, z, open: false, looted: false, t: 0, loot, gold, label: 'Открыть сундук' });
  }

  /* ══════════════ КАЖДЫЙ КАДР ══════════════ */
  update(dt, night, lightLevel) {
    // окна и фонарь: днём тёмные, ночью тёплые
    const k = 0.16 + Math.pow(night, 0.7) * 1.5;
    this.glowMat.color.setRGB(k * 1.0, k * 0.86, k * 0.62);

    // пламя
    this._ft += dt;
    const t = this._ft;
    const s = 1 + Math.sin(t * 11.3) * 0.11 + Math.sin(t * 23.7) * 0.06;
    this.flameA.scale.set(0.9 + Math.sin(t * 7.1) * 0.08, s, 0.9 + Math.cos(t * 6.3) * 0.08);
    this.flameA.rotation.y = t * 1.7;
    this.flameB.scale.set(1, 1 + Math.sin(t * 15.1 + 1) * 0.18, 1);
    this.flameB.rotation.y = -t * 2.4;
    const flick = 0.82 + Math.sin(t * 9.1) * 0.1 + Math.sin(t * 21.3) * 0.06;
    this.fireLight.intensity = (3.5 + night * 22) * flick;

    // сундуки: плавное открытие крышки
    for (const c of this.chests) {
      if (!c.open && c.t <= 0) continue;
      const target = c.open ? -1.95 : 0;
      c.t += dt * 3.2;
      const cur = c.lidPivot.rotation.x;
      c.lidPivot.rotation.x += (target - cur) * Math.min(1, dt * 7);
      if (Math.abs(target - c.lidPivot.rotation.x) < 0.01) { c.lidPivot.rotation.x = target; c.t = 0; }
    }
  }

  openChest(id) {
    const c = this.chests.find(c => c.id === id);
    if (c && !c.open) { c.open = true; c.t = 1; }
    return c;
  }
}

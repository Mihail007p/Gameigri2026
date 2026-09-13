// Низкополигональные персонажи и их процедурная анимация.
// Принцип: каждая конечность — ОДИН слитый меш (5 мешей на фигуру),
// анимация — повороты пивотов, никаких скелетов и скиннинга (дешево для CPU и GPU).
import * as THREE from 'three';
import { box, cyl, cone, merge, place } from '../utils/geo.js';
import { clamp, lerp } from '../utils/noise.js';

const ease = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);

const HIP = 0.92;       // высота бёдер
const SHOULDER = 0.56;  // смещение плеча от бёдер

/* ── позы удара (рад) ── */
const S_IDLE = { ax: -0.22, az: -0.16, ty: 0 };
const S_WIND = { ax: -2.35, az: 0.95, ty: -0.6 };
const S_END = { ax: 0.85, az: -0.45, ty: 0.62 };

export class Rig {
  /**
   * @param {'nord'|'draugr'|'wolf'|'villager'} kind
   * @param {object} o — {scale, colors, shield, weapon}
   */
  constructor(kind, o = {}) {
    this.kind = kind;
    this.root = new THREE.Group();   // позиция/поворот задаёт сущность
    this.pose = new THREE.Group();   // внутренний слой для анимации (падение, покачивание)
    this.root.add(this.pose);
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.parts = {};
    if (kind === 'wolf') this._buildWolf(o);
    else this._buildHumanoid(o);
    this.root.scale.setScalar(o.scale || 1);
    this.phase = Math.random() * 6.283;
    this.t = Math.random() * 10;
    this.flashT = 0;
    this.deathT = -1;
  }

  _part(name, geom, x, y, z) {
    const pivot = new THREE.Object3D();
    pivot.position.set(x, y, z);
    const m = new THREE.Mesh(geom, this.material);
    m.castShadow = true; m.receiveShadow = true;
    pivot.add(m);
    this.pose.add(pivot);
    this.parts[name] = pivot;
    return pivot;
  }

  /* ═══════════ человекоподобные ═══════════ */
  _buildHumanoid(o) {
    const c = o.colors;
    const legParts = () => [
      place(box(0.21, 0.86, 0.23, c.pants), 0, -0.43, 0),
      place(box(0.25, 0.17, 0.35, c.boots), 0, -0.865, 0.05),
      place(box(0.235, 0.1, 0.25, c.belt), 0, -0.06, 0),
    ];
    this._part('legL', merge(legParts()), -0.145, HIP, 0);
    this._part('legR', merge(legParts()), 0.145, HIP, 0);

    const bp = [
      place(box(0.52, 0.66, 0.30, c.tunic), 0, 0.33, 0),
      place(box(0.565, 0.13, 0.345, c.belt), 0, 0.07, 0),
      place(box(0.68, 0.18, 0.33, c.shoulder), 0, SHOULDER, 0),
      place(box(0.27, 0.30, 0.27, c.skin), 0, 0.80, 0),          // голова
      place(box(0.29, 0.13, 0.29, c.hair), 0, 0.935, -0.01),     // волосы/шапка
      place(box(0.29, 0.09, 0.29, c.hair), 0, 0.70, -0.02),      // затылок
      place(box(0.05, 0.045, 0.02, c.eyes), -0.068, 0.825, 0.137),
      place(box(0.05, 0.045, 0.02, c.eyes), 0.068, 0.825, 0.137),
      place(box(0.075, 0.09, 0.05, c.skin), 0, 0.775, 0.14),      // нос
    ];
    if (c.cloak) bp.push(place(box(0.50, 0.80, 0.07, c.cloak), 0, 0.32, -0.20, 0.06));
    if (c.helm) {
      bp.push(place(box(0.315, 0.19, 0.315, c.helm), 0, 0.90, 0));
      bp.push(place(box(0.06, 0.14, 0.34, c.helm), 0, 1.01, -0.02)); // гребень
      bp.push(place(box(0.30, 0.06, 0.06, c.helm), 0, 0.83, 0.15));  // наносник
    }
    if (c.beard) bp.push(place(box(0.20, 0.18, 0.10, c.beard), 0, 0.70, 0.13));
    this._part('body', merge(bp), 0, HIP, 0);

    // левая рука (+щит)
    const la = [
      place(box(0.155, 0.56, 0.175, c.tunic), 0, -0.28, 0),
      place(box(0.15, 0.16, 0.16, c.skin), 0, -0.615, 0),
    ];
    if (o.shield) {
      la.push(place(box(0.46, 0.56, 0.07, c.shield), 0.02, -0.44, 0.20));
      la.push(place(cyl(0.09, 0.09, 0.09, 6, c.metal), 0.02, -0.44, 0.245, Math.PI / 2));
      la.push(place(box(0.46, 0.05, 0.09, c.metal), 0.02, -0.20, 0.20));
    }
    this._part('armL', merge(la), -0.345, HIP + SHOULDER, 0);

    // правая рука (+оружие)
    const ra = [
      place(box(0.155, 0.56, 0.175, c.tunic), 0, -0.28, 0),
      place(box(0.15, 0.16, 0.16, c.skin), 0, -0.615, 0),
    ];
    if (o.weapon !== false) {
      const w = o.weaponColors || c;
      ra.push(place(box(0.055, 0.22, 0.055, w.grip), 0, -0.70, 0.02));
      ra.push(place(box(0.27, 0.055, 0.10, w.metal), 0, -0.82, 0.02));
      ra.push(place(box(0.075, 0.62, 0.155, w.blade), 0, -1.14, 0.02));
      ra.push(place(box(0.055, 0.09, 0.10, w.metal), 0, -1.48, 0.02, 0, 0, 0));
    }
    const armR = this._part('armR', merge(ra), 0.345, HIP + SHOULDER, 0);
    // метка острия — для искр и проверки попадания
    this.tip = new THREE.Object3D();
    this.tip.position.set(0, -1.45, 0.02);
    armR.add(this.tip);

    // базовая поза
    this.parts.armR.rotation.set(S_IDLE.ax, 0, S_IDLE.az);
    this.parts.armL.rotation.set(-0.12, 0, 0.20);
    this.parts.legL.rotation.x = 0; this.parts.legR.rotation.x = 0;
  }

  /* ═══════════ волк ═══════════ */
  _buildWolf(o) {
    const c = o.colors;
    const body = merge([
      place(box(0.42, 0.44, 1.02, c.fur), 0, 0, 0),
      place(box(0.38, 0.40, 0.30, c.fur), 0, 0.02, 0.60),          // грудь/шея
      place(box(0.30, 0.30, 0.40, c.fur), 0, 0.14, 0.84),          // голова
      place(box(0.17, 0.14, 0.24, c.fur2), 0, 0.075, 1.10),        // морда
      place(box(0.045, 0.04, 0.02, c.eyes), -0.075, 0.20, 1.03),
      place(box(0.045, 0.04, 0.02, c.eyes), 0.075, 0.20, 1.03),
      place(cone(0.075, 0.20, 4, c.fur2), -0.10, 0.28, 0.76),
      place(cone(0.075, 0.20, 4, c.fur2), 0.10, 0.28, 0.76),
      place(box(0.10, 0.11, 0.52, c.fur), 0, 0.16, -0.72, -0.55),  // хвост
      place(box(0.13, 0.13, 0.20, c.fur2), 0, 0.30, -0.94, -0.9),
    ]);
    this._part('body', body, 0, 0.68, 0);
    const legParts = () => [
      place(box(0.125, 0.58, 0.125, c.fur), 0, -0.29, 0),
      place(box(0.14, 0.10, 0.22, c.fur2), 0, -0.57, 0.035),
    ];
    this._part('legFL', merge(legParts()), -0.155, 0.64, 0.34);
    this._part('legFR', merge(legParts()), 0.155, 0.64, 0.34);
    this._part('legBL', merge(legParts()), -0.155, 0.64, -0.34);
    this._part('legBR', merge(legParts()), 0.155, 0.64, -0.34);
    this.tip = this.parts.body;
  }

  flash() { this.flashT = 0.15; }

  /**
   * @param {object} st — состояние: {speed, maxSpeed, grounded, attack(-1|0..1), block, swim, strafe}
   */
  animate(st, dt) {
    this.t += dt;
    if (this.kind === 'wolf') this._animWolf(st, dt);
    else this._animHuman(st, dt);

    // вспышка урона
    if (this.flashT > 0) {
      this.flashT -= dt;
      const k = clamp(this.flashT / 0.15, 0, 1);
      this.material.emissive.setRGB(k * 0.5, k * 0.05, k * 0.05);
    } else if (this.material.emissive.r !== 0) {
      this.material.emissive.setRGB(0, 0, 0);
    }

    // смерть: падаем и распластываемся
    if (this.deathT >= 0) {
      this.deathT += dt;
      const k = ease(clamp(this.deathT / 0.8, 0, 1));
      this.pose.rotation.x = k * 1.52;
      this.pose.position.y = -k * 0.16;
      const p = this.parts;
      if (p.legL) { p.legL.rotation.x = -0.5 * k; p.legR.rotation.x = 0.35 * k; }
      if (p.armL) { p.armL.rotation.z = 0.9 * k; p.armR.rotation.z = -0.9 * k; p.armR.rotation.x = -0.3; }
      if (p.legFL) { p.legFL.rotation.x = 0.7 * k; p.legBR.rotation.x = 0.7 * k; }
      if (this.material.transparent !== true) { this.material.transparent = true; }
      this.material.opacity = 1 - clamp((this.deathT - 2.4) / 1.6, 0, 1) * 0.999;
    }
  }

  _animHuman(st, dt) {
    const p = this.parts;
    const maxS = st.maxSpeed || 5.0;
    const amp = clamp(st.speed / maxS, 0, 1.15);
    const moving = amp > 0.04 && st.grounded;
    this.phase += dt * (moving ? 4.4 + amp * 6.0 : 1.1);
    const sw = Math.sin(this.phase), sw2 = Math.sin(this.phase * 2);

    // ноги
    let legAmp = amp * 0.82;
    if (!st.grounded) {  // в воздухе — поджаты
      p.legL.rotation.x = lerp(p.legL.rotation.x, st.vy > 0.5 ? -0.75 : -0.25, dt * 12);
      p.legR.rotation.x = lerp(p.legR.rotation.x, st.vy > 0.5 ? 0.35 : 0.15, dt * 12);
      legAmp = 0;
    } else {
      p.legL.rotation.x = sw * legAmp;
      p.legR.rotation.x = -sw * legAmp;
    }
    p.legL.rotation.z = 0.03 + Math.abs(sw) * 0.02 * amp;
    p.legR.rotation.z = -0.03 - Math.abs(sw) * 0.02 * amp;

    // корпус: наклон вперёд при беге + покачивание
    const lean = amp * 0.16 + (st.block ? -0.1 : 0);
    p.body.rotation.x = lerp(p.body.rotation.x, lean + (moving ? sw2 * 0.025 * amp : Math.sin(this.t * 1.7) * 0.02), dt * 9);
    p.body.position.y = HIP + (moving ? Math.abs(sw) * 0.055 * amp : Math.sin(this.t * 1.7) * 0.012) - (st.block ? 0.07 : 0);

    // руки по умолчанию
    let lax = -0.12 - sw * 0.6 * amp, laz = 0.20;
    let rax = S_IDLE.ax + sw * 0.55 * amp, raz = S_IDLE.az;
    let bodyYaw = 0;

    // блок: щит вперёд, корпус вполоборота
    if (st.block) {
      lax = -1.42; laz = 0.62;
      bodyYaw = -0.34;
      rax = -0.55; raz = -0.3;
    }
    // плавание
    if (st.swim) {
      const ph = this.t * 4.2;
      lax = -2.2 + Math.sin(ph) * 0.9; rax = -2.2 + Math.sin(ph + Math.PI) * 0.9;
      laz = 0.5; raz = -0.5;
      p.legL.rotation.x = Math.sin(ph) * 0.5; p.legR.rotation.x = -Math.sin(ph) * 0.5;
      p.body.rotation.x = 0.55;
    }

    // удар поверх всего
    if (st.attack >= 0) {
      const at = st.attack;
      let ax, az, ty;
      if (at < 0.26) {
        const k = ease(seg(at, 0, 0.26));
        ax = lerp(S_IDLE.ax, S_WIND.ax, k); az = lerp(S_IDLE.az, S_WIND.az, k); ty = lerp(0, S_WIND.ty, k);
      } else if (at < 0.58) {
        const k = easeOut(seg(at, 0.26, 0.58));
        ax = lerp(S_WIND.ax, S_END.ax, k); az = lerp(S_WIND.az, S_END.az, k); ty = lerp(S_WIND.ty, S_END.ty, k);
      } else {
        const k = ease(seg(at, 0.58, 1));
        ax = lerp(S_END.ax, S_IDLE.ax, k); az = lerp(S_END.az, S_IDLE.az, k); ty = lerp(S_END.ty, 0, k);
      }
      rax = ax; raz = az; bodyYaw = ty;
      p.body.rotation.x = lean * 0.5 + 0.12 * Math.sin(Math.min(1, at * 2) * Math.PI);
    }

    p.armL.rotation.x = lerp(p.armL.rotation.x, lax, dt * 16);
    p.armL.rotation.z = lerp(p.armL.rotation.z, laz, dt * 16);
    p.armR.rotation.x = lerp(p.armR.rotation.x, rax, st.attack >= 0 ? dt * 30 : dt * 12);
    p.armR.rotation.z = lerp(p.armR.rotation.z, raz, st.attack >= 0 ? dt * 30 : dt * 12);
    p.body.rotation.y = lerp(p.body.rotation.y, bodyYaw + (st.strafe || 0) * 0.12, dt * 14);
  }

  _animWolf(st, dt) {
    const p = this.parts;
    const amp = clamp(st.speed / (st.maxSpeed || 5.5), 0, 1.2);
    const moving = amp > 0.04 && st.grounded;
    this.phase += dt * (moving ? 6.0 + amp * 9.0 : 1.4);
    const sw = Math.sin(this.phase);
    const a = amp * 0.85;
    if (st.grounded) {
      // диагональный галоп: ПП+ЗЛ и ЛП+ЗР
      p.legFR.rotation.x = sw * a; p.legBL.rotation.x = sw * a;
      p.legFL.rotation.x = -sw * a; p.legBR.rotation.x = -sw * a;
    } else {
      p.legFR.rotation.x = -0.7; p.legFL.rotation.x = -0.7;
      p.legBR.rotation.x = 0.6; p.legBL.rotation.x = 0.6;
    }
    p.body.position.y = 0.68 + (moving ? Math.abs(sw) * 0.05 * amp : Math.sin(this.t * 2.1) * 0.012);
    p.body.rotation.x = amp * 0.1 + (moving ? sw * 0.03 * amp : 0) + (st.attack >= 0 ? -0.35 * Math.sin(st.attack * Math.PI) : 0);
    p.body.rotation.z = moving ? sw * 0.05 * amp : 0;
    if (st.attack >= 0) {
      const k = Math.sin(st.attack * Math.PI);
      p.body.rotation.x = -0.5 * k;
      p.legFL.rotation.x = -0.9 * k; p.legFR.rotation.x = -0.9 * k;
    }
  }

  get visible() { return this.root.visible; }
  set visible(v) { this.root.visible = v; }
}

/* ── палитры ── */
export const SKINS = {
  nord: {
    skin: 0xd8a882, tunic: 0x53616e, shoulder: 0x6d7a86, belt: 0x4a3a26,
    pants: 0x4a4238, boots: 0x3a2f24, hair: 0x6b4a2a, cloak: 0x4a3a2c, eyes: 0x2a3a44,
    metal: 0x9aa2a8, blade: 0xc4ccd2, grip: 0x3a2a1c, shield: 0x6b5a3a, beard: 0x6b4a2a,
  },
  draugr: {
    skin: 0x8fa79a, tunic: 0x3f4a44, shoulder: 0x57625b, belt: 0x2e2a22,
    pants: 0x3a3f38, boots: 0x2a2620, hair: 0x2c332c, cloak: 0x33403a, eyes: 0x9fe8ff,
    metal: 0x7a6a4a, blade: 0x8e7f5f, grip: 0x2a2218, shield: 0x4a4a3a, beard: 0x0,
  },
  draugrWarrior: {
    skin: 0x9fb4a8, tunic: 0x4a4438, shoulder: 0x6b6252, belt: 0x332c22,
    pants: 0x413c33, boots: 0x2c2820, hair: 0x2f3a33, cloak: 0x3d4a44, eyes: 0xa8f0ff,
    metal: 0x8a7a55, blade: 0xa89878, grip: 0x2a2218, shield: 0x55503f,
    helm: 0x6f6a58, beard: 0x0,
  },
  villager: {
    skin: 0xd6a97f, tunic: 0x6b5a44, shoulder: 0x7a6a52, belt: 0x3f3222,
    pants: 0x514636, boots: 0x3a2f24, hair: 0x8a8378, cloak: 0x5a4a3a, eyes: 0x2f3a44,
    metal: 0x9aa2a8, blade: 0xc4ccd2, grip: 0x3a2a1c, beard: 0x9a9388,
  },
};

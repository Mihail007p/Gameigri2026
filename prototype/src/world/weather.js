// Погода: состояние (ясно / пасмурно / туман / снег / метель) + снег на GPU.
//
// Важно для Mali-G52: снег — это ОДИН draw call (THREE.Points) и НОЛЬ работы CPU
// на кадр, кроме обновления шести униформ. Позиции снежинок считаются в
// вершинном шейдере в мировых координатах вокруг камеры, поэтому они не «плывут»
// вместе с игроком и не требуют перезаписи буфера каждый кадр.
import * as THREE from 'three';
import { WEATHER, WEATHER_FADE, PRECIP_MAX } from '../config.js';
import { lerp, rng, clamp } from '../utils/noise.js';

const BOX_HALF = 19;        // метры: снег виден в коробке 38×38 вокруг игрока
const BOX_H = 26;           // метры по высоте
const WHITEOUT = 0xdfe7ee;  // цвет молочной пелены

export class Weather {
  constructor(scene, seed = 91) {
    this.scene = scene;
    this.rnd = rng(seed);
    this.cur = WEATHER.clear;
    this.prev = WEATHER.clear;
    this.mix = 1;                       // 0 → только что сменилась, 1 → полностью вошла в силу
    this.timer = 70;                    // секунд до следующей смены
    this.t = 0;
    this.windDir = this.rnd() * Math.PI * 2;
    this.changes = 0;
    /** вызывается при смене погоды: main.js показывает тост */
    this.onStateChange = null;

    /** смешанные множители — их читают sky.js, player.js, enemies.js */
    this.v = {
      fogMul: 1, sunMul: 1, hemiMul: 1, starMul: 1, whiteout: 0,
      threat: 0, snowAmt: 0, wind: 0, speedMul: 1,
    };

    this._buildSnow(scene);
  }

  /* ───────── снежинки ───────── */
  _buildSnow(scene) {
    const n = PRECIP_MAX;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const size = new Float32Array(n);
    const r = this.rnd;
    for (let i = 0; i < n; i++) {
      pos[i * 3] = r() * BOX_HALF * 2;       // x в [0, 38)
      pos[i * 3 + 1] = r() * BOX_H;          // y в [0, 26)
      pos[i * 3 + 2] = r() * BOX_HALF * 2;   // z в [0, 38)
      seed[i] = r();
      size[i] = 1.5 + r() * 2.4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);  // не отсекать камерой

    this.uniforms = {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uFall: { value: 2.2 },
      uWindX: { value: 0 },
      uWindZ: { value: 0 },
      uHalf: { value: BOX_HALF },
      uHeight: { value: BOX_H },
      uOpacity: { value: 0 },
      uScale: { value: 1 },
      uColor: { value: new THREE.Color(0xffffff) },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true, depthWrite: false, fog: false,
      vertexShader: /* glsl */`
        attribute float aSeed;
        attribute float aSize;
        uniform vec3 uCam;
        uniform float uTime, uFall, uWindX, uWindZ, uHalf, uHeight, uOpacity, uScale;
        varying float vAlpha;
        void main() {
          float span = uHalf * 2.0;
          float drift = uTime * (0.6 + aSeed * 0.8);
          vec3 w;
          w.x = uCam.x - uHalf + mod(position.x + uWindX * drift, span);
          w.z = uCam.z - uHalf + mod(position.z + uWindZ * drift, span);
          w.y = uCam.y - 5.0 + mod(position.y - uTime * uFall * (0.55 + aSeed * 0.9), uHeight);
          // лёгкое покачивание, чтобы снег не падал «по линейке»
          w.x += sin(uTime * 0.9 + aSeed * 6.2831) * 0.85;
          w.z += cos(uTime * 0.7 + aSeed * 5.11) * 0.65;

          vec4 mv = modelViewMatrix * vec4(w, 1.0);
          float d = max(0.35, -mv.z);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * uScale * (120.0 / d), 1.0, 26.0);
          vAlpha = uOpacity * (0.45 + 0.55 * aSeed)
                 * smoothstep(0.4, 3.0, d)
                 * (1.0 - smoothstep(uHalf * 1.1, uHalf * 1.8, d));
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d2 = dot(c, c);
          if (d2 > 0.25) discard;                    // круглая снежинка из квадрата
          float a = clamp(vAlpha * (1.0 - d2 * 3.4), 0.0, 1.0);
          if (a < 0.008) discard;
          gl_FragColor = vec4(uColor, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });

    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.visible = false;
    scene.add(this.points);
    this.geo = g;
  }

  /* ───────── смена погоды ───────── */
  /** Взвешенный выбор следующей погоды (ту же самую не повторяем) */
  _pick() {
    const keys = Object.keys(WEATHER).filter(k => k !== this.cur.id);
    let total = 0;
    for (const k of keys) total += WEATHER[k].weight;
    let x = this.rnd() * total;
    for (const k of keys) {
      x -= WEATHER[k].weight;
      if (x <= 0) return WEATHER[k];
    }
    return WEATHER.clear;
  }

  _change(force) {
    const next = force && WEATHER[force] ? WEATHER[force] : this._pick();
    if (next.id === this.cur.id) return false;
    this.prev = this.cur;
    this.cur = next;
    this.mix = 0;
    this.timer = lerp(next.minSec, next.maxSec, this.rnd());
    this.windDir = this.rnd() * Math.PI * 2;
    this.changes++;
    this.onStateChange?.(next);
    return true;
  }

  /** Принудительно включить погоду (для тестов и отладки) */
  set(id) { return this._change(id); }

  reset() {
    this.cur = WEATHER.clear; this.prev = WEATHER.clear;
    this.mix = 1; this.timer = 70; this.changes = 0;
    this._blend();
  }

  /* ───────── кадр ───────── */
  update(dt, camPos, quality) {
    this.t += dt;
    this.timer -= dt;
    if (this.timer <= 0) this._change();
    this.mix = clamp(this.mix + dt / WEATHER_FADE, 0, 1);
    this._blend();

    const v = this.v;
    const u = this.uniforms;
    u.uTime.value = this.t;
    u.uCam.value.copy(camPos);
    // в метель снег летит почти горизонтально и быстрее
    u.uFall.value = lerp(1.9, 5.4, v.wind);
    const w = lerp(0.5, 7.5, v.wind * v.wind);
    u.uWindX.value = Math.sin(this.windDir) * w;
    u.uWindZ.value = Math.cos(this.windDir) * w;
    u.uOpacity.value = v.snowAmt * lerp(0.55, 0.95, v.wind);
    const dpr = clamp(typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1, 0.7, 2);
    u.uScale.value = dpr * lerp(0.8, 1.25, v.wind);
    // в метель снежинки чуть теплее/тусклее — пелена съедает контраст
    u.uColor.value.setHex(0xffffff).lerp(new THREE.Color(WHITEOUT), v.whiteout * 0.6);

    // сколько снежинок реально рисуем: погода × пресет качества
    const precip = quality?.precip ?? 0.75;
    const count = Math.round(PRECIP_MAX * v.snowAmt * precip);
    this.snowCount = count;
    this.geo.setDrawRange(0, count);
    this.points.visible = count > 0;
  }

  /** Смешать предыдущую и текущую погоду в this.v */
  _blend() {
    const k = this.mix, a = this.prev, b = this.cur, v = this.v;
    v.fogMul = lerp(a.fogMul, b.fogMul, k);
    v.sunMul = lerp(a.sunMul, b.sunMul, k);
    v.hemiMul = lerp(a.hemiMul, b.hemiMul, k);
    v.starMul = lerp(a.starMul, b.starMul, k);
    v.whiteout = lerp(a.whiteout, b.whiteout, k);
    v.threat = lerp(a.threat, b.threat, k);
    v.snowAmt = lerp(a.snow, b.snow, k);
    v.wind = lerp(a.wind, b.wind, k);
    v.speedMul = lerp(a.speedMul, b.speedMul, k);
  }

  get name() { return this.cur.name; }
  get icon() { return this.cur.icon; }
  get id() { return this.cur.id; }
  /** Текст для тоста при смене погоды */
  get announce() {
    switch (this.cur.id) {
      case 'blizzard': return 'Метель! Почти ничего не видно — и твари смелеют';
      case 'snow': return 'Пошёл снег';
      case 'fog': return 'Туман стелется по земле';
      case 'overcast': return 'Небо затянуло облаками';
      default: return 'Небо проясняется';
    }
  }

  serialize() { return { id: this.cur.id, timer: Math.round(this.timer) }; }

  restore(s) {
    if (!s) return;
    const w = WEATHER[s.id];
    if (!w) return;
    this.cur = w; this.prev = w; this.mix = 1;
    this.timer = Number.isFinite(s.timer) ? clamp(s.timer, 15, 300) : lerp(w.minSec, w.maxSec, this.rnd());
    this._blend();
  }
}

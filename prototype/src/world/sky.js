// Небо, солнце/луна, звёзды, свет, туман и дальние горы.
// Всё это связано одним параметром — временем суток, поэтому живёт в одном модуле.
import * as THREE from 'three';
import { WORLD } from '../config.js';
import { clamp, lerp, smoothstep, rng } from '../utils/noise.js';

/** Ключевые кадры атмосферы: [час, зенит, горизонт, цвет солнца, яркость солнца, яркость неба, цвет тумана] */
const KEYS = [
  [0.0, 0x050a18, 0x0c1424, 0x7ea6d8, 0.16, 0.20, 0x0c1424],
  [4.6, 0x0a1226, 0x1b2740, 0x8fb2dd, 0.22, 0.26, 0x1b2740],
  [6.2, 0x22406e, 0xb9744a, 0xffb469, 1.15, 0.46, 0x9d7a63],
  [7.6, 0x2f5f9c, 0xd9a373, 0xffd7a1, 2.05, 0.66, 0xbfa287],
  [10.5, 0x2f6fc4, 0xb6cfe2, 0xfff4e0, 2.75, 0.86, 0xa9c0d2],
  [13.5, 0x2b69bd, 0xc3d9e8, 0xfffaf0, 2.95, 0.92, 0xb6cbd9],
  [16.5, 0x356ba8, 0xd7c3a4, 0xffe3b4, 2.35, 0.76, 0xc3b6a1],
  [18.6, 0x2b3f6e, 0xe07a3c, 0xff8b3d, 1.45, 0.48, 0xa86a45],
  [20.0, 0x141f3a, 0x4b3f5c, 0x93a6d4, 0.34, 0.26, 0x3a3a52],
  [21.6, 0x070c1c, 0x131c2e, 0x7ea6d8, 0.18, 0.21, 0x131c2e],
  [24.0, 0x050a18, 0x0c1424, 0x7ea6d8, 0.16, 0.20, 0x0c1424],
];

const _c = (hex) => new THREE.Color(hex);
const WHITE = new THREE.Color(0xffffff);
const _keys = KEYS.map(k => ({
  h: k[0], zen: _c(k[1]), hor: _c(k[2]), sun: _c(k[3]),
  sunI: k[4], hemiI: k[5], fog: _c(k[6]),
}));

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.hour = 7.2;
    this.night = 0;          // 0 = день, 1 = глубокая ночь
    this.sunDir = new THREE.Vector3(0.3, 1, 0.2);

    this.zen = new THREE.Color(); this.hor = new THREE.Color();
    this.sunColor = new THREE.Color(); this.fogColor = new THREE.Color();

    /* ── купол неба (шейдер: градиент + диск солнца/луны + ореол) ── */
    this.uniforms = {
      uZenith: { value: new THREE.Color(0x2f6fc4) },
      uHorizon: { value: new THREE.Color(0xb6cfe2) },
      uGround: { value: new THREE.Color(0x2a2f33) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(0xfff4e0) },
      uNight: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      // transparent:true → купол рисуется ПОСЛЕ непрозрачной геометрии и только
      // в тех пикселях, где её нет. На Mali-G52 это экономит ~40% fillrate неба.
      side: THREE.BackSide, depthWrite: false, depthTest: true,
      transparent: true, fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main(){
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vDir;
        uniform vec3 uZenith, uHorizon, uGround, uSunColor, uSunDir;
        uniform float uNight;
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.52));
          col = mix(col, uGround, smoothstep(0.0, -0.22, h));
          vec3 sd = normalize(uSunDir);
          float s = max(dot(d, sd), 0.0);
          col += uSunColor * pow(s, 320.0) * 4.0;        // диск солнца
          col += uSunColor * pow(s, 7.0) * 0.34;         // ореол + дымка
          float m = max(dot(d, -sd), 0.0);                // луна — напротив
          col += vec3(0.82, 0.87, 1.0) * pow(m, 1800.0) * 3.0 * uNight;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(900, 18, 12), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    scene.add(this.dome);

    /* ── звёзды ── */
    const N = 420, r = rng(7);
    const sp = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      sp[i * 3] = Math.cos(a) * s * 850;
      sp[i * 3 + 1] = Math.abs(u) * 850 * 0.9 + 30;
      sp[i * 3 + 2] = Math.sin(a) * s * 850;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xdfe8ff, size: 2.4, sizeAttenuation: false,
      transparent: true, opacity: 0, depthWrite: false, fog: false,
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -999;
    scene.add(this.stars);

    /* ── свет ── */
    this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
    this.sun.castShadow = false;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 220;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.55;
    scene.add(this.sun); scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xb6cfe2, 0x3a3630, 0.85);
    scene.add(this.hemi);

    /* ── туман: скрывает границу подгрузки чанков ── */
    this.fog = new THREE.Fog(0xb6cfe2, 30, 120);
    scene.fog = this.fog;

    /* ── дальние горы: два слоя силуэтов за туманом (псевдо-перспектива) ── */
    this.mountains = this._buildMountains(scene);
  }

  _buildMountains(scene) {
    const cone = new THREE.ConeGeometry(1, 1, 5, 1);
    cone.translate(0, 0.5, 0);
    const layers = [];
    const conf = [
      { count: 26, rMin: 330, rMax: 400, hMin: 70, hMax: 165, wMin: 60, wMax: 130, color: 0x4c5560, fogMix: 0.42 },
      { count: 22, rMin: 470, rMax: 620, hMin: 110, hMax: 250, wMin: 90, wMax: 200, color: 0x5b6673, fogMix: 0.66 },
    ];
    for (const cfg of conf) {
      const mat = new THREE.MeshLambertMaterial({ color: cfg.color, flatShading: true, fog: false });
      const im = new THREE.InstancedMesh(cone, mat, cfg.count);
      im.frustumCulled = false;
      im.castShadow = false; im.receiveShadow = false;
      const d = new THREE.Object3D(), r = rng(cfg.count * 31 + 7);
      for (let i = 0; i < cfg.count; i++) {
        const a = (i / cfg.count) * Math.PI * 2 + r() * 0.22;
        const rad = lerp(cfg.rMin, cfg.rMax, r());
        d.position.set(Math.cos(a) * rad, -14, Math.sin(a) * rad);
        d.rotation.y = r() * Math.PI;
        d.scale.set(lerp(cfg.wMin, cfg.wMax, r()), lerp(cfg.hMin, cfg.hMax, r()), lerp(cfg.wMin, cfg.wMax, r()) * (0.7 + r() * 0.5));
        d.updateMatrix();
        im.setMatrixAt(i, d.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
      scene.add(im);
      layers.push({ mesh: im, mat, base: new THREE.Color(cfg.color), fogMix: cfg.fogMix });
    }
    return layers;
  }

  /** Обновление по времени суток. camPos — чтобы небо и тени следовали за игроком. */
  update(hour, camPos, quality) {
    this.hour = hour;
    // интерполяция ключевых кадров
    let a = _keys[0], b = _keys[_keys.length - 1];
    for (let i = 0; i < _keys.length - 1; i++) {
      if (hour >= _keys[i].h && hour <= _keys[i + 1].h) { a = _keys[i]; b = _keys[i + 1]; break; }
    }
    const t = smoothstep(a.h, b.h, hour);
    this.zen.copy(a.zen).lerp(b.zen, t);
    this.hor.copy(a.hor).lerp(b.hor, t);
    this.sunColor.copy(a.sun).lerp(b.sun, t);
    this.fogColor.copy(a.fog).lerp(b.fog, t);
    const sunI = lerp(a.sunI, b.sunI, t);
    const hemiI = lerp(a.hemiI, b.hemiI, t);

    // положение солнца: фаза = 0 в 6:00 (восход на востоке), π в 18:00 (закат на западе)
    const phase = ((hour - 6) / 12) * Math.PI;
    const elev = Math.sin(phase);
    this.sunDir.set(Math.cos(phase) * 0.86, elev, 0.34).normalize();
    this.night = clamp(smoothstep(0.14, -0.16, elev), 0, 1);

    const u = this.uniforms;
    u.uZenith.value.copy(this.zen);
    u.uHorizon.value.copy(this.hor);
    u.uSunColor.value.copy(this.sunColor);
    u.uSunDir.value.copy(this.sunDir);
    u.uNight.value = this.night;
    u.uGround.value.copy(this.hor).multiplyScalar(0.28);

    this.sun.color.copy(this.sunColor);
    this.sun.intensity = sunI * (this.sunDir.y > 0 ? 1 : 0.05);
    this.hemi.color.copy(this.zen).lerp(WHITE, 0.15);
    this.hemi.groundColor.setHex(0x3a3630);
    this.hemi.intensity = hemiI;

    // туман и дальность
    const far = quality.fogFar;
    this.fog.color.copy(this.fogColor);
    this.fog.near = far * 0.28;
    this.fog.far = far;

    // небо и звёзды едут вместе с камерой
    this.dome.position.copy(camPos);
    this.stars.position.copy(camPos);
    this.stars.rotation.y = hour * 0.06;
    this.starMat.opacity = this.night * (quality.stars ? 0.95 : 0);
    this.stars.visible = quality.stars && this.night > 0.02;

    // горы: красим в смесь своего цвета и тумана (дешёвая атмосферная перспектива)
    for (const L of this.mountains) {
      L.mat.color.copy(L.base).lerp(this.fogColor, L.fogMix * (0.55 + 0.45 * (1 - this.night)));
    }

    // солнце/тени следуют за игроком — орто-фрустум теней остаётся тесным и резким
    if (camPos) {
      this.sun.position.copy(camPos).addScaledVector(this.sunDir, 110);
      this.sun.target.position.copy(camPos);
      this.sun.target.updateMatrixWorld();
    }

    // тени имеет смысл считать, только когда солнце над горизонтом
    const wantShadow = quality.shadows && this.sunDir.y > 0.02;
    if (this.sun.castShadow !== wantShadow) {
      this.sun.castShadow = wantShadow;
      this.sun.shadow.needsUpdate = true;
    }
    if (wantShadow && this.sun.shadow.mapSize.width !== quality.shadowSize) {
      this.sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
  }

  /** Освещённость сцены 0..1 — для подсветки окон и включения факелов */
  get lightLevel() { return clamp(this.sunDir.y * 1.6 + 0.12, 0, 1); }
}

/* Точный рендер рига игрока «из движка»: софтварный z-буфер без браузера.
   Пишет docs/art/knight_ingame_preview.png (3 ракурса), чтобы сверять
   внешность с референсом docs/art/knight_reference.png без телефона.
   Запуск: node tools/knight_preview.mjs [путь_к_png] */
import * as THREE from 'three';
import { Rig, SKINS } from '../prototype/src/entities/humanoid.js';
import zlib from 'node:zlib';
import fs from 'node:fs';

const OUT = process.argv[2] || 'docs/art/knight_ingame_preview.png';
const VIEWS = [0, Math.PI * 0.22, Math.PI]; // фас, ¾, спина
const W = 470, H = 640, PAD = 10;
const IW = W * VIEWS.length + PAD * (VIEWS.length + 1), IH = H + PAD * 2;

const rig = new Rig('knight', { colors: SKINS.knight, shield: true, scale: 1 });
rig.root.updateMatrixWorld(true);

/* собираем мировые треугольники с цветом */
const tris = [];
for (const key of Object.keys(rig.parts)) {
  const mesh = rig.parts[key].children[0];
  const g = mesh.geometry;
  const pos = g.attributes.position, col = g.attributes.color;
  const n = g.index ? g.index.count : pos.count;
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    const t = { p: [], c: [] };
    for (let k = 0; k < 3; k++) {
      const idx = g.index ? g.index.getX(i + k) : i + k;
      v.fromBufferAttribute(pos, idx).applyMatrix4(mesh.matrixWorld);
      t.p.push([v.x, v.y, v.z]);
      t.c.push([col.getX(idx), col.getY(idx), col.getZ(idx)]);
    }
    tris.push(t);
  }
}

/* sRGB-кодирование: вершинные цвета three хранит в linear, как и GPU */
const enc = (c) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));

/* z-буфер растеризатор */
function render(yaw) {
  const buf = new Uint8Array(W * H * 3).fill(245);
  const zbuf = new Float32Array(W * H).fill(-1e9);
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  const list = [];
  for (const t of tris) {
    const q = t.p.map(([x, y, z]) => [x * ca + z * sa, y, -x * sa + z * ca]);
    // нормаль
    const [a, b, c] = q;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    if (nz <= 0.02) continue; // отсечение задних граней (камера смотрит с +Z)
    const L = [0.45, 0.62, 0.65];
    const shade = 0.42 + 0.58 * Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
    const cr = ((t.c[0][0] + t.c[1][0] + t.c[2][0]) / 3) * shade;
    const cg = ((t.c[0][1] + t.c[1][1] + t.c[2][1]) / 3) * shade;
    const cb = ((t.c[0][2] + t.c[1][2] + t.c[2][2]) / 3) * shade;
    list.push({ q, z: (q[0][2] + q[1][2] + q[2][2]) / 3, cr, cg, cb });
  }
  const S = H * 0.42 / 1.15;           // пикселей на метр
  const cx = W / 2, cy = H * 0.52;
  for (const t of list) {
    const P = t.q.map(([x, y, z]) => [cx - x * S, cy - (y - 1.0) * S, z]);
    const minX = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0])));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
    const edge = (ax, ay, bx, by, px, py) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    const area = edge(P[0][0], P[0][1], P[1][0], P[1][1], P[2][0], P[2][1]);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      let w0 = edge(P[1][0], P[1][1], P[2][0], P[2][1], px, py);
      let w1 = edge(P[2][0], P[2][1], P[0][0], P[0][1], px, py);
      let w2 = edge(P[0][0], P[0][1], P[1][0], P[1][1], px, py);
      if (area < 0) { w0 = -w0; w1 = -w1; w2 = -w2; }
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const aa = Math.abs(area); w0 /= aa; w1 /= aa; w2 /= aa;
      const z = w0 * P[0][2] + w1 * P[1][2] + w2 * P[2][2];
      const oi = y * W + x;
      if (z > zbuf[oi]) {
        zbuf[oi] = z;
        buf[oi * 3] = enc(t.cr); buf[oi * 3 + 1] = enc(t.cg); buf[oi * 3 + 2] = enc(t.cb);
      }
    }
  }
  return buf;
}

/* склейка views → PNG (чистый node: zlib + crc32) */
const frames = VIEWS.map(render);
if (process.env.PROBE) {
  const S = H * 0.42 / 1.15, cx = W / 2, cy = H * 0.52;
  const py = (wy) => Math.round(cy - (wy - 1.0) * S);
  const at = (f, x, y) => { const i = (y * W + x) * 3; return [f[i], f[i + 1], f[i + 2]]; };
  for (let vi = 0; vi < frames.length; vi++) {
    const f = frames[vi];
    console.log(`view ${vi} yaw ${VIEWS[vi].toFixed(2)}: грудь центр`, at(f, cx | 0, py(1.28)),
      'лицо шлема', at(f, cx | 0, py(1.78)), 'щит', at(f, (cx - 0.45 * S) | 0, py(1.0)));
  }
}
const raw = Buffer.alloc(IW * IH * 3 + IH);
for (let y = 0; y < IH; y++) {
  raw[y * (IW * 3 + 1)] = 0; // фильтр none
  for (let x = 0; x < IW; x++) {
    const vi = Math.floor((x - PAD) / (W + PAD));
    const lx = x - PAD - vi * (W + PAD);
    const o = y * (IW * 3 + 1) + 1 + x * 3;
    if (vi >= 0 && vi < frames.length && lx >= 0 && lx < W && y >= PAD && y < PAD + H) {
      const s = frames[vi];
      const si = ((y - PAD) * W + lx) * 3;
      raw[o] = s[si]; raw[o + 1] = s[si + 1]; raw[o + 2] = s[si + 2];
    } else { raw[o] = 255; raw[o + 1] = 255; raw[o + 2] = 255; }
  }
}
const T = (n) => Buffer.from([n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255]);
let CRC_T = null;
const crc32 = (b) => {
  if (!CRC_T) { CRC_T = new Int32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_T[i] = c; } }
  let c = -1; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = T(data.length), td = Buffer.concat([Buffer.from(type), data]);
  return Buffer.concat([len, td, T(crc32(td))]);
};
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', Buffer.concat([T(IW), T(IH), Buffer.from([8, 2, 0, 0, 0])])),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.mkdirSync(OUT.split('/').slice(0, -1).join('/') || '.', { recursive: true });
fs.writeFileSync(OUT, png);
console.log(`рендер рыцаря: ${OUT}, ${IW}x${IH}, треугольников ${tris.length}`);

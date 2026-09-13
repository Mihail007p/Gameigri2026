// Детерминированный шум и ГСЧ. Никаких зависимостей и ассетов:
// весь мир генерируется математикой, поэтому весит 0 байт и одинаков на всех устройствах.

const imul = Math.imul;

function hash2(ix, iy, seed) {
  let h = imul(ix | 0, 374761393) ^ imul(iy | 0, 668265263) ^ imul(seed | 0, 1274126177);
  h = imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Value noise 2D, результат 0..1 */
export function noise2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

/** Фрактальный шум (сумма октав), 0..1 */
export function fbm(x, y, octaves = 4, seed = 0, gain = 0.5, lac = 2.0) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    amp *= gain; freq *= lac;
  }
  return sum / norm;
}

/** «Гребенчатый» шум: даёт острые горные хребты, 0..1 */
export function ridged(x, y, octaves = 3, seed = 0) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2(x * freq, y * freq, seed + i * 733) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5; freq *= 2.1;
  }
  return sum / norm;
}

/** Быстрый ГСЧ с фиксированным зерном (mulberry32) */
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = imul(t ^ (t >>> 15), t | 1);
    t ^= t + imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Хэш-значение в ячейке сетки — для «случайных» объектов мира без хранения данных */
export function cellHash(cx, cy, seed = 0) {
  return hash2(cx, cy, seed);
}

// Замер производительности и автоподстройка качества под конкретное железо.
// На Helio G85 это главный механизм: мы не угадываем настройки, а подстраиваемся
// под реальный кадр, включая троттлинг от нагрева через 15–20 минут игры.
import { Settings } from './settings.js';
import { clamp } from '../utils/noise.js';

export class PerfMonitor {
  constructor() {
    this.samples = [];        // последние времена кадра, мс
    this.cpuSamples = [];     // время логики, мс
    this.fps = 0;
    this.frameMs = 0;
    this.cpuMs = 0;
    this.median = 0;
    this.worst = 0;
    this.lowFrames = 0;       // кадров дольше 50 мс
    this._shadowDropped = false;
    this.totalFrames = 0;
    this._acc = 0;
    this._evalEvery = 1.6;   // сек
    this.hudAcc = 0;
  }

  /** dtMs — полное время кадра, cpuMs — время нашей логики до рендера */
  frame(dtMs, cpuMs) {
    this.totalFrames++;
    this.samples.push(dtMs);
    this.cpuSamples.push(cpuMs);
    if (this.samples.length > 120) { this.samples.shift(); this.cpuSamples.shift(); }
    if (dtMs > 50) this.lowFrames++;
  }

  /** Вызывается каждый кадр; возвращает true, если качество изменилось */
  update(dt) {
    this._acc += dt;
    this.hudAcc += dt;
    if (this._acc < 0.25) return false;
    this._acc = 0;

    const s = this.samples;
    if (!s.length) return false;
    const sorted = s.slice().sort((a, b) => a - b);
    this.median = sorted[sorted.length >> 1];
    this.worst = sorted[sorted.length - 1];
    this.frameMs = s.reduce((a, b) => a + b, 0) / s.length;
    this.cpuMs = this.cpuSamples.reduce((a, b) => a + b, 0) / this.cpuSamples.length;
    this.fps = 1000 / Math.max(0.001, this.frameMs);

    return this.autoAdjust();
  }

  /** Собственно гувернёр. Возвращает true при изменении настроек. */
  autoAdjust() {
    if (!Settings.autoAllowed) return false;
    if (this.totalFrames < 90) return false;      // прогрев: не дёргаемся на первых кадрах

    const target = Settings.q.fpsTarget || 30;
    const goodMs = 1000 / target * 0.80;          // 26.6 мс для 30 FPS
    const badMs = 1000 / target * 1.10;           // 36.6 мс для 30 FPS
    let changed = false;

    if (this.median > badMs) {
      // тяжело: снижаем разрешение рендера
      if (Settings.autoScale > 0.62) {
        Settings.autoScale = Math.max(0.6, Settings.autoScale - 0.07);
        Settings.autoLabel = 'авто ↓';
        changed = true;
      } else if (Settings.q.shadows && !this._shadowDropped) {
        // тени — самое дорогое. Отключаем ОДИН раз за сессию: смена теней
        // заставляет three.js пересобрать шейдеры, а это фризы посреди боя.
        this._shadowDropped = true;
        Settings.q.shadows = false;
        Settings.autoLabel = 'авто (без теней)';
        changed = true;
      } else if (Settings.q.maxEnemies > 3) {
        Settings.q.maxEnemies = Math.max(3, Settings.q.maxEnemies - 2);
        Settings.autoLabel = 'авто (меньше врагов)';
        changed = true;
      }
    } else if (this.median < goodMs && this.worst < badMs * 1.35) {
      // легко: пробуем вернуть качество
      if (Settings.autoScale < 1.0) {
        Settings.autoScale = Math.min(1.0, Settings.autoScale + 0.04);
        Settings.autoLabel = 'авто ↑';
        changed = true;
      } else if (Settings.q.maxEnemies < 8) {
        Settings.q.maxEnemies = Math.min(9, Settings.q.maxEnemies + 1);
        changed = true;
      }
    }
    if (changed) {
      Settings.autoScale = clamp(Settings.autoScale, 0.6, 1.0);
      this.samples.length = 0; this.cpuSamples.length = 0; this.totalFrames = 0;
    }
    return changed;
  }

  snapshot() {
    return {
      fps: Math.round(this.fps), median: +this.median.toFixed(1),
      cpu: +this.cpuMs.toFixed(1), worst: +this.worst.toFixed(1),
      lowPct: this.totalFrames ? +((this.lowFrames / this.totalFrames) * 100).toFixed(1) : 0,
      renderScale: +Settings.renderScale.toFixed(2),
      quality: Settings.q.name + (Settings.autoAllowed ? '/' + Settings.autoLabel : ''),
      frames: this.totalFrames,
    };
  }
}

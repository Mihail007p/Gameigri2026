// Процедурный звук через WebAudio. 0 байт ассетов — важно для eMMC и размера APK.
import { Settings } from './settings.js';

class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.last = {};
  }

  /** Создаём контекст только после жеста пользователя (политика автоплея) */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // заготовка белого шума (0.4 с) — для ударов и шагов
      const len = Math.floor(this.ctx.sampleRate * 0.4);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { this.ctx = null; }
  }

  get on() { return Settings.user.sound && this.ctx && this.ctx.state === 'running'; }

  /** Тон с плавным съездом частоты */
  tone(freq, dur, { type = 'sine', gain = 0.2, to = null, delay = 0 } = {}) {
    if (!this.on) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** Шумовой всплеск через фильтр — удары, шаги */
  noise(dur, { freq = 900, q = 1, gain = 0.25, type = 'bandpass', to = null } = {}) {
    if (!this.on || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(Math.max(60, to), t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + dur + 0.02);
  }

  /** Ограничитель частоты повторов, чтобы залп из 5 ударов не оглушал */
  throttled(key, ms, fn) {
    const now = performance.now();
    if (this.last[key] && now - this.last[key] < ms) return;
    this.last[key] = now; fn();
  }

  swing()  { this.throttled('sw', 90, () => this.noise(0.16, { freq: 1500, to: 500, gain: 0.13, q: 0.7 })); }
  hit()    { this.throttled('ht', 60, () => { this.noise(0.13, { freq: 420, to: 120, gain: 0.4, q: 0.6 }); this.tone(150, 0.1, { type: 'square', gain: 0.12, to: 70 }); }); }
  crit()   { this.throttled('cr', 60, () => { this.noise(0.2, { freq: 900, to: 180, gain: 0.45 }); this.tone(520, 0.22, { type: 'triangle', gain: 0.16, to: 180 }); }); }
  block()  { this.throttled('bl', 80, () => { this.tone(300, 0.14, { type: 'square', gain: 0.16, to: 180 }); this.noise(0.09, { freq: 2600, gain: 0.16 }); }); }
  hurt()   { this.throttled('hu', 120, () => { this.tone(210, 0.28, { type: 'sawtooth', gain: 0.2, to: 80 }); this.noise(0.18, { freq: 300, gain: 0.22 }); }); }
  kill()   { this.throttled('kl', 100, () => { this.tone(120, 0.5, { type: 'sawtooth', gain: 0.2, to: 45 }); this.noise(0.35, { freq: 500, to: 90, gain: 0.3 }); }); }
  jump()   { this.tone(320, 0.1, { type: 'sine', gain: 0.1, to: 520 }); }
  land()   { this.throttled('ln', 100, () => this.noise(0.09, { freq: 220, gain: 0.16 })); }
  step()   { this.throttled('st', 220, () => this.noise(0.06, { freq: 300 + Math.random() * 220, gain: 0.06, q: 0.8 })); }
  pickup() { this.tone(660, 0.09, { type: 'triangle', gain: 0.14 }); this.tone(990, 0.12, { type: 'triangle', gain: 0.12, delay: 0.07 }); }
  level()  { [440, 554, 659, 880].forEach((f, i) => this.tone(f, 0.35, { type: 'triangle', gain: 0.16, delay: i * 0.1 })); }
  ui()     { this.tone(520, 0.05, { type: 'sine', gain: 0.08 }); }
  quest()  { [392, 523, 659].forEach((f, i) => this.tone(f, 0.4, { type: 'sine', gain: 0.13, delay: i * 0.12 })); }
  death()  { this.tone(160, 1.4, { type: 'sawtooth', gain: 0.22, to: 40 }); }
  wolf()   { this.throttled('wf', 400, () => this.tone(420, 0.35, { type: 'sawtooth', gain: 0.1, to: 260 })); }
  ambient() {
    // низкий «ветер»: редкий шумовой всплеск с медленным фильтром
    if (!this.on) return;
    this.noise(2.2, { freq: 240, gain: 0.035, q: 0.4, type: 'lowpass' });
  }
}

export const sfx = new Sfx();

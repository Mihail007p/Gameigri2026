// Пользовательские настройки + «разрешённое» качество.
// Автогувернёр (core/perf.js) может менять renderScale на лету — это Settings.autoScale.
import { QUALITY } from '../config.js';
import { clamp } from '../utils/noise.js';

const KEY = 'severny_kray_settings_v1';

export const Settings = {
  user: { quality: 'auto', sens: 1.0, invert: false, sound: true, perf: true },
  /** активный пресет (объект из QUALITY) */
  q: { ...QUALITY.medium },
  /** множитель render scale от автоподстройки, 0.7..1.25 */
  autoScale: 1.0,
  /** качество, выбранное гувернёром, только для отображения */
  autoLabel: 'авто',

  get renderScale() {
    return clamp(this.q.renderScale * this.autoScale, 0.45, 1.0);
  },

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.user, JSON.parse(raw));
    } catch (e) { /* первое включение / приватный режим */ }
    this.resolve();
    return this;
  },

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.user)); } catch (e) {}
  },

  /** Пересобрать активное качество из пользовательской настройки */
  resolve() {
    const q = this.user.quality === 'auto' ? QUALITY.medium : QUALITY[this.user.quality];
    this.q = { ...q };
    if (this.user.quality !== 'auto') this.autoScale = 1.0; // ручной выбор = без автоподстройки
    return this.q;
  },

  get autoAllowed() { return this.user.quality === 'auto'; },
};

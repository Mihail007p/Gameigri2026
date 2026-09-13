// Сохранения. В прототипе — localStorage (в APK заменим на файл/SharedPreferences).
import { GAME } from '../config.js';

export const Save = {
  has() {
    try { return !!localStorage.getItem(GAME.saveKey); } catch (e) { return false; }
  },

  write(state) {
    try {
      state.savedAt = Date.now();
      state.version = GAME.version;
      localStorage.setItem(GAME.saveKey, JSON.stringify(state));
      return true;
    } catch (e) {
      console.warn('[save] не удалось сохранить', e);
      return false;
    }
  },

  read() {
    try {
      const raw = localStorage.getItem(GAME.saveKey);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },

  clear() {
    try { localStorage.removeItem(GAME.saveKey); } catch (e) {}
  },
};

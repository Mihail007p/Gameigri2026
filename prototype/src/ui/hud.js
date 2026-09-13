// HUD и все экранные панели. Только DOM — это дешевле, чем рисовать интерфейс в 3D,
// и не плодит draw calls.
import * as THREE from 'three';
import { ITEMS } from '../config.js';

const $ = (id) => document.getElementById(id);

const COMPASS = ['С', '·', 'СВ', '·', 'В', '·', 'ЮВ', '·', 'Ю', '·', 'ЮЗ', '·', 'З', '·', 'СЗ', '·'];
const STEP = 40;                       // px на метку
const COPY = COMPASS.length * STEP;    // ширина одного оборота ленты
const _v = new THREE.Vector3();        // переиспользуем: GC на телефоне дорогой

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), touch: $('touch'),
      level: $('hudLevel'), barHp: $('barHp'), barSt: $('barSt'), barXp: $('barXp'), txtHp: $('txtHp'),
      qtList: $('qtList'), prompt: $('prompt'), promptText: $('promptText'), promptKey: $('promptKey'),
      toasts: $('toasts'), vignette: $('vignette'),
      perf: $('perfPanel'), p1: $('perfLine1'), p2: $('perfLine2'), p3: $('perfLine3'),
      tape: $('compassTape'),
      interact: $('btnInteract'),
      dlg: $('dialogue'), dlgName: $('dlgName'), dlgText: $('dlgText'), dlgOpts: $('dlgOptions'),
      inv: $('inventory'), invGold: $('invGold'), invLevel: $('invLevel'), invDmg: $('invDmg'),
      invKills: $('invKills'), invList: $('invList'),
      loading: $('loading'), loadBar: $('loadBar'), loadText: $('loadText'),
      death: $('death'), pause: $('pause'), pauseStats: $('pauseStats'),
    };

    // лента компаса: три копии, чтобы бесконечно крутилась
    let html = '';
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < COMPASS.length; i++) {
        const cardinal = i % 4 === 0;
        html += `<span class="${cardinal ? 'card' : ''}">${COMPASS[i]}</span>`;
      }
    }
    this.el.tape.innerHTML = html;

    // слой всплывающих цифр урона
    this.dmgLayer = document.createElement('div');
    this.dmgLayer.id = 'dmgLayer';
    this.dmgLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    this.el.hud.appendChild(this.dmgLayer);
    this.dmgPool = [];

    this._vigT = 0;
    this._toastN = 0;
  }

  /* ───────── экраны ───────── */
  screens() { return ['title', 'settings', 'pause', 'dialogue', 'inventory', 'death', 'loading']; }
  show(name) { for (const s of this.screens()) $(s)?.classList.toggle('hidden', s !== name); }
  hideAll() { for (const s of this.screens()) $(s)?.classList.add('hidden'); }
  isOpen() { return this.screens().some(s => s !== 'loading' && !$(s)?.classList.contains('hidden')); }

  setGameVisible(on) {
    this.el.hud.classList.toggle('hidden', !on);
    this.el.touch.classList.toggle('hidden', !on);
  }

  /* ───────── загрузка ───────── */
  loading(p, text) {
    this.el.loadBar.style.width = Math.round(p * 100) + '%';
    if (text) this.el.loadText.textContent = text;
  }

  /* ───────── витальные показатели ───────── */
  vitals(p, xpNeed) {
    this.el.barHp.style.transform = `scaleX(${Math.max(0, p.hp / p.hpMax)})`;
    this.el.barSt.style.transform = `scaleX(${Math.max(0, p.st / p.stMax)})`;
    this.el.barXp.style.transform = `scaleX(${Math.max(0, Math.min(1, p.xp / (xpNeed || 1)))})`;
    this.el.txtHp.textContent = `${Math.ceil(p.hp)}/${p.hpMax}`;
    this.el.level.textContent = p.level;
  }

  /* ───────── компас ───────── */
  compass(camYaw) {
    const deg = (((-camYaw * 180) / Math.PI) % 360 + 360) % 360;
    const w = this.el.tape.parentElement.clientWidth || 300;
    this.el.tape.style.transform = `translateX(${w / 2 - (deg / 360) * COPY - COPY}px)`;
  }

  /* ───────── квесты ───────── */
  quests(list) {
    const html = list
      .map(q => `<div class="${q.done ? 'done' : ''}">${q.title ? `<b>${q.title}</b><br>` : ''}${q.text}</div>`)
      .join('');
    if (html === this._qCache) return;   // не дёргаем DOM каждый кадр
    this._qCache = html;
    this.el.qtList.innerHTML = html;
  }

  /* ───────── подсказка действия ───────── */
  prompt(text, key = '✋') {
    if (text === this._pCache) return;
    this._pCache = text;
    if (!text) { this.el.prompt.classList.add('hidden'); this.el.interact.style.opacity = '0.35'; return; }
    this.el.prompt.classList.remove('hidden');
    this.el.promptText.textContent = text;
    this.el.promptKey.textContent = key;
    this.el.interact.style.opacity = '1';
  }

  /* ───────── всплывающие сообщения ───────── */
  toast(text, kind = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = text;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.remove(), 2700);
    if (++this._toastN > 4) { this.el.toasts.firstChild?.remove(); }
  }

  vignette() {
    this.el.vignette.classList.add('hit');
    clearTimeout(this._vigT);
    this._vigT = setTimeout(() => this.el.vignette.classList.remove('hit'), 90);
  }

  /* ───────── цифры урона (проекция 3D → экран) ───────── */
  damageNumber(worldPos, amount, isHeal = false, crit = false) {
    const d = this.dmgPool.pop() || document.createElement('div');
    d.style.cssText = 'position:absolute;font-weight:800;pointer-events:none;will-change:transform,opacity;' +
      `font-size:${crit ? 22 : isHeal ? 15 : 17}px;text-shadow:0 2px 3px #000;` +
      `color:${isHeal ? '#8fe38f' : crit ? '#ffd166' : '#ff8f7a'};opacity:1`;
    d.textContent = (isHeal ? '+' : '') + Math.round(amount) + (crit ? '!' : '');
    this.dmgLayer.appendChild(d);
    const item = {
      el: d, t: 0, life: crit ? 1.15 : 0.9,
      p: worldPos.clone(), vx: (Math.random() - 0.5) * 34, vy: -58 - Math.random() * 26,
    };
    this.dmgItems = this.dmgItems || [];
    this.dmgItems.push(item);
    if (this.dmgItems.length > 14) {
      const old = this.dmgItems.shift();
      old.el.remove(); this.dmgPool.push(old.el);
    }
  }

  updateNumbers(dt, camera, w, h) {
    if (!this.dmgItems?.length) return;
    const v = _v;
    for (let i = this.dmgItems.length - 1; i >= 0; i--) {
      const it = this.dmgItems[i];
      it.t += dt;
      if (it.t >= it.life) {
        it.el.remove(); this.dmgPool.push(it.el); this.dmgItems.splice(i, 1); continue;
      }
      it.p.x += it.vx * dt * 0.35; it.p.y -= it.vy * dt * 0.55;
      v.copy(it.p).project(camera);
      const k = 1 - it.t / it.life;
      it.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px,${(-v.y * 0.5 + 0.5) * h}px) translate(-50%,-50%) scale(${0.7 + k * 0.5})`;
      it.el.style.opacity = k < 0.35 ? (k / 0.35).toFixed(2) : '1';
    }
  }

  /* ───────── панель производительности ───────── */
  perf(snap, renderer) {
    if (!snap) return;
    this.el.p1.textContent = `FPS ${snap.fps}  кадр ${snap.median}мс  CPU ${snap.cpu}мс`;
    this.el.p2.textContent = `draw ${renderer.info.render.calls}  tris ${(renderer.info.render.triangles / 1000).toFixed(1)}k`;
    this.el.p3.textContent = `scale ${snap.renderScale}  кач. ${snap.quality}  просадки ${snap.lowPct}%`;
    this.el.perf.classList.toggle('bad', snap.fps < 26);
  }

  /* ───────── диалог ───────── */
  dialogue(name, text, options) {
    this.el.dlgName.textContent = name;
    this.el.dlgText.textContent = text;
    this.el.dlgOpts.innerHTML = '';
    for (const o of options) {
      const b = document.createElement('button');
      b.textContent = o.label;
      b.onclick = () => o.action?.();
      this.el.dlgOpts.appendChild(b);
    }
    this.show('dialogue');
  }

  /* ───────── инвентарь ───────── */
  inventory(p, onUse) {
    this.el.invGold.textContent = p.gold;
    this.el.invLevel.textContent = p.level;
    this.el.invDmg.textContent = p.dmg;
    this.el.invKills.textContent = p.kills;
    this.el.invList.innerHTML = '';
    if (!p.inventory.length) {
      this.el.invList.innerHTML = '<p class="tiny">Пусто. Обыскивай сундуки и тела.</p>';
    }
    for (const it of p.inventory) {
      const def = ITEMS[it.id] || { name: it.id, desc: '' };
      const row = document.createElement('div');
      row.className = 'item';
      row.innerHTML = `<div class="n">${def.name}<br><span class="q">${def.desc || ''}</span></div>
        <div class="q">×${it.q}</div>`;
      if (def.use === 'heal') {
        const b = document.createElement('button');
        b.textContent = 'Выпить';
        b.onclick = () => onUse(it.id);
        row.appendChild(b);
      } else if (p.equipped.includes(it.id)) {
        const s = document.createElement('div'); s.className = 'q'; s.textContent = 'надето';
        row.appendChild(s);
      }
      this.el.invList.appendChild(row);
    }
  }

  pauseStats(text) { this.el.pauseStats.textContent = text; }

  showDeath() { this.show('death'); this.onDeath?.(); }
}

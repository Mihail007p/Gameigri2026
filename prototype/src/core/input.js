// Ввод: сенсор (виртуальный джойстик + зона камеры + кнопки), клавиатура и мышь.
// Единая модель состояния, которую читает player.js:
//   move{x,y}   -1..1 (y — вперёд)
//   look{x,y}   дельта поворота камеры за кадр (сбрасывается в endFrame)
//   held.*      удерживаемые (блок)
//   consume()   одноразовые нажатия (удар, прыжок, взаимодействие, меню)
const $ = (id) => document.getElementById(id);

export class Input {
  constructor() {
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.held = { attack: false, block: false, run: false };
    this._edge = Object.create(null);

    this.isTouch = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints || 0) > 0;
    this.sens = 1.0;
    this.invert = false;

    this._stickPid = null; this._lookPid = null;
    this._stickOrigin = { x: 0, y: 0 };
    this._lookPrev = { x: 0, y: 0 };
    this._lookDown = 0; this._lookMoved = 0;
    this._keys = new Set();
    this.R = 52; // радиус хода джойстика, px

    this.dom = {
      zoneMove: $('zoneMove'), zoneLook: $('zoneLook'),
      stick: $('stick'), knob: $('knob'),
      attack: $('btnAttack'), block: $('btnBlock'), jump: $('btnJump'),
      interact: $('btnInteract'), bag: $('btnBag'), menu: $('btnMenu'),
      shout: $('btnShout'), shoutNext: $('btnShoutNext'),
    };

    this._bindZones();
    this._bindButtons();
    this._bindKeyboard();
    this._bindGuards();
  }

  press(name) { this._edge[name] = true; }
  consume(name) { const v = !!this._edge[name]; this._edge[name] = false; return v; }

  endFrame() { this.look.x = 0; this.look.y = 0; }

  /** Сбросить всё: нужно при уходе в меню, иначе нажатие «догонит» игру позже */
  flush() {
    this._edge = Object.create(null);
    this.held.attack = false; this.held.block = false; this.held.run = false;
    this.move.x = 0; this.move.y = 0;
    this.look.x = 0; this.look.y = 0;
    this.dom.stick?.classList.add('hidden');
    document.querySelectorAll('.tbtn.on').forEach(b => b.classList.remove('on'));
  }

  /* ───────────── сенсорные зоны ───────────── */
  _bindZones() {
    const zm = this.dom.zoneMove, zl = this.dom.zoneLook;

    zm.addEventListener('pointerdown', (e) => {
      if (this._stickPid !== null) return;
      this._stickPid = e.pointerId;
      this._stickOrigin.x = e.clientX; this._stickOrigin.y = e.clientY;
      zm.setPointerCapture(e.pointerId);
      this.dom.stick.style.left = e.clientX + 'px';
      this.dom.stick.style.top = e.clientY + 'px';
      this.dom.stick.classList.remove('hidden');
      this._updateStick(e.clientX, e.clientY);
      e.preventDefault();
    });

    zm.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._stickPid) return;
      this._updateStick(e.clientX, e.clientY);
      e.preventDefault();
    });

    const endStick = (e) => {
      if (e.pointerId !== this._stickPid) return;
      this._stickPid = null;
      this.move.x = 0; this.move.y = 0; this.held.run = false;
      this.dom.stick.classList.add('hidden');
    };
    zm.addEventListener('pointerup', endStick);
    zm.addEventListener('pointercancel', endStick);

    // зона камеры: перетаскивание = поворот, короткое касание без сдвига = удар
    zl.addEventListener('pointerdown', (e) => {
      if (e.button === 2) { this.held.block = true; this.dom.block.classList.add('on'); return; }
      if (this._lookPid !== null) return;
      this._lookPid = e.pointerId;
      this._lookPrev.x = e.clientX; this._lookPrev.y = e.clientY;
      this._lookDown = performance.now(); this._lookMoved = 0;
      zl.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    zl.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._lookPid) return;
      const dx = e.clientX - this._lookPrev.x;
      const dy = e.clientY - this._lookPrev.y;
      this._lookPrev.x = e.clientX; this._lookPrev.y = e.clientY;
      this._lookMoved += Math.abs(dx) + Math.abs(dy);
      const k = 0.0032 * this.sens;
      this.look.x += dx * k;
      this.look.y += (this.invert ? -dy : dy) * k;
      e.preventDefault();
    });

    const endLook = (e) => {
      if (e.button === 2) { this.held.block = false; this.dom.block.classList.remove('on'); return; }
      if (e.pointerId !== this._lookPid) return;
      this._lookPid = null;
      // тап без движения трактуем как атаку — так удобно стрелять «в одно касание»
      if (this._lookMoved < 12 && performance.now() - this._lookDown < 350) this.press('attack');
    };
    zl.addEventListener('pointerup', endLook);
    zl.addEventListener('pointercancel', endLook);
  }

  _updateStick(cx, cy) {
    let dx = cx - this._stickOrigin.x, dy = cy - this._stickOrigin.y;
    const len = Math.hypot(dx, dy);
    const max = this.R * 1.35;
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    this.dom.knob.style.transform = `translate(${dx}px,${dy}px)`;
    const n = Math.min(1, len / this.R);
    const ang = Math.atan2(dx, -dy);           // 0 = вперёд
    this.move.x = Math.sin(ang) * n;
    this.move.y = Math.cos(ang) * n;
    this.held.run = n > 0.86;
  }

  /* ───────────── кнопки ───────────── */
  _bindButtons() {
    const bind = (el, name, { hold = false } = {}) => {
      if (!el) return;
      const down = (e) => {
        e.preventDefault(); e.stopPropagation();
        el.classList.add('on');
        if (hold) this.held[name] = true; else this.press(name);
        el.setPointerCapture?.(e.pointerId);
      };
      const up = (e) => {
        e.preventDefault(); e.stopPropagation();
        el.classList.remove('on');
        if (hold) this.held[name] = false;
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
    };
    bind(this.dom.attack, 'attack', { hold: true });   // удар можно «зажать» для серии
    bind(this.dom.block, 'block', { hold: true });
    bind(this.dom.jump, 'jump');
    bind(this.dom.interact, 'interact');
    bind(this.dom.shout, 'shout');            // крик: одно нажатие = один выдох
    bind(this.dom.shoutNext, 'shoutNext');    // переключить выученное слово
    bind(this.dom.bag, 'bag');
    bind(this.dom.menu, 'menu');
  }

  /* ───────────── клавиатура / мышь (для отладки на ПК) ───────────── */
  _bindKeyboard() {
    const map = {
      KeyW: 'fwd', KeyS: 'back', KeyA: 'left', KeyD: 'right',
      ArrowUp: 'fwd', ArrowDown: 'back', ArrowLeft: 'left', ArrowRight: 'right',
      ShiftLeft: 'run', ShiftRight: 'run',
    };
    addEventListener('keydown', (e) => {
      if (e.repeat) { if (map[e.code]) e.preventDefault(); return; }
      if (map[e.code]) { this._keys.add(map[e.code]); e.preventDefault(); return; }
      switch (e.code) {
        case 'Space': this.press('jump'); e.preventDefault(); break;
        case 'KeyE': case 'KeyF': this.press('interact'); break;
        case 'KeyZ': this.press('shout'); break;
        case 'KeyX': this.press('shoutNext'); break;
        case 'KeyQ': this.held.block = true; break;
        case 'KeyR': this.held.attack = true; break;
        case 'KeyI': case 'Tab': this.press('bag'); e.preventDefault(); break;
        case 'Escape': case 'KeyM': this.press('menu'); break;
        case 'F5': this.press('quicksave'); e.preventDefault(); break;
        case 'F9': this.press('quickload'); e.preventDefault(); break;
      }
    });
    addEventListener('keyup', (e) => {
      if (map[e.code]) { this._keys.delete(map[e.code]); return; }
      if (e.code === 'KeyQ') this.held.block = false;
      if (e.code === 'KeyR') this.held.attack = false;
    });
    addEventListener('blur', () => { this._keys.clear(); this.held.block = false; this.held.attack = false; });
  }

  /** Клавиатурная составляющая движения (складывается с джойстиком) */
  keyboardMove(out) {
    let x = 0, y = 0;
    if (this._keys.has('fwd')) y += 1;
    if (this._keys.has('back')) y -= 1;
    if (this._keys.has('left')) x -= 1;
    if (this._keys.has('right')) x += 1;
    if (x || y) {
      const l = Math.hypot(x, y);
      out.x += x / l; out.y += y / l;
      if (this._keys.has('run')) out.run = true;
    }
    return out;
  }

  /** Итоговое движение: джойстик + клавиатура */
  getMove() {
    const m = { x: this.move.x, y: this.move.y, run: this.held.run };
    this.keyboardMove(m);
    const l = Math.hypot(m.x, m.y);
    if (l > 1) { m.x /= l; m.y /= l; }
    return m;
  }

  _bindGuards() {
    // никаких зумов/долгих нажатий/контекстного меню во время игры
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  }
}

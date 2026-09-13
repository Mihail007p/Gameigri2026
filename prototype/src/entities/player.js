// Игрок: движение от 3-го лица, камера, бой, выносливость, прокачка, инвентарь.
import * as THREE from 'three';
import { Rig, SKINS } from './humanoid.js';
import { PLAYER as P, WORLD, ITEMS, SHOUTS, START_WORDS } from '../config.js';
import { heightAt, slopeAt } from '../world/terrain.js';
import { clamp, lerp, smoothstep } from '../utils/noise.js';
import { sfx } from '../core/sfx.js';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _sh = new THREE.Vector3();

// гравитация: в падении сильнее, чем при «отлипании» от земли — так прыжок ощущается упругим
const GAME_GRAVITY = -22;
const WORLD_GRAVITY_SOFT = -9;

export class Player {
  constructor(game) {
    this.game = game;
    this.rig = new Rig('nord', { colors: SKINS.nord, shield: true, scale: 1 });
    this.rig.root.name = 'player';
    game.scene.add(this.rig.root);

    this.pos = new THREE.Vector3(WORLD.spawn.x, 0, WORLD.spawn.z);
    this.vel = new THREE.Vector3();
    this.yaw = 0;                 // куда смотрит тело
    this.camYaw = 0;              // камера за спиной, взгляд на север — в сторону деревни
    this.camPitch = 0.22;
    this.vy = 0;
    this.grounded = true;
    this.swim = false;

    this.level = 1; this.xp = 0; this.kills = 0; this.gold = 0;
    this.hpMax = P.hpMax; this.stMax = P.stMax;
    this.hp = this.hpMax; this.st = this.stMax;
    this.dmg = P.attackDmg;

    this.inventory = [{ id: 'potion', q: 2 }, { id: 'bread', q: 2 }];
    this.equipped = [];

    this.attackT = -1; this.attackCd = 0; this.hitDone = true;
    // крики (Thu'um): выученные слова, экипированное, кулдаун, фаза выкрикивания
    this.words = START_WORDS.slice();
    this.word = this.words[0];
    this.shoutCd = 0; this.shoutT = -1; this.shoutDone = true; this.shoutDef = null;
    this.dashT = 0; this.dashDur = 0.3; this.dashDist = 0;
    this.dashDir = new THREE.Vector3(0, 0, -1);
    this.blocking = false; this.blockBroken = 0;
    this.stDelay = 0;
    this.hurtCd = 0;
    this.dead = false;
    this.stepT = 0;
    this.speed = 0;
    this.invuln = 0;

    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.rig.root.position.copy(this.pos);
  }

  /**
   * Куда смотрит тело. Модель построена «лицом» в +Z, а rotation.y = yaw
   * переводит +Z в (sin yaw, 0, cos yaw) — это и есть направление удара.
   * (Вектор камеры другой: она смотрит ПРОТИВ своего смещения от игрока.)
   */
  get forward() { return _fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  /* ═══════════════ основной апдейт ═══════════════ */
  update(dt, input) {
    if (this.dead) {
      this.rig.animate({ speed: 0, grounded: true, attack: -1, block: false, vy: 0 }, dt);
      this.updateCamera(dt);
      return;
    }

    const m = input.getMove();
    this._cameraInput(dt, input);
    this._stamina(dt, m);
    this._move(dt, m);
    this._combat(dt, input);
    this._animate(dt, m);
    this.updateCamera(dt);

    if (this.hurtCd > 0) this.hurtCd -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.blockBroken > 0) this.blockBroken -= dt;
  }

  _cameraInput(dt, input) {
    this.camYaw -= input.look.x;
    this.camPitch = clamp(this.camPitch + input.look.y, P.camPitchMin, P.camPitchMax);
    if (this.camYaw > Math.PI) this.camYaw -= Math.PI * 2;
    if (this.camYaw < -Math.PI) this.camYaw += Math.PI * 2;
  }

  _stamina(dt, m) {
    const wantBlock = this.game.input.held.block && this.st > 1 && this.blockBroken <= 0 && !this.swim;
    this.blocking = wantBlock && this.attackT < 0;
    const running = this._running;
    let drain = 0;
    if (this.blocking) drain += P.blockDrain;
    if (running && this.speed > 1) drain += P.runDrain;
    if (drain > 0) {
      this.st -= drain * dt;
      this.stDelay = P.stRegenDelay;
      if (this.st <= 0) {
        this.st = 0;
        if (this.blocking) { this.blockBroken = 1.1; sfx.block(); this.game.hud.toast('Блок сломан!', 'bad'); }
      }
    } else {
      this.stDelay -= dt;
      if (this.stDelay <= 0) this.st = Math.min(this.stMax, this.st + P.stRegen * dt);
    }
  }

  _move(dt, m) {
    // направление относительно камеры
    const cy = this.camYaw;
    _fwd.set(-Math.sin(cy), 0, -Math.cos(cy));
    _right.set(Math.cos(cy), 0, -Math.sin(cy));
    _wish.set(0, 0, 0).addScaledVector(_fwd, m.y).addScaledVector(_right, m.x);
    const mag = Math.min(1, _wish.length());

    this._running = (m.run || mag > 0.92) && this.st > 1 && !this.blocking && !this.swim
      && this.grounded && this.dashT <= 0;
    // погода: в глубоком снегу и на ветру шаг короче
    const wMul = this.game.weather?.v.speedMul ?? 1;
    const maxSpeed = (this.swim ? P.swimSpeed : this.blocking ? P.walkSpeed * 0.55
      : this._running ? P.runSpeed : P.walkSpeed) * wMul;
    this.maxSpeed = maxSpeed;

    if (mag > 0.01) {
      _wish.normalize();
      const target = maxSpeed * (this.blocking ? 0.55 : 1) * (mag > 0.92 ? 1 : Math.max(mag, 0.35));
      this.vel.x = lerp(this.vel.x, _wish.x * target, clamp(P.accel * dt / 6, 0, 1));
      this.vel.z = lerp(this.vel.z, _wish.z * target, clamp(P.accel * dt / 6, 0, 1));
      // тело плавно доворачивается в сторону движения
      const want = Math.atan2(_wish.x, _wish.z);
      let d = want - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * clamp(dt * 11, 0, 1);
      this.strafe = clamp(m.x, -1, 1) * mag;
    } else {
      const k = clamp(P.damping * dt, 0, 1);
      this.vel.x -= this.vel.x * k; this.vel.z -= this.vel.z * k;
      this.strafe = 0;
      // в покое тело доворачивается к камере — как в Skyrim
      let d = this.camYaw - Math.PI - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * clamp(dt * 3.2, 0, 1);
    }

    // прыжок / всплытие
    if (this.game.input.consume('jump')) {
      if (this.swim) this.vy = 3.2;
      else if (this.grounded && this.st > 8 && !this.blocking) {
        this.vy = P.jumpVel; this.grounded = false; this.st -= 8; this.stDelay = P.stRegenDelay;
        sfx.jump();
      }
    }

    // «Вихрь»: на время рывка управление перехвачено, скорость гаснет к концу
    if (this.dashT > 0) {
      this.dashT -= dt;
      const k = clamp(this.dashT / this.dashDur, 0, 1);
      const sp = (this.dashDist / this.dashDur) * (0.55 + 0.9 * k);  // средний коэф. = 1 → пролетает ровно def.dist
      this.vel.x = this.dashDir.x * sp;
      this.vel.z = this.dashDir.z * sp;
      this.yaw = Math.atan2(this.dashDir.x, this.dashDir.z);
      this.vy = Math.max(this.vy, -2.5);          // в рывке не падаем камнем
      this.grounded = true;
      if (Math.random() < 0.75) this.game.fx.trail(this.pos.x, this.pos.y, this.pos.z, 0xbfe6ff, 2, 1.3);
    }

    // интеграция
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;

    // граница мира
    const lim = WORLD.half - 12;
    this.pos.x = clamp(nx, -lim, lim);
    this.pos.z = clamp(nz, -lim, lim);

    const gh = heightAt(this.pos.x, this.pos.z);
    // слишком крутой подъём = невидимая стена (иначе игрок влезет на горы)
    if (gh - this.pos.y > 0.85 && this.grounded) {
      this.pos.x -= this.vel.x * dt; this.pos.z -= this.vel.z * dt;
      this.vel.multiplyScalar(0.35);
    }

    const depth = WORLD.water - gh;
    this.swim = depth > 1.0;

    if (this.swim) {
      this.grounded = false;
      const surf = WORLD.water - 0.42;
      this.pos.y = lerp(this.pos.y, surf, clamp(dt * 4, 0, 1));
      this.vy = 0;
      this.vel.multiplyScalar(1 - clamp(dt * 1.2, 0, 1));
    } else {
      this.vy += (this.grounded ? WORLD_GRAVITY_SOFT : GAME_GRAVITY) * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= gh) {
        if (!this.grounded && this.vy < -7) { sfx.land(); this.game.fx.burst(this.pos.x, gh + 0.1, this.pos.z, 0x8a7a5c, 5, 1.4, 0.8, 0.4, 0.8); }
        this.pos.y = gh; this.vy = 0; this.grounded = true;
      } else if (this.pos.y - gh > 0.06) {
        this.grounded = false;
      }
    }

    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // шаги
    if (this.grounded && this.speed > 0.8) {
      this.stepT -= dt * this.speed;
      if (this.stepT <= 0) { this.stepT = 2.4; sfx.step(); }
    }

    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
  }

  /* ═══════════════ крики (Thu'um) ═══════════════ */
  get shout() { return SHOUTS[this.word] || null; }

  /** Выучить слово у стены сил. Возвращает определение крика или null. */
  learnWord(id) {
    const def = SHOUTS[id];
    if (!def || this.words.includes(id)) return null;
    this.words.push(id);
    this.word = id;                 // новое слово сразу экипируется
    this.shoutT = -1;
    return def;
  }

  /** Переключить экипированный крик по кругу */
  cycleWord() {
    if (this.words.length < 2) return this.shout;
    const i = this.words.indexOf(this.word);
    this.word = this.words[(i + 1) % this.words.length];
    const def = this.shout;
    sfx.ui();
    this.game.hud.toast(`Крик: ${def.name} — «${def.word}»`, '');
    return def;
  }

  /** Попытка выкрикнуть. Возвращает false, если крик не готов. */
  tryShout() {
    const def = this.shout;
    if (!def || this.dead || this.shoutT >= 0 || this.dashT > 0 || this.blocking) return false;
    if (this.shoutCd > 0) {
      this.game.hud.toast(`Крик не готов: ${Math.ceil(this.shoutCd)} с`, 'bad');
      return false;
    }
    if (this.st < def.stCost) {
      this.game.hud.toast('Не хватает выносливости для крика', 'bad');
      return false;
    }
    this.st -= def.stCost;
    this.stDelay = P.stRegenDelay;
    this.shoutT = 0; this.shoutDone = false; this.shoutDef = def;
    return true;
  }

  /** Момент выдоха слова: волна, урон/отброс или рывок */
  _doShout(def) {
    const cy = this.camYaw;
    _sh.set(-Math.sin(cy), 0, -Math.cos(cy));      // куда смотрит камера (горизонт)
    this.yaw = Math.atan2(_sh.x, _sh.z);           // тело разворачивается вместе с криком

    sfx.shout(def.kind);
    this.game.fx.shockwave(this.pos.x + _sh.x * 0.7, this.pos.y + 1.2, this.pos.z + _sh.z * 0.7,
      def.kind === 'frost' ? 0x9fe4ff : 0xffe3ab,
      { count: def.kind === 'force' ? 30 : 24, speed: 13, life: 0.55,
        size: 1.15, dir: _sh, spread: def.arc || 1.2 });
    this.game.shake(def.kind === 'force' ? 0.8 : 0.4);

    if (def.kind === 'dash') {
      this.dashT = def.dur; this.dashDur = def.dur; this.dashDist = def.dist;
      this.dashDir.copy(_sh);
      this.invuln = Math.max(this.invuln, def.dur + 0.15);
      sfx.whoosh();
      return;
    }

    let hits = 0;
    for (const e of this.game.enemies.list) {
      if (e.dead) continue;
      _tmp.copy(e.pos).sub(this.pos);
      const dist = _tmp.length();
      if (dist > def.range + e.radius) continue;
      _tmp.normalize();
      if (_tmp.dot(_sh) < Math.cos(def.arc)) continue;   // только в конусе взгляда
      e.damage(def.dmg, this.pos, false);
      e.applyImpulse(_tmp.x, _tmp.z, def.knock * clamp(1 - dist / (def.range * 1.7), 0.25, 1), def.stun || 0);
      if (def.slow) e.chill(def.slow);
      if (++hits >= (def.maxTargets || 4)) break;
    }
    if (hits) sfx.hit();
  }

  /* ═══════════════ бой ═══════════════ */
  _combat(dt, input) {
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.shoutCd > 0) this.shoutCd -= dt;

    // крик: кнопка 🐉 выкрикивает экипированное слово, ⇄ переключает слово
    if (input.consume('shoutNext')) this.cycleWord();
    if (input.consume('shout')) this.tryShout();
    if (this.shoutT >= 0) {
      const def = this.shoutDef || this.shout;
      this.shoutT += dt;
      if (!this.shoutDone && this.shoutT >= def.castTime) { this.shoutDone = true; this._doShout(def); }
      if (this.shoutT >= def.castTime + P.shoutCastPad) {
        this.shoutT = -1;
        this.shoutCd = def.cd;
        this.shoutDef = null;
      }
    }

    const wantAttack = input.held.attack || input.consume('attack');
    if (wantAttack && this.attackT < 0 && this.attackCd <= 0 && !this.blocking &&
        this.st >= P.attackStCost && this.blockBroken <= 0 && this.shoutT < 0 && this.dashT <= 0) {
      this.attackT = 0; this.hitDone = false;
      this.st -= P.attackStCost; this.stDelay = P.stRegenDelay;
      sfx.swing();
    }
    if (this.attackT >= 0) {
      this.attackT += dt / P.attackTime;
      if (!this.hitDone && this.attackT * P.attackTime >= P.attackHitAt) {
        this.hitDone = true;
        this._doHit();
      }
      if (this.attackT >= 1) { this.attackT = -1; this.attackCd = P.attackCooldown; }
    }
  }

  _doHit() {
    const enemies = this.game.enemies.list;
    this.rig.tip.getWorldPosition(_tip);
    const fwd = this.forward;
    let hits = 0;
    for (const e of enemies) {
      if (e.dead) continue;
      _tmp.copy(e.pos).sub(this.pos);
      const dist = _tmp.length();
      if (dist > P.attackRange + e.radius) continue;
      _tmp.normalize();
      if (_tmp.dot(fwd) < Math.cos(P.attackArc)) continue;
      const crit = Math.random() < P.critChance;
      const dmg = Math.round(this.dmg * (crit ? P.critMul : 1) * (0.9 + Math.random() * 0.2));
      e.damage(dmg, this.pos, crit);
      hits++;
      if (hits >= 2) break; // широкий взмах, но не более двух целей
    }
    if (hits) {
      sfx.hit();
      this.game.fx.burstAt(_tip, 0xffd08a, 7, 3.0, 1.4, 0.42, 1);
      this.game.shake(0.22);
    } else {
      this.game.fx.burstAt(_tip, 0x9fb4c8, 2, 1.2, 0.5, 0.25, 0.6);
    }
  }

  damage(amount, fromPos, { ignoreBlock = false } = {}) {
    if (this.dead || this.invuln > 0) return 0;
    let dmg = amount;
    if (this.blocking && !ignoreBlock) {
      dmg = Math.round(amount * P.blockMul);
      this.st -= amount * 0.85;
      sfx.block();
      this.game.fx.burst(this.pos.x, this.pos.y + 1.2, this.pos.z, 0xbfd4e8, 6, 2.4, 1.0, 0.35, 0.9);
      if (this.st <= 0) { this.st = 0; this.blockBroken = 1.2; this.game.hud.toast('Блок сломан!', 'bad'); }
    } else {
      sfx.hurt();
      this.game.shake(0.5);
    }
    this.hp -= dmg;
    this.invuln = 0.18;
    this.rig.flash();
    this.game.hud.vignette();
    this.game.hud.damageNumber(this.pos, dmg, false);
    if (fromPos) {
      // лёгкий откат от удара
      _tmp.copy(this.pos).sub(fromPos).setY(0).normalize();
      this.vel.addScaledVector(_tmp, 2.2);
    }
    if (this.hp <= 0) { this.hp = 0; this.die(); }
    return dmg;
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.rig.deathT = 0;
    this.blocking = false;
    sfx.death();
    this.game.hud.showDeath();
  }

  heal(n) {
    this.hp = Math.min(this.hpMax, this.hp + n);
    this.game.hud.damageNumber(this.pos, n, true);
    this.game.fx.burst(this.pos.x, this.pos.y + 1.1, this.pos.z, 0x8fe38f, 8, 1.4, 1.2, 0.6, 0.9);
  }

  addXp(n) {
    this.xp += n;
    const need = P.xpPerLevel[Math.min(this.level, P.xpPerLevel.length - 1)] || (this.level * 1200);
    if (this.xp >= need && this.level < P.xpPerLevel.length) {
      this.xp -= need; this.level++;
      this.hpMax += P.hpPerLevel; this.dmg += P.dmgPerLevel;
      this.hp = this.hpMax; this.st = this.stMax;
      sfx.level();
      this.game.hud.toast(`Уровень ${this.level}! +${P.hpPerLevel} HP, +${P.dmgPerLevel} урона`, 'good');
      this.game.fx.burst(this.pos.x, this.pos.y + 1, this.pos.z, 0xffd77a, 22, 3.2, 3.0, 1.1, 1.2);
      return true;
    }
    return false;
  }

  addItem(id, q = 1) {
    const def = ITEMS[id];
    if (!def) return;
    if (def.stack) {
      const it = this.inventory.find(i => i.id === id);
      if (it) it.q += q; else this.inventory.push({ id, q });
    } else if (!this.inventory.some(i => i.id === id)) {
      this.inventory.push({ id, q: 1 });
      if (def.use === 'equipHp') { this.hpMax += def.power; this.hp += def.power; this.equipped.push(id); }
    }
    sfx.pickup();
  }

  useItem(id) {
    const it = this.inventory.find(i => i.id === id);
    if (!it) return false;
    const def = ITEMS[id];
    if (def.use === 'heal') {
      if (this.hp >= this.hpMax) { this.game.hud.toast('Здоровье полное', ''); return false; }
      this.heal(def.power);
    }
    it.q--;
    if (it.q <= 0) this.inventory.splice(this.inventory.indexOf(it), 1);
    return true;
  }

  countItem(id) {
    const it = this.inventory.find(i => i.id === id);
    return it ? it.q : 0;
  }

  /* ═══════════════ анимация ═══════════════ */
  _animate(dt, m) {
    this.rig.animate({
      speed: this.speed, maxSpeed: this.maxSpeed || P.runSpeed,
      grounded: this.grounded, vy: this.vy,
      attack: this.shoutT >= 0 ? Math.min(0.99, this.shoutT * 1.8) : this.attackT,
      block: this.blocking, swim: this.swim,
      strafe: this.strafe || 0,
    }, dt);
  }

  /* ═══════════════ камера ═══════════════ */
  updateCamera(dt) {
    const cam = this.game.camera;
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const dx = Math.sin(this.camYaw) * cp, dy = sp, dz = Math.cos(this.camYaw) * cp;
    const hx = this.pos.x, hy = this.pos.y + P.camHeight, hz = this.pos.z;

    // не даём камере уходить под землю: 5 проб вдоль луча
    let t = 1;
    for (let i = 1; i <= 5; i++) {
      const f = i / 5;
      const px = hx + dx * P.camDist * f, pz = hz + dz * P.camDist * f;
      const py = hy + dy * P.camDist * f;
      if (py < heightAt(px, pz) + 0.5) { t = Math.max(0.42, (i - 1) / 5 + 0.12); break; }
    }
    const dd = P.camDist * t;
    _camTarget.set(hx + dx * dd, hy + dy * dd, hz + dz * dd);
    const k = clamp(dt * 16, 0, 1);
    cam.position.lerp(_camTarget, k);
    cam.lookAt(hx, hy + 0.05, hz);
    this.camPos = cam.position;
  }

  /* ═══════════════ сохранение ═══════════════ */
  serialize() {
    return {
      x: +this.pos.x.toFixed(2), y: +this.pos.y.toFixed(2), z: +this.pos.z.toFixed(2),
      yaw: +this.yaw.toFixed(3), camYaw: +this.camYaw.toFixed(3), camPitch: +this.camPitch.toFixed(3),
      hp: Math.round(this.hp), st: Math.round(this.st), level: this.level, xp: Math.round(this.xp),
      gold: this.gold, kills: this.kills, hpMax: this.hpMax, dmg: this.dmg,
      inv: this.inventory.map(i => ({ ...i })), eq: this.equipped.slice(),
      words: this.words.slice(), word: this.word,
    };
  }

  restore(s) {
    if (!s) return;
    this.pos.set(s.x, s.y, s.z);
    // страхуемся от «провалился под землю» после загрузки
    this.pos.y = Math.max(this.pos.y, heightAt(this.pos.x, this.pos.z));
    this.yaw = s.yaw || 0; this.camYaw = s.camYaw ?? 0; this.camPitch = s.camPitch ?? 0.22;
    this.level = s.level || 1; this.xp = s.xp || 0; this.gold = s.gold || 0; this.kills = s.kills || 0;
    this.hpMax = s.hpMax || P.hpMax; this.dmg = s.dmg || P.attackDmg;
    this.hp = clamp(s.hp ?? this.hpMax, 1, this.hpMax);   // 0 HP в сейве быть не может
    this.st = clamp(s.st ?? P.stMax, 0, this.stMax);
    this.inventory = (s.inv || []).map(i => ({ ...i }));
    this.equipped = s.eq || [];
    // слова силы из сейва (старые сейвы без них получают стартовый набор)
    this.words = Array.isArray(s.words) ? s.words.filter(w => SHOUTS[w]) : [];
    if (!this.words.length) this.words = START_WORDS.slice();
    this.word = SHOUTS[s.word] && this.words.includes(s.word) ? s.word : this.words[0];
    this.shoutCd = 0; this.shoutT = -1; this.shoutDone = true; this.shoutDef = null;
    this.dashT = 0; this.invuln = 0;
    this.dead = false; this.rig.deathT = -1; this.rig.pose.rotation.x = 0;
    this.rig.material.opacity = 1; this.rig.material.transparent = false;
    this.rig.root.position.copy(this.pos);
    this.vel.set(0, 0, 0); this.vy = 0;
  }
}


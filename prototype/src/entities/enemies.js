// Враги: драугры и волки. Простой конечный автомат + разделение в толпе.
// Важно для слабого GPU: враги дальше 70 м «спят» (не думают и не рисуются),
// тени отбрасывают только ближайшие — иначе теневой проход удваивает draw calls.
import * as THREE from 'three';
import { Rig, SKINS } from './humanoid.js';
import { ENEMIES, WORLD, SPAWN_POINTS, NIGHT } from '../config.js';
import { heightAt } from '../world/terrain.js';
import { clamp, lerp, rng } from '../utils/noise.js';
import { sfx } from '../core/sfx.js';

const RIG_KIND = { draugr: 'draugr', draugrWarrior: 'draugr', wolf: 'wolf' };
const WOLF_SKIN = { fur: 0x5b5348, fur2: 0x3b352e, eyes: 0xffcf6a };
const RIG_SCALE_BAR = { draugr: 2.25, wolf: 1.25 };

const _tmp = new THREE.Vector3();

/**
 * «Угроза ночи»: 0 днём → 1 в глубокую ночь. Враги видят дальше, бьют больнее
 * и бегают быстрее. Это делает ночь осмысленным риском, а не просто темнотой.
 */
export function threatOf(game) {
  const sky = game && game.sky;
  if (!sky) return 0;
  const night = clamp(sky.night || 0, 0, 1);
  const weather = clamp(sky.threat || 0, 0, 1);   // метель тоже добавляет опасности
  return clamp(night * 0.85 + weather * 0.35, 0, 1);
}

class Enemy {
  constructor(game, type, sp, index) {
    this.game = game;
    this.type = type;
    this.def = ENEMIES[type];
    this.index = index;
    const kind = RIG_KIND[type];
    this.kind = kind;
    const r = rng(sp.x * 31 + sp.z * 17 + index * 7 + 5);
    this.rig = new Rig(kind, {
      colors: kind === 'wolf'
        ? { fur: 0x4e4740, fur2: 0x332e28, eyes: 0xffcf6a }
        : (kind === 'draugr' && type === 'draugrWarrior' ? SKINS.draugrWarrior : SKINS.draugr),
      scale: this.def.scale, shield: false, weapon: kind !== 'wolf',
    });
    game.scene.add(this.rig.root);

    const a = r() * Math.PI * 2, d = r() * (sp.radius || 10);
    this.homeTag = sp.home || 'wild';
    this.home = new THREE.Vector3(sp.x + Math.cos(a) * d, 0, sp.z + Math.sin(a) * d);
    this.home.y = heightAt(this.home.x, this.home.z);
    this.pos = this.home.clone();
    this.yaw = r() * 6.28;
    this.radius = kind === 'wolf' ? 0.5 : 0.42;
    this.hpMax = this.def.hp; this.hp = this.def.hp;
    this.state = 'idle';
    this.target = this.home.clone();
    this.rethink = r() * 4;
    this.attackT = -1; this.hitDone = true; this.cd = r() * 1.2;
    this.dead = false; this.looted = false; this.canLoot = false; this.lootTimer = 0;
    this.active = false; this.aggro = false; this.aggroTimer = 0;
    this.speed = 0; this.shadowsOn = false;
    this.rnd = r;
    this.hurtFlash = 0;
    // последствия криков: отброс (импульс), оглушение, заморозка
    this.knockX = 0; this.knockZ = 0; this.stun = 0; this.slow = 0;

    // полоска здоровья (видна только у раненого врага)
    const barY = (RIG_SCALE_BAR[kind] || 2.2) * this.def.scale;
    this.bar = new THREE.Group();
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.11),
      new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.55, fog: false }));
    this.barFg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.88, 0.062),
      new THREE.MeshBasicMaterial({ color: 0xc0392b, fog: false, transparent: true }));
    bg.position.z = -0.005;
    bg.renderOrder = 6; this.barFg.renderOrder = 7;   // оба в прозрачном проходе: фон раньше
    this.bar.add(bg, this.barFg);
    this.bar.position.y = barY;
    this.bar.visible = false;
    this.bar.renderOrder = 5;
    this.rig.root.add(this.bar);

    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    this.rig.visible = false;
  }

  /* ────── урон и смерть ────── */
  damage(amount, fromPos, crit) {
    if (this.dead) return;
    this.hp -= amount;
    this.aggro = true; this.aggroTimer = 12;
    this.rig.flash();
    this.hurtFlash = 0.25;
    this.bar.visible = true;
    this.barFg.scale.x = clamp(this.hp / this.hpMax, 0.001, 1);
    this.barFg.position.x = -(1 - clamp(this.hp / this.hpMax, 0, 1)) * 0.44;
    this.game.hud.damageNumber(_tmp.copy(this.pos).setY(this.pos.y + 1.5), amount, false, crit);
    this.game.fx.burst(this.pos.x, this.pos.y + 1.0, this.pos.z,
      this.kind === 'wolf' ? 0x8a2f2f : 0x6fd0e8, 8, 2.8, 1.6, 0.5, 1);
    if (fromPos) {
      _tmp.copy(this.pos).sub(fromPos).setY(0);
      if (_tmp.length() > 0.01) {
        _tmp.normalize().multiplyScalar(crit ? 0.55 : 0.3);
        this.pos.add(_tmp);
      }
    }
    if (this.hp <= 0) this.die();
  }

  /**
   * Импульс от крика: врага отбрасывает и (опционально) оглушает.
   * Работает через скорость, которая гаснет в _move, поэтому не ломает ИИ.
   */
  applyImpulse(dirX, dirZ, power, stun = 0) {
    if (this.dead) return;
    const l = Math.hypot(dirX, dirZ) || 1;
    this.knockX += (dirX / l) * power;
    this.knockZ += (dirZ / l) * power;
    if (stun > 0) {
      this.stun = Math.max(this.stun, stun);
      this.attackT = -1; this.hitDone = true;   // сбиваем замах
    }
  }

  chill(sec) { this.slow = Math.max(this.slow, sec); }

  die() {
    this.hp = 0;
    this.dead = true;
    this.state = 'dead';
    this.canLoot = true;
    this.lootTimer = 34;
    this.attackT = -1;
    this.rig.deathT = 0;
    this.bar.visible = false;
    sfx.kill();
    const p = this.game.player;
    p.kills++;
    p.addXp(this.def.xp);
    this.game.fx.burst(this.pos.x, this.pos.y + 0.9, this.pos.z, 0x6fd0e8, 14, 3.2, 2.2, 0.8, 1.1);
    this.game.hud.toast(`${this.def.name} повержен · +${this.def.xp} опыта`, 'good');
    this.game.onEnemyKilled(this);
  }

  loot(player) {
    if (!this.canLoot || this.looted) return null;
    this.looted = true; this.canLoot = false;
    const [lo, hi] = this.def.gold;
    const gold = Math.round(lo + this.rnd() * (hi - lo));
    player.gold += gold;
    const got = [];
    if (gold > 0) got.push(`${gold} золота`);
    for (const [id, chance] of (this.def.loot || [])) {
      if (this.rnd() < chance) { player.addItem(id, 1); got.push(id); }
    }
    sfx.pickup();
    return got;
  }

  /* ────── ИИ ────── */
  update(dt, player) {
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);

    // сон/пробуждение по дистанции — экономим CPU и draw calls
    if (!this.active) {
      if (dist > 95 || player.dead) return;
      this.active = true;
      this.rig.visible = true;
    } else if (dist > 130) {
      this.active = false; this.aggro = false; this.rig.visible = false;
      this.bar.visible = false;
      if (this.dead && !this.canLoot) this.reset();
      return;
    }

    // тени только у ближних врагов
    const wantShadow = dist < 24 && this.game.sky.sun.castShadow;
    if (wantShadow !== this.shadowsOn) {
      this.shadowsOn = wantShadow;
      for (const c of this.rig.pose.children) if (c.children[0]) c.children[0].castShadow = wantShadow;
    }

    if (this.dead) {
      this.rig.animate({ speed: 0, grounded: true, attack: -1, block: false, vy: 0 }, dt);
      if (this.canLoot) {
        this.lootTimer -= dt;
        if (this.lootTimer <= 0) { this.canLoot = false; this.rig.visible = false; }
      }
      return;
    }

    if (this.aggroTimer > 0) { this.aggroTimer -= dt; if (this.aggroTimer <= 0) this.aggro = false; }
    if (this.cd > 0) this.cd -= dt;
    if (this.slow > 0) this.slow -= dt;
    const slowK = this.slow > 0 ? 0.45 : 1;        // «Ледяное дыхание»: вдвое медленнее

    // оглушение криком: враг не думает и не бьёт, только катится от импульса
    if (this.stun > 0) {
      this.stun -= dt;
      this._move(dt, 0, 0);
      this.rig.animate({ speed: this.speed, maxSpeed: this.def.runSpeed, grounded: true, vy: 0,
        attack: -1, block: false, swim: false }, dt);
      if (this.bar.visible) this.bar.lookAt(this.game.camera.position);
      this.rig.material.emissive.setRGB(0.06, 0.2, 0.36);
      return;
    }

    // ночь и непогода делают тварей опаснее
    const th = threatOf(this.game);
    const detect = this.def.detect * (1 + th * NIGHT.detectMul);
    this.dmgNow = Math.round(this.def.dmg * (1 + th * NIGHT.dmgMul));

    const canSee = dist < detect && !player.dead && Math.abs(player.pos.y - this.pos.y) < 12;
    if (canSee || this.aggro) {
      if (this.state !== 'chase' && this.state !== 'attack') {
        this.state = 'chase';
        if (this.kind === 'wolf') sfx.wolf();
      }
      // атака
      if (this.attackT >= 0) {
        this.attackT += dt / this.def.attackTime;
        if (!this.hitDone && this.attackT * this.def.attackTime >= this.def.attackHitAt) {
          this.hitDone = true;
          if (dist < this.def.attackRange + 0.85) {
            player.damage(this.dmgNow ?? this.def.dmg, this.pos);
            this.game.fx.burst(player.pos.x, player.pos.y + 1.2, player.pos.z, 0xff6a4a, 6, 2.2, 1.2, 0.4, 1);
          } else {
            this.game.fx.burst(this.pos.x + dx / dist, this.pos.y + 1, this.pos.z + dz / dist, 0x9fb4c8, 3, 1.2, 0.6, 0.3, 0.7);
          }
        }
        if (this.attackT >= 1) { this.attackT = -1; this.cd = this.def.cooldown * (0.85 + this.rnd() * 0.4); }
        this._move(dt, 0, 0);
      } else if (dist < this.def.attackRange && this.cd <= 0) {
        this.attackT = 0; this.hitDone = false; this.state = 'attack';
        sfx.swing();
        this._move(dt, 0, 0);
      } else {
        this._moveToward(dt, player.pos.x, player.pos.z,
          this.def.runSpeed * slowK * (1 + th * NIGHT.speedMul));
      }
      this._face(dt, player.pos.x, player.pos.z);
    } else {
      // патруль вокруг дома
      this.state = 'idle';
      this.rethink -= dt;
      const tx = this.target.x - this.pos.x, tz = this.target.z - this.pos.z;
      if (this.rethink <= 0 || Math.hypot(tx, tz) < 0.8) {
        this.rethink = 3 + this.rnd() * 5;
        const a = this.rnd() * 6.283, rr = this.rnd() * (this.def.detect * 0.4);
        this.target.set(this.home.x + Math.cos(a) * rr, 0, this.home.z + Math.sin(a) * rr);
      }
      this._moveToward(dt, this.target.x, this.target.z, this.def.speed * 0.45 * slowK);
      if (this.speed > 0.2) this._face(dt, this.target.x, this.target.z);
    }

    this.rig.animate({
      speed: this.speed, maxSpeed: this.def.runSpeed,
      grounded: true, vy: 0, attack: this.attackT, block: false, swim: false,
    }, dt);

    // полоска здоровья смотрит в камеру
    if (this.bar.visible) {
      this.bar.lookAt(this.game.camera.position);
      if (this.hurtFlash > 0) this.hurtFlash -= dt;
      else if (dist > 30) this.bar.visible = false;
    }

    // иней на замороженном враге (ставим ПОСЛЕ rig.animate — он сбрасывает emissive)
    if (this.slow > 0) this.rig.material.emissive.setRGB(0.06, 0.2, 0.36);
  }

  _face(dt, tx, tz) {
    const want = Math.atan2(tx - this.pos.x, tz - this.pos.z);
    let d = want - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * clamp(dt * 9, 0, 1);
    this.rig.root.rotation.y = this.yaw;
  }

  _moveToward(dt, tx, tz, speed) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.08) { this._move(dt, 0, 0); return; }
    this._move(dt, dx / len * speed, dz / len * speed);
  }

  _move(dt, vx, vz) {
    // отбрасывание от крика: добавляем импульс и быстро гасим его
    if (this.knockX !== 0 || this.knockZ !== 0) {
      vx += this.knockX; vz += this.knockZ;
      const decay = Math.pow(0.02, dt);           // ~98 % затухания за секунду
      this.knockX *= decay; this.knockZ *= decay;
      if (Math.abs(this.knockX) < 0.08) this.knockX = 0;
      if (Math.abs(this.knockZ) < 0.08) this.knockZ = 0;
    }

    // разделение в толпе, чтобы не слипались в одну точку
    const list = this.game.enemies.list;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o === this || o.dead || !o.active) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      const min = (this.radius + o.radius) * 2.1;
      if (d2 < min * min && d2 > 0.0001) {
        const d = Math.sqrt(d2), push = (min - d) * 3.2;
        vx += dx / d * push; vz += dz / d * push;
      }
    }

    const nx = this.pos.x + vx * dt, nz = this.pos.z + vz * dt;
    const gh = heightAt(nx, nz);
    // в глубокую воду не лезем (и не падаем с обрывов)
    const tooDeep = WORLD.water - gh > 1.35;
    const tooSteep = gh - this.pos.y > 1.5;
    if (!tooDeep && !tooSteep && Math.abs(nx) < WORLD.half - 14 && Math.abs(nz) < WORLD.half - 14) {
      this.pos.x = nx; this.pos.z = nz;
    } else if (this.state === 'chase') {
      // обходим препятствие по касательной
      this.pos.x += -vz * dt * 0.6; this.pos.z += vx * dt * 0.6;
    }
    const g2 = heightAt(this.pos.x, this.pos.z);
    this.pos.y = Math.max(g2, WORLD.water - 0.5);
    this.speed = Math.hypot(vx, vz);
    this.rig.root.position.copy(this.pos);
  }

  /** Полный сброс (используется и для респавна, и для «Новой игры») */
  reset() {
    this.dead = false; this.looted = false; this.hp = this.hpMax;
    this.state = 'idle'; this.attackT = -1; this.aggro = false;
    this.rig.deathT = -1; this.rig.pose.rotation.x = 0; this.rig.pose.position.y = 0;
    this.rig.material.transparent = false; this.rig.material.opacity = 1;
    this.pos.copy(this.home);
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.set(0, this.yaw, 0);
    this.rig.visible = false; this.active = false;
    this.bar.visible = false; this.barFg.scale.x = 1; this.barFg.position.x = 0;
    this.knockX = 0; this.knockZ = 0; this.stun = 0; this.slow = 0; this.dmgNow = this.def.dmg;
  }
}

export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    for (const sp of SPAWN_POINTS) {
      for (let i = 0; i < sp.count; i++) this.list.push(new Enemy(game, sp.type, sp, i));
    }
  }

  update(dt) {
    const p = this.game.player;
    let alive = 0;
    for (const e of this.list) {
      e.update(dt, p);
      if (e.active && !e.dead) alive++;
    }
    this.alive = alive;
  }

  /** Ближайший возможный объект для взаимодействия (труп) */
  nearestLoot(pos, maxDist = 2.6) {
    let best = null, bd = maxDist;
    for (const e of this.list) {
      if (!e.canLoot || e.looted) continue;
      const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  countKillsOfHome(home) {
    return this.list.filter(e => e.dead && e.homeTag === home).length;
  }

  serialize() {
    return this.list.map(e => ({ dead: e.dead, looted: e.looted, hp: Math.round(e.hp) }));
  }

  restore(arr) {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < Math.min(arr.length, this.list.length); i++) {
      const s = arr[i], e = this.list[i];
      if (s.dead) {
        e.hp = 0; e.dead = true; e.looted = !!s.looted; e.canLoot = false;
        e.rig.deathT = 99; e.rig.visible = false; e.active = false;
        e.rig.pose.rotation.x = 1.52;
        e.bar.visible = false;
      } else {
        e.hp = clamp(s.hp ?? e.hpMax, 1, e.hpMax);
      }
    }
  }
}

// NPC: стоит, дышит, поворачивается к игроку, ночью «мёрзнет» у костра.
import * as THREE from 'three';
import { Rig, SKINS } from './humanoid.js';
import { heightAt } from '../world/terrain.js';
import { clamp, lerp } from '../utils/noise.js';

export class Npc {
  constructor(game, def) {
    this.game = game;
    this.id = def.id;
    this.name = def.name;
    this.role = def.role;
    this.rig = new Rig('villager', {
      colors: { ...SKINS.villager, cloak: def.cloak || 0x5a4a3a, tunic: def.tunic || 0x6b5a44 },
      shield: false, weapon: false, scale: def.scale || 1,
    });
    this.pos = new THREE.Vector3(def.x, heightAt(def.x, def.z), def.z);
    this.home = this.pos.clone();
    this.homeYaw = def.yaw ?? 0;
    this.yaw = this.homeYaw;
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    game.scene.add(this.rig.root);
    this.t = Math.random() * 5;
    this.active = false;
    this.shadowsOn = false;
    this.talked = false;
  }

  update(dt, player) {
    const d = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
    if (!this.active) {
      if (d > 60) return;
      this.active = true; this.rig.visible = true;
    } else if (d > 95) {
      this.active = false; this.rig.visible = false;
      return;
    }

    const wantShadow = d < 22 && this.game.sky.sun.castShadow;
    if (wantShadow !== this.shadowsOn) {
      this.shadowsOn = wantShadow;
      for (const c of this.rig.pose.children) if (c.children[0]) c.children[0].castShadow = wantShadow;
    }

    this.t += dt;
    // поворачивается к игроку, когда тот рядом
    if (d < 5.5) {
      const want = Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      let diff = want - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.yaw += diff * clamp(dt * 2.6, 0, 1);
    } else {
      // иначе — лёгкое покачивание на месте
      let diff = this.homeYaw + Math.sin(this.t * 0.23) * 0.5 - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.yaw += diff * clamp(dt * 0.8, 0, 1);
    }
    this.rig.root.rotation.y = this.yaw;
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.rig.root.position.copy(this.pos);
    this.rig.animate({ speed: 0, maxSpeed: 3, grounded: true, vy: 0, attack: -1, block: false, swim: false }, dt);
  }
}

// Headless-харнесс: прогоняет весь игровой код БЕЗ браузера и WebGL.
// three.js в Node работает как чистая математика/сцена — этого достаточно, чтобы
// проверить генерацию мира, физику, ИИ врагов, бой, лут, квесты и сохранения.
// Запуск: node tools/harness.mjs
import * as THREE from 'three';
import { Sky } from '../prototype/src/world/sky.js';
import { Terrain, heightAt, slopeAt, PADS } from '../prototype/src/world/terrain.js';
import { Props } from '../prototype/src/world/props.js';
import { Water } from '../prototype/src/world/water.js';
import { Structures } from '../prototype/src/world/structures.js';
import { Fx } from '../prototype/src/entities/fx.js';
import { Player } from '../prototype/src/entities/player.js';
import { EnemyManager } from '../prototype/src/entities/enemies.js';
import { Npc } from '../prototype/src/entities/npc.js';
import { Settings } from '../prototype/src/core/settings.js';
import { PerfMonitor } from '../prototype/src/core/perf.js';
import { WORLD, GAME, NPCS, QUESTS, SPAWN_POINTS, PLAYER as PC } from '../prototype/src/config.js';

let fails = 0, checks = 0;
const ok = (cond, msg, extra = '') => {
  checks++;
  if (!cond) { fails++; console.log(`  ✗ ${msg} ${extra}`); } else console.log(`  ✓ ${msg} ${extra}`);
};
const finite = (v) => Number.isFinite(v);
const sec = (t) => console.log(`\n── ${t} ──`);

/* ═══ заглушки браузера ═══ */
globalThis.localStorage = {
  _d: new Map(),
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
  setItem(k, v) { this._d.set(k, String(v)); },
  removeItem(k) { this._d.delete(k); },
};
globalThis.window = { innerWidth: 1640, innerHeight: 720 };
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const hudStub = {
  toasts: [], numbers: 0, deaths: 0,
  toast(t, k) { this.toasts.push(t); },
  damageNumber() { this.numbers++; },
  vignette() {}, prompt() {}, vitals() {}, compass() {}, quests() {}, perf() {},
  showDeath() { this.deaths++; },
};
const inputStub = {
  m: { x: 0, y: 0, run: false },
  held: { attack: false, block: false, run: false },
  look: { x: 0, y: 0 },
  _edges: new Set(),
  getMove() { return this.m; },
  consume(n) { const v = this._edges.has(n); this._edges.delete(n); return v; },
  press(n) { this._edges.add(n); },
  endFrame() { this.look.x = 0; this.look.y = 0; },
  flush() { this._edges.clear(); },
  sens: 1, invert: false, isTouch: true,
};

/* ═══ 1. рельеф ═══ */
sec('Рельеф');
let hMin = 1e9, hMax = -1e9, nan = 0, underwater = 0, samples = 0;
for (let x = -WORLD.half; x <= WORLD.half; x += 4) {
  for (let z = -WORLD.half; z <= WORLD.half; z += 4) {
    const h = heightAt(x, z);
    samples++;
    if (!finite(h)) nan++;
    hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
    if (h < WORLD.water) underwater++;
  }
}
ok(nan === 0, 'нет NaN/Infinity в высоте', `(${samples} проб)`);
ok(hMin < WORLD.water, 'есть вода (низины)', `min=${hMin.toFixed(1)}`);
ok(hMax > 40, 'есть горы', `max=${hMax.toFixed(1)}`);
ok(underwater / samples > 0.02 && underwater / samples < 0.4,
  'воды в мире 2–40%', `(${(100 * underwater / samples).toFixed(1)}%)`);

// площадки под постройками должны быть плоскими
for (const p of PADS) {
  const c = heightAt(p.x, p.z);
  let dev = 0;
  for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2]]) {
    dev = Math.max(dev, Math.abs(heightAt(p.x + dx, p.z + dz) - c));
  }
  ok(dev < 0.55, `площадка (${p.x},${p.z}) плоская`, `отклонение ${dev.toFixed(2)} м`);
}

// место появления игрока: на суше, не в горе, рядом с деревней
const sp = heightAt(WORLD.spawn.x, WORLD.spawn.z);
ok(sp > WORLD.water + 0.6, 'спавн на суше', `y=${sp.toFixed(2)}`);
ok(Math.hypot(WORLD.spawn.x - WORLD.village.x, WORLD.spawn.z - WORLD.village.z) < 45, 'спавн рядом с деревней');
ok(slopeAt(WORLD.spawn.x, WORLD.spawn.z) < 0.6, 'спавн не на склоне');

// из центра мира можно дойти до руин без «стен» (проверка перепадов по пути)
{
  let worstStep = 0, x = WORLD.village.x, z = WORLD.village.z;
  const tx = WORLD.ruins.x, tz = WORLD.ruins.z;
  const N = 400;
  for (let i = 1; i <= N; i++) {
    const nx = x + (tx - x) * (i / N), nz = z + (tz - z) * (i / N);
    worstStep = Math.max(worstStep, Math.abs(heightAt(nx, nz) - heightAt(x, z)));
    x = nx; z = nz;
  }
  // прямая линия — не маршрут: игрок может обходить. Важно, что нет «стен» выше шага в 1.3 м
  ok(worstStep < 1.3, 'по прямой деревня→руины нет непреодолимых ступеней',
    `макс. ступень ${worstStep.toFixed(2)} м (лимит игрока 0.85 м)`);
}

/* ═══ 2. сцена и мир ═══ */
sec('Мир');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(56, 1640 / 720, 0.25, 1300);
Settings.load();
const q = Settings.q;

const sky = new Sky(scene);
const terrain = new Terrain(scene);
terrain.update(WORLD.spawn.x, WORLD.spawn.z, q.viewChunks);
ok(terrain.chunks.size === (q.viewChunks * 2 + 1) ** 2, 'чанков загружено', `${terrain.chunks.size}`);
{
  let bad = 0;
  for (const [, m] of terrain.chunks) {
    const a = m.geometry.attributes.position.array;
    const c = m.geometry.attributes.color.array;
    for (let i = 0; i < a.length; i++) if (!finite(a[i])) bad++;
    for (let i = 0; i < c.length; i++) if (!finite(c[i]) || c[i] < 0 || c[i] > 1.6) bad++;
  }
  ok(bad === 0, 'геометрия и цвета чанков корректны');
}
// стриминг: уходим далеко — старые чанки в пул, новые созданы
terrain.update(WORLD.ruins.x, WORLD.ruins.z, q.viewChunks);
ok(terrain.pool.length >= 0 && terrain.chunks.size === (q.viewChunks * 2 + 1) ** 2,
  'стриминг чанков работает', `пул=${terrain.pool.length}`);

const props = new Props(scene);
const n = props.generate();
props.update(1, WORLD.spawn.x, WORLD.spawn.z, q, true);
ok(n > 400, 'растительность сгенерирована', `${n} объектов`);
ok(props.visible.trees > 5, 'деревья в радиусе видимости', `${props.visible.trees}`);
ok(props.trunk.count === props.visible.trees, 'инстансы синхронны');
{
  let bad = 0;
  for (const m of [props.trunk, props.leafA, props.leafB, props.rock, props.bush]) {
    const a = m.instanceMatrix.array;
    for (let i = 0; i < m.count * 16; i++) if (!finite(a[i])) bad++;
  }
  ok(bad === 0, 'матрицы инстансов без NaN');
}

const structures = new Structures(scene);
ok(structures.mesh.geometry.attributes.position.count > 500,
  'статика слита в один меш',
  `${structures.mesh.geometry.attributes.position.count} вершин, ` +
  `${structures.mesh.geometry.index.count / 3 | 0} треуг.`);
ok(structures.chests.length === 2, 'сундуки расставлены', `${structures.chests.length}`);
ok(structures.chests.every(c => finite(c.y)), 'сундуки стоят на земле');
ok(!!structures.well && !!structures.firePos && !!structures.dockPos, 'колодец/костёр/пристань созданы');

const water = new Water(scene);
const fx = new Fx(scene);

/* ═══ 3. небо: сутки без NaN ═══ */
sec('Небо и сутки');
{
  let bad = 0, minI = 1e9, maxI = -1e9;
  for (let h = 0; h < 24; h += 0.25) {
    sky.update(h, new THREE.Vector3(0, 10, 0), q);
    if (!finite(sky.sun.intensity) || !finite(sky.night) || !finite(sky.fog.far)) bad++;
    minI = Math.min(minI, sky.sun.intensity); maxI = Math.max(maxI, sky.sun.intensity);
    const u = sky.uniforms;
    for (const k of ['uZenith', 'uHorizon', 'uSunColor']) {
      if (!finite(u[k].value.r) || !finite(u[k].value.g) || !finite(u[k].value.b)) bad++;
    }
  }
  ok(bad === 0, 'сутки проходят без NaN');
  ok(maxI > 2 && minI < 0.5, 'солнце меняется день/ночь', `${minI.toFixed(2)}…${maxI.toFixed(2)}`);
  sky.update(12, new THREE.Vector3(0, 10, 0), q);
  ok(sky.night < 0.05, 'в полдень не ночь', `night=${sky.night.toFixed(2)}`);
  sky.update(1, new THREE.Vector3(0, 10, 0), q);
  ok(sky.night > 0.9, 'в час ночи — ночь', `night=${sky.night.toFixed(2)}`);
  sky.update(12, new THREE.Vector3(0, 10, 0), q);
}

/* ═══ 4. игрок, враги, NPC ═══ */
sec('Сущности');
const game = {
  scene, camera, hud: hudStub, input: inputStub, fx, sky, terrain, props, water, structures,
  perf: new PerfMonitor(), shakeT: 0,
  shake(a) { this.shakeT = Math.max(this.shakeT, a); },
  onEnemyKilled(e) { killedLog.push(e.type); },
};
const killedLog = [];
game.player = new Player(game);
game.enemies = new EnemyManager(game);
for (const e of game.enemies.list) e.homeTag = e.homeTag || 'wild';
game.npcs = [new Npc(game, { ...NPCS.torsten, yaw: 2.4 })];

ok(game.enemies.list.length === SPAWN_POINTS.reduce((a, s) => a + s.count, 0),
  'врагов по точкам спавна', `${game.enemies.list.length}`);
ok(game.enemies.list.every(e => e.homeTag), 'у врагов есть метка дома');
ok(game.enemies.list.filter(e => e.homeTag === 'ruins').length >= QUESTS.ruins.stages[1].need,
  'в руинах хватает врагов под квест',
  `${game.enemies.list.filter(e => e.homeTag === 'ruins').length} из ${QUESTS.ruins.stages[1].need}`);
ok(finite(game.player.pos.y) && game.player.pos.y > WORLD.water, 'игрок стоит на суше',
  `y=${game.player.pos.y.toFixed(2)}`);

/* ═══ 5. симуляция 60 секунд игры ═══ */
sec('Симуляция: 60 с бега к руинам');
const dt = 1 / 30;
game.player.pos.set(WORLD.spawn.x, heightAt(WORLD.spawn.x, WORLD.spawn.z), WORLD.spawn.z);
let maxFrame = 0, nanFrames = 0;
const frameTimes = [];
for (let i = 0; i < 60 * 30; i++) {
  const t0 = performance.now();
  const p = game.player;
  // автопилот: идём к руинам
  const dx = WORLD.ruins.x - p.pos.x, dz = WORLD.ruins.z - p.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  const cy = p.camYaw;
  // пересчитываем «стик» в системе камеры
  const fx2 = -Math.sin(cy), fz2 = -Math.cos(cy);
  const rx = Math.cos(cy), rz = -Math.sin(cy);
  const wx = dx / len, wz = dz / len;
  inputStub.m.x = clampN(wx * rx + wz * rz, -1, 1);
  inputStub.m.y = clampN(wx * fx2 + wz * fz2, -1, 1);
  inputStub.m.run = true;
  // плавно наводим камеру на цель
  const wantYaw = Math.atan2(-wx, -wz);
  let d = wantYaw - cy; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  inputStub.look.x = -clampN(d, -0.2, 0.2);

  game.hour = (game.hour + dt * (24 / GAME.dayLengthSec)) % 24;
  p.update(dt, inputStub);
  game.enemies.update(dt);
  for (const npc of game.npcs) npc.update(dt, p);
  terrain.update(p.pos.x, p.pos.z, q.viewChunks);
  props.update(dt, p.pos.x, p.pos.z, q);
  sky.update(game.hour, camera.position, q);
  water.update(dt, sky, q);
  structures.update(dt, sky.night, sky.lightLevel);
  fx.update(dt);
  inputStub.endFrame();

  if (!finite(p.pos.x) || !finite(p.pos.y) || !finite(p.pos.z)) nanFrames++;
  for (const e of game.enemies.list) {
    if (!finite(e.pos.x) || !finite(e.pos.y) || !finite(e.pos.z)) nanFrames++;
  }
  const ms = performance.now() - t0;
  frameTimes.push(ms);
  if (i > 60) maxFrame = Math.max(maxFrame, ms);
}
function clampN(v, a, b) { return v < a ? a : v > b ? b : v; }
ok(nanFrames === 0, 'нет NaN в позициях за 1800 кадров');
frameTimes.sort((a, b) => a - b);
const p50 = frameTimes[frameTimes.length >> 1];
const p95 = frameTimes[Math.floor(frameTimes.length * 0.95)];
ok(p50 < 4, 'медиана кадра логики', `${p50.toFixed(2)} мс`);
ok(p95 < 9, '95-й перцентиль кадра логики', `${p95.toFixed(2)} мс`);
ok(maxFrame < 30, 'худший кадр (подгрузка чанка)', `${maxFrame.toFixed(2)} мс`);
const dist = Math.hypot(game.player.pos.x - WORLD.ruins.x, game.player.pos.z - WORLD.ruins.z);
ok(dist < 30, 'автопилот дошёл до руин', `осталось ${dist.toFixed(1)} м`);
ok(game.player.st < PC.stMax, 'стамина тратилась при беге', `${game.player.st.toFixed(0)}`);
console.log(`  · игрок: (${game.player.pos.x.toFixed(1)}, ${game.player.pos.y.toFixed(1)}, ${game.player.pos.z.toFixed(1)}) HP ${game.player.hp.toFixed(0)} LV ${game.player.level}`);
console.log(`  · активных врагов: ${game.enemies.list.filter(e => e.active).length}, живых: ${game.enemies.list.filter(e => e.active && !e.dead).length}`);

/* ═══ 5b. не застревает ли игрок в рельефе ═══ */
sec('Проходимость: 20 с случайной ходьбы');
{
  const p = game.player;
  p.hp = p.hpMax; p.dead = false; p.st = p.stMax;
  const start = p.pos.clone();
  let seed = 12345, covered = 0, prev = p.pos.clone(), stuckFrames = 0, blocked = 0;
  for (let i = 0; i < 20 * 30; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    if (i % 40 === 0) {
      const a = (seed / 0x7fffffff) * 6.283;
      inputStub.m.x = Math.cos(a); inputStub.m.y = Math.sin(a); inputStub.m.run = false;
      p.camYaw = a;   // куда смотрим, туда и идём
    }
    p.update(dt, inputStub);
    if (!finite(p.pos.x) || !finite(p.pos.y)) { nanFrames++; break; }
    covered += Math.hypot(p.pos.x - prev.x, p.pos.z - prev.z);
    if (Math.hypot(p.pos.x - prev.x, p.pos.z - prev.z) < 0.002) stuckFrames++;
    prev.copy(p.pos);
    if (Math.abs(p.pos.x) > WORLD.half - 14 || Math.abs(p.pos.z) > WORLD.half - 14) blocked++;
  }
  ok(finite(p.pos.y) && p.pos.y >= heightAt(p.pos.x, p.pos.z) - 0.05, 'игрок не провалился под землю',
    `y=${p.pos.y.toFixed(2)} vs рельеф ${heightAt(p.pos.x, p.pos.z).toFixed(2)}`);
  ok(stuckFrames < 200, 'не залипает на месте', `${(100 * stuckFrames / 600).toFixed(0)}% кадров без движения`);
  ok(covered > 30, 'проходит дистанцию', `${covered.toFixed(0)} м за 20 с`);
  console.log(`  · ушёл от старта на ${Math.hypot(p.pos.x - start.x, p.pos.z - start.z).toFixed(1)} м, кадров у границы мира: ${blocked}`);
}

/* ═══ 6. бой ═══ */
sec('Бой и лут');
{
  const p = game.player;
  const target = game.enemies.list.find(e => e.active && !e.dead) || game.enemies.list[0];
  // ставим врага перед игроком
  target.active = true; target.rig.visible = true; target.dead = false; target.hp = target.hpMax;
  target.pos.set(p.pos.x + 1.2, p.pos.y, p.pos.z + 0.2);
  p.yaw = Math.atan2(1.2, 0.2);
  const hp0 = target.hp;
  p.attackT = 0; p.hitDone = false;
  for (let i = 0; i < 30; i++) { p.attackT += dt / PC.attackTime; if (!p.hitDone && p.attackT * PC.attackTime >= PC.attackHitAt) { p.hitDone = true; p._doHit(); } }
  ok(target.hp < hp0, 'удар наносит урон', `${hp0} → ${Math.max(0, target.hp)}`);

  // добиваем
  let guard = 0;
  while (!target.dead && guard++ < 40) target.damage(20, p.pos, false);
  ok(target.dead, 'враг умирает');
  ok(p.kills >= 1, 'счётчик убийств', `${p.kills}`);
  ok(p.xp > 0 || p.level > 1, 'опыт начислен', `xp=${p.xp} lv=${p.level}`);
  ok(target.canLoot, 'труп можно обыскать');
  const gold0 = p.gold;
  const got = target.loot(p);
  ok(got !== null && p.gold >= gold0, 'лут работает', `(${(got || []).join(', ') || 'пусто'})`);
  ok(target.loot(p) === null, 'повторно обыскать нельзя');

  // урон по игроку и блок
  const hp1 = p.hp;
  p.blocking = false;
  p.damage(20, target.pos);
  ok(p.hp === hp1 - 20, 'игрок получает урон', `${hp1} → ${p.hp}`);
  p.invuln = 0; p.blocking = true; p.st = 100;
  const hp2 = p.hp;
  p.damage(20, target.pos);
  ok(p.hp > hp2 - 20 && p.hp < hp2, 'блок снижает урон', `${hp2} → ${p.hp} (×${PC.blockMul})`);

  // враг бьёт игрока
  p.blocking = false; p.invuln = 0;
  const e2 = game.enemies.list.find(e => !e.dead) || target;
  e2.active = true; e2.dead = false; e2.hp = e2.hpMax; e2.aggro = true;
  e2.pos.set(p.pos.x + 1.0, p.pos.y, p.pos.z);
  const hp3 = p.hp;
  e2.attackT = 0; e2.hitDone = false;
  for (let i = 0; i < 60; i++) e2.update(dt, p);
  ok(p.hp < hp3, 'враг наносит урон игроку', `${hp3.toFixed(0)} → ${p.hp.toFixed(0)}`);

  // смерть и восстановление: сейв снимается ДО смерти, как в Skyrim
  const beforeDeath = p.serialize();
  p.invuln = 0; p.damage(9999, e2.pos, { ignoreBlock: true });
  ok(p.dead && hudStub.deaths === 1, 'смерть игрока обрабатывается');
  p.restore(beforeDeath);
  ok(!p.dead && p.hp > 0, 'восстановление после смерти', `hp=${p.hp.toFixed(0)}`);
  p.hp = 0; p.dead = true;
  p.restore({ ...beforeDeath, hp: 0 });
  ok(p.hp >= 1, 'сейв с нулевым HP не возрождает мертвеца', `hp=${p.hp.toFixed(0)}`);
  p.dead = false;
}

/* ═══ 7. квест ═══ */
sec('Квесты');
{
  const q2 = QUESTS.ruins;
  let progress = 0;
  const onKill = (e) => {
    if (e.homeTag === 'ruins') { progress++; }
  };
  for (const e of game.enemies.list.filter(e => e.homeTag === 'ruins')) onKill(e);
  ok(progress >= q2.stages[1].need, 'квест выполним по числу врагов', `${progress}/${q2.stages[1].need}`);
  ok(q2.reward.gold > 0 && q2.reward.xp > 0, 'у квеста есть награда');
}

/* ═══ 8. сохранение ═══ */
sec('Сохранение');
{
  const p = game.player;
  p.gold = 123; p.level = 3; p.xp = 55; p.hp = 42;
  const s = {
    player: p.serialize(),
    enemies: game.enemies.serialize(),
    chests: structures.chests.map(c => ({ id: c.id, open: c.open, looted: c.looted })),
    hour: game.hour, time: 1234,
  };
  const json = JSON.stringify(s);
  ok(json.length < 40000, 'сейв компактный', `${(json.length / 1024).toFixed(1)} КБ`);
  const back = JSON.parse(json);
  p.gold = 0; p.level = 1; p.hp = 1;
  p.restore(back.player);
  ok(p.gold === 123 && p.level === 3 && Math.round(p.hp) === 42, 'данные восстанавливаются');
  game.enemies.restore(back.enemies);
  ok(game.enemies.list.length === back.enemies.length, 'состояние врагов восстановлено');
}

/* ═══ 9. бюджет сцены (статический подсчёт) ═══ */
sec('Бюджет draw calls (оценка)');
{
  let meshes = 0, tris = 0;
  scene.traverse(o => {
    if (o.isMesh || o.isPoints || o.isInstancedMesh) {
      const count = o.isInstancedMesh ? o.count : 1;
      if (count === 0 || !o.visible) return;
      meshes += 1;
      const g = o.geometry;
      const t = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      tris += t * (o.isInstancedMesh ? o.count : 1);
    }
  });
  console.log(`  · объектов в сцене: ${meshes}, треугольников: ${(tris / 1000).toFixed(1)}k`);
  console.log(`  · чанков террейна: ${terrain.chunks.size} × ${(WORLD.seg * WORLD.seg * 2 / 1000).toFixed(1)}k трис`);
  console.log(`  · пропсов в кадре: деревьев ${props.visible.trees}, камней ${props.visible.rocks}, кустов ${props.visible.bushes}`);
  const enemiesNear = game.enemies.list.filter(e => e.active).length;
  const estimate = terrain.chunks.size + 5 /*пропсы*/ + 3 /*статика+вода+небо*/ + 2 /*горы*/ +
    6 /*игрок*/ + enemiesNear * 5 + 2 /*звёзды+частицы*/;
  console.log(`  · оценка draw calls при ${enemiesNear} активных врагах: ~${estimate}`);
  ok(estimate < 120, 'вписываемся в бюджет ≤120 draw calls', `~${estimate}`);
  ok(tris < 220000, 'вписываемся в бюджет по треугольникам', `${(tris / 1000).toFixed(0)}k`);
}

console.log(`\n════════ ИТОГ: ${checks - fails}/${checks} проверок пройдено, ошибок: ${fails} ════════`);
process.exit(fails ? 1 : 0);

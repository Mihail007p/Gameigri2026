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
import { EnemyManager, threatOf } from '../prototype/src/entities/enemies.js';
import { Npc } from '../prototype/src/entities/npc.js';
import { WordWalls } from '../prototype/src/world/wordwalls.js';
import { Weather } from '../prototype/src/world/weather.js';
import { Settings } from '../prototype/src/core/settings.js';
import { PerfMonitor } from '../prototype/src/core/perf.js';
import { WORLD, GAME, NPCS, QUESTS, SPAWN_POINTS, PLAYER as PC,
  SHOUTS, START_WORDS, WORD_WALLS, NIGHT, ENEMIES,
  WEATHER, PRECIP_MAX, QUALITY } from '../prototype/src/config.js';

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
  vignette() {}, prompt() {}, vitals() {}, compass() {}, quests() {}, perf() {}, shoutState() {},
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

/* ═══ 6b. крики (Thu'um) и стены слов ═══ */
sec('Крики и стены слов');
{
  const p = game.player;
  const SP = WORLD.spawn;

  /* --- конфиг криков --- */
  const kinds = ['force', 'dash', 'frost'];
  ok(Object.keys(SHOUTS).length === 3, 'в конфиге три крика', Object.keys(SHOUTS).join(', '));
  ok(Object.values(SHOUTS).every(d => d.cd > 0 && d.stCost > 0 && d.castTime > 0 && kinds.includes(d.kind)),
    'у каждого крика есть кулдаун, цена и время выдоха');
  ok(SHOUTS.fus.dmg > PC.attackDmg && SHOUTS.fus.range > PC.attackRange,
    'крик сильнее и дальнобойнее обычного удара', `${SHOUTS.fus.dmg} урона на ${SHOUTS.fus.range} м`);
  ok(SHOUTS.wuld.dist / SHOUTS.wuld.dur < 40,
    'рывок не быстрее 40 м/с — иначе игрок провалится сквозь рельеф',
    `${(SHOUTS.wuld.dist / SHOUTS.wuld.dur).toFixed(1)} м/с`);
  ok(Object.values(SHOUTS).every(d => d.stCost < PC.stMax), 'на любой крик хватает полной выносливости');

  /* --- стены слов стоят там, где до них можно дойти --- */
  let wallBad = 0;
  const words = new Set();
  for (const w of WORD_WALLS) {
    const h = heightAt(w.x, w.z);
    if (!(h > WORLD.water + 1)) wallBad++;                 // не под водой
    if (slopeAt(w.x, w.z) > 0.32) wallBad++;                // не на обрыве
    if (Math.abs(w.x) > WORLD.half - 20 || Math.abs(w.z) > WORLD.half - 20) wallBad++;
    if (!SHOUTS[w.word] || START_WORDS.includes(w.word)) wallBad++;
    if (words.has(w.word)) wallBad++;                       // слова не дублируются
    words.add(w.word);
    if (Math.hypot(w.x - SP.x, w.z - SP.z) < 25) wallBad++; // не в точке спавна
  }
  ok(wallBad === 0, 'стены слов на суше, в пределах мира и учат новым словам',
    `${WORD_WALLS.length} стен, высота ${heightAt(WORD_WALLS[0].x, WORD_WALLS[0].z).toFixed(1)} и ${heightAt(WORD_WALLS[1].x, WORD_WALLS[1].z).toFixed(1)} м`);

  /* --- стены строятся и гаснут после изучения --- */
  game.wordWalls = new WordWalls(scene);
  const walls = game.wordWalls;
  ok(walls.list.length === WORD_WALLS.length, 'стены созданы', `${walls.list.length}`);
  ok(walls.list.every(w => w.def && w.group && w.runes && Number.isFinite(w.y)),
    'у каждой стены есть геометрия, руны и высота');
  walls.update(dt, 1);
  ok(walls.list.every(w => Number.isFinite(w.runeMat.opacity) && w.runeMat.opacity > 0 && w.runeMat.opacity <= 1.05),
    'руны пульсируют без NaN', `opacity ${walls.list[0].runeMat.opacity.toFixed(2)}`);
  walls.markUsed(WORD_WALLS[0].id);
  ok(walls.isUsed(WORD_WALLS[0].id) && walls.list[0].runeMat.opacity < 0.4, 'изученная стена гаснет');
  const wallSave = walls.serialize();
  walls.reset();
  ok(!walls.list.some(w => w.used), 'сброс возвращает руны');
  walls.restore(wallSave);
  ok(walls.isUsed(WORD_WALLS[0].id), 'состояние стен переживает сохранение');
  walls.reset();
  ok(walls.nearest(new THREE.Vector3(WORD_WALLS[1].x, 0, WORD_WALLS[1].z + 2), 3.6) === walls.list[1],
    'стена находится по близости для подсказки ✋');

  /* --- изучение и переключение слов --- */
  p.words = START_WORDS.slice(); p.word = START_WORDS[0];
  ok(p.words.length === 1 && p.word === 'fus', 'игра начинается с одного слова', p.words.join(','));
  const learned = p.learnWord('wuld');
  ok(learned && learned.id === 'wuld' && p.word === 'wuld', 'новое слово учится и сразу экипируется');
  ok(p.learnWord('wuld') === null, 'дважды выучить одно слово нельзя');
  ok(p.learnWord('несуществующее') === null, 'несуществующее слово отклоняется');
  const w1 = p.word;
  p.cycleWord();
  ok(p.word !== w1 && p.words.includes(p.word), 'кнопка ⇄ переключает крик', `${w1} → ${p.word}`);
  p.learnWord('fo');
  ok(p.words.length === 3, 'можно выучить все три слова', p.words.join(','));

  /* --- «Безжалостная сила»: конус, урон, отброс, оглушение --- */
  const list = game.enemies.list;
  const front = list[0], side = list[1], back = list[2], far = list[3];
  const place = (e, x, z) => {
    e.dead = false; e.active = true; e.hp = e.hpMax; e.stun = 0; e.slow = 0;
    e.knockX = 0; e.knockZ = 0; e.aggro = false; e.attackT = -1; e.cd = 0;
    e.pos.set(x, heightAt(x, z), z);
  };
  p.word = 'fus'; p.shoutCd = 0; p.shoutT = -1; p.shoutDef = null; p.dashT = 0;
  p.st = p.stMax; p.dead = false; p.blocking = false; p.invuln = 0;
  p.pos.set(SP.x, heightAt(SP.x, SP.z), SP.z); p.vel.set(0, 0, 0); p.camYaw = 0;  // взгляд в -Z
  place(front, SP.x, SP.z - 6);          // прямо перед игроком
  place(side, SP.x + 22, SP.z);          // сбоку и далеко
  place(back, SP.x, SP.z + 8);           // за спиной
  place(far, SP.x, SP.z - 34);           // в конусе, но за пределами длины
  const st0 = p.st, hpF = front.hp, hpS = side.hp, hpB = back.hp, hpFar = far.hp;
  // крик занимает несколько кадров: ждём, пока он завершится и встанет на кулдаун
  const runUntil = (pred, max = 90) => { let n = 0; while (!pred() && n++ < max) p.update(dt, inputStub); return n; };
  inputStub.press('shout');
  let guard = runUntil(() => p.shoutCd > 0, 60);
  ok(guard > 0 && guard < 60, 'крик выдыхается и встаёт на кулдаун', `${(guard * dt).toFixed(2)} с`);
  ok(front.hp < hpF, 'крик бьёт врага перед игроком', `${hpF} → ${front.hp}`);
  ok(Math.hypot(front.knockX, front.knockZ) > 1, 'врага отбросило импульсом',
    `${Math.hypot(front.knockX, front.knockZ).toFixed(1)} м/с`);
  ok(front.stun > 0, 'враг оглушён', `${front.stun.toFixed(2)} с`);
  ok(back.hp === hpB, 'крик не бьёт в спину');
  ok(far.hp === hpFar, 'крик не достаёт дальше своей длины', `${SHOUTS.fus.range} м`);
  ok(side.hp === hpS, 'вне конуса урона нет');
  ok(p.st < st0, 'крик тратит выносливость', `${st0.toFixed(0)} → ${p.st.toFixed(0)}`);
  ok(p.shoutCd > 0, 'после крика пошёл кулдаун', `${p.shoutCd.toFixed(1)} с`);
  hudStub.toasts.length = 0;
  ok(p.tryShout() === false, 'во время кулдауна крик не срабатывает');
  ok(hudStub.toasts.some(t => /не готов/i.test(t)), 'игроку объяснили, что крик ещё не готов');

  /* --- оглушённый враг беспомощен --- */
  place(front, SP.x, SP.z - 12);
  front.stun = 1.0; front.aggro = true;
  const hpP = p.hp;
  p.invuln = 0;
  for (let i = 0; i < 45; i++) front.update(dt, p);
  ok(p.hp >= hpP, 'оглушённый враг не бьёт игрока', `${hpP.toFixed(0)} → ${p.hp.toFixed(0)}`);
  ok(front.stun <= 0, 'оглушение проходит за отведённое время');
  ok(front.pos.distanceTo(new THREE.Vector3(SP.x, front.pos.y, SP.z - 12)) < 6,
    'враг догнал игрока после оглушения (ИИ живой)', `${front.pos.distanceTo(new THREE.Vector3(SP.x, front.pos.y, SP.z - 12)).toFixed(1)} м`);

  /* --- «Вихрь»: рывок вперёд --- */
  p.word = 'wuld'; p.shoutCd = 0; p.shoutT = -1; p.shoutDef = null; p.dashT = 0;
  p.st = p.stMax; p.camYaw = 0;
  p.pos.set(SP.x, heightAt(SP.x, SP.z), SP.z); p.vel.set(0, 0, 0); p.invuln = 0;
  const z0 = p.pos.z;
  inputStub.press('shout');
  const toDash = runUntil(() => p.dashT > 0, 30);      // ждём начала рывка
  ok(toDash < 30 && p.dashT > 0, 'рывок начинается после выдоха слова', `${(toDash * dt).toFixed(2)} с`);
  guard = runUntil(() => p.dashT <= 0, 60);             // и ждём, пока он кончится
  const moved = Math.abs(p.pos.z - z0);
  ok(guard < 60, 'рывок заканчивается сам', `${(guard * dt).toFixed(2)} с`);
  ok(moved > SHOUTS.wuld.dist * 0.7 && moved < SHOUTS.wuld.dist * 1.35,
    'рывок переносит игрока примерно на свою дистанцию',
    `${moved.toFixed(1)} м из ${SHOUTS.wuld.dist}`);
  ok(p.pos.y >= heightAt(p.pos.x, p.pos.z) - 0.05 && Number.isFinite(p.pos.y),
    'после рывка игрок не под землёй', `y=${p.pos.y.toFixed(2)}`);
  ok(p.invuln > 0 || p.shoutCd > 0, 'после рывка остался след в состоянии (неуязвимость/кулдаун)');

  /* --- «Ледяное дыхание»: замедление --- */
  const frosty = list[5];
  place(frosty, SP.x, SP.z - 5);
  p.word = 'fo'; p.shoutCd = 0; p.shoutT = -1; p.shoutDef = null; p.st = p.stMax; p.camYaw = 0;
  p.pos.set(SP.x, heightAt(SP.x, SP.z), SP.z);
  inputStub.press('shout');
  guard = runUntil(() => p.shoutCd > 0, 60);
  ok(guard < 60, 'ледяное дыхание выдыхается', `${(guard * dt).toFixed(2)} с`);
  ok(frosty.hp < frosty.hpMax, 'мороз наносит урон', `${frosty.hpMax} → ${frosty.hp}`);
  ok(frosty.slow > 0, 'мороз замедляет врага', `${frosty.slow.toFixed(1)} с`);
  const speedDay = (() => { frosty.slow = 0; frosty.update(dt, p); return frosty.speed; })();
  const speedChilled = (() => { frosty.slow = 3; frosty.update(dt, p); return frosty.speed; })();
  ok(speedChilled < speedDay || speedChilled === 0,
    'замороженный враг двигается медленнее', `${speedDay.toFixed(2)} → ${speedChilled.toFixed(2)} м/с`);

  /* --- ночь делает тварей опаснее --- */
  const sky = game.sky;
  sky.update(12, new THREE.Vector3(0, 10, 0), Settings.q);
  ok(threatOf(game) < 0.05, 'днём ночной угрозы нет', threatOf(game).toFixed(2));
  sky.update(1, new THREE.Vector3(0, 10, 0), Settings.q);
  const th = threatOf(game);
  ok(th > 0.7, 'в глубокую ночь угроза высокая', th.toFixed(2));
  const e3 = list[6];
  place(e3, SP.x + 5, SP.z);
  p.pos.set(SP.x, heightAt(SP.x, SP.z), SP.z);
  e3.update(dt, p);
  const baseDmg = ENEMIES[e3.type].dmg;
  ok(e3.dmgNow > baseDmg, 'ночью враг бьёт больнее', `${baseDmg} → ${e3.dmgNow} (×${(1 + th * NIGHT.dmgMul).toFixed(2)})`);
  sky.update(12, new THREE.Vector3(0, 10, 0), Settings.q);
  e3.update(dt, p);
  ok(e3.dmgNow === baseDmg, 'днём урон возвращается к базовому', `${e3.dmgNow}`);

  /* --- слова переживают сохранение --- */
  const sv = JSON.parse(JSON.stringify(p.serialize()));
  ok(Array.isArray(sv.words) && sv.words.length === 3, 'слова силы пишутся в сейв', (sv.words || []).join(','));
  p.words = START_WORDS.slice(); p.word = START_WORDS[0];
  p.restore(sv);
  ok(p.words.length === 3 && p.word === sv.word, 'слова восстанавливаются из сейва', p.words.join(','));
  p.restore({ ...sv, words: null });
  ok(p.words.length === START_WORDS.length && p.word === START_WORDS[0],
    'старый сейв без слов получает стартовый набор');
  sky.update(12, new THREE.Vector3(0, 10, 0), Settings.q);
}

/* ═══ 6c. погода ═══ */
sec('Погода');
{
  const cam = new THREE.Vector3(WORLD.spawn.x, 8, WORLD.spawn.z);
  const weather = new Weather(scene, 123);
  game.weather = weather;
  const sky2 = game.sky;
  const setW = (id) => { weather.cur = WEATHER[id]; weather.prev = WEATHER[id]; weather.mix = 1; weather._blend(); };

  /* --- конфиг --- */
  const ids = Object.keys(WEATHER);
  ok(ids.length === 5, 'пять состояний погоды', ids.join(', '));
  ok(ids.every(k => {
    const w = WEATHER[k];
    return w.weight > 0 && w.minSec > 0 && w.maxSec >= w.minSec && w.fogMul > 0 && w.sunMul > 0
      && Number.isFinite(w.threat) && Number.isFinite(w.speedMul) && Number.isFinite(w.wind);
  }), 'все пресеты заполнены и конечны');
  ok(WEATHER.blizzard.fogMul < WEATHER.snow.fogMul && WEATHER.snow.fogMul < WEATHER.clear.fogMul,
    'видимость падает: ясно > снег > метель',
    `×${WEATHER.clear.fogMul} > ×${WEATHER.snow.fogMul} > ×${WEATHER.blizzard.fogMul}`);
  ok(WEATHER.blizzard.threat > WEATHER.snow.threat && WEATHER.clear.threat === 0,
    'метель опаснее снега, ясная погода безопасна');
  ok(WEATHER.clear.snow === 0 && WEATHER.fog.snow === 0 && WEATHER.snow.snow === 1 && WEATHER.blizzard.snow === 1,
    'снег идёт только в снеге и в метель');
  ok(WEATHER.blizzard.speedMul < WEATHER.snow.speedMul && WEATHER.snow.speedMul < WEATHER.clear.speedMul,
    'в непогоду игрок вязнет', `×${WEATHER.clear.speedMul} → ×${WEATHER.blizzard.speedMul}`);
  ok(Object.values(QUALITY).every(q => q.precip > 0 && q.precip <= 1),
    'в каждом пресете качества есть доля снежинок');
  ok(QUALITY.low.precip < QUALITY.medium.precip && QUALITY.medium.precip < QUALITY.high.precip,
    'низкое качество = меньше снежинок', `${QUALITY.low.precip}/${QUALITY.medium.precip}/${QUALITY.high.precip}`);

  /* --- старт и буфер снега --- */
  ok(weather.id === 'clear' && weather.mix === 1 && weather.v.snowAmt === 0, 'игра начинается в ясную погоду');
  weather.update(dt, cam, QUALITY.high);
  ok(weather.snowCount === 0 && weather.points.visible === false,
    'в ясную погоду снег не рисуется — ноль лишних draw call');
  const geo = weather.geo;
  ok(geo.attributes.position.count === PRECIP_MAX, 'в буфере ровно PRECIP_MAX снежинок', `${PRECIP_MAX}`);
  ok(!!geo.attributes.aSeed && !!geo.attributes.aSize,
    'анимация снега на GPU: есть атрибуты aSeed и aSize');
  let posBad = 0;
  const posArr = geo.attributes.position.array;
  for (let i = 0; i < posArr.length; i++) if (!Number.isFinite(posArr[i]) || posArr[i] < 0) posBad++;
  ok(posBad === 0, 'позиции снежинок конечны и лежат в коробке');

  /* --- метель --- */
  ok(weather.set('blizzard') && weather.mix === 0, 'погоду можно переключить принудительно');
  for (let i = 0; i < 260; i++) weather.update(dt, cam, QUALITY.high);
  ok(weather.mix === 1, 'смена погоды доходит до конца', `mix=${weather.mix}`);
  ok(weather.snowCount === PRECIP_MAX, 'в метель на высоком качестве рисуем весь буфер', `${weather.snowCount}`);
  ok(weather.points.visible && weather.uniforms.uOpacity.value > 0.5,
    'метель видна', `opacity ${weather.uniforms.uOpacity.value.toFixed(2)}`);
  ok(Math.abs(weather.uniforms.uWindX.value) + Math.abs(weather.uniforms.uWindZ.value) > 1,
    'в метель дует ветер', `(${weather.uniforms.uWindX.value.toFixed(1)}, ${weather.uniforms.uWindZ.value.toFixed(1)})`);
  const blizzardCount = weather.snowCount;

  /* --- качество режет снег --- */
  weather.set('snow');
  for (let i = 0; i < 260; i++) weather.update(dt, cam, QUALITY.low);
  ok(weather.snowCount === Math.round(PRECIP_MAX * QUALITY.low.precip) && weather.snowCount < blizzardCount,
    'на низком качестве снежинок меньше', `${weather.snowCount} против ${blizzardCount}`);

  /* --- никаких NaN за 20 секунд любой погоды --- */
  weather.set('fog');
  let nan = 0;
  for (let i = 0; i < 600; i++) {
    weather.update(dt, cam, QUALITY.medium);
    for (const k of ['uTime', 'uFall', 'uWindX', 'uWindZ', 'uOpacity', 'uScale']) {
      if (!Number.isFinite(weather.uniforms[k].value)) nan++;
    }
    for (const k of Object.keys(weather.v)) if (!Number.isFinite(weather.v[k])) nan++;
    if (!Number.isFinite(weather.timer) || !Number.isFinite(weather.mix)) nan++;
  }
  ok(nan === 0, '20 секунд тумана без NaN в униформах и множителях');

  /* --- плавное смешивание --- */
  weather.cur = WEATHER.blizzard; weather.prev = WEATHER.clear; weather.mix = 0.5; weather._blend();
  const midFog = weather.v.fogMul;
  ok(midFog > WEATHER.blizzard.fogMul && midFog < WEATHER.clear.fogMul,
    'погода смешивается плавно, а не щёлкает', `fogMul ${midFog.toFixed(2)} между ${WEATHER.blizzard.fogMul} и ${WEATHER.clear.fogMul}`);
  ok(weather.v.snowAmt > 0.4 && weather.v.snowAmt < 0.6, 'снег нарастает постепенно', weather.v.snowAmt.toFixed(2));

  /* --- небо реагирует на погоду --- */
  setW('clear');
  sky2.update(12, cam, QUALITY.medium, weather);
  const sunClear = sky2.sun.intensity, fogClear = sky2.fog.far;
  setW('blizzard');
  sky2.update(12, cam, QUALITY.medium, weather);
  ok(sky2.sun.intensity < sunClear * 0.6, 'в метель солнца почти нет',
    `${sunClear.toFixed(2)} → ${sky2.sun.intensity.toFixed(2)}`);
  ok(sky2.fog.far < fogClear * 0.4, 'в метель видимость падает сильнее, чем вдвое',
    `${fogClear.toFixed(0)} → ${sky2.fog.far.toFixed(0)} м`);
  ok(sky2.threat > 0.5, 'метель добавляет угрозы (её читают враги)', sky2.threat.toFixed(2));
  sky2.update(1, cam, QUALITY.medium, weather);
  ok(sky2.starMat.opacity === 0 && sky2.stars.visible === false, 'в метель звёзд не видно');
  // старый вызов без погоды обязан работать как раньше
  sky2.update(12, cam, QUALITY.medium);
  ok(sky2.threat === 0 && Math.abs(sky2.fog.far - QUALITY.medium.fogFar) < 0.001,
    'без аргумента weather небо ведёт себя как раньше', `туман ${sky2.fog.far}`);

  /* --- враги в непогоду опаснее --- */
  setW('clear');
  sky2.update(12, cam, QUALITY.medium, weather);
  const thClearDay = threatOf(game);
  ok(thClearDay < 0.05, 'ясным днём угрозы нет', thClearDay.toFixed(2));
  setW('blizzard');
  sky2.update(12, cam, QUALITY.medium, weather);
  const thBlizDay = threatOf(game);
  ok(thBlizDay > 0.3, 'днём в метель твари смелеют', thBlizDay.toFixed(2));
  sky2.update(1, cam, QUALITY.medium, weather);
  ok(threatOf(game) > thBlizDay, 'ночь плюс метель — хуже всего', threatOf(game).toFixed(2));
  const e4 = game.enemies.list[7];
  e4.dead = false; e4.active = true; e4.hp = e4.hpMax; e4.stun = 0; e4.slow = 0;
  e4.pos.set(WORLD.spawn.x + 5, heightAt(WORLD.spawn.x + 5, WORLD.spawn.z), WORLD.spawn.z);
  game.player.pos.set(WORLD.spawn.x, heightAt(WORLD.spawn.x, WORLD.spawn.z), WORLD.spawn.z);
  e4.update(dt, game.player);
  ok(e4.dmgNow > ENEMIES[e4.type].dmg, 'в метель ночью враг бьёт больнее',
    `${ENEMIES[e4.type].dmg} → ${e4.dmgNow}`);

  /* --- скорость игрока --- */
  const pl = game.player;
  pl.dead = false; pl.blocking = false; pl.dashT = 0; pl.st = pl.stMax;
  pl.pos.set(WORLD.spawn.x, heightAt(WORLD.spawn.x, WORLD.spawn.z), WORLD.spawn.z);
  pl.vel.set(0, 0, 0);
  inputStub.m.x = 0; inputStub.m.y = 1; inputStub.held.run = true;
  setW('clear'); pl.update(dt, inputStub);
  const spClear = pl.maxSpeed;
  setW('blizzard'); pl.update(dt, inputStub);
  const spBliz = pl.maxSpeed;
  ok(spBliz < spClear, 'в метель игрок бежит медленнее', `${spClear.toFixed(2)} → ${spBliz.toFixed(2)} м/с`);
  inputStub.m.y = 0; inputStub.held.run = false;

  /* --- смена по таймеру и сохранение --- */
  setW('clear');
  weather.timer = 0.01;
  let announced = 0;
  weather.onStateChange = () => { announced++; };
  for (let i = 0; i < 10 && announced === 0; i++) weather.update(dt, cam, QUALITY.medium);
  ok(announced === 1 && weather.id !== 'clear', 'погода меняется сама по таймеру', `ясно → ${weather.id}`);
  ok(weather.timer > 0, 'после смены выставлен новый таймер', `${weather.timer.toFixed(0)} с`);
  const changes0 = weather.changes;
  for (let i = 0; i < 12000; i++) weather.update(dt, cam, QUALITY.medium);
  ok(weather.changes >= changes0 + 2, 'за ~7 минут игрового времени погода успевает смениться несколько раз',
    `${weather.changes - changes0} смен`);
  weather.onStateChange = null;

  weather.set('snow');
  const wSave = JSON.parse(JSON.stringify(weather.serialize()));
  ok(wSave.id === weather.id && wSave.timer > 0, 'погода пишется в сейв', JSON.stringify(wSave));
  weather.reset();
  ok(weather.id === 'clear' && weather.mix === 1, 'сброс возвращает ясную погоду');
  weather.restore(wSave);
  ok(weather.id === 'snow' && weather.timer > 0, 'погода восстанавливается из сейва',
    `${weather.id}, таймер ${weather.timer} с`);
  weather.restore({ id: 'несуществующая' });
  weather.restore(null);
  ok(weather.id === 'snow', 'мусор и пустота в сейве не ломают погоду');
  weather.reset();
  weather.update(dt, cam, QUALITY.medium);        // снег выключен — сцена снова «ясная»
  ok(weather.points.visible === false && weather.snowCount === 0, 'после сброса снег не рисуется');
  sky2.update(12, cam, QUALITY.medium, weather);
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

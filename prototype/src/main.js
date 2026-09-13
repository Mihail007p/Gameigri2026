// Точка входа: инициализация, загрузка мира, игровой цикл, квесты, диалоги, сохранения.
import * as THREE from 'three';
import { Settings } from './core/settings.js';
import { PerfMonitor } from './core/perf.js';
import { Input } from './core/input.js';
import { sfx } from './core/sfx.js';
import { Save } from './core/save.js';
import { Hud } from './ui/hud.js';
import { Sky } from './world/sky.js';
import { Terrain } from './world/terrain.js';
import { Props } from './world/props.js';
import { Water } from './world/water.js';
import { Structures } from './world/structures.js';
import { Fx } from './entities/fx.js';
import { Player } from './entities/player.js';
import { EnemyManager } from './entities/enemies.js';
import { Npc } from './entities/npc.js';
import { WordWalls } from './world/wordwalls.js';
import { GAME, WORLD, NPCS, QUESTS, PLAYER as PC, NIGHT } from './config.js';
import { clamp } from './utils/noise.js';

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

/* ══════════════════ базовые объекты ══════════════════ */
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: false, stencil: false, alpha: false,
  powerPreference: 'high-performance', preserveDrawingBuffer: false,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setClearColor(0x0b0f14, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(56, 1, 0.25, 1300);

const hud = new Hud();
const input = new Input();
const perf = new PerfMonitor();
const fx = new Fx(scene);

/** Общий контекст — все системы видят друг друга через него (без циклических импортов) */
const game = {
  scene, camera, renderer, hud, input, fx, perf,
  state: 'loading', hour: GAME.startHour, time: 0, titleT: 0,
  shakeT: 0, _clean: new THREE.Vector3(),
  npcs: [], target: null, autosave: 0, wellCd: 0,
  shake(a) { this.shakeT = Math.max(this.shakeT, a); },
  onEnemyKilled(e) { quest.onKill(e); },
  toast(t, k) { hud.toast(t, k); },
};
window.__game = game;   // для автотестов и отладки на телефоне

/** Сводка состояния — можно открыть в консоли телефона или прислать скриншотом */
window.__diag = () => {
  const g = game, r = g.renderer;
  const lines = [
    `Северный Край v${GAME.version} · ${new Date().toISOString()}`,
    `состояние: ${g.state} · время в игре ${Math.floor(g.time / 60)}:${String(Math.floor(g.time % 60)).padStart(2, '0')}`,
    `качество: ${Settings.q.name} / ${Settings.autoLabel} · renderScale ${Settings.renderScale.toFixed(2)}` +
      ` · буфер ${r.domElement.width}×${r.domElement.height} · DPR ${devicePixelRatio}`,
    `FPS ${Math.round(g.perf.fps)} · кадр ${g.perf.median.toFixed(1)}мс (худший ${g.perf.worst.toFixed(1)}) · CPU ${g.perf.cpuMs.toFixed(1)}мс · просадки ${g.perf.snapshot().lowPct}%`,
    `draw calls ${r.info.render.calls} · треугольников ${(r.info.render.triangles / 1000).toFixed(1)}k · геометрий ${r.info.memory.geometries} · программ ${r.info.programs?.length}`,
    `чанков ${g.terrain?.chunks.size ?? '-'} (пул ${g.terrain?.pool.length ?? '-'}) · деревьев ${g.props?.visible?.trees ?? '-'},` +
      ` камней ${g.props?.visible?.rocks ?? '-'}, кустов ${g.props?.visible?.bushes ?? '-'}`,
    `игрок: (${g.player?.pos.x.toFixed(1)}, ${g.player?.pos.y.toFixed(1)}, ${g.player?.pos.z.toFixed(1)})` +
      ` HP ${g.player?.hp.toFixed(0)}/${g.player?.hpMax} LV ${g.player?.level} золото ${g.player?.gold} убито ${g.player?.kills}`,
    `врагов: всего ${g.enemies?.list.length}, активных ${g.enemies?.list.filter(e => e.active).length},` +
      ` живых ${g.enemies?.list.filter(e => e.active && !e.dead).length}`,
    `время суток ${g.hour?.toFixed(2)} ч · ночь ${g.sky?.night.toFixed(2)} · тени ${g.sky?.sun.castShadow}`,
    `крик: ${g.player?.shout?.name ?? '-'} · слов ${g.player?.words.length ?? 0} · кд ${(g.player?.shoutCd ?? 0).toFixed(1)}с` +
    ` · рывок ${(g.player?.dashT ?? 0).toFixed(2)}с · стены слов ${(g.wordWalls?.serialize() || []).filter(Boolean).length}/` +
    `${g.wordWalls?.list.length ?? 0}`,
    `ночная угроза: урон врагов ×${(1 + (g.sky?.night ?? 0) * NIGHT.dmgMul).toFixed(2)},` +
    ` радиус обзора ×${(1 + (g.sky?.night ?? 0) * NIGHT.detectMul).toFixed(2)}`,
  ];
  const c = r.getContext();
  const d = c.getExtension('WEBGL_debug_renderer_info');
  lines.push(`GPU: ${d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?'} · ${c.getParameter(c.VERSION)}`);
  const txt = lines.join('\n');
  console.log(txt);
  return txt;
};

/* ══════════════════ квесты ══════════════════ */
const quest = {
  active: null, stage: 0, progress: 0,
  start(id) {
    this.active = QUESTS[id]; this.stage = 1; this.progress = 0;
    sfx.quest();
    hud.toast(`Новый квест: ${this.active.title}`, 'good');
  },
  onKill(e) {
    if (!this.active || this.stage !== 1 || e.homeTag !== 'ruins') return;
    this.progress++;
    const need = this.active.stages[1].need;
    if (this.progress >= need) {
      this.stage = 2;
      sfx.quest();
      hud.toast('Руины очищены — возвращайся к Торстену', 'good');
    }
  },
  complete(player) {
    const r = this.active.reward;
    player.gold += r.gold; player.addXp(r.xp);
    if (r.item) player.addItem('amulet', 1);
    hud.toast(`Квест выполнен: +${r.gold} золота, +${r.xp} опыта`, 'good');
    sfx.level();
    this.stage = 3;
  },
  tracker() {
    if (!this.active) return [];
    const st = this.active.stages[Math.min(this.stage, this.active.stages.length - 1)];
    if (this.stage === 0 || this.stage >= 3) return this.stage >= 3
      ? [{ title: this.active.title, text: 'Выполнен', done: true }] : [];
    const prog = st.need ? ` (${Math.min(this.progress, st.need)}/${st.need})` : '';
    return [{ title: this.active.title, text: st.text + prog }];
  },
  serialize() { return this.active ? { id: this.active.id, stage: this.stage, progress: this.progress } : null; },
  restore(s) {
    if (!s) { this.active = null; this.stage = 0; this.progress = 0; return; }
    this.active = QUESTS[s.id]; this.stage = s.stage; this.progress = s.progress || 0;
  },
};
game.quest = quest;

/* ══════════════════ качество ══════════════════ */
let shadowsApplied = null;
function applyQuality() {
  const q = Settings.q;
  // renderScale — доля НАТИВНОГО разрешения экрана (на Pova Neo 3 DPR ≈ 2,
  // поэтому 0.72 × 2 = 1.44 → буфер ~1180×518 вместо 1640×720: минус 40% пикселей)
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  renderer.setPixelRatio(Math.max(0.5, dpr * Settings.renderScale));
  resize();
  if (shadowsApplied !== q.shadows && game.sky) {
    shadowsApplied = q.shadows;
    renderer.shadowMap.enabled = q.shadows;
    // смена теней меняет шейдерные программы — пересобираем материалы один раз
    scene.traverse(o => {
      const m = o.material;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach(mm => { mm.needsUpdate = true; });
    });
  } else if (shadowsApplied === null) {
    shadowsApplied = q.shadows;
    renderer.shadowMap.enabled = q.shadows;
  }
  if (game.sky) game.sky.sun.castShadow = q.shadows && game.sky.sunDir.y > 0.02;
  if (game.terrain && game.player) {
    game.terrain.update(game.player.pos.x, game.player.pos.z, q.viewChunks);
    game.props.update(1, game.player.pos.x, game.player.pos.z, q, true);
  }
}
game.applyQuality = applyQuality;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  // на очень широком экране чуть поднимаем FOV, чтобы не «обрезало» по вертикали
  camera.fov = clamp(56 / Math.min(1.35, Math.max(0.85, w / h / 1.9)), 46, 68);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 250));

/* ══════════════════ загрузка мира ══════════════════ */
async function buildWorld() {
  Settings.load();
  input.sens = Settings.user.sens;
  input.invert = Settings.user.invert;
  hud.el.perf.style.display = Settings.user.perf ? '' : 'none';
  hud.loading(0.08, 'Профиль устройства…');
  await nextFrame();

  hud.loading(0.18, 'Небо и солнце…');
  game.sky = new Sky(scene);
  await nextFrame();

  hud.loading(0.34, 'Рельеф…');
  game.terrain = new Terrain(scene);
  game.terrain.update(WORLD.spawn.x, WORLD.spawn.z, 2);
  await nextFrame();

  hud.loading(0.52, 'Лес и камни…');
  game.props = new Props(scene);
  const propCount = game.props.generate();
  game.props.update(1, WORLD.spawn.x, WORLD.spawn.z, Settings.q, true);
  await nextFrame();

  hud.loading(0.68, 'Деревня и руины…');
  game.structures = new Structures(scene);
  game.water = new Water(scene);
  await nextFrame();

  hud.loading(0.82, 'Жители и твари…');
  game.player = new Player(game);
  game.enemies = new EnemyManager(game);
  game.npcs = [new Npc(game, { ...NPCS.torsten, yaw: 2.4 })];
  game.wordWalls = new WordWalls(scene);
  await nextFrame();

  hud.loading(0.92, 'Свет и тени…');
  applyQuality();
  game.sky.update(game.hour, game.player.pos, Settings.q);
  game.structures.update(0.016, game.sky.night, game.sky.lightLevel);
  await nextFrame();

  hud.loading(1, 'Готово');
  console.log(`[world] объектов растительности: ${propCount}, врагов: ${game.enemies.list.length}`);
  await nextFrame();

  $('btnContinue').disabled = !Save.has();
  hud.show('title');
  game.state = 'title';
  resize();
  loop(performance.now());
}

/* ══════════════════ взаимодействия ══════════════════ */
function findTarget() {
  const p = game.player.pos;
  let best = null, bd = Infinity;
  const consider = (d, o) => { if (d < bd) { bd = d; best = o; } };

  for (const n of game.npcs) {
    if (!n.active) continue;
    const d = Math.hypot(n.pos.x - p.x, n.pos.z - p.z);
    if (d < 3.6) consider(d, { kind: 'npc', npc: n, label: `Поговорить: ${n.name}` });
  }
  for (const c of game.structures.chests) {
    const d = Math.hypot(c.x - p.x, c.z - p.z) + Math.abs(c.y - p.y) * 0.25;
    if (d < 3.0) consider(d, {
      kind: 'chest', chest: c,
      label: c.looted ? 'Пустой сундук' : c.open ? 'Забрать содержимое' : 'Открыть сундук',
    });
  }
  const loot = game.enemies.nearestLoot(p, 3.2);
  if (loot) {
    const d = Math.hypot(loot.pos.x - p.x, loot.pos.z - p.z);
    consider(d, { kind: 'loot', enemy: loot, label: `Обыскать: ${loot.def.name}` });
  }
  for (const wall of game.wordWalls.list) {
    const d = Math.hypot(wall.x - p.x, wall.z - p.z);
    if (d < 3.8) consider(d, {
      kind: 'word', wall,
      label: p.words.includes(wall.word)
        ? 'Стена слов (руны погасли)' : 'Стена слов: ' + wall.def.name,
    });
  }
  const w = game.structures.well;
  if (w) {
    const d = Math.hypot(w.x - p.x, w.z - p.z);
    if (d < 3.0) consider(d, { kind: 'well', label: game.wellCd > 0 ? 'Колодец (подожди)' : 'Выпить воды' });
  }
  return best;
}

function doInteract(t) {
  const p = game.player;
  sfx.unlock();
  if (t.kind === 'npc') return talkTo(t.npc);
  if (t.kind === 'chest') {
    const c = t.chest;
    if (c.looted) { hud.toast('Сундук пуст'); return; }
    game.structures.openChest(c.id);
    c.looted = true;
    const names = [];
    if (c.gold) { p.gold += c.gold; names.push(`${c.gold} золота`); }
    for (const l of c.loot || []) { p.addItem(l.id, l.q); names.push(`${ITEMS_NAME(l.id)} ×${l.q}`); }
    hud.toast('Найдено: ' + (names.join(', ') || 'ничего'), 'good');
    fx.burst(c.x, c.y + 0.8, c.z, 0xffd77a, 14, 2.2, 2.0, 0.9, 1);
    return;
  }
  if (t.kind === 'loot') {
    const got = t.enemy.loot(p);
    if (got && got.length) hud.toast('Обыск: ' + got.join(', '), 'good');
    else hud.toast('Ничего ценного');
    fx.burst(t.enemy.pos.x, t.enemy.pos.y + 0.6, t.enemy.pos.z, 0xbfae8a, 6, 1.4, 1.0, 0.5, 0.8);
    return;
  }
  if (t.kind === 'word') {
    const wall = t.wall;
    if (p.words.includes(wall.word)) {
      return say('Стена слов', 'Руны потускнели — это слово уже звучит в тебе. Камень молчит.',
        [{ label: 'Отойти' }]);
    }
    const def = wall.def;
    return say('Стена слов',
      'Древний камень покрыт рунами, и они светятся изнутри, будто дышат.\n' +
      'Слово само ложится на язык: «' + def.word + '».\n\n' + def.hint + '.',
      [{ label: 'Принять слово силы', go: () => {
        const learned = p.learnWord(wall.word);
        game.wordWalls.markUsed(wall.id);
        sfx.word();
        fx.shockwave(wall.x, wall.y + 1.6, wall.z, 0x9fe8ff,
          { count: 34, speed: 9, life: 1.0, size: 1.3 });
        fx.burst(wall.x, wall.y + 2.2, wall.z, 0xcfeeff, 18, 2.6, 2.4, 1.2, 1.2);
        game.shake(0.6);
        hud.toast('Выучен крик: ' + def.name, 'good');
        p.addXp(60);
        closeDialogue();
        if (learned) saveGame(true);
      } },
      { label: 'Не сейчас' }]);
  }
  if (t.kind === 'well') {
    if (game.wellCd > 0) return;
    game.wellCd = 15;
    p.heal(12); p.st = p.stMax;
    hud.toast('Свежая вода: +12 HP', 'good');
    sfx.pickup();
  }
}
function ITEMS_NAME(id) {
  return ({ potion: 'Зелье лечения', bread: 'Хлеб', amulet: 'Амулет Севера' })[id] || id;
}

/* ══════════════════ диалоги ══════════════════ */
function say(name, text, options) {
  game.state = 'dialogue';
  hud.dialogue(name, text, options.map(o => ({
    label: o.label,
    action: () => { sfx.ui(); o.go ? o.go() : closeDialogue(); },
  })));
}
function closeDialogue() {
  hud.hideAll();
  game.state = 'play';
}

function talkTo(npc) {
  if (npc.id !== 'torsten') return say(npc.name, '…', [{ label: 'Прощай' }]);
  npc.talked = true;
  const q = quest;

  if (!q.active) {
    const refuse = () => say('Торстен',
      'Опасно… А жить под боком у мертвецов, по-твоему, не опасно? Костёр и миска похлёбки ждут тебя, если передумаешь.',
      [{ label: 'Уйти' }]);
    const accept = () => { quest.start('ruins'); closeDialogue(); };
    const aboutVillage = () => say('Торстен',
      'Пять домов, колодец да длинный дом для гостей. Раньше тут шёл тракт на юг, пока озеро не поднялось и не затопило старый форт. От него остались менгиры да арка.',
      [{ label: 'Понятно', go: () => talkTo(npc) }]);
    const main1 = () => say('Торстен',
      'Ты вовремя, путник. Из затопленных руин у озера снова поднялись драугры. Они ходят по ночам и режут скот. Если их не остановить — до зимы деревня не доживёт.',
      [{ label: 'Я зачищу руины', go: accept }, { label: 'Слишком опасно', go: refuse }]);
    return say('Торстен', 'Староста деревни. Смотрит тяжело, но без злобы.',
      [{ label: 'Что случилось?', go: main1 },
       { label: 'Расскажи о деревне', go: aboutVillage },
       { label: 'Уйти' }]);
  }

  if (q.stage === 1) {
    const need = QUESTS.ruins.stages[1].need;
    return say('Торстен', `Руины всё ещё кишат мертвецами. Ты отправил к предкам ${Math.min(q.progress, need)} из ${need}. Возвращайся, когда закончишь — и не лезь в воду ночью, они из неё выходят.`,
      [{ label: 'Я вернусь' }]);
  }

  if (q.stage === 2) {
    return say('Торстен', 'Я видел дым над руинами и слышал, как они выли. Значит, правда сделал… Держи золото и вот это — амулет, который носил мой дед. Он ещё послужит.',
      [{ label: 'Забрать награду', go: () => {
        quest.complete(game.player);
        closeDialogue();
        hud.toast('Торстен: «К северо-востоку от руин, на взгорье, стоит стена с рунами — там учатся крику»', 'good');
      } }]);
  }

  return say('Торстен', 'В деревне спокойно впервые за много лет. Если пойдёшь к озеру — держись пристани, там глубже, но волки не любят воду.',
    [{ label: 'Спасибо за совет' }]);
}

/* ══════════════════ сохранение ══════════════════ */
function saveGame(silent = false) {
  // мёртвого игрока не сохраняем: сейв должен оставаться «живой» точкой возврата
  if (game.player?.dead) return false;
  const state = {
    player: game.player.serialize(),
    enemies: game.enemies.serialize(),
    chests: game.structures.chests.map(c => ({ id: c.id, open: c.open, looted: c.looted })),
    quest: quest.serialize(),
    walls: game.wordWalls.serialize(),
    hour: +game.hour.toFixed(3),
    time: Math.round(game.time),
  };
  const ok = Save.write(state);
  if (!silent) hud.toast(ok ? 'Игра сохранена' : 'Не удалось сохранить', ok ? 'good' : 'bad');
  return ok;
}

function loadGame() {
  const s = Save.read();
  if (!s) return false;
  game.player.restore(s.player);
  game.enemies.restore(s.enemies);
  for (const c of s.chests || []) {
    const ch = game.structures.chests.find(x => x.id === c.id);
    if (ch) {
      ch.looted = !!c.looted;
      if (c.open) { ch.open = true; ch.lidPivot.rotation.x = -1.95; }
    }
  }
  quest.restore(s.quest);
  game.wordWalls.restore(s.walls);
  game.hour = s.hour ?? GAME.startHour;
  game.time = s.time ?? 0;
  return true;
}

function newGame() {
  Save.clear();
  game.player.restore({
    x: WORLD.spawn.x, y: 0, z: WORLD.spawn.z, yaw: 0, camYaw: 0, camPitch: 0.22,
    hp: PC.hpMax, st: PC.stMax, level: 1, xp: 0, gold: 0, kills: 0,
    hpMax: PC.hpMax, dmg: PC.attackDmg,
    inv: [{ id: 'potion', q: 2 }, { id: 'bread', q: 2 }], eq: [],
  });
  for (const e of game.enemies.list) e.reset();
  for (const c of game.structures.chests) { c.looted = false; c.open = false; c.lidPivot.rotation.x = 0; }
  quest.restore(null);
  game.wordWalls.reset();
  game.hour = GAME.startHour;
  game.time = 0;
}

/* ══════════════════ состояние игры ══════════════════ */
function startPlay(loaded) {
  sfx.unlock();
  hud.hideAll();
  hud.setGameVisible(true);
  game.state = 'play';
  input.flush();
  updateRotateHint();
  tryFullscreen();
  if (!loaded) hud.toast('Совет: 🛡 блокирует удары, 🐉 — крик. Ищи стены слов со светящимися рунами', '');
}

function updateRotateHint() {
  const hint = $('rotateHint');
  if (!hint) return;
  const portrait = window.innerHeight > window.innerWidth;
  hint.classList.toggle('hidden', !(input.isTouch && portrait && game.state === 'play'));
}
addEventListener('resize', () => updateRotateHint());

function tryFullscreen() {
  const el = document.documentElement;
  const p = el.requestFullscreen?.({ navigationUI: 'hide' }) || Promise.resolve();
  p.then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
}

function togglePause(force) {
  if (game.state === 'play' || force === true) {
    if (game.state !== 'play') return;
    game.state = 'paused';
    input.flush();
    hud.pauseStats(`FPS ${Math.round(perf.fps)} · время в игре ${Math.floor(game.time / 60)} мин · ${game.player.kills} убийств`);
    hud.show('pause');
    saveGame(true);
  } else if (game.state === 'paused') {
    hud.hideAll();
    game.state = 'play';
  }
}

/* ══════════════════ игровой цикл ══════════════════ */
function titleCamera() {
  const V = WORLD.village;
  const a = game.titleT * 0.045;
  const r = 42;
  camera.position.set(V.x + Math.cos(a) * r, 19, V.z + Math.sin(a) * r);
  camera.lookAt(V.x, 7.5, V.z);
}

let last = performance.now();
let hudT = 0;

function loop(now) {
  requestAnimationFrame(loop);
  const dtRaw = (now - last) / 1000;
  last = now;
  if (dtRaw > 0.5) return;                       // вернулись из фона — кадр пропускаем
  const dt = Math.min(0.05, dtRaw);              // защита от скачков при троттлинге
  const t0 = performance.now();

  if (game.state === 'play') update(dt);
  else if (game.state === 'dialogue' || game.state === 'inv') updateSlow(dt);

  // управление качеством — считаем только во время игры (меню легче и сбивает замер)
  if (game.state === 'play' && perf.update(dtRaw)) applyQuality();

  // тряска камеры
  if (game.shakeT > 0) {
    game.shakeT = Math.max(0, game.shakeT - dt * 2.6);
    const s = game.shakeT * game.shakeT * 0.5;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    camera.position.z += (Math.random() - 0.5) * s;
  }

  if (!document.hidden && game.state !== 'title' && game.state !== 'loading') {
    renderer.render(scene, camera);
  } else if (game.state === 'title') {
    // «открыточная» сцена в меню: медленный облёт деревни, солнце идёт быстрее
    game.titleT += dt;
    game.hour = (game.hour + dt * 0.9) % 24;
    titleCamera();
    game.sky?.update(game.hour, camera.position, Settings.q);
    game.structures?.update(dt, game.sky.night, game.sky.lightLevel);
    game.water?.update(dt, game.sky, Settings.q);
    game.props?.applyNight(game.sky.night);
    game.wordWalls?.update(dt, game.sky.night);
    renderer.render(scene, camera);
  }

  perf.frame(dtRaw * 1000, performance.now() - t0);
  hud.updateNumbers(dt, camera, window.innerWidth, window.innerHeight);
  hudT += dt;
  if (hudT > 0.25) {
    hudT = 0;
    if (Settings.user.perf && game.state !== 'title') hud.perf(perf.snapshot(), renderer);
  }
  input.endFrame();
}

/** Полный апдейт мира */
function update(dt) {
  game.time += dt;
  game.hour = (game.hour + dt * (24 / GAME.dayLengthSec)) % 24;
  if (game.wellCd > 0) game.wellCd -= dt;

  // меню по кнопке
  if (input.consume('menu')) { togglePause(); return; }
  if (input.consume('bag')) { openInventory(); return; }
  if (input.consume('quicksave')) { saveGame(); return; }

  const p = game.player;
  p.update(dt, input);

  if (input.consume('interact')) {
    const t = findTarget();
    if (t) doInteract(t);
  }

  game.enemies.update(dt);
  for (const n of game.npcs) n.update(dt, p);

  // стриминг мира
  const q = Settings.q;
  game.terrain.update(p.pos.x, p.pos.z, q.viewChunks);
  game.props.update(dt, p.pos.x, p.pos.z, q);

  game.sky.update(game.hour, camera.position, q);
  game.water.update(dt, game.sky, q);
  game.structures.update(dt, game.sky.night, game.sky.lightLevel);
  game.props.applyNight(game.sky.night);
  game.wordWalls.update(dt, game.sky.night);
  game.fx.update(dt);

  // ночь делает мертвецов злее — предупреждаем один раз за ночь
  const night = game.sky.night;
  if (night > NIGHT.warnAt && !game.nightWarned) {
    game.nightWarned = true;
    hud.toast('Смеркается. Твари видят дальше и бьют больнее', 'bad');
  } else if (night < NIGHT.clearAt) {
    game.nightWarned = false;
  }

  // подсказка взаимодействия
  game.target = findTarget();
  hud.prompt(game.target ? game.target.label : '', '✋');

  // HUD
  hud.vitals(p, PC.xpPerLevel[Math.min(p.level, PC.xpPerLevel.length - 1)] || p.level * 1200);
  hud.compass(p.camYaw);
  hud.quests(quest.tracker());
  hud.shoutState(p);

  // автосейв
  game.autosave += dt;
  if (game.autosave > GAME.autosaveSec) { game.autosave = 0; saveGame(true); }

  game._clean.copy(camera.position);
}

/** Минимальный апдейт для открытых панелей: мир «дышит», но игрок не двигается */
function updateSlow(dt) {
  game.time += dt;
  game.hour = (game.hour + dt * (24 / GAME.dayLengthSec)) % 24;
  if (input.consume('menu')) { if (game.state === 'inv') { hud.hideAll(); game.state = 'play'; } else togglePause(); }
  if (input.consume('bag') && game.state === 'inv') { hud.hideAll(); game.state = 'play'; }
  const p = game.player;
  p.updateCamera(dt);
  game.sky.update(game.hour, camera.position, Settings.q);
  game.water.update(dt, game.sky, Settings.q);
  game.structures.update(dt, game.sky.night, game.sky.lightLevel);
  game.wordWalls.update(dt, game.sky.night);
  game.fx.update(dt);
  for (const n of game.npcs) n.update(dt, p);
  game._clean.copy(camera.position);
}

function openInventory() {
  game.state = 'inv';
  const refresh = (id) => {
    if (id) game.player.useItem(id);
    hud.inventory(game.player, refresh);
    if (id) sfx.pickup();
  };
  hud.inventory(game.player, refresh);
  hud.show('inventory');
}

/* ══════════════════ кнопки меню ══════════════════ */
function bindMenu() {
  hud.onDeath = () => {
    game.state = 'dead';
    input.flush();
  };
  $('btnNew').onclick = () => { sfx.unlock(); sfx.ui(); newGame(); startPlay(false); };
  $('btnContinue').onclick = () => {
    sfx.unlock(); sfx.ui();
    if (loadGame()) startPlay(true);
    else { hud.toast('Сохранение не найдено'); newGame(); startPlay(false); }
  };
  $('btnSettings').onclick = () => { sfx.ui(); openSettings(); };
  $('btnPauseSettings').onclick = () => { sfx.ui(); openSettings(true); };
  $('btnSettingsClose').onclick = () => {
    sfx.ui();
    if (game.state === 'paused') hud.show('pause');
    else { hud.hideAll(); game.state = game.player ? 'play' : 'title'; if (game.state === 'title') hud.show('title'); }
  };
  $('btnResume').onclick = () => { sfx.ui(); togglePause(); };
  $('btnSave').onclick = () => { sfx.ui(); saveGame(); };
  $('btnToTitle').onclick = () => {
    sfx.ui(); saveGame(true);
    game.state = 'title'; hud.setGameVisible(false); hud.show('title');
    $('btnContinue').disabled = !Save.has();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  };
  $('btnRespawn').onclick = () => {
    sfx.ui();
    if (!loadGame()) newGame();
    game.player.hp = game.player.hpMax;
    hud.hideAll(); game.state = 'play';
  };
  $('btnInvClose').onclick = () => { sfx.ui(); hud.hideAll(); game.state = 'play'; };

  // настройки
  const seg = (id, apply) => {
    const el = $(id);
    el.querySelectorAll('button').forEach(b => {
      b.onclick = () => {
        el.querySelectorAll('button').forEach(x => x.classList.remove('sel'));
        b.classList.add('sel');
        sfx.ui(); apply(b.dataset);
      };
    });
  };
  seg('segQuality', (d) => {
    Settings.user.quality = d.q; Settings.save(); Settings.resolve();
    Settings.autoScale = 1; perf._shadowDropped = false;
    perf.samples.length = 0; perf.cpuSamples.length = 0; perf.totalFrames = 0;
    applyQuality();
  });
  seg('segInvert', (d) => { Settings.user.invert = d.v === '1'; input.invert = Settings.user.invert; Settings.save(); });
  seg('segSound', (d) => { Settings.user.sound = d.v === '1'; Settings.save(); if (Settings.user.sound) sfx.unlock(); });
  seg('segPerf', (d) => { Settings.user.perf = d.v === '1'; Settings.save(); hud.el.perf.style.display = Settings.user.perf ? '' : 'none'; });
  $('rngSens').oninput = (e) => {
    const v = e.target.value / 100;
    Settings.user.sens = v; input.sens = v;
    $('outSens').textContent = v.toFixed(2);
    Settings.save();
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === 'play') togglePause(true);
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && game.state === 'dialogue') closeDialogue();
    if (e.code === 'Escape' && game.state === 'inv') { hud.hideAll(); game.state = 'play'; }
  });
}

function openSettings(fromPause) {
  $('rngSens').value = Math.round(Settings.user.sens * 100);
  $('outSens').textContent = Settings.user.sens.toFixed(2);
  const mark = (id, val) => {
    const el = $(id);
    el.querySelectorAll('button').forEach(b => b.classList.toggle('sel', (b.dataset.q ?? b.dataset.v) === String(val)));
  };
  mark('segQuality', Settings.user.quality);
  mark('segInvert', Settings.user.invert ? 1 : 0);
  mark('segSound', Settings.user.sound ? 1 : 0);
  mark('segPerf', Settings.user.perf ? 1 : 0);
  hud.el.perf.style.display = Settings.user.perf ? '' : 'none';

  const c = renderer.getContext();
  const gl = c.getParameter(c.VERSION) || '';
  const rd = c.getExtension('WEBGL_debug_renderer_info');
  const gpu = rd ? c.getParameter(rd.UNMASKED_RENDERER_WEBGL) : '?';
  $('deviceInfo').textContent =
    `Экран ${innerWidth}×${innerHeight} CSS · DPR ${devicePixelRatio.toFixed(2)} · touch: ${input.isTouch ? 'да' : 'нет'} · ` +
    `буфер рендера ${canvas.width}×${canvas.height} · GPU: ${String(gpu).slice(0, 48)} · ${String(gl).slice(0, 22)}`;
  if (fromPause) game.state = 'paused';
  hud.show('settings');
}

/* ══════════════════ старт ══════════════════ */
bindMenu();
resize();
buildWorld().catch(err => {
  console.error(err);
  hud.loading(0, 'Ошибка запуска: ' + err.message);
  $('loadText').textContent = 'Ошибка: ' + err.message + ' (смотри консоль)';
});

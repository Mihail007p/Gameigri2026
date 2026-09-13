// Все числовые параметры игры в одном месте — чтобы балансировать, не копаясь в коде.

export const WORLD = {
  size: 520,            // размер мира в метрах (квадрат)
  half: 260,
  water: 0.5,           // уровень воды
  chunk: 40,            // размер чанка террейна, м
  seg: 20,              // сегментов на чанк (20 → 800 треугольников на чанк)
  edgeWall: 175,        // с какой дистанции от центра начинается подъём к горам
  spawn: { x: -44, z: 22 },
  village: { x: -46, z: -14 },
  ruins: { x: 74, z: 62 },
  lake: { x: 62, z: 96, r: 55 },
  seed: 20260913,
};

/** Пресеты качества. См. docs/01_DEVICE_BUDGET.md */
export const QUALITY = {
  low: {
    name: 'low', renderScale: 0.55, shadows: false, shadowSize: 512,
    propRadius: 70, grassRadius: 26, viewChunks: 2, maxEnemies: 4,
    fogFar: 95, stars: false, waterWave: false, fpsTarget: 30,
  },
  medium: {
    name: 'medium', renderScale: 0.72, shadows: true, shadowSize: 1024,
    propRadius: 96, grassRadius: 38, viewChunks: 2, maxEnemies: 7,
    fogFar: 108, stars: true, waterWave: true, fpsTarget: 30,
  },
  high: {
    name: 'high', renderScale: 1.0, shadows: true, shadowSize: 1536,
    propRadius: 140, grassRadius: 50, viewChunks: 3, maxEnemies: 10,
    fogFar: 150, stars: true, waterWave: true, fpsTarget: 45,
  },
};

export const GAME = {
  dayLengthSec: 600,     // 10 реальных минут = сутки в игре (для прототипа намеренно быстро)
  startHour: 7.2,
  autosaveSec: 30,
  gravity: -22,
  version: '0.2.0',
  saveKey: 'severny_kray_save_v1',
};

export const PLAYER = {
  hpMax: 100, stMax: 100,
  walkSpeed: 2.7, runSpeed: 5.4, swimSpeed: 1.9,
  accel: 26, damping: 11,
  jumpVel: 7.2,
  runDrain: 13,          // стамина в секунду при беге
  stRegen: 16,           // восстановление в секунду
  stRegenDelay: 1.1,     // задержка регена после траты
  attackDmg: 14, critMul: 2.0, critChance: 0.15,
  attackRange: 2.5, attackArc: 1.15,   // метры / радианы от направления взгляда
  attackTime: 0.42, attackHitAt: 0.17, attackCooldown: 0.12,
  attackStCost: 7,
  blockMul: 0.3, blockDrain: 9, blockStCost: 4,
  radius: 0.42, height: 1.78, eye: 1.62,
  camDist: 4.3, camHeight: 1.55, camPitchMin: -0.55, camPitchMax: 1.05,
  shoutCastPad: 0.22,       // сколько длится «отдача» крика после удара волны
  xpPerLevel: [0, 100, 260, 500, 850, 1350, 2000, 2900],
  hpPerLevel: 18, dmgPerLevel: 3,
};

/** Типы врагов. Всё, что нужно AI и бою. */
export const ENEMIES = {
  draugr: {
    id: 'draugr', name: 'Драугр', rig: 'draugr',
    hp: 42, dmg: 9, speed: 2.35, runSpeed: 3.5, detect: 24, attackRange: 2.05,
    attackTime: 0.85, attackHitAt: 0.55, cooldown: 1.5,
    xp: 40, gold: [4, 14], loot: [['Кость драугра', 0.6], ['Древняя монета', 0.25]],
    scale: 1.0,
  },
  draugrWarrior: {
    id: 'draugrWarrior', name: 'Драугр-воин', rig: 'draugr',
    hp: 74, dmg: 15, speed: 2.5, runSpeed: 3.9, detect: 26, attackRange: 2.2,
    attackTime: 0.95, attackHitAt: 0.6, cooldown: 1.7,
    xp: 85, gold: [12, 30], loot: [['Железный шлем', 0.35], ['Кость драугра', 0.5]],
    scale: 1.12, tint: 0x9fb4a8,
  },
  wolf: {
    id: 'wolf', name: 'Волк', rig: 'wolf',
    hp: 28, dmg: 7, speed: 3.4, runSpeed: 5.6, detect: 30, attackRange: 1.75,
    attackTime: 0.55, attackHitAt: 0.32, cooldown: 1.1,
    xp: 30, gold: [0, 3], loot: [['Волчья шкура', 0.55]],
    scale: 1.0,
  },
};

/** Точки спавна врагов: {тип, позиция, сколько, радиус патрулирования} */
export const SPAWN_POINTS = [
  { type: 'draugr', x: WORLD.ruins.x, z: WORLD.ruins.z, count: 3, radius: 14, home: 'ruins' },
  { type: 'draugrWarrior', x: WORLD.ruins.x + 6, z: WORLD.ruins.z - 8, count: 1, radius: 10, home: 'ruins' },
  { type: 'wolf', x: 10, z: -70, count: 3, radius: 26, home: 'forest' },
  { type: 'wolf', x: -95, z: 60, count: 2, radius: 24, home: 'forest2' },
];

export const QUESTS = {
  ruins: {
    id: 'ruins',
    title: 'Затопленные руины',
    giver: 'torsten',
    stages: [
      { id: 'talk', text: 'Поговорить с Торстеном в деревне' },
      { id: 'kill', text: 'Уничтожить драугров в руинах', need: 4 },
      { id: 'return', text: 'Вернуться к Торстену' },
    ],
    reward: { gold: 120, xp: 200, item: 'Амулет Севера' },
  },
};

export const NPCS = {
  torsten: {
    id: 'torsten', name: 'Торстен', role: 'Староста деревни',
    x: WORLD.village.x + 4, z: WORLD.village.z + 6,
  },
};

export const ITEMS = {
  potion: { id: 'potion', name: 'Зелье лечения', desc: 'Восстанавливает 40 HP', stack: true, use: 'heal', power: 40 },
  bread: { id: 'bread', name: 'Хлеб', desc: 'Восстанавливает 12 HP', stack: true, use: 'heal', power: 12 },
  amulet: { id: 'amulet', name: 'Амулет Севера', desc: '+15 к максимальному здоровью', stack: false, use: 'equipHp', power: 15 },
};

/**
 * КРИКИ (аналог Thu'um из Skyrim). Учатся у стен слов (WORD_WALLS).
 * Всё живёт в одном слоте: игрок экипирует один крик и переключает его кнопкой ⇄.
 * kind:
 *   force — конус: урон + сильный отброс + оглушение
 *   dash  — рывок вперёд, на время рывка игрок неуязвим
 *   frost — конус: урон + замедление врага (slowK на slow секунд)
 */
export const SHOUTS = {
  fus: {
    id: 'fus', name: 'Безжалостная сила', word: 'ФУС · РО · ДА', icon: '🐉', kind: 'force',
    range: 13, arc: 0.85, dmg: 26, knock: 17, stun: 1.1,
    cd: 18, stCost: 16, castTime: 0.45, maxTargets: 5,
    hint: 'Отбрасывает всех в конусе перед тобой и оглушает на секунду',
  },
  wuld: {
    id: 'wuld', name: 'Вихрь', word: 'ВУЛД · НА · КЕЙ', icon: '🌀', kind: 'dash',
    dist: 9.5, dur: 0.34, cd: 12, stCost: 20, castTime: 0.2,
    hint: 'Мгновенный рывок вперёд. В полёте ты неуязвим — уходишь из-под удара',
  },
  fo: {
    id: 'fo', name: 'Ледяное дыхание', word: 'ФО · КЕН · ДИИН', icon: '❄', kind: 'frost',
    range: 11, arc: 1.0, dmg: 18, knock: 3, slow: 4.0, slowK: 0.45,
    cd: 24, stCost: 18, castTime: 0.5, maxTargets: 6,
    hint: 'Стужа: враги двигаются и бьют вдвое медленнее 4 секунды',
  },
};

/** Крик, который игрок знает с самого начала */
export const START_WORDS = ['fus'];

/** Стены слов: каменные плиты с рунами, у которых учится новый крик */
export const WORD_WALLS = [
  // места выбраны по карте высот: сухо (выше уровня воды), уклон < 0.26, в пределах мира
  { id: 'wwRuins', word: 'wuld', x: 104, z: 30,   yaw: -0.75, where: 'на взгорье к востоку от руин' },
  { id: 'wwNorth', word: 'fo',   x: -112, z: 120, yaw: 2.5,   where: 'на северном склоне, за лесом' },
];

/** Насколько опаснее становится мир ночью (множители к характеристикам врагов) */
export const NIGHT = {
  detectMul: 0.55,   // +55 % к радиусу обнаружения в глубокую ночь
  dmgMul: 0.35,      // +35 % к урону
  speedMul: 0.12,    // +12 % к скорости бега
  warnAt: 0.45,      // при какой «ночности» показать предупреждение игроку
  clearAt: 0.2,      // ниже этого значения предупреждение можно показать снова
};

// Проверка целостности разметки: каждый id, который код ищет в DOM, обязан быть
// в play.html, и каждый относительный путь в play.html обязан существовать на диске.
// Без этого легко получить «чёрный экран на телефоне» после переноса файлов.
// Запуск: node tools/checkids.mjs  (используется и в CI)
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'prototype', 'src');

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.js')) yield p;
  }
}

let problems = 0;
const fail = (msg) => { problems++; console.log('  ✗ ' + msg); };

const html = await readFile(join(ROOT, 'play.html'), 'utf8');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));

const used = new Map();   // id → файлы, которые его используют
for await (const file of walk(SRC)) {
  const s = await readFile(file, 'utf8');
  const rel = file.slice(ROOT.length + 1);
  for (const re of [/\$\(\s*'([^']+)'/g, /getElementById\(\s*'([^']+)'/g]) {
    for (const m of s.matchAll(re)) {
      if (!used.has(m[1])) used.set(m[1], new Set());
      used.get(m[1]).add(rel);
    }
  }
}

console.log(`\n── play.html: ${ids.size} id, код ищет ${used.size} ──`);
for (const [id, files] of [...used].sort()) {
  if (!ids.has(id)) fail(`id="${id}" нет в play.html (используют: ${[...files].join(', ')})`);
}

// относительные пути внутри play.html (стили, модули, importmap)
const paths = new Set();
for (const m of html.matchAll(/(?:href|src)="(\.[^"]+)"/g)) paths.add(m[1]);
for (const m of html.matchAll(/"\.\/(prototype\/[^"]+)"/g)) paths.add('./' + m[1]);
for (const p of [...paths].sort()) {
  const abs = resolve(ROOT, p);
  const isDir = p.endsWith('/');
  const exists = isDir ? (await stat(abs).then(s => s.isDirectory()).catch(() => false))
    : (await stat(abs).then(s => s.isFile()).catch(() => false));
  if (!exists) fail(`путь ${p} из play.html не найден на диске`);
}

// файлы игры, на которые ссылается main.js, должны существовать (ловит опечатки в импортах)
for await (const file of walk(SRC)) {
  const s = await readFile(file, 'utf8');
  for (const m of s.matchAll(/from\s+'(\.[^']+)'/g)) {
    const abs = resolve(dirname(file), m[1]);
    if (!(await stat(abs).then(x => x.isFile()).catch(() => false))) {
      fail(`${file.slice(ROOT.length + 1)}: импорт '${m[1]}' не найден`);
    }
  }
}

if (problems) {
  console.log(`\n════ ПРОВЕРОК НЕ ПРОЙДЕНО: ${problems} ════\n`);
  process.exit(1);
}
console.log(`  ✓ все id на месте, все пути и импорты существуют\n`);

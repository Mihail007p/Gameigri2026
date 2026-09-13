// Проверка синтаксиса всех JS-файлов проекта (node --check) без единой строчки
// shell-магии: так же работает и в CI, и локально, и на Windows.
// Запуск: node tools/syntax.mjs
import { readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', 'shots']);

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(join(dir, e.name));
    } else if (/\.(js|mjs)$/.test(e.name)) {
      yield join(dir, e.name);
    }
  }
}

const files = [];
for await (const f of walk(join(ROOT, 'prototype'))) files.push(f);
for await (const f of walk(join(ROOT, 'tools'))) files.push(f);
files.push(join(ROOT, 'server.mjs'));

let bad = 0;
for (const f of files) {
  if (!(await stat(f).catch(() => null))) continue;
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    bad++;
    console.log(`  ✗ ${f.slice(ROOT.length + 1)}\n${r.stderr.trim().split('\n').slice(0, 4).join('\n')}`);
  }
}

console.log(`\n── Синтаксис: проверено ${files.length} файлов, ошибок ${bad} ──`);
process.exit(bad ? 1 : 0);

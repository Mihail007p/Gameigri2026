// Печатает рабочие ссылки на игру для текущего состояния репозитория.
// Запуск: npm run links
import { execSync } from 'node:child_process';

const REPO = 'Mihail007p/Gameigri2026';
const sha = execSync('git rev-parse HEAD').toString().trim();
let branch = 'arena/01a098e5-gameigri2026';
try { branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim(); } catch (e) {}

const pushed = (() => {
  try {
    return execSync(`git ls-remote origin refs/heads/${branch}`).toString().includes(sha);
  } catch (e) { return false; }
})();

const jsd = `https://cdn.jsdelivr.net/gh/${REPO}@${branch}`;
console.log('\n=== Ссылки для теста на телефоне (Chrome, горизонтально) ===\n');
console.log('ГЛАВНАЯ — по SHA коммита: всегда ровно эта версия, кэш CDN не мешает');
console.log(`  https://raw.githack.com/${REPO}/${sha}/play.html   (один клик «Open the page»)`);
console.log(`  https://cdn.jsdelivr.net/gh/${REPO}@${sha}/play.html   (без предупреждений)`);
console.log('\nПо ветке — короче, но CDN может отдать старую версию (кэш до 12 ч):');
console.log(`  ${jsd}/play.html`);
console.log(`  https://raw.githack.com/${REPO}/${branch}/play.html`);
console.log(`  https://cdn.statically.io/gh/${REPO}/${branch}/play.html`);
console.log('\nСброс кэша jsDelivr (открыть в браузере после пуша):');
for (const f of ['play.html', 'prototype/style.css', 'prototype/src/main.js']) {
  console.log(`  https://purge.jsdelivr.net/gh/${REPO}@${branch}/${f}`);
}
console.log(`\nHEAD ${sha.slice(0, 8)} · запушен в origin/${branch}: ${pushed ? 'ДА' : 'НЕТ — сначала git push'}\n`);
if (!pushed) process.exitCode = 1;

// Автотест прототипа в headless Chrome (SwiftShader):
//  • ловит ошибки JS/WebGL до того, как их увидит игрок на телефоне;
//  • делает скриншоты (tools/shots/) — их можно посмотреть глазами;
//  • собирает метрики кадра и draw calls.
// Запуск: npm start (в другом окне) && npm run smoke
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const puppeteer = require('/tmp/node_modules/puppeteer');

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(HERE, 'shots');
mkdirSync(SHOTS, { recursive: true });
const URL = process.env.URL || 'http://127.0.0.1:3000/';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const errors = [];
function attach(page, tag) {
  page.on('console', m => {
    const t = m.type();
    if (t === 'error' || t === 'warning') errors.push(`[${tag}][${t}] ${m.text()}`);
  });
  page.on('pageerror', e => errors.push(`[${tag}][pageerror] ${e.message}`));
  page.on('requestfailed', r => errors.push(`[${tag}][404?] ${r.url()} — ${r.failure()?.errorText}`));
}

async function runScenario(page, tag, opts) {
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__game && window.__game.state === "title"', { timeout: 60000 });
  await page.screenshot({ path: `${SHOTS}/${tag}-1-title.png` });

  // новая игра
  await page.click('#btnNew');
  await wait(600);
  await page.evaluate(() => window.__game.input.flush?.());
  await wait(1800);
  await page.screenshot({ path: `${SHOTS}/${tag}-2-spawn.png` });

  // идём вперёд
  await page.keyboard.down('w');
  await wait(1500);
  await page.keyboard.up('w');
  await page.screenshot({ path: `${SHOTS}/${tag}-3-walk.png` });

  // поворот камеры + удар
  const box = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  await page.mouse.move(box.w * 0.75, box.h * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.w * 0.75 + 130, box.h * 0.5 + 30, { steps: 12 });
  await page.mouse.up();
  await wait(200);
  await page.evaluate(() => window.__game.player.attackT = 0.35);
  await wait(120);
  await page.screenshot({ path: `${SHOTS}/${tag}-4-attack.png` });

  // телепорт к руинам — проверка боя, врагов, воды и руин
  await page.evaluate(() => {
    const g = window.__game;
    g.player.pos.set(g.structures.ruinsPos.x - 12, 0, g.structures.ruinsPos.z + 6);
    g.player.pos.y = 3;
  });
  await wait(2500);
  await page.screenshot({ path: `${SHOTS}/${tag}-5-ruins.png` });

  // ночь: проверяем небо, звёзды, свет окон и костра
  await page.evaluate(() => { window.__game.hour = 22.5; });
  await wait(1200);
  await page.evaluate(() => {
    const g = window.__game;
    g.player.pos.set(g.structures.firePos.x + 5, 0, g.structures.firePos.z + 5);
    g.player.camYaw = Math.PI * 0.75; g.player.camPitch = 0.15;
  });
  await wait(1500);
  await page.screenshot({ path: `${SHOTS}/${tag}-6-night.png` });

  const stats = await page.evaluate(() => {
    const g = window.__game;
    return {
      perf: g.perf.snapshot(),
      info: {
        calls: g.renderer.info.render.calls,
        tris: g.renderer.info.render.triangles,
        geometries: g.renderer.info.memory.geometries,
        textures: g.renderer.info.memory.textures,
        programs: g.renderer.info.programs?.length,
      },
      world: {
        hour: +g.hour.toFixed(2), night: +g.sky.night.toFixed(2),
        chunks: g.terrain.chunks.size, props: g.props.visible,
        enemiesActive: g.enemies.list.filter(e => e.active).length,
        player: { x: +g.player.pos.x.toFixed(1), y: +g.player.pos.y.toFixed(1), z: +g.player.pos.z.toFixed(1) },
      },
      gl: (() => {
        const c = g.renderer.getContext();
        const d = c.getExtension('WEBGL_debug_renderer_info');
        return { renderer: d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?', version: c.getParameter(c.VERSION) };
      })(),
    };
  });
  return stats;
}

async function launch() {
  const args = [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--ignore-gpu-blocklist', '--enable-webgl',
  ];
  // 1) штатный Chrome от puppeteer
  try { return await puppeteer.launch({ headless: true, args }); } catch (e) { /* нет скачанного браузера */ }
  // 2) Chromium из npm-пакета @sparticuz/chromium (работает без доступа к CDN Google)
  const chromium = require('/tmp/node_modules/@sparticuz/chromium');
  const exe = await chromium.executablePath();
  console.log('[smoke] запускаю', exe);
  return puppeteer.launch({ headless: true, executablePath: exe, args: [...chromium.args, ...args] });
}
const browser = await launch();

try {
  // ── 1. десктоп ──
  const p1 = await browser.newPage();
  await p1.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  attach(p1, 'desktop');
  const s1 = await runScenario(p1, 'desktop');
  console.log('DESKTOP', JSON.stringify(s1, null, 1));
  await p1.close();

  // ── 2. телефон (профиль Tecno Pova Neo 3: 1640×720 ландшафт, DPR 2, touch) ──
  const p2 = await browser.newPage();
  await p2.setViewport({
    width: 820, height: 360, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  await p2.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5 });
  });
  attach(p2, 'phone');
  const s2 = await runScenario(p2, 'phone');
  console.log('PHONE', JSON.stringify(s2, null, 1));
  await p2.close();
} finally {
  await browser.close();
}

const real = errors.filter(e => !/Multiple instances of Three|deprecat/i.test(e));
console.log('\n=== ОШИБКИ/ПРЕДУПРЕЖДЕНИЯ (' + real.length + ') ===');
for (const e of real.slice(0, 40)) console.log(' •', e);
process.exit(real.length ? 1 : 0);

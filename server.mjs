// Мини-статик-сервер для прототипа. Без зависимостей, работает и в песочнице, и локально.
// Запуск:  npm start   (или: node server.mjs 3000)
// Отдаёт корень репозитория по адресу http://0.0.0.0:PORT
// (игра — корневой play.html, её файлы — в prototype/)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number(process.env.PORT || process.argv[2] || 3000);
const HOST = '0.0.0.0'; // обязательно 0.0.0.0 — иначе телефон/превью не достучится

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path === '/' || path === '') path = '/index.html';
    if (/(^|\/)(node_modules|\.git)(\/|$)/.test(path)) { res.writeHead(403); return res.end('403'); }

    // защита от выхода за пределы папки
    const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('403'); }

    const s = await stat(file).catch(() => null);
    if (!s || !s.isFile()) { res.writeHead(404); return res.end('404: ' + path); }

    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      // кэш выключаем: на телефоне всегда должна быть свежая версия после правки
      'Cache-Control': 'no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500);
    res.end('500: ' + e.message);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[server] ${ROOT}`);
  console.log(`[server] http://${HOST}:${PORT}  (на телефоне: http://<ip-компьютера>:${PORT})`);
});

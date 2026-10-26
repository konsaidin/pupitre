// Статический HTTPS-сервер браузерной версии Пюпитра (без зависимостей): микрофону нужен защищённый контекст, поэтому
// HTTPS даже с самоподписанным сертификатом. Корень — собранный apps/web/dist; неизвестный путь — index.html.
// /api/* — потоком на песенный бэкенд (PUPITRE_API_UPSTREAM, по умолчанию http://127.0.0.1:8123): тот же origin, без CORS;
// доступ к бэкенду — его токеном (PUPITRE_API_TOKEN бэкенда), прокси его не подставляет.
// Запуск: node static-https.mjs <корень> <порт> <cert.pem> <key.pem>
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:https';
import { extname, join, normalize, sep } from 'node:path';

const [root, port, cert, key] = process.argv.slice(2);
const upstream = new URL(process.env.PUPITRE_API_UPSTREAM ?? 'http://127.0.0.1:8123');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.sf3': 'application/octet-stream', '.ico': 'image/x-icon',
};

createServer({ cert: readFileSync(cert), key: readFileSync(key) }, (req, res) => {
  const url = new URL(req.url ?? '/', 'https://x');
  if (url.pathname.startsWith('/api/')) {
    const up = httpRequest(
      { hostname: upstream.hostname, port: upstream.port, method: req.method, path: req.url, headers: { ...req.headers, host: upstream.host } },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: 'песенный сервер недоступен' }));
    });
    req.pipe(up);
    return;
  }
  let file = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(normalize(root) + sep) && file !== normalize(root)) {
    res.writeHead(403).end();
    return;
  }
  let st;
  try {
    st = statSync(file);
    if (st.isDirectory()) st = statSync((file = join(file, 'index.html')));
  } catch {
    st = statSync((file = join(root, 'index.html')));
  }
  const immutable = url.pathname.startsWith('/assets/');
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}).listen(Number(port), '0.0.0.0', () => console.log(`pupitre-web: https://0.0.0.0:${port} → ${root}`));

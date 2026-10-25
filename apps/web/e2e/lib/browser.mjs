// Общая обвязка: зависимости живут вне репозитория.
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createServer as createSocket } from 'node:net';

export const webRoot = fileURLToPath(new URL('../../', import.meta.url));
export const toolsRoot = join(homedir(), '.cache/pupitre/tools/e2e/node_modules');
export const installCommand = 'npm i --prefix ~/.cache/pupitre/tools/e2e puppeteer-core@24.43.1 pixelmatch@8.0.0 pngjs@7.0.0';
const requireTool = createRequire(join(toolsRoot, '../package.json'));
export async function tool(name) {
  let path;
  try { path = requireTool.resolve(name); }
  catch { throw new Error(`Не найден ${name}; поставьте: ${installCommand}`); }
  return import(pathToFileURL(path).href);
}

export async function startVite({ port } = {}) {
  // Vite 6 трактует port: 0 как 5173; сначала просим свободный порт у ОС.
  let listenPort = port;
  if (listenPort === undefined) {
    const socket = createSocket();
    await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, 'localhost', resolve); });
    listenPort = socket.address().port;
    await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  }
  const requireWeb = createRequire(join(webRoot, 'package.json'));
  const { createServer } = await import(pathToFileURL(requireWeb.resolve('vite')).href);
  const server = await createServer({ root: webRoot, server: {
    host: 'localhost', port: listenPort, strictPort: port !== undefined,
  } });
  try { await server.listen(); }
  catch (error) { await server.close(); throw error; }
  return { url: server.resolvedUrls.local[0], close: () => server.close() };
}

export async function launchFirefox({ phone = false, reducedMotion = false, prefs = {} } = {}) {
  const { default: puppeteer } = await tool('puppeteer-core');
  return puppeteer.launch({ browser: 'firefox', executablePath: '/usr/bin/firefox', headless: true,
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    extraPrefsFirefox: {
      'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true,
      ...(phone ? { 'ui.primaryPointerCapabilities': 1, 'ui.allPointerCapabilities': 1 } : {}),
      ...(reducedMotion ? { 'ui.prefersReducedMotion': 1 } : {}), ...prefs,
    },
  });
}

export async function seedAndReload(page, { lang = 'ru', profile = {}, guitar } = {}) {
  // loadProfile() дополняет пустой Partial<Profile> всеми DEFAULTS из lib/profile.ts.
  const root = new URL('/', page.url());
  await page.goto(root.href, { waitUntil: 'load' });
  await page.evaluate(({ lang, profile, guitar }) => {
    localStorage.setItem('pupitre.lang.v1', lang);
    localStorage.setItem('pupitre.profile.v1', JSON.stringify(profile));
    if (guitar !== undefined) localStorage.setItem('pupitre.guitar.v1', JSON.stringify(guitar));
  }, { lang, profile, guitar });
  await page.reload({ waitUntil: 'load' });
}

// Допуск подключает сам сценарий; гитарные проверки по умолчанию строгие.
export const emojiWoff2Firefox = {
  id: 'emoji-woff2-firefox',
  why: 'дефект вокального UI до эпика: Firefox OTS отвергает emoji.woff2; системные эмодзи',
  // dev — /src/assets/emoji.woff2, production — /assets/emoji-<хеш>.woff2
  match: { type: 'pageerror', textIncludes: ['downloadable font', '"App Emoji"', 'emoji', '.woff2'] },
};

export function journal(page, { knownPreexisting = [] } = {}) {
  for (const defect of knownPreexisting) {
    if (!defect.id || !defect.why || !defect.match?.type ||
        !Array.isArray(defect.match.textIncludes) || !defect.match.textIncludes.length ||
        !defect.match.textIncludes.every(text => typeof text === 'string' && text.length)) {
      throw new Error('Известный дефект требует id, why, type и непустой список textIncludes');
    }
  }
  const entries = [];
  const record = entry => {
    const defect = knownPreexisting.find(defect => defect.match.type === entry.type &&
      defect.match.textIncludes.every(text => entry.text?.includes(text)));
    if (defect) {
      entry.knownPreexisting = defect.id;
      console.log(`KNOWN_PREEXISTING ${defect.id}: ${entry.text} (${defect.why})`);
    }
    entries.push(entry);
  };
  const handlers = {
    pageerror: error => record({ type: 'pageerror', text: error.message }),
    console: message => {
      if (['error', 'warn'].includes(message.type())) record({ type: message.type(), text: message.text() });
    },
    request: request => record({ type: 'request', method: request.method(), url: request.url() }),
    requestfailed: request => record({ type: 'requestfailed', url: request.url(), text: request.failure()?.errorText }),
  };
  for (const [event, handler] of Object.entries(handlers)) page.on(event, handler);
  return {
    all: () => entries.slice(),
    errors: () => entries.filter(e => !e.knownPreexisting && ['pageerror', 'error', 'requestfailed'].includes(e.type)),
    print: () => { for (const entry of entries) console.error(JSON.stringify(entry)); },
    detach: () => { for (const [event, handler] of Object.entries(handlers)) page.off(event, handler); },
  };
}

export async function shoot(page, path, { width, height }) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: false });
}

// Освобождение ресурсов входит в сценарий: итоговая строка всегда последняя.
// Строгий журнал по умолчанию: любая ошибка в журналах track() (pageerror, console.error, requestfailed), кроме
// разрешённых сценарием известных дефектов, проваливает сценарий. Нестрогий режим — только { lenient: '<причина>' }.
export async function scenario(run, { lenient } = {}) {
  if (lenient !== undefined && (typeof lenient !== 'string' || !lenient.trim())) throw new Error('lenient требует причину');
  const logs = [];
  try {
    await run((page, options) => { const log = journal(page, options); logs.push(log); return log; });
    const errors = logs.flatMap(log => log.errors());
    if (errors.length && !lenient) throw new Error(`Ошибки журнала (${errors.length}): ${errors.map(e => `${e.type}: ${e.text ?? e.url}`).join(' | ')}`);
    if (errors.length) console.log(`LENIENT (${lenient}): ошибок журнала ${errors.length}`);
    console.log('E2E_PASS');
  } catch (error) {
    for (const log of logs) log.print();
    console.log(`E2E_FAIL: ${error.message.replaceAll('\n', ' ')}`);
    process.exitCode = 1;
  }
}

// Размеры production-чанков, бюджет стартовых ресурсов и граница ленивой загрузки гитары.
// Стартовые ресурсы — то, что грузит dist/index.html: <script type="module">, <link rel="stylesheet">,
// <link rel="modulepreload">. Бюджеты (gz): входной JS ≤ baseline + 3072, входной CSS ≤ baseline + 1024,
// сумма стартовых ≤ baseline + 3072. Существующий baseline перезаписывается только с --write-baseline --force.
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve, relative, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = gatesRoot();
const dist = join(ROOT, 'apps/web/dist');
const baselinePath = join(ROOT, 'tools/gates/baselines/bundle.json');
const BUDGET = { js: 3072, css: 1024, start: 3072 };
// Следы гитарного раздела; в стартовых файлах их быть не должно ни в каком регистре.
const MARKERS = /alphatab|fretfall|rampa|inst-processor/gi;
const CSS_MARKERS = /\.rp-/gi;

// PUPITRE_GATES_ROOT подменяет корень только для tools/gates/selftest.mjs и только внутри его каталога.
function gatesRoot() {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const override = process.env.PUPITRE_GATES_ROOT;
  if (!override) return repo;
  const root = resolve(override), box = join(homedir(), '.cache/pupitre/gates/selftest');
  if (!root.startsWith(box + sep)) {
    console.error(`BUNDLE_FAIL: PUPITRE_GATES_ROOT вне ${box}: ${root}`);
    process.exit(1);
  }
  console.error(`[root] самопроверка: ${root}`);
  return root;
}
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
}
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
  return m ? m[1] ?? m[2] ?? m[3] : undefined;
}
// Путь стартового ресурса внутри dist; внешний адрес или выход за dist — ошибка.
function local(url) {
  if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(url)) throw Error(`Внешний стартовый ресурс: ${url}`);
  const file = resolve(dist, url.split(/[?#]/)[0].replace(/^\.?\//, ''));
  if (!file.startsWith(dist + sep)) throw Error(`Стартовый ресурс вне dist: ${url}`);
  if (!existsSync(file)) throw Error(`Стартовый ресурс отсутствует в dist: ${url}`);
  return relative(dist, file).split(sep).join('/');
}
// Старый формат (entry/entryGzip/chunks) читается как есть: CSS — сумма .css-чанков (тогда все они были
// стартовыми), сумма стартовых — JS + CSS (modulepreload в старом формате не было).
function readBaseline() {
  const b = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const int = (v, what) => {
    if (!Number.isSafeInteger(v) || v < 0) throw Error(`Некорректный baseline: ${what}`);
    return v;
  };
  const js = int(b.entryGzip, 'entryGzip');
  const derived = [];
  let css = b.cssGzip;
  if (css === undefined) {
    if (!Array.isArray(b.chunks)) throw Error('Некорректный baseline: chunks');
    css = b.chunks.filter(c => /\.css$/.test(c?.name ?? '')).reduce((a, c) => a + int(c.gzip, `chunks ${c.name}`), 0);
    derived.push('CSS = сумма .css из chunks');
  }
  css = int(css, 'cssGzip');
  let start = b.startGzip;
  if (start === undefined) {
    start = js + css + int(b.preloadGzip ?? 0, 'preloadGzip');
    derived.push('стартовые = JS + CSS');
  }
  if (derived.length) console.log(`baseline старого формата: ${derived.join('; ')}`);
  return { js, css, start: int(start, 'startGzip') };
}
const signed = n => (n >= 0 ? `+${n}` : `${n}`);

try {
  const args = process.argv.slice(2);
  const unknown = args.filter(a => a !== '--write-baseline' && a !== '--force');
  if (unknown.length) throw Error(`Неизвестный аргумент: ${unknown.join(' ')}`);
  const write = args.includes('--write-baseline');
  if (args.includes('--force') && !write) throw Error('--force — только вместе с --write-baseline');
  if (write && existsSync(baselinePath) && !args.includes('--force')) {
    throw Error('bundle.json уже есть: перезапись только с --write-baseline --force');
  }
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const markup = html.replace(/<!--[\s\S]*?-->/g, '');
  const start = { js: [], css: [], preload: [] };
  for (const [tag] of markup.matchAll(/<script\b[^>]*>/gi)) {
    const src = attr(tag, 'src');
    if (src && /^module$/i.test(attr(tag, 'type') ?? '')) start.js.push(local(src));
  }
  for (const [tag] of markup.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/), href = attr(tag, 'href');
    if (href && rel.includes('stylesheet')) start.css.push(local(href));
    if (href && rel.includes('modulepreload')) start.preload.push(local(href));
  }
  for (const kind of Object.keys(start)) start[kind] = [...new Set(start[kind])];
  if (!start.js.length) throw Error('В index.html не найден входной module script');
  const all = [...new Set([...start.js, ...start.css, ...start.preload])];

  const sizes = new Map();
  const measure = name => {
    if (!sizes.has(name)) {
      const bytes = readFileSync(join(dist, name));
      sizes.set(name, { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length });
    }
    return sizes.get(name);
  };
  const files = walk(dist).sort();
  const chunks = files.filter(f => /\.(js|css|wasm)$/.test(f)).map(f => {
    const name = relative(dist, f).split(sep).join('/');
    return { name, ...measure(name) };
  });
  const role = name => start.js.includes(name) ? 'вход JS' : start.css.includes(name) ? 'вход CSS'
    : start.preload.includes(name) ? 'modulepreload' : '';
  console.table(chunks.map(c => ({ ...c, старт: role(c.name) })));
  const sum = (list, key = 'gzip') => list.reduce((a, name) => a + measure(name)[key], 0);
  const now = { js: sum(start.js), css: sum(start.css), preload: sum(start.preload), start: sum(all) };

  const violations = [];
  let slice = null;
  try {
    const wasm = readFileSync(join(ROOT, 'apps/web/src/assets/dsp-inst.wasm'));
    slice = wasm.toString('base64').slice(0, 200);
    if (slice.length !== 200) throw Error('dsp-inst.wasm слишком короткий');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log('n/a (dsp-inst.wasm появится в этапе 14)');
  }
  for (const [name, text] of [['index.html', html], ...all.map(n => [n, readFileSync(join(dist, n), 'utf8')])]) {
    const found = new Set([...text.matchAll(MARKERS)].map(m => m[0].toLowerCase()));
    if (/\.(?:css|html)$/i.test(name)) for (const m of text.matchAll(CSS_MARKERS)) found.add(m[0].toLowerCase());
    for (const marker of found) violations.push(`${name} содержит маркер ${marker}`);
    if (slice && text.includes(slice)) violations.push(`dsp-inst.wasm встроен в ${name}`);
  }
  // Dev-стенды (#/guitar/_system, #/guitar/_dev/*) не должны попасть в production: ищем их маршруты и ссылки, а не
  // голое слово — у alphaTab есть своё поле this._system.
  const DEV_ROUTES = /path:\s*["'`]_(?:system["'`]|dev\/)|#\/guitar\/_(?:system|dev)\b/;
  for (const f of files) {
    const found = DEV_ROUTES.exec(readFileSync(f, 'latin1'));
    if (found) violations.push(`${relative(dist, f)} содержит dev-маршрут ${found[0]}`);
  }

  if (write) {
    if (violations.length) throw Error(`baseline не записан: ${violations.join('; ')}`);
    const data = {
      entry: start.js[0], entryGzip: now.js, entryRaw: sum(start.js, 'raw'),
      css: start.css, cssGzip: now.css, preload: start.preload, preloadGzip: now.preload, startGzip: now.start,
      chunks, date: new Date().toISOString(),
    };
    writeFileSync(`${baselinePath}.tmp`, JSON.stringify(data, null, 2) + '\n');
    renameSync(`${baselinePath}.tmp`, baselinePath);
    console.log(`baseline записан: JS ${now.js}, CSS ${now.css}, стартовые ${now.start} Б gz`);
  }
  const base = readBaseline();
  const delta = { js: now.js - base.js, css: now.css - base.css, start: now.start - base.start };
  const rows = [
    ['js', 'Входной JS', start.js.join(', ')],
    ['css', 'Входной CSS', start.css.join(', ') || '—'],
    ['start', 'Стартовые (JS+CSS+modulepreload)', `${all.length} файл(ов), modulepreload ${start.preload.length}`],
  ];
  for (const [key, what, names] of rows) {
    console.log(`${what}: ${names}; baseline=${base[key]} Б gz; сейчас=${now[key]} Б gz; Δ=${signed(delta[key])} Б; предел=+${BUDGET[key]} Б`);
    if (delta[key] > BUDGET[key]) violations.push(`Превышен бюджет: ${what} ${signed(delta[key])} Б > +${BUDGET[key]} Б`);
  }
  console.log(`Дельты (gz): JS ${signed(delta.js)} Б, CSS ${signed(delta.css)} Б, стартовые ${signed(delta.start)} Б`);
  if (violations.length) throw Error(`${violations.length} нарушений: ${violations.join('; ')}`);
  console.log('BUNDLE_OK');
} catch (e) { console.error(`BUNDLE_FAIL: ${e.message}`); process.exitCode = 1; }

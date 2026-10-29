// Единая политика для установленных зависимостей и реестров контента.
// Запуск: node tools/gates/check-licenses.mjs [--only npm|cargo|pip|content]. Чистые функции экспортируются для
// tools/gates/selftest-licenses.mjs; сам гейт выполняется только при прямом запуске файла.
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = gatesRoot();
const NPM_CHECKER_VERSION = '5.0.1';
const CARGO_DENY_VERSION = '0.20.2';
const policy = JSON.parse(readFileSync(join(ROOT, 'tools/gates/licenses-policy.json'), 'utf8'));
const allowed = new Set(policy.allow.map(x => x.spdx));
const rows = [], errors = [], inherited = new Set();
const aliases = {
  'MIT License': 'MIT', 'ISC License (ISCL)': 'ISC',
  'Apache Software License': 'Apache-2.0',
  'Mozilla Public License 2.0 (MPL 2.0)': 'MPL-2.0',
  'Python Software Foundation License': 'PSF-2.0', 'Unlicense license': 'Unlicense',
};
// Контент — файлы этих типов и всё под каталогами vendor/ (см. content()).
const CONTENT_FILE = /\.(?:woff2?|ttf|otf|sf2|sf3|wav|mp3|ogg|flac|onnx|nam|png|jpe?g|webp|svg|gif|ico)$/i;
const VENDOR_DIR = /(?:^|\/)vendor\//;
// Строгая схема записи контента: true — обязательное поле, false — необязательное.
const CONTENT_FIELDS = {
  id: true, kind: true, author: true, license: true, sha256: true,
  path: false, url: false, generator: false, parent: false, licenseText: false, version: false, note: false,
};
const CONTENT_KINDS = ['font', 'icons', 'bundled', 'soundfont', 'ir', 'model'];
const VENDOR_FIELDS = ['path', 'name', 'version', 'license', 'upstream', 'commit'];

// PUPITRE_GATES_ROOT подменяет корень только для tools/gates/selftest-licenses.mjs и только внутри его каталога.
function gatesRoot() {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const override = process.env.PUPITRE_GATES_ROOT;
  if (!override) return repo;
  const root = resolve(override), box = join(homedir(), '.cache/pupitre/gates/selftest');
  if (!root.startsWith(box + sep)) {
    console.error(`LICENSES_FAIL: PUPITRE_GATES_ROOT вне ${box}: ${root}`);
    process.exit(1);
  }
  console.error(`[root] самопроверка: ${root}`);
  return root;
}
function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || r.error) throw Error(`${cmd}: ${r.error?.message ?? r.status}\n${r.stderr ?? ''}\n${r.stdout ?? ''}`);
  return r.stdout;
}
function json(path) { return JSON.parse(readFileSync(join(ROOT, path), 'utf8')); }
function local(path) {
  if (typeof path !== 'string' || !path) throw Error('Пустой путь');
  const full = realpathSync(resolve(ROOT, path));
  if (!full.startsWith(ROOT + sep)) throw Error(`Путь вне репозитория: ${path}`);
  return full;
}
const sha256 = path => createHash('sha256').update(readFileSync(local(path))).digest('hex');
function normalize(value) {
  return String(value).replace(/\//g, ' OR ').split(';').map(s => aliases[s.trim()] ?? s.trim()).join(' AND ');
}
const deniedPatterns = policy.deny.map(pattern => new RegExp('^' + pattern
  .split('*').map(part => part.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i'));
// NC/ND — только отдельной частью идентификатора (CC-BY-NC-4.0, CC-BY-ND-4.0), а не буквами внутри (HPND, NCSA).
const deniedParts = new RegExp(`(^|[-+ (])(${policy.denyParts.join('|')})([-+ )]|$)`, 'i');
export const forbidden = value => String(value).split(/[\s();/]+/)
  .filter(token => token && !['AND', 'OR', 'WITH'].includes(token))
  .some(token => deniedPatterns.some(pattern => pattern.test(token)) || deniedParts.test(token));
// OR выбирает разрешённую ветку по порядку allow; AND сохраняет все обязательства.
// Проверяем запреты на листьях, чтобы GPL в невыбранной альтернативе не блокировал MIT.
export function selectExpression(value, accepts = () => true) {
  const tokens = value.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const identifier = token => typeof token === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(token) && !['AND', 'OR', 'WITH'].includes(token);
  function preferred(a, b) {
    if (!a) return b;
    if (!b) return a;
    const ranks = parts => parts.map(p => policy.allow.findIndex(x => x.spdx === p.base)).sort((x, y) => x - y);
    const ar = ranks(a), br = ranks(b);
    for (let n = 0; n < Math.min(ar.length, br.length); n++) {
      if (ar[n] !== br[n]) return ar[n] < br[n] ? a : b;
    }
    return ar.length <= br.length ? a : b;
  }
  function atom() {
    if (tokens[i] === '(') {
      i++; const result = or();
      if (tokens[i++] !== ')') throw Error('Незакрытая скобка SPDX');
      return result;
    }
    const base = tokens[i++];
    if (!identifier(base)) throw Error('Некорректный SPDX');
    let exception;
    if (tokens[i] === 'WITH') {
      i++; exception = tokens[i++];
      if (!identifier(exception)) throw Error('Некорректное исключение SPDX');
    }
    return allowed.has(base) && !forbidden(base) && accepts(base) ? [{ base, exception }] : null;
  }
  function and() {
    let result = atom();
    while (tokens[i] === 'AND') {
      i++; const next = atom();
      result = result && next ? [...result, ...next] : null;
    }
    return result;
  }
  function or() {
    let result = and();
    while (tokens[i] === 'OR') { i++; result = preferred(result, and()); }
    return result;
  }
  try { const result = or(); return i === tokens.length ? result : null; }
  catch { return null; }
}
// Вердикт по одной лицензии; context — только { vendored, modified, kind, own } (own — лишь у npm-манифеста приложения).
export function judge(source, name, version, raw, context = {}) {
  let license = normalize(Array.isArray(raw) ? raw.join(' AND ') : raw ?? 'UNKNOWN');
  const override = policy.overrides[`${source.split(':')[0]}:${name.toLowerCase()}`];
  if (override && override.version === version && override.original === raw && /^https:\/\//.test(override.url) && !forbidden(license)) license = override.spdx;
  const old = policy.preexisting.find(p => p.source === source && p.name === name.toLowerCase() && p.license === license);
  const selected = selectExpression(license, base => {
    if (base === 'MPL-2.0' && (context.vendored || context.modified)) return false;
    if (base === 'OFL-1.1' && context.kind !== 'font') return false;
    if (['CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-SA-3.0'].includes(base) && source !== 'content') return false;
    return true;
  });
  let verdict = selected ? 'OK' : 'DENY';
  if (old) verdict = 'PREEXISTING';
  if (context.own) verdict = 'OWN (не сторонний пакет)';
  return {
    source, name, version, license, verdict, preexisting: old?.name,
    выбрано: selected?.map(p => p.base + (p.exception ? ' WITH ' + p.exception : '')).join(' AND ') ?? '—',
  };
}
function record(source, name, version, raw, context) {
  const { preexisting, ...row } = judge(source, name, version, raw, context);
  if (preexisting) inherited.add(preexisting);
  rows.push(row);
  if (row.verdict.startsWith('DENY')) errors.push(`${source}: ${name}@${version}: ${row.license}`);
}
// Строгая схема записи content/content-licenses.json; бросает ошибку с причиной.
export function checkContentRecord(a, where = 'запись') {
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw Error(`${where}: ожидается объект`);
  if (Object.hasOwn(a, 'own')) throw Error(`${where}: поле own запрещено для контента (своё — не контент, а код или contentAllow)`);
  const unknown = Object.keys(a).filter(key => !Object.hasOwn(CONTENT_FIELDS, key));
  if (unknown.length) throw Error(`${where}: неизвестные поля ${unknown.join(', ')}`);
  for (const [field, required] of Object.entries(CONTENT_FIELDS)) {
    if (!Object.hasOwn(a, field)) {
      if (required) throw Error(`${where}: отсутствует ${field}`);
      continue;
    }
    if (typeof a[field] !== 'string' || !a[field].trim()) throw Error(`${where}: ${field} — непустая строка`);
  }
  if (!CONTENT_KINDS.includes(a.kind)) throw Error(`${where}: kind ${a.kind} не из ${CONTENT_KINDS.join('|')}`);
  if (!a.url && !a.generator) throw Error(`${where}: нужен url или generator`);
  if (a.url && !/^https:\/\//.test(a.url)) throw Error(`${where}: url — https://`);
  if (!/^[a-f0-9]{64}$/.test(a.sha256)) throw Error(`${where}: sha256 — 64 hex`);
}
// Шаблон пути contentAllow: ** — любые каталоги, * — часть имени без «/».
const globRegex = glob => new RegExp('^' + glob.replace(/[.+?^$\{\}()|[\]\\]/g, '\\$&')
  .replace(/\*\*\/|\*\*|\*/g, m => m === '**/' ? '(?:.*/)?' : m === '**' ? '.*' : '[^/]*') + '$');
function repoFiles() {
  const list = args => run('git', ['ls-files', '-z', ...args]).split('\0').filter(Boolean);
  // Удалённый, но ещё отслеживаемый файл в сборку не попадёт.
  return [...new Set([...list([]), ...list(['--others', '--exclude-standard'])])].filter(f => existsSync(join(ROOT, f))).sort();
}
function dependencyNames() {
  const names = new Set();
  for (const app of ['web', 'desktop']) {
    const path = join(ROOT, 'apps', app, 'package.json');
    if (existsSync(path)) for (const name of Object.keys(JSON.parse(readFileSync(path, 'utf8')).dependencies ?? {})) names.add(name);
  }
  return names;
}
function npm() {
  for (const app of ['web', 'desktop']) {
    const start = join(ROOT, 'apps', app);
    // Отсутствующая установка не должна давать ложный зелёный результат.
    const manifest = json(`apps/${app}/package.json`);
    const lock = json(`apps/${app}/package-lock.json`);
    for (const [path, pkg] of Object.entries(lock.packages)) {
      if (path && !pkg.dev && !pkg.optional && !existsSync(join(start, path, 'package.json'))) throw Error(`npm ci требуется в apps/${app}: отсутствует ${path}`);
    }
    const packages = JSON.parse(run('npx', ['--yes', `license-checker-rseidelsohn@${NPM_CHECKER_VERSION}`, '--production', '--json', '--start', start]));
    if (!Object.keys(packages).length) throw Error(`Пустой npm-отчёт: ${app}`);
    for (const [key, pkg] of Object.entries(packages)) {
      const at = key.lastIndexOf('@'), name = key.slice(0, at), version = key.slice(at + 1);
      record('npm:' + app, name, version, pkg.licenses, { own: name === manifest.name && version === manifest.version && resolve(pkg.path ?? '') === start });
    }
  }
}
function cargo() {
  let version;
  try { version = run('cargo', ['deny', '--version']).trim(); }
  catch { throw Error('Нужен cargo-deny 0.20.2 в PATH: cargo install --locked cargo-deny@0.20.2'); }
  if (version !== `cargo-deny ${CARGO_DENY_VERSION}`) throw Error(`Ожидался cargo-deny ${CARGO_DENY_VERSION}, получен ${version}`);
  for (const crate of ['dsp', 'native-audio']) {
    const manifest = `packages/${crate}/Cargo.toml`;
    const metadata = JSON.parse(run('cargo', ['metadata', '--locked', '--format-version', '1', '--manifest-path', manifest]));
    for (const p of metadata.packages) record('cargo:' + crate, p.name, p.version, p.license);
    // Сам cargo-deny также проверяет LICENSE-файлы и полный граф зависимостей.
    try { console.log(run('cargo', ['deny', '--manifest-path', manifest, 'check', 'licenses']).trim()); }
    catch (e) { errors.push(e.message); }
  }
}
function pip() {
  const binary = join(homedir(), '.cache/pupitre/tools/piplic/bin/pip-licenses');
  if (!existsSync(binary)) throw Error('Создайте отдельный venv ~/.cache/pupitre/tools/piplic и установите туда pip-licenses');
  const packages = JSON.parse(run(binary, ['--python', join(ROOT, 'services/api/.venv/bin/python'), '--format=json', '--with-urls', '--with-system']));
  if (!packages.length) throw Error('Пустой pip-отчёт');
  const seen = new Set();
  for (const p of packages) {
    const key = JSON.stringify([p.Name, p.Version, p.License]);
    // lib и lib64 могут ссылаться на одну установленную дистрибуцию.
    if (!seen.has(key)) record('pip', p.Name, p.Version, p.License);
    seen.add(key);
  }
}
function content() {
  const vendors = json('tools/gates/vendored.json');
  const assets = json('content/content-licenses.json');
  if (!Array.isArray(vendors) || !Array.isArray(assets)) throw Error('Реестры должны быть массивами');
  for (const [i, v] of vendors.entries()) {
    const extra = Object.keys(v).filter(key => !VENDOR_FIELDS.includes(key));
    if (extra.length) throw Error(`vendored[${i}]: неизвестные поля ${extra.join(', ')}`);
    for (const field of VENDOR_FIELDS) if (typeof v[field] !== 'string' || !v[field]) throw Error(`Вендор: отсутствует ${field}`);
    const path = local(v.path);
    for (const f of ['LICENSE', 'VENDOR.md']) if (!existsSync(join(path, f))) throw Error(`${v.path}: нет ${f}`);
    record('vendored', v.name, v.version, v.license, { vendored: true });
  }
  const ids = new Set(), byPath = new Map();
  for (const [i, a] of assets.entries()) {
    checkContentRecord(a, `content[${i}] ${a?.id ?? ''}`.trim());
    if (ids.has(a.id)) throw Error(`Повтор id: ${a.id}`);
    ids.add(a.id);
    if (a.path) {
      const hash = sha256(a.path);
      if (hash !== a.sha256) throw Error(`${a.id}: SHA-256 ожидался ${a.sha256}, получен ${hash}`);
      byPath.set(a.path, a.id);
    }
    if (a.licenseText) local(a.licenseText);
    // В вердикт идёт только kind: прочие поля записи (в т. ч. случайные флаги) на решение не влияют.
    record('content', a.id, a.version ?? '-', a.license, { kind: a.kind });
  }
  const deps = dependencyNames();
  for (const a of assets) if (a.parent && !ids.has(a.parent) && !deps.has(a.parent)) throw Error(`${a.id}: неизвестный parent ${a.parent} (ни запись контента, ни зависимость apps/*/package.json)`);
  console.log(`Реестры: vendored=${vendors.length}, content=${assets.length}`);

  // Сканирование: каждый файл контента учтён записью (path + sha256), вендором или исключением contentAllow.
  const allow = policy.contentAllow.map((entry, i) => {
    const extra = Object.keys(entry).filter(key => !['path', 'why'].includes(key));
    if (extra.length || typeof entry.path !== 'string' || !entry.path || typeof entry.why !== 'string' || !entry.why.trim())
      throw Error(`contentAllow[${i}]: нужны ровно path и why`);
    return { ...entry, regex: globRegex(entry.path), hits: 0 };
  });
  const files = repoFiles().filter(f => CONTENT_FILE.test(f) || VENDOR_DIR.test(f));
  const how = { запись: 0, вендор: 0, исключение: 0 }, undeclared = [];
  for (const file of files) {
    if (byPath.has(file)) how.запись++;
    else if (vendors.some(v => file.startsWith(v.path.replace(/\/$/, '') + '/'))) how.вендор++;
    else {
      const exempt = allow.find(entry => entry.regex.test(file));
      if (exempt) { exempt.hits++; how.исключение++; }
      else undeclared.push(file);
    }
  }
  for (const entry of allow) if (!entry.hits) errors.push(`contentAllow: неиспользуемое исключение ${entry.path} — удалите его`);
  for (const file of undeclared) errors.push(`content: незаявленный файл ${file} — запись в content/content-licenses.json или contentAllow`);
  console.table([how]);
  console.log(`content ${files.length - undeclared.length}/${files.length} учтено, ${undeclared.length} незаявленных`);
}
function main() {
  const args = process.argv.slice(2);
  try {
    const groups = { npm, cargo, pip, content };
    if (args.length && (args.length !== 2 || args[0] !== '--only' || !Object.hasOwn(groups, args[1]))) throw Error('Использование: --only npm|cargo|pip|content');
    if (policy.preexisting.length !== 6) throw Error('preexisting должен содержать ровно 6 записей');
    for (const [name, check] of Object.entries(groups)) {
      if (args.length && args[1] !== name) continue;
      try { check(); } catch (e) { errors.push(`${name}: ${e.message}`); }
    }
  } catch (e) { errors.push(e.message); }
  console.table(rows);
  console.log('preexisting — унаследовано от вокального режима (6 записей; не блокирует):');
  console.table(policy.preexisting.map(p => ({ ...p, detected: inherited.has(p.name) ? 'да' : 'заявлено политикой; не определено сканером' })));
  const denied = rows.filter(r => r.verdict.startsWith('DENY'));
  console.log(`Пакетов/записей: ${rows.length}; запрещённых: ${denied.length}; новых GPL/LGPL/AGPL: ${denied.filter(r => /(?:A?GPL|LGPL)/i.test(r.license)).length}; ошибок: ${errors.length}`);
  for (const error of errors) console.error(error);
  // Частичный прогон не выдаёт себя за полный.
  console.log(errors.length ? `LICENSES_FAIL: ${errors.length} ошибок` : args.length ? `LICENSES_PARTIAL_OK (${args.join(' ')})` : 'LICENSES_OK');
  process.exitCode = errors.length ? 1 : 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

// Консервативный grep: комментарии также не должны скрывать запрещённые API.
// Правила действуют во всём apps/web/src/guitar/**; исключения — только явные, в tools/gates/sources-allowlist.json:
// [{ "rule": "<правило>", "path": "apps/web/src/guitar/<файл>", "why": "<причина>" }]. Неиспользуемое исключение — нарушение.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = gatesRoot();
const SRC = join(ROOT, 'apps/web/src');
const base = join(SRC, 'guitar');
const ALLOWLIST = join(ROOT, 'tools/gates/sources-allowlist.json');
const RULES = {
  audio: /getUserMedia|AudioContext|OfflineAudioContext|AudioWorkletNode|decodeAudioData|enumerateDevices|createMediaStreamSource|createBufferSource/g,
  // fetch — только отдельным идентификатором: refetch( и prefetch( — не сеть.
  network: /apiFetch|listSongs|(?<![\w$])fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/g,
  // backdropFilter/WebkitBackdropFilter — тот же эффект из inline-стилей React.
  effects: /shadowBlur|backdrop-?filter/gi,
  // fonts.goog…/fonts.gstatic: голое «fonts.g» ловило бы и fonts.grace во fretfall.
  cdn: /googleapis|jsdelivr|unpkg|cdnjs|gstatic|esm\.sh|skypack|fonts\.g(?:oog|static)/gi,
  url: /https?:\/\/[^\s"'`<>()\\]*/gi,
};
// Имена пространств имён XML — идентификаторы, браузер по ним не ходит.
const XML_NAMESPACES = new Set([
  'http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink', 'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/XML/1998/namespace', 'http://www.w3.org/2000/xmlns/',
]);
// Сеть раздела — только клиент записей (инв. 9).
const NETWORK_CLIENT = 'apps/web/src/guitar/backend/recordingsClient.ts';
// Легаси — по разрешённому пути импорта, а не по имени файла (свой guitar/ui/styles.css можно).
const LEGACY_CSS = ['styles.css', 'components.css', 'landscape.css'].map(name => join(SRC, name));
const LEGACY_DIRS = ['components', 'screens'].map(dir => join(SRC, dir));
// Многострочные import/export, import(), require(), import.meta.glob() и CSS @import (в т. ч. url() без кавычек).
const IMPORT = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*|\bimport\.meta\.glob(?:Eager)?\s*\(\s*\[?\s*)(["'`])([^"'`]*)\1|@import\s*(?:url\(\s*)?["']?([^"'()\s;]+)/g;
const counts = { audio: 0, network: 0, legacy: 0, effects: 0, cdn: 0, url: 0, allowlist: 0 };

// PUPITRE_GATES_ROOT подменяет корень только для tools/gates/selftest.mjs и только внутри его каталога.
function gatesRoot() {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const override = process.env.PUPITRE_GATES_ROOT;
  if (!override) return repo;
  const root = resolve(override), box = join(homedir(), '.cache/pupitre/gates/selftest');
  if (!root.startsWith(box + sep)) {
    console.error(`SOURCES_FAIL: PUPITRE_GATES_ROOT вне ${box}: ${root}`);
    process.exit(1);
  }
  console.error(`[root] самопроверка: ${root}`);
  return root;
}
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
}
const posix = path => path.split(sep).join('/');
function loadAllowlist() {
  if (!existsSync(ALLOWLIST)) {
    console.log('allowlist: файла нет — исключений нет');
    return [];
  }
  const list = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
  if (!Array.isArray(list)) throw Error('allowlist: ожидается массив');
  const seen = new Set();
  return list.map((entry, i) => {
    const where = `allowlist[${i}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw Error(`${where}: ожидается объект`);
    const extra = Object.keys(entry).filter(key => !['rule', 'path', 'why'].includes(key));
    if (extra.length) throw Error(`${where}: лишние поля ${extra.join(', ')}`);
    if (!Object.hasOwn(counts, entry.rule) || entry.rule === 'allowlist') throw Error(`${where}: неизвестное правило ${entry.rule}`);
    if (typeof entry.path !== 'string' || !entry.path.startsWith('apps/web/src/guitar/') ||
        /[*?[\]{}\\]|\/\.{0,2}(?:\/|$)/.test(entry.path)) throw Error(`${where}: path — точный путь файла внутри apps/web/src/guitar/`);
    if (typeof entry.why !== 'string' || !entry.why.trim()) throw Error(`${where}: нужна причина why`);
    const key = `${entry.rule} ${entry.path}`;
    if (seen.has(key)) throw Error(`${where}: повтор ${key}`);
    seen.add(key);
    return { ...entry, hits: 0 };
  });
}
function resolveSpec(file, spec) {
  if (spec.startsWith('.')) return resolve(dirname(file), spec);
  const alias = spec.match(/^(?:@\/|~\/|\/src\/|apps\/web\/src\/)/);
  if (alias) return resolve(SRC, spec.slice(alias[0].length));
  if (spec.startsWith('/')) return resolve(ROOT, 'apps/web', spec.slice(1));
  return resolve(SRC, spec); // голый спецификатор — консервативно как путь от src
}
const isLegacy = target => LEGACY_CSS.some(css => target === css || `${target}.css` === css) ||
  LEGACY_DIRS.some(dir => target === dir || target.startsWith(dir + sep));

try {
  const allow = loadAllowlist();
  const files = existsSync(base) ? walk(base) : [];
  for (const file of files) {
    const name = posix(relative(ROOT, file));
    const code = readFileSync(file, 'utf8');
    function report(rule, offset, text) {
      const exempt = allow.find(entry => entry.rule === rule && entry.path === name);
      if (exempt) {
        exempt.hits++;
        return;
      }
      counts[rule]++;
      console.error(`${name}:${code.slice(0, offset).split('\n').length}: ${rule}: ${text}`);
    }
    for (const [rule, regex] of Object.entries(RULES)) {
      if (rule === 'network' && name === NETWORK_CLIENT) continue;
      for (const m of code.matchAll(regex)) {
        if (rule === 'url' && XML_NAMESPACES.has(m[0])) continue;
        report(rule, m.index, m[0]);
      }
    }
    for (const m of code.matchAll(IMPORT)) {
      const spec = (m[2] ?? m[3]).split(/\$\{|[?#*{[]/)[0];
      if (spec && isLegacy(resolveSpec(file, spec))) report('legacy', m.index, m[2] ?? m[3]);
    }
  }
  for (const entry of allow) {
    if (entry.hits) console.log(`исключение ${entry.rule}: ${entry.path} — ${entry.hits} совп. (${entry.why})`);
    else {
      counts.allowlist++;
      console.error(`allowlist: неиспользуемое исключение ${entry.rule} ${entry.path} — удалите его`);
    }
  }
  console.log(`Файлов просмотрено: ${files.length}`);
  console.table(counts);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(total ? `SOURCES_FAIL: ${total} нарушений` : 'SOURCES_OK');
  process.exitCode = total ? 1 : 0;
} catch (e) { console.error(`SOURCES_FAIL: ${e.message}`); process.exitCode = 1; }

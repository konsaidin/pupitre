// Самопроверка гейтов bundle-report, check-sources и check-vocal --write-hashes: синтетические случаи во временных
// корнях ~/.cache/pupitre/gates/selftest/gates/<случай> (PUPITRE_GATES_ROOT), у каждого — ожидаемый исход.
// Итог — GATES_SELFTEST n/n. Репозиторий не трогается: защищённые файлы копируются во временный корень.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATES = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(GATES, '../..');
const BOX = join(homedir(), '.cache/pupitre/gates/selftest/gates');
const results = [];

function fresh(name, files = {}) {
  const root = join(BOX, name);
  if (!resolve(root).startsWith(BOX + '/')) throw Error(`корень вне ${BOX}`);
  rmSync(root, { recursive: true, force: true });
  for (const [path, data] of Object.entries(files)) put(root, path, data);
  return root;
}
function put(root, path, data) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), data);
}
function gate(script, root, args = []) {
  const r = spawnSync(process.execPath, [join(GATES, script), ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PUPITRE_GATES_ROOT: root },
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}
function check(name, fn) {
  let ok = false, detail = '';
  try {
    const r = fn();
    ok = r === true || r?.ok === true;
    if (!ok && r?.out) detail = r.out.trim().split('\n').slice(-3).join(' | ');
  } catch (e) { detail = e.message; }
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const expect = (r, status, pattern) => ({ ok: r.status === status && pattern.test(r.out), out: r.out });

// Детерминированные несжимаемые байты: размер gz ≈ размеру.
function noise(bytes) {
  const out = Buffer.alloc(bytes);
  let x = 0x9e3779b9;
  for (let i = 0; i < bytes; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; out[i] = 33 + ((x >>> 0) % 90); }
  return out.toString('latin1').replace(/[<>&'"\\]/g, '_');
}
// Минимальный dist: вход JS + CSS (+ modulepreload) и baseline по ним же — без изменений бюджет 0/0/0.
function bundleRoot(name, { css = '', preload = null } = {}) {
  const js = 'console.log("vocal entry");\n', baseCss = 'body{margin:0}\n';
  const head = [
    '<script type="module" crossorigin src="/assets/index.js"></script>',
    '<link rel="stylesheet" crossorigin href="/assets/index.css">',
    ...(preload !== null ? ['<link rel="modulepreload" crossorigin href="/assets/vendor.js">'] : []),
  ].join('\n');
  const gz = s => gzipSync(Buffer.from(s), { level: 9 }).length;
  const baseline = { entry: 'assets/index.js', entryGzip: gz(js), cssGzip: gz(baseCss), startGzip: gz(js) + gz(baseCss), chunks: [] };
  return fresh(name, {
    'apps/web/dist/index.html': `<!doctype html><html><head>${head}</head><body></body></html>\n`,
    'apps/web/dist/assets/index.js': js,
    'apps/web/dist/assets/index.css': baseCss + css,
    ...(preload !== null ? { 'apps/web/dist/assets/vendor.js': preload } : {}),
    'tools/gates/baselines/bundle.json': JSON.stringify(baseline),
  });
}

check('bundle: контроль — без изменений BUNDLE_OK', () => expect(gate('bundle-report.mjs', bundleRoot('bundle-control')), 0, /BUNDLE_OK/));
check('bundle (а): входной CSS +200 КБ → провал', () =>
  expect(gate('bundle-report.mjs', bundleRoot('bundle-css', { css: `.x{content:"${noise(200 * 1024)}"}` })), 1, /Превышен бюджет: Входной CSS/));
check('bundle (б): .rampa и Rampa Sans во входном CSS → провал', () =>
  expect(gate('bundle-report.mjs', bundleRoot('bundle-rampa', { css: '.rampa{font-family:"Rampa Sans"}' })), 1, /index\.css содержит маркер rampa/));
check('bundle (б′): .rp- во входном CSS → провал', () =>
  expect(gate('bundle-report.mjs', bundleRoot('bundle-rp', { css: '.rp-btn{color:red}' })), 1, /index\.css содержит маркер \.rp-/));
check('bundle (в): modulepreload-чанк с маркером alphaTab → провал', () =>
  expect(gate('bundle-report.mjs', bundleRoot('bundle-preload', { preload: 'export const alphaTab = 1;\n' })), 1, /vendor\.js содержит маркер alphatab/));
check('bundle: dev-маршрут в чанке → провал', () => {
  const root = bundleRoot('bundle-devroute');
  put(root, 'apps/web/dist/assets/lazy.js', 'const r=[{path:"_dev/store",element:1}];');
  return expect(gate('bundle-report.mjs', root), 1, /lazy\.js содержит dev-маршрут/);
});
check('bundle: поле _system у alphaTab — не dev-маршрут', () => {
  const root = bundleRoot('bundle-alphatab-field');
  put(root, 'apps/web/dist/assets/lazy.js', 'class vm{constructor(A){r(this,"_system");this._system=A}}');
  return expect(gate('bundle-report.mjs', root), 0, /BUNDLE_OK/);
});
check('bundle: --write-baseline при существующем bundle.json без --force → отказ', () =>
  expect(gate('bundle-report.mjs', bundleRoot('bundle-write'), ['--write-baseline']), 1, /только с --write-baseline --force/));

const sources = (name, files) => gate('check-sources.mjs', fresh(name, files));
check('sources: контроль — пустой раздел SOURCES_OK', () => expect(sources('sources-control', { 'apps/web/src/guitar/ok.ts': 'export const a = 1;\n' }), 0, /SOURCES_OK/));
check('sources (г): backdrop-filter в guitar/ui/screens/x.css → провал', () =>
  expect(sources('sources-backdrop', { 'apps/web/src/guitar/ui/screens/x.css': '.a { backdrop-filter: blur(4px); }\n' }), 1, /x\.css:1: effects: backdrop-filter/));
check('sources (д): @import url(../../styles.css) → провал', () =>
  expect(sources('sources-import', { 'apps/web/src/guitar/ui/x.css': '@import url(../../styles.css);\n', 'apps/web/src/styles.css': '' }), 1, /x\.css:1: legacy/));
check('sources (е): refetch( и prefetch( → не провал', () =>
  expect(sources('sources-fetch', { 'apps/web/src/guitar/x.ts': 'refetch();\nprefetch(1);\nobj.refetch ();\n' }), 0, /SOURCES_OK/));
check('sources (е′): голый fetch( → провал', () =>
  expect(sources('sources-bare-fetch', { 'apps/web/src/guitar/x.ts': 'await fetch("/a");\n' }), 1, /network: fetch\(/));
check('sources (ж): https://example.com в guitar/** → провал', () =>
  expect(sources('sources-url', { 'apps/web/src/guitar/x.ts': 'const u = "https://example.com/a";\n' }), 1, /url: https:\/\/example\.com\/a/));

// check-vocal --write-hashes на копии защищённых файлов и файла хешей.
function vocalRoot(name) {
  const root = fresh(name);
  const list = spawnSync(process.execPath, [join(GATES, 'check-vocal.mjs'), '--list-protected'], { cwd: REPO, encoding: 'utf8' });
  if (list.status !== 0) throw Error(`--list-protected: ${list.stdout}${list.stderr}`);
  for (const path of list.stdout.trim().split('\n')) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(join(REPO, path), join(root, path));
  }
  mkdirSync(join(root, 'tools/gates/baselines'), { recursive: true });
  copyFileSync(join(REPO, 'tools/gates/baselines/vocal-protected.sha256'), join(root, 'tools/gates/baselines/vocal-protected.sha256'));
  return root;
}
check('vocal (з): --write-hashes без изменений → без перезаписи', () =>
  expect(gate('check-vocal.mjs', vocalRoot('vocal-same'), ['--write-hashes']), 0, /Без изменений: \d+ строк/));
check('vocal (з): изменённый защищённый файл → отказ с перечнем', () => {
  const root = vocalRoot('vocal-changed'), path = 'apps/web/src/test/recordingCtx.ts';
  const before = readFileSync(join(root, 'tools/gates/baselines/vocal-protected.sha256'), 'utf8');
  writeFileSync(join(root, path), readFileSync(join(root, path), 'utf8') + '\n// правка\n');
  const r = gate('check-vocal.mjs', root, ['--write-hashes']);
  const after = readFileSync(join(root, 'tools/gates/baselines/vocal-protected.sha256'), 'utf8');
  return { ok: r.status === 1 && r.out.includes(`${path}: `) && /Изменились защищённые файлы/.test(r.out) && before === after, out: r.out };
});
check('vocal (з): --rebless с причиной → перехеширование и строка в rebless.log', () => {
  const root = vocalRoot('vocal-rebless'), path = 'apps/web/src/test/recordingCtx.ts';
  writeFileSync(join(root, path), readFileSync(join(root, path), 'utf8') + '\n// правка\n');
  const r = gate('check-vocal.mjs', root, ['--write-hashes', '--rebless', path, '--reason', 'самопроверка гейта']);
  const log = existsSync(join(root, 'tools/gates/baselines/rebless.log')) ? readFileSync(join(root, 'tools/gates/baselines/rebless.log'), 'utf8') : '';
  return { ok: r.status === 0 && log.includes(`\t${path}\t`) && log.includes('самопроверка гейта'), out: r.out };
});
check('vocal (з): --rebless без --reason → отказ', () => {
  const root = vocalRoot('vocal-noreason'), path = 'apps/web/src/test/recordingCtx.ts';
  writeFileSync(join(root, path), readFileSync(join(root, path), 'utf8') + '\n// правка\n');
  return expect(gate('check-vocal.mjs', root, ['--write-hashes', '--rebless', path]), 1, /--rebless требует --reason/);
});
check('vocal: подменённый корень без --write-hashes → VOCAL_FAIL', () =>
  expect(gate('check-vocal.mjs', vocalRoot('vocal-run')), 1, /VOCAL_FAIL: arguments/));

const passed = results.filter(Boolean).length;
console.log(`GATES_SELFTEST ${passed}/${results.length}`);
process.exitCode = passed === results.length ? 0 : 1;

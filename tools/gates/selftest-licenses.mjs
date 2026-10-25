// Самопроверка гейта лицензий: синтетические случаи, у каждого — ожидаемый исход. Итог — LICENSES_SELFTEST n/n.
// Выражения SPDX и схема записи проверяются чистыми функциями гейта; сканирование контента — запуском гейта на
// временном корне в ~/.cache/pupitre/gates/selftest/licenses (git init + свои файлы), не на репозитории.
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkContentRecord, forbidden, judge } from './check-licenses.mjs';

const GATE = join(dirname(fileURLToPath(import.meta.url)), 'check-licenses.mjs');
const POLICY = join(dirname(fileURLToPath(import.meta.url)), 'licenses-policy.json');
const BOX = join(homedir(), '.cache/pupitre/gates/selftest/licenses');
const results = [];

function check(name, fn) {
  let ok = false, detail = '';
  try { ok = fn() === true; } catch (e) { detail = e.message; }
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const throws = (fn, pattern) => {
  try { fn(); } catch (e) { return pattern.test(e.message); }
  return false;
};
const record = (extra = {}) => ({
  id: 'probe', kind: 'font', author: 'Pupitre', license: 'OFL-1.1', sha256: 'a'.repeat(64), url: 'https://example.com/', ...extra,
});

// Временный корень: политика репозитория без contentAllow (его пути — файлы репозитория), пустой вендор, свои файлы.
function gateOn(name, files, assets) {
  const root = join(BOX, name);
  if (!resolve(root).startsWith(BOX + '/')) throw Error(`корень вне ${BOX}`);
  rmSync(root, { recursive: true, force: true });
  const policy = { ...JSON.parse(readFileSync(POLICY, 'utf8')), contentAllow: [] };
  const write = (path, data) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), data); };
  write('tools/gates/licenses-policy.json', JSON.stringify(policy));
  write('tools/gates/vendored.json', '[]');
  for (const [path, data] of Object.entries(files)) write(path, data);
  write('content/content-licenses.json', JSON.stringify(assets.map(a => ({
    ...a, sha256: createHash('sha256').update(files[a.path]).digest('hex'),
  }))));
  const git = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
  if (git.status !== 0) throw Error(`git init: ${git.stderr}`);
  const r = spawnSync(process.execPath, [GATE, '--only', 'content'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PUPITRE_GATES_ROOT: root },
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}
const FONT = { id: 'Probe Sans', kind: 'font', path: 'apps/web/a.woff2', author: 'Pupitre', license: 'OFL-1.1', url: 'https://example.com/' };

check('HPND → OK (маска ND не задевает)', () => !forbidden('HPND') && judge('npm:web', 'x', '1.0.0', 'HPND').verdict === 'OK');
check('NCSA → OK (маска NC не задевает)', () => !forbidden('NCSA') && judge('cargo:dsp', 'x', '1.0.0', 'NCSA').verdict === 'OK');
check('CC-BY-NC-4.0 → запрет маской', () => forbidden('CC-BY-NC-4.0') && judge('content', 'x', '-', 'CC-BY-NC-4.0', { kind: 'font' }).verdict === 'DENY');
check('CC-BY-ND-4.0 → запрет маской', () => forbidden('CC-BY-ND-4.0') && judge('content', 'x', '-', 'CC-BY-ND-4.0', { kind: 'font' }).verdict === 'DENY');
check('MIT OR GPL-3.0 → OK, выбрано MIT', () => {
  const row = judge('npm:web', 'x', '1.0.0', 'MIT OR GPL-3.0');
  return row.verdict === 'OK' && row.выбрано === 'MIT';
});
check('MIT AND GPL-3.0 → запрет', () => judge('npm:web', 'x', '1.0.0', 'MIT AND GPL-3.0').verdict === 'DENY');
check('OFL-1.1 не для шрифта → запрет', () => judge('content', 'x', '-', 'OFL-1.1', { kind: 'icons' }).verdict === 'DENY');
check('запись content с неизвестным ключом → ошибка схемы', () => throws(() => checkContentRecord(record({ licence: 'MIT' })), /неизвестные поля licence/));
check('own: true в content → ошибка', () => throws(() => checkContentRecord(record({ own: true })), /own запрещено/));
check('запись content без url и generator → ошибка', () => {
  const { url, ...bare } = record();
  return throws(() => checkContentRecord(bare), /url или generator/);
});
check('корректная запись content проходит схему', () => { checkContentRecord(record()); return true; });
check('чистый корень → LICENSES_PARTIAL_OK, content 1/1', () => {
  const r = gateOn('clean', { 'apps/web/a.woff2': 'font' }, [FONT]);
  return r.status === 0 && r.out.includes('content 1/1 учтено, 0 незаявленных') && r.out.includes('LICENSES_PARTIAL_OK (--only content)');
});
check('незаявленный foo.woff2 → провал', () => {
  const r = gateOn('undeclared', { 'apps/web/a.woff2': 'font', 'apps/web/src/foo.woff2': 'x' }, [FONT]);
  return r.status === 1 && r.out.includes('незаявленный файл apps/web/src/foo.woff2') && r.out.includes('content 1/2 учтено, 1 незаявленных');
});
check('файл под vendor/ без записи вендора → провал', () => {
  const r = gateOn('vendor', { 'apps/web/a.woff2': 'font', 'apps/web/src/guitar/vendor/x/lib.js': 'export {}' }, [FONT]);
  return r.status === 1 && r.out.includes('незаявленный файл apps/web/src/guitar/vendor/x/lib.js');
});
check('SHA-256 записи не совпадает с файлом → провал', () => {
  const r = gateOn('hash', { 'apps/web/a.woff2': 'font' }, [FONT]);
  writeFileSync(join(BOX, 'hash/apps/web/a.woff2'), 'changed');
  const again = spawnSync(process.execPath, [GATE, '--only', 'content'], {
    cwd: join(BOX, 'hash'), encoding: 'utf8', env: { ...process.env, PUPITRE_GATES_ROOT: join(BOX, 'hash') },
  });
  return r.status === 0 && again.status === 1 && /SHA-256 ожидался/.test(`${again.stdout}${again.stderr}`);
});

const passed = results.filter(Boolean).length;
console.log(`LICENSES_SELFTEST ${passed}/${results.length}`);
process.exitCode = passed === results.length ? 0 : 1;

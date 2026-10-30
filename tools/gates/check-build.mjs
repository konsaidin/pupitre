// Сборка с восстановлением отслеживаемых файлов (кэш TypeScript, вокальный dsp.wasm) даже при ошибке и прерывании.
// Копии — в ~/.cache/pupitre/gates/backup/ (manifest.json пишется последним: есть манифест — есть полная копия).
// Копия, оставшаяся от прерванного запуска, восстанавливается при старте гейта до всего остального.
// SIGINT/SIGTERM не обрывают гейт: ставят флаг, текущий шаг завершается, затем восстановление и BUILD_FAIL.
// Шаги запускаются асинхронно: при spawnSync цикл событий стоит и обработчик сигнала не успевает сработать.
import { copyFileSync, readFileSync, renameSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const web = join(ROOT, 'apps/web');
// Модули ядра packages/dsp (npm run build:dsp): анализ и гитарный процессор; пересборка должна дать те же байты.
const WASM = {
  'dsp.wasm': '075376c0928172da203ea1e27436baec210a7537ca873c06ba0adefe906d478b',
  'tone.wasm': '50ad459050dc75ef39ee3054849eeeefc1a57acf8e103493c03d81d824d5240e',
};
const wasmPath = (name) => join(web, 'src/assets', name);
const hash = b => createHash('sha256').update(b).digest('hex');
// Свой каталог на каждое дерево (основное, worktree): копия не восстановится в чужое.
const BACKUP = join(homedir(), '.cache/pupitre/gates/backup', hash(ROOT).slice(0, 12));
const MANIFEST = join(BACKUP, 'manifest.json');
const TRACKED = { 'tsconfig.tsbuildinfo': join(web, 'tsconfig.tsbuildinfo'), ...Object.fromEntries(Object.keys(WASM).map((n) => [n, wasmPath(n)])) };
let interrupted = null;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (!interrupted) console.error(`[check-build] ${signal}: доделываю шаг и восстанавливаю файлы`);
  interrupted ??= signal;
});
async function run(command, args, cwd = ROOT, env = process.env) {
  if (interrupted) throw Error(`прервано ${interrupted}`);
  const r = await new Promise(done => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    child.on('error', error => done({ error }));
    child.on('exit', (status, signal) => done({ status, signal }));
  });
  if (interrupted) throw Error(`прервано ${interrupted}`);
  if (r.error || r.status !== 0) throw Error(`${command} ${args.join(' ')}: ${r.error?.message ?? r.signal ?? r.status}`);
}
// Возвращает файлы к копии; что изменилось — в отчёт. Копия удаляется только после успешного восстановления.
function restore() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  if (manifest.root !== ROOT) throw Error(`копия от другого дерева: ${manifest.root}`);
  if (manifest.pid !== process.pid && alive(manifest.pid)) throw Error(`идёт другой check-build (pid ${manifest.pid})`);
  const changed = [];
  for (const [name, path] of Object.entries(TRACKED)) {
    const entry = manifest.files[name];
    if (!entry) throw Error(`манифест без ${name}`);
    const now = existsSync(path) ? hash(readFileSync(path)) : null;
    if (!entry.existed) {
      if (now !== null) { unlinkSync(path); changed.push(`${name}: удалён (до сборки его не было)`); }
      continue;
    }
    const copy = readFileSync(join(BACKUP, name));
    if (hash(copy) !== entry.sha256) throw Error(`копия ${name} повреждена`);
    if (now !== entry.sha256) {
      writeFileSync(path, copy);
      changed.push(`${name}: ${now ?? 'отсутствовал'} -> ${entry.sha256}`);
    }
  }
  unlinkSync(MANIFEST);
  for (const name of Object.keys(TRACKED)) if (existsSync(join(BACKUP, name))) unlinkSync(join(BACKUP, name));
  return changed;
}
// Живой процесс с тем же pid после перезагрузки — не повод отказываться: смотрим, что это check-build (Linux /proc).
function alive(pid) {
  try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('check-build'); } catch { return false; }
}
function backup() {
  mkdirSync(BACKUP, { recursive: true });
  const files = {};
  for (const [name, path] of Object.entries(TRACKED)) {
    if (!existsSync(path)) { files[name] = { existed: false }; continue; }
    copyFileSync(path, join(BACKUP, name));
    files[name] = { existed: true, sha256: hash(readFileSync(path)) };
  }
  writeFileSync(`${MANIFEST}.tmp`, JSON.stringify({ root: ROOT, pid: process.pid, files }, null, 2) + '\n');
  renameSync(`${MANIFEST}.tmp`, MANIFEST);
}

let failure;
if (existsSync(MANIFEST)) {
  try {
    const changed = restore();
    console.log(`[check-build] копия от прерванного запуска восстановлена: ${changed.length ? changed.join('; ') : 'файлы уже совпадали'}`);
  } catch (e) { failure = `восстановление копии от прерванного запуска: ${e.message} (копия оставлена в ${BACKUP})`; }
}
if (!failure) {
  let backedUp = false;
  try {
    const before = Object.fromEntries(Object.keys(WASM).map((n) => [n, existsSync(wasmPath(n)) ? hash(readFileSync(wasmPath(n))) : 'нет файла']));
    for (const [name, expected] of Object.entries(WASM))
      if (before[name] !== expected) throw Error(`${name}: ожидается ${expected}, до сборки ${before[name]}`);
    backup();
    backedUp = true;
    await run('npm', ['run', 'build:dsp'], web);
    for (const [name, expected] of Object.entries(WASM)) {
      const actual = hash(readFileSync(wasmPath(name)));
      if (actual !== expected) throw Error(`${name}: до ${before[name]}, после ${actual}, ожидается ${expected}`);
    }
    await run('npx', ['tsc', '-b'], web);
    await run('npx', ['vite', 'build'], web, { ...process.env, VITE_PUPITRE_GUITAR: '1' });
    for (const script of ['bundle-report', 'check-sources', 'check-disk']) await run(process.execPath, [`tools/gates/${script}.mjs`]);
  } catch (e) { failure = e.message; }
  finally {
    if (backedUp) {
      try {
        const changed = restore();
        // Не оставляем повреждённый вокальный WASM даже после неудачной сборки.
        const wasmChanged = changed.find(line => line.startsWith('dsp.wasm'));
        if (wasmChanged) failure = `${failure ?? 'Изменён dsp.wasm'}; восстановлен ${wasmChanged}`;
      } catch (e) { failure = `${failure ?? ''}; восстановление: ${e.message} (копия оставлена в ${BACKUP})`; }
    }
  }
}
if (interrupted && !failure) failure = `прервано ${interrupted}`;
console.log(failure ? `BUILD_FAIL: ${failure}` : 'BUILD_OK');
process.exitCode = failure ? 1 : 0;

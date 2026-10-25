// ВОКАЛ-ОК: защищённые файлы и регрессионные проверки вокального тракта.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = gatesRoot();
const WEB = join(ROOT, 'apps/web');
const BASELINE = join(ROOT, 'tools/gates/baselines/vocal-protected.sha256');
const REBLESS_LOG = join(ROOT, 'tools/gates/baselines/rebless.log');

// PUPITRE_GATES_ROOT подменяет корень только для tools/gates/selftest.mjs и только внутри его каталога.
function gatesRoot() {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const override = process.env.PUPITRE_GATES_ROOT;
  if (!override) return repo;
  const root = resolve(override), box = join(homedir(), '.cache/pupitre/gates/selftest');
  if (!root.startsWith(box + sep)) {
    console.log(`VOCAL_FAIL: PUPITRE_GATES_ROOT вне ${box}: ${root}`);
    process.exit(1);
  }
  console.error(`[root] самопроверка: ${root}`);
  return root;
}
const PROTECTED = [
  'apps/web/src/audio/voiceGolden.test.ts',
  'apps/web/src/game/engine.golden.test.ts',
  'apps/web/src/test/recordingCtx.ts',
  'apps/web/src/test/recordingGraphCtx.ts',
  'apps/web/src/game/engine.golden2.test.ts',
  ...readdirSync(join(ROOT, 'apps/web/src/game/__golden2__'))
    .filter(name => name.endsWith('.json')).sort()
    .map(name => `apps/web/src/game/__golden2__/${name}`),
  'apps/web/src/audio/__golden__/voice-wasm-44100.bin',
  'apps/web/src/audio/__golden__/voice-wasm-48000.bin',
  'apps/web/src/audio/__golden__/voice-wasm-96000.bin',
  'apps/web/src/game/__golden__/ab-loop.json',
  'apps/web/src/game/__golden__/finish-summary.json',
  'apps/web/src/game/__golden__/guide-metronome.json',
  'apps/web/src/game/__golden__/hit-and-miss.json',
  'apps/web/src/game/__golden__/line-target.json',
  'apps/web/src/game/__golden__/pause-resume.json',
  'apps/web/src/game/__golden__/seek.json',
  'apps/web/src/game/__golden__/url-backing.json',
  'apps/web/src/game/__golden__/vibrato-tech.json',

  'apps/web/src/audio/dsp.test.ts',
  'apps/web/src/game/engine.test.ts',
  'apps/web/src/game/octave.test.ts',
  'apps/web/src/game/scoring.test.ts',
  'apps/web/src/lib/api.test.ts',
  'apps/web/src/lib/music.test.ts',
  'apps/web/src/lib/pitchline.test.ts',
  'apps/web/src/lib/profile.test.ts',
  'apps/web/src/lib/timeline.test.ts',
  'apps/web/src/test/fakeAudio.ts',
  'apps/web/src/test/setup.ts',
  'apps/web/e2e/vibrato-exercise.ts',
  'apps/web/e2e/ribbon.cjs',
  'apps/web/e2e/live-tract.cjs',
  'packages/dsp/tests/synthetic.rs',
  'apps/desktop/e2e/native-audio-main.js',
  'apps/desktop/e2e/native-audio-page.html',
  'packages/dsp/tests/voice_golden.rs',
  'packages/dsp/tests/golden/voice-44100.bin',
  'packages/dsp/tests/golden/voice-48000.bin',
  'packages/dsp/tests/golden/voice-96000.bin',
  'packages/dsp/tests/voice_golden_edge.rs',
  'packages/dsp/tests/golden/voice-edge-44100.bin',
  'packages/dsp/tests/golden/voice-edge-48000.bin',
  'packages/dsp/tests/golden/voice-edge-96000.bin',
];

function log(step, message) {
  for (const line of String(message).trimEnd().split(/\r?\n/)) {
    console.log(`[${step}] ${line}`);
  }
}

function hashes() {
  return new Map([...PROTECTED].sort().map(path => [
    path, createHash('sha256').update(readFileSync(join(ROOT, path))).digest('hex'),
  ]));
}

// Строгий разбор файла хешей «<sha256>  <путь>»; порядок строк сохраняется.
function readSaved(required = true) {
  const saved = new Map();
  if (!required && !existsSync(BASELINE)) return saved;
  const text = readFileSync(BASELINE, 'utf8');
  if (!text.trim()) return saved;
  for (const line of text.trimEnd().split('\n')) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match || saved.has(match[2])) throw new Error(`Некорректная строка хешей: ${line}`);
    saved.set(match[2], match[1]);
  }
  return saved;
}

// Append-only: новые пути дописываются в конец; изменённый хеш существующей строки — отказ с перечнем, кроме
// --rebless <путь> --reason "<текст>" (строка в rebless.log: дата, путь, старый и новый хеш, причина).
// Лишние строки не удаляются — их покажет обычная проверка.
function writeHashes(rebless, reason) {
  const actual = hashes();
  const saved = readSaved(false);
  const chosen = new Set(rebless.map(path => relative(ROOT, resolve(ROOT, path)).split(sep).join('/')));
  const errors = [];
  for (const path of chosen) {
    if (!actual.has(path)) errors.push(`--rebless ${path}: не защищённый файл`);
    else if (!saved.has(path)) errors.push(`--rebless ${path}: строки нет — новый путь дописывается без --rebless`);
    else if (saved.get(path) === actual.get(path)) errors.push(`--rebless ${path}: хеш не изменился`);
  }
  if (chosen.size && !reason?.trim()) errors.push('--rebless требует --reason "<текст>"');
  const changed = [...actual].filter(([path, hash]) => saved.has(path) && saved.get(path) !== hash && !chosen.has(path));
  if (changed.length) {
    errors.push('Изменились защищённые файлы (перехеширование — только --rebless <путь> --reason "<текст>"):');
    for (const [path, hash] of changed) errors.push(`  ${path}: ${saved.get(path)} -> ${hash}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  const added = [...actual.keys()].filter(path => !saved.has(path));
  const extra = [...saved.keys()].filter(path => !actual.has(path));
  if (extra.length) log('hashes', `Лишние строки остаются (append-only): ${extra.join(', ')}`);
  if (!added.length && !chosen.size) {
    log('hashes', `Без изменений: ${saved.size} строк`);
    return;
  }
  const lines = [...saved].map(([path, hash]) => `${chosen.has(path) ? actual.get(path) : hash}  ${path}`)
    .concat(added.map(path => `${actual.get(path)}  ${path}`));
  const temp = `${BASELINE}.tmp`;
  mkdirSync(dirname(BASELINE), { recursive: true });
  writeFileSync(temp, lines.join('\n') + '\n');
  try {
    if (chosen.size) {
      // Журнал — до подмены файла хешей: перехеширования без записи в журнале не бывает.
      const date = new Date().toISOString(), why = reason.replace(/\s+/g, ' ').trim();
      const header = existsSync(REBLESS_LOG) ? '' : '# дата\tпуть\tстарый хеш\tновый хеш\tпричина\n';
      appendFileSync(REBLESS_LOG, header + [...chosen]
        .map(path => [date, path, saved.get(path), actual.get(path), why].join('\t') + '\n').join(''));
    }
    renameSync(temp, BASELINE);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
  log('hashes', `Дописано ${added.length}, перехешировано ${chosen.size}, было строк ${saved.size}`);
}

function parseArgs(argv) {
  const flags = new Set(), rebless = [], problems = [];
  let reason;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i], eq = arg.indexOf('=');
    const key = arg.startsWith('--') && eq > 0 ? arg.slice(0, eq) : arg;
    if (key === '--rebless' || key === '--reason') {
      const value = key === arg ? argv[++i] : arg.slice(eq + 1);
      if (value === undefined || (key === arg && value.startsWith('--'))) problems.push(`${key}: нужно значение`);
      else if (key === '--rebless') rebless.push(value);
      else reason = value;
    } else if (['--browser', '--write-hashes', '--list-protected'].includes(arg)) flags.add(arg);
    else problems.push(`Неизвестный аргумент: ${arg}`);
  }
  if ((rebless.length || reason !== undefined) && !flags.has('--write-hashes')) {
    problems.push('--rebless и --reason — только вместе с --write-hashes');
  }
  if (reason !== undefined && !rebless.length) problems.push('--reason без --rebless');
  return { flags, rebless, reason, problems };
}

function checkHashes() {
  const actual = hashes();
  const saved = readSaved();
  const errors = [];
  for (const [path, hash] of actual) {
    if (!saved.has(path)) errors.push(`Нет хеша: ${path}`);
    else if (saved.get(path) !== hash) errors.push(`Изменён: ${path}`);
  }
  for (const path of saved.keys()) {
    if (!actual.has(path)) errors.push(`Лишний хеш: ${path}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  log('hashes', `${actual.size} файлов совпадают`);
}

function run(step, command, args, cwd = ROOT) {
  log(step, `${command} ${args.join(' ')}`);
  if (command === 'npx.cmd') {
    // Windows не исполняет .cmd при shell:false; запускаем его JS-точку входа.
    const lookup = spawnSync('where.exe', ['npx.cmd'], { encoding: 'utf8', shell: false });
    if (lookup.error) throw lookup.error;
    const cli = (lookup.stdout ?? '').trim().split(/\r?\n/)
      .map(path => join(dirname(path), 'node_modules/npm/bin/npx-cli.js'))
      .find(path => existsSync(path));
    if (!cli) throw new Error('Не найдена JS-точка входа npx.cmd');
    command = process.execPath;
    args = [cli, ...args];
  }
  const result = spawnSync(command, args, {
    cwd, shell: false, stdio: 'pipe', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    // Проверка никогда не должна переписывать эталоны из-за окружения вызывающего.
    env: { ...process.env, GOLDEN_WRITE: '0' },
  });
  if (result.stdout) log(step, result.stdout);
  if (result.stderr) log(step, result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`exit=${result.status}, signal=${result.signal}`);
}

const { flags, rebless, reason, problems } = parseArgs(process.argv.slice(2));
if (problems.length) {
  log('arguments', problems.join('; '));
  console.log('VOCAL_FAIL: arguments');
  process.exit(1);
}
if (flags.has('--list-protected')) {
  for (const path of [...PROTECTED].sort()) console.log(path);
  process.exit(0);
}
if (flags.has('--write-hashes')) {
  try {
    writeHashes(rebless, reason);
    process.exit(0);
  } catch (error) {
    log('hashes', error.message);
    console.log('VOCAL_FAIL: hashes');
    process.exit(1);
  }
}
if (process.env.PUPITRE_GATES_ROOT) {
  // Подменённый корень — только для самопроверки записи хешей, ВОКАЛ-ОК в нём не выдаётся.
  log('arguments', 'В подменённом корне доступны только --write-hashes и --list-protected');
  console.log('VOCAL_FAIL: arguments');
  process.exit(1);
}

const failed = [];
function step(name, check) {
  log(name, 'START');
  try {
    check();
    log(name, 'OK');
  } catch (error) {
    failed.push(name);
    log(name, `FAIL: ${error.message}`);
  }
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
step('hashes', checkHashes);
step('vitest', () => run('vitest', npx, ['vitest', 'run'], WEB));
step('vibrato', () => {
  const output = join(tmpdir(), `pupitre-vibrato-${process.pid}.mjs`);
  try {
    run('vibrato', npx, [
      'esbuild', 'e2e/vibrato-exercise.ts', '--bundle', '--format=esm', '--platform=node',
      '--banner:js=globalThis.localStorage={getItem:()=>null,setItem:()=>{}};',
      `--outfile=${output}`,
    ], WEB);
    run('vibrato', process.execPath, [output]);
  } finally {
    if (existsSync(output)) unlinkSync(output);
  }
});
step('cargo', () => run('cargo', 'cargo', ['test', '--manifest-path', 'packages/dsp/Cargo.toml']));
if (flags.has('--browser')) {
  log('browser', 'SKIPPED (ribbon.cjs: устаревший селектор с 3174d86, заменён vocal-ribbon.mjs)');
  step('vocal-ribbon.mjs', () => run('vocal-ribbon.mjs', process.execPath, ['apps/web/e2e/vocal-ribbon.mjs']));
  step('live-tract.cjs', () => run('live-tract.cjs', process.execPath, ['apps/web/e2e/run-legacy.mjs', 'live-tract.cjs']));
}
console.log(failed.length ? `VOCAL_FAIL: ${failed.join(', ')}` : 'VOCAL_OK');
process.exitCode = failed.length ? 1 : 0;

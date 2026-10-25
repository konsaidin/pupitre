// Мутации применяются исключительно к отдельным копиям вне рабочего дерева.
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = join(root, 'packages/dsp');
const cache = join(homedir(), '.cache/pupitre');
const copies = join(cache, 'mutants');
mkdirSync(copies, { recursive: true });
const mutations = [
  ['yin-threshold', 'yin.rs', 'const THRESHOLD: f32 = 0.15;', 'const THRESHOLD: f32 = 0.16;'],
  ['yin-rms', 'yin.rs', 'const RMS_FLOOR: f32 = 0.002;', 'const RMS_FLOOR: f32 = 0.0021;'],
  ['octave', 'smooth.rs', 'const OCTAVE_ACCEPT_MS: f32 = 85.0;', 'const OCTAVE_ACCEPT_MS: f32 = 90.0;'],
  ['vibrato-depth', 'vibrato.rs', 'const ACTIVE_DEPTH_CENTS: f32 = 18.0;', 'const ACTIVE_DEPTH_CENTS: f32 = 19.0;'],
  ['vibrato-regularity', 'vibrato.rs', 'const ACTIVE_REGULARITY: f32 = 0.45;', 'const ACTIVE_REGULARITY: f32 = 0.46;'],
  ['vibrato-off', 'vibrato.rs', 'const OFF_STREAK: u32 = 15;', 'const OFF_STREAK: u32 = 16;'],
  ['distortion-off', 'distortion.rs', 'const OFF_SCORE: f32 = 0.3;', 'const OFF_SCORE: f32 = 0.31;'],
];

function copy(id) {
  const destination = mkdtempSync(join(copies, `dsp-${id}-`));
  // cp -r, но target/ не копируем. Новая директория исключает остатки старых запусков.
  const entries = readdirSync(source).filter(name => name !== 'target');
  const result = spawnSync('cp', ['-r', ...entries.map(name => join(source, name)), destination], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
  return destination;
}

function test(directory) {
  const result = spawnSync('cargo', ['test', '--manifest-path', join(directory, 'Cargo.toml'), '--test', 'voice_golden_edge'], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GOLDEN_WRITE: '0', CARGO_TARGET_DIR: join(cache, 'cargo-target/mutants') },
  });
  if (result.error || result.signal) throw result.error ?? new Error(`cargo signal=${result.signal}`);
  return { status: result.status, output: result.stdout + result.stderr };
}

try {
  const control = test(copy('control'));
  if (control.status !== 0) throw new Error(`CONTROL_FAIL\n${control.output}`);
  console.log('CONTROL_OK');
  const survivors = [];
  for (const [id, file, before, after] of mutations) {
    const directory = copy(id);
    const path = join(directory, 'src', file);
    const lines = readFileSync(path, 'utf8').split('\n');
    if (lines.filter(line => line === before).length !== 1) {
      throw new Error(`${id}: ожидалась ровно одна точная строка: ${before}`);
    }
    writeFileSync(path, lines.map(line => line === before ? after : line).join('\n'));
    const result = test(directory);
    if (result.status === 0) {
      survivors.push(id);
      console.log(`SURVIVED ${id}`);
    } else if (result.status === 101 && /test voice_golden_edge_matches \.\.\. FAILED/.test(result.output)
        && /поле .*ожидаемое=.*полученное=/.test(result.output)) {
      console.log(`KILLED ${id}: ${result.output.split('\n').find(line => line.includes('ожидаемое='))}`);
    } else {
      throw new Error(`${id}: ошибка вместо расхождения с эталоном\n${result.output}`);
    }
  }
  console.log(`MUTANTS_KILLED ${mutations.length - survivors.length}/${mutations.length}`);
  if (survivors.length) {
    console.error(`SURVIVORS: ${survivors.join(', ')}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`MUTANTS_ERROR: ${error.message}`);
  process.exitCode = 1;
}

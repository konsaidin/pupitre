#!/usr/bin/env node
// Сборка движка: cargo build --release --features addon → pupitre-engine.<platform>-<arch>.node (рядом с крейтом).
// node build.mjs --test — cargo test (без N-API) с тем же окружением.
//
// Linux: jack-sys требует от pkg-config «jack» даже при загрузке libjack во время работы (dynamic_loading). Свой
// .jack-shim/jack.pc — без Libs: pkg-config доволен, а libjack не попадает в NEEDED .node (грузится при открытии
// клиента; нет JACK — аддон всё равно загружается, движок отвечает NO_ENGINE). Shim стоит первым в PKG_CONFIG_PATH,
// поэтому и при установленном jack-devel линковки с libjack нет.
// Цели — в общем ~/.cache/pupitre/cargo-target (01-architecture §8.1: диск занят, target/ — гигабайты).

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
// Ввод-вывод движка — JACK (Linux); Windows (WASAPI) — этап 48 плана: там сборка пропускается, рендерер на браузере.
if (process.platform !== 'linux') {
  console.log(`[engine] пропуск: движок пока только для Linux (${process.platform})`);
  process.exit(0);
}
const test = process.argv.includes('--test');
const env = { ...process.env, CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR ?? path.join(os.homedir(), '.cache/pupitre/cargo-target') };

if (process.platform === 'linux') {
  const shim = path.join(dir, '.jack-shim');
  fs.mkdirSync(shim, { recursive: true });
  fs.writeFileSync(
    path.join(shim, 'jack.pc'),
    'Name: jack\nDescription: shim: libjack загружается при открытии клиента (jack dynamic_loading)\nVersion: 1.9.22\nLibs:\nCflags:\n',
  );
  env.PKG_CONFIG_PATH = shim + (env.PKG_CONFIG_PATH ? `:${env.PKG_CONFIG_PATH}` : '');
}

if (test) {
  execSync('cargo test', { cwd: dir, stdio: 'inherit', env });
  process.exit(0);
}

execSync('cargo build --release --features addon', { cwd: dir, stdio: 'inherit', env: { ...env, CARGO_INCREMENTAL: '0' } });

const libName = {
  linux: 'libpupitre_engine.so',
  darwin: 'libpupitre_engine.dylib',
  win32: 'pupitre_engine.dll',
}[process.platform];
const out = `pupitre-engine.${process.platform}-${process.arch}.node`;
fs.copyFileSync(path.join(env.CARGO_TARGET_DIR, 'release', libName), path.join(dir, out));
console.log('[engine] готово:', out);

// Один и тот же способ сборки WASM на Linux и Windows. Тулчейн — из rust-toolchain.toml (его понимает только rustup):
// cargo из ~/.cargo/bin, если он есть, идёт раньше системного (у системного Rust дистрибутива может не быть wasm32).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(dir, 'target');
const rustup = path.join(os.homedir(), '.cargo', 'bin');
const env = existsSync(rustup) ? { ...process.env, PATH: `${rustup}${path.delimiter}${process.env.PATH ?? ''}` } : process.env;
// Два модуля из одного крейта: dsp.wasm — анализ (входной чанк веба), tone.wasm — гитарный процессор (гитарный чанк).
for (const [features, name] of [[[], 'dsp.wasm'], [['--no-default-features', '--features', 'tone'], 'tone.wasm']]) {
  execFileSync('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', ...features,
    '--target-dir', target, '--manifest-path', path.join(dir, 'Cargo.toml')], {stdio: 'inherit', env});
  copyFileSync(path.join(target, 'wasm32-unknown-unknown/release/pupitre_dsp.wasm'),
    path.resolve(dir, '../../apps/web/src/assets', name));
}

// Один и тот же способ сборки WASM на Linux и Windows.
import { execFileSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(dir, 'target');
execFileSync('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown',
  '--target-dir', target, '--manifest-path', path.join(dir, 'Cargo.toml')], {stdio: 'inherit'});
copyFileSync(path.join(target, 'wasm32-unknown-unknown/release/pupitre_dsp.wasm'),
  path.resolve(dir, '../../apps/web/src/assets/dsp.wasm'));

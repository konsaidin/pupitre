#!/usr/bin/env node
// Сборка нативного аддона: cargo build --release → pupitre-native-audio.<platform>-<arch>.node
//
// Linux без alsa-devel: alsa-sys нужен лишь pkg-config для -lasound (биндинги
// предгенерены), поэтому при отсутствии alsa.pc собираем локальный shim —
// alsa.pc + симлинк libasound.so на системную libasound.so.2. Правильный
// долгосрочный фикс — поставить alsa-devel; shim тогда просто не создаётся.
//
// macOS: --arch x64|arm64 — аддон под другую архитектуру того же мака (cargo
// --target): пакет для мака собирается под обе (npm run dist:mac). Нижняя
// версия системы — как у Electron 33 (macOS 11).

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const env = { ...process.env };

if (process.platform === 'linux') {
  let hasAlsa = true;
  try {
    execSync('pkg-config --exists alsa', { stdio: 'ignore' });
  } catch {
    hasAlsa = false;
  }
  if (!hasAlsa) {
    const sysLib = ['/usr/lib64/libasound.so.2', '/usr/lib/x86_64-linux-gnu/libasound.so.2', '/usr/lib/libasound.so.2']
      .find((p) => fs.existsSync(p));
    if (!sysLib) {
      console.error('нет ни alsa-devel (alsa.pc), ни libasound.so.2 — установите alsa-devel/libasound2-dev');
      process.exit(1);
    }
    const shim = path.join(dir, '.alsa-shim');
    fs.mkdirSync(shim, { recursive: true });
    const link = path.join(shim, 'libasound.so');
    if (!fs.existsSync(link)) fs.symlinkSync(sysLib, link);
    fs.writeFileSync(
      path.join(shim, 'alsa.pc'),
      `libdir=${shim}\nincludedir=/usr/include\n\nName: alsa\nDescription: local shim over system libasound\nVersion: 1.2.0\nLibs: -L\${libdir} -lasound\nCflags:\n`,
    );
    env.PKG_CONFIG_PATH = shim + (env.PKG_CONFIG_PATH ? `:${env.PKG_CONFIG_PATH}` : '');
    console.log('[native-audio] alsa-devel не найден — использую shim', shim);
  }
}

const archAt = process.argv.indexOf('--arch');
const arch = archAt > 0 ? process.argv[archAt + 1] : process.arch;
const TRIPLES = { 'darwin-x64': 'x86_64-apple-darwin', 'darwin-arm64': 'aarch64-apple-darwin' };
const triple = arch === process.arch ? null : TRIPLES[`${process.platform}-${arch}`];
if (triple === undefined) {
  console.error(`[native-audio] сборка под ${arch} на ${process.platform}-${process.arch} не поддерживается`);
  process.exit(1);
}
if (process.platform === 'darwin') env.MACOSX_DEPLOYMENT_TARGET ??= '11.0';
if (triple) execSync(`rustup target add ${triple}`, { stdio: 'inherit' });

execSync(`cargo build --release${triple ? ` --target ${triple}` : ''}`, { cwd: dir, stdio: 'inherit', env });

const libName = {
  linux: 'libpupitre_native_audio.so',
  darwin: 'libpupitre_native_audio.dylib',
  win32: 'pupitre_native_audio.dll',
}[process.platform];
const out = `pupitre-native-audio.${process.platform}-${arch}.node`;
fs.copyFileSync(path.join(dir, 'target', ...(triple ? [triple] : []), 'release', libName), path.join(dir, out));
console.log('[native-audio] готово:', out);

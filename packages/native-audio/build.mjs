#!/usr/bin/env node
// Сборка нативного аддона: cargo build --release → pupitre-native-audio.<platform>-<arch>.node
//
// Linux без alsa-devel: alsa-sys нужен лишь pkg-config для -lasound (биндинги
// предгенерены), поэтому при отсутствии alsa.pc собираем локальный shim —
// alsa.pc + симлинк libasound.so на системную libasound.so.2. Правильный
// долгосрочный фикс — поставить alsa-devel; shim тогда просто не создаётся.

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

execSync('cargo build --release', { cwd: dir, stdio: 'inherit', env });

const libName = {
  linux: 'libpupitre_native_audio.so',
  darwin: 'libpupitre_native_audio.dylib',
  win32: 'pupitre_native_audio.dll',
}[process.platform];
const out = `pupitre-native-audio.${process.platform}-${process.arch}.node`;
fs.copyFileSync(path.join(dir, 'target', 'release', libName), path.join(dir, out));
console.log('[native-audio] готово:', out);

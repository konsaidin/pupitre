// Локальная проверка: требуется рабочее устройство ввода.
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
try {
  const build = spawnSync(process.execPath, ['packages/native-audio/build.mjs'], { cwd: ROOT, stdio: 'inherit' });
  if (build.error || build.status !== 0) throw Error(`Сборка native-audio: ${build.error?.message ?? build.status}`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync('npx', ['electron', 'e2e/native-audio-main.js'], { cwd: join(ROOT, 'apps/desktop'), env, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  const output = (r.stdout ?? '') + (r.stderr ?? '');
  process.stdout.write(output);
  if (r.error || r.status !== 0 || !/^E2E_PASS\b/m.test(output)) throw Error(`Electron e2e не прошёл; требуется доступное устройство ввода и графическая сессия. ${r.error?.message ?? 'exit=' + r.status}`);
  console.log('NATIVE_OK');
} catch (e) { console.error(`NATIVE_FAIL: ${e.message}`); process.exitCode = 1; }

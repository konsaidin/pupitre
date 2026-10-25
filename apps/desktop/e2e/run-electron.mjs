// Запуск Electron-сценария гитарного раздела на свежей production-сборке веба с VITE_PUPITRE_GUITAR=1 и base './'
// (file://). Сборка — в ~/.cache/pupitre/e2e/electron-web, рабочая dist-web пакета не трогается.
// --dev-build — сборка в режиме development (есть dev-стенды #/guitar/_dev/*), каталог electron-web-dev.
// node apps/desktop/e2e/run-electron.mjs <сценарий-main.js> [--no-build] [--dev-build]
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, '..');
const web = resolve(desktop, '../web');
const [main, ...flags] = process.argv.slice(2);
const dev = flags.includes('--dev-build');
const out = join(homedir(), '.cache/pupitre/e2e', dev ? 'electron-web-dev' : 'electron-web');
if (!main) {
  console.error('Использование: node apps/desktop/e2e/run-electron.mjs <сценарий-main.js> [--no-build]');
  process.exit(2);
}
if (!flags.includes('--no-build') || !existsSync(join(out, 'index.html'))) {
  rmSync(out, { recursive: true, force: true });
  const mode = dev ? 'development' : 'production';
  const build = spawnSync('npx', ['vite', 'build', '--mode', mode, '--outDir', out, '--emptyOutDir'], {
    cwd: web, stdio: 'inherit', env: { ...process.env, VITE_PUPITRE_GUITAR: '1', NODE_ENV: mode },
  });
  if (build.status !== 0) {
    console.log('E2E_FAIL: сборка веба не удалась');
    process.exit(1);
  }
}
const env = { ...process.env, PUPITRE_WEB_DIR: out };
delete env.ELECTRON_RUN_AS_NODE;
const r = spawnSync('npx', ['electron', resolve(main)], { cwd: desktop, env, stdio: 'inherit', timeout: 180000 });
process.exitCode = r.status ?? 1;

// Сборка фронта для npm run dev с гитарным разделом (VITE_PUPITRE_GUITAR=1): десктоп в разработке берёт свежий фронт, а
// не старую apps/web/dist. Переменная окружения — из Node (одинаково в Linux и Windows). Релизные pack/dist раздел не
// включают (флаг в desktop.yml), им этот скрипт не нужен.
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
// саундфонт синт-минуса гитары (≈ 40 МБ, не в git) — до сборки: vite копирует public/ в dist
execSync(`node ${JSON.stringify(join(web, '..', '..', 'tools', 'soundfont', 'fetch.mjs'))}`, { stdio: 'inherit' });
execSync('npm run build', { cwd: web, stdio: 'inherit', env: { ...process.env, VITE_PUPITRE_GUITAR: '1' } });

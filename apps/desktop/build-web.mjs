// Сборка фронта для десктопа (npm run dev, CI): саундфонт синт-минуса, затем vite build. Гитарный раздел включён по
// умолчанию; флаг ниже — явный, на случай VITE_PUPITRE_GUITAR=0 в окружении.
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
// саундфонт синт-минуса гитары (≈ 40 МБ, не в git) — до сборки: vite копирует public/ в dist
execSync(`node ${JSON.stringify(join(web, '..', '..', 'tools', 'soundfont', 'fetch.mjs'))}`, { stdio: 'inherit' });
execSync('npm run build', { cwd: web, stdio: 'inherit', env: { ...process.env, VITE_PUPITRE_GUITAR: '1' } });

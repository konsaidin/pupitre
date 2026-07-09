// Копирует собранный фронт (apps/web/dist) внутрь десктоп-пакета (dist-web).
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'web', 'dist');
const dst = join(here, 'dist-web');

if (!existsSync(join(src, 'index.html'))) {
  console.error('apps/web/dist не найден — сначала собери фронт: npm run build в apps/web');
  process.exit(1);
}
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
console.log('dist-web обновлён из apps/web/dist');

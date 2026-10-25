import { statfsSync, lstatSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
function size(path) {
  const s = lstatSync(path);
  return s.isDirectory() ? readdirSync(path).reduce((n, f) => n + size(join(path, f)), 0) : s.size;
}
try {
  const s = statfsSync('/home', { bigint: true });
  const free = s.bavail * s.bsize;
  console.log(`Свободно на /home: ${(Number(free) / 1024 ** 3).toFixed(2)} ГиБ (${free} Б); минимум 8 ГиБ`);
  if (free < 8n * 1024n ** 3n) {
    console.error('DISK_LOW');
    for (const name of ['cargo-target', 'shots', 'reports']) {
      const path = join(homedir(), '.cache/pupitre', name);
      console.log(`Можно чистить ${name === 'cargo-target' ? 'кэш' : 'старые файлы'}: ${path}: ${existsSync(path) ? (size(path) / 1024 ** 3).toFixed(2) + ' ГиБ' : 'нет'}`);
    }
    process.exitCode = 1;
  } else console.log('DISK_OK');
} catch (e) { console.error(`DISK_FAIL: ${e.message}`); process.exitCode = 1; }

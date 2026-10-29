// Саундфонты синт-минуса гитары — MuseScore General 0.2 (MIT, apps/web/public/licenses/MuseScore_General-MIT.md, ≈ 40 МБ)
// и кит ударных AVL Black Pearl 4 (CC BY-SA 3.0, apps/web/public/licenses/AVL-Drumkits.md, ≈ 19 МБ): в git не хранятся.
// Скачивает в apps/web/public/soundfonts те, которых нет или у которых sha256 не тот. Без сети — предупреждение и выход 0:
// сборка остаётся рабочей на встроенном SONiVOX и его ударных.
// Запуск: node tools/soundfont/fetch.mjs (вызывают apps/desktop/build-web.mjs и npm run dev веба)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILES = [
  {
    name: 'MuseScore_General.sf3',
    url: 'https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3',
    sha256: '5b85b6c2c61d10b2b91cddd41efcce7b25cd31c8271d511c73afafbef20b6fa3',
    fallback: 'минус будет на встроенном SONiVOX',
  },
  {
    name: 'Black_Pearl_4_LV2.sf2',
    url: 'https://www.bandshed.net/sounds/AVLDrumkits_SF2/Black_Pearl_4_LV2.sf2',
    sha256: 'e0542ec19f2816ef4e0d00aeb087e7aa311e888d6f4805f971688bb267c6d405',
    fallback: 'ударные будут из саундфонта',
  },
];
const dir = join(dirname(fileURLToPath(import.meta.url)), '../../apps/web/public/soundfonts');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

for (const file of FILES) {
  const target = join(dir, file.name);
  if (existsSync(target) && sha(readFileSync(target)) === file.sha256) {
    console.log(`[soundfont] ${file.name} на месте`);
    continue;
  }
  try {
    console.log(`[soundfont] скачиваю ${file.url}`);
    const res = await fetch(file.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (sha(bytes) !== file.sha256) throw new Error('sha256 не совпал');
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${target}.part`, bytes);
    renameSync(`${target}.part`, target);
    console.log(`[soundfont] ${file.name}: ${(bytes.length / 1e6).toFixed(1)} МБ`);
  } catch (e) {
    console.warn(`[soundfont] ${file.name} не скачался (${e.message}) — ${file.fallback}`);
  }
}

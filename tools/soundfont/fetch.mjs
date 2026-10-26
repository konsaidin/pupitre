// Саундфонт синт-минуса гитары — MuseScore General 0.2 (MIT, apps/web/public/licenses/MuseScore_General-MIT.md):
// ≈ 40 МБ, в git не хранится. Скачивает в apps/web/public/soundfonts, если файла нет или sha256 не тот. Без сети —
// предупреждение и выход 0: сборка остаётся рабочей на встроенном SONiVOX.
// Запуск: node tools/soundfont/fetch.mjs (вызывает apps/desktop/build-web.mjs)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_SF = 'https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3';
const SHA256 = '5b85b6c2c61d10b2b91cddd41efcce7b25cd31c8271d511c73afafbef20b6fa3';
const target = join(dirname(fileURLToPath(import.meta.url)), '../../apps/web/public/soundfonts/MuseScore_General.sf3');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

if (existsSync(target) && sha(readFileSync(target)) === SHA256) {
  console.log('[soundfont] на месте');
} else {
  try {
    console.log(`[soundfont] скачиваю ${URL_SF}`);
    const res = await fetch(URL_SF);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (sha(bytes) !== SHA256) throw new Error('sha256 не совпал');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(`${target}.part`, bytes);
    renameSync(`${target}.part`, target);
    console.log(`[soundfont] готово: ${(bytes.length / 1e6).toFixed(1)} МБ`);
  } catch (e) {
    console.warn(`[soundfont] не скачался (${e.message}) — минус будет на встроенном SONiVOX`);
  }
}

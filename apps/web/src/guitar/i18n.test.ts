// Полнота словаря раздела: статический скан t('…') во всех исходниках src/guitar (кроме вендора и тестов) — у каждого
// ключа есть русский перевод (RU N/N), и в GUITAR_RU нет ключей, которые никто не использует.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RU } from '../lib/i18n';
import { GUITAR_RU } from './i18n';

const ROOT = new URL('.', import.meta.url).pathname;
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'vendor' || e.name.startsWith('__') ? [] : sources(path);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') ? [path] : [];
  });
}
// t('…') и t("…") с литералом первым аргументом; ключи из таблиц — строки label/short, которые потом идут в t().
const CALL = /\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
const TABLE = /\b(?:label|short):\s*(['"])((?:\\.|(?!\1).)*)\1/g;
const unescape = (s: string) => s.replace(/\\(['"\\])/g, '$1');

describe('словарь гитарного раздела', () => {
  const files = sources(ROOT);
  const used = new Set<string>();
  for (const file of files) {
    const code = readFileSync(file, 'utf8');
    for (const m of code.matchAll(CALL)) used.add(unescape(m[2]));
    for (const m of code.matchAll(TABLE)) used.add(unescape(m[2]));
  }

  it(`RU N/N: у каждого ключа t() есть перевод (файлов ${files.length})`, () => {
    // общие строки оболочки «Рампы» (голос и гитара) живут в основном словаре lib/i18n
    const missing = [...used].filter((key) => !Object.hasOwn(GUITAR_RU, key) && !Object.hasOwn(RU, key));
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(10);
    console.log(`RU ${used.size}/${used.size}`);
  });

  it('в словаре нет неиспользуемых ключей', () => {
    expect(Object.keys(GUITAR_RU).filter((key) => !used.has(key))).toEqual([]);
  });
});

// Разбор партитуры alphaTab (ScoreLoader.loadScoreFromBytes). GP3–5 хранят строки в кодировке системы автора: без явной
// кодировки пробуем UTF-8, а при «�» в названиях — windows-1251 и windows-1252 и берём вариант с меньшим числом «�»
// (при равенстве — с меньшим числом слов смешанного письма) с предупреждением encoding-guess. Явная кодировка — ручной
// выбор в окне импорта (этап 12b). Ударные с ID артикуляций GP7 вместо индексов чинятся здесь же (drums.ts) —
// предупреждение drum-ids.
import * as alphaTab from '@coderline/alphatab';
import { fixDrumArticulationIds } from './drums';
import type { ImportWarning, ScoreFormat } from '../model/types';

export const ENCODINGS = ['utf-8', 'windows-1251', 'windows-1252', 'koi8-r'] as const;
export type ScoreEncoding = (typeof ENCODINGS)[number];

export interface ParsedScore {
  score: alphaTab.model.Score;
  settings: alphaTab.Settings;
  encoding: ScoreEncoding;
  warnings: ImportWarning[];
}

/** Тексты партитуры, по которым видно кодировку: шапка, дорожки, секции. */
export function scoreTexts(score: alphaTab.model.Score): string[] {
  const texts = [score.title, score.subTitle, score.artist, score.album, score.words, score.music, score.copyright, score.tab, score.instructions, score.notices];
  for (const track of score.tracks) texts.push(track.name, track.shortName);
  for (const bar of score.masterBars) if (bar.section) texts.push(bar.section.text, bar.section.marker);
  return texts.filter((t): t is string => typeof t === 'string' && t.length > 0);
}

const REPLACEMENT = /�/g;
// Слово, где латиница соседствует с кириллицей («Cafй»), или три подряд буквы Latin-1 («Ïðè») — признак чужой кодировки.
const MIXED = /\p{L}*(?:[A-Za-z][Ѐ-ӿ]|[Ѐ-ӿ][A-Za-z])\p{L}*|[À-ÿ]{3,}/gu;
/** Меньше — правдоподобнее: [число «�», число подозрительных слов]. */
export function implausibility(texts: readonly string[]): [number, number] {
  const all = texts.join('\n');
  return [all.match(REPLACEMENT)?.length ?? 0, all.match(MIXED)?.length ?? 0];
}

function load(bytes: Uint8Array, encoding: ScoreEncoding) {
  const settings = new alphaTab.Settings();
  settings.importer.encoding = encoding;
  return { score: alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings), settings };
}

export function parseScore(bytes: Uint8Array, format: ScoreFormat, opts: { encoding?: ScoreEncoding } = {}): ParsedScore {
  const parsed = parseText(bytes, format, opts);
  const drums = fixDrumArticulationIds(parsed.score);
  if (drums) parsed.warnings.push({ code: 'drum-ids', detail: 'ноты ударных ссылались на ID артикуляций GP7, а не на индексы — переведены', count: drums });
  return parsed;
}

function parseText(bytes: Uint8Array, format: ScoreFormat, opts: { encoding?: ScoreEncoding }): ParsedScore {
  if (opts.encoding) return { ...load(bytes, opts.encoding), encoding: opts.encoding, warnings: [] };
  const first = load(bytes, 'utf-8');
  const legacy = format === 'gp3' || format === 'gp4' || format === 'gp5';
  if (!legacy || implausibility(scoreTexts(first.score))[0] === 0) return { ...first, encoding: 'utf-8', warnings: [] };
  let best = { ...first, encoding: 'utf-8' as ScoreEncoding, rank: implausibility(scoreTexts(first.score)) };
  for (const encoding of ['windows-1251', 'windows-1252'] as const) {
    const next = load(bytes, encoding);
    const rank = implausibility(scoreTexts(next.score));
    if (rank[0] < best.rank[0] || (rank[0] === best.rank[0] && rank[1] < best.rank[1])) best = { ...next, encoding, rank };
  }
  const { rank, ...chosen } = best;
  return {
    ...chosen,
    warnings: [{ code: 'encoding-guess', detail: `${chosen.encoding}: «�» ${rank[0]}, подозрительных слов ${rank[1]}` }],
  };
}

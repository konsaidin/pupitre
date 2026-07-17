// Утилиты для работы с контуром высоты извлечённого вокала.

import type { MapNote, Pitchline } from './songMap';

/** перепад соседних сэмплов контура, сквозь который не интерполируем:
 *  голос так не движется за один hop — это октавный срыв в данных */
const CONTOUR_BREAK_SEMIS = 6;

/** Интерполированная высота контура в момент ms (null — тишина/вне данных). */
export function contourMidiAt(line: Pitchline, ms: number): number | null {
  const f = ms / line.hopMs;
  const i0 = Math.floor(f);
  if (i0 < 0 || i0 >= line.midi.length) return null;
  const a = line.midi[i0];
  if (a === null) return null;
  const b = i0 + 1 < line.midi.length ? line.midi[i0 + 1] : null;
  if (b === null || Math.abs(b - a) >= CONTOUR_BREAK_SEMIS) return a;
  return a + (b - a) * (f - i0);
}

/**
 * Виртуальные «фразы» для режима «петь по линии»: озвученные участки контура,
 * длинные — порезаны на куски ~maxChunkMs. Скоринг/комбо/вердикты считаются
 * по ним как по нотам, но целью при матчинге остаётся сам контур.
 * midi фразы — медиана участка (для октавной свёртки и окна ролла).
 */
export function contourSegments(
  line: Pitchline,
  maxChunkMs = 2000,
  minSegMs = 200,
): MapNote[] {
  const out: MapNote[] = [];
  let runStart = -1;

  const flush = (endIdx: number) => {
    if (runStart < 0) return;
    const startIdx = runStart;
    runStart = -1;
    const durMs = (endIdx - startIdx) * line.hopMs;
    if (durMs < minSegMs) return;
    const chunks = Math.max(1, Math.ceil(durMs / maxChunkMs));
    const perChunk = (endIdx - startIdx) / chunks;
    for (let c = 0; c < chunks; c++) {
      const a = startIdx + Math.round(c * perChunk);
      const b = c === chunks - 1 ? endIdx : startIdx + Math.round((c + 1) * perChunk);
      const vals = line.midi.slice(a, b).filter((v): v is number => v !== null).sort((x, y) => x - y);
      if (vals.length === 0) continue;
      out.push({
        startMs: Math.round(a * line.hopMs),
        durMs: Math.round((b - a) * line.hopMs),
        midi: Math.round(vals[(vals.length - 1) >> 1]),
      });
    }
  };

  for (let i = 0; i < line.midi.length; i++) {
    if (line.midi[i] === null) flush(i);
    else if (runStart < 0) runStart = i;
  }
  flush(line.midi.length);
  return out;
}

// Утилиты для работы с контуром высоты извлечённого вокала.

import type { Pitchline } from './songMap';

/** Интерполированная высота контура в момент ms (null — тишина/вне данных). */
export function contourMidiAt(line: Pitchline, ms: number): number | null {
  const f = ms / line.hopMs;
  const i0 = Math.floor(f);
  if (i0 < 0 || i0 >= line.midi.length) return null;
  const a = line.midi[i0];
  if (a === null) return null;
  const b = i0 + 1 < line.midi.length ? line.midi[i0 + 1] : null;
  if (b === null) return a;
  return a + (b - a) * (f - i0);
}

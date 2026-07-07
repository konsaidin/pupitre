// Октавная логика: глобальный сдвиг карты в комфортную зону пользователя.
// Сдвигаем ВСЮ карту на целое число октав — контур мелодии сохраняется.

import type { VocalRange } from '../lib/music';
import type { MapNote } from '../lib/songMap';

/**
 * Подбирает сдвиг в октавах (−3..3), при котором максимум длительности нот
 * попадает в комфортную зону; при равенстве — меньший |сдвиг|, затем
 * близость центра мелодии к центру зоны.
 */
export function chooseOctaveShift(notes: MapNote[], comfort: VocalRange): number {
  if (notes.length === 0) return 0;
  const zoneCenter = (comfort.lowMidi + comfort.highMidi) / 2;
  let best = 0;
  let bestScore = -Infinity;
  for (let oct = -3; oct <= 3; oct++) {
    const shift = oct * 12;
    let inZone = 0;
    let total = 0;
    let weightedSum = 0;
    for (const n of notes) {
      const m = n.midi + shift;
      total += n.durMs;
      weightedSum += m * n.durMs;
      if (m >= comfort.lowMidi && m <= comfort.highMidi) inZone += n.durMs;
    }
    const coverage = inZone / total;
    const centerDist = Math.abs(weightedSum / total - zoneCenter);
    const score = coverage - Math.abs(oct) * 0.01 - centerDist * 0.001;
    if (score > bestScore) {
      bestScore = score;
      best = oct;
    }
  }
  return best;
}

export function shiftNotes(notes: MapNote[], octaves: number): MapNote[] {
  if (octaves === 0) return notes;
  return notes.map((n) => ({ ...n, midi: n.midi + octaves * 12 }));
}

/** Границы окна пиано-ролла: диапазон пользователя ± запас, растянутый на ноты карты при необходимости. */
export function rollWindow(
  notes: MapNote[],
  range: VocalRange,
  marginSemitones = 2,
): { lowMidi: number; highMidi: number } {
  let low = range.lowMidi - marginSemitones;
  let high = range.highMidi + marginSemitones;
  for (const n of notes) {
    if (n.midi < low) low = n.midi;
    if (n.midi > high) high = n.midi;
  }
  return { lowMidi: Math.floor(low), highMidi: Math.ceil(high) };
}

// Чистые функции скоринга: сравнение голоса с нотой, судейство, звёзды.

import { foldToOctaveOf } from '../lib/music';
import { DIFFICULTY_META, type Difficulty, type MapNote } from '../lib/songMap';

export type Judgement = 'perfect' | 'good' | 'miss';

export interface NoteResult {
  note: MapNote;
  hitRatio: number; // 0..1 — доля длительности в допуске
  judgement: Judgement;
  points: number;
}

/**
 * Сравнение спетой высоты с целевой нотой.
 * Возвращает отклонение в центах (с учётом октавной свёртки) и попадание.
 */
export function matchPitch(
  sungMidi: number,
  targetMidi: number,
  difficulty: Difficulty,
): { cents: number; inTolerance: boolean; displayMidi: number } {
  const meta = DIFFICULTY_META[difficulty];
  const effective = meta.octaveAgnostic ? foldToOctaveOf(sungMidi, targetMidi) : sungMidi;
  const cents = (effective - targetMidi) * 100;
  return {
    cents,
    inTolerance: Math.abs(cents) <= meta.toleranceCents,
    displayMidi: effective,
  };
}

export function judge(hitRatio: number): Judgement {
  if (hitRatio >= 0.8) return 'perfect';
  if (hitRatio >= 0.5) return 'good';
  return 'miss';
}

export function comboMultiplier(combo: number): number {
  return 1 + 0.1 * Math.min(combo, 10);
}

export function notePoints(hitRatio: number, combo: number): number {
  return Math.round(100 * hitRatio * comboMultiplier(combo));
}

export function starsFor(accuracy: number): 0 | 1 | 2 | 3 {
  if (accuracy >= 0.9) return 3;
  if (accuracy >= 0.7) return 2;
  if (accuracy >= 0.4) return 1;
  return 0;
}

export interface GameSummary {
  score: number;
  accuracy: number;
  stars: 0 | 1 | 2 | 3;
  perfect: number;
  good: number;
  miss: number;
  maxCombo: number;
  results: NoteResult[];
}

export function summarize(results: NoteResult[], score: number, maxCombo: number): GameSummary {
  let inTol = 0;
  let total = 0;
  let perfect = 0;
  let good = 0;
  let miss = 0;
  for (const r of results) {
    inTol += r.hitRatio * r.note.durMs;
    total += r.note.durMs;
    if (r.judgement === 'perfect') perfect++;
    else if (r.judgement === 'good') good++;
    else miss++;
  }
  const accuracy = total > 0 ? inTol / total : 0;
  return { score, accuracy, stars: starsFor(accuracy), perfect, good, miss, maxCombo, results };
}

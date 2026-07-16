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
 * Гистерезис октавной свёртки: прежняя поправка живёт, пока держит голос
 * в этой полосе от цели. Свёртка кладёт голос в цель±6 полутонов, поэтому
 * пересчёт каждый кадр флипал октаву у самой границы (пение около тритона
 * от цели, глиссандо к дальней ноте) — точка телепортировала туда-обратно.
 */
const FOLD_HYST_SEMIS = 7.5;

/**
 * Сравнение спетой высоты с целевой нотой.
 * Возвращает отклонение в центах (с учётом октавной свёртки) и попадание.
 * fold — октавная поправка отображения (кратна 12): передавать её же
 * следующим кадром как prevFold, чтобы свёртка была липкой.
 */
export function matchPitch(
  sungMidi: number,
  targetMidi: number,
  difficulty: Difficulty,
  prevFold = 0,
): { cents: number; inTolerance: boolean; displayMidi: number; fold: number } {
  const meta = DIFFICULTY_META[difficulty];
  let fold = 0;
  if (meta.octaveAgnostic) {
    fold =
      Math.abs(sungMidi + prevFold - targetMidi) <= FOLD_HYST_SEMIS
        ? prevFold
        : foldToOctaveOf(sungMidi, targetMidi) - sungMidi;
  }
  const effective = sungMidi + fold;
  const cents = (effective - targetMidi) * 100;
  return {
    cents,
    inTolerance: Math.abs(cents) <= meta.toleranceCents,
    displayMidi: effective,
    fold,
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

/** Суммарное время техник за игру, мс (по кадрам анализа). */
export interface TechStats {
  vibratoMs: number;
  distortionMs: number;
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
  tech: TechStats;
}

export function summarize(
  results: NoteResult[],
  score: number,
  maxCombo: number,
  tech: TechStats = { vibratoMs: 0, distortionMs: 0 },
): GameSummary {
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
  return { score, accuracy, stars: starsFor(accuracy), perfect, good, miss, maxCombo, results, tech };
}

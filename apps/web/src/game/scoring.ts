// Чистые функции скоринга: сравнение голоса с нотой, судейство, звёзды.

import { foldToOctaveOf } from '../lib/music';
import { DIFFICULTY_META, type Difficulty, type MapNote } from '../lib/songMap';

export type Judgement = 'perfect' | 'good' | 'miss';

export function scoringDuration(note: MapNote): number {
  return Math.max(0, note.durMs - (note.tech ? note.techWarmupMs ?? 0 : 0));
}

export interface NoteResult {
  note: MapNote;
  hitRatio: number; // 0..1 — доля длительности в допуске
  judgement: Judgement;
  points: number;
}

/**
 * Сравнение спетой высоты с целевой нотой — только скоринг, без отображения.
 * В октаво-независимых сложностях голос сворачивается к ближайшей октаве цели
 * каждый кадр: на границе свёртки (тритон от цели) это ±600 центов — заведомо
 * мимо любого допуска, так что дрожание границы на вердикт не влияет.
 */
export function matchPitch(
  sungMidi: number,
  targetMidi: number,
  difficulty: Difficulty,
): { cents: number; inTolerance: boolean } {
  const meta = DIFFICULTY_META[difficulty];
  const effective = meta.octaveAgnostic ? foldToOctaveOf(sungMidi, targetMidi) : sungMidi;
  const cents = (effective - targetMidi) * 100;
  return { cents, inTolerance: Math.abs(cents) <= meta.toleranceCents };
}

// Октавных поправок ОТОБРАЖЕНИЯ больше нет: точка на ролле — всегда сырой
// голос (см. engine.onPitchFrame). Прощение октавы на beginner/medium живёт
// только здесь, в matchPitch. Историю с display-fold (три починки, всё равно
// телепортировало) см. PLAN.md «Санация Windows-сборки», пункт 5.

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
    const duration = scoringDuration(r.note);
    inTol += r.hitRatio * duration;
    total += duration;
    if (r.judgement === 'perfect') perfect++;
    else if (r.judgement === 'good') good++;
    else miss++;
  }
  const accuracy = total > 0 ? inTol / total : 0;
  return { score, accuracy, stars: starsFor(accuracy), perfect, good, miss, maxCombo, results, tech };
}

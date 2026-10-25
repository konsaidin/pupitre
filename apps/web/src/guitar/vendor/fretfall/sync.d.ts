// Типы к вендорному sync.js (fretfall @ ed2bc3b, MIT; файл без изменений) — по факту исходника.
// onsetEnvelope (детектор онсетов на JS) намеренно не объявлен: архитектура §4.4 его отвергла — огибающую даёт свой анализ.

/** Огибающая атак: `env[i]` описывает момент `start + i·hop` (секунды). */
export interface FfOnsetEnvelope {
  env: Float32Array | number[];
  hop: number;
  start: number;
}

/** audio = offset + ratio · chartTime; confidence < ~2 — запись, вероятно, не та. */
export interface FfAlignment {
  offset: number;
  ratio: number;
  confidence: number;
}

/** onsets — времена нот партии по возрастанию, секунды. */
export function align(
  envelope: FfOnsetEnvelope,
  onsets: readonly number[],
  options?: { minRatio?: number; maxRatio?: number },
): FfAlignment;

/** Сдвиг в мс (плюс — ноты позже), ставящий первую ноту (`first`, секунды партии) на её атаку; null — тишина. */
export function snapOffset(envelope: FfOnsetEnvelope, fit: FfAlignment, first: number): number | null;

// Типы к вендорному fingering.js (fretfall @ ed2bc3b, MIT; файл без изменений) — по факту исходника.
import type { FfAnchor } from './fromScore.js';

/** Палец 1–4 для лада при указательном на ладу `position`. */
export function fingerFor(fret: number, position: number): number;

/**
 * Позиции руки и пальцы для партии без аппликатуры. notes — по времени; открытые струны (fret ≤ 0) не учитываются.
 * `fingers` — по самим объектам нот (Map по ссылке).
 */
export function suggestPositions<N extends { time: number; sustain: number; fret: number }>(
  notes: readonly N[],
): { anchors: FfAnchor[]; fingers: Map<N, number> };

// Типы к вендорному music.js (fretfall @ ed2bc3b, MIT; файл без изменений) — по факту исходника.
import type { FfArrangement, FfBeat, FfChord, FfHandShape, FfNote } from './fromScore.js';

/** Точка темпокарты: тик (960 PPQ), темп (BPM) с этого тика и время песни в мс на этом тике. */
export interface FfTempoPoint {
  tick: number;
  tempo: number;
  ms: number;
}

/** changes — смены темпа в порядке исполнения (`{tick, tempo}`; подходят `tempoChanges` тактов tickLookup alphaTab). */
export function tempoMap(changes: Iterable<{ tick: number; tempo: number }>, initialTempo: number): FfTempoPoint[];
export function tickToMs(map: readonly FfTempoPoint[], tick: number): number;
export function msToTick(map: readonly FfTempoPoint[], ms: number): number;

/** open — MIDI открытых струн от НИЖНЕЙ → 'E Standard', 'Drop D' или имена струн через пробел. */
export function tuningName(open: readonly number[]): string;
/** Имя ноты по MIDI (бемоли: 'C', 'D♭'…). */
export function noteName(midi: number): string;
/** Строй, от которого удобнее считать; null — для этого числа струн нет стандартного. */
export function tuningReference(open: readonly number[]): { reference: string; open: number[]; shift: number[] } | null;

/**
 * Мутирует: ноты получают `repeat`/`heldFrom`, повторённые аккорды — `highDensity`. Сравнивает ноты по ВСЕМ полям,
 * кроме своего списка (time, sustain, chord…): лишние поля (например barIndex/passIndex конвертера) ломают поиск повторов.
 */
export function markRepeats(notes: FfNote[], chords: FfChord[], gap?: number): void;
/** Мутирует: `tieTo`/`tied`/`slideSpan`/`dynamicLabel`, удлиняет let ring, дописывает `barre` аккордам. */
export function annotate(notes: FfNote[], chords: FfChord[]): void;
/** Мутирует: формы-арпеджио получают `arpeggio`, их ноты — `letRing` и длиннее `sustain`. notes — по времени. */
export function markArpeggios(notes: FfNote[], handShapes: FfHandShape[]): void;

/** Строки текста караоке: индексы верхней и нижней строк (−1 — пусто). */
export function lyricsShown(lines: ReadonlyArray<{ time: number; end: number }>, t: number): { top: number; bottom: number };

/** Отрезки для лупа по имени: секции партии (каждая до следующей) или её фразы. Секунды. */
export function phrasesOf(
  arr: Pick<FfArrangement, 'phrases'> & Partial<Pick<FfArrangement, 'sections'>>,
  length: number,
): Array<{ name: string; start: number; end: number }>;

/** Отсчёт перед стартом с паузы: `at` — моменты щелчков, `start` — когда пускать песню; секунды от «сейчас». */
export function countIn(
  beats: ReadonlyArray<Pick<FfBeat, 'time'>>,
  t: number,
  n: number,
  speed: number,
): { count: number; gap: number; at: number[]; start: number };

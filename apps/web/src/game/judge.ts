// Шов судейства: движок владеет часами, судья — свидетельствами исполнения.
import type { Difficulty, SongMap } from '../lib/songMap';
import type { GameSummary, Judgement, NoteResult } from './scoring';

export type VerdictKind = 'hit' | 'early' | 'late' | 'wrong' | 'missed' | 'skipped';
export interface FrameSource<F> { onFrame(fn: (f: F) => void): () => void }

export interface JudgeHost<M extends SongMap> {
  map: M;
  difficulty: Difficulty;
  lineTarget?: boolean;
}

export interface JudgeVerdict {
  judgement: Judgement;
  hitRatio: number;
  points?: number;
  kind?: VerdictKind;
  offsetMs?: number;
  heardMidi?: number;
  missingMask?: number;
  sustain?: number;
  detail?: string;
}

export interface NoteJudge<M extends SongMap, F> {
  readonly map: M;
  readonly finalizeOrder: 'sequential' | 'any';
  onBegin(fromMs: number): void;
  reset(i: number, fromMs: number): 'armed' | 'skipped';
  /** Перемотка на паузе тоже обрезает визуальный след. */
  onSeek?(fromMs: number): void;
  onRawFrame?(f: F): void;
  onFrame(f: F, songMs: number): void;
  onTick?(songMs: number, epoch: number): void;
  closeAtMs(i: number): number;
  finalize(i: number, forced?: boolean): JudgeVerdict;
  progress(i: number): number;
  frameTime(f: F): number;
  summarize(results: NoteResult[], score: number, maxCombo: number): GameSummary;
}

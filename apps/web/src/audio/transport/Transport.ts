import type { MapNote, SongMap } from '../../lib/songMap';

export type ClockDomain = 'audiocontext' | 'engine';

/** Непрозрачный идентификатор медиа будущего нативного движка. */
export interface EngineMediaHandle { readonly kind: 'engine'; readonly id: string }

export interface BackingLayer {
  id: string;
  source: AudioBuffer | EngineMediaHandle;
  gain: number;
  /** Смещение чтения внутри буфера; позиция = songMs * timeScale + offsetMs. */
  offsetMs?: number;
  timeScale?: number;
}

export interface TransportLoad {
  durationMs: number;
  layers: BackingLayer[];
  beats?: { ms: number; downbeat: boolean }[];
  bpm?: number;
  guideEvents?: MapNote[];
  guideNotes?: boolean;
  metronome: boolean;
  countIn: boolean;
  legacyBacking?: SongMap['backing'];
  backingBuffer?: AudioBuffer;
}

export interface Transport {
  readonly kind: 'webaudio' | 'native';
  readonly clockDomain: ClockDomain;
  load(spec: TransportLoad): void;
  begin(fromMs: number, leadSec: number, endMs: number): void;
  halt(): void;
  reschedule(fromMs: number, endMs: number): void;
  clockNow(): number;
  songMs(): number;
  heardSongMs(): number;
  countdownRemaining(): number;
  epoch(): number;
  frameToSongMs(clockT: number, latencyMs: number): number;
  songToClock(songMs: number, latencyMs: number): number;
  setLayerGain(id: string, gain: number): void;
  hold(): void;
  release(): void;
}

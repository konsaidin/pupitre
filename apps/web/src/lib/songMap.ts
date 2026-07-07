// Карта уровня: то, что рендерит пиано-ролл и по чему считается скоринг.

export interface MapNote {
  /** старт в мс от начала трека */
  startMs: number;
  durMs: number;
  /** целочисленная MIDI-высота */
  midi: number;
  /** слог/подпись (для караоке и упражнений: "до", "ре"…) */
  lyric?: string;
}

export interface SongMap {
  id: string;
  title: string;
  subtitle?: string;
  durationMs: number;
  notes: MapNote[];
  /**
   * Что играет синт вместо notes (упражнения на слух: играется опорная нота,
   * а спеть надо другую). Рисуются на ролле призрачными плашками.
   */
  guideEvents?: MapNote[];
  /**
   * Источник аккомпанемента:
   *  - synth: опорные ноты играет встроенный синт (упражнения)
   *  - url: инструментал с бэкенда (песни)
   */
  backing: { kind: 'synth'; guideNotes: boolean } | { kind: 'url'; url: string };
  /** темп для метронома (упражнения) */
  bpm?: number;
  /** мс тишины перед первой нотой (вступление для упражнений) */
  leadInMs?: number;
}

export type Difficulty = 'beginner' | 'medium' | 'pro';

export const DIFFICULTY_META: Record<
  Difficulty,
  { label: string; toleranceCents: number; octaveAgnostic: boolean }
> = {
  beginner: { label: 'Новичок', toleranceCents: 100, octaveAgnostic: true },
  medium: { label: 'Средний', toleranceCents: 60, octaveAgnostic: true },
  pro: { label: 'Про', toleranceCents: 35, octaveAgnostic: false },
};

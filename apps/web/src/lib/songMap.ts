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

/**
 * Непрерывный контур высоты извлечённого вокала — «дорожка», по которой едет
 * шарик-ориентир (то, что «спелось бы в микрофон»). null = тишина/неозвучено.
 */
export interface Pitchline {
  hopMs: number;
  midi: (number | null)[];
}

/** Настройки извлечения мелодии (ползунки); зеркало ExtractParams бэкенда. */
export interface ExtractSettings {
  /** границы поиска высоты, Гц */
  fmin: number;
  fmax: number;
  /** энергетический гейт: доля от p95 RMS (0 — выключен) */
  gateRatio: number;
  minNoteMs: number;
  mergeGapMs: number;
  splitSemitones: number;
  /** ширина медианного сглаживания, кадров (нечётная) */
  medianWidth: number;
}

export const EXTRACT_DEFAULTS: ExtractSettings = {
  fmin: 65,
  fmax: 1047,
  gateRatio: 0.05,
  minNoteMs: 90,
  mergeGapMs: 80,
  splitSemitones: 0.75,
  medianWidth: 5,
};

export interface SongMap {
  id: string;
  title: string;
  subtitle?: string;
  durationMs: number;
  notes: MapNote[];
  /** контур высоты голоса; подгружается отдельно (см. api.getPitchline) */
  pitchline?: Pitchline;
  /** есть ли на бэкенде контур/вокал для подгрузки */
  hasPitchline?: boolean;
  hasVocal?: boolean;
  /** настройки, которыми снята текущая карта (для панели переснятия) */
  extract?: ExtractSettings;
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

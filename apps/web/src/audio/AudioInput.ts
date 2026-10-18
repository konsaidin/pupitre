// Универсальный аудиослой (курс 2): единственная точка входа звука для UI.
// Кадры анализа приходят уже готовыми — DSP выполняется максимально близко
// к драйверу. Бэкенды: AudioWorklet (веб/fallback), нативный захват
// WASAPI/PipeWire (Electron, этап 4), Oboe/AAudio (Android, этап 5).
//
// Инвариант: экраны и движок не знают про getUserMedia/worklet — только
// про этот интерфейс.

/** Базовый кадр — то, что потребляли игра/визард до курса 2. */
export interface PitchFrame {
  /** время AudioContext, сек */
  t: number;
  hz: number;
  /** дробная midi-высота после сглаживания в ядре; NaN если голоса нет */
  midi: number;
  clarity: number;
  rms: number;
  voiced: boolean;
}

/** Полный кадр анализа из DSP-ядра: высота + вокальные техники. */
export interface AnalysisFrame extends PitchFrame {
  /** сырой midi без сглаживания — волнистость ленты; NaN если голоса нет */
  midiRaw: number;
  /** громкость, dBFS (быстрая атака, медленный спад) */
  loudDb: number;
  vibrato: { active: boolean; rateHz: number; depthCents: number; regularity: number };
  distortion: { active: boolean; score: number };
  /** 0..1, доля непериодичности при голосе (грубый HNR-прокси) */
  breathiness: number;
}

export type FrameListener = (frame: AnalysisFrame) => void;

/** Настройки микрофона: платформенная обработка + нойзгейт детектора. */
export interface MicOptions {
  /** шумоподавление платформы (глушит фон, может резать тихий вокал) */
  noiseSuppression: boolean;
  /** эхоподавление: полезно, если аккомпанемент играет из колонок */
  echoCancellation: boolean;
  /** автоусиление: платформа сама крутит громкость (обычно мешает гейту) */
  autoGain: boolean;
  /** нойзгейт: RMS ниже порога = тишина (0.002..0.03) */
  gateRms: number;
  /** порог чистоты тона для входа в «голос есть» (0.4..0.9) */
  gateClarity: number;
}

export const DEFAULT_MIC: MicOptions = {
  noiseSuppression: false,
  echoCancellation: false,
  autoGain: false,
  gateRms: 0.006,
  gateClarity: 0.6,
};

export interface AudioDevice {
  id: string;
  label: string;
}

export interface AudioInput {
  /** имя бэкенда для монитора настроек */
  readonly kind: 'worklet' | 'native';
  /** Доступные устройства захвата (метки — после выдачи разрешения). */
  listDevices(): Promise<AudioDevice[]>;
  start(deviceId: string | null, opts?: MicOptions): Promise<void>;
  stop(): void;
  onFrame(fn: FrameListener): () => void;
  /** Пороги гейта применяются на лету, без перезапуска потока. */
  setGate(gateRms: number, gateClarity: number): void;
  /** Оценка задержки сглаженного контура с учётом доставки; NaN пока нет данных. */
  latencyMs(): number;
}

/** Число f32 на кадр — контракт с AnalysisFrame::write в packages/dsp. */
export const FRAME_FLOATS = 15;

/** Декодирование кадра из плоской укладки ядра; tBase прибавляется к t кадра. */
export function decodeFrame(flat: Float32Array, o: number, tBase: number): AnalysisFrame {
  return {
    t: tBase + flat[o],
    hz: flat[o + 1],
    midi: flat[o + 2],
    midiRaw: flat[o + 3],
    clarity: flat[o + 4],
    rms: flat[o + 5],
    voiced: flat[o + 6] > 0.5,
    loudDb: flat[o + 7],
    vibrato: {
      active: flat[o + 8] > 0.5,
      rateHz: flat[o + 9],
      depthCents: flat[o + 10],
      regularity: flat[o + 11],
    },
    distortion: { active: flat[o + 12] > 0.5, score: flat[o + 13] },
    breathiness: flat[o + 14],
  };
}

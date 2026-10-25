// Мост нативного движка (01-architecture §8.1; этап 41): window.pupitreEngine выставляет preload десктопа, когда main
// загрузил аддон packages/engine. В вебе и без аддона — null: раздел остаётся на захвате браузера. Единицы — кадры
// движка (48 кГц), уровни — линейные (0..1+), задержки драйвера — по отчёту JACK.

export interface EngineDevice {
  /** Имя клиента JACK (у PipeWire — описание узла), по нему движок подключает порты. */
  id: string;
  label: string;
  channels: number;
}

export interface EngineDevices {
  capture: EngineDevice[];
  playback: EngineDevice[];
}

export interface EngineOpenOptions {
  /** null — первое устройство с портами захвата. */
  capture: string | null;
  /** null — выходы того же устройства, иначе первое устройство воспроизведения. */
  playback: string | null;
  /** −1 — смесь каналов. */
  channel: number;
  /** Запрошенный буфер (квант PipeWire) в кадрах: 64, 128, 256, 512. */
  bufferFrames: number;
  /** Громкость мониторинга себя, линейная; 0 — не выводить. */
  monitorGain: number;
  /** Самопроверка: выход движка соединяется с его же входом, устройства не трогаются. */
  loopback?: boolean;
}

export interface EngineOpenInfo {
  backend: 'jack';
  sampleRate: number;
  bufferFrames: number;
  requestedFrames: number;
  /** Задержка от входа устройства до движка и от движка до выхода, кадры (отчёт JACK). */
  captureLatencyFrames: number;
  playbackLatencyFrames: number;
  captureId: string;
  captureLabel: string;
  captureChannels: number;
  playbackId: string | null;
  playbackLabel: string;
}

export interface EngineMeters {
  /** Счётчик кадров движка на конец окна. */
  frames: number;
  /** Пики сырых каналов входа, линейные. */
  peak: [number, number];
  /** Сухой сигнал (выбранный канал или смесь): пик и RMS окна. */
  dryPeak: number;
  dryRms: number;
  /** Сэмпл сырого канала у 0 dBFS за окно. */
  clipped: boolean;
  /** Срывы (xrun) с открытия. */
  xruns: number;
  /** Нагрузка колбэка — максимум доли периода за окно. */
  load: number;
  bufferFrames: number;
  /** Свежий отчёт драйвера, кадры (квант устанавливается после подключения — значения при открытии устаревают). */
  captureLatencyFrames: number;
  playbackLatencyFrames: number;
}

export type EngineEvent =
  | { kind: 'device-lost'; device: string }
  | { kind: 'device-back'; device: string }
  | { kind: 'reopened'; bufferFrames: number; requestedFrames: number; reason: string }
  | { kind: 'shutdown'; reason: string };

/** Кадры анализа движка: по 5 чисел на кадр — время звука (мкс часов JACK), MIDI (NaN — нет высоты), чистота, уровень
 *  dBFS, атака 0/1; nowUs — часы JACK в момент отправки (рендерер сводит их со своими). */
export interface EngineFrames {
  nowUs: number;
  frames: Float64Array;
}

export interface EngineRtl {
  /** Задержки щелчков выход → вход, кадры; пропущенные щелчки не входят. */
  delaysFrames: number[];
  medianFrames: number;
  medianMs: number;
  misses: number;
}

export interface EngineApi {
  available(): Promise<{ ok: boolean; reason?: string }>;
  listDevices(): Promise<EngineDevices>;
  open(options: EngineOpenOptions): Promise<EngineOpenInfo>;
  close(): Promise<void>;
  set(options: { channel?: number; monitorGain?: number; mute?: boolean }): void;
  measureRtl(clicks: number): Promise<EngineRtl>;
  /** Открыт ли движок, квант и устройство (диагностика, e2e). */
  status(): Promise<{ open: boolean; bufferFrames: number; captureId: string }>;
  onMeters(fn: (meters: EngineMeters) => void): () => void;
  onEvent(fn: (event: EngineEvent) => void): () => void;
  onFrames(fn: (frames: EngineFrames) => void): () => void;
}

/** Движок десктопа или null (веб, аддон не загрузился). */
export function engineBridge(): EngineApi | null {
  return (globalThis as { pupitreEngine?: EngineApi }).pupitreEngine ?? null;
}

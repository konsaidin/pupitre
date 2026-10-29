// Сессия входа инструмента (01-architecture §5.7, §8; экран «Вход и звук»). Захват — один из двух бэкендов за общим
// интерфейсом Capture: нативный движок десктопа (packages/engine через EngineBridge: JACK, мониторинг себя с задержкой
// в единицы мс) или браузер (getUserMedia без обработки, свой AudioContext для шкалы и мониторинга). Движок выбирается,
// если он есть и не выключен в настройках; не открылся из-за отсутствия JACK — сессия остаётся на браузере.
// Один захват на приложение: держатель раздела и открытие останавливают вокальный микрофон (инв. 22). Раздел держит вход,
// пока смонтирован: acquireInput со счётчиком, закрытие откладывается на задачу — StrictMode снимает и ставит эффект в
// одном коммите, и захват не переоткрывается (инв. 21). Уровень сессия опрашивает сама (таймер), шкалы читают его из
// кадров анимации — состояние входа идёт и там, где шкал нет (игра). Кадры анализа (атаки и высота, время звука на часах
// страницы) — onInputFrames: у движка — его поток анализа, у браузера — ворклеты на сухом сигнале (вокальное ядро
// высоты и детектор атак того же алгоритма, что в движке).
import { decodeFrame, FRAME_FLOATS } from '../AudioInput';
import { stopMic } from '../audioSession';
import { engineBridge, type EngineApi, type EngineEvent, type EngineMeters, type EngineOpenInfo } from '../engine/EngineBridge';
import { changedToneParams, toneParams } from '../guitar/tone';
import { TONE_PROCESSOR_SOURCE } from '../guitar/toneProcessorSource';
import { PITCH_PROCESSOR_SOURCE } from '../pitchProcessorSource';
// data-URI, а не ?url: под file:// в Electron fetch ассетов не работает (как WorkletAudioInput)
import dspWasmDataUri from '../../assets/dsp.wasm?inline';
import toneWasmDataUri from '../../assets/tone.wasm?inline';
import { ONSET_PROCESSOR_SOURCE } from './onsetProcessorSource';

/**
 * off — вход не выбран или раздел закрыт; no-signal — дольше 5 с тише порога (и сразу после открытия, пока сигнала не
 * было); clipping — пик сырого канала у 0 dBFS за последние 1.5 с; device-lost — выбранного устройства нет;
 * not-found — в системе ни одного входа; unavailable — устройство занято или не открылось; unsupported — браузер не
 * даёт доступа к звуку (небезопасный адрес).
 */
export type InputState =
  | 'off'
  | 'opening'
  | 'ok'
  | 'no-signal'
  | 'clipping'
  | 'device-lost'
  | 'permission-denied'
  | 'not-found'
  | 'unavailable'
  | 'unsupported';

export type InputBackend = 'web' | 'engine';

export interface InputDevice {
  id: string;
  /** Пусто, пока у браузера нет доступа ко входу. */
  label: string;
  /** Каналов у устройства (движок знает заранее). */
  channels?: number;
}

export interface InputConfig {
  /** null — вход не выбран: сама сессия захват не открывает. */
  deviceId: string | null;
  /** Метка выбранного устройства: по ней оно находится, если id сменился (другая сессия браузера, другой бэкенд). */
  deviceLabel: string;
  /** −1 — смесь каналов. */
  channel: number;
  /** Громкость мониторинга себя через Пюпитр; 0 — не выводить. */
  monitorGain: number;
  /** Фон в тишине, dBFS (NaN — не измерен для этого входа): «нет сигнала» — тише фона + 6 дБ. */
  noiseDb: number;
  /** auto — движок, если он есть; worklet — только браузер; engine — движок. */
  backend: 'auto' | 'worklet' | 'engine';
  /** Буфер движка, кадры. */
  bufferFrames: number;
  /** Выход мониторинга движка; null — выходы того же устройства. */
  outputDeviceId: string | null;
  /** Параметры гитарного процессора мониторинга по номерам (audio/guitar/tone.ts: toneParams); обход — сухой сигнал. */
  tone: readonly number[];
}

export interface InputSnapshot {
  state: InputState;
  /** Бэкенд открытого входа (закрыт — тот, что будет выбран). */
  backend: InputBackend;
  /** Открытое (или открываемое) устройство; может отличаться от запрошенного, если id сменился. */
  deviceId: string | null;
  label: string;
  /** Каналов у входа (1–2); 0 — вход закрыт. */
  channels: number;
  sampleRate: number;
  /** Движок: полученный и запрошенный буфер (кадры), срывы с открытия. Браузер — 0. */
  bufferFrames: number;
  requestedFrames: number;
  xruns: number;
  /** Почему движок не используется (не открылся); пусто — всё в порядке или его нет. */
  engineError: string;
  /** Выход мониторинга движка; пусто — у устройства входа нет своего выхода, а другой не выбран. Браузер — пусто. */
  outputLabel: string;
}

/** Замер уровня; один объект на сессию — читатели берут значения сразу, а не хранят ссылку (без аллокаций в кадре). */
export interface InputLevel {
  /** dBFS сухого сигнала (выбранный канал или смесь); −Infinity — тишина. */
  rmsDb: number;
  peakDb: number;
  /** Столбик шкалы: пик с мгновенной атакой и спадом 30 дБ/с. */
  barDb: number;
  /** Метка пика: держится 1 с, затем спадает 20 дБ/с. */
  holdDb: number;
  /** Пик игры: максимум, пока звучит сигнал (спад 3 дБ/с), в тишине замирает — для совета по гейну. */
  playDb: number;
  clipping: boolean;
  /** Пики сырых каналов, dBFS. */
  channelDb: [number, number];
}

export interface InputLatency {
  kind: InputBackend;
  /** Вход: от устройства до обработки; выход: от обработки до устройства; NaN — неизвестно. */
  inputMs: number;
  outputMs: number;
  /** Период обработки движка; браузер — NaN. */
  bufferMs: number;
}

/** Кадр анализа входа: атака или высота. */
export interface InputFrame {
  /** Время звука (часы performance.now, мс) — захват, а не доставка. */
  atMs: number;
  /** Дробная MIDI-высота при A4 = 440 Гц; NaN — высоты нет. */
  midi: number;
  clarity: number;
  levelDb: number;
  /** Атака (резкий рост огибающей). */
  onset: boolean;
}

/** Внешние API сессии — подменяются в тестах (setInputPlatform). */
export interface InputPlatform {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
  createContext(): AudioContext;
  onDeviceChange(fn: () => void): () => void;
  engine(): EngineApi | null;
  /** Остановить вокальный микрофон. */
  stopVoice(): void;
  now(): number;
  /** Периодический опрос; вернёт остановку. */
  every(ms: number, fn: () => void): () => void;
}

const FFT = 4096;
const CLIP = 0.999;
const CLIP_HOLD_MS = 1500;
const SILENCE_MS = 5000;
const HOLD_MS = 1000;
const TICK_MS = 50;
/** Повторная проба после конца потока — не чаще. */
const PROBE_GAP_MS = 3000;
/** Метры движка молчат дольше — движок закрыт помимо сессии. */
const ENGINE_SILENT_MS = 2000;
/** Сервер JACK недоступен — следующая попытка движка не раньше. */
const ENGINE_RETRY_MS = 10000;
const CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: { ideal: 2 },
};

function mediaDevices(): MediaDevices {
  const md = globalThis.navigator?.mediaDevices;
  if (!md) throw new DOMException('Устройства звука недоступны', 'NotSupportedError');
  return md;
}

const browser: InputPlatform = {
  getUserMedia: async (constraints) => mediaDevices().getUserMedia(constraints),
  enumerateDevices: async () => mediaDevices().enumerateDevices(),
  createContext: () => new AudioContext({ latencyHint: 'interactive' }),
  onDeviceChange(fn) {
    const md = globalThis.navigator?.mediaDevices;
    md?.addEventListener('devicechange', fn);
    return () => md?.removeEventListener('devicechange', fn);
  },
  engine: engineBridge,
  stopVoice: stopMic,
  now: () => performance.now(),
  every(ms, fn) {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
};

/** Сырой замер бэкенда: сухой сигнал (пик, RMS) и пики сырых каналов. */
interface Raw {
  peak: number;
  rms: number;
  ch0: number;
  ch1: number;
  clip: boolean;
}

interface Capture {
  readonly backend: InputBackend;
  readonly deviceId: string;
  readonly label: string;
  readonly outputLabel: string;
  readonly channels: number;
  readonly sampleRate: number;
  readonly requestedFrames: number;
  bufferFrames: number;
  xruns: number;
  /** false — данных ещё нет. */
  measure(raw: Raw): boolean;
  apply(config: InputConfig): void;
  latency(): InputLatency;
  close(): void;
}

const CLOSED: InputSnapshot = {
  state: 'off', backend: 'web', deviceId: null, label: '', channels: 0, sampleRate: 0, bufferFrames: 0, requestedFrames: 0, xruns: 0,
  engineError: '', outputLabel: '',
};
const NO_INPUT: InputConfig = {
  deviceId: null, deviceLabel: '', channel: -1, monitorGain: 0, noiseDb: NaN, backend: 'auto', bufferFrames: 128, outputDeviceId: null,
  tone: toneParams(null),
};

let platform = browser;
let config = NO_INPUT;
let snapshot = CLOSED;
let capture: Capture | null = null;
/** Поколение открытия: закрытие или новое открытие отменяет ждущее. */
let gen = 0;
let refs = 0;
let closing: ReturnType<typeof setTimeout> | undefined;
let unwatch: (() => void) | null = null;
let stopTicks: (() => void) | null = null;
/** Последний запрошенный вход — для повторов (конец потока, подключение устройства). */
let lastRequest: { deviceId: string | null; label: string } | null = null;
let probedAt = -Infinity;
/**
 * Движок не открылся (нет JACK): причина и когда. Аддон или libjack не загрузились — навсегда (до перезагрузки);
 * сервер недоступен (PipeWire перезапускается) — пауза ENGINE_RETRY_MS и новая попытка.
 */
let engineDown = '';
let engineDownAt = -Infinity;
let engineDownForever = false;

function markEngineDown(reason: string) {
  engineDown = reason;
  engineDownAt = platform.now();
  engineDownForever = /не загрузил/.test(reason);
}
const listeners = new Set<() => void>();
const deviceListeners = new Set<() => void>();
const frameListeners = new Set<(frame: InputFrame) => void>();

function emitFrame(frame: InputFrame) {
  for (const fn of frameListeners) fn(frame);
}

/** Кадры анализа открытого входа (подписка переживает переоткрытие и смену бэкенда). */
export function onInputFrames(fn: (frame: InputFrame) => void): () => void {
  frameListeners.add(fn);
  return () => void frameListeners.delete(fn);
}

const level: InputLevel = {
  rmsDb: -Infinity, peakDb: -Infinity, barDb: -Infinity, holdDb: -Infinity, playDb: -Infinity, clipping: false,
  channelDb: [-Infinity, -Infinity],
};
const raw: Raw = { peak: 0, rms: 0, ch0: 0, ch1: 0, clip: false };
let levelAt = 0;
let holdAt = 0;
let clipAt = -Infinity;
let loudAt = -Infinity;

const dB = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const errorName = (e: unknown) => (e as { name?: unknown } | null)?.name;
const errorText = (e: unknown) => String((e as { message?: unknown } | null)?.message ?? e);
const missing = (e: unknown) => errorName(e) === 'OverconstrainedError' || errorName(e) === 'NotFoundError';
const isOpen = (state: InputState) => state === 'ok' || state === 'no-signal' || state === 'clipping';
const named = (name: string, message: string) => Object.assign(new Error(message), { name });

function publish(patch: Partial<InputSnapshot>) {
  const next = { ...snapshot, ...patch };
  if ((Object.keys(next) as Array<keyof InputSnapshot>).every((key) => next[key] === snapshot[key])) return;
  snapshot = next;
  for (const fn of [...listeners]) fn();
}

export const getInputSnapshot = (): InputSnapshot => snapshot;

export function subscribeInput(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Подключение и отключение устройств (список на экране «Вход и звук»). */
export function onDevicesChange(fn: () => void): () => void {
  deviceListeners.add(fn);
  return () => void deviceListeners.delete(fn);
}

function engineApi(): EngineApi | null {
  if (config.backend === 'worklet') return null;
  if (engineDown && (engineDownForever || platform.now() - engineDownAt < ENGINE_RETRY_MS)) return null;
  return platform.engine();
}

/** Бэкенд, на котором откроется вход. */
export const inputBackend = (): InputBackend => (engineApi() ? 'engine' : 'web');

/** Есть ли вообще доступ к звуку: движок или устройства браузера. */
export const inputSupported = (): boolean => !!engineApi() || !!globalThis.navigator?.mediaDevices;

export async function listInputDevices(): Promise<InputDevice[]> {
  const api = engineApi();
  if (api) {
    try {
      return (await api.listDevices()).capture.map((d) => ({ id: d.id, label: d.label, channels: d.channels }));
    } catch (e) {
      // JACK недоступен — сессия переходит на браузер
      markEngineDown(errorText(e));
      publish({ backend: 'web', engineError: engineDown });
    }
  }
  const all = await platform.enumerateDevices();
  return all.filter((d) => d.kind === 'audioinput').map((d) => ({ id: d.deviceId, label: d.label }));
}

/** Выходы движка для мониторинга; у браузера — пусто (вывод — системный). */
export async function listOutputDevices(): Promise<InputDevice[]> {
  const api = engineApi();
  if (!api) return [];
  try {
    return (await api.listDevices()).playback.map((d) => ({ id: d.id, label: d.label, channels: d.channels }));
  } catch {
    return [];
  }
}

/** Порог «есть сигнал», dBFS: фон + 6 дБ, но не громче −40; без замера фона — −50. */
function signalDb(): number {
  return Number.isFinite(config.noiseDb) ? Math.min(-40, config.noiseDb + 6) : -50;
}

function failure(e: unknown, deviceId: string | null): InputState {
  const name = errorName(e);
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission-denied';
  if (name === 'NotSupportedError') return 'unsupported';
  if (missing(e)) return deviceId ? 'device-lost' : 'not-found';
  return 'unavailable';
}

/** Единственное устройство с той же меткой и другим id; двойников не угадываем. */
async function sameByLabel(deviceId: string, label: string): Promise<string | null> {
  const same = (await listInputDevices()).filter((d) => d.label === label);
  return same.length === 1 && same[0].id !== deviceId ? same[0].id : null;
}

// ——— браузер ———

// Политика автозапуска звука: контекст, созданный без жеста пользователя, стоит на паузе — запускается первым жестом.
function wake(ctx: AudioContext): () => void {
  const resume = () => {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  };
  resume();
  if (typeof globalThis.addEventListener !== 'function') return () => {};
  const types = ['pointerdown', 'keydown'] as const;
  for (const type of types) globalThis.addEventListener(type, resume, true);
  return () => {
    for (const type of types) globalThis.removeEventListener(type, resume, true);
  };
}

function analyser(ctx: AudioContext): AnalyserNode {
  const node = ctx.createAnalyser();
  node.fftSize = FFT;
  node.smoothingTimeConstant = 0;
  return node;
}

/** Граф браузера: источник → разветвитель (пики каналов) и → моно (канал или смесь) → шкала и мониторинг. */
function webCapture(stream: MediaStream, track: MediaStreamTrack, requestedId: string | null): Capture {
  const settings = track.getSettings();
  const channels = Math.min(2, Math.max(1, settings.channelCount ?? 2));
  const ctx = platform.createContext();
  try {
    const source = ctx.createMediaStreamSource(stream);
    const splitter = ctx.createChannelSplitter(2);
    const left = analyser(ctx);
    const right = analyser(ctx);
    const dry = analyser(ctx);
    // Смесь — сведение каналов в моно по правилам «speakers»: (L + R) / 2.
    const pick = ctx.createGain();
    pick.channelCount = 1;
    pick.channelCountMode = 'explicit';
    pick.channelInterpretation = 'speakers';
    const monitor = ctx.createGain();
    monitor.gain.value = 0;
    source.connect(splitter);
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    pick.connect(dry);
    monitor.connect(ctx.destination);
    const buf = new Float32Array(FFT);
    const peakOf = (node: AnalyserNode) => {
      node.getFloatTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, buf[i] < 0 ? -buf[i] : buf[i]);
      return peak;
    };
    /** Подключённый канал (−1 — смесь), NaN — ещё не подключён. */
    let routed = NaN;
    const unwake = wake(ctx);
    const inputLatencyMs = () => {
      const latency = (track.getSettings() as { latency?: unknown }).latency;
      return typeof latency === 'number' ? latency * 1000 : 0;
    };
    const stopAnalysis = webAnalysis(ctx, pick, inputLatencyMs);
    const tone = webTone(ctx, pick, monitor);
    return {
      backend: 'web', deviceId: settings.deviceId || requestedId || '', label: track.label, outputLabel: '', channels,
      sampleRate: settings.sampleRate || ctx.sampleRate, requestedFrames: 0, bufferFrames: 0, xruns: 0,
      measure(out) {
        dry.getFloatTimeDomainData(buf);
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = buf[i];
          sum += v * v;
          peak = Math.max(peak, v < 0 ? -v : v);
        }
        out.peak = peak;
        out.rms = Math.sqrt(sum / buf.length);
        out.ch0 = peakOf(left);
        out.ch1 = channels > 1 ? peakOf(right) : 0;
        out.clip = out.ch0 >= CLIP || out.ch1 >= CLIP;
        return true;
      },
      apply(next) {
        const channel = next.channel >= 0 && next.channel < channels ? next.channel : -1;
        if (channel !== routed) {
          if (routed === -1) source.disconnect(pick);
          else if (routed >= 0) splitter.disconnect(pick);
          if (channel < 0) source.connect(pick);
          else splitter.connect(pick, channel);
          routed = channel;
        }
        monitor.gain.setTargetAtTime(Math.max(0, next.monitorGain), ctx.currentTime, 0.02);
        tone.apply(next.tone);
      },
      latency() {
        const s = track.getSettings() as { latency?: unknown };
        const out = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
        return { kind: 'web', inputMs: typeof s.latency === 'number' ? s.latency * 1000 : NaN, outputMs: out > 0 ? out * 1000 : NaN, bufferMs: NaN };
      },
      close() {
        unwake();
        stopAnalysis();
        tone.stop();
        for (const t of stream.getTracks()) {
          t.onended = null;
          t.stop();
        }
        source.disconnect();
        void ctx.close().catch(() => {});
      },
    };
  } catch (e) {
    void ctx.close().catch(() => {});
    throw e;
  }
}

// ——— браузер: гитарный процессор мониторинга ———

/**
 * Ворклет тона между выбранным каналом и мониторингом. Пока он грузится (или без AudioWorklet — тесты), мониторинг
 * сухой: pick → monitor; готов — pick → тон → monitor, параметры — изменившимися парами.
 */
let toneModulePromise: Promise<WebAssembly.Module> | null = null;

/** WASM гитарного процессора (tone.wasm из того же ядра; только гитарный чанк); компилируется один раз на страницу. */
function toneModule(): Promise<WebAssembly.Module> {
  if (!toneModulePromise) {
    const bin = atob(toneWasmDataUri.slice(toneWasmDataUri.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    toneModulePromise = WebAssembly.compile(bytes);
  }
  return toneModulePromise;
}

function webTone(ctx: AudioContext, pick: AudioNode, monitor: AudioNode): { apply(params: readonly number[]): void; stop(): void } {
  pick.connect(monitor);
  let node: AudioWorkletNode | null = null;
  let stopped = false;
  let wanted: readonly number[] | null = null;
  let sent: readonly number[] | null = null;
  const flush = () => {
    if (!node || !wanted) return;
    const params = changedToneParams(sent, wanted);
    if (params.length) node.port.postMessage({ type: 'set', params });
    sent = wanted;
  };
  if (ctx.audioWorklet)
    void (async () => {
      const module = await toneModule();
      const url = URL.createObjectURL(new Blob([TONE_PROCESSOR_SOURCE], { type: 'application/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      if (stopped) return;
      sent = wanted ?? toneParams(null);
      node = new AudioWorkletNode(ctx, 'pupitre-tone', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { module, params: changedToneParams(null, sent) },
      });
      pick.disconnect(monitor);
      pick.connect(node);
      node.connect(monitor);
    })().catch(() => {
      // процессор не завёлся (нет WASM/ворклета) — мониторинг остаётся сухим
    });
  return {
    apply(params) {
      wanted = params;
      flush();
    },
    stop() {
      stopped = true;
      node?.port.close();
      node?.disconnect();
    },
  };
}

// ——— браузер: анализ на ворклетах ———

/** Середина окна YIN вокального ядра — раньше конца окна на столько сэмплов (packages/dsp: окно 1024 + 768). */
const YIN_HALF_WINDOW = 896;
let dspModulePromise: Promise<WebAssembly.Module> | null = null;

/** WASM-ядро высоты — то же, что у вокала; компилируется один раз на страницу. */
function dspModule(): Promise<WebAssembly.Module> {
  if (!dspModulePromise) {
    const bin = atob(dspWasmDataUri.slice(dspWasmDataUri.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    dspModulePromise = WebAssembly.compile(bytes);
  }
  return dspModulePromise;
}

/**
 * Ворклеты анализа на сухом сигнале: высота (вокальное ядро, гейт −50 dBFS / чистота 0.5) и атаки. Время кадра —
 * время контекста, на часы страницы — через currentTime в момент приёма, минус задержка входа. Без AudioWorklet
 * (тесты) — ничего. Вернёт остановку.
 */
function webAnalysis(ctx: AudioContext, dry: AudioNode, inputLatencyMs: () => number): () => void {
  let stopped = false;
  const nodes: AudioWorkletNode[] = [];
  if (!ctx.audioWorklet) return () => {};
  const perfOf = (t: number) => platform.now() - (ctx.currentTime - t) * 1000 - inputLatencyMs();
  void (async () => {
    const module = await dspModule();
    const url = URL.createObjectURL(new Blob([PITCH_PROCESSOR_SOURCE, ONSET_PROCESSOR_SOURCE], { type: 'application/javascript' }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (stopped) return;
    const pitch = new AudioWorkletNode(ctx, 'pitch-processor', {
      numberOfInputs: 1, numberOfOutputs: 0, processorOptions: { module, gateRms: 0.003, gateClarity: 0.5 },
    });
    pitch.port.onmessage = (e) => {
      const d = e.data as { t0: number; frames: Float32Array };
      for (let o = 0; o + FRAME_FLOATS <= d.frames.length; o += FRAME_FLOATS) {
        const f = decodeFrame(d.frames, o, d.t0);
        emitFrame({
          atMs: perfOf(f.t - YIN_HALF_WINDOW / ctx.sampleRate), midi: f.voiced && Number.isFinite(f.midiRaw) ? f.midiRaw : NaN,
          clarity: f.clarity, levelDb: f.rms > 0 ? 20 * Math.log10(f.rms) : -Infinity, onset: false,
        });
      }
    };
    const onset = new AudioWorkletNode(ctx, 'pupitre-onset', { numberOfInputs: 1, numberOfOutputs: 0 });
    onset.port.onmessage = (e) => {
      const d = e.data as { t: number; peak: number };
      emitFrame({ atMs: perfOf(d.t), midi: NaN, clarity: 0, levelDb: d.peak > 0 ? 20 * Math.log10(d.peak) : -Infinity, onset: true });
    };
    dry.connect(pitch);
    dry.connect(onset);
    nodes.push(pitch, onset);
  })().catch(() => {
    // анализ не завёлся (нет WASM/ворклета) — вход работает без кадров
  });
  return () => {
    stopped = true;
    for (const node of nodes) {
      node.port.close();
      node.disconnect();
    }
  };
}

const ask = (deviceId: string | null) =>
  platform.getUserMedia({ audio: deviceId ? { ...CONSTRAINTS, deviceId: { exact: deviceId } } : CONSTRAINTS, video: false });

async function webOpen(deviceId: string | null, label: string, my: number): Promise<Capture> {
  let stream: MediaStream;
  try {
    stream = await ask(deviceId);
  } catch (e) {
    // Браузер выдал устройству новый id (сброс данных сайта, другая сессия, другой бэкенд) — то же устройство по метке.
    if (!deviceId || !label || !missing(e)) throw e;
    const same = await sameByLabel(deviceId, label);
    if (!same) throw e;
    stream = await ask(same);
  }
  const track = stream.getAudioTracks()[0];
  if (my !== gen || !track) {
    for (const t of stream.getTracks()) t.stop();
    throw my !== gen ? named('Superseded', 'открытие отменено') : named('NotReadableError', 'нет дорожки звука');
  }
  let cap: Capture;
  try {
    cap = webCapture(stream, track, deviceId);
  } catch (e) {
    for (const t of stream.getTracks()) t.stop();
    throw named('NotReadableError', errorText(e));
  }
  // Устройство выдернули, доступ отозвали — поток кончился.
  track.onended = () => onLost(cap);
  return cap;
}

// ——— движок ———

function engineFailure(e: unknown): Error {
  const message = errorText(e);
  // код — в начале сообщения аддона; мост IPC мог оставить свой префикс
  if (/\bNOT_FOUND\b/.test(message)) return named('NotFoundError', message);
  if (/\bNO_ENGINE\b/.test(message)) return named('EngineUnavailable', message);
  return named('EngineError', message);
}

async function engineCapture(api: EngineApi, deviceId: string | null, label: string): Promise<Capture> {
  let last: EngineMeters | null = null;
  /** Когда пришёл последний пакет метров: молчание дольше ENGINE_SILENT_MS — движок закрыт помимо нас. */
  let metersAt = platform.now();
  // Пакеты метров между замерами: максимумы, перегруз — «был ли»
  const acc = { peak: 0, rms: 0, ch0: 0, ch1: 0, clip: false, fresh: false };
  let cap: Capture | null = null;
  const offMeters = api.onMeters((m) => {
    last = m;
    metersAt = platform.now();
    acc.peak = Math.max(acc.peak, m.dryPeak);
    acc.rms = Math.max(acc.rms, m.dryRms);
    acc.ch0 = Math.max(acc.ch0, m.peak[0]);
    acc.ch1 = Math.max(acc.ch1, m.peak[1]);
    acc.clip ||= m.clipped;
    acc.fresh = true;
    if (cap) {
      cap.xruns = m.xruns;
      cap.bufferFrames = m.bufferFrames;
    }
  });
  const offEvents = api.onEvent((event) => {
    if (cap) onEngineEvent(cap, event);
  });
  // Часы JACK → часы страницы: сдвиг — минимум (время приёма − время отправки) по пакетам (задержка доставки
  // убирается минимумом); медленно отпускается вверх — переживает скачок часов.
  let clockMs = Infinity;
  const offFrames = api.onFrames((batch) => {
    const offset = platform.now() - batch.nowUs / 1000;
    clockMs = Math.min(offset, clockMs + 0.05);
    const f = batch.frames;
    for (let i = 0; i + 4 < f.length; i += 5) {
      emitFrame({ atMs: f[i] / 1000 + clockMs, midi: f[i + 1], clarity: f[i + 2], levelDb: f[i + 3], onset: f[i + 4] === 1 });
    }
  });
  // процессор движка: при открытии — все параметры, потом — изменившиеся
  let toneSent: readonly number[] | null = null;
  const options = (id: string | null) => {
    toneSent = config.tone;
    return {
      capture: id, playback: config.outputDeviceId, channel: config.channel, bufferFrames: config.bufferFrames, monitorGain: config.monitorGain,
      tone: changedToneParams(null, config.tone),
    };
  };
  const openEngine = async (): Promise<EngineOpenInfo> => {
    try {
      return await api.open(options(deviceId));
    } catch (e) {
      // Сохранённый id — от браузера или устройство переименовано: то же устройство по метке.
      const failure = engineFailure(e);
      if (!deviceId || !label || failure.name !== 'NotFoundError') throw failure;
      const same = await sameByLabel(deviceId, label).catch(() => null);
      if (!same) throw failure;
      return api.open(options(same)).catch((err: unknown) => {
        throw engineFailure(err);
      });
    }
  };
  const info = await openEngine().catch((e: unknown) => {
    offMeters();
    offEvents();
    offFrames();
    // «не ответил» — движок мог открыться позже: закрыть, чтобы не звучал мониторинг без сессии
    if (/не ответил/.test(errorText(e))) void api.close().catch(() => {});
    throw e;
  });
  const ms = (frames: number) => (frames / info.sampleRate) * 1000;
  const opened: Capture = {
    backend: 'engine', deviceId: info.captureId, label: info.captureLabel, outputLabel: info.playbackLabel, channels: info.captureChannels,
    sampleRate: info.sampleRate,
    requestedFrames: info.requestedFrames, bufferFrames: info.bufferFrames, xruns: 0,
    measure(out) {
      // сторож: метры движка молчат — его закрыли помимо сессии (главный процесс) — поток кончился
      if (platform.now() - metersAt > ENGINE_SILENT_MS) {
        queueMicrotask(() => onLost(opened));
        return false;
      }
      if (acc.fresh) {
        out.peak = acc.peak;
        out.rms = acc.rms;
        out.ch0 = acc.ch0;
        out.ch1 = acc.ch1;
        out.clip = acc.clip;
        acc.peak = acc.rms = acc.ch0 = acc.ch1 = 0;
        acc.clip = acc.fresh = false;
        return true;
      }
      const m = last as EngineMeters | null;
      if (!m) return false;
      out.peak = m.dryPeak;
      out.rms = m.dryRms;
      out.ch0 = m.peak[0];
      out.ch1 = m.peak[1];
      out.clip = false;
      return true;
    },
    apply(next) {
      const tone = changedToneParams(toneSent, next.tone);
      toneSent = next.tone;
      api.set({ channel: next.channel, monitorGain: next.monitorGain, ...(tone.length ? { tone } : {}) });
    },
    latency() {
      // свежий отчёт драйвера из метров; до первого пакета — значения открытия
      const m = last as EngineMeters | null;
      const capture = m?.captureLatencyFrames || info.captureLatencyFrames;
      const playback = m?.playbackLatencyFrames || info.playbackLatencyFrames;
      return { kind: 'engine', inputMs: ms(capture), outputMs: ms(playback), bufferMs: ms(opened.bufferFrames) };
    },
    close() {
      offMeters();
      offEvents();
      offFrames();
      void api.close().catch(() => {});
    },
  };
  cap = opened;
  return opened;
}

function onEngineEvent(cap: Capture, event: EngineEvent) {
  if (capture !== cap) return;
  if (event.kind === 'device-lost') publish({ state: 'device-lost' });
  else if (event.kind === 'device-back') {
    resetLevel();
    publish({ state: 'no-signal' });
  } else if (event.kind === 'reopened') {
    cap.bufferFrames = event.bufferFrames;
    publish({ bufferFrames: event.bufferFrames });
  } else if (event.kind === 'shutdown') onLost(cap);
}

// ——— открытие и закрытие ———

async function openCapture(deviceId: string | null, label: string, my: number): Promise<Capture> {
  const api = engineApi();
  if (api) {
    try {
      return await engineCapture(api, deviceId, label);
    } catch (e) {
      if (errorName(e) !== 'EngineUnavailable') throw e;
      // JACK недоступен — тот же вход через браузер
      markEngineDown(errorText(e));
    }
  }
  return webOpen(deviceId, label, my);
}

function teardown() {
  stopTicks?.();
  stopTicks = null;
  const cap = capture;
  capture = null;
  cap?.close();
}

function resetLevel() {
  level.rmsDb = level.peakDb = level.barDb = level.holdDb = level.playDb = -Infinity;
  level.channelDb[0] = level.channelDb[1] = -Infinity;
  level.clipping = false;
  levelAt = holdAt = 0;
  clipAt = loudAt = -Infinity;
}

async function open(deviceId: string | null, label: string): Promise<void> {
  const my = ++gen;
  lastRequest = { deviceId, label };
  teardown();
  publish({ ...CLOSED, state: 'opening', backend: inputBackend(), deviceId, label, engineError: engineDown });
  platform.stopVoice();
  let cap: Capture;
  try {
    cap = await openCapture(deviceId, label, my);
  } catch (e) {
    if (my === gen) publish({ ...CLOSED, state: failure(e, deviceId), backend: inputBackend(), deviceId, label, engineError: engineDown });
    return;
  }
  if (my !== gen) {
    cap.close();
    return;
  }
  capture = cap;
  if (cap.backend === 'engine') engineDown = '';
  cap.apply(config);
  resetLevel();
  stopTicks = platform.every(TICK_MS, () => tick(platform.now()));
  publish({
    state: 'no-signal', backend: cap.backend, deviceId: cap.deviceId, label: cap.label, channels: cap.channels, sampleRate: cap.sampleRate,
    bufferFrames: cap.bufferFrames, requestedFrames: cap.requestedFrames, xruns: 0, engineError: engineDown, outputLabel: cap.outputLabel,
  });
}

/** Поток кончился (выдернули, отозвали доступ, движок упал): одна повторная проба покажет причину. */
function onLost(cap: Capture) {
  if (capture !== cap) return;
  teardown();
  const request = lastRequest ?? { deviceId: config.deviceId, label: config.deviceLabel };
  publish({ ...CLOSED, state: 'device-lost', backend: inputBackend(), deviceId: request.deviceId, label: request.label, engineError: engineDown });
  const now = platform.now();
  if (refs && now - probedAt >= PROBE_GAP_MS) {
    probedAt = now;
    void open(request.deviceId, request.label);
  }
}

function close() {
  gen++;
  teardown();
  resetLevel();
  publish({ ...CLOSED, backend: inputBackend(), engineError: engineDown });
}

function onDeviceChange() {
  for (const fn of [...deviceListeners]) fn();
  // Устройство вернулось или появилось — открываем снова то, что просили (не нашлось — состояние остаётся прежним).
  if (!refs || !lastRequest || (snapshot.state !== 'device-lost' && snapshot.state !== 'not-found')) return;
  if (lastRequest.deviceId === null && config.deviceId !== null) return;
  void open(lastRequest.deviceId, lastRequest.label);
}

function watch(on: boolean) {
  if (on && !unwatch) unwatch = platform.onDeviceChange(onDeviceChange);
  if (!on && unwatch) {
    unwatch();
    unwatch = null;
  }
}

/**
 * Настройки входа из раздела: смена устройства, бэкенда или буфера движка переоткрывает захват, канал и мониторинг
 * применяются на лету; выбор «без входа» закрывает его. Без держателя (acquireInput) только запоминаются.
 */
export function configureInput(next: InputConfig): void {
  const prev = config;
  config = next;
  if (!refs) return;
  if (next.deviceId === null) {
    if (prev.deviceId !== null) close();
    return;
  }
  const reopen =
    next.backend !== prev.backend ||
    next.outputDeviceId !== prev.outputDeviceId ||
    (next.bufferFrames !== prev.bufferFrames && capture?.backend === 'engine') ||
    (next.deviceId !== prev.deviceId && next.deviceId !== snapshot.deviceId);
  if (reopen) {
    void open(next.deviceId, next.deviceLabel);
    return;
  }
  capture?.apply(next);
}

/** Держать вход открытым (выбранное устройство открывается); вернёт освобождение. */
export function acquireInput(): () => void {
  refs++;
  clearTimeout(closing);
  watch(true);
  if (refs === 1) {
    platform.stopVoice();
    if (snapshot.state === 'off') publish({ backend: inputBackend(), engineError: engineDown });
    if (config.deviceId !== null && snapshot.state === 'off') void open(config.deviceId, config.deviceLabel);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--refs) return;
    closing = setTimeout(() => {
      if (refs) return;
      watch(false);
      close();
    }, 0);
  };
}

/** Открыть вход по действию игрока (выбор устройства, «Разрешить доступ», «Повторить»): null — устройство по умолчанию. */
export async function requestInput(deviceId: string | null): Promise<InputSnapshot> {
  probedAt = -Infinity;
  await open(deviceId, '');
  return snapshot;
}

function tick(now: number) {
  const cap = capture;
  if (!cap || (levelAt && now - levelAt < 4) || !cap.measure(raw)) return;
  const rmsDb = dB(raw.rms);
  const peakDb = dB(raw.peak);
  const dt = levelAt ? Math.min(0.25, (now - levelAt) / 1000) : 0;
  levelAt = now;
  level.rmsDb = rmsDb;
  level.peakDb = peakDb;
  level.barDb = Math.max(peakDb, level.barDb - 30 * dt);
  if (peakDb >= level.holdDb) {
    level.holdDb = peakDb;
    holdAt = now;
  } else if (now - holdAt > HOLD_MS) level.holdDb = Math.max(peakDb, level.holdDb - 20 * dt);
  const signal = rmsDb > signalDb();
  if (signal) {
    loudAt = now;
    level.playDb = Math.max(peakDb, level.playDb - 3 * dt);
  }
  if (raw.clip) clipAt = now;
  level.clipping = now - clipAt < CLIP_HOLD_MS;
  level.channelDb[0] = dB(raw.ch0);
  level.channelDb[1] = dB(raw.ch1);
  // Снимок пересобирается только при смене — в обычном кадре без аллокаций.
  const state = isOpen(snapshot.state) ? (level.clipping ? 'clipping' : now - loudAt < SILENCE_MS ? 'ok' : 'no-signal') : snapshot.state;
  if (state !== snapshot.state || cap.xruns !== snapshot.xruns || cap.bufferFrames !== snapshot.bufferFrames)
    publish({ state, xruns: cap.xruns, bufferFrames: cap.bufferFrames });
}

/** Уровень входа сейчас (зовётся из кадров анимации; второй читатель в том же кадре получает тот же замер). */
export function readLevel(now = platform.now()): InputLevel {
  tick(now);
  return level;
}

/** Фон в тишине: медиана RMS замеров за ms миллисекунд, dBFS; NaN — вход закрыт или закрылся по ходу замера. */
export async function measureNoise(ms = 2000, stepMs = 50): Promise<number> {
  const cap = capture;
  if (!cap) return NaN;
  const values: number[] = [];
  const sample: Raw = { peak: 0, rms: 0, ch0: 0, ch1: 0, clip: false };
  for (let t = 0; t < ms; t += stepMs) {
    await new Promise((resolve) => setTimeout(resolve, stepMs));
    if (capture !== cap) return NaN;
    if (cap.measure(sample)) values.push(dB(sample.rms));
  }
  if (!values.length) return NaN;
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
}

/** Задержка входа: браузер — его оценка, движок — отчёт драйвера; NaN — неизвестно. */
export function readLatency(): InputLatency {
  return capture?.latency() ?? { kind: inputBackend(), inputMs: NaN, outputMs: NaN, bufferMs: NaN };
}

/** Только для тестов: подмена внешних API (null — браузер); сессия сбрасывается. */
export function setInputPlatform(next: InputPlatform | null): void {
  clearTimeout(closing);
  watch(false);
  close();
  refs = 0;
  config = NO_INPUT;
  lastRequest = null;
  probedAt = -Infinity;
  engineDown = '';
  engineDownAt = -Infinity;
  engineDownForever = false;
  listeners.clear();
  deviceListeners.clear();
  frameListeners.clear();
  platform = next ?? browser;
  snapshot = { ...CLOSED, backend: inputBackend() };
}

// e2e и отладка: состояние сессии и последний замер уровня — только в dev-сборке.
if (import.meta.env.DEV)
  Object.defineProperty(globalThis, '__pupitreInput', {
    value: () => ({ ...snapshot, level: { ...level, channelDb: [...level.channelDb] } }),
    configurable: true,
  });

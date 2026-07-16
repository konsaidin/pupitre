// Нативный бэкенд AudioInput (Electron, этап 4 курса 2): захват и DSP-ядро
// работают в аудиопотоке драйвера (packages/native-audio, cpal + N-API),
// сюда кадры приходят батчами через IPC-мост preload (window.nativeAudio).
//
// Часы: t кадров в батче — секунды от старта нативного потока (счётчик
// сэмплов ядра). Здесь они привязываются к AudioContext-времени EMA-якорем
// по возрасту кадра (таймстампы драйвера) и замеру доставки (epoch-мс) —
// движок получает то же ctx-время, что и от worklet-пути.

import {
  DEFAULT_MIC,
  FRAME_FLOATS,
  YIN_WIN,
  decodeFrame,
  type AudioDevice,
  type AudioInput,
  type FrameListener,
  type MicOptions,
} from './AudioInput';

/** сглаживание якоря старта потока: гасит джиттер IPC-доставки */
const ANCHOR_EMA = 0.05;
/** сглаживание замера задержки доставки */
const LAT_EMA = 0.1;

interface FrameBatch {
  frames: Float32Array;
  /** возраст последнего кадра батча на момент отправки, мс (часы драйвера) */
  ageMs: number;
  /** epoch-мс отправки из нативного потока */
  postedAtMs: number;
}

export interface NativeAudioBridge {
  listDevices(): Promise<(AudioDevice & { isDefault: boolean })[]>;
  start(opts: { deviceId: string | null; gateRms: number; gateClarity: number }): Promise<{
    sampleRate: number;
    channels: number;
    device: string;
  }>;
  stop(): Promise<void>;
  setGate(gateRms: number, gateClarity: number): void;
  onFrames(cb: (batch: FrameBatch) => void): () => void;
}

/** Мост из preload; null вне Electron или когда аддон не загрузился. */
export function nativeAudioBridge(): NativeAudioBridge | null {
  return (window as { nativeAudio?: NativeAudioBridge }).nativeAudio ?? null;
}

export class NativeAudioInput implements AudioInput {
  readonly kind = 'native' as const;

  private ctx: AudioContext;
  private bridge: NativeAudioBridge;
  private listeners = new Set<FrameListener>();
  private unsub: (() => void) | null = null;
  private running = false;
  /** ключ запуска: смена устройства требует перезапуска потока */
  private startedKey = '';
  private sampleRate = 48000;
  /** ctx-время старта нативного потока (EMA-якорь) */
  private startCtx = NaN;
  /** EMA возраста кадра на момент прихода в рендерер (драйвер + IPC), мс */
  private deliveryMs = NaN;

  constructor(ctx: AudioContext, bridge: NativeAudioBridge) {
    this.ctx = ctx;
    this.bridge = bridge;
  }

  async listDevices(): Promise<AudioDevice[]> {
    return this.bridge.listDevices();
  }

  setGate(gateRms: number, gateClarity: number): void {
    this.bridge.setGate(gateRms, gateClarity);
  }

  /** Задержка тракта: возраст кадра при доставке + пол-окна YIN. */
  latencyMs(): number {
    if (Number.isNaN(this.deliveryMs)) return NaN;
    const analysisMs = (YIN_WIN / 2 / this.sampleRate) * 1000;
    return analysisMs + this.deliveryMs;
  }

  async start(deviceId: string | null, opts: MicOptions = DEFAULT_MIC): Promise<void> {
    // платформенные noiseSuppression/echoCancellation/autoGain не применимы:
    // тракт сырой, от драйвера — в этом смысл нативного пути
    const key = deviceId ?? '';
    if (this.running && key === this.startedKey) {
      this.setGate(opts.gateRms, opts.gateClarity);
      return;
    }
    if (this.running) this.stop();
    const info = await this.bridge.start({
      deviceId,
      gateRms: opts.gateRms,
      gateClarity: opts.gateClarity,
    });
    this.sampleRate = info.sampleRate;
    this.startCtx = NaN;
    this.deliveryMs = NaN;
    this.unsub = this.bridge.onFrames((b) => this.onBatch(b));
    this.running = true;
    this.startedKey = key;
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
    this.running = false;
    this.startedKey = '';
    this.deliveryMs = NaN;
    void this.bridge.stop();
  }

  onFrame(fn: FrameListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private onBatch(batch: FrameBatch): void {
    const flat = batch.frames;
    if (flat.length < FRAME_FLOATS) return;
    // якорь часов: последний кадр батча «звучал» lagMs назад
    const transitMs = Math.max(0, Date.now() - batch.postedAtMs);
    const lagMs = batch.ageMs + transitMs;
    const tRelLast = flat[flat.length - FRAME_FLOATS];
    const anchor = this.ctx.currentTime - lagMs / 1000 - tRelLast;
    this.startCtx = Number.isNaN(this.startCtx)
      ? anchor
      : this.startCtx + ANCHOR_EMA * (anchor - this.startCtx);
    this.deliveryMs = Number.isNaN(this.deliveryMs)
      ? lagMs
      : this.deliveryMs + LAT_EMA * (lagMs - this.deliveryMs);
    for (let o = 0; o + FRAME_FLOATS <= flat.length; o += FRAME_FLOATS) {
      const frame = decodeFrame(flat, o, this.startCtx);
      this.listeners.forEach((fn) => fn(frame));
    }
  }
}

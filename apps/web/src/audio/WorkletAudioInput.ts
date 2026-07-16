// Веб-бэкенд AudioInput: getUserMedia + DSP-ядро (Rust → WASM) в AudioWorklet.
//
// Вся обработка — YIN, гейт с гистерезисом, октавная коррекция, сглаживание,
// вибрато, расщепление, громкость — в packages/dsp; здесь только запуск
// потока, доставка модуля в worklet и декодирование кадров анализа.
//
// Все времена — в секундах AudioContext.currentTime (общие часы игры).

import { PITCH_PROCESSOR_SOURCE } from './pitchProcessorSource';
// data-URI, а не ?url: под file:// в Electron fetch ассетов не работает
import dspWasmDataUri from '../assets/dsp.wasm?inline';
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

/** сглаживание замера доставки кадров */
const LAT_EMA = 0.1;

let dspModulePromise: Promise<WebAssembly.Module> | null = null;

/** Компиляция WASM-ядра — один раз на страницу. */
function dspModule(): Promise<WebAssembly.Module> {
  if (!dspModulePromise) {
    const b64 = dspWasmDataUri.slice(dspWasmDataUri.indexOf(',') + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    dspModulePromise = WebAssembly.compile(bytes);
  }
  return dspModulePromise;
}

export class WorkletAudioInput implements AudioInput {
  readonly kind = 'worklet' as const;

  private ctx: AudioContext;
  private node: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private listeners = new Set<FrameListener>();
  private gateRms = DEFAULT_MIC.gateRms;
  private gateClarity = DEFAULT_MIC.gateClarity;
  /** ключ констрейнтов getUserMedia — смена требует перезапуска потока */
  private constraintsKey = '';
  /** задержка драйвер→граф из настроек трека, мс (браузер может не отдать) */
  private captureMs = 0;
  /** EMA задержки доставки кадра worklet→main, мс */
  private deliveryMs = NaN;
  private static workletLoaded = new WeakSet<AudioContext>();

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  async listDevices(): Promise<AudioDevice[]> {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({ id: d.deviceId, label: d.label }));
  }

  setGate(gateRms: number, gateClarity: number): void {
    this.gateRms = gateRms;
    this.gateClarity = gateClarity;
    this.node?.port.postMessage({ type: 'gate', gateRms, gateClarity });
  }

  /**
   * Задержка тракта захват→кадр: capture (драйвер→граф, если браузер отдал)
   * + пол-окна YIN (оценка усреднена по окну) + измеренная доставка кадра.
   */
  latencyMs(): number {
    if (Number.isNaN(this.deliveryMs)) return NaN;
    const analysisMs = (YIN_WIN / 2 / this.ctx.sampleRate) * 1000;
    return this.captureMs + analysisMs + this.deliveryMs;
  }

  async start(deviceId: string | null, opts: MicOptions = DEFAULT_MIC): Promise<void> {
    this.setGate(opts.gateRms, opts.gateClarity);
    const key = JSON.stringify([deviceId ?? null, opts.noiseSuppression, opts.echoCancellation, opts.autoGain]);
    if (this.node) {
      if (this.constraintsKey === key) return;
      this.stop(); // констрейнты изменились — нужен новый поток
    }
    const module = await dspModule();
    if (!WorkletAudioInput.workletLoaded.has(this.ctx)) {
      const blob = new Blob([PITCH_PROCESSOR_SOURCE], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      try {
        await this.ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      WorkletAudioInput.workletLoaded.add(this.ctx);
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: opts.echoCancellation,
        noiseSuppression: opts.noiseSuppression,
        autoGainControl: opts.autoGain,
        channelCount: 1,
      },
    });
    this.constraintsKey = key;
    const settings = this.stream.getAudioTracks()[0]?.getSettings() as { latency?: number };
    this.captureMs = settings?.latency ? settings.latency * 1000 : 0;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'pitch-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: { module, gateRms: this.gateRms, gateClarity: this.gateClarity },
    });
    this.node.port.onmessage = (e) => {
      const d = e.data as { t0: number; frames: Float32Array };
      this.onBatch(d.t0, d.frames);
    };
    this.source.connect(this.node);
  }

  stop(): void {
    this.source?.disconnect();
    this.node?.port.close();
    this.node = null;
    this.source = null;
    this.stream?.getTracks().forEach((tr) => tr.stop());
    this.stream = null;
    this.constraintsKey = '';
    this.deliveryMs = NaN;
  }

  onFrame(fn: FrameListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Раскладка кадра — контракт с AnalysisFrame::write в packages/dsp. */
  private onBatch(t0: number, flat: Float32Array): void {
    for (let o = 0; o + FRAME_FLOATS <= flat.length; o += FRAME_FLOATS) {
      const frame = decodeFrame(flat, o, t0);
      this.listeners.forEach((fn) => fn(frame));
    }
    // доставка: разница часов графа между последним сэмплом кадра и «сейчас»
    const tLast = t0 + flat[flat.length - FRAME_FLOATS];
    const d = (this.ctx.currentTime - tLast) * 1000;
    if (d >= 0 && d < 500) {
      this.deliveryMs = Number.isNaN(this.deliveryMs) ? d : this.deliveryMs + LAT_EMA * (d - this.deliveryMs);
    }
  }
}

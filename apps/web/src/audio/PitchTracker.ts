// Захват микрофона + pitch-детектор в AudioWorklet + сглаживание.
//
// Все времена — в секундах AudioContext.currentTime (общие часы игры).

import { PITCH_PROCESSOR_SOURCE } from './pitchProcessorSource';
import { hzToMidi } from '../lib/music';

export interface PitchFrame {
  /** время AudioContext, сек */
  t: number;
  hz: number;
  /** дробная midi-высота после медианного сглаживания; NaN если голоса нет */
  midi: number;
  clarity: number;
  rms: number;
  voiced: boolean;
}

export type PitchListener = (frame: PitchFrame) => void;

const MIN_CLARITY = 0.55;
const MIN_RMS = 0.006;
const MEDIAN_WINDOW = 5;

export class PitchTracker {
  private ctx: AudioContext;
  private node: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private listeners = new Set<PitchListener>();
  private recentMidis: number[] = [];
  private static workletLoaded = new WeakSet<AudioContext>();

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  async start(deviceId?: string | null): Promise<void> {
    if (this.node) return;
    if (!PitchTracker.workletLoaded.has(this.ctx)) {
      const blob = new Blob([PITCH_PROCESSOR_SOURCE], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      try {
        await this.ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      PitchTracker.workletLoaded.add(this.ctx);
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'pitch-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });
    this.node.port.onmessage = (e) => this.onRaw(e.data as { t: number; freq: number; clarity: number; rms: number });
    this.source.connect(this.node);
  }

  stop(): void {
    this.source?.disconnect();
    this.node?.port.close();
    this.node = null;
    this.source = null;
    this.stream?.getTracks().forEach((tr) => tr.stop());
    this.stream = null;
    this.recentMidis = [];
  }

  onFrame(fn: PitchListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private onRaw(raw: { t: number; freq: number; clarity: number; rms: number }): void {
    const voicedRaw = raw.freq > 0 && raw.clarity >= MIN_CLARITY && raw.rms >= MIN_RMS;
    let midi = NaN;
    if (voicedRaw) {
      this.recentMidis.push(hzToMidi(raw.freq));
      if (this.recentMidis.length > MEDIAN_WINDOW) this.recentMidis.shift();
      // медиана гасит одиночные октавные срывы детектора
      const sorted = [...this.recentMidis].sort((a, b) => a - b);
      midi = sorted[Math.floor(sorted.length / 2)];
    } else {
      this.recentMidis = [];
    }
    const frame: PitchFrame = {
      t: raw.t,
      hz: raw.freq,
      midi,
      clarity: raw.clarity,
      rms: raw.rms,
      voiced: voicedRaw,
    };
    this.listeners.forEach((fn) => fn(frame));
  }
}

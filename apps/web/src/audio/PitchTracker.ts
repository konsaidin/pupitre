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

const CLARITY_ENTER = 0.6; // порог входа в «голос есть»
const CLARITY_HOLD = 0.48; // удержание: гистерезис против мерцания на границе
const MIN_RMS = 0.006;
const MEDIAN_WINDOW = 5;
const EMA_ALPHA = 0.45; // догладка после медианы: гасит дрожь в десятки центов
// октавный срыв: скачок ≥ ниже, который свёрткой на ±12 попадает близко к медиане
const OCTAVE_JUMP_SEMIS = 7;
const OCTAVE_NEAR_SEMIS = 3;
const OCTAVE_ACCEPT_FRAMES = 8; // ~85 мс подряд — считаем сменой октавы, а не срывом

export class PitchTracker {
  private ctx: AudioContext;
  private node: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private listeners = new Set<PitchListener>();
  private recentMidis: number[] = [];
  private wasVoiced = false;
  private smoothed = NaN;
  private foldStreak = 0;
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
    this.smoothed = NaN;
    this.foldStreak = 0;
    this.wasVoiced = false;
  }

  onFrame(fn: PitchListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private onRaw(raw: { t: number; freq: number; clarity: number; rms: number }): void {
    // гистерезис: войти в voiced сложнее, чем удержаться — кружок не мерцает
    const clarityMin = this.wasVoiced ? CLARITY_HOLD : CLARITY_ENTER;
    const voicedRaw = raw.freq > 0 && raw.clarity >= clarityMin && raw.rms >= MIN_RMS;
    this.wasVoiced = voicedRaw;
    let midi = NaN;
    if (voicedRaw) {
      let m = hzToMidi(raw.freq);
      // подавление октавных срывов: скачок, который свёрткой на ±12 ложится
      // рядом с недавней медианой — глюк детектора. Если «глюк» держится
      // ~85 мс подряд — это настоящая смена октавы, принимаем её.
      if (this.recentMidis.length >= 3) {
        const sorted = [...this.recentMidis].sort((a, b) => a - b);
        const med = sorted[sorted.length >> 1];
        const folded = m - 12 * Math.round((m - med) / 12);
        if (Math.abs(m - med) >= OCTAVE_JUMP_SEMIS && Math.abs(folded - med) <= OCTAVE_NEAR_SEMIS) {
          this.foldStreak++;
          if (this.foldStreak <= OCTAVE_ACCEPT_FRAMES) m = folded;
          else {
            this.recentMidis = [];
            this.smoothed = NaN;
            this.foldStreak = 0;
          }
        } else {
          this.foldStreak = 0;
        }
      }
      this.recentMidis.push(m);
      if (this.recentMidis.length > MEDIAN_WINDOW) this.recentMidis.shift();
      // медиана гасит одиночные выбросы, EMA — мелкую дрожь
      const sorted = [...this.recentMidis].sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      this.smoothed = Number.isNaN(this.smoothed) ? med : this.smoothed + EMA_ALPHA * (med - this.smoothed);
      midi = this.smoothed;
    } else {
      this.recentMidis = [];
      this.smoothed = NaN;
      this.foldStreak = 0;
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

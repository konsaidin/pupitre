// Часы и аккомпанемент по единому времени AudioContext.
import { Synth } from '../synth';
import type { Transport, TransportLoad } from './Transport';

export class WebAudioTransport implements Transport {
  readonly kind = 'webaudio' as const;
  readonly clockDomain = 'audiocontext' as const;
  private synth: Synth;
  private spec: TransportLoad = { durationMs: 0, layers: [], metronome: false, countIn: false };
  private backingSource: AudioBufferSourceNode | null = null;
  private layerNodes: { id: string; source: AudioBufferSourceNode; gain: GainNode }[] = [];
  private startCtxTime = 0;
  private playStartCtxTime = 0;
  private generation = 0;

  constructor(private ctx: AudioContext) {
    this.synth = new Synth(ctx, 0.5);
  }

  load(spec: TransportLoad): void { this.spec = spec; }

  begin(fromMs: number, leadSec: number, endMs: number): void {
    this.startCtxTime = this.ctx.currentTime + leadSec - fromMs / 1000;
    this.playStartCtxTime = this.ctx.currentTime + leadSec;
    this.generation++;
    this.scheduleBacking(fromMs, endMs);
    if (this.spec.countIn) this.scheduleClicks(fromMs - leadSec * 1000, fromMs);
  }

  halt(): void {
    this.synth.cancelAll();
    this.stopBacking();
    for (const { source } of this.layerNodes) {
      try { source.stop(); } catch { /* уже остановлен */ }
    }
    this.layerNodes = [];
  }

  reschedule(fromMs: number, endMs: number): void {
    this.halt();
    this.scheduleBacking(fromMs, endMs);
  }

  clockNow(): number { return this.ctx.currentTime; }
  songMs(): number { return this.frameToSongMs(this.clockNow(), 0); }
  countdownRemaining(): number { return Math.max(0, this.playStartCtxTime - this.clockNow()); }
  epoch(): number { return this.generation; }

  frameToSongMs(clockT: number, latencyMs: number): number {
    return (clockT - this.startCtxTime) * 1000 - latencyMs;
  }

  songToClock(songMs: number, latencyMs: number): number {
    return this.startCtxTime + (songMs + latencyMs) / 1000;
  }

  heardSongMs(): number {
    if (typeof this.ctx.getOutputTimestamp === 'function') {
      const stamp = this.ctx.getOutputTimestamp();
      if (typeof stamp.contextTime === 'number' && Number.isFinite(stamp.contextTime)) {
        return this.frameToSongMs(stamp.contextTime, 0);
      }
    }
    const latency = this.ctx.outputLatency;
    return this.songMs() - (typeof latency === 'number' && Number.isFinite(latency) ? latency * 1000 : 0);
  }

  setLayerGain(id: string, gain: number): void {
    for (const layer of this.spec.layers) if (layer.id === id) layer.gain = gain;
    for (const layer of this.layerNodes) if (layer.id === id) layer.gain.gain.value = gain;
  }

  // Пошаговое исполнение появится на этапе 37.
  hold(): void {}
  release(): void {}

  private scheduleLayers(fromMs: number, endMs: number): void {
    const when = this.songToClock(fromMs, 0);
    for (const layer of this.spec.layers) {
      if ('kind' in layer.source) throw new Error('WebAudioTransport: нужен AudioBuffer');
      const scale = layer.timeScale ?? 1;
      const offset = (fromMs * scale + (layer.offsetMs ?? 0)) / 1000;
      if (scale <= 0 || offset < 0) throw new Error('WebAudioTransport: неверное смещение или масштаб');
      const source = this.ctx.createBufferSource();
      source.buffer = layer.source;
      source.playbackRate.value = scale;
      const gain = this.ctx.createGain();
      gain.gain.value = layer.gain;
      source.connect(gain).connect(this.ctx.destination);
      source.start(when, offset, (endMs - fromMs) * scale / 1000);
      this.layerNodes.push({ id: layer.id, source, gain });
    }
  }

  private scheduleClicks(fromMs: number, endMs: number): void {
    const beats = this.spec.beats;
    if (beats?.length) {
      // До начала сетки продолжаем её первый интервал назад для счёт-ина.
      const step = beats.length > 1 ? beats[1].ms - beats[0].ms : 0;
      if (step > 0) {
        for (let ms = beats[0].ms - Math.ceil((beats[0].ms - fromMs) / step) * step;
          ms < Math.min(beats[0].ms, endMs); ms += step) {
          if (ms >= fromMs) this.synth.playClick(this.songToClock(ms, 0), false);
        }
      }
      for (const beat of beats) {
        if (beat.ms >= fromMs && beat.ms < endMs) this.synth.playClick(this.songToClock(beat.ms, 0), beat.downbeat);
      }
    } else if (this.spec.bpm) {
      const beatMs = 60000 / this.spec.bpm;
      const firstBeat = Math.ceil(fromMs / beatMs);
      for (let b = firstBeat; b * beatMs < endMs; b++) {
        this.synth.playClick(this.startCtxTime + (b * beatMs) / 1000, b % 4 === 0);
      }
    }
  }

  private scheduleBacking(fromMs: number, endMs: number): void {
    const { guideNotes, metronome, backingBuffer } = this.spec;
    const ctx = this.ctx;
    const backing = this.spec.legacyBacking;
    const startAt = this.startCtxTime; // ctx-время songMs=0
    if (fromMs >= endMs) return;
    if (backing?.kind === 'url' && backingBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = backingBuffer;
      const gain = ctx.createGain();
      gain.gain.value = 0.9;
      src.connect(gain).connect(ctx.destination);
      src.start(startAt + fromMs / 1000, fromMs / 1000, (endMs - fromMs) / 1000);
      this.backingSource = src;
    }
    if (backing?.kind === 'synth') {
      if (guideNotes) {
        for (const n of this.spec.guideEvents ?? []) {
          if (n.startMs + n.durMs <= fromMs) continue;
          if (n.startMs >= endMs) break;
          const t = startAt + Math.max(n.startMs, fromMs) / 1000;
          const dur = (Math.min(n.startMs + n.durMs, endMs) - Math.max(n.startMs, fromMs)) / 1000;
          this.synth.playNote(n.midi, Math.max(t, ctx.currentTime + 0.02), dur, 0.7);
        }
      }
    }
    this.scheduleLayers(fromMs, endMs);
    // URL-минус без сетки сохраняет прежнее поведение: без метронома.
    if (metronome && (backing?.kind !== 'url' || this.spec.beats?.length)) {
      this.scheduleClicks(fromMs, endMs);
    }
  }

  private stopBacking(): void {
    try {
      this.backingSource?.stop();
    } catch {
      // не стартовал
    }
    this.backingSource = null;
  }
}

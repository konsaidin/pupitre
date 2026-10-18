// Встроенный синт: опорные ноты для упражнений и метроном.
// Планирование — по часам AudioContext (точное, не setTimeout).

import { midiToHz } from '../lib/music';

export class Synth {
  private ctx: AudioContext;
  private master: GainNode;
  private scheduled: { osc: OscillatorNode; gain: GainNode }[] = [];

  constructor(ctx: AudioContext, volume = 0.5) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = volume;
    this.master.connect(ctx.destination);
  }

  setVolume(v: number): void {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** Текущее время общего AudioContext, сек. */
  now(): number {
    return this.ctx.currentTime;
  }

  /** Опорная нота: тёплый тембр (треугольник + синус-суб) с ADSR. */
  playNote(midi: number, startTime: number, durSec: number, velocity = 0.8): void {
    const ctx = this.ctx;
    const hz = midiToHz(midi);
    const gain = ctx.createGain();
    gain.connect(this.master);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = hz;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = hz;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.4;
    sub.connect(subGain).connect(gain);
    osc.connect(gain);

    const attack = 0.02;
    const release = Math.min(0.12, durSec * 0.3);
    const end = startTime + durSec;
    const g = gain.gain;
    g.setValueAtTime(0, startTime);
    g.linearRampToValueAtTime(velocity * 0.35, startTime + attack);
    g.setValueAtTime(velocity * 0.35, Math.max(startTime + attack, end - release));
    g.linearRampToValueAtTime(0, end);

    osc.start(startTime);
    sub.start(startTime);
    osc.stop(end + 0.05);
    sub.stop(end + 0.05);
    this.scheduled.push({ osc, gain }, { osc: sub, gain });
    osc.onended = () => {
      gain.disconnect();
      this.scheduled = this.scheduled.filter((s) => s.osc !== osc && s.osc !== sub);
    };
  }

  /** Клик метронома; accent — первая доля такта. */
  playClick(startTime: number, accent = false): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = accent ? 1600 : 1100;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(accent ? 0.25 : 0.15, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.05);
    osc.connect(gain).connect(this.master);
    osc.start(startTime);
    osc.stop(startTime + 0.06);
    // клики обязаны попадать в scheduled: иначе cancelAll (пауза/выход) их не
    // снимает, и метроном доигрывает всю песню поверх следующей игры
    this.scheduled.push({ osc, gain });
    osc.onended = () => {
      gain.disconnect();
      this.scheduled = this.scheduled.filter((s) => s.osc !== osc);
    };
  }

  dispose(): void {
    this.cancelAll();
    this.master.disconnect();
  }

  /** Отменить всё запланированное (пауза/выход). */
  cancelAll(): void {
    const now = this.ctx.currentTime;
    for (const { osc, gain } of this.scheduled) {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0, now, 0.01);
        osc.stop(now + 0.05);
      } catch {
        // уже остановлен
      }
    }
    this.scheduled = [];
  }
}

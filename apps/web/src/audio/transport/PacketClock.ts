import type { Transport, TransportLoad } from './Transport';

export interface ClockPacket {
  engineFrame: number;
  songPosAtDacMs: number;
  /** Монотонное время хоста в том же домене, что и hostNowMs. */
  hostTimeMs: number;
  playing: boolean;
  epoch: number;
}

export type PacketSource = (receive: (packet: ClockPacket) => void) => () => void;
const ANCHOR_EMA = 0.05;

/** engineFrame — номер сэмпла на DAC, clockNow — секунды движка. */
export class PacketClock {
  private packet: ClockPacket | null = null;
  private offsetMs = 0;

  constructor(readonly sampleRate: number, private hostNowMs: () => number) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('PacketClock: неверная частота');
  }

  push(packet: ClockPacket): void {
    const previous = this.packet;
    // Поздние пакеты не должны возвращать часы в прошлую эпоху или менять порядок якорей.
    if (previous && (packet.epoch < previous.epoch ||
      (packet.epoch === previous.epoch && packet.engineFrame < previous.engineFrame))) return;
    const offset = packet.engineFrame / this.sampleRate * 1000 - packet.hostTimeMs;
    this.offsetMs = !previous || previous.epoch !== packet.epoch
      ? offset : this.offsetMs + ANCHOR_EMA * (offset - this.offsetMs);
    this.packet = { ...packet };
  }

  clockNow(): number { return (this.hostNowMs() + this.offsetMs) / 1000; }
  epoch(): number { return this.packet?.epoch ?? 0; }
  songMs(clockT = this.clockNow()): number {
    const packet = this.packet;
    if (!packet) return 0;
    return packet.songPosAtDacMs + (packet.playing
      ? (clockT - packet.engineFrame / this.sampleRate) * 1000 : 0);
  }

  stop(): void {
    if (this.packet) this.packet = { ...this.packet, songPosAtDacMs: this.songMs(), playing: false };
  }
}

/** Беззвучный адаптер. Источник должен маркировать пакеты эпохой текущего begin. */
export class PacketClockTransport implements Transport {
  readonly kind = 'native' as const;
  readonly clockDomain = 'engine' as const;
  private spec: TransportLoad = { durationMs: 0, layers: [], metronome: false, countIn: false };
  private unsubscribe: (() => void) | null = null;
  private playStart = 0;
  private generation = 0;
  private readonly clock: PacketClock;

  constructor(private source: PacketSource, private hostNowMs: () => number, sampleRate: number) {
    this.clock = new PacketClock(sampleRate, hostNowMs);
  }

  load(spec: TransportLoad): void {
    this.spec = { ...spec, layers: spec.layers.map(layer => ({ ...layer })) };
  }

  begin(fromMs: number, leadSec: number, _endMs: number): void {
    this.unsubscribe?.();
    this.generation = this.epoch() + 1;
    const now = this.clockNow();
    this.playStart = now + leadSec;
    // Локальный якорь обеспечивает точный begin до прихода первого пакета движка.
    this.clock.push({ engineFrame: now * this.clock.sampleRate, songPosAtDacMs: fromMs - leadSec * 1000,
      hostTimeMs: this.hostNowMs(), playing: true, epoch: this.generation });
    this.unsubscribe = this.source(packet => this.clock.push(packet));
  }

  halt(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.clock.stop();
    // Звуковых узлов нет; сохранённые слои доступны следующему begin.
  }

  reschedule(_fromMs: number, _endMs: number): void {}
  clockNow(): number { return this.clock.clockNow(); }
  songMs(): number { return this.clock.songMs(); }
  // Пакеты уже содержат позицию DAC, дополнительная выходная задержка не нужна.
  heardSongMs(): number { return this.songMs(); }
  countdownRemaining(): number { return Math.max(0, this.playStart - this.clockNow()); }
  epoch(): number { return this.clock.epoch(); }
  frameToSongMs(clockT: number, latencyMs: number): number {
    const now = this.clockNow();
    return this.clock.songMs(now) + (clockT - now) * 1000 - latencyMs;
  }
  songToClock(songMs: number, latencyMs: number): number {
    const now = this.clockNow();
    return now + (songMs + latencyMs - this.clock.songMs(now)) / 1000;
  }
  setLayerGain(id: string, gain: number): void {
    for (const layer of this.spec.layers) if (layer.id === id) layer.gain = gain;
  }
  // Пошаговое исполнение появится на этапе 37.
  hold(): void {}
  release(): void {}
}

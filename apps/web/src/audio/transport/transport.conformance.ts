import { describe, expect, it } from 'vitest';
import type { Transport } from './Transport';

export interface TransportFixture {
  transport: Transport;
  advance(ms: number): void;
  /** Допуск в миллисекундах; advance доставляет пакеты, если они есть. */
  toleranceMs: number;
  settleMs: number;
  loadLayers(): void;
  assertLayersStopped(): void;
}

export function runTransportConformance(name: string, factory: () => TransportFixture): void {
  describe(name, () => {
    const near = (actual: number, expected: number, tolerance: number) =>
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);

    it('begin задаёт from − lead·1000; часы растут 1:1', () => {
      const { transport: t, advance, toleranceMs, settleMs } = factory();
      t.begin(2350, 0.8, 20000);
      near(t.songMs(), 1550, 1e-6);
      advance(settleMs);
      for (let i = 1; i <= 100; i++) {
        advance(17);
        near(t.songMs(), 1550 + settleMs + i * 17, toleranceMs);
      }
      t.halt();
    });

    it('countdown достигает нуля к концу разгона', () => {
      const { transport: t, advance, toleranceMs } = factory();
      t.begin(2350, 0.8, 20000);
      near(t.countdownRemaining(), 0.8, 1e-9);
      advance(400);
      near(t.countdownRemaining() * 1000, 400, toleranceMs);
      advance(400 + toleranceMs);
      expect(t.countdownRemaining()).toBe(0);
      t.halt();
    });

    it('frameToSongMs согласован с позицией и задержкой', () => {
      const { transport: t, advance, toleranceMs, settleMs } = factory();
      t.begin(2350, 0.8, 20000);
      advance(settleMs + 123);
      for (const latency of [0, 37, 123]) {
        near(t.frameToSongMs(t.clockNow(), latency), t.songMs() - latency, toleranceMs);
        near(t.frameToSongMs(t.clockNow() - 0.25, latency), t.songMs() - 250 - latency, toleranceMs);
      }
      t.halt();
    });

    it('songToClock обращает frameToSongMs', () => {
      const { transport: t, advance, toleranceMs, settleMs } = factory();
      t.begin(2350, 0.8, 20000);
      advance(settleMs);
      for (const delta of [-1.7, 0, 0.123, 5]) {
        for (const latency of [0, 37, 123]) {
          const clock = t.clockNow() + delta;
          near(t.songToClock(t.frameToSongMs(clock, latency), latency) * 1000, clock * 1000, toleranceMs);
        }
      }
      t.halt();
    });

    it('epoch растёт на каждом begin', () => {
      const { transport: t, advance } = factory();
      for (let i = 0; i < 4; i++) {
        const previous = t.epoch();
        t.begin(i * 1000, 0.8, 20000);
        expect(t.epoch()).toBeGreaterThan(previous);
        advance(100);
        t.halt();
      }
    });

    it('halt останавливает слои', () => {
      const { transport: t, loadLayers, assertLayersStopped, advance } = factory();
      loadLayers();
      t.begin(0, 0.8, 20000);
      advance(1000);
      t.halt();
      assertLayersStopped();
      advance(100);
      t.halt();
      assertLayersStopped();
    });

    it('heardSongMs не опережает songMs', () => {
      const { transport: t, advance } = factory();
      t.begin(2350, 0.8, 20000);
      for (let i = 0; i < 200; i++) {
        expect(t.heardSongMs()).toBeLessThanOrEqual(t.songMs());
        advance(17);
      }
      t.halt();
    });
  });
}

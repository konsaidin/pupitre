import { describe, expect, it } from 'vitest';
import { RecordingCtx } from '../../test/recordingCtx';
import { PacketClock, PacketClockTransport, type ClockPacket } from './PacketClock';
import { WebAudioTransport } from './WebAudioTransport';
import { runTransportConformance } from './transport.conformance';

const spec = () => ({ durationMs: 20000, layers: [], metronome: false, countIn: false });

runTransportConformance('WebAudioTransport: конформанс', () => {
  class BufferCtx extends RecordingCtx {
    override createBufferSource() {
      const source = super.createBufferSource();
      source.playbackRate = { value: 1 };
      return source;
    }
  }
  const ctx = Object.assign(new BufferCtx(), { outputLatency: 0.04 });
  ctx.currentTime = 10;
  const transport = new WebAudioTransport(ctx as unknown as AudioContext);
  transport.load(spec());
  return {
    transport, toleranceMs: 1e-6, settleMs: 0,
    advance: (ms: number) => { ctx.currentTime += ms / 1000; },
    loadLayers: () => transport.load({ ...spec(), layers: ['a', 'b'].map(id => ({
      id, source: {} as AudioBuffer, gain: 0.5,
    })) }),
    assertLayersStopped: () => {
      const starts = ctx.events.filter(e => e.node === 'buffer' && e.action === 'start');
      expect(starts).toHaveLength(2);
      for (const start of starts) {
        expect(ctx.events.some(e => e.id === start.id && e.action === 'stop')).toBe(true);
      }
    },
  };
});

// Сид фиксирован; тест не зависит от реальных таймеров, браузера или сети.
function jitterGenerator() {
  let seed = 0x12345678;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 0x100000000 * 2 - 1) * 3;
  };
}

runTransportConformance('PacketClockTransport: конформанс', () => {
  let host = 10000;
  let listener: ((packet: ClockPacket) => void) | null = null;
  let nextPacket = host + 10;
  let origin = 0;
  let packetEpoch = 0;
  const jitter = jitterGenerator();
  const transport = new PacketClockTransport(receive => {
    listener = receive;
    origin = host - transport.songMs();
    packetEpoch = transport.epoch();
    nextPacket = host + 10;
    return () => { listener = null; };
  }, () => host, 48000);
  transport.load(spec());
  return {
    transport, toleranceMs: 1, settleMs: 2000,
    advance: (ms: number) => {
      const target = host + ms;
      while (nextPacket <= target) {
        host = nextPacket;
        listener?.({ engineFrame: host * 48, songPosAtDacMs: host - origin,
          hostTimeMs: host + jitter(), playing: true, epoch: packetEpoch });
        nextPacket += 10;
      }
      host = target;
    },
    loadLayers: () => transport.load({ ...spec(), layers: ['a', 'b'].map(id => ({
      id, source: { kind: 'engine' as const, id }, gain: 0.5,
    })) }),
    // У беззвучного транспорта нет узлов; halt освобождает подписку на пакеты.
    assertLayersStopped: () => { expect(listener).toBeNull(); },
  };
});

describe('PacketClock', () => {
  it('интерполирует между пакетами и фиксирует позицию при halt', () => {
    let host = 10000;
    let listener: ((packet: ClockPacket) => void) | null = null;
    const transport = new PacketClockTransport(receive => {
      listener = receive;
      return () => { listener = null; };
    }, () => host, 48000);
    transport.begin(2000, 0.8, 20000);
    host += 125;
    expect(transport.songMs()).toBeCloseTo(1325, 8);
    const emit = listener as unknown as (packet: ClockPacket) => void;
    emit({ engineFrame: host * 48, songPosAtDacMs: 1325,
      hostTimeMs: host + 3, playing: true, epoch: transport.epoch() });
    const stopped = transport.songMs();
    transport.halt();
    host += 500;
    expect(transport.songMs()).toBe(stopped);
    expect(listener).toBeNull();
    transport.begin(5000, 0.8, 20000);
    expect(transport.songMs()).toBeCloseTo(4200, 8);
    transport.halt();
  });

  it('устанавливает часы после ошибочного первого якоря при джиттере ±3 мс', () => {
    let host = 1000;
    const clock = new PacketClock(48000, () => host);
    const jitter = jitterGenerator();
    clock.push({ engineFrame: host * 48, songPosAtDacMs: 0,
      hostTimeMs: host + 3, playing: true, epoch: 1 });
    for (let i = 1; i <= 400; i++) {
      host = 1000 + i * 10;
      clock.push({ engineFrame: host * 48, songPosAtDacMs: i * 10,
        hostTimeMs: host + jitter(), playing: true, epoch: 1 });
      if (i >= 200) expect(Math.abs(clock.songMs() - i * 10)).toBeLessThanOrEqual(1);
    }
  });

  it('сглаживает якорь с EMA и сбрасывает его при новой эпохе', () => {
    let host = 1000;
    const clock = new PacketClock(48000, () => host);
    clock.push({ engineFrame: 48000, songPosAtDacMs: 100, hostTimeMs: 1000, playing: true, epoch: 1 });
    host = 1010;
    clock.push({ engineFrame: 48480, songPosAtDacMs: 110, hostTimeMs: 1013, playing: true, epoch: 1 });
    expect(clock.songMs()).toBeCloseTo(109.85, 8);
    clock.push({ engineFrame: 0, songPosAtDacMs: -800, hostTimeMs: 1010, playing: true, epoch: 2 });
    expect(clock.songMs()).toBe(-800);
    host += 100;
    expect(clock.songMs()).toBeCloseTo(-700, 8);
    clock.push({ engineFrame: 96000, songPosAtDacMs: 5000, hostTimeMs: host, playing: true, epoch: 1 });
    expect(clock.songMs()).toBeCloseTo(-700, 8);
  });

  it('не интерполирует остановленную песню и отбрасывает переставленные пакеты', () => {
    let host = 1000;
    const clock = new PacketClock(44100, () => host);
    clock.push({ engineFrame: 44100, songPosAtDacMs: 500, hostTimeMs: host, playing: false, epoch: 1 });
    host += 500;
    expect(clock.songMs()).toBe(500);
    clock.push({ engineFrame: 44000, songPosAtDacMs: 999, hostTimeMs: host, playing: true, epoch: 1 });
    expect(clock.songMs()).toBe(500);
    expect(clock.clockNow()).toBe(1.5);
  });
});

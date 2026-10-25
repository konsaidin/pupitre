import { describe, expect, it } from 'vitest';
import { RecordingCtx } from '../../test/recordingCtx';
import { WebAudioTransport } from './WebAudioTransport';
import { GameEngine } from '../../game/engine';
import { FakeInput } from '../../test/fakeAudio';
import type { TransportLoad } from './Transport';

function setup(ctx = new RecordingCtx(), spec: Partial<TransportLoad> = {}) {
  const transport = new WebAudioTransport(ctx as unknown as AudioContext);
  transport.load({ durationMs: 4000, layers: [], metronome: false, countIn: false, ...spec });
  return { ctx, transport };
}
const starts = (ctx: RecordingCtx) => ctx.events.filter(e => e.action === 'start');

describe('WebAudioTransport', () => {
  it('движок сохраняет загруженный внешний транспорт и уведомляет о витке лупа', async () => {
    const { ctx, transport } = setup(undefined, {
      metronome: true, beats: [{ ms: 0, downbeat: true }, { ms: 450, downbeat: false }],
    });
    let wraps = 0;
    const engine = new GameEngine({
      ctx: ctx as unknown as AudioContext, input: new FakeInput(), transport,
      map: { id: 'transport', title: 'transport', durationMs: 4000, notes: [], backing: { kind: 'buffer' } },
      difficulty: 'medium', latencyMs: 0, guideNotes: false, metronome: false,
      onFinish: () => {}, onLoopWrap: () => { wraps++; },
    });
    try {
      await engine.start();
      expect(starts(ctx).map(e => e.when)).toEqual([3, 3.45]);
      engine.setLoop(0, 1000);
      ctx.currentTime = 4;
      engine.tick();
      expect(wraps).toBe(1);
      expect(transport.epoch()).toBe(2);
      expect(engine.phase).toBe('countdown');
    } finally { engine.quit(); }
  });

  it('слои стартуют одновременно со смещением, масштабом и гейном; halt останавливает оба', () => {
    class BufferCtx extends RecordingCtx {
      gains: ReturnType<RecordingCtx['createGain']>[] = [];
      sources: ReturnType<RecordingCtx['createBufferSource']>[] = [];
      override createGain() {
        const node = super.createGain();
        this.gains.push(node);
        return node;
      }
      override createBufferSource() {
        const node = super.createBufferSource();
        node.playbackRate = { value: 1 };
        this.sources.push(node);
        return node;
      }
    }
    const ctx = new BufferCtx();
    const { transport } = setup(ctx, { layers: [
      { id: 'a', source: {} as AudioBuffer, gain: 0.5, offsetMs: 100 },
      { id: 'b', source: {} as AudioBuffer, gain: 0.8, offsetMs: 300, timeScale: 2 },
    ] });
    transport.begin(500, 0.8, 2000);
    expect(starts(ctx).map(e => [e.when, e.offset, e.duration])).toEqual([[0.8, 0.6, 1.5], [0.8, 1.3, 3]]);
    expect(ctx.gains.slice(1).map(n => (n.gain as { value: number }).value)).toEqual([0.5, 0.8]);
    transport.setLayerGain('b', 0.2);
    expect((ctx.gains[2].gain as { value: number }).value).toBe(0.2);
    expect(ctx.sources.map(n => (n.playbackRate as { value: number }).value)).toEqual([1, 2]);
    transport.halt();
    expect(ctx.events.filter(e => e.action === 'stop').map(e => e.id)).toEqual([0, 1]);
    transport.begin(0, 1, 2000);
    expect((ctx.gains[4].gain as { value: number }).value).toBe(0.2);
    expect(transport.epoch()).toBe(2);
  });

  it('метроном использует неравномерную сетку beats вместо bpm', () => {
    const { ctx, transport } = setup(undefined, { metronome: true, bpm: 120, beats: [
      { ms: 0, downbeat: true }, { ms: 400, downbeat: false },
      { ms: 950, downbeat: true }, { ms: 1600, downbeat: false },
    ] });
    transport.begin(400, 1, 1600);
    expect(starts(ctx).map(e => e.frequency)).toEqual([1100, 1600]);
    expect(starts(ctx)[0].when).toBeCloseTo(1);
    expect(starts(ctx)[1].when).toBeCloseTo(1.55);
  });

  it('счёт-ин продолжает сетку назад', () => {
    const { ctx, transport } = setup(undefined, { countIn: true, bpm: 120, beats: [
      { ms: 0, downbeat: true }, { ms: 400, downbeat: false },
    ] });
    transport.begin(0, 1, 2000);
    expect(starts(ctx).map(e => e.when)).toEqual([0.19999999999999996, 0.6]);
  });

  it('счёт-ин без сетки использует bpm', () => {
    const { ctx, transport } = setup(undefined, { countIn: true, bpm: 120 });
    transport.begin(0, 1, 2000);
    expect(starts(ctx).map(e => e.when)).toEqual([0, 0.5]);
  });

  it('heardSongMs использует timestamp без повторного вычитания задержки', () => {
    const ctx = Object.assign(new RecordingCtx(), {
      getOutputTimestamp: () => ({ contextTime: 4.9, performanceTime: 100 }), outputLatency: 0.3,
    });
    const { transport } = setup(ctx);
    transport.begin(500, 1, 2000);
    ctx.currentTime = 5;
    expect(transport.heardSongMs()).toBeCloseTo(4400);
  });

  it('heardSongMs без timestamp вычитает outputLatency', () => {
    const ctx = Object.assign(new RecordingCtx(), { outputLatency: 0.1 });
    const { transport } = setup(ctx);
    transport.begin(500, 1, 2000);
    ctx.currentTime = 5;
    expect(transport.heardSongMs()).toBe(4400);
  });

  it('без возможностей вывода возвращает songMs; преобразование кадра обратимо', () => {
    const { ctx, transport } = setup();
    transport.begin(500, 1, 2000);
    expect(transport.countdownRemaining()).toBe(1);
    ctx.currentTime = 5;
    expect(transport.heardSongMs()).toBe(transport.songMs());
    expect(transport.countdownRemaining()).toBe(0);
    expect(transport.songToClock(transport.frameToSongMs(5, 123), 123)).toBe(5);
  });
});

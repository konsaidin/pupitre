// Эталоны v2 записаны на pre3a (02c), до выделения Transport.
// Изменять эталоны в текущем дереве нельзя: расхождение — регрессия.
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AnalysisFrame } from '../audio/AudioInput';
import type { SongMap } from '../lib/songMap';
import { FakeInput, frame, unvoiced } from '../test/fakeAudio';
import { RecordingGraphCtx } from '../test/recordingGraphCtx';
import { GameEngine, type EngineOptions } from './engine';
import type { GameSummary } from './scoring';

const engines: GameEngine[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const engine of engines.splice(0)) engine.quit();
  vi.useRealTimers();
});
const replacer = (_key: string, value: unknown) =>
  typeof value === 'number' && Number.isNaN(value) ? 'NaN' : value;
const copy = (value: unknown) => JSON.parse(JSON.stringify(value, replacer));

function map(over: Partial<SongMap> = {}): SongMap {
  return {
    id: 'voice-golden2', title: 'Эталон v2', durationMs: 3000, bpm: 120,
    notes: [
      { startMs: 200, durMs: 600, midi: 60 },
      { startMs: 1000, durMs: 800, midi: 64 },
      { startMs: 2000, durMs: 800, midi: 67 },
    ],
    backing: { kind: 'synth', guideNotes: false }, ...over,
  };
}

async function session(song = map(), options: Partial<EngineOptions> = {}) {
  const ctx = new RecordingGraphCtx();
  const input = new FakeInput();
  const finished: GameSummary[] = [];
  const engine = new GameEngine({
    ctx: ctx as unknown as AudioContext, input, map: song, difficulty: 'medium',
    latencyMs: 0, guideNotes: false, metronome: false, ...options,
    onFinish: summary => finished.push(summary),
  });
  engines.push(engine);
  const steps: unknown[] = [];
  const observe = (action: string, args: unknown[] = []) => steps.push(copy({
    action, args, ctxTime: ctx.currentTime,
    songMs: engine.songMs(), countdownRemaining: engine.countdownRemaining(),
    noteHitRatio: song.notes.map((_, i) => engine.noteHitRatio(i)),
    phase: engine.phase, score: engine.score, combo: engine.combo, maxCombo: engine.maxCombo,
    loop: [engine.loopA, engine.loopB], lastFrame: engine.lastFrame,
    lastAnalysis: engine.lastAnalysis, results: engine.results,
    graphLength: ctx.events.length,
  }));
  const command = (name: string, fn: () => void, ...args: unknown[]) => {
    fn(); observe(name, args);
  };
  const tick = (time: number) => {
    ctx.currentTime = time;
    command('tick', () => engine.tick());
  };
  const push = (time: number, midi: number | null, over: Partial<AnalysisFrame> = {}) => {
    ctx.currentTime = time;
    const f = midi === null ? unvoiced(time) : frame(time, midi, over);
    input.push(f);
    observe('frame', [f]);
  };
  const snapshot = async (name: string) => {
    expect(steps.length).toBeGreaterThan(1);
    await expect(JSON.stringify({
      map: song,
      options: { latencyMs: options.latencyMs ?? 0, difficulty: options.difficulty ?? 'medium',
        guideNotes: options.guideNotes ?? false, metronome: options.metronome ?? false },
      steps, graph: ctx.events, trail: engine.trail, judgements: engine.judgements,
      techStats: engine.techStats, onFinish: finished,
    }, replacer, 2) + '\n').toMatchFileSnapshot(
      fileURLToPath(new URL(`./__golden2__/${name}.json`, import.meta.url)));
  };
  observe('construct');
  await engine.start();
  observe('start');
  push(0.25, 59.5);
  return { ctx, engine, push, tick, command, snapshot };
}

for (const latencyMs of [120, 0]) {
  it(`latency-${latencyMs}`, async () => {
    const s = await session(map(), { latencyMs });
    s.tick(2.99);
    s.tick(3);
    // Одинаковые входные кадры: края без компенсации и края со сдвигом 120 мс.
    const times = new Set<number>();
    for (const edge of [200, 800, 1000, 1800, 2000, 2800]) {
      for (const shift of [0, 120]) {
        for (const delta of [-60, -10, 10, 60]) times.add(3000 + edge + shift + delta);
      }
    }
    for (const ms of [...times].sort((a, b) => a - b)) {
      s.push(ms / 1000, ms < 3900 ? 60 : ms < 4900 ? 64 : 67);
      s.tick(ms / 1000);
    }
    s.push(6.15, null);
    s.tick(6.4);
    await s.snapshot(`latency-${latencyMs}`);
  });
}

it('frame-gaps', async () => {
  const s = await session();
  for (const ms of [3200, 3220, 3260, 3301, 3501, 3521, 3740, 3790]) {
    s.push(ms / 1000, 60, {
      vibrato: { active: true, rateHz: 5, depthCents: 40, regularity: 0.9 },
      distortion: { active: true, score: 0.7 },
    });
  }
  // Разрыв с неозвученным кадром и последующим возобновлением.
  s.push(4, 64);
  s.push(4.02, null);
  s.push(4.22, 64);
  s.push(4.24, 64);
  s.tick(6.4);
  expect(s.engine.noteHitRatio(0)).toBeLessThan(0.5);
  await s.snapshot('frame-gaps');
});

it('url-backing-transport', async () => {
  const backingBuffer = { duration: 3, sampleRate: 48000, length: 144000, numberOfChannels: 1 } as AudioBuffer;
  const s = await session(map({ backing: { kind: 'url', url: '/golden2.wav' } }), { backingBuffer });
  s.push(3.2, 60);
  s.push(3.4, 60);
  s.command('pause', () => s.engine.pause());
  s.tick(4);
  s.push(4.1, 72);
  s.command('resume', () => s.engine.resume());
  s.tick(7.1);
  s.push(7.12, 60);
  s.command('seekTo', () => s.engine.seekTo(2000), 2000);
  s.tick(7.92);
  s.push(7.94, 67);
  s.command('seekTo', () => s.engine.seekTo(1000), 1000);
  s.command('setLoop', () => s.engine.setLoop(1000, 1900), 1000, 1900);
  s.tick(8.74);
  s.push(8.76, 64);
  s.push(9.54, 64);
  s.push(9.66, 67); // Пересечение B голосовым кадром: новое поколение.
  expect(s.engine.phase).toBe('countdown');
  s.tick(10.46);
  s.push(10.48, 64);
  s.command('setLoop', () => s.engine.setLoop(null, null), null, null);
  s.tick(12.9);
  await s.snapshot('url-backing-transport');
});

for (const difficulty of ['beginner', 'pro'] as const) {
  it(`difficulty-${difficulty}`, async () => {
    const s = await session(map(), { difficulty });
    for (let i = 0; i < 30; i++) s.push((3200 + i * 20) / 1000, 60.6);
    for (let i = 0; i < 40; i++) s.push((4000 + i * 20) / 1000, 76);
    for (let i = 0; i < 40; i++) s.push((5000 + i * 20) / 1000, 67.2);
    s.tick(6.4);
    expect(s.engine.results.map(r => r?.judgement)).toEqual(
      difficulty === 'beginner' ? ['perfect', 'perfect', 'perfect'] : ['miss', 'miss', 'perfect']);
    await s.snapshot(`difficulty-${difficulty}`);
  });
}

it('guide-metronome-graph', async () => {
  const s = await session(map(), { guideNotes: true, metronome: true });
  s.push(3.2, 60);
  s.push(3.4, 60);
  s.command('pause', () => s.engine.pause());
  s.tick(4);
  s.command('deliverEnded', () => s.ctx.deliverEnded());
  s.command('resume', () => s.engine.resume());
  s.tick(7);
  s.push(7.02, 60);
  s.command('setLoop', () => s.engine.setLoop(200, 1900), 200, 1900);
  s.push(8.52, 64);
  expect(s.engine.phase).toBe('countdown');
  s.command('setLoop', () => s.engine.setLoop(null, null), null, null);
  s.tick(12.5);
  s.tick(12.6);
  s.command('deliverEnded', () => s.ctx.deliverEnded());
  expect(s.ctx.events.some(e => e.action === 'disconnect')).toBe(true);
  await s.snapshot('guide-metronome-graph');
});

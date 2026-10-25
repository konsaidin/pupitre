// Сессии на ручных аудиочасах: фиксируем судейство, HUD и расписание звука.
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AnalysisFrame } from '../audio/AudioInput';
import type { SongMap } from '../lib/songMap';
import { FakeInput, frame, unvoiced } from '../test/fakeAudio';
import { RecordingCtx } from '../test/recordingCtx';
import { GameEngine, type EngineOptions, type GamePhase } from './engine';
import { summarize, type GameSummary, type NoteResult } from './scoring';

const engines: GameEngine[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const engine of engines.splice(0)) engine.quit();
  vi.useRealTimers();
});

function map(over: Partial<SongMap> = {}): SongMap {
  return {
    id: 'voice-golden', title: 'Вокальный эталон', durationMs: 3000, bpm: 120,
    notes: [
      { startMs: 0, durMs: 800, midi: 60 },
      { startMs: 1000, durMs: 800, midi: 64 },
      { startMs: 2000, durMs: 800, midi: 67 },
    ],
    backing: { kind: 'synth', guideNotes: false }, ...over,
  };
}

function replacer(_key: string, value: unknown) {
  return typeof value === 'number' && Number.isNaN(value) ? 'NaN' : value;
}

function fnv1a(value: string): string {
  let hash = 0x811C9DC5;
  for (const byte of new TextEncoder().encode(value)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

async function session(song = map(), options: Partial<EngineOptions> = {}) {
  const ctx = new RecordingCtx();
  const input = new FakeInput();
  const finished: GameSummary[] = [];
  const engine = new GameEngine({
    ctx: ctx as unknown as AudioContext, input, map: song, difficulty: 'medium',
    latencyMs: 0, guideNotes: false, metronome: false, ...options,
    onFinish: (summary) => finished.push(summary),
  });
  engines.push(engine);
  const phases: GamePhase[] = [engine.phase];
  const analysis: { lastAnalysis: GameEngine['lastAnalysis']; lastFrame: GameEngine['lastFrame'] }[] = [];
  const observe = () => {
    if (phases.at(-1) !== engine.phase) phases.push(engine.phase);
  };
  const action = (fn: () => void) => { fn(); observe(); };
  const tick = (time: number) => {
    ctx.currentTime = time;
    action(() => engine.tick());
  };
  const push = (time: number, midi: number | null = 60, over: Partial<AnalysisFrame> = {}) => {
    ctx.currentTime = time;
    input.push(midi === null ? unvoiced(time) : frame(time, midi, over));
    observe();
    // Сохраняем пару после КАЖДОГО кадра, даже если движок его не оценил.
    analysis.push({ lastAnalysis: engine.lastAnalysis, lastFrame: engine.lastFrame });
  };
  const sing = (from: number, to: number, midi: number | null, over: Partial<AnalysisFrame> = {}) => {
    const count = Math.round((to - from) * 50);
    for (let i = 0; i <= count; i++) push(from + i / 50, midi, over);
  };
  const snapshot = async (name: string) => {
    expect(analysis.length).toBeGreaterThan(0);
    expect(engine.trail.length).toBeGreaterThan(0);
    expect(engine.judgements.length).toBeGreaterThan(0);
    const data = {
      results: engine.results, judgements: engine.judgements,
      score: engine.score, combo: engine.combo, maxCombo: engine.maxCombo, phase: phases,
      trailLength: engine.trail.length, trailHash: fnv1a(JSON.stringify(engine.trail, replacer)),
      techStats: engine.techStats, audio: ctx.events,
      summarize: summarize(engine.results.filter((r): r is NoteResult => r !== null), engine.score, engine.maxCombo, engine.techStats),
      onFinish: finished, frames: analysis,
    };
    await expect(JSON.stringify(data, replacer, 2) + '\n').toMatchFileSnapshot(
      fileURLToPath(new URL(`./__golden__/${name}.json`, import.meta.url)));
  };
  await engine.start();
  observe();
  push(0.25, 59.5); // Кадр отсчёта: анализ уже есть, точки ещё нет.
  return { ctx, engine, push, sing, tick, action, snapshot, finished };
}

it('hit-and-miss', async () => {
  const s = await session();
  s.sing(3, 3.8, 60.25);
  s.sing(4, 4.8, 68);
  s.sing(5, 5.8, null);
  s.push(6.1, 72); // За концом карты lastAnalysis обновляется, lastFrame остаётся прежним.
  s.tick(6.4);
  expect(s.engine.results.map((r) => r?.judgement)).toEqual(['perfect', 'miss', 'miss']);
  await s.snapshot('hit-and-miss');
});

it('pause-resume', async () => {
  const s = await session();
  s.sing(3, 3.4, 60);
  s.action(() => s.engine.pause());
  s.push(8, 71);
  s.action(() => s.engine.resume());
  s.push(9, 62);
  s.push(10.9, null);
  s.sing(11, 11.4, 60);
  s.sing(11.6, 12.4, 64);
  s.tick(13.9);
  await s.snapshot('pause-resume');
});

it('seek', async () => {
  const s = await session();
  s.action(() => s.engine.seekTo(2000)); // Вперёд во время первого отсчёта.
  s.push(0.5, 67);
  s.action(() => s.engine.seekTo(1000)); // Назад, всё ещё во время отсчёта.
  s.push(1, 64);
  s.sing(1.3, 2.1, 64);
  s.tick(2.2);
  s.action(() => s.engine.seekTo(0));
  s.push(2.5, 60);
  s.sing(3, 3.8, 60);
  s.tick(6.4);
  await s.snapshot('seek');
});

it('ab-loop', async () => {
  const s = await session();
  s.action(() => s.engine.setLoop(0, 1900));
  s.sing(3, 3.8, 60);
  s.sing(4, 4.8, 64);
  s.push(4.92, 67); // Сам кадр вызывает виток и смену поколения.
  expect(s.engine.phase).toBe('countdown');
  s.push(5.2, 61);
  s.sing(5.72, 6.52, 60);
  s.sing(6.72, 7.52, 64);
  s.action(() => s.engine.setLoop(null, null));
  s.tick(9.1);
  await s.snapshot('ab-loop');
});

it('line-target', async () => {
  const s = await session(map({
    durationMs: 1200, notes: [{ startMs: 0, durMs: 1000, midi: 48 }],
    pitchline: { hopMs: 200, midi: [60, 61, 62, null, 64, 65] },
  }), { lineTarget: true });
  for (let i = 0; i < 50; i++) s.push(3 + i / 50, 60 + i / 10, { midiRaw: 60.2 + i / 10 });
  s.push(4.3, 70);
  s.tick(4.6);
  await s.snapshot('line-target');
});

it('vibrato-tech', async () => {
  const s = await session(map({ durationMs: 1600, notes: [
    { startMs: 0, durMs: 1400, midi: 60, tech: 'vibrato', techWarmupMs: 300 },
  ] }));
  s.sing(3, 3.2, 60, { vibrato: { active: true, rateHz: 5.5, depthCents: 50, regularity: 0.9 } });
  s.sing(3.22, 3.5, 60);
  s.sing(3.52, 4.38, 60, {
    midiRaw: 60.4, vibrato: { active: true, rateHz: 5.5, depthCents: 50, regularity: 0.9 },
    distortion: { active: true, score: 0.7 },
  });
  s.tick(4.95);
  expect(s.engine.techStats.vibratoMs).toBeGreaterThan(0);
  await s.snapshot('vibrato-tech');
});

it('finish-summary', async () => {
  const s = await session();
  s.sing(3, 3.8, 60);
  s.sing(4, 4.8, 64);
  s.sing(5, 5.8, 67);
  s.push(6.1, 70);
  s.push(6.31, 71); // Этот кадр сначала завершает игру.
  s.push(7, 72); // После отписки состояние больше не меняется.
  s.tick(8);
  expect(s.finished).toHaveLength(1);
  expect(s.finished[0].perfect).toBe(3);
  await s.snapshot('finish-summary');
});

it('url-backing', async () => {
  // Буфер передан готовым: загрузки и декодирования в этом тесте нет.
  const backingBuffer = { duration: 3, sampleRate: 48000, length: 144000, numberOfChannels: 1 } as AudioBuffer;
  const s = await session(map({ backing: { kind: 'url', url: '/golden-backing.wav' } }), { backingBuffer });
  s.sing(3, 3.8, 60);
  s.tick(3.9);
  s.action(() => s.engine.seekTo(1000));
  s.push(4.2, 64);
  s.action(() => s.engine.setLoop(1000, 1900));
  s.sing(4.7, 5.5, 64);
  s.push(5.61, 67);
  expect(s.engine.phase).toBe('countdown');
  s.push(6, 64);
  s.sing(6.41, 7.21, 64);
  s.action(() => s.engine.setLoop(null, null));
  s.tick(8.8);
  expect(s.ctx.events.some((event) => event.node === 'buffer' && event.offset === 1)).toBe(true);
  await s.snapshot('url-backing');
});

it('guide-metronome', async () => {
  const s = await session(map(), { guideNotes: true, metronome: true });
  s.sing(3, 3.4, 60);
  s.action(() => s.engine.pause());
  s.ctx.currentTime = 4;
  s.action(() => s.engine.resume());
  s.push(5, 60);
  s.sing(7, 7.4, 60);
  s.sing(7.6, 8.4, 64);
  s.sing(8.6, 9.4, 67);
  s.tick(10);
  expect(s.ctx.events.some((event) => event.frequency === 1600)).toBe(true);
  expect(s.ctx.events.some((event) => event.frequency === 1100)).toBe(true);
  await s.snapshot('guide-metronome');
});

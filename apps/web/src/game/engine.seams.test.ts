// Контракт сменных судей и границы времени движка.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameEngine, type EngineOptions } from './engine';
import type { JudgeHost, NoteJudge } from './judge';
import { VocalJudge } from './judges/vocalJudge';
import { noneJudge } from './judges/noneJudge';
import { summarize } from './scoring';
import type { AnalysisFrame } from '../audio/AudioInput';
import type { SongMap } from '../lib/songMap';
import { FakeCtx, FakeInput, frame } from '../test/fakeAudio';

const map: SongMap = {
  id: 'seams', title: 'Швы', durationMs: 4000,
  notes: [{ startMs: 0, durMs: 1000, midi: 60 }, { startMs: 1000, durMs: 950, midi: 62 }],
  backing: { kind: 'synth', guideNotes: false },
};
const vocal = (host: JudgeHost<SongMap>) => new VocalJudge(host);
function stubJudge(host: JudgeHost<SongMap>): NoteJudge<SongMap, AnalysisFrame> {
  return {
    map: host.map, finalizeOrder: 'sequential', onBegin() {},
    reset: (i, ms) => host.map.notes[i].startMs + host.map.notes[i].durMs <= ms ? 'skipped' : 'armed',
    onFrame() {}, frameTime: f => f.t, progress: () => 0,
    closeAtMs: i => host.map.notes[i].startMs + host.map.notes[i].durMs + 50,
    finalize: (_i, forced) => ({ judgement: 'miss', hitRatio: 0,
      ...(forced ? { kind: 'missed', detail: 'late-evidence' } : {}) }),
    summarize,
  };
}
let engines: GameEngine[];
beforeEach(() => { vi.useFakeTimers(); engines = []; });
afterEach(() => { engines.forEach(e => e.quit()); vi.useRealTimers(); });
function setup(extra: Partial<EngineOptions> = {}) {
  const ctx = new FakeCtx();
  const input = new FakeInput();
  const onFinish = vi.fn();
  const engine = new GameEngine({ ctx: ctx as unknown as AudioContext, input, map,
    difficulty: 'medium', latencyMs: 0, guideNotes: false, metronome: false, onFinish, ...extra });
  engines.push(engine);
  return { ctx, input, engine, onFinish };
}

describe.each([vocal, stubJudge])('%s: жизненный цикл', judge => {
  it('пауза замораживает оценку, резюм даёт новый разгон', async () => {
    const { ctx, input, engine } = setup({ judge });
    await engine.start();
    ctx.currentTime = 3.5;
    input.push(frame(3.5, 60));
    engine.pause();
    const ratio = engine.noteHitRatio(0);
    ctx.currentTime = 15;
    input.push(frame(15, 60));
    engine.tick();
    expect(engine.songMs()).toBe(500);
    expect(engine.noteHitRatio(0)).toBe(ratio);
    engine.resume();
    input.push(frame(15, 60));
    expect(engine.countdownRemaining()).toBe(3);
    expect(engine.noteHitRatio(0)).toBe(ratio);
  });

  it('перемотка сохраняет закрытое позади и переигрывает впереди, в том числе на паузе', async () => {
    const { ctx, engine } = setup({ judge });
    await engine.start();
    ctx.currentTime = 4.1; engine.tick();
    const first = engine.results[0];
    expect(first).not.toBeNull();
    engine.seekTo(1500);
    expect(engine.results[0]).toBe(first);
    expect(engine.results[1]).toBeNull();
    engine.pause(); engine.seekTo(0);
    expect(engine.phase).toBe('paused');
    expect(engine.results).toEqual([null, null]);
    expect(engine.score).toBe(0);
    engine.resume();
    ctx.currentTime += 7.4; engine.tick();
    expect(engine.results.every(Boolean)).toBe(true);
  });

  it('пропущенное перемоткой исключается из итога; финиш однократный', async () => {
    const { ctx, engine, onFinish } = setup({ judge });
    await engine.start();
    engine.seekTo(1500);
    ctx.currentTime += 4; engine.tick(); engine.tick();
    expect(engine.results[0]).toBeNull();
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish.mock.calls[0][0].results).toHaveLength(1);
    expect(engine.phase).toBe('finished');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])('хвост лупа при latency=120, contentEndMs=%s', async forced => {
    const snapshots: { results: unknown[]; forced: number }[] = [];
    const { ctx, input, engine } = setup({ judge, latencyMs: 120,
      onLoopWrap: snapshot => snapshots.push(snapshot) });
    await engine.start();
    engine.setLoop(0, 2010, forced ? { contentEndMs: 1950 } : undefined);
    for (let ms = 0; ms <= 2020; ms += 10) {
      ctx.currentTime = 3 + ms / 1000;
      input.push(frame(ctx.currentTime, ms - 120 < 1000 ? 60 : 62));
    }
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].results[0]).not.toBeNull();
    if (forced) expect(snapshots[0].results[1]).not.toBeNull();
    else expect(snapshots[0].results[1]).toBeNull();
    expect(snapshots[0].forced).toBe(forced ? 1 : 0);
    expect(engine.results).toEqual([null, null]);
    expect(engine.phase).toBe('countdown');
    expect(engine.countdownRemaining()).toBeCloseTo(0.8);
    // Снимок принадлежит завершённому кругу и переживает сброс.
    expect(snapshots[0].results[0]).not.toBeNull();
  });
});

it.each(['any', 'sequential'] as const)('%s: короткая нота под длинной и порядок closeAtMs', async order => {
  const nested = { ...map, notes: [
    { startMs: 0, durMs: 3000, midi: 60 },
    { startMs: 100, durMs: 500, midi: 62 },
    { startMs: 200, durMs: 100, midi: 64 },
  ] };
  const { ctx, engine } = setup({ map: nested, judge: host => ({ ...stubJudge(host), finalizeOrder: order }) });
  await engine.start(); ctx.currentTime = 3.35; engine.tick();
  expect(engine.results[2] !== null).toBe(order === 'any');
  ctx.currentTime = 3.651; engine.tick();
  expect(engine.results[1] !== null).toBe(order === 'any');
  ctx.currentTime = 6.051; engine.tick();
  expect(engine.judgements.map(j => j.noteIndex)).toEqual(order === 'any' ? [2, 1, 0] : [0, 1, 2]);
});

it('any сортирует одновременно созревшие события по времени закрытия', async () => {
  const { ctx, engine } = setup({ map: { ...map, notes: [
    { startMs: 0, durMs: 500, midi: 60 }, { startMs: 100, durMs: 100, midi: 62 },
  ] }, judge: host => ({ ...stubJudge(host), finalizeOrder: 'any' }) });
  await engine.start(); ctx.currentTime = 4; engine.tick();
  expect(engine.judgements.map(j => j.noteIndex)).toEqual([1, 0]);
});

it('onRawFrame видит отсчёт и хвост карты; onFrame — только окно', async () => {
  const raw = vi.fn(); const accepted = vi.fn();
  const { ctx, input, engine } = setup({ judge: host => ({ ...stubJudge(host), onRawFrame: raw, onFrame: accepted }) });
  await engine.start();
  for (const t of [1, 3.1, 7.1]) { ctx.currentTime = t; input.push(frame(t, 60)); }
  input.push(frame(NaN, 60));
  expect(raw).toHaveBeenCalledTimes(4);
  expect(accepted).toHaveBeenCalledTimes(1);
  expect(accepted.mock.calls[0][1]).toBeCloseTo(100);
});

it('onTick следует за финализацией и получает новую эпоху seek/setLoop/resume', async () => {
  const ticks = vi.fn((_songMs: number, _epoch: number) => {
    if (ticks.mock.calls.length === 1) expect(engine.results[0]).not.toBeNull();
  });
  const { ctx, engine } = setup({ judge: host => ({ ...stubJudge(host), onTick: ticks }) });
  await engine.start(); ctx.currentTime = 4.1; engine.tick();
  expect(engine.results[0]).not.toBeNull();
  engine.setLoop(0, 3500); engine.tick();
  engine.seekTo(500); ctx.currentTime += 0.81; engine.tick();
  engine.pause(); engine.resume(); ctx.currentTime += 3.01; engine.tick();
  const epochs = ticks.mock.calls.map(call => call[1]);
  expect(epochs).toHaveLength(4);
  expect(epochs.every((e, i) => i === 0 || e > epochs[i - 1])).toBe(true);
});

it('принудительный вердикт без свидетельств — missed/late-evidence до сброса', async () => {
  const { ctx, engine } = setup({ onLoopWrap: snapshot => {
    expect(snapshot.forced).toBe(2);
    expect(snapshot.results.every(Boolean)).toBe(true);
    expect(engine.judgements.every(j => j.kind === 'missed' && j.detail === 'late-evidence')).toBe(true);
  } });
  await engine.start(); engine.setLoop(0, 2010, { contentEndMs: 1950 });
  ctx.currentTime = 5.02; engine.tick();
  expect(engine.phase).toBe('countdown');
});

it('noneJudge завершает без кадров, оценки и очков', async () => {
  const { ctx, engine, onFinish } = setup({ judge: noneJudge });
  await engine.start(); ctx.currentTime = 7.4; engine.tick();
  expect(engine.results).toEqual([null, null]);
  expect(engine.judgements).toEqual([]);
  expect(onFinish).toHaveBeenCalledWith(summarize([], 0, 0));
});

it('иной тип кадра, собственные очки и дополнительные поля вердикта', async () => {
  let send: (f: { onsetT: number }) => void = () => {};
  const ctx = new FakeCtx(); const received = vi.fn();
  const engine = new GameEngine<SongMap, { onsetT: number }>({
    ctx: ctx as unknown as AudioContext, input: { onFrame: fn => { send = fn; return () => {}; } },
    map, difficulty: 'medium', latencyMs: 0, guideNotes: false, metronome: false, onFinish() {},
    judge: host => ({ ...stubJudge(host), frameTime: f => f.onsetT, onFrame: received, onRawFrame: undefined,
      finalize: () => ({ judgement: 'perfect', hitRatio: 1, points: 7, kind: 'early', offsetMs: -20, detail: 'атака' }) }),
  });
  try {
    await engine.start(); ctx.currentTime = 3.2; send({ onsetT: 3.1 });
    expect(received.mock.calls[0][1]).toBeCloseTo(100);
    ctx.currentTime = 4.1; engine.tick();
    expect(engine.score).toBe(7);
    expect(engine.judgements[0]).toMatchObject({ kind: 'early', offsetMs: -20, detail: 'атака' });
  } finally { engine.quit(); }
});


it('any закрывает на точной границе closeAtMs и использует общий расчёт очков', async () => {
  const { ctx, engine } = setup({ map: { ...map, notes: [{ startMs: 50, durMs: 150, midi: 60 }] },
    judge: host => ({ ...stubJudge(host), finalizeOrder: 'any',
      finalize: () => ({ judgement: 'perfect', hitRatio: 1 }) }) });
  await engine.start();
  ctx.currentTime = 3.249; engine.tick();
  expect(engine.results[0]).toBeNull();
  ctx.currentTime = 3.25; engine.tick();
  expect(engine.results[0]?.points).toBe(110);
  expect(engine.combo).toBe(1);
});

it('contentEndMs не захватывает событие, начинающееся на границе', async () => {
  const wrap = vi.fn();
  const { ctx, engine } = setup({ onLoopWrap: wrap });
  await engine.start();
  engine.setLoop(0, 1200, { contentEndMs: 1000 });
  ctx.currentTime = 4.25; engine.tick();
  expect(wrap).toHaveBeenCalledTimes(1);
  expect(wrap.mock.calls[0][0]).toMatchObject({ forced: 1, results: [expect.any(Object), null] });
});

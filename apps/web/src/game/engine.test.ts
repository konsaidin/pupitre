// Тесты движка на заглушках WebAudio: часы двигаются вручную, кадры подаются
// синтетически. Главные инварианты: точка голоса не телепортирует на ±12 при
// непрерывном звучании; октаво-независимый скоринг работает; A/B-луп мотает.

import { beforeEach, describe, expect, it } from 'vitest';
import { GameEngine } from './engine';
import { FakeCtx, FakeInput, frame, unvoiced } from '../test/fakeAudio';
import type { SongMap } from '../lib/songMap';

const COUNTDOWN = 3; // COUNTDOWN_SEC движка

const map: SongMap = {
  id: 'test',
  title: 'Test',
  durationMs: 3000,
  notes: [
    { startMs: 0, durMs: 1000, midi: 60 },
    { startMs: 1000, durMs: 1000, midi: 69 },
  ],
  backing: { kind: 'synth', guideNotes: false },
};

let ctx: FakeCtx;
let input: FakeInput;
let engine: GameEngine;

async function startAt(songSec: number) {
  await engine.start();
  ctx.currentTime = COUNTDOWN + songSec;
  engine.tick();
}

beforeEach(() => {
  ctx = new FakeCtx();
  input = new FakeInput();
  engine = new GameEngine({
    ctx: ctx as unknown as AudioContext,
    input,
    map,
    difficulty: 'medium',
    latencyMs: 0,
    guideNotes: false,
    metronome: false,
    onFinish: () => {},
  });
});

describe('отображение голоса', () => {
  it('плавное глиссандо на октаву вверх не телепортирует точку', async () => {
    await startAt(0);
    // онсет на цели (60), затем глайд до 72 за секунду — раньше на +7.5 от цели
    // отображение прыгало на −12
    for (let s = 0; s <= 1; s += 0.01) {
      ctx.currentTime = COUNTDOWN + s;
      input.push(frame(ctx.currentTime, 60 + 12 * s));
    }
    const trail = engine.trail;
    expect(trail.length).toBeGreaterThan(50);
    let maxJump = 0;
    for (let i = 1; i < trail.length; i++) {
      maxJump = Math.max(maxJump, Math.abs(trail[i].midi - trail[i - 1].midi));
    }
    expect(maxJump).toBeLessThan(0.5);
  });

  it('пение октавой ниже: точка привязывается к цели на онсете, попадание честное', async () => {
    await startAt(0.1);
    input.push(frame(ctx.currentTime, 48)); // цель 60, поём 48
    expect(engine.lastFrame?.midi).toBeCloseTo(60);
    expect(engine.trail.at(-1)?.inTolerance).toBe(true);
  });

  it('поправка держится сквозь границу нот при легато', async () => {
    await startAt(0.9);
    input.push(frame(ctx.currentTime, 60)); // онсет в ноте 60, fold 0
    ctx.currentTime += 0.1; // началась нота 69, поём всё ещё 60
    input.push(frame(ctx.currentTime, 60.1));
    // без онсета поправка не меняется: точка не дёрнулась на ±12
    expect(Math.abs(engine.lastFrame!.midi - 60.1)).toBeLessThan(1e-9);
  });

  it('после паузы в голосе онсет может перепривязать октаву', async () => {
    await startAt(1.1);
    input.push(frame(ctx.currentTime, 57)); // цель 69, поём октавой ниже → fold +12
    expect(engine.lastFrame?.midi).toBeCloseTo(69);
    ctx.currentTime += 0.1;
    input.push(unvoiced(ctx.currentTime)); // вдох
    ctx.currentTime += 0.1;
    input.push(frame(ctx.currentTime, 69)); // теперь поём в октаве цели
    expect(engine.lastFrame?.midi).toBeCloseTo(69); // fold сброшен к 0, не 81
  });
});

describe('A/B-луп', () => {
  it('при достижении B мотает на A с коротким разгоном', async () => {
    await startAt(0);
    engine.setLoop(500, 1500);
    ctx.currentTime = COUNTDOWN + 1.6; // songMs 1600 ≥ B
    engine.tick();
    expect(engine.phase).toBe('countdown');
    // после разгона (0.8 с) позиция — точка A
    ctx.currentTime += 0.8;
    engine.tick();
    expect(engine.phase).toBe('playing');
    expect(engine.songMs()).toBeCloseTo(500, -1);
  });

  it('интервал нормализуется, вырожденный игнорируется, null снимает', async () => {
    await startAt(0);
    engine.setLoop(1500, 500); // перепутанные границы
    expect(engine.loopA).toBe(500);
    expect(engine.loopB).toBe(1500);
    engine.setLoop(100, 150); // < 200 мс — не луп
    expect(engine.loopA).toBe(500);
    engine.setLoop(null, null);
    expect(engine.loopA).toBeNull();
  });

  it('без лупа песня доигрывает до конца и финиширует', async () => {
    let finished = false;
    engine = new GameEngine({
      ctx: ctx as unknown as AudioContext,
      input,
      map,
      difficulty: 'medium',
      latencyMs: 0,
      guideNotes: false,
      metronome: false,
      onFinish: () => {
        finished = true;
      },
    });
    await startAt(map.durationMs / 1000 + 0.4);
    expect(finished).toBe(true);
    expect(engine.phase).toBe('finished');
  });
});

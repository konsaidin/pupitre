// Тесты движка на заглушках WebAudio: часы двигаются вручную, кадры подаются
// синтетически. Главные инварианты: точка голоса не телепортирует на ±12 при
// непрерывном звучании; октаво-независимый скоринг работает; A/B-луп мотает.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  vi.useFakeTimers();
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

afterEach(() => {
  engine.quit();
  vi.useRealTimers();
});

describe('часы и подготовительный интервал', () => {
  it('резюм не оценивает голос до конца разгона и не начисляет время паузы', async () => {
    await startAt(0);
    for (let s = 0; s <= 0.5; s += 0.01) {
      ctx.currentTime = COUNTDOWN + s;
      input.push(frame(ctx.currentTime, 60));
    }
    ctx.currentTime = 3.5;
    engine.pause();
    const before = engine.noteHitRatio(0);
    ctx.currentTime += 10;
    engine.resume();
    expect(engine.countdownRemaining()).toBeCloseTo(3);
    for (let s = 0; s < 3; s += 0.01) {
      ctx.currentTime = 13.5 + s;
      input.push(frame(ctx.currentTime, 60));
    }
    expect(engine.phase).toBe('countdown');
    expect(engine.noteHitRatio(0)).toBe(before);
    ctx.currentTime = 16.5;
    input.push(frame(ctx.currentTime, 60));
    expect(engine.phase).toBe('playing');
    expect(engine.noteHitRatio(0)).toBe(before);
  });

  it('перемотка далеко в песню сохраняет разгон и не добавляет хвост голоса', async () => {
    engine = new GameEngine({ ctx: ctx as unknown as AudioContext, input,
      map: { ...map, durationMs: 10000, notes: [{ startMs: 4000, durMs: 5000, midi: 60 }] },
      difficulty: 'medium', latencyMs: 0, guideNotes: false, metronome: false, onFinish: () => {},
    });
    await startAt(0);
    engine.seekTo(5000);
    expect(engine.countdownRemaining()).toBeCloseTo(0.8);
    ctx.currentTime += 0.7;
    input.push(frame(ctx.currentTime, 60));
    expect(engine.phase).toBe('countdown');
    expect(engine.trail).toHaveLength(0);
    expect(engine.noteHitRatio(0)).toBe(0);
  });

  it('завершает игру без вызова tick из отрисовки', async () => {
    await engine.start();
    ctx.currentTime = COUNTDOWN + map.durationMs / 1000 + 0.4;
    vi.advanceTimersByTime(20);
    expect(engine.phase).toBe('finished');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('луп срабатывает по аудиокадру без Canvas', async () => {
    await engine.start();
    engine.setLoop(500, 1500);
    ctx.currentTime = COUNTDOWN + 1.6;
    input.push(unvoiced(ctx.currentTime));
    expect(engine.phase).toBe('countdown');
    expect(engine.countdownRemaining()).toBeCloseTo(0.8);
    expect(engine.trail).toHaveLength(0);
  });

  it('не финализирует ноту до прихода кадров с настроенной задержкой', async () => {
    engine = new GameEngine({ctx: ctx as unknown as AudioContext, input, map,
      difficulty: 'medium', latencyMs: 200, guideNotes: false, metronome: false, onFinish: () => {},
    });
    await engine.start();
    ctx.currentTime = 4.1;
    input.push(frame(ctx.currentTime, 60));
    expect(engine.results[0]).toBeNull();
    ctx.currentTime = 4.3;
    vi.advanceTimersByTime(20);
    expect(engine.results[0]).not.toBeNull();
  });
});

describe('отображение голоса — всегда сырое, без октавных поправок', () => {
  it('показанная высота равна спетой в каждом кадре (глиссандо с миганием гейта)', async () => {
    await startAt(0);
    for (let s = 0; s <= 1; s += 0.01) {
      ctx.currentTime = COUNTDOWN + s;
      const midi = 60 + 10 * s;
      if (Math.abs(s - 0.7) < 0.005) {
        input.push(unvoiced(ctx.currentTime)); // согласная/провал гейта
        continue;
      }
      input.push(frame(ctx.currentTime, midi));
      expect(engine.lastFrame!.midi).toBeCloseTo(midi);
    }
    // и след повторяет голос точь-в-точь — телепортов не существует
    const trail = engine.trail;
    expect(trail.length).toBeGreaterThan(50);
    for (let i = 1; i < trail.length; i++) {
      expect(Math.abs(trail[i].midi - trail[i - 1].midi)).toBeLessThan(0.5);
    }
  });

  it('пение октавой ниже цели: точка на спетой октаве, но попадание честное (medium)', async () => {
    await startAt(0.1);
    input.push(frame(ctx.currentTime, 48)); // цель 60, поём 48
    expect(engine.lastFrame?.midi).toBeCloseTo(48); // рисуем где поём
    expect(engine.trail.at(-1)?.inTolerance).toBe(true); // скоринг прощает октаву
  });

  it('после паузы в голосе точка всё так же сырая', async () => {
    await startAt(1.1);
    input.push(frame(ctx.currentTime, 57)); // цель 69, поём октавой ниже
    expect(engine.lastFrame?.midi).toBeCloseTo(57);
    ctx.currentTime += 0.1;
    input.push(unvoiced(ctx.currentTime)); // вдох
    ctx.currentTime += 0.1;
    input.push(frame(ctx.currentTime, 69));
    expect(engine.lastFrame?.midi).toBeCloseTo(69);
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

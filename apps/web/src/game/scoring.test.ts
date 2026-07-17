import { describe, expect, it } from 'vitest';
import { comboMultiplier, judge, matchPitch, notePoints, starsFor, summarize } from './scoring';
import type { MapNote } from '../lib/songMap';

describe('matchPitch', () => {
  it('октаво-независимые сложности сворачивают голос к ближайшей октаве цели', () => {
    expect(matchPitch(72, 60, 'medium').inTolerance).toBe(true);
    expect(matchPitch(48, 60, 'beginner').inTolerance).toBe(true);
    expect(Math.abs(matchPitch(72.3, 60, 'medium').cents - 30)).toBeLessThan(1e-9);
  });

  it('pro требует точную октаву', () => {
    expect(matchPitch(72, 60, 'pro').inTolerance).toBe(false);
    expect(matchPitch(60.2, 60, 'pro').inTolerance).toBe(true);
  });

  it('на границе свёртки (тритон) всегда мимо допуска — дрожь границы безвредна', () => {
    expect(Math.abs(matchPitch(66, 60, 'medium').cents)).toBe(600);
    expect(matchPitch(66, 60, 'medium').inTolerance).toBe(false);
  });
});

describe('судейство и очки', () => {
  it('пороги вердиктов', () => {
    expect(judge(0.85)).toBe('perfect');
    expect(judge(0.6)).toBe('good');
    expect(judge(0.3)).toBe('miss');
  });

  it('комбо растёт с потолком ×2', () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(25)).toBe(2);
    expect(notePoints(1, 0)).toBe(100);
  });

  it('звёзды по точности', () => {
    expect(starsFor(0.95)).toBe(3);
    expect(starsFor(0.75)).toBe(2);
    expect(starsFor(0.5)).toBe(1);
    expect(starsFor(0.1)).toBe(0);
  });

  it('accuracy в summarize взвешена длительностью нот', () => {
    const note = (durMs: number): MapNote => ({ startMs: 0, durMs, midi: 60 });
    const s = summarize(
      [
        { note: note(3000), hitRatio: 1, judgement: 'perfect', points: 100 },
        { note: note(1000), hitRatio: 0, judgement: 'miss', points: 0 },
      ],
      100,
      1,
    );
    expect(s.accuracy).toBeCloseTo(0.75);
    expect(s.perfect).toBe(1);
    expect(s.miss).toBe(1);
  });
});

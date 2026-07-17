import { describe, expect, it } from 'vitest';
import { contourMidiAt, contourSegments } from './pitchline';
import type { Pitchline } from './songMap';

const line = (midi: (number | null)[], hopMs = 10): Pitchline => ({ hopMs, midi });

describe('contourMidiAt', () => {
  it('линейно интерполирует между соседними сэмплами', () => {
    expect(contourMidiAt(line([60, 62]), 5)).toBeCloseTo(61);
  });

  it('вне данных и на тишине — null', () => {
    expect(contourMidiAt(line([60]), -1)).toBeNull();
    expect(contourMidiAt(line([null, 60]), 0)).toBeNull();
    expect(contourMidiAt(line([60]), 100)).toBeNull();
  });

  it('не интерполирует сквозь октавный срыв в данных — шарик не ныряет', () => {
    // перепад 12 полутонов за один hop — октавная ошибка экстракции
    expect(contourMidiAt(line([60, 72]), 5)).toBe(60);
  });
});

describe('contourSegments', () => {
  it('режет озвученные участки на фразы с медианной высотой', () => {
    const midi = [...Array(50).fill(60), null, null, ...Array(50).fill(67)] as (number | null)[];
    const segs = contourSegments(line(midi), 2000, 200);
    expect(segs).toHaveLength(2);
    expect(segs[0].midi).toBe(60);
    expect(segs[1].midi).toBe(67);
  });

  it('короткие обрывки отбрасывает', () => {
    const midi = [60, 60, 60, null] as (number | null)[];
    expect(contourSegments(line(midi), 2000, 200)).toHaveLength(0);
  });
});

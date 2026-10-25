// Синтетическая карта devMap проходит checkTabMap; каждое свойство карты ловится на испорченной копии.
import { describe, expect, it } from 'vitest';
import { checkTabMap } from './checkTabMap';
import { devMap } from './devMap';
import { buildTempoMap, msToTick, tickToMs } from './tempo';
import type { TabMap } from './types';

const clone = (m: TabMap): TabMap => structuredClone(m);

describe('devMap', () => {
  for (const options of [{}, { events: 2000 }, { instrument: 'bass' as const, events: 300, seed: 7 }, { bpm: 97, events: 500, seed: 3 }]) {
    it(`проходит checkTabMap: ${JSON.stringify(options)}`, () => {
      const map = devMap(options);
      expect(checkTabMap(map)).toEqual([]);
      expect(map.notes).toHaveLength(options.events ?? 240);
    });
  }

  it('содержит все kind и attack, аккорды с формами руки, повторы аккордов, секции и фразы', () => {
    const map = devMap({ events: 400 });
    expect(new Set(map.notes.map((e) => e.kind))).toEqual(new Set(['note', 'doublestop', 'chord']));
    expect(new Set(map.notes.map((e) => e.attack))).toEqual(new Set(['pick', 'legato', 'tie']));
    expect(map.handShapes.length).toBeGreaterThan(3);
    expect(map.notes.some((e) => e.repeatOfPrev)).toBe(true);
    expect(map.notes.some((e) => e.notes.some((n) => n.techs.includes('bend') && n.bend?.length))).toBe(true);
    expect(map.sections.length).toBeGreaterThan(3);
    expect(map.phrases).toHaveLength(map.sections.length);
  });

  it('детерминирована: тот же seed — та же карта', () => {
    expect(devMap({ seed: 5 })).toEqual(devMap({ seed: 5 }));
    expect(devMap({ seed: 5 })).not.toEqual(devMap({ seed: 6 }));
  });
});

describe('checkTabMap ловит нарушения', () => {
  const base = devMap({ events: 120 });
  const cases: Array<[string, (m: TabMap) => void, RegExp]> = [
    ['такт не растёт', (m) => { m.bars[3].startMs = m.bars[2].startMs; }, /bars\[3\]: startMs .* не растёт/],
    ['такты не стыкуются', (m) => { m.bars[1].endMs -= 10; }, /bars\[1\]: endMs .* ≠ startMs следующего/],
    ['последний такт за концом', (m) => { m.durationMs = m.bars.at(-1)!.endMs - 1; }, /последний endMs .* > durationMs/],
    ['секции с дыркой', (m) => { m.sections[0].endMs -= m.bars[0].endMs - m.bars[0].startMs; }, /sections\[0\].*не стыкуется/],
    ['секция не по тактам', (m) => { m.sections[1].startMs += 1; m.sections[0].endMs += 1; }, /sections\[1\].*не на границах тактов/],
    ['форма руки с чужим аккордом', (m) => { m.handShapes[0].chordId = 99; }, /handShapes\[0\]: chordId 99/],
    ['событие с чужим аккордом', (m) => { m.notes.find((e) => e.chordId !== undefined)!.chordId = 42; }, /chordId 42 нет в chords/],
    ['событие вне своего такта', (m) => { m.notes[5].bar += 1; }, /notes\[5\]: startMs .* вне такта/],
    ['события не по времени', (m) => { [m.notes[7], m.notes[8]] = [m.notes[8], m.notes[7]]; }, /notes\[8\]: startMs .* меньше предыдущего/],
    ['событие без нот', (m) => { m.notes[2].notes = []; }, /notes\[2\]: событие без нот/],
  ];
  for (const [name, spoil, pattern] of cases) {
    it(name, () => {
      const map = clone(base);
      spoil(map);
      expect(checkTabMap(map).join('\n')).toMatch(pattern);
    });
  }
});

describe('tempo', () => {
  it('tick ↔ мс взаимно обратны на кусочной темпокарте', () => {
    const map = buildTempoMap([{ tick: 3840, bpm: 60 }, { tick: 7680, bpm: 180 }], 120);
    expect(tickToMs(map, 3840)).toBeCloseTo(2000, 9);
    expect(tickToMs(map, 7680)).toBeCloseTo(6000, 9);
    for (const tick of [0, 100, 3840, 5000.5, 7680, 12345]) expect(msToTick(map, tickToMs(map, tick))).toBeCloseTo(tick, 6);
  });
});

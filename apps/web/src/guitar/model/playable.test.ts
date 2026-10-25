// Играбельная карта на всех фикстурах этапа 6: свойства карты (checkTabMap) N/N; мс синта = (сдвиг форшлага + мс
// партитуры) / скорость + вступление; скорость 0.5 — события × 2; правки аппликатуры подменяют струну и лад.
import { describe, expect, it } from 'vitest';
import { FIXTURES, convertTex } from '../import/fixtures';
import { checkTabMap } from './checkTabMap';
import { buildPlayableMap } from './playable';

describe('buildPlayableMap', () => {
  const all = FIXTURES.flatMap((name) => convertTex(name).arrangements.map((a) => [name, a] as const));

  it(`свойства карты на всех фикстурах: ${all.length}/${all.length}, 0 нарушений`, () => {
    const broken = all.flatMap(([name, a]) => checkTabMap(buildPlayableMap(a, { kind: 'synth', speed: 1, leadInMs: 0 })).map((v) => `${name}: ${v}`));
    expect(broken).toEqual([]);
  });

  it('мс по темпокарте: 120 → 60 → 180 BPM', () => {
    const a = convertTex('tempo-changes').arrangements[0];
    const map = buildPlayableMap(a, { kind: 'synth', speed: 1, leadInMs: 0 });
    expect(map.notes.map((e) => Math.round(e.startMs))).toEqual([0, 500, 1000, 1500, 2000, 3000, 4000, 5000, 6000, 6333, 6667, 7000]);
    expect(map.durationMs).toBeCloseTo(7333.33, 1);
    expect(map.bars.map((b) => [Math.round(b.startMs), Math.round(b.endMs)])).toEqual([[0, 2000], [2000, 6000], [6000, 7333]]);
  });

  it('скорость 0.5 — события и длина × 2 (± 1 мс), вступление прибавляется', () => {
    const a = convertTex('single-notes').arrangements[0];
    const normal = buildPlayableMap(a, { kind: 'synth', speed: 1, leadInMs: 0 });
    const slow = buildPlayableMap(a, { kind: 'synth', speed: 0.5, leadInMs: 1000 });
    slow.notes.forEach((e, i) => expect(Math.abs(e.startMs - (normal.notes[i].startMs * 2 + 1000))).toBeLessThanOrEqual(1));
    expect(Math.abs(slow.durationMs - (normal.durationMs * 2 + 1000))).toBeLessThanOrEqual(1);
    expect(slow.speed).toBe(0.5);
  });

  it('форшлаг до первой доли: событие в первом такте, рендер сдвинут', () => {
    const a = convertTex('grace').arrangements[0];
    const map = buildPlayableMap(a, { kind: 'synth', speed: 1, leadInMs: 0 });
    expect(map.notes[0].startMs).toBeCloseTo(0, 6);
    expect(map.notes[1].startMs).toBeGreaterThan(0);
    expect(map.bars[0].startMs).toBe(0);
    expect(checkTabMap(map)).toEqual([]);
  });

  it('аккорды, формы руки, kind/attack/judge и правка аппликатуры', () => {
    const a = convertTex('chords').arrangements[0];
    const key = `${a.events[3].tick}:${a.events[3].notes[0].midi}`;
    const map = buildPlayableMap({ ...a, userEdits: { fingering: { [key]: { string: 2, fret: 10 } } } }, { kind: 'synth', speed: 1, leadInMs: 0 });
    expect(map.notes.map((e) => e.kind)).toEqual(['chord', 'chord', 'chord', 'doublestop', 'doublestop', 'chord']);
    expect(map.notes.every((e) => e.judge === 'attack')).toBe(true);
    expect([map.notes[3].notes[0].string, map.notes[3].notes[0].fret]).toEqual([2, 10]);
    expect(map.chords).toBe(a.chords);
    expect(map.handShapes.length).toBe(a.handShapes.length);
  });
});

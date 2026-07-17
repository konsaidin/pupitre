import { describe, expect, it } from 'vitest';
import { comfortZone, foldToOctaveOf, hzToMidi, midiToHz, midiToName } from './music';

describe('конвертации', () => {
  it('midi ↔ Hz туда-обратно', () => {
    expect(hzToMidi(440)).toBeCloseTo(69);
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(hzToMidi(midiToHz(52.37))).toBeCloseTo(52.37);
  });

  it('имена нот', () => {
    expect(midiToName(60)).toBe('C4');
    expect(midiToName(69)).toBe('A4');
    expect(midiToName(36)).toBe('C2');
  });
});

describe('foldToOctaveOf', () => {
  it('кладёт высоту в цель ± 6 полутонов', () => {
    expect(foldToOctaveOf(48, 60)).toBe(60);
    expect(foldToOctaveOf(72.5, 60)).toBeCloseTo(60.5);
    expect(foldToOctaveOf(62, 60)).toBe(62);
  });
});

describe('comfortZone', () => {
  it('поджимает диапазон на полтона с краёв', () => {
    expect(comfortZone({ lowMidi: 48, highMidi: 72 })).toEqual({ lowMidi: 49, highMidi: 71 });
  });

  it('слишком узкий диапазон не поджимает', () => {
    expect(comfortZone({ lowMidi: 60, highMidi: 65 })).toEqual({ lowMidi: 60, highMidi: 65 });
  });
});

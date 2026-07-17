import { describe, expect, it } from 'vitest';
import { chooseOctaveShift, rollWindow, shiftNotes } from './octave';
import type { MapNote } from '../lib/songMap';

const note = (midi: number, startMs = 0, durMs = 1000): MapNote => ({ startMs, durMs, midi });

describe('chooseOctaveShift', () => {
  it('поднимает низкую мелодию в комфортную зону', () => {
    // мелодия вокруг C3 (48), зона C4..C5
    const notes = [note(46), note(48), note(50)];
    expect(chooseOctaveShift(notes, { lowMidi: 58, highMidi: 72 })).toBe(1);
  });

  it('мелодия в зоне остаётся на месте', () => {
    const notes = [note(60), note(64), note(67)];
    expect(chooseOctaveShift(notes, { lowMidi: 57, highMidi: 72 })).toBe(0);
  });

  it('при равном покрытии выбирает меньший сдвиг', () => {
    expect(chooseOctaveShift([note(60)], { lowMidi: 48, highMidi: 72 })).toBe(0);
  });
});

describe('shiftNotes / rollWindow', () => {
  it('shiftNotes сдвигает на целые октавы и не мутирует вход', () => {
    const src = [note(60)];
    const out = shiftNotes(src, -2);
    expect(out[0].midi).toBe(36);
    expect(src[0].midi).toBe(60);
  });

  it('rollWindow — диапазон ± запас, растянутый на выпавшие ноты', () => {
    const w = rollWindow([note(40), note(80)], { lowMidi: 55, highMidi: 70 });
    expect(w.lowMidi).toBe(40);
    expect(w.highMidi).toBe(80);
    const w2 = rollWindow([note(60)], { lowMidi: 55, highMidi: 70 });
    expect(w2).toEqual({ lowMidi: 53, highMidi: 72 });
  });
});

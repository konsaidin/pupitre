// Слой вердиктов на карте devMap: тексты (рано/поздно со знаком, не та нота с ладами по-русски и по-английски, аккорд —
// только нота), одна подпись на событие и только 600 мс от вердикта, подъём и разведение близких подписей.
import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../../lib/i18n';
import { devMap } from '../model/devMap';
import { STATUS } from '../vendor/fretfall/highway.js';
import { adaptMap, setVerdict, stampStatuses } from './adapter';
import { chipOpacity, chipText, collectChips, layoutChips, newChip, type VerdictChip } from './verdicts';

const a = adaptMap(devMap({ events: 300 }));
const singleNote = a.arr.notes.findIndex((n, k) => n.fret > 2 && a.ffOfEvent[a.fromFf[k * 2]].length === 1);
const chordNote = a.arr.notes.findIndex((_, k) => a.ffOfEvent[a.fromFf[k * 2]].length > 2 && a.ffOfEvent[a.fromFf[k * 2]][0] === k);
const eventOf = (note: number) => a.fromFf[note * 2];

afterEach(() => setLang('en'));

describe('текст подписи', () => {
  it('рано и поздно — со знаком и «мс»', () => {
    setVerdict(a, eventOf(singleNote), STATUS.early, -38.4);
    expect(chipText(a, singleNote, 'early')).toBe('−38 ms');
    setVerdict(a, eventOf(singleNote), STATUS.late, 52);
    setLang('ru');
    expect(chipText(a, singleNote, 'late')).toBe('+52 мс');
  });

  it('не та нота: услышанная нота и разница в ладах (склонение), октава не считается', () => {
    const want = a.midi[singleNote];
    setLang('ru');
    setVerdict(a, eventOf(singleNote), STATUS.wrong, 0, want + 1);
    expect(chipText(a, singleNote, 'wrong')).toMatch(/^[A-G]♯?\d · \+1 лад$/);
    setVerdict(a, eventOf(singleNote), STATUS.wrong, 0, want - 2 - 12);
    expect(chipText(a, singleNote, 'wrong')).toMatch(/ · −2 лада$/);
    setVerdict(a, eventOf(singleNote), STATUS.wrong, 0, want + 5);
    expect(chipText(a, singleNote, 'wrong')).toMatch(/ · \+5 ладов$/);
    setLang('en');
    setVerdict(a, eventOf(singleNote), STATUS.wrong, 0, 70);
    expect(chipText(a, singleNote, 'wrong')).toMatch(/^A♯4/);
    setVerdict(a, eventOf(singleNote), STATUS.wrong, 0, want - 3);
    expect(chipText(a, singleNote, 'wrong')).toMatch(/ · −3 frets$/);
  });

  it('аккорд — только услышанная нота; высоты нет — пусто', () => {
    setVerdict(a, eventOf(chordNote), STATUS.wrong, 0, 57);
    expect(chipText(a, chordNote, 'wrong')).toBe('A3');
    setVerdict(a, eventOf(chordNote), STATUS.wrong, 0, NaN);
    expect(chipText(a, chordNote, 'wrong')).toBe('');
  });
});

describe('подписи в кадре', () => {
  it('одна на событие (у аккорда — на первой ноте), только рано/поздно/не та и только 600 мс', () => {
    const b = adaptMap(devMap({ events: 300 }));
    const pool = Array.from({ length: 8 }, newChip);
    const chord = eventOf(chordNote);
    const t0 = b.arr.notes[chordNote].time + 0.2;
    setVerdict(b, chord, STATUS.wrong, 10, 50);
    setVerdict(b, eventOf(singleNote), STATUS.hit, 5); // попадание вовремя — без подписи
    stampStatuses(b, t0);
    expect(collectChips(b, t0 + 0.1, pool)).toBe(1);
    expect(pool[0]).toMatchObject({ note: b.ffOfEvent[chord][0], kind: 'wrong' });
    expect(pool[0].age).toBeCloseTo(0.1, 9);
    expect(collectChips(b, t0 + 0.61, pool)).toBe(0);
    expect(chipOpacity(0.1)).toBe(1);
    expect(chipOpacity(0.525)).toBeCloseTo(0.5, 9);
    expect(chipOpacity(0.7)).toBe(0);
  });

  it('подъём на 6 px за 240 мс (без него при reduce-движении); близкие по x — правая на строку выше', () => {
    const chip = (x: number, age: number): VerdictChip => ({ ...newChip(), x, y: 100, age, text: '−38 мс' });
    const chips = [chip(300, 0), chip(100, 0.3), chip(330, 0.3)];
    layoutChips(chips, 3, false);
    expect(chips.map((c) => c.x)).toEqual([100, 300, 330]);
    expect(chips[0].y).toBe(100); // подъём закончен
    expect(chips[1].y).toBeCloseTo(106, 9); // только появилась — на 6 px ниже
    expect(chips[2].y).toBeCloseTo(78, 9); // налезала на соседку — строкой выше
    const still = [chip(300, 0)];
    layoutChips(still, 1, true);
    expect(still[0].y).toBe(100);
  });
});

// Ударные с ID артикуляций GP7 вместо индексов: переводятся на артикуляции дорожки с той же нотой GM (недостающая —
// добавляется); настоящие индексы, перкуссия по названию и значения вне кита не трогаются.
import * as alphaTab from '@coderline/alphatab';
import { describe, expect, it } from 'vitest';
import { fixDrumArticulationIds } from './drums';

// Начало стандартного списка кита GP (как в GP8-файлах): индексы 34–39 — бонги, 41 — тимбалес, 44–49 — конги.
const GP_KIT: [string, number][] = [
  ['snare', 38], ['snare', 37], ['snare', 38], ['hiHat', 42], ['hiHat', 46], ['hiHat', 46], ['hiHat', 44], ['kickDrum', 35], ['kickDrum', 36],
  ['tom', 50], ['tom', 48], ['tom', 47], ['tom', 45], ['tom', 43], ['ride', 51], ['ride', 51], ['ride', 53], ['ride', 51], ['splash', 55],
  ['splash', 55], ['china', 52], ['china', 52], ['crash', 49], ['crash', 49], ['crash', 57], ['crash', 57], ['cowbell', 56], ['cowbell', 56],
  ['cowbell', 56], ['cowbell', 56], ['cowbell', 56], ['cowbell', 56], ['woodblock', 77], ['woodblock', 76], ['bongo', 60], ['bongo', 60],
  ['bongo', 60], ['bongo', 61], ['bongo', 61], ['bongo', 61], ['timbale', 66], ['timbale', 65], ['agogo', 68], ['agogo', 67], ['conga', 64],
  ['conga', 64], ['conga', 64], ['conga', 63], ['conga', 63], ['conga', 62],
];

function drumScore(values: number[], name = 'Drums', kit = GP_KIT) {
  const notes = values.map((percussionArticulation) => ({ percussionArticulation }));
  const track = {
    name,
    percussionArticulations: kit.map(([el, out]) => new alphaTab.model.InstrumentArticulation(el, 0, out)),
    staves: [{ bars: [{ voices: [{ beats: [{ notes }] }] }] }],
  };
  return { score: { tracks: [track] } as unknown as alphaTab.model.Score, track, notes };
}
const outputs = (d: ReturnType<typeof drumScore>) => d.notes.map((n) => d.track.percussionArticulations[n.percussionArticulation].outputMidiNumber);

describe('fixDrumArticulationIds', () => {
  it('ID GP7 (бочка 36, малый 38, хэт 46, крэш 49, томы 45/41) → артикуляции с теми же нотами GM', () => {
    const d = drumScore([36, 38, 46, 49, 45, 41, 36]);
    expect(outputs(d)).toEqual([60, 61, 64, 62, 64, 65, 60]); // как читает alphaTab: бонги, конги, тимбалес
    expect(fixDrumArticulationIds(d.score)).toBe(1);
    expect(outputs(d)).toEqual([36, 38, 46, 49, 45, 41, 36]);
    // ноты 41 в начале списка нет — добавлена
    expect(d.track.percussionArticulations).toHaveLength(GP_KIT.length + 1);
  });

  it('настоящие индексы (бочка 8, малый 0, хэт 3) не трогаются', () => {
    const d = drumScore([8, 0, 3, 22]);
    expect(fixDrumArticulationIds(d.score)).toBe(0);
    expect(outputs(d)).toEqual([36, 38, 42, 49]);
  });

  it('перкуссия по названию, значения вне кита и кит без малого не трогаются', () => {
    expect(fixDrumArticulationIds(drumScore([36, 38, 46], 'Percussion').score)).toBe(0);
    expect(fixDrumArticulationIds(drumScore([36, 38, 77]).score)).toBe(0);
    expect(fixDrumArticulationIds(drumScore([36, 45, 46]).score)).toBe(0);
  });
});

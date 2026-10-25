// Конвертер fretfall (вырезка из player.js + патчи Пюпитра, VENDOR.md) на своей alphaTex-фикстуре:
// струна 0 — НИЖНЯЯ, лады подняты на капо, `open` от нижней; патчи (а) фабрика, (б) без ссылки на track, (в) поля нот.
import * as alphaTab from '@coderline/alphatab';
import { describe, expect, it } from 'vitest';
import { fingerFor, suggestPositions } from './fingering.js';
import { createConverter, type FfScoreNote, type FfSong } from './fromScore.js';
import { annotate, markArpeggios, markRepeats, msToTick, phrasesOf, tickToMs, tuningName, tuningReference } from './music.js';
import { DEFAULT_STYLE, FONTS, theme } from './themes.js';

// Выдуманная фраза (своя, не из песни). В alphaTex струна 1 — ВЕРХНЯЯ (как в табулатуре), лад — от капо, как в GP.
// Гитара, капо 2: такт 1 — три ноты (на 6-й, 5-й открытой и натуральный флажолет на 12-м ладу 3-й струны) и аккорд
// на трёх верхних струнах; такт 2 — половинная и пауза. Бас без капо. Оба такта под повтором ×2.
const TEX = String.raw`
\title "Probe phrase"
\tempo 120
\track "Guitar"
\staff {tabs}
\tuning (E4 B3 G3 D3 A2 E2)
\capo 2
\ro 3.6.4 0.5.4 12.3{nh}.4 (0.1 1.2 0.3).4 | \rc 2 5.6.2 r.2
\track "Bass"
\staff {tabs}
\tuning (G2 D2 A1 E1)
3.4.2 5.3.2 | 0.4.1
`;

function convert(tex: string): FfSong {
  const settings = new alphaTab.Settings();
  const score = alphaTab.importer.ScoreLoader.loadAlphaTex(tex, settings);
  const { prepareScore, songFromScore } = createConverter(alphaTab);
  prepareScore(score);
  const midiFile = new alphaTab.midi.MidiFile();
  midiFile.format = alphaTab.midi.MidiFileFormat.SingleTrackMultiChannel; // формат 0, как в воркере разбора (этап 6a)
  const generator = new alphaTab.midi.MidiFileGenerator(score, settings, new alphaTab.midi.AlphaSynthMidiFileHandler(midiFile));
  generator.generate();
  return songFromScore(score, generator.tickLookup);
}

// Ноты одного прохода гитары: [время, струна (0 — нижняя), абсолютный лад, звучащая MIDI, harmonicValue, такт]
const GUITAR_PASS: Array<[number, number, number, number, number, number]> = [
  [0, 0, 5, 45, 0, 0], // 3.6 + капо 2 → 5-й лад нижней E2 (40 + 2 + 3)
  [0.5, 1, 0, 47, 0, 0], // открытая A2 под капо остаётся 0, звучит от капо (45 + 2)
  [1, 3, 14, 69, 12, 0], // натуральный флажолет 12 на G3: лад 14 на грифе, звучит G3 + капо + октава (55 + 2 + 12)
  [1.5, 3, 0, 57, 0, 0], // аккорд: G3 открытая
  [1.5, 4, 3, 62, 0, 0], //          B3, 1-й лад + капо → 3
  [1.5, 5, 0, 66, 0, 0], //          E4 открытая
  [2, 0, 7, 47, 0, 1], // такт 2: 5.6 + капо → 7
];

const plainData = (value: unknown, path: string): void => {
  if (value === null || typeof value !== 'object') return;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== Array.prototype) throw new Error(`${path}: ${proto?.constructor?.name}`);
  for (const [key, inner] of Object.entries(value)) plainData(inner, `${path}.${key}`);
};

describe('fretfall songFromScore (вендор)', () => {
  const song = convert(TEX);
  const [guitar, bass] = song.arrangements;

  it('партии, строй от нижней струны и длина', () => {
    expect(song.arrangements).toHaveLength(2);
    expect(song.bpm).toBe(120);
    expect(song.length).toBeCloseTo(8, 6); // 2 такта 4/4 при 120 BPM × 2 прохода
    expect(guitar.name).toBe('Guitar');
    expect(guitar.strings).toBe(6);
    expect(guitar.open).toEqual([40, 45, 50, 55, 59, 64]);
    expect(tuningName(guitar.open)).toBe('E Standard');
    expect(guitar.capos).toEqual([{ time: 0, fret: 2 }]);
    expect(bass.strings).toBe(4);
    expect(bass.open).toEqual([28, 33, 38, 43]);
    expect(bass.capos).toEqual([]);
  });

  it('ноты гитары: число, струны, лады на капо, звучащая высота, такт и проход', () => {
    expect(guitar.notes).toHaveLength(GUITAR_PASS.length * 2);
    const rows = guitar.notes.map((n: FfScoreNote) => [n.time, n.string, n.fret, n.realValue, n.harmonicValue, n.barIndex, n.passIndex]);
    const expected = [0, 1].flatMap((pass) => GUITAR_PASS.map(([t, s, f, midi, hv, bar]) => [t + pass * 4, s, f, midi, hv, bar, pass]));
    expect(rows).toEqual(expected);
    // патч (г): нотная длительность — четверти по 0.5 с, половинная 1 с (у коротких sustain 0)
    expect(guitar.notes.slice(0, 7).map((n) => n.duration)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1]);
    expect(guitar.notes[0].sustain).toBe(0.5);
    const harmonic = guitar.notes[2];
    expect([harmonic.harmonic, harmonic.harmonicType]).toEqual([true, 'natural']);
    // Звучащая высота = открытая струна от нижней + капо + лад GP (у не-флажолетов)
    for (const n of guitar.notes.filter((x) => !x.harmonicType)) expect(n.realValue).toBe(guitar.open[n.string] + n.fret + (n.fret > 0 ? 0 : 2));
  });

  it('аккорды: лады по струнам от нижней, тоже на капо', () => {
    expect(guitar.chords).toHaveLength(2);
    expect(guitar.chords[0].frets).toEqual([-1, -1, -1, 0, 3, 0]);
    expect(guitar.chords[0].notes).toEqual([3, 4, 5]);
    expect(guitar.chords[1].notes).toEqual([10, 11, 12]);
    expect(guitar.handShapes[0].frets).toEqual([-1, -1, -1, 0, 3, 0]);
  });

  it('бас: вторая дорожка, струны от нижней, без капо', () => {
    expect([bass.trackIndex, bass.staffIndex]).toEqual([1, 0]);
    expect(bass.notes.map((n) => [n.time, n.string, n.fret, n.realValue, n.barIndex, n.passIndex])).toEqual([
      [0, 0, 3, 31, 0, 0],
      [1, 1, 5, 38, 0, 0],
      [2, 0, 0, 28, 1, 0],
      [4, 0, 3, 31, 0, 1],
      [5, 1, 5, 38, 0, 1],
      [6, 0, 0, 28, 1, 1],
    ]);
  });

  it('патч (б): в выходе нет объектов alphaTab — только чистые данные', () => {
    expect([guitar.trackIndex, guitar.staffIndex]).toEqual([0, 0]);
    for (const arr of song.arrangements) expect('track' in arr).toBe(false);
    expect(() => plainData(song, 'song')).not.toThrow();
    expect(structuredClone(song)).toEqual(song);
  });

  it('объявления .d.ts согласованы с исходником', () => {
    // темпокарта в тиках alphaTab (960 PPQ): вторая доля — 960 тиков = 0.5 с
    expect(msToTick(song.tempo, 500)).toBeCloseTo(960, 6);
    expect(tickToMs(song.tempo, 960 * 4)).toBeCloseTo(2000, 6);
    expect(tuningReference(guitar.open)).toEqual({ reference: 'E Standard', open: [40, 45, 50, 55, 59, 64], shift: [0, 0, 0, 0, 0, 0] });
    expect(phrasesOf(guitar, song.length)).toHaveLength(4); // без секций — фраза на проход такта
    const { anchors, fingers } = suggestPositions(guitar.notes);
    expect(anchors).toEqual(guitar.anchors);
    expect(fingers.get(guitar.notes[0])).toBe(guitar.notes[0].finger);
    expect(fingerFor(5, 4)).toBe(2);
    markRepeats(guitar.notes, guitar.chords);
    annotate(guitar.notes, guitar.chords);
    markArpeggios(guitar.notes, guitar.handShapes);
    expect(guitar.notes.every((n) => typeof n.repeat === 'boolean')).toBe(true);
    expect(Object.values(FONTS).every((f) => f.href === null)).toBe(true); // патч themes.js: без Google Fonts
    expect(theme(DEFAULT_STYLE).str).toHaveLength(8);
  });
});

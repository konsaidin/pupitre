// Синтетическая играбельная карта для dev-стендов и тестов дорожки до этапа 11 (§3.4): события всех kind и attack,
// аккорды с формами руки, повторы аккордов, секции из целых тактов, такты, доли, фразы, якоря. Детерминирована (seed),
// проходит checkTabMap. Музыки не изображает — только разнообразие форм.
import type { ChordTemplate, PlayNote, TabEvent, TabMap, TabMapBar, TabMapHandShape, Tech } from './types';

export interface DevMapOptions {
  /** Сколько событий (≈ 2000 для бенча дорожки). */
  events?: number;
  instrument?: 'guitar' | 'bass';
  bpm?: number;
  seed?: number;
}

const GUITAR = [40, 45, 50, 55, 59, 64];
const BASS = [28, 33, 38, 43];
// Формы аккордов по струнам (0 — нижняя), null — не играется.
const SHAPES: { name: string; frets: (number | null)[]; fingers: (number | null)[] }[] = [
  { name: 'E5', frets: [0, 2, 2, null, null, null], fingers: [null, 1, 2, null, null, null] },
  { name: 'A', frets: [null, 0, 2, 2, 2, 0], fingers: [null, null, 1, 2, 3, null] },
  { name: 'G', frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, null, null, null, 3] },
  { name: 'D', frets: [null, null, 0, 2, 3, 2], fingers: [null, null, null, 1, 3, 2] },
];
const SECTION_NAMES = ['Вступление', 'Куплет', 'Припев', 'Соло', 'Концовка'];

// Мультипликативный генератор: тот же seed — та же карта.
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

export function devMap({ events = 240, instrument = 'guitar', bpm = 120, seed = 1 }: DevMapOptions = {}): TabMap {
  const random = rng(seed);
  const open = instrument === 'bass' ? BASS : GUITAR;
  const beatMs = 60000 / bpm;
  const barMs = beatMs * 4;
  const stepMs = beatMs / 2; // восьмые
  const perBar = 8;
  const barsCount = Math.ceil(events / 6) + 1; // шесть событий в такте, последний такт — тишина
  const bars: TabMapBar[] = [];
  for (let i = 0; i < barsCount; i++)
    bars.push({ index: i, occ: 0, item: 0, startMs: i * barMs, endMs: (i + 1) * barMs, num: 4, den: 4 });
  const durationMs = barsCount * barMs;

  const chords: ChordTemplate[] = instrument === 'bass' ? [] : SHAPES.map((s, id) => ({
    id, name: s.name, displayName: s.name, frets: s.frets, fingers: s.fingers, barre: null, source: 'file' as const,
  }));
  const handShapes: TabMapHandShape[] = [];
  const notes: TabEvent[] = [];
  const play = (string: number, fret: number, startMs: number, durMs: number, techs: Tech[] = []): PlayNote => ({
    string, fret, midi: open[string] + fret, durTicks: 0, sustainTicks: 0, techs,
    startMs, durMs, sustainMs: durMs >= 400 ? durMs : 0,
  });

  let prevChord = -1;
  for (let k = 0; notes.length < events; k++) {
    const bar = Math.floor(k / perBar);
    if (bar >= barsCount - 1) break;
    const slot = k % perBar;
    if (slot === 3 || slot === 7) continue; // паузы — шесть событий на такт
    const startMs = bar * barMs + slot * stepMs;
    const base = { item: 0, phraseIter: Math.floor(bar / 4), bar, occ: 0, windowScale: 1 };
    const id = notes.length;
    // Каждый четвёртый такт с аккордами: форма руки на такт, повтор того же аккорда — repeatOfPrev.
    if (chords.length && bar % 4 === 2) {
      const chordId = Math.floor(bar / 4) % chords.length;
      const shape = chords[chordId];
      if (slot === 0) handShapes.push({ id: handShapes.length, chordId, startMs, endMs: (bar + 1) * barMs - stepMs, arpeggio: bar % 8 === 6 });
      const strings = shape.frets.flatMap((f, s) => (f === null ? [] : [s]));
      const chordNotes = strings.map((s) => play(s, shape.frets[s] as number, startMs, stepMs, ['palmMute']));
      notes.push({
        ...base, eventId: id, startMs, durMs: stepMs, midi: Math.min(...chordNotes.map((n) => n.midi)),
        kind: chordNotes.length === 2 ? 'doublestop' : 'chord', attack: 'pick', judge: 'attack',
        chordId, handShapeId: handShapes.at(-1)!.id, strum: slot % 2 ? 'up' : 'down',
        repeatOfPrev: prevChord === chordId, notes: chordNotes,
      });
      prevChord = chordId;
      continue;
    }
    prevChord = -1;
    const string = Math.floor(random() * open.length);
    const fret = Math.floor(random() * 13);
    // Двузвучие: нота и квинта на соседней струне.
    if (bar % 4 === 1 && slot === 4 && string + 1 < open.length) {
      const pair = [play(string, fret, startMs, stepMs), play(string + 1, fret + 2, startMs, stepMs)];
      notes.push({ ...base, eventId: id, startMs, durMs: stepMs, midi: pair[0].midi, kind: 'doublestop', attack: 'pick', judge: 'attack', notes: pair });
      continue;
    }
    // Легато (HO/PO) после ноты на той же струне, лига — продолжение без атаки, длинные — с бендом или вибрато.
    const prev = notes.at(-1);
    const sameString = prev && prev.kind === 'note' && prev.startMs === startMs - stepMs ? prev.notes[0] : undefined;
    if (sameString && slot === 1) {
      const up = random() < 0.5;
      const n = play(sameString.string, Math.max(0, sameString.fret + (up ? 2 : -2)), startMs, stepMs, [up ? 'hammerOn' : 'pullOff']);
      notes.push({ ...base, eventId: id, startMs, durMs: stepMs, midi: n.midi, kind: 'note', attack: 'legato', judge: 'legato', notes: [n] });
      continue;
    }
    if (sameString && slot === 5) {
      const n = play(sameString.string, sameString.fret, startMs, stepMs);
      notes.push({ ...base, eventId: id, startMs, durMs: stepMs, midi: n.midi, kind: 'note', attack: 'tie', judge: 'tie', notes: [n] });
      continue;
    }
    const long = slot === 6;
    const techs: Tech[] = long ? [random() < 0.5 ? 'bend' : 'vibrato'] : slot === 2 && random() < 0.3 ? ['slide'] : [];
    const n = play(string, fret, startMs, long ? stepMs * 2 : stepMs, techs);
    if (techs.includes('bend')) n.bend = [{ at: 0, cents: 0 }, { at: 0.5, cents: 200 }, { at: 1, cents: 200 }];
    if (techs.includes('slide')) n.slideToFret = Math.min(22, fret + 3);
    notes.push({ ...base, eventId: id, startMs, durMs: n.durMs, midi: n.midi, kind: 'note', attack: 'pick', judge: 'attack', notes: [n] });
  }

  // Секции — по 4 такта, последняя тянется до конца; фразы — тоже по 4 такта.
  const sections = [];
  for (let b = 0; b < barsCount; b += 4) {
    const end = Math.min(barsCount, b + 4);
    sections.push({ name: SECTION_NAMES[Math.min(SECTION_NAMES.length - 1, sections.length)], item: 0, startMs: b * barMs, endMs: end * barMs });
  }
  const phrases = sections.map((s, iter) => ({ iter, phraseId: iter, name: s.name, startMs: s.startMs, endMs: s.endMs, level: 0, maxLevel: 0 }));
  const beats = [];
  for (let i = 0; i < barsCount * 4; i++) beats.push({ ms: i * beatMs, downbeat: i % 4 === 0, bar: Math.floor(i / 4) });
  const anchorsMs = sections.map((s, i) => ({ startMs: s.startMs, endMs: s.endMs, fret: [1, 3, 5, 7, 2][i % 5], width: 4 }));

  return {
    kind: 'tab', id: `dev:${instrument}:${seed}`, title: 'Дорожка для проверки', subtitle: `${notes.length} событий`,
    durationMs, notes, backing: { kind: 'buffer' }, bpm,
    arrangementId: `dev:${instrument}:${seed}:0:0`, instrument, strings: open.length,
    tuning: { openMidi: open, name: 'E Standard', offsets: open.map(() => 0) }, capo: 0,
    chords, handShapes, sections, bars, beats, phrases, anchorsMs, refA4Hz: 440, speed: 1,
  };
}

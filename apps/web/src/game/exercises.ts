// Генераторы распевок и упражнений: строят SongMap под диапазон пользователя.

import { comfortZone, midiToName, type VocalRange } from '../lib/music';
import type { MapNote, SongMap } from '../lib/songMap';

export interface ExerciseOptions {
  bpm: number;
  /** нижняя нота тональности (midi); по умолчанию — от комфортной зоны */
  rootMidi?: number;
  repeats: number;
}

export interface ExerciseDef {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: 'Распевки' | 'Гаммы' | 'Слух';
  defaultBpm: number;
  defaultRepeats: number;
  maxRepeats: number;
  build: (range: VocalRange, opts: ExerciseOptions) => SongMap;
}

const SOLFEGE = ['до', 'до#', 'ре', 'ре#', 'ми', 'фа', 'фа#', 'соль', 'соль#', 'ля', 'ля#', 'си'];

function solfege(degreeSemitones: number): string {
  return SOLFEGE[((degreeSemitones % 12) + 12) % 12];
}

interface PatternStep {
  semitone: number;
  beats: number;
  lyric?: string;
}

/**
 * Общий строитель: паттерн повторяется, поднимаясь на полтона, пока верхняя
 * нота помещается в комфортную зону (не более maxRepeats раз).
 */
function buildRising(
  id: string,
  title: string,
  pattern: PatternStep[],
  range: VocalRange,
  opts: ExerciseOptions,
  gapBeats = 2,
): SongMap {
  const zone = comfortZone(range);
  const beatMs = 60000 / opts.bpm;
  const root = opts.rootMidi ?? zone.lowMidi;
  const patternSpan = Math.max(...pattern.map((p) => p.semitone));
  const notes: MapNote[] = [];
  let t = 0;
  let made = 0;
  for (let rep = 0; rep < opts.repeats; rep++) {
    const base = root + rep;
    if (base + patternSpan > zone.highMidi && made > 0) break;
    if (base + patternSpan > zone.highMidi) break;
    for (const step of pattern) {
      const durMs = step.beats * beatMs;
      notes.push({
        startMs: Math.round(t),
        durMs: Math.round(durMs * 0.92), // короткая пауза между нотами — успеть перестроиться
        midi: base + step.semitone,
        lyric: step.lyric ?? solfege(step.semitone),
      });
      t += durMs;
    }
    t += gapBeats * beatMs;
    made++;
  }
  const leadInMs = Math.round(4 * beatMs);
  const shifted = notes.map((n) => ({ ...n, startMs: n.startMs + leadInMs }));
  const durationMs = (shifted.at(-1)?.startMs ?? 0) + (shifted.at(-1)?.durMs ?? 0) + Math.round(2 * beatMs);
  return {
    id: `${id}@${opts.bpm}x${made}r${root}`,
    title,
    subtitle: `от ${midiToName(root)}, ${opts.bpm} BPM`,
    durationMs,
    notes: shifted,
    backing: { kind: 'synth', guideNotes: true },
    bpm: opts.bpm,
    leadInMs,
  };
}

const MAJOR_FIVE: PatternStep[] = [0, 2, 4, 5, 7, 5, 4, 2].map((s) => ({ semitone: s, beats: 1 }));
MAJOR_FIVE.push({ semitone: 0, beats: 2 });

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10, 12, 10, 8, 7, 5, 3, 2];
const ARPEGGIO = [0, 4, 7, 12, 7, 4];

function scalePattern(steps: number[]): PatternStep[] {
  const p: PatternStep[] = steps.map((s) => ({ semitone: s, beats: 1 }));
  p.push({ semitone: 0, beats: 2 });
  return p;
}

/** Интервалы: опорная нота + целевая; детерминированная псевдослучайность от repeats. */
function buildIntervals(range: VocalRange, opts: ExerciseOptions): SongMap {
  const zone = comfortZone(range);
  const beatMs = 60000 / opts.bpm;
  const root = opts.rootMidi ?? zone.lowMidi;
  const intervals = [
    { s: 3, name: 'м3' },
    { s: 4, name: 'б3' },
    { s: 5, name: 'ч4' },
    { s: 7, name: 'ч5' },
    { s: 12, name: 'октава' },
  ];
  const notes: MapNote[] = [];
  let t = 0;
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < opts.repeats * 3; i++) {
    const fitting = intervals.filter((iv) => root + iv.s <= zone.highMidi);
    if (fitting.length === 0) break;
    const iv = fitting[Math.floor(rnd() * fitting.length)];
    notes.push({ startMs: Math.round(t), durMs: Math.round(2 * beatMs * 0.92), midi: root, lyric: 'опора' });
    t += 2 * beatMs;
    notes.push({ startMs: Math.round(t), durMs: Math.round(2 * beatMs * 0.92), midi: root + iv.s, lyric: iv.name });
    t += 2 * beatMs + 2 * beatMs; // пауза перед следующей парой
  }
  const leadInMs = Math.round(4 * beatMs);
  const shifted = notes.map((n) => ({ ...n, startMs: n.startMs + leadInMs }));
  return {
    id: `intervals@${opts.bpm}x${opts.repeats}r${root}`,
    title: 'Интервалы',
    subtitle: `от ${midiToName(root)}, ${opts.bpm} BPM`,
    durationMs: (shifted.at(-1)?.startMs ?? 0) + (shifted.at(-1)?.durMs ?? 0) + Math.round(2 * beatMs),
    notes: shifted,
    // синт играет только опорные ноты — целевую надо спеть по слуху
    guideEvents: shifted.filter((n) => n.lyric === 'опора'),
    backing: { kind: 'synth', guideNotes: true },
    bpm: opts.bpm,
    leadInMs,
  };
}

/** Сирена: глиссандо вверх-вниз по полутонам через всю комфортную зону. */
function buildSiren(range: VocalRange, opts: ExerciseOptions): SongMap {
  const zone = comfortZone(range);
  const stepMs = Math.max(180, 60000 / opts.bpm / 2);
  const notes: MapNote[] = [];
  let t = 0;
  for (let rep = 0; rep < opts.repeats; rep++) {
    for (let m = zone.lowMidi; m <= zone.highMidi; m++) {
      notes.push({ startMs: Math.round(t), durMs: Math.round(stepMs), midi: m, lyric: 'у' });
      t += stepMs;
    }
    for (let m = zone.highMidi - 1; m >= zone.lowMidi; m--) {
      notes.push({ startMs: Math.round(t), durMs: Math.round(stepMs), midi: m, lyric: 'у' });
      t += stepMs;
    }
    t += stepMs * 4;
  }
  const leadInMs = 1500;
  const shifted = notes.map((n) => ({ ...n, startMs: n.startMs + leadInMs }));
  return {
    id: `siren@${opts.bpm}x${opts.repeats}`,
    title: 'Сирена',
    subtitle: `${midiToName(zone.lowMidi)}–${midiToName(zone.highMidi)}`,
    durationMs: (shifted.at(-1)?.startMs ?? 0) + (shifted.at(-1)?.durMs ?? 0) + 1000,
    notes: shifted,
    backing: { kind: 'synth', guideNotes: true },
    bpm: opts.bpm,
    leadInMs,
  };
}

/** Длинные ноты: удержание 4 доли на ступенях 1-3-5-3-1. */
function buildLongTones(range: VocalRange, opts: ExerciseOptions): SongMap {
  const pattern: PatternStep[] = [0, 4, 7, 4, 0].map((s) => ({ semitone: s, beats: 4, lyric: 'а—' }));
  return buildRising('long-tones', 'Длинные ноты', pattern, range, opts, 2);
}

export const EXERCISES: ExerciseDef[] = [
  {
    id: 'long-tones',
    title: 'Длинные ноты',
    description: 'Удерживай ноту 4 счёта ровно, без съезда. База контроля дыхания и опоры.',
    icon: '🫁',
    category: 'Распевки',
    defaultBpm: 70,
    defaultRepeats: 3,
    maxRepeats: 8,
    build: buildLongTones,
  },
  {
    id: 'siren',
    title: 'Сирена',
    description: 'Плавное глиссандо от низа диапазона до верха и обратно. Разогрев связок.',
    icon: '🚨',
    category: 'Распевки',
    defaultBpm: 90,
    defaultRepeats: 2,
    maxRepeats: 6,
    build: buildSiren,
  },
  {
    id: 'five-note',
    title: 'Пятиступенная распевка',
    description: 'До-ре-ми-фа-соль-фа-ми-ре-до, каждый повтор на полтона выше.',
    icon: '🎵',
    category: 'Распевки',
    defaultBpm: 100,
    defaultRepeats: 12,
    maxRepeats: 24,
    build: (r, o) => buildRising('five-note', 'Пятиступенная распевка', MAJOR_FIVE, r, o),
  },
  {
    id: 'major-scale',
    title: 'Мажорная гамма',
    description: 'Полная гамма вверх и вниз. Точность каждой ступени.',
    icon: '🎼',
    category: 'Гаммы',
    defaultBpm: 90,
    defaultRepeats: 4,
    maxRepeats: 12,
    build: (r, o) => buildRising('major-scale', 'Мажорная гамма', scalePattern(MAJOR_SCALE), r, o),
  },
  {
    id: 'minor-scale',
    title: 'Минорная гамма',
    description: 'Натуральный минор вверх и вниз.',
    icon: '🌙',
    category: 'Гаммы',
    defaultBpm: 90,
    defaultRepeats: 4,
    maxRepeats: 12,
    build: (r, o) => buildRising('minor-scale', 'Минорная гамма', scalePattern(MINOR_SCALE), r, o),
  },
  {
    id: 'arpeggio',
    title: 'Арпеджио',
    description: 'Трезвучие с октавой: 1-3-5-8-5-3-1. Скачки без подъезда.',
    icon: '🪜',
    category: 'Гаммы',
    defaultBpm: 80,
    defaultRepeats: 6,
    maxRepeats: 16,
    build: (r, o) => buildRising('arpeggio', 'Арпеджио', scalePattern(ARPEGGIO), r, o),
  },
  {
    id: 'intervals',
    title: 'Интервалы',
    description: 'Слышишь опорную ноту — спой интервал от неё: терции, кварты, квинты, октавы.',
    icon: '👂',
    category: 'Слух',
    defaultBpm: 80,
    defaultRepeats: 4,
    maxRepeats: 10,
    build: buildIntervals,
  },
];

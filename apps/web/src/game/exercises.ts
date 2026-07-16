// Генераторы распевок и упражнений: строят SongMap под диапазон пользователя.

import { currentLang, t as tr } from '../lib/i18n';
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
  category: 'Warm-ups' | 'Scales' | 'Ear training' | 'Techniques';
  defaultBpm: number;
  defaultRepeats: number;
  maxRepeats: number;
  build: (range: VocalRange, opts: ExerciseOptions) => SongMap;
}

const SOLFEGE_RU = ['до', 'до#', 'ре', 'ре#', 'ми', 'фа', 'фа#', 'соль', 'соль#', 'ля', 'ля#', 'си'];
const SOLFEGE_EN = ['do', 'do#', 're', 're#', 'mi', 'fa', 'fa#', 'sol', 'sol#', 'la', 'la#', 'ti'];

function solfege(degreeSemitones: number): string {
  const tbl = currentLang() === 'ru' ? SOLFEGE_RU : SOLFEGE_EN;
  return tbl[((degreeSemitones % 12) + 12) % 12];
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
    subtitle: `${midiToName(root)} · ${opts.bpm} BPM`,
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
    { s: 3, name: tr('m3') },
    { s: 4, name: tr('M3') },
    { s: 5, name: tr('P4') },
    { s: 7, name: tr('P5') },
    { s: 12, name: tr('octave') },
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
    notes.push({ startMs: Math.round(t), durMs: Math.round(2 * beatMs * 0.92), midi: root, lyric: tr('root') });
    t += 2 * beatMs;
    notes.push({ startMs: Math.round(t), durMs: Math.round(2 * beatMs * 0.92), midi: root + iv.s, lyric: iv.name });
    t += 2 * beatMs + 2 * beatMs; // пауза перед следующей парой
  }
  const leadInMs = Math.round(4 * beatMs);
  const shifted = notes.map((n) => ({ ...n, startMs: n.startMs + leadInMs }));
  return {
    id: `intervals@${opts.bpm}x${opts.repeats}r${root}`,
    title: 'Intervals',
    subtitle: `${midiToName(root)} · ${opts.bpm} BPM`,
    durationMs: (shifted.at(-1)?.startMs ?? 0) + (shifted.at(-1)?.durMs ?? 0) + Math.round(2 * beatMs),
    notes: shifted,
    // синт играет только опорные ноты — целевую надо спеть по слуху
    guideEvents: shifted.filter((n) => n.lyric === tr('root')),
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
      notes.push({ startMs: Math.round(t), durMs: Math.round(stepMs), midi: m, lyric: 'u' });
      t += stepMs;
    }
    for (let m = zone.highMidi - 1; m >= zone.lowMidi; m--) {
      notes.push({ startMs: Math.round(t), durMs: Math.round(stepMs), midi: m, lyric: 'u' });
      t += stepMs;
    }
    t += stepMs * 4;
  }
  const leadInMs = 1500;
  const shifted = notes.map((n) => ({ ...n, startMs: n.startMs + leadInMs }));
  return {
    id: `siren@${opts.bpm}x${opts.repeats}`,
    title: 'Siren',
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
  const pattern: PatternStep[] = [0, 4, 7, 4, 0].map((s) => ({ semitone: s, beats: 4, lyric: 'a—' }));
  return buildRising('long-tones', 'Long tones', pattern, range, opts, 2);
}

/**
 * Удержание вибрато: длинная нота (~4 с), время в допуске идёт только
 * при активном вибрато (детектор ядра: ≥20 центов, 4–8 Гц). Perfect ≈
 * «держал вибрато ≥80% ноты», т.е. ≥3 с — приёмка этапа 6.
 */
function buildVibratoHold(range: VocalRange, opts: ExerciseOptions): SongMap {
  const zone = comfortZone(range);
  const beatMs = 60000 / opts.bpm;
  const holdMs = Math.max(3800, Math.round(4 * beatMs));
  const center = opts.rootMidi ?? Math.round((zone.lowMidi + zone.highMidi) / 2);
  const degrees = [0, 2, -2, 4]; // немного двигаемся между повторами
  const notes: MapNote[] = [];
  let t = 0;
  for (let rep = 0; rep < opts.repeats; rep++) {
    const midi = Math.min(zone.highMidi, Math.max(zone.lowMidi, center + degrees[rep % degrees.length]));
    notes.push({ startMs: Math.round(t), durMs: holdMs, midi, lyric: 'a〜', tech: 'vibrato' });
    t += holdMs + 2 * beatMs;
  }
  const leadInMs = Math.round(4 * beatMs);
  const shifted = notes.map((n) => ({ ...n, startMs: n.startMs + leadInMs }));
  return {
    id: `vibrato-hold@${opts.bpm}x${opts.repeats}r${center}`,
    title: 'Vibrato hold',
    subtitle: `${midiToName(center)} · ${opts.bpm} BPM`,
    durationMs: (shifted.at(-1)?.startMs ?? 0) + (shifted.at(-1)?.durMs ?? 0) + Math.round(2 * beatMs),
    notes: shifted,
    backing: { kind: 'synth', guideNotes: true },
    bpm: opts.bpm,
    leadInMs,
  };
}

export const EXERCISES: ExerciseDef[] = [
  {
    id: 'long-tones',
    title: 'Long tones',
    description: 'Hold a note for 4 beats, steady and clean. The base of breath support.',
    icon: '🫁',
    category: 'Warm-ups',
    defaultBpm: 70,
    defaultRepeats: 3,
    maxRepeats: 8,
    build: buildLongTones,
  },
  {
    id: 'siren',
    title: 'Siren',
    description: 'Smooth glissando from the bottom of your range to the top and back. Warms up the cords.',
    icon: '🚨',
    category: 'Warm-ups',
    defaultBpm: 90,
    defaultRepeats: 2,
    maxRepeats: 6,
    build: buildSiren,
  },
  {
    id: 'five-note',
    title: 'Five-note pattern',
    description: 'Do-re-mi-fa-sol-fa-mi-re-do, each repeat a semitone higher.',
    icon: '🎵',
    category: 'Warm-ups',
    defaultBpm: 100,
    defaultRepeats: 12,
    maxRepeats: 24,
    build: (r, o) => buildRising('five-note', 'Five-note pattern', MAJOR_FIVE, r, o),
  },
  {
    id: 'major-scale',
    title: 'Major scale',
    description: 'Full scale up and down. Accuracy on every degree.',
    icon: '🎼',
    category: 'Scales',
    defaultBpm: 90,
    defaultRepeats: 4,
    maxRepeats: 12,
    build: (r, o) => buildRising('major-scale', 'Major scale', scalePattern(MAJOR_SCALE), r, o),
  },
  {
    id: 'minor-scale',
    title: 'Minor scale',
    description: 'Natural minor up and down.',
    icon: '🌙',
    category: 'Scales',
    defaultBpm: 90,
    defaultRepeats: 4,
    maxRepeats: 12,
    build: (r, o) => buildRising('minor-scale', 'Minor scale', scalePattern(MINOR_SCALE), r, o),
  },
  {
    id: 'arpeggio',
    title: 'Arpeggio',
    description: 'Triad with the octave: 1-3-5-8-5-3-1. Clean jumps, no sliding.',
    icon: '🪜',
    category: 'Scales',
    defaultBpm: 80,
    defaultRepeats: 6,
    maxRepeats: 16,
    build: (r, o) => buildRising('arpeggio', 'Arpeggio', scalePattern(ARPEGGIO), r, o),
  },
  {
    id: 'intervals',
    title: 'Intervals',
    description: 'Hear the reference note, then sing the interval: thirds, fourths, fifths, octaves.',
    icon: '👂',
    category: 'Ear training',
    defaultBpm: 80,
    defaultRepeats: 4,
    maxRepeats: 10,
    build: buildIntervals,
  },
  {
    id: 'vibrato-hold',
    title: 'Vibrato hold',
    description: 'Hold a long note with vibrato — only the time with active vibrato counts.',
    icon: '〰️',
    category: 'Techniques',
    defaultBpm: 60,
    defaultRepeats: 4,
    maxRepeats: 8,
    build: buildVibratoHold,
  },
];

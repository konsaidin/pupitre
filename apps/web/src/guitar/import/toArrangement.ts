// Партитура alphaTab → аранжировки модели (§3.2) через конвертер fretfall: prepareScore → таймлайн (tickLookup) →
// songFromScore → для каждой партии со струнным станом — события на оси PerfTick, строй, капо, аккорды, формы руки,
// якоря, секции, фразы; плюс ноты ВСЕХ дорожек (ScoreNote) для автосведения. Каждое поле ноты конвертера разобрано в
// NOTE_FIELDS: техника, поле модели или явное «не судится» — реестр R-tech проверяет тест, N/N.
import * as alphaTab from '@coderline/alphatab';
import { createConverter, type FfChord, type FfScoreArrangement, type FfScoreNote } from '../vendor/fretfall/fromScore.js';
import { markRepeats, tuningName, tuningReference } from '../vendor/fretfall/music.js';
import { msToTick, type TempoMap } from '../model/tempo';
import {
  ARRANGEMENT_SCHEMA, CONVERTER_VERSION, type Anchor, type ArrangementRole, type BendPoint, type ChordTemplate,
  type GuitarArrangement, type HandShape, type ImportWarning, type InstrumentKind, type Phrase, type PhraseIteration,
  type ScoreEvent, type ScoreFormat, type ScoreNote, type Section, type TabNote, type Tech,
} from '../model/types';
import type { ParsedScore } from './parseScore';
import { buildTimeline, type BuiltTimeline } from './timeline';

type FieldRule =
  | { tech: (n: FfScoreNote) => Tech[] }
  | { model: string }
  | { notJudged: string };

const HARMONIC_TECH: Record<string, Tech> = {
  natural: 'harmonic', artificial: 'harmonicArtificial', pinch: 'harmonicPinch', tap: 'harmonicTap',
  semi: 'harmonicPinch', feedback: 'harmonic',
};
const when = (on: boolean, tech: Tech): Tech[] => (on ? [tech] : []);

/** Реестр R-tech: каждое поле ноты конвертера (FfScoreNote) — техника, поле модели или «не судится». */
export const NOTE_FIELDS: Record<keyof FfScoreNote, FieldRule> = {
  time: { model: 'ScoreEvent.tick' },
  duration: { model: 'TabNote.durTicks' },
  sustain: { model: 'TabNote.sustainTicks' },
  string: { model: 'TabNote.string' },
  fret: { model: 'TabNote.fret' },
  chord: { model: 'ScoreEvent.chordId' },
  realValue: { model: 'TabNote.midi (alphaTab учитывает капо, строй, транспозицию и флажолет)' },
  harmonicValue: { model: 'учтено в realValue' },
  slideLegato: { model: 'ScoreEvent.attack следующей ноты на струне' },
  barIndex: { model: 'ScoreEvent.bar' },
  passIndex: { model: 'ScoreEvent.occ' },
  finger: { model: 'TabNote.finger' },
  rightFinger: { model: 'TabNote.rightFinger' },
  hammerOn: { tech: (n) => when(n.hammerOn, 'hammerOn') },
  pullOff: { tech: (n) => when(n.pullOff, 'pullOff') },
  tap: { tech: (n) => when(n.tap, 'tap') },
  tapLeft: { tech: (n) => when(n.tapLeft, 'tapLeft') },
  slideTo: { tech: (n) => when(n.slideTo !== null, 'slide') },
  // У alphaTab-конвертера всегда null (поле форматов-источников); правило — на будущие форматы.
  slideUnpitchTo: { tech: (n) => when(n.slideUnpitchTo !== null, 'slideUnpitched') },
  slideIn: { tech: (n) => when(n.slideIn !== null, 'slideIn') },
  slideOut: { tech: (n) => when(n.slideOut !== null, 'slideOut') },
  bend: { tech: (n) => when(n.bend > 0, 'bend') },
  bendCurve: {
    tech: (n) => {
      const c = n.bendCurve;
      if (!c?.length) return [];
      const peak = Math.max(...c.map(([, v]) => v));
      return [...when(c[0][1] > 0, 'prebend'), ...when(peak > 0 && c.at(-1)![1] < peak, 'release')];
    },
  },
  whammy: { tech: (n) => when(n.whammy !== null, 'whammy') },
  harmonicType: { tech: (n) => (n.harmonicType ? [HARMONIC_TECH[n.harmonicType]] : []) },
  harmonic: { model: 'дублирует harmonicType' },
  harmonicPinch: { model: 'дублирует harmonicType' },
  palmMute: { tech: (n) => when(n.palmMute, 'palmMute') },
  mute: { tech: (n) => when(n.mute, 'dead') },
  ghost: { tech: (n) => when(n.ghost, 'ghost') },
  staccato: { tech: (n) => when(n.staccato, 'staccato') },
  letRing: { tech: (n) => when(n.letRing, 'letRing') },
  accent: { tech: (n) => when(n.accent === 'accent' || n.accent === 'heavy', 'accent') },
  // Широкое вибрато приходит с обоими флагами — техника одна.
  vibrato: { tech: (n) => when(n.vibrato && !n.vibratoWide, 'vibrato') },
  vibratoWide: { tech: (n) => when(n.vibratoWide, 'vibratoWide') },
  trill: { tech: (n) => when(n.trill !== null, 'trill') },
  tremolo: { tech: (n) => when(n.tremolo, 'tremoloPicking') },
  grace: { tech: (n) => when(n.grace, 'grace') },
  slap: { tech: (n) => when(n.slap, 'slap') },
  pop: { tech: (n) => when(n.pop, 'pop') },
  dynamic: { notJudged: 'громкость не оценивается' },
  ornament: { notJudged: 'мелизм рисуется, высота судится по основной ноте' },
  golpe: { notJudged: 'удар по деке — без высоты' },
  rasgueado: { notJudged: 'приём правой руки, судится как аккорд' },
  fade: { notJudged: 'громкость не оценивается' },
  wah: { notJudged: 'эффект педали' },
  fermata: { notJudged: 'длина ферматы — дело исполнения' },
  pick: { notJudged: 'направление медиатора не судится' },
  showString: { notJudged: 'подсказка нотной записи' },
  repeat: { notJudged: 'поле помощника дорожки (markRepeats)' },
  heldFrom: { notJudged: 'поле помощника дорожки (markRepeats)' },
  tieTo: { notJudged: 'поле помощника дорожки (annotate)' },
  tied: { notJudged: 'поле помощника дорожки (annotate)' },
  slideSpan: { notJudged: 'поле помощника дорожки (annotate)' },
  dynamicLabel: { notJudged: 'поле помощника дорожки (annotate)' },
  linkNext: { notJudged: 'поле форматов-источников; лиги alphaTab уже слиты' },
};

export function techsOf(n: FfScoreNote): Tech[] {
  const out = new Set<Tech>();
  for (const rule of Object.values(NOTE_FIELDS)) if ('tech' in rule) for (const t of rule.tech(n)) out.add(t);
  return [...out];
}

export interface ConvertedScore {
  songId: string;
  title: string;
  artist: string;
  album?: string;
  arrangements: GuitarArrangement[];
  /** Ноты всех дорожек, вкл. ударные — вход автосведения (этап 23). */
  scoreNotes: ScoreNote[];
  warnings: ImportWarning[];
  built: BuiltTimeline;
}

const GUITAR_PROGRAMS = { min: 24, max: 31 };
const BASS_PROGRAMS = { min: 32, max: 39 };
export function instrumentOf(a: Pick<FfScoreArrangement, 'name' | 'program' | 'open'>): InstrumentKind {
  if (/bass|бас/i.test(a.name)) return 'bass';
  if (a.program >= BASS_PROGRAMS.min && a.program <= BASS_PROGRAMS.max) return 'bass';
  if (a.program >= GUITAR_PROGRAMS.min && a.program <= GUITAR_PROGRAMS.max) return 'guitar';
  return a.open[0] < 33 ? 'bass' : 'guitar'; // ниже A1 — басовый строй
}
export function roleOf(name: string, instrument: InstrumentKind): ArrangementRole {
  if (instrument === 'bass') return 'bass';
  if (/lead|solo|соло/i.test(name)) return 'lead';
  if (/rhythm|ритм/i.test(name)) return 'rhythm';
  return 'combo';
}

// Тики из секунд конвертера: тот же tickLookup, поэтому обратимо; округление гасит погрешность плавающей точки.
const tickOf = (tempo: TempoMap, sec: number) => Math.round(msToTick(tempo, sec * 1000) * 1000) / 1000;
const nullable = (values: number[]) => values.map((v) => (v < 0 ? null : v));
const SAME_TIME = 0.0005; // с: ноты с общим стартом — одно событие

export function convertScore(parsed: ParsedScore, meta: { format: ScoreFormat; fileSha256: string }): ConvertedScore {
  const { score, settings } = parsed;
  const songId = meta.fileSha256.slice(0, 16);
  const converter = createConverter(alphaTab);
  converter.prepareScore(score);
  const built = buildTimeline(score, settings);
  const song = converter.songFromScore(score, built.tickLookup);
  const warnings: ImportWarning[] = [...parsed.warnings];
  if (built.timeline.synthShiftTicks > 0)
    warnings.push({ code: 'grace-shift', detail: `форшлаг до первой доли сдвигает синт на ${built.timeline.synthShiftTicks} тиков` });

  const arrangements: GuitarArrangement[] = [];
  for (const a of song.arrangements) {
    if (!a.notes.length) {
      warnings.push({ code: 'empty-track', detail: `дорожка «${a.name}» без нот` });
      continue;
    }
    const staff = score.tracks[a.trackIndex].staves[a.staffIndex];
    arrangements.push(toArrangement(a, { songId, built, meta, staff, warnings: parsed.warnings, encoding: parsed.encoding }));
  }
  return {
    songId, title: score.title || song.title || '', artist: score.artist || song.artist || '',
    ...(score.album ? { album: score.album } : {}),
    arrangements, scoreNotes: scoreNotesOf(score, built), warnings, built,
  };
}

interface Ctx {
  songId: string;
  built: BuiltTimeline;
  meta: { format: ScoreFormat; fileSha256: string };
  staff: alphaTab.model.Staff;
  warnings: ImportWarning[];
  encoding: string;
}

function toArrangement(a: FfScoreArrangement, ctx: Ctx): GuitarArrangement {
  const { built } = ctx;
  const tempo = built.tempo;
  const tick = (sec: number) => tickOf(tempo, sec);
  const instrument = instrumentOf(a);
  const capo = a.capos.find((c) => c.time === 0)?.fret ?? 0;
  const ref = tuningReference(a.open);

  // Аккорды конвертера — по одному на удар; шаблоны модели — уникальные (имя, лады).
  const chords: ChordTemplate[] = [];
  const templateOf = new Map<string, number>();
  const chordIdOf = (c: Pick<FfChord, 'name' | 'frets' | 'fingers' | 'barre'>) => {
    const key = `${c.name}|${c.frets.join()}`;
    let id = templateOf.get(key);
    if (id === undefined) {
      id = chords.length;
      templateOf.set(key, id);
      chords.push({
        id, name: c.name, displayName: c.name, frets: nullable(c.frets), fingers: nullable(c.fingers),
        barre: c.barre ? { fret: c.barre.fret, from: c.barre.from, to: c.barre.to } : null,
        source: c.name ? 'file' : 'none',
      });
    }
    return id;
  };
  // Повтор аккорда подряд — markRepeats fretfall на копии без полей патчей (они ломают сравнение нот).
  const plain = a.notes.map(({ realValue, harmonicValue, slideLegato, barIndex, passIndex, duration, ...n }) => ({ ...n }));
  const plainChords = a.chords.map((c) => ({ ...c, notes: [...c.notes] }));
  markRepeats(plain, plainChords);

  const handShapes: HandShape[] = a.handShapes.map((h, id) => ({
    id, fromTick: tick(h.startTime), toTick: tick(h.endTime), arpeggio: !!h.arpeggio,
    chordId: chordIdOf(a.chords.find((c) => c.frets.join() === h.frets.join()) ?? { name: h.name, frets: h.frets, fingers: h.fingers }),
  }));

  const events: ScoreEvent[] = [];
  const lastOnString = new Map<number, FfScoreNote>();
  for (let i = 0; i < a.notes.length; ) {
    let j = i + 1;
    while (j < a.notes.length && a.notes[j].time - a.notes[i].time < SAME_TIME) j++;
    const group = a.notes.slice(i, j);
    const t = tick(group[0].time);
    const notes: TabNote[] = group.map((n) => tabNote(n, tick, a.open[n.string] + capo));
    const legato = group.every((n) => {
      const prev = lastOnString.get(n.string);
      return n.hammerOn || n.pullOff || n.tap || (!!prev?.slideLegato && prev.slideTo === n.fret);
    });
    for (const n of group) lastOnString.set(n.string, n);
    const chord = group.find((n) => n.chord !== null)?.chord ?? null;
    const chordId = chord !== null ? chordIdOf(a.chords[chord]) : undefined;
    const shape = handShapes.findIndex((h) => h.fromTick <= t + 1e-6 && t < h.toTick - 1e-6);
    const fc = chord !== null ? a.chords[chord] : null;
    // Глушение и PM на аккорде — техники его нот.
    if (fc?.fretHandMute) for (const n of notes) if (!n.techs.includes('fretHandMute')) n.techs.push('fretHandMute');
    if (fc?.palmMute) for (const n of notes) if (!n.techs.includes('palmMute')) n.techs.push('palmMute');
    events.push({
      id: events.length, tick: t, bar: group[0].barIndex, occ: group[0].passIndex, notes,
      kind: group.length === 1 ? 'note' : group.length === 2 ? 'doublestop' : 'chord',
      attack: legato ? 'legato' : 'pick',
      ...(chordId !== undefined ? { chordId } : {}),
      ...(shape >= 0 ? { handShapeId: handShapes[shape].id } : {}),
      ...(fc?.strum ? { strum: fc.strum } : {}),
      ...(shape >= 0 && handShapes[shape].arpeggio ? { arpeggio: true } : {}),
      ...(chord !== null && plainChords[chord].highDensity ? { repeatOfPrev: true } : {}),
    });
    i = j;
  }

  const end = built.timeline.durationTicks;
  const sections: Section[] = a.sections.map((s, i) => ({
    name: s.name, fromTick: tick(s.time), toTick: i + 1 < a.sections.length ? tick(a.sections[i + 1].time) : end, source: 'marker',
  }));
  const phraseIds = new Map<string, number>();
  const phrases: Phrase[] = [];
  const phraseIterations: PhraseIteration[] = a.phrases.map((p, index) => {
    let phraseId = phraseIds.get(p.name);
    if (phraseId === undefined) {
      phraseId = phrases.length;
      phraseIds.set(p.name, phraseId);
      phrases.push({ id: phraseId, name: p.name, maxLevel: 0, kind: 'normal' });
    }
    const fromTick = tick(p.time), toTick = tick(p.endTime);
    return {
      index, phraseId, fromTick, toTick, heroLevels: { easy: 0, medium: 0, hard: 0 },
      eventsAtMax: events.filter((e) => e.tick >= fromTick && e.tick < toTick).length,
    };
  });
  const anchors: Anchor[] = a.anchors.map((x) => ({ fromTick: tick(x.time), toTick: tick(x.endTime), fret: x.fret, width: x.width, source: 'auto' }));

  const frets = events.flatMap((e) => e.notes.map((n) => n.fret)).filter((f) => f > 0);
  const techniques = [...new Set(events.flatMap((e) => e.notes.flatMap((n) => n.techs)))];
  const fingeredInFile = ctx.staff.bars.some((bar) => bar.voices.some((v) => v.beats.some((b) => b.notes.some((n) => n.leftHandFinger >= 0))));
  const warnings: ImportWarning[] = [...ctx.warnings];
  if (!fingeredInFile) warnings.push({ code: 'fingering-auto', detail: 'аппликатура рассчитана (в файле её нет)' });
  const unjudged = a.notes.filter((n) => n.ornament || n.golpe || n.rasgueado || n.wah || n.fade).length;
  if (unjudged) warnings.push({ code: 'unsupported-technique', detail: 'мелизмы, golpe, rasgueado, wah, fade — рисуются, не оцениваются', count: unjudged });

  return {
    schema: ARRANGEMENT_SCHEMA,
    id: `${ctx.songId}:${a.trackIndex}:${a.staffIndex}`,
    songId: ctx.songId, trackIndex: a.trackIndex, staffIndex: a.staffIndex, name: a.name,
    instrument, role: roleOf(a.name, instrument), program: a.program,
    strings: a.strings,
    tuning: { openMidi: [...a.open], name: tuningName(a.open), offsets: ref?.shift ?? a.open.map(() => 0) },
    capo, timeline: built.timeline, events, chords, handShapes, anchors, sections, phrases, phraseIterations,
    properties: {
      techniques, chordCount: chords.length,
      fretRange: frets.length ? [Math.min(...frets), Math.max(...frets)] : [0, 0], maxLevel: 0,
    },
    source: {
      format: ctx.meta.format, fileSha256: ctx.meta.fileSha256, converterVersion: CONVERTER_VERSION,
      ...(ctx.encoding !== 'utf-8' ? { encoding: ctx.encoding } : {}),
      fingering: fingeredInFile ? 'file' : 'auto', durations: 'notated', warnings,
    },
  };
}

// openWithCapo — MIDI открытой струны с капо: апстрим отдаёт трель MIDI-высотой, поднятой на капо (см. fromScore.d.ts).
function tabNote(n: FfScoreNote, tick: (sec: number) => number, openWithCapo: number): TabNote {
  const from = tick(n.time);
  const note: TabNote = {
    string: n.string, fret: n.fret, midi: n.realValue,
    durTicks: tick(n.time + n.duration) - from,
    sustainTicks: n.sustain > 0 ? tick(n.time + n.sustain) - from : 0,
    techs: techsOf(n),
  };
  // Позиции точек — с округлением: GP7 хранит их иначе, чем alphaTex, и даёт шум в 16-м знаке.
  if (n.bendCurve?.length) note.bend = n.bendCurve.map(([at, tones]): BendPoint => ({ at: Math.round(at * 1e6) / 1e6, cents: Math.round(tones * 200) }));
  if (n.slideTo !== null) note.slideToFret = n.slideTo;
  if (n.slideIn) note.slideInFrom = n.slideIn;
  if (n.slideOut) note.slideOutTo = n.slideOut;
  if (n.whammy?.length) note.whammy = n.whammy.map(([at, tones]): BendPoint => ({ at: Math.round(at * 1e6) / 1e6, cents: Math.round(tones * 200) }));
  if (n.trill !== null) note.trillFret = n.trill - openWithCapo;
  if (n.harmonicType) note.harmonic = n.harmonicType;
  if (n.finger !== null) note.finger = n.finger as TabNote['finger'];
  if (n.rightFinger) note.rightFinger = n.rightFinger;
  return note;
}

// Ноты всех дорожек из того же MidiFile: NoteOn/NoteOff парами по (канал, высота); тики MIDI сдвинуты на tickShift.
function scoreNotesOf(score: alphaTab.model.Score, built: BuiltTimeline): ScoreNote[] {
  const shift = built.timeline.synthShiftTicks;
  const trackOf = new Map<number, number>();
  const drums = new Set<number>();
  for (const track of score.tracks) {
    trackOf.set(track.playbackInfo.primaryChannel, track.index);
    trackOf.set(track.playbackInfo.secondaryChannel, track.index);
    if (track.staves.some((s) => s.isPercussion)) drums.add(track.index);
  }
  const open = new Map<string, number[]>();
  const out: ScoreNote[] = [];
  const { NoteOn, NoteOff } = alphaTab.midi.MidiEventType;
  for (const e of built.midiFile.events as Array<alphaTab.midi.MidiEvent & { channel?: number; noteKey?: number; noteVelocity?: number }>) {
    if (e.type !== NoteOn && e.type !== NoteOff) continue;
    const key = `${e.channel}:${e.noteKey}`;
    if (e.type === NoteOn && (e.noteVelocity ?? 1) > 0) {
      (open.get(key) ?? open.set(key, []).get(key)!).push(e.tick);
      continue;
    }
    const start = open.get(key)?.shift();
    if (start === undefined) continue;
    const track = trackOf.get(e.channel ?? -1) ?? -1;
    out.push({ tick: start - shift, durTicks: e.tick - start, midi: e.noteKey ?? 0, track, drum: e.channel === 9 || drums.has(track) });
  }
  return out.sort((x, y) => x.tick - y.tick || x.track - y.track || x.midi - y.midi);
}

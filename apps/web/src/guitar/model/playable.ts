// Играбельная карта (§3.4; этап 11): аранжировка + исполнение → TabMap для движка, дорожки и HUD. Синт:
// мс = (synthShiftMs + мс партитуры(tick)) / speed + leadInMs — рендер минуса сдвинут на tickShift форшлага до первой
// доли. Запись (этап 23) — интерполяция опорных точек SyncMap. Уровни — заготовка (max) до этапа 36. Правки
// аппликатуры пользователя (userEdits, ключ `${tick}:${midi}`) подменяют струну и лад.
import { tempoMapOf, tickToMs } from './tempo';
import type {
  GuitarArrangement, LevelSelection, PlayNote, Rendition, ScoreEvent, TabEvent, TabMap, TabMapBar, TabNote,
} from './types';

export function buildPlayableMap(arr: GuitarArrangement, r: Rendition, levels: LevelSelection = { mode: 'max' }): TabMap {
  if (r.kind !== 'synth') throw Error('Исполнение под запись — этап 23');
  if (levels.mode !== 'max') throw Error('Уровни сложности — этап 36');
  const tempo = tempoMapOf(arr.timeline.tempos);
  const shiftMs = tickToMs(tempo, arr.timeline.synthShiftTicks);
  const ms = (tick: number) => (shiftMs + tickToMs(tempo, tick)) / r.speed + r.leadInMs;
  const edits = arr.userEdits?.fingering ?? {};

  const bars: TabMapBar[] = arr.timeline.bars.map((b) => ({
    index: b.index, occ: b.occ, item: 0, startMs: ms(b.fromTick), endMs: ms(b.toTick), num: b.num, den: b.den,
  }));
  // Форшлаг до первой доли звучит раньше первого такта: такт растягивается назад, чтобы событие лежало в нём.
  const firstEvent = arr.events[0];
  if (bars.length && firstEvent && ms(firstEvent.tick) < bars[0].startMs) bars[0].startMs = Math.max(0, ms(firstEvent.tick));
  const edge = (tick: number) => (bars.length && tick <= arr.timeline.bars[0].fromTick ? bars[0].startMs : ms(tick));

  const iterOf = (tick: number) => {
    const i = arr.phraseIterations.findIndex((p) => tick >= p.fromTick && tick < p.toTick);
    return i < 0 ? 0 : i;
  };
  const notes: TabEvent[] = arr.events.map((e) => tabEvent(e, ms, edits, iterOf(e.tick)));
  notes.sort((a, b) => a.startMs - b.startMs || a.eventId - b.eventId);

  return {
    kind: 'tab',
    id: arr.id,
    title: arr.name,
    durationMs: ms(arr.timeline.durationTicks),
    notes,
    backing: { kind: 'buffer' },
    bpm: arr.timeline.tempos[0]?.bpm,
    arrangementId: arr.id,
    instrument: arr.instrument,
    strings: arr.strings,
    tuning: arr.tuning,
    capo: arr.capo,
    chords: arr.chords,
    handShapes: arr.handShapes.map((h) => ({ id: h.id, chordId: h.chordId, startMs: ms(h.fromTick), endMs: ms(h.toTick), arpeggio: h.arpeggio })),
    sections: arr.sections.map((s) => ({ name: s.name, item: 0, startMs: edge(s.fromTick), endMs: ms(s.toTick) })),
    bars,
    beats: arr.timeline.beats.map((b) => ({ ms: edge(b.tick), downbeat: b.downbeat, bar: b.bar })),
    phrases: arr.phraseIterations.map((p) => {
      const phrase = arr.phrases[p.phraseId];
      return { iter: p.index, phraseId: p.phraseId, name: phrase?.name ?? '', startMs: edge(p.fromTick), endMs: ms(p.toTick), level: phrase?.maxLevel ?? 0, maxLevel: phrase?.maxLevel ?? 0 };
    }),
    anchorsMs: arr.anchors.map((a) => ({ startMs: edge(a.fromTick), endMs: ms(a.toTick), fret: a.fret, width: a.width })),
    refA4Hz: 440,
    speed: r.speed,
  };
}

const JUDGE: Record<ScoreEvent['attack'], TabEvent['judge']> = { pick: 'attack', legato: 'legato', tie: 'tie' };

function tabEvent(e: ScoreEvent, ms: (tick: number) => number, edits: Record<string, { string: number; fret: number }>, phraseIter: number): TabEvent {
  const startMs = ms(e.tick);
  const notes: PlayNote[] = e.notes
    .filter((n) => !n.ignore)
    .map((n): PlayNote => {
      const edit = edits[`${e.tick}:${n.midi}`];
      const note: TabNote = edit ? { ...n, string: edit.string, fret: edit.fret } : n;
      return {
        ...note,
        startMs,
        durMs: ms(e.tick + n.durTicks) - startMs,
        sustainMs: n.sustainTicks > 0 ? ms(e.tick + n.sustainTicks) - startMs : 0,
      };
    });
  const durMs = Math.max(...notes.map((n) => n.durMs), 0);
  return {
    startMs, durMs, midi: Math.min(...notes.map((n) => n.midi)),
    eventId: e.id, item: 0, phraseIter, bar: e.bar, occ: e.occ,
    kind: e.kind, attack: e.attack,
    ...(e.chordId !== undefined ? { chordId: e.chordId } : {}),
    ...(e.handShapeId !== undefined ? { handShapeId: e.handShapeId } : {}),
    ...(e.strum ? { strum: e.strum } : {}),
    ...(e.arpeggio ? { arpeggio: true } : {}),
    ...(e.repeatOfPrev ? { repeatOfPrev: true } : {}),
    notes,
    judge: notes.length ? JUDGE[e.attack] : 'none',
    windowScale: 1,
  };
}

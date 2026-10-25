// Играбельная карта (TabMap, §3.4) → партия fretfall, как её рисует highway.js: секунды, лады абсолютные, струна 0 —
// нижняя, капо [{time: 0, fret}], аккорды (по одному на удар — как у конвертера), формы руки, якоря, доли, фразы, секции.
// Карты индексов «нота fretfall ↔ (событие, нота события)» — для статусов судьи и DOM-слоёв. Помощники fretfall
// (markRepeats, annotate, markArpeggios) вызываются один раз на карту. Отклик судьи: setVerdict пишет статусы нот события
// и подробности (смещение, услышанная высота), stampStatuses в кадре дорожки отмечает, когда статус сменился.
import type { FfChord, FfHandShape, FfNote } from '../vendor/fretfall/fromScore.js';
import { STATUS, type FfDrawArrangement } from '../vendor/fretfall/highway.js';
import { annotate, markArpeggios, markRepeats } from '../vendor/fretfall/music.js';
import type { PlayNote, TabEvent, TabMap } from '../model/types';

export interface AdaptedMap {
  arr: FfDrawArrangement & { status: Uint8Array; statusAt: Float64Array };
  /** Нота fretfall i → [индекс события в map.notes, индекс ноты в событии]. */
  fromFf: Int32Array;
  /** Событие → индексы его нот в arr.notes. */
  ffOfEvent: number[][];
  /** Высота ноты fretfall (MIDI) — для «+1 лад» у не той ноты. */
  midi: Float32Array;
  /** Вердикт события: смещение удара, мс, и услышанная высота (NaN — нет). */
  offsetMs: Float32Array;
  heardMidi: Float32Array;
  /** Статус ноты, который уже видела дорожка: смена → arr.statusAt. */
  seen: Uint8Array;
}

const has = (n: PlayNote, tech: PlayNote['techs'][number]) => n.techs.includes(tech);

function ffNote(n: PlayNote, event: TabEvent): FfNote {
  const bendCurve = n.bend?.length ? (n.bend.map((p) => [p.at, p.cents / 200]) as Array<[number, number]>) : null;
  return {
    time: n.startMs / 1000,
    sustain: n.sustainMs / 1000,
    string: n.string,
    fret: n.fret,
    chord: null,
    hammerOn: has(n, 'hammerOn'),
    pullOff: has(n, 'pullOff'),
    slideTo: n.slideToFret ?? null,
    slideUnpitchTo: null,
    slideIn: n.slideInFrom ?? (has(n, 'slideIn') ? 'below' : null),
    slideOut: n.slideOutTo ?? (has(n, 'slideOut') ? 'down' : null),
    bend: bendCurve ? Math.max(...bendCurve.map(([, v]) => v)) : has(n, 'bend') ? 1 : 0,
    bendCurve,
    whammy: n.whammy?.length ? (n.whammy.map((p) => [p.at, p.cents / 200]) as Array<[number, number]>) : null,
    harmonic: n.harmonic === 'natural' || n.harmonic === 'feedback',
    harmonicPinch: n.harmonic === 'pinch' || n.harmonic === 'semi',
    harmonicType: n.harmonic ?? null,
    palmMute: has(n, 'palmMute'),
    mute: has(n, 'dead'),
    ghost: has(n, 'ghost'),
    staccato: has(n, 'staccato'),
    letRing: has(n, 'letRing'),
    accent: has(n, 'accent') ? 'accent' : null,
    dynamic: 'mf',
    vibrato: has(n, 'vibrato') || has(n, 'vibratoWide'),
    vibratoWide: has(n, 'vibratoWide'),
    trill: n.trillFret ?? null,
    ornament: null,
    grace: has(n, 'grace'),
    tremolo: has(n, 'tremoloPicking'),
    tap: has(n, 'tap'),
    tapLeft: has(n, 'tapLeft'),
    slap: has(n, 'slap'),
    pop: has(n, 'pop'),
    golpe: null,
    rasgueado: null,
    fade: null,
    wah: null,
    fermata: false,
    pick: event.notes.length === 1 && event.strum ? event.strum : null,
    showString: false,
    finger: n.finger ?? null,
    rightFinger: n.rightFinger ?? null,
  };
}

export function adaptMap(map: TabMap): AdaptedMap {
  const rows: Array<{ note: FfNote; ev: number; idx: number }> = [];
  map.notes.forEach((e, ev) => e.notes.forEach((n, idx) => rows.push({ note: ffNote(n, e), ev, idx })));
  rows.sort((a, b) => a.note.time - b.note.time || a.note.string - b.note.string);
  const notes = rows.map((r) => r.note);
  const fromFf = new Int32Array(rows.length * 2);
  const ffOfEvent: number[][] = map.notes.map(() => []);
  rows.forEach((r, i) => {
    fromFf[i * 2] = r.ev;
    fromFf[i * 2 + 1] = r.idx;
    ffOfEvent[r.ev].push(i);
  });

  // Аккорд fretfall — на каждый удар аккордом (рамка, повтор, глушение), как делает конвертер.
  const templates = new Map(map.chords.map((c) => [c.id, c]));
  const chords: FfChord[] = [];
  map.notes.forEach((e, ev) => {
    if (e.chordId === undefined || e.notes.length < 2) return;
    const tpl = templates.get(e.chordId);
    const frets = Array.from({ length: map.strings }, () => -1);
    const fingers = Array.from({ length: map.strings }, () => -1);
    for (const n of e.notes) {
      frets[n.string] = n.fret;
      fingers[n.string] = n.finger ?? tpl?.fingers[n.string] ?? -1;
    }
    const idx = chords.length;
    for (const i of ffOfEvent[ev]) notes[i].chord = idx;
    chords.push({
      time: e.startMs / 1000, name: tpl?.name ?? '', notes: [...ffOfEvent[ev]], frets, fingers, highDensity: false,
      palmMute: e.notes.every((n) => has(n, 'palmMute')), fretHandMute: e.notes.every((n) => has(n, 'fretHandMute')),
      accent: null, strum: e.strum ?? null, roll: null,
      ...(tpl?.barre ? { barre: { fret: tpl.barre.fret, from: tpl.barre.from, to: tpl.barre.to } } : {}),
    });
  });
  const handShapes: FfHandShape[] = map.handShapes.map((h) => {
    const tpl = templates.get(h.chordId);
    return {
      startTime: h.startMs / 1000, endTime: h.endMs / 1000, name: tpl?.name ?? '',
      frets: tpl?.frets.map((f) => f ?? -1) ?? [], fingers: tpl?.fingers.map((f) => f ?? -1) ?? [], ...(h.arpeggio ? { arpeggio: true } : {}),
    };
  });

  markRepeats(notes, chords);
  annotate(notes, chords);
  markArpeggios(notes, handShapes);

  const arr: AdaptedMap['arr'] = {
    name: map.title, program: map.instrument === 'bass' ? 33 : 25, strings: map.strings, open: [...map.tuning.openMidi],
    notes, chords,
    anchors: map.anchorsMs.map((a) => ({ time: a.startMs / 1000, endTime: a.endMs / 1000, fret: a.fret, width: a.width })),
    phrases: map.phrases.map((p) => ({ time: p.startMs / 1000, endTime: p.endMs / 1000, name: p.name, maxDifficulty: p.maxLevel })),
    sections: map.sections.map((s) => ({ time: s.startMs / 1000, name: s.name })),
    beats: map.beats.map((b) => ({ time: b.ms / 1000, measure: b.downbeat ? b.bar + 1 : -1 })),
    handShapes, markers: [], hairpins: [], rhythm: [], meters: [], keys: [],
    capos: map.capo ? [{ time: 0, fret: map.capo }] : [], lyrics: [],
    status: new Uint8Array(notes.length),
    statusAt: new Float64Array(notes.length).fill(NaN),
  };
  const midi = Float32Array.from(rows, (r) => map.notes[r.ev].notes[r.idx].midi);
  const events = map.notes.length;
  return {
    arr, fromFf, ffOfEvent, midi,
    offsetMs: new Float32Array(events).fill(NaN), heardMidi: new Float32Array(events).fill(NaN), seen: new Uint8Array(notes.length),
  };
}

/** Вердикт события (код STATUS) → статусы его нот и подробности для слоя вердиктов. */
export function setVerdict(a: AdaptedMap, event: number, code: number, offsetMs = NaN, heardMidi = NaN): void {
  for (const ff of a.ffOfEvent[event]) a.arr.status[ff] = code;
  a.offsetMs[event] = offsetMs;
  a.heardMidi[event] = heardMidi;
}

/** Окно отметки вокруг кадра, с: вердикт приходит до ≈ 1 с после ноты, «удар замечен» — до её начала. */
const STAMP_BACK_S = 2.5;
const STAMP_AHEAD_S = 0.5;

/** Первая нота не раньше time (ноты — по времени). */
export function firstNoteAt(notes: ReadonlyArray<{ time: number }>, time: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Отметить, когда сменились статусы нот рядом с now (секунды песни кадра дорожки): от этого момента дорожка ведёт
 * вспышки и гашение промахов, слой вердиктов — подписи. Сброс в «ждёт» (перемотка) — NaN. Без аллокаций.
 */
export function stampStatuses(a: AdaptedMap, now: number): void {
  const { notes, status, statusAt } = a.arr;
  for (let i = firstNoteAt(notes, now - STAMP_BACK_S); i < notes.length && notes[i].time <= now + STAMP_AHEAD_S; i++) {
    if (status[i] === a.seen[i]) continue;
    a.seen[i] = status[i];
    statusAt[i] = status[i] === STATUS.none ? NaN : now;
  }
}

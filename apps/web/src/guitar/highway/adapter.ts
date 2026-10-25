// Играбельная карта (TabMap, §3.4) → партия fretfall, как её рисует highway.js: секунды, лады абсолютные, струна 0 —
// нижняя, капо [{time: 0, fret}], аккорды (по одному на удар — как у конвертера), формы руки, якоря, доли, фразы, секции.
// Карты индексов «нота fretfall ↔ (событие, нота события)» — для статусов судьи и DOM-слоёв. Помощники fretfall
// (markRepeats, annotate, markArpeggios) вызываются один раз на карту.
import type { FfChord, FfHandShape, FfNote } from '../vendor/fretfall/fromScore.js';
import type { FfDrawArrangement } from '../vendor/fretfall/highway.js';
import { annotate, markArpeggios, markRepeats } from '../vendor/fretfall/music.js';
import type { PlayNote, TabEvent, TabMap } from '../model/types';

export interface AdaptedMap {
  arr: FfDrawArrangement & { status: Uint8Array };
  /** Нота fretfall i → [индекс события в map.notes, индекс ноты в событии]. */
  fromFf: Int32Array;
  /** Событие → индексы его нот в arr.notes. */
  ffOfEvent: number[][];
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
  };
  return { arr, fromFf, ffOfEvent };
}

// Типы к fromScore.js — вырезке конвертера fretfall (player.js @ ed2bc3b, MIT) с патчами Пюпитра (VENDOR.md).
// Типы — по факту исходника: какие поля и значения songFromScore реально пишет. Время — секунды песни,
// струна 0 — НИЖНЯЯ (alphaTab note.string 1 → 0), лады — абсолютные на грифе (поднятые на капо стана).
import type * as AlphaTab from '@coderline/alphatab';
import type { FfTempoPoint } from './music.js';

/** Точки `[доля длительности ноты 0..1, тоны]` (1 = целый тон, 0.5 = полутон) — `curve()` из player.js. */
export type FfCurve = Array<[number, number]>;

export type FfHarmonic = 'natural' | 'artificial' | 'pinch' | 'tap' | 'semi' | 'feedback';

/**
 * Нота, как её читают дорожка (highway.js) и помощники music.js. Обязательные поля пишет songFromScore;
 * необязательные дописывают markRepeats/annotate/markArpeggios (и форматы-источники кроме alphaTab).
 */
export interface FfNote {
  time: number;
  /** 0, если нота короче 0.4 с и без слайда/бенда; лиги (tie) слиты в исходную ноту. */
  sustain: number;
  /** 0 — нижняя струна. */
  string: number;
  /** Абсолютный лад: лады GP (от капо) подняты на капо стана; открытая струна остаётся 0. */
  fret: number;
  /** Индекс аккорда в `chords` или null. */
  chord: number | null;
  hammerOn: boolean;
  pullOff: boolean;
  slideTo: number | null;
  /** У alphaTab всегда null (поле форматов-источников). */
  slideUnpitchTo: number | null;
  slideIn: 'below' | 'above' | null;
  slideOut: 'up' | 'down' | null;
  /** Наибольший подъём бенда в тонах (1 = целый тон; 0 — без бенда). */
  bend: number;
  bendCurve: FfCurve | null;
  whammy: FfCurve | null;
  /** Флажолет кроме pinch. */
  harmonic: boolean;
  harmonicPinch: boolean;
  harmonicType: FfHarmonic | null;
  palmMute: boolean;
  mute: boolean;
  ghost: boolean;
  staccato: boolean;
  letRing: boolean;
  accent: 'accent' | 'heavy' | 'tenuto' | null;
  /** Имя динамики alphaTab строчными: 'f', 'mf', 'ppp'… */
  dynamic: string;
  vibrato: boolean;
  vibratoWide: boolean;
  /**
   * MIDI-высота трели alphaTab (`Note.trillValue`), а не лад; у партии с капо апстрим поднимает её на капо, как лад.
   * Абсолютный лад трели = trill − капо − открытая струна (так считает import/toArrangement.ts). null — без трели.
   */
  trill: number | null;
  ornament: 'inverted turn' | 'turn' | 'upper mordent' | 'lower mordent' | null;
  grace: boolean;
  tremolo: boolean;
  tap: boolean;
  tapLeft: boolean;
  slap: boolean;
  pop: boolean;
  golpe: 'thumb' | 'finger' | null;
  /** Например 'ii', 'ami triplet'. */
  rasgueado: string | null;
  fade: 'fade in' | 'fade out' | 'swell' | null;
  wah: 'open' | 'closed' | null;
  fermata: boolean;
  /** Направление медиатора для одиночной ноты (у аккорда — `FfChord.strum`). */
  pick: 'up' | 'down' | null;
  showString: boolean;
  /** Палец левой руки из файла (0 — большой) или из suggestPositions (1–4); null — неизвестно. */
  finger: number | null;
  rightFinger: 'p' | 'i' | 'm' | 'a' | 'c' | null;

  // --- поля помощников music.js (после markRepeats/annotate/markArpeggios) ---
  repeat?: boolean;
  heldFrom?: number | null;
  tieTo?: number;
  tied?: boolean;
  slideSpan?: number;
  dynamicLabel?: string | null;
  /** Связь со следующей нотой (форматы-источники; alphaTab-конвертер не пишет — лиги уже слиты). */
  linkNext?: boolean;
}

/**
 * Нота на выходе конвертера: FfNote + поля ПАТЧА (в). Перед markRepeats поля barIndex/passIndex мешают:
 * markRepeats сравнивает все поля ноты, кроме своего списка UNMARKED, — одинаковый аккорд в соседних тактах
 * перестанет считаться повтором. Ноты для дорожки адаптер строит без них (FfNote).
 */
export interface FfScoreNote extends FfNote {
  /**
   * alphaTab `Note.realValue`: звучащая высота MIDI — лад GP + капо стана + строй − `staff.transpositionPitch`,
   * флажолет уже учтён (`harmonicPitch` по `harmonicValue`; натуральный — от открытой струны с капо). Капо из текста
   * над станом («capo 3», попадает в `capos`) alphaTab не знает — в realValue его нет.
   */
  realValue: number;
  /** ПАТЧ (г): нотная длительность в секундах (у FfNote.sustain короткие ноты — 0); лиги слиты в исходную ноту. */
  duration: number;
  /** alphaTab `Note.harmonicValue`: лад флажолета (12, 7, 5, 19…; 0 — без флажолета). Не полутоны. */
  harmonicValue: number;
  /** Слайд Legato (`SlideOutType.Legato`): следующая нота на струне звучит без удара; у Shift — с ударом. */
  slideLegato: boolean;
  /** Индекс такта партитуры (`MasterBar.index`, с 0). */
  barIndex: number;
  /** Номер прохода этого такта в порядке исполнения (повторы, вольты, D.S./D.C.), с 0. */
  passIndex: number;
}

export interface FfBarre {
  fret: number;
  /** Струны (0 — нижняя). */
  from: number;
  to: number;
  /** Только у баррэ из файла; annotate достраивает баррэ без этого поля. */
  half?: boolean;
}

export interface FfChord {
  time: number;
  name: string;
  /** Индексы нот аккорда в `notes` (после сортировки по времени и струне). */
  notes: number[];
  /** По струнам, 0 — нижняя; −1 — струна не играется. Абсолютные лады. */
  frets: number[];
  /** По струнам; −1 — неизвестно. */
  fingers: number[];
  /** Повтор того же аккорда подряд (только что сыгранная форма). */
  highDensity: boolean;
  palmMute: boolean;
  fretHandMute: boolean;
  accent: 'accent' | 'heavy' | null;
  strum: 'up' | 'down' | null;
  roll: 'up' | 'down' | null;
  /** undefined — баррэ в файле нет; annotate дописывает найденное по пальцам или null. */
  barre?: FfBarre | null;
}

export interface FfHandShape {
  startTime: number;
  endTime: number;
  name: string;
  frets: number[];
  fingers: number[];
  /** markArpeggios. */
  arpeggio?: boolean;
}

/** Позиция руки (suggestPositions): указательный на `fret`, ширина `width` ладов. */
export interface FfAnchor {
  time: number;
  endTime: number;
  fret: number;
  width: number;
}

export interface FfPhrase {
  time: number;
  endTime: number;
  name: string;
  /** У конвертера — число нот такта (одна фраза на проход такта). */
  maxDifficulty: number;
}

/** Доля; `measure` — номер такта с 1 на первой доле такта, −1 на остальных. */
export interface FfBeat {
  time: number;
  measure: number;
}

export interface FfSection {
  time: number;
  name: string;
}

export interface FfMarker {
  time: number;
  text: string;
}

export interface FfHairpin {
  time: number;
  endTime: number;
  kind: 'cresc' | 'dim';
}

export interface FfRhythm {
  time: number;
  /** Записанная длительность alphaTab: 1 — целая, 2 — половинная, 4 — четверть… */
  value: number;
  dots: number;
  rest: boolean;
  /** Числитель триоли (0 — нет). */
  tuplet: number;
}

export interface FfMeter {
  time: number;
  text: string;
}

export interface FfKey {
  time: number;
  /** Знаков при ключе: + диезы, − бемоли. */
  fifths: number;
}

export interface FfCapo {
  time: number;
  fret: number;
}

export interface FfLyric {
  time: number;
  length: number;
  text: string;
}

/** Партия, как её рисует дорожка. Рисовальщики highway.js дописывают в неё свои кэши (links, chordSpans…). */
export interface FfArrangement<N extends FfNote = FfNote> {
  name: string;
  program: number;
  strings: number;
  /** MIDI открытых струн, от НИЖНЕЙ: `[...staff.tuning].reverse()` (без капо). */
  open: number[];
  /** По времени, при равном — по струне. */
  notes: N[];
  chords: FfChord[];
  anchors: FfAnchor[];
  phrases: FfPhrase[];
  sections: FfSection[];
  beats: FfBeat[];
  handShapes: FfHandShape[];
  markers: FfMarker[];
  hairpins: FfHairpin[];
  rhythm: FfRhythm[];
  meters: FfMeter[];
  keys: FfKey[];
  /** Капо стана — запись с time 0; ещё — из текста над станом («capo 3», «capo off»). */
  capos: FfCapo[];
  lyrics: FfLyric[];
}

/** Партия на выходе конвертера. ПАТЧ (б): вместо ссылки на `track` — индексы. */
export interface FfScoreArrangement extends FfArrangement<FfScoreNote> {
  /** Индекс дорожки в `score.tracks`. */
  trackIndex: number;
  /** Индекс стана в `track.staves` ПОСЛЕ prepareScore (среди станов со струнами). */
  staffIndex: number;
}

export interface FfSong {
  title: string;
  artist: string;
  bpm: number;
  /** Секунды до конца последнего такта в порядке исполнения. */
  length: number;
  arrangements: FfScoreArrangement[];
  lyrics: FfLyric[];
  /** Темпокарта по тикам alphaTab (960 PPQ). */
  tempo: FfTempoPoint[];
}

export interface FfConverter {
  /** Первый стан со струнами (не ударный) — партия дорожки; undefined — у дорожки её нет. */
  partStaff(track: AlphaTab.model.Track): AlphaTab.model.Staff | undefined;
  /**
   * Предобработка из player.js (`api.scoreLoaded`): мутирует и возвращает ту же партитуру — у дорожек со струнным
   * станом нотные станы уходят в `track.unplayed`, станы перенумеровываются. Один раз, до MidiFileGenerator.
   */
  prepareScore(score: AlphaTab.model.Score): AlphaTab.model.Score;
  /** cache — `MidiFileGenerator.tickLookup` той же (подготовленной) партитуры. */
  songFromScore(score: AlphaTab.model.Score, cache: AlphaTab.midi.MidiTickLookup): FfSong;
}

/** ПАТЧ (а): модуль alphaTab — параметром (нужен только `model`); без глобального `alphaTab`. */
export function createConverter(alphaTab: Pick<typeof AlphaTab, 'model'>): FfConverter;

// Модель данных гитарного раздела (01-architecture.md §3.2–3.5, схема v1). Внутри модели струна 0 — НИЖНЯЯ; `fret` —
// абсолютный лад на грифе (капо уже учтён); `midi` — звучащая высота. Время хранится в PerfTick (960 PPQ, порядок
// исполнения по нотации: повторы, вольты и D.C./D.S. развёрнуты), миллисекунды — только производные (§3.4).
import type { ToneShape } from '../../audio/guitar/tone';
import type { MapNote, SongMap } from '../../lib/songMap';

export const ARRANGEMENT_SCHEMA = 1 as const;
/** Растёт при любой правке импорта → ленивый пере-разбор из оригинала (этап 9a). */
export const CONVERTER_VERSION = 3; // 2 — направления слайдов и кривая рычага в TabNote; 3 — ударные с ID артикуляций GP7
export const PPQ = 960 as const;

/** 960 PPQ, ось исполнения по нотации; может быть дробным (свинг). */
export type PerfTick = number;
export type InstrumentKind = 'guitar' | 'bass';
export type ArrangementRole = 'lead' | 'rhythm' | 'combo' | 'bass' | 'other';
export type ScoreFormat = 'gp3' | 'gp4' | 'gp5' | 'gpx' | 'gp7' | 'gp8' | 'musicxml' | 'mxl' | 'midi';

// ---------- §3.2 хранимые типы ----------

export interface Tuning {
  /** [0] — НИЖНЯЯ струна; MIDI открытых струн без капо. */
  openMidi: number[];
  /** fretfall music.tuningName: 'E Standard' | 'Drop D' | 'D A D G B E'. */
  name: string;
  /** Полутоны от стандарта инструмента (как Tuning.Strings у RS). */
  offsets: number[];
}

export type Tech =
  | 'hammerOn' | 'pullOff' | 'tap' | 'tapLeft' | 'slide' | 'slideUnpitched' | 'slideIn' | 'slideOut'
  | 'bend' | 'prebend' | 'release' | 'vibrato' | 'vibratoWide' | 'trill' | 'tremoloPicking' | 'whammy'
  | 'palmMute' | 'fretHandMute' | 'dead' | 'harmonic' | 'harmonicPinch' | 'harmonicArtificial' | 'harmonicTap'
  | 'accent' | 'ghost' | 'letRing' | 'staccato' | 'slap' | 'pop' | 'grace';

export interface BendPoint {
  /** 0..1 длительности ноты. */
  at: number;
  cents: number;
}

export type HarmonicKind = 'natural' | 'artificial' | 'pinch' | 'tap' | 'semi' | 'feedback';

export interface TabNote {
  /** 0 = нижняя. */
  string: number;
  /** Абсолютный лад на грифе; 0 — открытая. */
  fret: number;
  /** Звучащая высота, целое. */
  midi: number;
  /** Нотная длительность; лиги слиты в исходную ноту. */
  durTicks: PerfTick;
  /** 0 — короткая (правило конвертера: слайд/бенд или ≥ 0.4 с номинала). */
  sustainTicks: PerfTick;
  techs: Tech[];
  bend?: BendPoint[];
  slideToFret?: number;
  /** Направление слайда на ноту и с неё (техники slideIn / slideOut). */
  slideInFrom?: 'below' | 'above';
  slideOutTo?: 'up' | 'down';
  /** Рычаг: точки, как у bend (центы от исходной высоты, бывают отрицательные). */
  whammy?: BendPoint[];
  trillFret?: number;
  harmonic?: HarmonicKind;
  /** Левая рука, 0 — большой; из файла или suggestPositions. */
  finger?: 0 | 1 | 2 | 3 | 4 | null;
  rightFinger?: 'p' | 'i' | 'm' | 'a' | 'c';
  /** Рисуется, не судится (неисполнимое/служебное). */
  ignore?: boolean;
  /** DD (этап 36): с какого уровня видна нота / её техники. */
  minLevel?: number;
  techMinLevel?: number;
}

/** Единица скоринга: нота, двузвучие или аккорд с общим стартом. */
export interface ScoreEvent {
  /** Стабилен в аранжировке: ключ ExpectRecord.eventId и статистики. */
  id: number;
  tick: PerfTick;
  /** Мастер-такт и проход — для показа и экспорта. */
  bar: number;
  occ: number;
  notes: TabNote[];
  kind: 'note' | 'doublestop' | 'chord';
  /** pick — нужен онсет; legato — смена высоты или удар; tie — без атаки. */
  attack: 'pick' | 'legato' | 'tie';
  chordId?: number;
  handShapeId?: number;
  strum?: 'down' | 'up';
  arpeggio?: boolean;
  /** fretfall markRepeats: повтор аккорда — пустая рамка. */
  repeatOfPrev?: boolean;
  minLevel?: number;
  /** Урезание аккорда ниже fromLevel (бит i — notes[i]). */
  chordLevels?: { fromLevel: number; noteMask: number }[];
}

export interface TimelineBar {
  index: number;
  occ: number;
  fromTick: PerfTick;
  toTick: PerfTick;
  num: number;
  den: number;
  tripletFeel: number;
  section?: string;
}

export interface TimelineBeat {
  tick: PerfTick;
  bar: number;
  occ: number;
  beat: number;
  downbeat: boolean;
}

export interface ScoreTimeline {
  ppq: typeof PPQ;
  durationTicks: PerfTick;
  bars: TimelineBar[];
  beats: TimelineBeat[];
  /** fretfall tempoMap(changes, score.tempo). */
  tempos: { tick: PerfTick; bpm: number }[];
  /** handler.tickShift alphaTab: форшлаг до 1-й доли сдвигает рендер. */
  synthShiftTicks: number;
}

export interface ChordTemplate {
  id: number;
  name: string;
  /** Суффиксы '-arp', '-nop' как у RS. */
  displayName: string;
  /** По струнам (0 — нижняя); null — не играется. */
  frets: (number | null)[];
  fingers: (number | null)[];
  barre?: { fret: number; from: number; to: number } | null;
  source: 'file' | 'tonal' | 'none';
}
export interface HandShape {
  id: number;
  chordId: number;
  fromTick: PerfTick;
  toTick: PerfTick;
  arpeggio: boolean;
}
export interface Anchor {
  fromTick: PerfTick;
  toTick: PerfTick;
  fret: number;
  width: number;
  source: 'file' | 'auto' | 'user';
}
export interface Section {
  name: string;
  fromTick: PerfTick;
  toTick: PerfTick;
  source: 'marker' | 'auto';
}
export interface Phrase {
  id: number;
  name: string;
  maxLevel: number;
  kind: 'normal' | 'count' | 'end' | 'noguitar' | 'solo';
}
export interface PhraseIteration {
  index: number;
  phraseId: number;
  fromTick: PerfTick;
  toTick: PerfTick;
  /** Score Attack: round(max/4), round(max/2), max. */
  heroLevels: { easy: number; medium: number; hard: number };
  eventsAtMax: number;
}
/** Этап 47. */
export interface ToneTrack {
  /** ≤ 4 сменных, как tonea..toned у RS. */
  base: string;
  tones: string[];
  changes: { tick: PerfTick; tone: string }[];
  source: 'gpif' | 'gm' | 'user';
  /** Исходные RSE-ID — для реестра покрытия. */
  rse?: string[];
}
export type ImportWarningCode =
  | 'no-tuning' | 'tuning-guessed' | 'encoding-guess' | 'fingering-auto' | 'swing-corrected'
  | 'unsupported-technique' | 'multitrack-midi' | 'empty-track' | 'grace-shift' | 'user-edits-unmatched' | 'drum-ids';
export interface ImportWarning {
  code: ImportWarningCode;
  detail: string;
  count?: number;
}

export interface GuitarArrangement {
  schema: typeof ARRANGEMENT_SCHEMA;
  /** `${songId}:${trackIndex}:${staffIndex}`. */
  id: string;
  songId: string;
  trackIndex: number;
  staffIndex: number;
  name: string;
  instrument: InstrumentKind;
  role: ArrangementRole;
  /** GM-программа (классы тона, этап 47). */
  program: number;
  strings: number;
  tuning: Tuning;
  capo: number;
  timeline: ScoreTimeline;
  /** По tick. */
  events: ScoreEvent[];
  chords: ChordTemplate[];
  handShapes: HandShape[];
  anchors: Anchor[];
  sections: Section[];
  phrases: Phrase[];
  phraseIterations: PhraseIteration[];
  tones?: ToneTrack;
  properties: { techniques: Tech[]; chordCount: number; fretRange: [number, number]; maxLevel: number };
  source: {
    format: ScoreFormat;
    fileSha256: string;
    converterVersion: number;
    encoding?: string;
    fingering: 'file' | 'auto';
    durations: 'notated' | 'sounding';
    warnings: ImportWarning[];
  };
  /** Ключ `${tick}:${midi}` — переживает пере-разбор (§3.1). */
  userEdits?: { fingering?: Record<string, { string: number; fret: number }> };
}

export interface ScoreNote {
  tick: PerfTick;
  durTicks: PerfTick;
  midi: number;
  track: number;
  drum: boolean;
}

export interface GuitarSong {
  /** Первые 16 hex SHA-256 файла партитуры: повторный импорт не дублирует. */
  id: string;
  title: string;
  artist: string;
  album?: string;
  scoreFileId: string;
  /** Ноты ВСЕХ дорожек (fflate JSON) — для автосведения. */
  scoreNotesFileId: string;
  arrangementIds: string[];
  recording?: RecordingRef;
  lists?: string[];
  createdAt: number;
  updatedAt: number;
  lastPlayedAt?: number;
}

export type StemName = 'mix' | 'minus_guitar' | 'minus_bass' | 'guitar' | 'bass';
export interface RecordingRef {
  fileId: string;
  sha256: string;
  name: string;
  durationMs: number;
  sampleRate: number;
  /** Запись из GP8 (Audio Track). */
  embedded?: 'gp8';
  /** Ключ в store syncs. */
  syncId?: string;
  backend?: {
    id: string;
    /** 'htdemucs_6s' (подменяемая). */
    model: string;
    state: 'uploading' | 'queued' | 'separating' | 'syncing' | 'needs-review' | 'ready' | 'error';
    progress: number;
    error?: string;
    centOffset?: number;
    stems?: Partial<Record<StemName, { fileId?: string; bytes: number; codec: 'vorbis' | 'flac' }>>;
  };
}

// ---------- §3.3 синхронизация с записью ----------

export interface SyncMap {
  version: 1;
  scoreSha256: string;
  audioSha256: string;
  /** В каком декоде записи заданы audioMs (§7.8). */
  domain: 'browser' | 'backend';
  /** Глобальный сдвиг (детекторы, вывод, ручная подстройка). */
  offsetMs: number;
  /** Порядок звучания в записи; по умолчанию — вся партитура одним элементом. */
  playlist: PlaylistItem[];
  /** Монотонны внутри элемента плейлиста. */
  anchors: SyncAnchor[];
  /** Карта долей записи: метроном и сетка редактора. */
  beats?: SyncBeat[];
  flags?: SyncFlag[];
  /** Отклонение записи от A440, центы. */
  centOffset?: number;
  source: 'linear' | 'gp8' | 'manual' | 'auto' | 'mixed';
  pipeline?: { version: string; params: Record<string, number | string>; createdAt: number };
}
export interface PlaylistItem {
  fromTick: PerfTick;
  toTick: PerfTick;
  section?: string;
}
export interface SyncAnchor {
  item: number;
  tick: PerfTick;
  audioMs: number;
  kind: 'user' | 'auto' | 'beat' | 'gp8' | 'linear';
  pinned: boolean;
  conf: number;
}
export interface SyncBeat {
  item: number;
  tick: PerfTick;
  audioMs: number;
  downbeat: boolean;
  src: 'beat_this' | 'dtw' | 'user' | 'grid';
  conf: number;
}
export interface SyncFlag {
  fromMs: number;
  toMs: number;
  kind: 'low_conf' | 'tempo_jump' | 'structure' | 'first_bar' | 'after_pause';
}

export type Rendition =
  /** мс = (synthShiftMs + tickToScoreMs(tick)) / speed + leadInMs. */
  | { kind: 'synth'; speed: number; leadInMs: number }
  /** мс = (interp(anchors[item], tick) + offsetMs) / speed. */
  | { kind: 'recording'; sync: SyncMap; speed: number };

// ---------- §3.4 играбельная карта (в памяти, производная; сборка — model/playable.ts, этап 11) ----------

export interface PlayNote extends TabNote {
  startMs: number;
  durMs: number;
  sustainMs: number;
}

/** startMs/durMs — время минуса; midi — нижняя звучащая нота. */
export interface TabEvent extends MapNote {
  eventId: number;
  item: number;
  phraseIter: number;
  /** Мастер-такт и проход — подписи и выбор фрагмента. */
  bar: number;
  occ: number;
  kind: ScoreEvent['kind'];
  attack: ScoreEvent['attack'];
  /** Разрешаются в TabMap.chords / TabMap.handShapes. */
  chordId?: number;
  handShapeId?: number;
  strum?: 'down' | 'up';
  arpeggio?: boolean;
  repeatOfPrev?: boolean;
  /** Видимые на выбранном уровне (урезанный аккорд — подмножество). */
  notes: PlayNote[];
  judge: 'attack' | 'legato' | 'onsetOnly' | 'tie' | 'none';
  /** ≥ 1: расширение окон ТОЛЬКО из-за уверенности синхронизации. */
  windowScale: number;
}

export interface TabMapHandShape {
  id: number;
  chordId: number;
  startMs: number;
  endMs: number;
  arpeggio: boolean;
}
export interface TabMapSection {
  name: string;
  item: number;
  startMs: number;
  endMs: number;
}
export interface TabMapBar {
  index: number;
  occ: number;
  item: number;
  startMs: number;
  endMs: number;
  num: number;
  den: number;
}
export interface TabMapPhrase {
  iter: number;
  phraseId: number;
  name: string;
  startMs: number;
  endMs: number;
  level: number;
  maxLevel: number;
}

/** backing: { kind: 'buffer' } — аддитивный вариант SongMap. */
export interface TabMap extends SongMap {
  kind: 'tab';
  arrangementId: string;
  instrument: InstrumentKind;
  strings: number;
  tuning: Tuning;
  capo: number;
  /** По startMs — инвариант движка (game/engine.ts). */
  notes: TabEvent[];
  /** Из аранжировки, id сохраняются. */
  chords: ChordTemplate[];
  handShapes: TabMapHandShape[];
  /** По плейлисту, сплошные. */
  sections: TabMapSection[];
  bars: TabMapBar[];
  beats: { ms: number; downbeat: boolean; bar: number }[];
  phrases: TabMapPhrase[];
  anchorsMs: { startMs: number; endMs: number; fret: number; width: number }[];
  refA4Hz: number;
  speed: number;
}

export type LevelSelection =
  | { mode: 'max' }
  | { mode: 'global'; percent: number }
  | { mode: 'perPhrase'; levels: Record<number /* phraseId */, number> }
  | { mode: 'hero'; tier: 'easy' | 'medium' | 'hard' };

/** Реализация — model/playable.ts (этап 11). */
export type BuildPlayableMap = (arr: GuitarArrangement, r: Rendition, levels: LevelSelection) => TabMap;

// ---------- §3.5 прогресс, сессии, настройки ----------

/** «Мягко | Обычно | Строго» (ui-spec §11.3). */
export type Strictness = 'soft' | 'normal' | 'strict';
export type InputType = 'di' | 'pickup' | 'mic';
export type PlayMode = 'learn' | 'riff' | 'score-attack' | 'along' | 'step';
export type VerdictKind = 'hit' | 'early' | 'late' | 'wrong' | 'missed' | 'skipped';

export interface SessionRecord {
  id?: number;
  arrId: string;
  at: number;
  durationMs: number;
  mode: PlayMode;
  rendition: 'synth' | 'recording';
  speed: number;
  levels: LevelSelection;
  strictness: Strictness;
  score: number;
  accuracy: number;
  maxStreak: number;
  mastery: number;
  counts: Record<VerdictKind, number>;
  /** hist10ms: −150…+150. */
  offsets: { meanMs: number; medianMs: number; hist10ms: number[] };
  perPhrase: { iter: number; phraseId: number; level: number; accuracy: number; events: number }[];
  techniques: Partial<Record<Tech, { judged: number; ok: number }>>;
  inputType: InputType;
  latencyKey: string;
}
export interface ProgressRecord {
  arrId: string;
  levels: LevelSelection;
  bestScore: number;
  bestAccuracy: number;
  mastery: number;
  masteryPeak: number;
  phraseMastery: Record<number, number>;
  plays: number;
  lastPlayedAt: number;
  scoreAttack?: Partial<Record<'easy' | 'medium' | 'hard' | 'master', { best: number; medal: 0 | 1 | 2 | 3 | 4 | 5 }>>;
}
/** localStorage 'pupitre.guitar.v1' — только через guitar/store/settings.ts (этап 9b). */
export interface GuitarSettings {
  version: 1;
  instrument: { default: InstrumentKind; leftHanded: boolean };
  input: {
    /** null — вход не выбран. */
    deviceId: string | null;
    /** Метка устройства: имя в пилюле до открытия и поиск устройства, если браузер выдал ему новый id. */
    deviceLabel?: string;
    /** Фон в тишине, dBFS (замер на «Вход и звук»): порог «нет сигнала» — только для входа noiseKey. */
    noiseDb?: number;
    /** `${deviceId}|${channel}` входа, на котором измерен фон: у другого входа фон другой. */
    noiseKey?: string;
    /** Буфер нативного движка, кадры (64 / 128 / 256 / 512); по умолчанию 128. */
    bufferFrames?: number;
    /** −1 — смесь. */
    channel: number;
    type: InputType;
    backend: 'auto' | 'worklet' | 'engine';
    /** setSinkId контекста звука, где он есть; натив — устройство движка. */
    outputDeviceId?: string | null;
  };
  /** Ключ `${instrument}|${inputType}|${inputKey}|${outputKey}|${transportKind}`. */
  latency: Record<
    string,
    {
      ms: number;
      at: number;
      n: number;
      method: 'clicks' | 'loopback' | 'driver';
      /** baseLatency + outputLatency при калибровке — детектор дрейфа, §5.9. */
      outLatMs: number;
    }
  >;
  /** Display Lag Correction — только изображение. */
  visualOffsetMs: number;
  /** Тюнер: tuning — открытые струны, как измерены. */
  reference: { a4Hz: number; tuning?: number[]; measuredAt?: number };
  view: {
    mode: '3d' | 'tab';
    stringOrder: 'low-top' | 'high-top';
    palette: 'default' | 'cb' | 'okabe' | 'mono';
    gemLabel: 'fret' | 'finger';
    noteSpeed: number;
    reducedOfferShown?: boolean;
    timingHint: boolean;
  };
  strictness: Strictness;
  /** Учить песню: игра ждёт каждую несыгранную ноту (только с выбранным входом). */
  learn: boolean;
  /** startLevel: % для новых аранжировок; overrideToMax: arrId → прежний выбор. */
  dd: { enabled: boolean; startLevel: number | 'max'; overrideToMax: Record<string, LevelSelection> };
  mix: { backing: number; reference: number; metronome: number; guide: number; monitor: number };
  /** 'off' по умолчанию; 'tone' — себя слышно через Пюпитр, с процессором tone. */
  monitoring: { mode: 'direct' | 'tone' | 'off'; toneId?: string };
  /** Гитарный процессор мониторинга (ядро packages/dsp/src/tone.rs). */
  tone: ToneShape;
  /** Юридические ворота, кода за флагами нет. */
  features: { ddSuggestions: false; autoLevel: false };
}

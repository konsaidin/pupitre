// Тюнер гитарного раздела без React: пресеты строя, ближайшая нота и струна, центы, сглаживание кадров входа, замеры
// струн для «Сохранить строй». Кадры — audio/instrument/session (onInputFrames): высота — дробный MIDI при A4 = 440 Гц;
// эталон игрока (reference.a4Hz) — сдвиг в полутонах (referenceShift), центы и цели считаются от него.
// Сглаживание (createTuner): в счёт идут только кадры с высотой, чёткостью ≥ MIN_CLARITY и уровнем выше порога (фон
// входа + 6 дБ, не ниже GATE_DB). Атака обнуляет окно и глушит кадры ATTACK_MS: первые кадры удара YIN врёт (ложный
// низ), и струна «прыгала» бы на соседнюю. Значение — нижняя медиана кадров за WINDOW_MS (не меньше MIN_FRAMES): всегда
// высота одного из кадров, на стыке двух нот не ложится между ними. Цель (нота или
// струна) выбирается с гистерезисом и меняется только после SWITCH_FRAMES значений подряд за новую — до этого на экране
// держится прежнее. Без принятых кадров значение LIVE_MS считается живым, до HOLD_MS — удержанным, потом гаснет.
// По струнам: струна — ближайшая к высоте; у струн ниже предела детектора (YIN ядра, maxTau 768 при 48 кГц ≈ 62 Гц: бас,
// си 7-струнной) кандидат и октавой выше — детектор слышит вторую гармонику, центы у гармоники те же. Замер струны — её
// последнее устойчивое значение (≥ 80 % кадров окна в ±20 центах от медианы; MIDI при A4 = 440, как кадры, основной тон):
// из них пишется reference.tuning.
import type { InputFrame } from '../../audio/instrument/session';
import { midiToHz, midiToName } from '../../lib/music';
import type { InstrumentKind } from '../model/types';
import { tuningName } from '../vendor/fretfall/music.js';

// ——— пресеты строя ———

export interface TuningPreset {
  id: string;
  instrument: InstrumentKind;
  /** MIDI открытых струн от НИЖНЕЙ (как Tuning.openMidi). */
  open: readonly number[];
}

export const PRESETS: readonly TuningPreset[] = [
  { id: 'e-standard', instrument: 'guitar', open: [40, 45, 50, 55, 59, 64] },
  { id: 'drop-d', instrument: 'guitar', open: [38, 45, 50, 55, 59, 64] },
  { id: 'd-standard', instrument: 'guitar', open: [38, 43, 48, 53, 57, 62] },
  { id: 'eb-standard', instrument: 'guitar', open: [39, 44, 49, 54, 58, 63] },
  { id: 'drop-c', instrument: 'guitar', open: [36, 43, 48, 53, 57, 62] },
  { id: 'b-standard-7', instrument: 'guitar', open: [35, 40, 45, 50, 55, 59, 64] },
  { id: 'bass4-e-standard', instrument: 'bass', open: [28, 33, 38, 43] },
  { id: 'bass5-b-standard', instrument: 'bass', open: [23, 28, 33, 38, 43] },
];

/** «E Standard», «Drop D», «E♭ Standard» — как имена строя партий (fretfall tuningName). */
export const presetName = (preset: TuningPreset): string => tuningName(preset.open);

/** Бемольный строй (E♭ Standard) — и струны называются бемолями: «E♭ A♭ D♭», а не «D♯ G♯ C♯». */
export const presetFlats = (preset: TuningPreset): boolean => presetName(preset).includes('♭');

export const presetById = (id: string): TuningPreset => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

export const defaultPreset = (instrument: InstrumentKind): TuningPreset => PRESETS.find((p) => p.instrument === instrument) ?? PRESETS[0];

/**
 * Пресет при открытии тюнера: сохранённый строй (reference.tuning, MIDI при A4 = 440), если он — пресет того же
 * инструмента (струны с точностью до полутона при текущем эталоне), иначе стандарт инструмента по умолчанию.
 */
export function initialPreset(instrument: InstrumentKind, saved: readonly number[] | undefined, a4Hz: number): TuningPreset {
  if (saved?.length) {
    const shift = referenceShift(a4Hz);
    const notes = saved.map((m) => Math.round(m - shift));
    const same = PRESETS.find((p) => p.instrument === instrument && p.open.length === notes.length && p.open.every((m, i) => m === notes[i]));
    if (same) return same;
  }
  return defaultPreset(instrument);
}

// ——— ноты, центы, эталон ———

/** «В строю» — до ±3 центов включительно (по округлённому значению, как на экране). */
export const IN_TUNE_CENTS = 3;

export type TuneStatus = 'in' | 'sharp' | 'flat';

/** На сколько полутонов эталон выше A4 = 440 Гц (кадры входа — при 440). */
export const referenceShift = (a4Hz: number): number => 12 * Math.log2(a4Hz / 440);

/** Частота ноты (целый MIDI) при эталоне a4Hz. */
export const noteHz = (note: number, a4Hz: number): number => midiToHz(note + referenceShift(a4Hz));

export const statusOf = (cents: number): TuneStatus =>
  Math.abs(Math.round(cents)) <= IN_TUNE_CENTS ? 'in' : cents > 0 ? 'sharp' : 'flat';

/** «+12», «−8», «0»: минус типографский. */
export function formatCents(cents: number): string {
  const r = Math.round(cents);
  return r > 0 ? `+${r}` : r < 0 ? `−${-r}` : '0';
}

const FLAT_OF: Record<string, string> = { 'C#': 'D♭', 'D#': 'E♭', 'F#': 'G♭', 'G#': 'A♭', 'A#': 'B♭' };

/** Нота и октава отдельно — для крупной ноты: 61 → { pitch: 'C♯', octave: '4' } (flats — 'D♭'). */
export function noteParts(midi: number, flats = false): { pitch: string; octave: string } {
  const [, pitch, octave] = /^([A-G]#?)(-?\d+)$/.exec(midiToName(midi)) ?? ['', '?', ''];
  return { pitch: flats ? (FLAT_OF[pitch] ?? pitch) : pitch.replace('#', '♯'), octave };
}

/** «C♯4» (как noteName экрана игры: ♯ вместо #), бемольный строй — «D♭4». */
export function noteName(midi: number, flats = false): string {
  const { pitch, octave } = noteParts(midi, flats);
  return pitch + octave;
}

// ——— выбор цели ———

/** Запас при смене ноты в хроматическом режиме, полутоны: у границы ±50 центов нота не мигает. */
export const NOTE_MARGIN = 0.1;
/** Запас при смене струны, полутоны: прежняя держится, пока другая не ближе на столько. */
export const STRING_MARGIN = 0.4;
/** Дальше крайних струн на столько полутонов — не струна (лад высоко на грифе), только нота. */
export const OUT_OF_RANGE = 4;
/** Предел детектора высоты, Гц: YIN ядра (packages/dsp/src/yin.rs, maxTau 768) при 48 кГц ниже основной тон не слышит. */
export const DETECT_FLOOR_HZ = 62;
/** Гармоника проигрывает прямой струне при равном расстоянии (Drop C: до малой октавы — струна 3, а не гармоника 6-й). */
const HARMONIC_PENALTY = 0.25;

/** Ближайшая нота к высоте rel (полутоны от эталона); current держится до ±(0.5 + NOTE_MARGIN). */
export function nearestNote(rel: number, current = NaN): number {
  const n = Math.round(rel);
  return Number.isFinite(current) && n !== current && Math.abs(rel - current) <= 0.5 + NOTE_MARGIN ? current : n;
}

export interface StringPick {
  /** Струна пресета, 0 — нижняя. */
  string: number;
  /** Октав над открытой струной: детектор слышит гармонику (0 — основной тон). */
  octave: number;
}

/** Расстояние от высоты до струны (полутоны, с поправкой на гармонику) и октава лучшего кандидата. */
function stringDistance(open: number, rel: number, shift: number): { d: number; octave: number } {
  let best = { d: Math.abs(rel - open), octave: 0 };
  // октава вверх — пока сама струна (её гармоника) ниже предела детектора
  for (let k = 1; k <= 2 && midiToHz(open + 12 * (k - 1) + shift) < DETECT_FLOOR_HZ; k++) {
    const d = Math.abs(rel - open - 12 * k) + HARMONIC_PENALTY;
    if (d < best.d) best = { d, octave: k };
  }
  return best;
}

/**
 * Ближайшая струна к высоте rel (полутоны от эталона; shift — сдвиг эталона, для предела детектора в герцах).
 * current — выбранная сейчас струна: держится, пока другая не ближе на STRING_MARGIN. null — дальше OUT_OF_RANGE.
 */
export function nearestString(open: readonly number[], rel: number, shift: number, current = -1): StringPick | null {
  if (!open.length || !Number.isFinite(rel)) return null;
  let string = -1;
  let best = { d: Infinity, octave: 0 };
  for (let i = 0; i < open.length; i++) {
    const c = stringDistance(open[i], rel, shift);
    if (c.d < best.d) {
      best = c;
      string = i;
    }
  }
  if (current >= 0 && current < open.length && current !== string) {
    const held = stringDistance(open[current], rel, shift);
    if (held.d <= best.d + STRING_MARGIN && held.d <= OUT_OF_RANGE) return { string: current, octave: held.octave };
  }
  return best.d <= OUT_OF_RANGE ? { string, octave: best.octave } : null;
}

// ——— сглаживание и замеры ———

/** Чёткость кадра (YIN), с которой он идёт в счёт. Голос у гейта ядра — от 0.5; у чистой струны — за 0.9. */
export const MIN_CLARITY = 0.8;
/** Порог уровня по умолчанию, dBFS (RMS кадра); гейт высоты браузера — −50. */
export const GATE_DB = -54;
/** Запас над фоном входа, дБ: как «нет сигнала» у сессии входа. */
export const NOISE_MARGIN_DB = 6;
export const WINDOW_MS = 120;
const MAX_FRAMES = 48;
export const MIN_FRAMES = 5;
export const ATTACK_MS = 60;
export const SWITCH_FRAMES = 6;
/** Кадров рядом с медианой, чтобы замер струны записался (не пара кадров на излёте). */
export const STABLE_FRAMES = 8;
/** «Рядом с медианой», полутоны; таких кадров — не меньше STABLE_SHARE окна (смесь двух нот на стыке не пишется). */
export const STABLE_SPREAD = 0.2;
export const STABLE_SHARE = 0.8;
export const LIVE_MS = 250;
export const HOLD_MS = 600;

/** Порог уровня входа: фон (dBFS, NaN — не измерен) + запас, не ниже GATE_DB. */
export const floorDbOf = (noiseDb: number): number => (Number.isFinite(noiseDb) ? Math.max(GATE_DB, noiseDb + NOISE_MARGIN_DB) : GATE_DB);

export interface TunerConfig {
  a4Hz: number;
  /** Открытые струны пресета (MIDI от нижней); null — хроматический режим. */
  open: readonly number[] | null;
  /** Порог уровня кадров, dBFS (floorDbOf). */
  floorDb: number;
}

/** live — свежие кадры; held — держим последнее; none — погасло (или ещё ничего не было). */
export type TunerPhase = 'live' | 'held' | 'none';

export interface TunerReading {
  phase: TunerPhase;
  /** Сглаженная высота, MIDI при A4 = 440 (как кадры); NaN — ещё ни одной. */
  midi: number;
  /** Целевая нота (целый MIDI): ближайшая или открытая струна. NaN — нет. */
  note: number;
  /** Отклонение от цели, центы: в хроматике ≈ −50…+50, по струнам — сколько угодно. */
  cents: number;
  status: TuneStatus;
  /** Струна пресета (0 — нижняя); −1 — хроматика или высота дальше струн. */
  string: number;
  /** Частота основного тона, Гц (у гармоники — уже поделённая). */
  hz: number;
  /** Частота цели при эталоне, Гц. */
  targetHz: number;
}

export interface Tuner {
  push(frame: InputFrame): void;
  /** Показ на момент now (часы страницы, как atMs кадров). */
  read(nowMs: number): TunerReading;
  /** Последний замер каждой струны пресета (MIDI при A4 = 440); NaN — струна не снята. Общий массив — не хранить. */
  measured(): readonly number[];
  /** Новый эталон, пресет или порог; другой пресет сбрасывает замеры (заход в хроматику — нет). */
  configure(config: TunerConfig): void;
}

const EMPTY: TunerReading = { phase: 'none', midi: NaN, note: NaN, cents: NaN, status: 'in', string: -1, hz: NaN, targetHz: NaN };
const NO_STRINGS: readonly number[] = [];

const sameOpen = (a: readonly number[] | null, b: readonly number[] | null) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((m, i) => m === b[i]));

/** Нижняя медиана — всегда высота одного из кадров: у чётного окна на стыке двух нот среднее легло бы между ними. */
function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[(values.length - 1) >> 1];
}

export function createTuner(initial: TunerConfig): Tuner {
  let config = initial;
  let shift = referenceShift(config.a4Hz);
  /** Замеры струн и пресет, к которому они относятся: заход в хроматику их не стирает. */
  let measured: number[] = config.open ? config.open.map(() => NaN) : [];
  let measuredFor = config.open;
  /** Принятые кадры окна: время и высота. */
  const win: Array<{ at: number; midi: number }> = [];
  const scratch: number[] = [];
  let quietUntil = -Infinity;
  /** Показ: высота, цель (струна или −1 по струнам, нота в хроматике), октава гармоники, время последнего кадра. */
  let shown = { midi: NaN, slot: -1, octave: 0, at: -Infinity };
  let pending = { slot: NaN, run: 0 };

  /** Цель для высоты rel; current — нынешняя (гистерезис), NaN — без него. */
  const pick = (rel: number, current: number): { slot: number; octave: number } => {
    if (!config.open) return { slot: nearestNote(rel, current), octave: 0 };
    const s = nearestString(config.open, rel, shift, Number.isFinite(current) ? current : -1);
    return s ? { slot: s.string, octave: s.octave } : { slot: -1, octave: 0 };
  };

  /** Окно устойчиво вокруг высоты midi: замер струны можно писать. */
  const steady = (midi: number) => {
    let near = 0;
    for (const f of win) if (Math.abs(f.midi - midi) <= STABLE_SPREAD) near++;
    return near >= STABLE_FRAMES && near >= win.length * STABLE_SHARE;
  };

  const settle = (midi: number, at: number) => {
    const fresh = Number.isFinite(shown.midi) && at - shown.at <= HOLD_MS;
    const next = pick(midi - shift, fresh ? shown.slot : NaN);
    if (Number.isFinite(shown.midi) && next.slot === shown.slot) {
      pending = { slot: NaN, run: 0 };
    } else {
      // смена цели — только когда новая держится SWITCH_FRAMES значений подряд; до этого показ прежний
      pending = pending.slot === next.slot ? { slot: next.slot, run: pending.run + 1 } : { slot: next.slot, run: 1 };
      if (pending.run < SWITCH_FRAMES) return;
      pending = { slot: NaN, run: 0 };
    }
    shown = { midi, slot: next.slot, octave: next.octave, at };
    if (config.open && next.slot >= 0 && steady(midi)) measured[next.slot] = midi - 12 * next.octave;
  };

  return {
    push(frame) {
      if (frame.onset) {
        // новый удар: старая высота в медиану не идёт, первые кадры удара — тоже
        win.length = 0;
        quietUntil = Math.max(quietUntil, frame.atMs + ATTACK_MS);
        return;
      }
      if (frame.atMs < quietUntil) return;
      if (!Number.isFinite(frame.midi) || !(frame.clarity >= MIN_CLARITY) || !(frame.levelDb >= config.floorDb)) return;
      win.push({ at: frame.atMs, midi: frame.midi });
      while (win.length > MAX_FRAMES || (win.length && win[0].at < frame.atMs - WINDOW_MS)) win.shift();
      if (win.length < MIN_FRAMES) return;
      scratch.length = 0;
      for (const f of win) scratch.push(f.midi);
      settle(median(scratch), frame.atMs);
    },

    read(nowMs) {
      if (!Number.isFinite(shown.midi)) return EMPTY;
      const age = nowMs - shown.at;
      const phase: TunerPhase = age > HOLD_MS ? 'none' : age > LIVE_MS ? 'held' : 'live';
      const rel = shown.midi - shift;
      let note: number;
      let string = -1;
      let octave = 0;
      if (config.open && shown.slot >= 0) {
        string = shown.slot;
        note = config.open[string];
        octave = shown.octave;
      } else note = config.open ? Math.round(rel) : shown.slot;
      const cents = (rel - note - 12 * octave) * 100;
      return {
        phase, midi: shown.midi, note, cents, status: statusOf(cents), string,
        hz: midiToHz(shown.midi - 12 * octave), targetHz: midiToHz(note + shift),
      };
    },

    measured: () => (config.open ? measured : NO_STRINGS),

    configure(next) {
      const openChanged = !sameOpen(config.open, next.open);
      const shiftChanged = next.a4Hz !== config.a4Hz;
      config = next;
      shift = referenceShift(next.a4Hz);
      if (next.open && !sameOpen(measuredFor, next.open)) {
        measured = next.open.map(() => NaN);
        measuredFor = next.open;
      }
      // цель показа — заново, без гистерезиса: старая струна или нота другого пресета ничего не значит
      if ((openChanged || shiftChanged) && Number.isFinite(shown.midi)) {
        const p = pick(shown.midi - shift, NaN);
        shown = { ...shown, slot: p.slot, octave: p.octave };
        pending = { slot: NaN, run: 0 };
      }
    },
  };
}

/** Имя сохранённого строя (reference.tuning, MIDI при A4 = 440) при эталоне a4Hz: «Drop D», «D A D G B E». */
export const savedTuningName = (saved: readonly number[], a4Hz: number): string =>
  tuningName(saved.map((m) => Math.round(m - referenceShift(a4Hz))));

/** Замеры для reference.tuning: все струны сняты — массив с точностью 0.001 полутона, иначе null. */
export function tuningToSave(measured: readonly number[]): number[] | null {
  if (!measured.length || !measured.every(Number.isFinite)) return null;
  return measured.map((m) => Math.round(m * 1000) / 1000);
}

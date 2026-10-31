// Гитарный процессор мониторинга: настройки тона → параметры ядра packages/dsp/src/tone.rs (номера PARAM_* — контракт,
// меняются только синхронно; сверку держит tone.test.ts на настоящем tone.wasm). Один массив значений по номерам уходит
// и в JACK-движок (плоскими парами «номер, значение»), и в AudioWorklet браузера (toneProcessorSource.ts). Комплект —
// гитара или бас: у каждого свои ручки усилителя (ToneShape и ToneShape.bassAmp), в ядро уходят ручки активного по
// общим номерам GAIN/BASS/MID/TREBLE/LEVEL/CAB; педали общие.

export const TONE_PARAM = {
  bypass: 0, model: 1, gate: 2, gain: 3, bass: 4, mid: 5, treble: 6, presence: 7, level: 8, cab: 9,
  delayMix: 10, delayMs: 11, delayFeedback: 12, roomMix: 13,
  screamerOn: 14, screamerDrive: 15, screamerTone: 16, screamerLevel: 17,
  fuzzOn: 18, fuzz: 19, fuzzTone: 20, fuzzLevel: 21, boostOn: 22, boostLevel0: 23, slot0: 27, loop: 33,
  rig: 34, midFreq: 35, ultraLo: 36, ultraHi: 37, blend: 38, comp: 39, horn: 40,
} as const;
export const TONE_PARAM_COUNT = 41;

/** Педали в порядке номеров ядра (PEDAL_*). */
export const PEDALS = ['gate', 'screamer', 'delay', 'room', 'fuzz', 'boost'] as const;
export type PedalId = (typeof PEDALS)[number];

export const AMP_MODELS = ['clean', 'crunch', 'high-gain'] as const;
export type AmpModelName = (typeof AMP_MODELS)[number];

export const RIGS = ['guitar', 'bass'] as const;
export type RigName = (typeof RIGS)[number];
/** Голоса басового усилителя в порядке BASS_VOICINGS ядра: ламповый, чистый транзисторный, перегруз. */
export const BASS_MODELS = ['vintage', 'modern', 'grit'] as const;
export type BassModelName = (typeof BASS_MODELS)[number];
/** Положения переключателя частоты середины баса, Гц (MID_FREQS ядра). */
export const BASS_MID_FREQS = [220, 450, 800, 1600, 3000] as const;

/** Басовая голова и кабинет 4×10: ручки 0…1 (тонстек 0.5 — ровно). */
export interface BassAmpShape {
  model: BassModelName;
  gain: number;
  bass: number;
  mid: number;
  /** Номер положения в BASS_MID_FREQS. */
  midFreq: number;
  treble: number;
  ultraLo: boolean;
  ultraHi: boolean;
  /** Доля усилителя против чистого DI: 0 — только DI, 1 — только усилитель. */
  blend: number;
  /** Компрессор одной ручкой; 0 — выключен. */
  comp: number;
  /** Громкость выхода, дБ. */
  levelDb: number;
  cab: boolean;
  /** Рупор кабинета. */
  horn: boolean;
}

/** Тон, как его хранят настройки раздела (GuitarSettings.tone). Ручки 0…1, тонстек 0.5 — ровно. */
export interface ToneShape {
  on: boolean;
  /** Комплект: гитарная голова на 4×12 или басовая на 4×10. */
  rig: RigName;
  model: AmpModelName;
  /** Порог гейта, дБ полной шкалы; ниже −96 — выключен. */
  gateDb: number;
  /** Кнопка гейта: выключает его, не трогая порог. */
  gateOn: boolean;
  gain: number;
  bass: number;
  mid: number;
  treble: number;
  presence: number;
  /** Громкость выхода, дБ. */
  levelDb: number;
  cab: boolean;
  /** Дилей; on — кнопка: выключает его, не трогая ручки. */
  delay: { on: boolean; mix: number; ms: number; feedback: number };
  room: number;
  /** Кнопка комнаты: выключает её, не трогая микс. */
  roomOn: boolean;
  /** Овердрайв в духе TS808: ручки 0…1, уровень 0.5 — 0 дБ. */
  screamer: { on: boolean; drive: number; tone: number; level: number };
  /** Фузз: ручки 0…1; тон 0 — низ, 1 — верх; уровень 0.5 — −15 дБ. */
  fuzz: { on: boolean; gain: number; tone: number; level: number };
  /** Буст: четыре одинаковые ручки уровня (0.5 — 0 дБ), их вклад складывается. */
  boost: { on: boolean; levels: number[] };
  /** Педалборд: порядок по сигналу; педали с номера loop — в петле эффектов (после усилителя и кабинета). */
  board: { order: PedalId[]; loop: number };
  bassAmp: BassAmpShape;
}

/** Как в DEFAULTS ядра: хай-гейн с кабинетом, гейт −60 дБ, педали выключены, без дилея, лёгкая комната. Кнопки гейта,
 *  дилея и комнаты включены: молчат они ручкой в нуле — так их выключали настройки до кнопок (флаг при чтении таких
 *  настроек берётся отсюда). */
export const DEFAULT_TONE: ToneShape = {
  on: true, rig: 'guitar', model: 'high-gain', gateDb: -60, gateOn: true, gain: 0.5, bass: 0.5, mid: 0.5, treble: 0.5, presence: 0.5, levelDb: 0, cab: true,
  delay: { on: true, mix: 0, ms: 350, feedback: 0.3 }, room: 0.15, roomOn: true,
  screamer: { on: false, drive: 0.4, tone: 0.5, level: 0.6 },
  fuzz: { on: false, gain: 0.6, tone: 0.5, level: 0.5 },
  boost: { on: false, levels: [0.5, 0.5, 0.5, 0.5] },
  board: { order: ['fuzz', 'screamer', 'boost', 'gate', 'delay', 'room'], loop: 4 },
  // бас: ламповый голос с запасом, середина 800 Гц, только усилитель, без компрессора, кабинет с рупором
  bassAmp: {
    model: 'vintage', gain: 0.4, bass: 0.55, mid: 0.5, midFreq: 2, treble: 0.5, ultraLo: false, ultraHi: false, blend: 1, comp: 0, levelDb: 0,
    cab: true, horn: true,
  },
};

/** Порог, которым гейт выключен в ядре (ниже −96 дБ). */
export const GATE_OFF_DB = -120;
const GATE_CLOSED_DB = -96;
/** Микс, с которым дилей включается, если ручка стояла в нуле. */
export const DELAY_MIX_ON = 0.3;

type Utility = 'gate' | 'delay' | 'room';

/** Включены ли гейт, дилей и комната: кнопкой и ручкой не в нуле. */
export function utilitiesOn(tone: ToneShape): Record<Utility, boolean> {
  return {
    gate: tone.gateOn !== false && tone.gateDb > GATE_CLOSED_DB,
    delay: tone.delay.on !== false && tone.delay.mix > 0,
    room: tone.roomOn !== false && tone.room > 0,
  };
}

/** Кнопка гейта, дилея или комнаты: выключение ручку не трогает; включение с ручкой в нуле ставит её по умолчанию. */
export function toggleUtility(tone: ToneShape, pedal: Utility): Partial<ToneShape> {
  const on = !utilitiesOn(tone)[pedal];
  if (pedal === 'gate') return { gateOn: on, ...(on && tone.gateDb <= GATE_CLOSED_DB && { gateDb: DEFAULT_TONE.gateDb }) };
  if (pedal === 'delay') return { delay: { ...tone.delay, on, ...(on && tone.delay.mix <= 0 && { mix: DELAY_MIX_ON }) } };
  return { roomOn: on, ...(on && tone.room <= 0 && { room: DEFAULT_TONE.room }) };
}

/** Педалборд из настроек — с проверкой. Запись без педалей, появившихся позже, дополняется ими в начале цепочки (они
 *  выключены — звук не меняется); повторы, чужие названия и прочий мусор — порядок по умолчанию. */
export function boardOf(tone: Pick<ToneShape, 'board'> | null | undefined): ToneShape['board'] {
  const order: unknown = tone?.board?.order;
  const loop = Math.round(Number(tone?.board?.loop));
  const known = (p: unknown): p is PedalId => (PEDALS as readonly unknown[]).includes(p);
  const valid = Array.isArray(order) && order.length > 0 && order.every((p, i) => known(p) && order.indexOf(p) === i) && Number.isFinite(loop);
  if (!valid) return { order: [...DEFAULT_TONE.board.order], loop: DEFAULT_TONE.board.loop };
  const missing = DEFAULT_TONE.board.order.filter((p) => !order.includes(p));
  return { order: [...missing, ...(order as PedalId[])], loop: missing.length + Math.min(order.length, Math.max(0, loop)) };
}

/** Значения параметров ядра по номерам; null — процессора нет (мониторинг сухой, как в обходе). */
export function toneParams(t: ToneShape | null): number[] {
  const p = new Array<number>(TONE_PARAM_COUNT).fill(0);
  const tone = t ?? { ...DEFAULT_TONE, on: false };
  const amp = { ...DEFAULT_TONE.bassAmp, ...tone.bassAmp };
  const bass = tone.rig === 'bass';
  p[TONE_PARAM.bypass] = tone.on ? 0 : 1;
  p[TONE_PARAM.rig] = bass ? 1 : 0;
  p[TONE_PARAM.model] = bass ? Math.max(0, BASS_MODELS.indexOf(amp.model)) : Math.max(0, AMP_MODELS.indexOf(tone.model));
  const on = utilitiesOn(tone);
  p[TONE_PARAM.gate] = on.gate ? tone.gateDb : GATE_OFF_DB;
  p[TONE_PARAM.gain] = bass ? amp.gain : tone.gain;
  p[TONE_PARAM.bass] = bass ? amp.bass : tone.bass;
  p[TONE_PARAM.mid] = bass ? amp.mid : tone.mid;
  p[TONE_PARAM.treble] = bass ? amp.treble : tone.treble;
  p[TONE_PARAM.presence] = tone.presence;
  p[TONE_PARAM.level] = bass ? amp.levelDb : tone.levelDb;
  p[TONE_PARAM.cab] = (bass ? amp.cab : tone.cab) ? 1 : 0;
  p[TONE_PARAM.midFreq] = Math.min(BASS_MID_FREQS.length - 1, Math.max(0, Math.round(amp.midFreq)));
  p[TONE_PARAM.ultraLo] = amp.ultraLo ? 1 : 0;
  p[TONE_PARAM.ultraHi] = amp.ultraHi ? 1 : 0;
  p[TONE_PARAM.blend] = amp.blend;
  p[TONE_PARAM.comp] = amp.comp;
  p[TONE_PARAM.horn] = amp.horn ? 1 : 0;
  p[TONE_PARAM.delayMix] = on.delay ? tone.delay.mix : 0;
  p[TONE_PARAM.delayMs] = tone.delay.ms;
  p[TONE_PARAM.delayFeedback] = tone.delay.feedback;
  p[TONE_PARAM.roomMix] = on.room ? tone.room : 0;
  const screamer = tone.screamer ?? DEFAULT_TONE.screamer;
  p[TONE_PARAM.screamerOn] = screamer.on ? 1 : 0;
  p[TONE_PARAM.screamerDrive] = screamer.drive;
  p[TONE_PARAM.screamerTone] = screamer.tone;
  p[TONE_PARAM.screamerLevel] = screamer.level;
  const fuzz = tone.fuzz ?? DEFAULT_TONE.fuzz;
  p[TONE_PARAM.fuzzOn] = fuzz.on ? 1 : 0;
  p[TONE_PARAM.fuzz] = fuzz.gain;
  p[TONE_PARAM.fuzzTone] = fuzz.tone;
  p[TONE_PARAM.fuzzLevel] = fuzz.level;
  const boost = tone.boost ?? DEFAULT_TONE.boost;
  p[TONE_PARAM.boostOn] = boost.on ? 1 : 0;
  for (let i = 0; i < 4; i++) p[TONE_PARAM.boostLevel0 + i] = boost.levels?.[i] ?? 0.5;
  const board = boardOf(tone);
  board.order.forEach((pedal, i) => (p[TONE_PARAM.slot0 + i] = PEDALS.indexOf(pedal)));
  p[TONE_PARAM.loop] = board.loop;
  return p;
}

/** Плоские пары «номер, значение» изменившихся параметров (prev = null — все). */
export function changedToneParams(prev: readonly number[] | null, next: readonly number[]): number[] {
  const out: number[] = [];
  next.forEach((value, id) => {
    if (!prev || prev[id] !== value) out.push(id, value);
  });
  return out;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

/**
 * Тон из чужих данных (импорт пресета, старая запись): поверх умолчаний, каждое поле — своего типа и в пределах ручки,
 * неизвестные названия — по умолчанию. Всё, что тон не знает, отбрасывается.
 */
export function toneOf(raw: unknown): ToneShape {
  const d = DEFAULT_TONE;
  const t = isObject(raw) ? raw : {};
  const sub = (key: string): Json => (isObject(t[key]) ? (t[key] as Json) : {});
  const knob = (v: unknown, fallback: number) => num(v, fallback, 0, 1);
  const delay = sub('delay'), screamer = sub('screamer'), fuzz = sub('fuzz'), boost = sub('boost'), bass = sub('bassAmp');
  const levels = Array.isArray(boost.levels) ? boost.levels : [];
  return {
    on: flag(t.on, d.on),
    rig: oneOf(t.rig, RIGS, d.rig),
    model: oneOf(t.model, AMP_MODELS, d.model),
    gateDb: num(t.gateDb, d.gateDb, GATE_OFF_DB, 0),
    gateOn: flag(t.gateOn, d.gateOn),
    gain: knob(t.gain, d.gain),
    bass: knob(t.bass, d.bass),
    mid: knob(t.mid, d.mid),
    treble: knob(t.treble, d.treble),
    presence: knob(t.presence, d.presence),
    levelDb: num(t.levelDb, d.levelDb, -24, 12),
    cab: flag(t.cab, d.cab),
    delay: {
      on: flag(delay.on, d.delay.on), mix: knob(delay.mix, d.delay.mix), ms: num(delay.ms, d.delay.ms, 20, 1500),
      feedback: num(delay.feedback, d.delay.feedback, 0, 0.9),
    },
    room: knob(t.room, d.room),
    roomOn: flag(t.roomOn, d.roomOn),
    screamer: {
      on: flag(screamer.on, d.screamer.on), drive: knob(screamer.drive, d.screamer.drive), tone: knob(screamer.tone, d.screamer.tone),
      level: knob(screamer.level, d.screamer.level),
    },
    fuzz: { on: flag(fuzz.on, d.fuzz.on), gain: knob(fuzz.gain, d.fuzz.gain), tone: knob(fuzz.tone, d.fuzz.tone), level: knob(fuzz.level, d.fuzz.level) },
    boost: { on: flag(boost.on, d.boost.on), levels: d.boost.levels.map((v, i) => knob(levels[i], v)) },
    board: boardOf(t as Pick<ToneShape, 'board'>),
    bassAmp: {
      model: oneOf(bass.model, BASS_MODELS, d.bassAmp.model),
      gain: knob(bass.gain, d.bassAmp.gain),
      bass: knob(bass.bass, d.bassAmp.bass),
      mid: knob(bass.mid, d.bassAmp.mid),
      midFreq: Math.round(num(bass.midFreq, d.bassAmp.midFreq, 0, BASS_MID_FREQS.length - 1)),
      treble: knob(bass.treble, d.bassAmp.treble),
      ultraLo: flag(bass.ultraLo, d.bassAmp.ultraLo),
      ultraHi: flag(bass.ultraHi, d.bassAmp.ultraHi),
      blend: knob(bass.blend, d.bassAmp.blend),
      comp: knob(bass.comp, d.bassAmp.comp),
      levelDb: num(bass.levelDb, d.bassAmp.levelDb, -24, 12),
      cab: flag(bass.cab, d.bassAmp.cab),
      horn: flag(bass.horn, d.bassAmp.horn),
    },
  };
}

/** Тон с предустановкой поверх умолчаний: недостающие поля — из DEFAULT_TONE, вложенные — тоже. */
export function toneWith(patch: ToneOverride): ToneShape {
  const d = DEFAULT_TONE;
  return toneOf({
    ...d, ...patch,
    delay: { ...d.delay, ...patch.delay }, screamer: { ...d.screamer, ...patch.screamer }, fuzz: { ...d.fuzz, ...patch.fuzz },
    boost: { ...d.boost, ...patch.boost }, board: patch.board ?? d.board, bassAmp: { ...d.bassAmp, ...patch.bassAmp },
  });
}

/** Отличия тона от умолчаний: вложенные — частично. */
export type ToneOverride = Partial<Omit<ToneShape, 'delay' | 'screamer' | 'fuzz' | 'boost' | 'bassAmp'>> & {
  delay?: Partial<ToneShape['delay']>;
  screamer?: Partial<ToneShape['screamer']>;
  fuzz?: Partial<ToneShape['fuzz']>;
  boost?: Partial<ToneShape['boost']>;
  bassAmp?: Partial<BassAmpShape>;
};

/** Ключ звучания: одинаковые тона — одинаковый ключ (питание — не звучание пресета и не входит). */
export function toneKey(tone: ToneShape): string {
  const { on: _on, ...rest } = toneOf(tone);
  return JSON.stringify(rest);
}

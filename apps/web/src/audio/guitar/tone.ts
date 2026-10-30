// Гитарный процессор мониторинга: настройки тона → параметры ядра packages/dsp/src/tone.rs (номера PARAM_* — контракт,
// меняются только синхронно; сверку держит tone.test.ts на настоящем tone.wasm). Один массив значений по номерам уходит
// и в JACK-движок (плоскими парами «номер, значение»), и в AudioWorklet браузера (toneProcessorSource.ts).

export const TONE_PARAM = {
  bypass: 0, model: 1, gate: 2, gain: 3, bass: 4, mid: 5, treble: 6, presence: 7, level: 8, cab: 9,
  delayMix: 10, delayMs: 11, delayFeedback: 12, roomMix: 13,
  screamerOn: 14, screamerDrive: 15, screamerTone: 16, screamerLevel: 17,
  fuzzOn: 18, fuzz: 19, fuzzTone: 20, fuzzLevel: 21, boostOn: 22, boostLevel0: 23, slot0: 27, loop: 33,
} as const;
export const TONE_PARAM_COUNT = 34;

/** Педали в порядке номеров ядра (PEDAL_*). */
export const PEDALS = ['gate', 'screamer', 'delay', 'room', 'fuzz', 'boost'] as const;
export type PedalId = (typeof PEDALS)[number];

export const AMP_MODELS = ['clean', 'crunch', 'high-gain'] as const;
export type AmpModelName = (typeof AMP_MODELS)[number];

/** Тон, как его хранят настройки раздела (GuitarSettings.tone). Ручки 0…1, тонстек 0.5 — ровно. */
export interface ToneShape {
  on: boolean;
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
}

/** Как в DEFAULTS ядра: хай-гейн с кабинетом, гейт −60 дБ, педали выключены, без дилея, лёгкая комната. Кнопки гейта,
 *  дилея и комнаты включены: молчат они ручкой в нуле — так их выключали настройки до кнопок (флаг при чтении таких
 *  настроек берётся отсюда). */
export const DEFAULT_TONE: ToneShape = {
  on: true, model: 'high-gain', gateDb: -60, gateOn: true, gain: 0.5, bass: 0.5, mid: 0.5, treble: 0.5, presence: 0.5, levelDb: 0, cab: true,
  delay: { on: true, mix: 0, ms: 350, feedback: 0.3 }, room: 0.15, roomOn: true,
  screamer: { on: false, drive: 0.4, tone: 0.5, level: 0.6 },
  fuzz: { on: false, gain: 0.6, tone: 0.5, level: 0.5 },
  boost: { on: false, levels: [0.5, 0.5, 0.5, 0.5] },
  board: { order: ['fuzz', 'screamer', 'boost', 'gate', 'delay', 'room'], loop: 4 },
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
  p[TONE_PARAM.bypass] = tone.on ? 0 : 1;
  p[TONE_PARAM.model] = Math.max(0, AMP_MODELS.indexOf(tone.model));
  const on = utilitiesOn(tone);
  p[TONE_PARAM.gate] = on.gate ? tone.gateDb : GATE_OFF_DB;
  p[TONE_PARAM.gain] = tone.gain;
  p[TONE_PARAM.bass] = tone.bass;
  p[TONE_PARAM.mid] = tone.mid;
  p[TONE_PARAM.treble] = tone.treble;
  p[TONE_PARAM.presence] = tone.presence;
  p[TONE_PARAM.level] = tone.levelDb;
  p[TONE_PARAM.cab] = tone.cab ? 1 : 0;
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

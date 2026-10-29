// Гитарный процессор мониторинга: настройки тона → параметры ядра packages/dsp/src/tone.rs (номера PARAM_* — контракт,
// меняются только синхронно; сверку держит tone.test.ts на настоящем tone.wasm). Один массив значений по номерам уходит
// и в JACK-движок (плоскими парами «номер, значение»), и в AudioWorklet браузера (toneProcessorSource.ts).

export const TONE_PARAM = {
  bypass: 0, model: 1, gate: 2, gain: 3, bass: 4, mid: 5, treble: 6, presence: 7, level: 8, cab: 9,
  delayMix: 10, delayMs: 11, delayFeedback: 12, roomMix: 13,
} as const;
export const TONE_PARAM_COUNT = 14;

export const AMP_MODELS = ['clean', 'crunch', 'high-gain'] as const;
export type AmpModelName = (typeof AMP_MODELS)[number];

/** Тон, как его хранят настройки раздела (GuitarSettings.tone). Ручки 0…1, тонстек 0.5 — ровно. */
export interface ToneShape {
  on: boolean;
  model: AmpModelName;
  /** Порог гейта, дБ полной шкалы; ниже −96 — выключен. */
  gateDb: number;
  gain: number;
  bass: number;
  mid: number;
  treble: number;
  presence: number;
  /** Громкость выхода, дБ. */
  levelDb: number;
  cab: boolean;
  delay: { mix: number; ms: number; feedback: number };
  room: number;
}

/** Как в DEFAULTS ядра: хай-гейн с кабинетом, гейт −60 дБ, без дилея, лёгкая комната. */
export const DEFAULT_TONE: ToneShape = {
  on: true, model: 'high-gain', gateDb: -60, gain: 0.5, bass: 0.5, mid: 0.5, treble: 0.5, presence: 0.5, levelDb: 0, cab: true,
  delay: { mix: 0, ms: 350, feedback: 0.3 }, room: 0.15,
};

/** Значения параметров ядра по номерам; null — процессора нет (мониторинг сухой, как в обходе). */
export function toneParams(t: ToneShape | null): number[] {
  const p = new Array<number>(TONE_PARAM_COUNT).fill(0);
  const tone = t ?? { ...DEFAULT_TONE, on: false };
  p[TONE_PARAM.bypass] = tone.on ? 0 : 1;
  p[TONE_PARAM.model] = Math.max(0, AMP_MODELS.indexOf(tone.model));
  p[TONE_PARAM.gate] = tone.gateDb;
  p[TONE_PARAM.gain] = tone.gain;
  p[TONE_PARAM.bass] = tone.bass;
  p[TONE_PARAM.mid] = tone.mid;
  p[TONE_PARAM.treble] = tone.treble;
  p[TONE_PARAM.presence] = tone.presence;
  p[TONE_PARAM.level] = tone.levelDb;
  p[TONE_PARAM.cab] = tone.cab ? 1 : 0;
  p[TONE_PARAM.delayMix] = tone.delay.mix;
  p[TONE_PARAM.delayMs] = tone.delay.ms;
  p[TONE_PARAM.delayFeedback] = tone.delay.feedback;
  p[TONE_PARAM.roomMix] = tone.room;
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

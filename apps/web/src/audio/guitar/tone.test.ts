// Процессор на настоящем tone.wasm: номера параметров TS совпадают с ядром (обход — бит в бит, чистый без гейна —
// почти линеен, хай-гейн — гармоники, бас-комплект держит низ); изменения уходят парами только для изменившихся
// параметров; тон из чужих данных (импорт пресета) — в пределах ручек.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  boardOf, changedToneParams, DEFAULT_TONE, DELAY_MIX_ON, GATE_OFF_DB, toggleUtility, toneKey, toneOf, TONE_PARAM, TONE_PARAM_COUNT, toneParams,
  toneWith, utilitiesOn, type ToneShape,
} from './tone';

interface ToneDsp {
  memory: WebAssembly.Memory;
  tone_init(rate: number): void;
  tone_buf_ptr(): number;
  tone_set(id: number, value: number): void;
  tone_process(n: number): void;
}

const FS = 48000;
const modulePromise = WebAssembly.compile(readFileSync(new URL('../../assets/tone.wasm', import.meta.url)));

async function run(tone: ToneShape | null, input: Float32Array): Promise<Float32Array> {
  const dsp = (await WebAssembly.instantiate(await modulePromise, {})).exports as unknown as ToneDsp;
  dsp.tone_init(FS);
  const pairs = changedToneParams(null, toneParams(tone));
  for (let i = 0; i < pairs.length; i += 2) dsp.tone_set(pairs[i], pairs[i + 1]);
  const out = new Float32Array(input.length);
  for (let o = 0; o < input.length; o += 128) {
    const n = Math.min(128, input.length - o);
    new Float32Array(dsp.memory.buffer, dsp.tone_buf_ptr(), n).set(input.subarray(o, o + n));
    dsp.tone_process(n);
    out.set(new Float32Array(dsp.memory.buffer, dsp.tone_buf_ptr(), n), o);
  }
  return out;
}
const sine = (hz: number, sec: number, amp: number) => Float32Array.from({ length: sec * FS }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / FS));
/** Амплитуда на частоте hz (одна точка ДПФ). */
function bin(x: Float32Array, hz: number): number {
  let re = 0, im = 0;
  x.forEach((v, i) => {
    re += v * Math.cos((2 * Math.PI * hz * i) / FS);
    im += v * Math.sin((2 * Math.PI * hz * i) / FS);
  });
  return Math.hypot(re, im);
}

describe('процессор на tone.wasm', () => {
  it('обход (тон выключен или процессора нет) — бит в бит', async () => {
    const x = sine(220, 0.1, 0.3);
    expect(await run(null, x)).toEqual(x);
    expect(await run({ ...DEFAULT_TONE, on: false }, x)).toEqual(x);
  });

  it('чистый без гейна, без кабинета и комнаты — почти линеен; хай-гейн — гармоники, без NaN', async () => {
    const quiet: ToneShape = { ...DEFAULT_TONE, model: 'clean', gain: 0, cab: false, room: 0, gateDb: -120 };
    const clean = (await run(quiet, sine(440, 0.5, 0.05))).subarray(6000, 18000);
    expect(bin(clean, 1320) / bin(clean, 440)).toBeLessThan(0.01);
    const hot = (await run({ ...DEFAULT_TONE, room: 0 }, sine(110, 1, 0.1))).subarray(12000, 36000);
    expect(hot.some(Number.isNaN)).toBe(false);
    expect(bin(hot, 330) / bin(hot, 110)).toBeGreaterThan(0.05);
  });

  it('педалборд: порядок — номерами педалей в слотах, граница петли; битый порядок — по умолчанию', () => {
    const p = toneParams({ ...DEFAULT_TONE, board: { order: ['delay', 'screamer', 'gate', 'boost', 'fuzz', 'room'], loop: 3 } });
    expect(p.slice(TONE_PARAM.slot0, TONE_PARAM.slot0 + 6)).toEqual([2, 1, 0, 5, 4, 3]);
    expect(p[TONE_PARAM.loop]).toBe(3);
    expect(TONE_PARAM.loop).toBe(TONE_PARAM.slot0 + 6);
    expect(boardOf({ board: { order: ['gate', 'gate', 'delay', 'room'], loop: 9 } as never })).toEqual(DEFAULT_TONE.board);
    expect(boardOf({ board: { order: ['wah'], loop: 0 } as never })).toEqual(DEFAULT_TONE.board);
    // запись до фузза и буста: они встают в начало цепочки, граница петли сдвигается вместе с ней
    expect(boardOf({ board: { order: ['room', 'delay', 'screamer', 'gate'], loop: 9 } })).toEqual({
      order: ['fuzz', 'boost', 'room', 'delay', 'screamer', 'gate'], loop: 6,
    });
    expect(boardOf({ board: { order: ['gate', 'screamer', 'delay', 'room'], loop: 2 } }).loop).toBe(4);
  });

  it('кнопки гейта, дилея и комнаты: выключают в ядре, ручки остаются; записи до кнопок выключены ручкой в нуле', () => {
    const tuned: ToneShape = { ...DEFAULT_TONE, gateDb: -45, delay: { on: true, mix: 0.5, ms: 500, feedback: 0.6 }, room: 0.4 };
    let tone = tuned;
    for (const pedal of ['gate', 'delay', 'room'] as const) tone = { ...tone, ...toggleUtility(tone, pedal) };
    expect(utilitiesOn(tone)).toEqual({ gate: false, delay: false, room: false });
    expect([tone.gateDb, tone.delay, tone.room]).toEqual([-45, { on: false, mix: 0.5, ms: 500, feedback: 0.6 }, 0.4]);
    const p = toneParams(tone);
    expect([p[TONE_PARAM.gate], p[TONE_PARAM.delayMix], p[TONE_PARAM.roomMix]]).toEqual([GATE_OFF_DB, 0, 0]);
    expect([p[TONE_PARAM.delayMs], p[TONE_PARAM.delayFeedback]]).toEqual([500, 0.6]);
    for (const pedal of ['gate', 'delay', 'room'] as const) tone = { ...tone, ...toggleUtility(tone, pedal) };
    expect(tone).toEqual(tuned);
    // до кнопок педали выключались ручкой: флаг из умолчаний, включение возвращает ручку по умолчанию
    let old: ToneShape = { ...DEFAULT_TONE, gateDb: GATE_OFF_DB, room: 0 };
    expect(utilitiesOn(old)).toEqual({ gate: false, delay: false, room: false });
    for (const pedal of ['gate', 'delay', 'room'] as const) old = { ...old, ...toggleUtility(old, pedal) };
    expect([old.gateDb, old.delay.mix, old.room]).toEqual([DEFAULT_TONE.gateDb, DELAY_MIX_ON, DEFAULT_TONE.room]);
  });

  it('фузз и буст на tone.wasm: фузз — почти меандр, четыре LEVEL буста складываются', async () => {
    const quiet: ToneShape = { ...DEFAULT_TONE, model: 'clean', gain: 0, cab: false, room: 0, gateDb: -120 };
    const fuzz = (await run({ ...quiet, fuzz: { on: true, gain: 1, tone: 1, level: 0.5 } }, sine(220, 0.5, 0.05))).subarray(12000);
    expect(bin(fuzz, 660) / bin(fuzz, 220)).toBeGreaterThan(0.15);
    const x = sine(440, 0.5, 0.001);
    const level = async (levels: number[]) => bin((await run({ ...quiet, boost: { on: true, levels } }, x)).subarray(12000), 440);
    const base = bin((await run(quiet, x)).subarray(12000), 440);
    const db = (v: number) => 20 * Math.log10(v / base);
    expect(db(await level([0.5, 0.5, 0.5, 0.5]))).toBeCloseTo(0, 0);
    expect(db(await level([1, 1, 1, 1]))).toBeGreaterThan(25);
  });

  it('скример на tone.wasm: включённый с драйвом даёт гармоники на чистом усилителе', async () => {
    const quiet: ToneShape = { ...DEFAULT_TONE, model: 'clean', gain: 0, cab: false, room: 0, gateDb: -120 };
    const off = (await run(quiet, sine(440, 0.5, 0.05))).subarray(6000, 18000);
    const on = (await run({ ...quiet, screamer: { on: true, drive: 1, tone: 1, level: 0.5 } }, sine(440, 0.5, 0.05))).subarray(6000, 18000);
    expect(bin(off, 1320) / bin(off, 440)).toBeLessThan(0.01);
    expect(bin(on, 1320) / bin(on, 440)).toBeGreaterThan(0.03);
  });

  it('бас-комплект: ручки басовой головы — по общим номерам, нижнее E баса проходит, громкость — как у гитары', async () => {
    const bass = toneWith({ rig: 'bass', room: 0, gateOn: false, bassAmp: { model: 'modern', gain: 0.3, treble: 0.8, midFreq: 4, comp: 0.4 } });
    const p = toneParams(bass);
    expect([p[TONE_PARAM.rig], p[TONE_PARAM.model], p[TONE_PARAM.gain], p[TONE_PARAM.treble], p[TONE_PARAM.midFreq], p[TONE_PARAM.comp]])
      .toEqual([1, 1, 0.3, 0.8, 4, 0.4]);
    // ручки гитарной головы в басе не участвуют, но хранятся
    expect(bass.treble).toBe(DEFAULT_TONE.treble);
    // наклон спектра (41 Гц против 164 Гц того же комплекта) не зависит от громкости голоса: гитарный низ режет
    const guitar = toneWith({ room: 0, gateOn: false, model: 'clean', gain: 0.3 });
    const at = async (tone: ToneShape, hz: number) => bin((await run(tone, sine(hz, 0.6, 0.05))).subarray(14400), hz);
    const tilt = async (tone: ToneShape) => (await at(tone, 41.2)) / (await at(tone, 164.8));
    expect(await tilt(bass)).toBeGreaterThan(2.5 * (await tilt(guitar)));
    // ламповый бас на ре струне — та же громкость, что гитарный кранч, ± 9 дБ
    const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
    const loud = async (tone: ToneShape) => rms((await run(tone, sine(73.4, 0.6, 0.2))).subarray(14400));
    const db = 20 * Math.log10((await loud(toneWith({ rig: 'bass', room: 0, gateOn: false }))) / (await loud(toneWith({ model: 'crunch', room: 0, gateOn: false }))));
    expect(Math.abs(db)).toBeLessThan(9);
  });

  it('тон из чужих данных: поля своего типа и в пределах ручек, мусор — по умолчанию; ключ звучания без питания', () => {
    const t = toneOf({ rig: 'drums', model: 'high-gain', gain: 7, levelDb: -99, delay: { ms: 5, mix: 'x' }, boost: { levels: [2, -1] },
      bassAmp: { model: 'grit', midFreq: 9.4, horn: 'yes' }, extra: { evil: true } });
    expect(t.rig).toBe('guitar');
    expect([t.gain, t.levelDb, t.delay.ms, t.delay.mix]).toEqual([1, -24, 20, DEFAULT_TONE.delay.mix]);
    expect(t.boost.levels).toEqual([1, 0, 0.5, 0.5]);
    expect([t.bassAmp.model, t.bassAmp.midFreq, t.bassAmp.horn]).toEqual(['grit', 4, true]);
    expect('extra' in t).toBe(false);
    expect(toneOf(null)).toEqual(DEFAULT_TONE);
    expect(toneKey({ ...DEFAULT_TONE, on: false })).toBe(toneKey(DEFAULT_TONE));
    expect(toneKey({ ...DEFAULT_TONE, gain: 0.51 })).not.toBe(toneKey(DEFAULT_TONE));
  });

  it('параметры по номерам; изменения — только изменившиеся пары', () => {
    const p = toneParams(DEFAULT_TONE);
    expect(p).toHaveLength(TONE_PARAM_COUNT);
    expect([p[TONE_PARAM.bypass], p[TONE_PARAM.model], p[TONE_PARAM.cab], p[TONE_PARAM.delayMs]]).toEqual([0, 2, 1, 350]);
    expect(toneParams(null)[TONE_PARAM.bypass]).toBe(1);
    const next = toneParams({ ...DEFAULT_TONE, treble: 0.7, delay: { ...DEFAULT_TONE.delay, mix: 0.2 } });
    expect(changedToneParams(p, next)).toEqual([TONE_PARAM.treble, 0.7, TONE_PARAM.delayMix, 0.2]);
    expect(changedToneParams(p, p)).toEqual([]);
  });
});

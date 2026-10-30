// Процессор на настоящем tone.wasm: номера параметров TS совпадают с ядром (обход — бит в бит, чистый без гейна —
// почти линеен, хай-гейн — гармоники); изменения уходят парами только для изменившихся параметров.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { boardOf, changedToneParams, DEFAULT_TONE, TONE_PARAM, TONE_PARAM_COUNT, toneParams, type ToneShape } from './tone';

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

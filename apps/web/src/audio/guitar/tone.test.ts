// Процессор на настоящем tone.wasm: номера параметров TS совпадают с ядром (обход — бит в бит, чистый без гейна —
// почти линеен, хай-гейн — гармоники); изменения уходят парами только для изменившихся параметров.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { changedToneParams, DEFAULT_TONE, TONE_PARAM, TONE_PARAM_COUNT, toneParams, type ToneShape } from './tone';

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

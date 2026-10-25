// Эталоны WASM: те же семь сигналов и двоичный формат, что в voice_golden.rs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface Dsp {
  memory: WebAssembly.Memory;
  dsp_init(rate: number): void;
  dsp_in_ptr(): number;
  dsp_out_ptr(): number;
  dsp_frame_floats(): number;
  dsp_process(count: number): number;
}

const modulePromise = WebAssembly.compile(readFileSync(new URL('../assets/dsp.wasm', import.meta.url)));
async function createDsp(rate: number): Promise<Dsp> {
  const instance = await WebAssembly.instantiate(await modulePromise, {});
  const dsp = instance.exports as unknown as Dsp;
  dsp.dsp_init(rate);
  expect(dsp.dsp_frame_floats()).toBe(15);
  return dsp;
}

function signals(sr: number): Float32Array[] {
  const tau = 2 * Math.PI;
  const generate = (seconds: number, sample: (t: number) => number) =>
    Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => Math.round(sample(i / sr) * 32767) / 32767);
  const tone = (t: number) => 0.3 * Math.sin(tau * 220 * t);
  let phase = 0;
  const vibrato = generate(2.5, (t) => {
    const hz = 220 * 2 ** (50 * Math.sin(tau * 5.5 * t) / 1200);
    phase += hz / sr;
    return 0.3 * Math.sin(tau * phase);
  });
  phase = 0;
  const sweep = generate(3, (t) => {
    const hz = 80 * (1000 / 80) ** (t / 3);
    phase += hz / sr;
    return 0.3 * Math.sin(tau * phase);
  });
  let seed = 0x9E3779B9;
  const burst = generate(1, (t) => {
    if (t < 0.3 || t >= 0.5) return 0;
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return 0.2 * (2 * (seed >>> 0) / 0xFFFFFFFF - 1);
  });
  return [
    generate(1.5, tone), vibrato,
    generate(2.5, (t) => tone(t) + 0.11 * Math.sin(tau * 110 * t)),
    generate(2, (t) => [0.4, 1, 0.5, 0.3, 0.2].reduce(
      (sum, amp, k) => sum + 0.15 * amp * Math.sin(tau * 130.8 * (k + 1) * t), 0)),
    generate(1.5, (t) => t < 0.5 ? 0 : tone(t - 0.5)), sweep, burst,
  ];
}

const float = new Float32Array(1);
const uint = new Uint32Array(float.buffer);
function bits(value: number): number {
  float[0] = value;
  return uint[0];
}
function ordered(value: number): number {
  const word = bits(value);
  return word & 0x80000000 ? 0x80000000 - (word & 0x7FFFFFFF) : 0x80000000 + word;
}
function matches(field: number, expected: number, actual: number): boolean {
  if ([0, 6, 8, 12].includes(field)) return bits(expected) === bits(actual);
  if (Number.isNaN(expected) || Number.isNaN(actual)) return Number.isNaN(expected) && Number.isNaN(actual);
  if (expected === actual) return true;
  if (!Number.isFinite(expected) || !Number.isFinite(actual)) return false;
  return Math.abs(ordered(expected) - ordered(actual)) <= 4;
}
function fromBits(word: number): number {
  uint[0] = word;
  return float[0];
}

it('компаратор: точные флаги и время, остальные поля до 4 ULP', () => {
  for (const base of [1, -1]) {
    for (const delta of [1, 4]) expect(matches(1, base, fromBits(bits(base) + delta))).toBe(true);
    expect(matches(1, base, fromBits(bits(base) + 5))).toBe(false);
  }
  expect(matches(1, 1, 1 * (1 + 1e-3))).toBe(false);
  expect(matches(1, NaN, NaN)).toBe(true);
  expect(matches(1, NaN, 1)).toBe(false);
  expect(matches(1, 0, -0)).toBe(true);
  expect(matches(1, Infinity, Infinity)).toBe(true);
  expect(matches(1, Infinity, fromBits(0x7F7FFFFF))).toBe(false);
  expect(matches(1, Infinity, -Infinity)).toBe(false);
  for (const field of [0, 6, 8, 12]) {
    expect(matches(field, 0, -0)).toBe(false);
    expect(matches(field, 1, fromBits(bits(1) + 1))).toBe(false);
  }
});

describe('кадры вокального WASM', () => {
  it.each([44100, 48000, 96000])('%i Гц', async (rate) => {
    const frames: number[][] = [];
    for (const samples of signals(rate)) {
      // Каждый сигнал получает полностью свежее состояние анализатора.
      const dsp = await createDsp(rate);
      const values: number[] = [];
      for (let offset = 0; offset < samples.length; offset += 128) {
        const chunk = samples.subarray(offset, offset + 128);
        new Float32Array(dsp.memory.buffer, dsp.dsp_in_ptr(), chunk.length).set(chunk);
        const count = dsp.dsp_process(chunk.length);
        values.push(...new Float32Array(dsp.memory.buffer, dsp.dsp_out_ptr(), count * 15));
      }
      frames.push(values);
    }
    const header = [0x564F4344, 1, rate, 15, 7, ...frames.map((f) => f.length / 15)];
    const bytes = Buffer.alloc(48 + frames.reduce((sum, f) => sum + f.length * 4, 0));
    header.forEach((word, i) => bytes.writeUInt32LE(word, i * 4));
    let offset = 48;
    for (const signal of frames) for (const value of signal) {
      bytes.writeFloatLE(value, offset);
      offset += 4;
    }
    const path = fileURLToPath(new URL(`./__golden__/voice-wasm-${rate}.bin`, import.meta.url));
    if (process.env.GOLDEN_WRITE === '1') {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
      return;
    }
    if (!existsSync(path)) throw new Error(`${path}: нет эталона; создайте: GOLDEN_WRITE=1 npx vitest run src/audio/voiceGolden.test.ts`);
    const saved = readFileSync(path);
    expect(saved.length, 'длина эталона').toBe(bytes.length);
    expect(saved.subarray(0, 48), 'заголовок').toEqual(bytes.subarray(0, 48));
    offset = 48;
    frames.forEach((signal, s) => signal.forEach((actual, i) => {
      const expected = saved.readFloatLE(offset);
      if (!matches(i % 15, expected, actual)) throw new Error(
        `${rate} Гц, сигнал ${s + 1}, кадр ${Math.floor(i / 15)}, поле ${i % 15}: ${expected} != ${actual}`);
      offset += 4;
    }));
  });
});

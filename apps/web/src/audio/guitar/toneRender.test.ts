// Офлайн-рендер экспорта — то же ядро, что ворклет мониторинга: блоками по 4096 (с уступкой главному потоку) выходит бит в
// бит как по 128; хвост — тишина после конца, дилей в нём звенит.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { changedToneParams, DEFAULT_TONE, toneParams, toneWith } from './tone';
import { renderTone } from './toneRender';

const FS = 48000;
const modulePromise = WebAssembly.compile(readFileSync(new URL('../../assets/tone.wasm', import.meta.url)));
interface ToneDsp {
  memory: WebAssembly.Memory;
  tone_init(rate: number): void;
  tone_buf_ptr(): number;
  tone_set(id: number, value: number): void;
  tone_process(n: number): void;
}

async function byWorklet(params: number[], input: Float32Array): Promise<Float32Array> {
  const dsp = (await WebAssembly.instantiate(await modulePromise, {})).exports as unknown as ToneDsp;
  dsp.tone_init(FS);
  const pairs = changedToneParams(null, params);
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

describe('офлайн-рендер дубля', () => {
  it('бит в бит как ворклет; хвост дилея звенит после конца', async () => {
    const tone = toneWith({ delay: { on: true, mix: 0.5, ms: 200, feedback: 0.4 } });
    const dry = Float32Array.from({ length: FS / 2 }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 196 * i) / FS));
    const progress: number[] = [];
    const out = await renderTone(dry, FS, toneParams(tone), { tailSec: 1, onProgress: (s) => progress.push(s) });
    expect(out.length).toBe(dry.length + FS);
    const padded = new Float32Array(out.length);
    padded.set(dry);
    expect(out).toEqual(await byWorklet(toneParams(tone), padded));
    const tail = out.subarray(dry.length + FS / 10);
    expect(Math.max(...tail.map(Math.abs))).toBeGreaterThan(1e-3);
    expect(progress.at(-1)).toBe(1);
    // процессор выключен — DI как есть
    expect(await renderTone(dry, FS, toneParams({ ...DEFAULT_TONE, on: false }))).toEqual(dry);
  });
});
